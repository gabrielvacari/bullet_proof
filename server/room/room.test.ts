import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_PLAYERS_PER_ROOM,
  MAX_QUEUED_INPUTS,
  SERVER_TICK_HZ,
  SNAPSHOT_HZ,
  WALK_SPEED,
} from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import type { GameMap } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';
import { decode } from '#shared/protocol/encode.ts';
import { KEY_FORWARD, KEY_JUMP } from '#shared/protocol/keys.ts';
import { STATE_GROUNDED } from '#shared/protocol/types.ts';
import type {
  InputMessage,
  JoinMessage,
  ServerMessage,
  SnapshotMessage,
} from '#shared/protocol/types.ts';

import { type Room, type Sink, createRoom } from './room.ts';

/**
 * The authority (NFR-001), driven directly rather than through a socket.
 *
 * `tick()` is called by hand, so every case here runs in microseconds and none of it
 * depends on a timer. The room never reaches for a global, which is what lets the
 * isolation test create two of them in one process.
 */

const MAP: GameMap = loadMap(
  JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')) as unknown,
);

const FORWARD: Vec3 = [0, 0, -1];

/** A sink that records what the server sent it, and can be made to fail. */
function recorder(): Sink & { sent: ServerMessage[]; fail: () => void } {
  const sent: ServerMessage[] = [];
  let failing = false;

  return {
    sent,
    fail() {
      failing = true;
    },
    send(text) {
      if (failing) throw new Error('socket is gone');
      sent.push(decode(text) as ServerMessage);
    },
  };
}

function joinMessage(nickname: string): JoinMessage {
  return { t: 'join', nickname, mode: 'FFA' };
}

function inputMessage(seq: number, keys = 0): InputMessage {
  return { t: 'input', seq, keys, dir: FORWARD };
}

/** Ticks until a snapshot has been broadcast, and returns the last one this sink saw. */
function tickToSnapshot(room: Room, sink: { sent: ServerMessage[] }): SnapshotMessage {
  const ticksPerSnapshot = Math.ceil(SERVER_TICK_HZ / SNAPSHOT_HZ) + 1;
  for (let i = 0; i < ticksPerSnapshot; i += 1) room.tick();

  const snapshots = sink.sent.filter((m): m is SnapshotMessage => m.t === 'snapshot');
  const last = snapshots.at(-1);
  if (last === undefined) throw new Error('no snapshot was broadcast');
  return last;
}

let room: Room;

beforeEach(() => {
  room = createRoom('r_test', MAP);
});

describe('joining (NET-003, NET-008, NET-010)', () => {
  it('replies joined with the map, the tick rate, the config and the spawn', () => {
    const sink = recorder();
    const outcome = room.join('c_1', joinMessage('gabriel'), sink);

    expect(outcome.ok).toBe(true);
    const joined = sink.sent[0];
    if (joined?.t !== 'joined') throw new Error('expected joined first');

    expect(joined.mapId).toBe(MAP.id);
    expect(joined.tickRate).toBe(SERVER_TICK_HZ);
    expect(joined.mode).toBe('FFA');
    expect(joined.team).toBeNull();
    expect(joined.config.walkSpeed).toBe(WALK_SPEED);
    expect(joined.spawn.pos).toEqual(MAP.spawns[0]?.pos);
  });

  it('tells everyone already here that someone arrived, but not the arriver', () => {
    const first = recorder();
    const second = recorder();
    room.join('c_1', joinMessage('gabriel'), first);
    room.join('c_2', joinMessage('ana'), second);

    const announced = first.sent.filter((m) => m.t === 'playerJoined');
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({ nickname: 'ana' });

    // The newcomer hears about nobody's arrival but everyone's presence.
    const heard = second.sent.filter((m) => m.t === 'playerJoined');
    expect(heard.map((m) => m.nickname)).toEqual(['gabriel']);
  });

  /** FR-GP-013. The refused player is never added, so they never appear in a snapshot. */
  it('refuses the MAX_PLAYERS_PER_ROOM+1-th player with ROOM_FULL', () => {
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i += 1) {
      room.join(`c_${String(i)}`, joinMessage(`p${String(i)}`), recorder());
    }

    const late = recorder();
    const outcome = room.join('c_late', joinMessage('late'), late);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected the join to be refused');
    expect(outcome.code).toBe('ROOM_FULL');
    expect(typeof outcome.message).toBe('string');
    expect(room.playerCount).toBe(MAX_PLAYERS_PER_ROOM);
    expect(late.sent).toHaveLength(0);
  });

  /** FR-GP-014. Joining mid-match puts the player in the arena, not in a queue. */
  it('puts a player joining a running room into the next snapshot', () => {
    const first = recorder();
    room.join('c_1', joinMessage('gabriel'), first);
    room.tick();
    room.tick();

    const late = recorder();
    room.join('c_2', joinMessage('ana'), late);

    const snapshot = tickToSnapshot(room, late);
    expect(snapshot.players.map((p) => p.id).sort()).toEqual(['p_c_1', 'p_c_2']);
  });

  it('identifies players by their server-assigned id, not their nickname (FR-GP-009)', () => {
    const first = recorder();
    const second = recorder();
    room.join('c_1', joinMessage('same'), first);
    room.join('c_2', joinMessage('same'), second);

    expect(room.playerCount).toBe(2);
    const snapshot = tickToSnapshot(room, first);
    expect(new Set(snapshot.players.map((p) => p.id)).size).toBe(2);
  });
});

describe('the tick advances the simulation, and nothing else does (NFR-001)', () => {
  /** R1. One input, one tick -- never two, whatever the client's frame rate. */
  it('applies exactly one queued input per tick', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    room.enqueue('p_c_1', inputMessage(1, KEY_FORWARD));
    room.enqueue('p_c_1', inputMessage(2, KEY_FORWARD));
    room.enqueue('p_c_1', inputMessage(3, KEY_FORWARD));

    room.tick();
    expect(room.player('p_c_1')?.lastSeq).toBe(1);
    room.tick();
    expect(room.player('p_c_1')?.lastSeq).toBe(2);
  });

  it('does not advance a player when a message merely arrives', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);
    const before = room.player('p_c_1')?.state.pos;

    room.enqueue('p_c_1', inputMessage(1, KEY_FORWARD));
    expect(room.player('p_c_1')?.state.pos).toBe(before);
  });

  it('ignores an input for a player who is not in the room', () => {
    expect(() => {
      room.enqueue('p_nobody', inputMessage(1));
    }).not.toThrow();
  });

  /**
   * R4. A player whose inputs stall must fall, not freeze, and must not keep running.
   * Repeating the last input would make "hold W, then pull the cable" a movement
   * technique.
   */
  it('applies a neutral input when the queue is empty, not a repeat of the last one', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    room.enqueue('p_c_1', inputMessage(1, KEY_FORWARD));
    room.tick();
    const moving = room.player('p_c_1')?.state.vel ?? [0, 0, 0];
    expect(Math.abs(moving[2])).toBeGreaterThan(0);

    // Nothing arrives for the next tick.
    room.tick();
    const stalled = room.player('p_c_1')?.state.vel ?? [1, 1, 1];
    expect(stalled[0]).toBe(0);
    expect(stalled[2]).toBe(0);
  });

  it('keeps the last aim direction through a stalled tick', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    const aimed: Vec3 = [1, 0, 0];
    room.enqueue('p_c_1', { t: 'input', seq: 1, keys: 0, dir: aimed });
    room.tick();
    room.tick();

    expect(room.player('p_c_1')?.lastDir).toEqual(aimed);
  });

  it('still applies gravity to a player who never sends anything', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);
    const start = room.player('p_c_1')?.state.pos[1] ?? 0;

    for (let i = 0; i < SERVER_TICK_HZ; i += 1) room.tick();

    // The spawn sits on the floor, so the player lands rather than falling forever --
    // what matters is that the simulation ran at all.
    expect(room.player('p_c_1')?.state.grounded).toBe(true);
    expect(room.player('p_c_1')?.state.pos[1]).toBeLessThanOrEqual(start);
  });

  /** NET-004a. Beyond MAX_QUEUED_INPUTS the oldest are dropped, as specified. */
  it('caps the input queue and drops the oldest', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    for (let seq = 1; seq <= MAX_QUEUED_INPUTS * 2; seq += 1) {
      room.enqueue('p_c_1', inputMessage(seq));
    }

    room.tick();
    // The queue held only the newest MAX_QUEUED_INPUTS, so the first applied is not seq 1.
    expect(room.player('p_c_1')?.lastSeq).toBe(MAX_QUEUED_INPUTS + 1);
  });
});

describe('snapshots (NET-009)', () => {
  it('broadcasts at SNAPSHOT_HZ, not on every tick', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    for (let i = 0; i < SERVER_TICK_HZ; i += 1) room.tick();

    const snapshots = sink.sent.filter((m) => m.t === 'snapshot');
    // A second of ticks produces about a second of snapshots, and fewer than ticks.
    expect(snapshots.length).toBeLessThan(SERVER_TICK_HZ);
    expect(snapshots.length).toBeGreaterThanOrEqual(SNAPSHOT_HZ - 1);
  });

  /** NET-009a, FR-GP-049. Concealment is a rendering property, never a networking one. */
  it('includes every player, wherever they are', () => {
    const first = recorder();
    const second = recorder();
    room.join('c_1', joinMessage('gabriel'), first);
    room.join('c_2', joinMessage('ana'), second);

    const snapshot = tickToSnapshot(room, first);
    expect(snapshot.players).toHaveLength(2);
  });

  /** NFR-007. Each recipient is told what the server did with *their* input. */
  it('carries a per-recipient ack', () => {
    const first = recorder();
    const second = recorder();
    room.join('c_1', joinMessage('gabriel'), first);
    room.join('c_2', joinMessage('ana'), second);

    room.enqueue('p_c_1', inputMessage(41));
    room.tick();
    room.enqueue('p_c_1', inputMessage(42));

    const forFirst = tickToSnapshot(room, first);
    const forSecond = tickToSnapshot(room, second);
    expect(forFirst.ack).toBe(42);
    expect(forSecond.ack).toBe(0);
  });

  it('reports grounded and crouching in the state bitmask', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    for (let i = 0; i < SERVER_TICK_HZ; i += 1) room.tick();
    const snapshot = tickToSnapshot(room, sink);

    expect((snapshot.players[0]?.st ?? 0) & STATE_GROUNDED).toBe(STATE_GROUNDED);
  });

  /** NET-009b. Slow-changing data arrives once, with playerJoined. */
  it('carries no nickname', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    const snapshot = tickToSnapshot(room, sink);
    expect(JSON.stringify(snapshot)).not.toContain('gabriel');
  });

  it('advances its tick counter', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    const first = tickToSnapshot(room, sink);
    const second = tickToSnapshot(room, sink);
    expect(second.tick).toBeGreaterThan(first.tick);
  });
});

describe('leaving (NET-006, NET-011, FR-GP-040)', () => {
  it('tells everyone else and removes the player within the same tick', () => {
    const first = recorder();
    const second = recorder();
    room.join('c_1', joinMessage('gabriel'), first);
    room.join('c_2', joinMessage('ana'), second);

    room.leave('p_c_2');

    expect(first.sent.at(-1)).toEqual({ t: 'playerLeft', id: 'p_c_2' });
    expect(room.playerCount).toBe(1);
  });

  /** The ghost this forbids is the most visible bug in any multiplayer demo. */
  it('leaves no trace in the next snapshot, and no orphaned queue', () => {
    const first = recorder();
    const second = recorder();
    room.join('c_1', joinMessage('gabriel'), first);
    room.join('c_2', joinMessage('ana'), second);

    room.enqueue('p_c_2', inputMessage(1, KEY_FORWARD));
    room.leave('p_c_2');
    room.enqueue('p_c_2', inputMessage(2, KEY_FORWARD));

    const snapshot = tickToSnapshot(room, first);
    expect(snapshot.players.map((p) => p.id)).toEqual(['p_c_1']);
    expect(room.player('p_c_2')).toBeUndefined();
  });

  it('does not tell a departing player about their own departure', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);
    const before = sink.sent.length;

    room.leave('p_c_1');
    expect(sink.sent).toHaveLength(before);
  });

  it('ignores a leave for a player who is not here', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);

    room.leave('p_nobody');
    room.leave('p_c_1');
    room.leave('p_c_1');
    expect(room.playerCount).toBe(0);
  });

  /** D-009: rejoining is a new player, never a resumed one. */
  it('gives a rejoining socket a fresh player rather than the old one', () => {
    const sink = recorder();
    room.join('c_1', joinMessage('gabriel'), sink);
    room.enqueue('p_c_1', inputMessage(9, KEY_JUMP));
    room.tick();
    room.leave('p_c_1');

    room.join('c_1', joinMessage('gabriel'), recorder());
    expect(room.player('p_c_1')?.lastSeq).toBe(0);
  });
});

describe('isolation (NFR-015)', () => {
  /**
   * A socket can die between a tick starting and a broadcast reaching it. The room must
   * drop that player and keep ticking, and the failure must not reach any other room in
   * the process.
   */
  it('drops a player whose sink throws, and keeps ticking', () => {
    const healthy = recorder();
    const broken = recorder();
    room.join('c_1', joinMessage('gabriel'), healthy);
    room.join('c_2', joinMessage('ana'), broken);
    broken.fail();

    expect(() => tickToSnapshot(room, healthy)).not.toThrow();
    expect(room.playerCount).toBe(1);
    expect(room.player('p_c_2')).toBeUndefined();
  });

  it('tells the survivors that the failed player has gone', () => {
    const healthy = recorder();
    const broken = recorder();
    room.join('c_1', joinMessage('gabriel'), healthy);
    room.join('c_2', joinMessage('ana'), broken);
    broken.fail();

    tickToSnapshot(room, healthy);
    expect(healthy.sent.some((m) => m.t === 'playerLeft' && m.id === 'p_c_2')).toBe(true);
  });

  it('keeps two rooms in one process independent', () => {
    const other = createRoom('r_other', MAP);
    const here = recorder();
    const there = recorder();
    const broken = recorder();

    room.join('c_1', joinMessage('gabriel'), here);
    room.join('c_2', joinMessage('ana'), broken);
    other.join('c_3', joinMessage('kim'), there);
    broken.fail();

    tickToSnapshot(room, here);
    const unaffected = tickToSnapshot(other, there);

    expect(other.playerCount).toBe(1);
    expect(unaffected.players.map((p) => p.id)).toEqual(['p_c_3']);
  });

  it('refuses to build a room from a map with no spawn', () => {
    const spawnless = { ...MAP, spawns: [] };
    expect(() => createRoom('r_bad', spawnless)).toThrow('no spawn point');
  });
});
