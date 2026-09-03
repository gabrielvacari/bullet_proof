import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
  INTERPOLATION_DELAY,
  MS_PER_SECOND,
  SERVER_TICK_HZ,
  SNAPSHOT_INTERVAL_MS,
  TICK_DURATION_MS,
  WS_PATH,
} from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import type { GameMap } from '#shared/map/types.ts';
import { decode, encode } from '#shared/protocol/encode.ts';
import { KEY_FORWARD } from '#shared/protocol/keys.ts';
import type {
  ClientMessage,
  JoinedMessage,
  ServerMessage,
  SnapshotMessage,
} from '#shared/protocol/types.ts';

import { emptyBuffer, push, sample } from '#client/net/interpolation.ts';

import { createSession } from './net/connection.ts';
import type { Transport } from './net/transport.ts';
import { listen } from './net/ws-transport.ts';
import { createLoop } from './room/loop.ts';
import { type Room, createRoom } from './room/room.ts';

/**
 * The whole thing, over a real socket, using Node 24's own WebSocket client.
 *
 * Slow, few, and the only tests that would catch a wiring mistake -- a handler never
 * attached, a message never routed, a player removed from the room but not from the
 * broadcast. Every unit test above passes happily with the wires crossed.
 */

const MAP: GameMap = loadMap(
  JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')) as unknown,
);

interface Harness {
  readonly url: string;
  readonly room: Room;
  stop(): Promise<void>;
}

let harness: Harness | null = null;

/** The same wiring as server/index.ts, on an ephemeral port and a hand-driven clock. */
async function startServer(): Promise<Harness> {
  const room = createRoom('r_test', MAP);
  const started: { server: Server; transport: Transport } = await listen(0);

  started.transport.onConnection((connection) => {
    const session = createSession(connection, room, Date.now());
    connection.onMessage((text) => {
      session.handle(text, Date.now());
    });
    connection.onClose(() => {
      session.disconnect();
    });
  });

  const loop = createLoop(
    () => {
      room.tick();
    },
    { now: () => Date.now(), schedule: (fn, ms) => setTimeout(fn, ms) },
  );
  loop.start();

  const { port } = started.server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${String(port)}${WS_PATH}`,
    room,
    async stop() {
      loop.stop();
      // The transport closes its own players' sockets; an upgraded socket is no longer
      // the HTTP server's business, so server.close() alone would wait on it forever.
      await started.transport.close();
    },
  };
}

afterEach(async () => {
  await harness?.stop();
  harness = null;
});

/** One client: a real socket, plus everything it has been told. */
interface Client {
  readonly socket: WebSocket;
  readonly received: ServerMessage[];
  send(message: ClientMessage): void;
  waitFor<T extends ServerMessage['t']>(
    type: T,
    predicate?: (message: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>>;
  close(): void;
}

function open(url: string): Promise<Client> {
  const received: ServerMessage[] = [];
  const waiters: ((message: ServerMessage) => boolean)[] = [];
  const socket = new WebSocket(url);

  socket.addEventListener('message', (event: MessageEvent<string>) => {
    const message = decode(event.data) as ServerMessage;
    received.push(message);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i]?.(message) === true) waiters.splice(i, 1);
    }
  });

  const client: Client = {
    socket,
    received,
    send(message) {
      socket.send(encode(message));
    },
    waitFor(type, predicate) {
      type Wanted = Extract<ServerMessage, { t: typeof type }>;

      const already = received.find(
        (m): m is Wanted => m.t === type && (predicate?.(m as Wanted) ?? true),
      );
      if (already !== undefined) return Promise.resolve(already);

      return new Promise<Wanted>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out waiting for ${type}`));
        }, 3000);

        waiters.push((message) => {
          if (message.t !== type) return false;
          const wanted = message as Wanted;
          if (predicate?.(wanted) === false) return false;
          clearTimeout(timer);
          resolve(wanted);
          return true;
        });
      });
    },
    close() {
      socket.close();
    },
  };

  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve(client);
    });
    socket.addEventListener('error', () => {
      reject(new Error('could not connect'));
    });
  });
}

async function joinedClient(url: string, nickname: string): Promise<Client> {
  const client = await open(url);
  client.send({ t: 'join', nickname, mode: 'FFA' });
  await client.waitFor('joined');
  return client;
}

describe('two players, one server', () => {
  it('lets both join and shows each of them the other', async () => {
    harness = await startServer();

    const first = await joinedClient(harness.url, 'gabriel');
    const second = await joinedClient(harness.url, 'ana');

    // Each appears in the other's snapshots -- NET-009a, regardless of line of sight.
    const seenBySecond = await second.waitFor(
      'snapshot',
      (message) => message.players.length === 2,
    );
    expect(seenBySecond.players).toHaveLength(2);

    const seenByFirst = await first.waitFor(
      'snapshot',
      (message) => message.players.length === 2,
    );
    expect(seenByFirst.players).toHaveLength(2);

    first.close();
    second.close();
  });

  it('announces an arrival to whoever was already there (NET-010)', async () => {
    harness = await startServer();

    const first = await joinedClient(harness.url, 'gabriel');
    await joinedClient(harness.url, 'ana');

    const announced = await first.waitFor('playerJoined');
    expect(announced.nickname).toBe('ana');

    first.close();
  });

  /** NFR-006/NFR-007's server half: the input is applied and acknowledged. */
  it('applies an input and acknowledges it in that client own snapshot', async () => {
    harness = await startServer();

    const client = await joinedClient(harness.url, 'gabriel');
    const before = await client.waitFor('snapshot');
    const startX = before.players[0]?.p[0] ?? 0;

    for (let seq = 1; seq <= SERVER_TICK_HZ; seq += 1) {
      client.send({ t: 'input', seq, keys: KEY_FORWARD, dir: [0, 0, -1] });
      await sleep(TICK_DURATION_MS);
    }

    const after = await client.waitFor('snapshot', (message) => message.ack > 0);
    expect(after.ack).toBeGreaterThan(0);

    const moved = after.players[0];
    if (moved === undefined) throw new Error('the player vanished');
    // Moving forward from a spawn changes the position; which axis depends on the spawn.
    expect(moved.p[0] !== startX || moved.p[2] !== (before.players[0]?.p[2] ?? 0)).toBe(
      true,
    );

    client.close();
  });

  /** FR-GP-040: the ghost this forbids is the most visible bug in a multiplayer demo. */
  it('removes a player who closes their tab, within one tick', async () => {
    harness = await startServer();

    const staying = await joinedClient(harness.url, 'gabriel');
    const leaving = await joinedClient(harness.url, 'ana');

    await staying.waitFor('snapshot', (message) => message.players.length === 2);

    leaving.close();
    const left = await staying.waitFor('playerLeft');
    expect(left.id).toBeTruthy();

    const alone = await staying.waitFor(
      'snapshot',
      (message) => message.players.length === 1,
    );
    expect(alone.players).toHaveLength(1);
    expect(harness.room.playerCount).toBe(1);

    staying.close();
  });

  it('treats an explicit leave exactly like a closed socket (NET-006)', async () => {
    harness = await startServer();

    const staying = await joinedClient(harness.url, 'gabriel');
    const leaving = await joinedClient(harness.url, 'ana');
    await staying.waitFor('snapshot', (message) => message.players.length === 2);

    leaving.send({ t: 'leave' });

    await staying.waitFor('playerLeft');
    await staying.waitFor('snapshot', (message) => message.players.length === 1);
    expect(harness.room.playerCount).toBe(1);

    staying.close();
  });

  /** NFR-011 and NFR-010, against a client that is actually hostile rather than mocked. */
  it('drops a binary frame instead of coercing it into a message', async () => {
    // NET-001: every message is JSON text with a `t` field. A binary frame is not one, so
    // there is no handler it could reach. Dropping it at the transport keeps the session
    // from ever seeing a shape the protocol does not describe -- and, unlike garbage text,
    // a binary frame is not a malformed message either, so it must not spend the strike
    // budget that would eventually close an honest client's socket.
    const harness = await startServer();
    const client = await joinedClient(harness.url, 'ana');

    client.socket.send(new Uint8Array([0x00, 0xff, 0x10]).buffer);

    // Still alive and still served afterwards: the frame went nowhere.
    const snapshot = await client.waitFor('snapshot');
    expect(snapshot.players).toHaveLength(1);
    expect(client.socket.readyState).toBe(client.socket.OPEN);
  });

  it('keeps one player moving while another floods and sends garbage', async () => {
    harness = await startServer();

    const honest = await joinedClient(harness.url, 'gabriel');
    const hostile = await joinedClient(harness.url, 'ana');
    await honest.waitFor('snapshot', (message) => message.players.length === 2);

    hostile.socket.send('not json at all');
    hostile.socket.send('{"t":"input","dt":999999}');
    for (let seq = 1; seq <= 200; seq += 1) {
      hostile.send({ t: 'input', seq, keys: KEY_FORWARD, dir: [0, 0, -1] });
    }

    // The honest client is unaffected: its own inputs are still applied and acknowledged.
    for (let seq = 1; seq <= SERVER_TICK_HZ; seq += 1) {
      honest.send({ t: 'input', seq, keys: KEY_FORWARD, dir: [0, 0, -1] });
      await sleep(TICK_DURATION_MS);
    }

    const acked = await honest.waitFor('snapshot', (message) => message.ack > 0);
    expect(acked.ack).toBeGreaterThan(0);

    honest.close();
    hostile.close();
  });

  it('rejects a join the server does not accept, and closes the socket', async () => {
    harness = await startServer();

    const client = await open(harness.url);
    client.send({ t: 'join', nickname: 'a', mode: 'FFA' });

    const error = await client.waitFor('error');
    expect(error.code).toBe('MALFORMED');
    expect(harness.room.playerCount).toBe(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * What the *other* player sees (`M1-1`, `NFR-008`).
 *
 * The rest of this file proves the wiring carries messages. These two prove the thing the
 * milestone is actually judged on: that a capsule twenty snapshots a second turns into
 * motion rather than into stepping, and that a player who is not touching the keyboard is
 * drawn perfectly still.
 *
 * Both run the real server, take the snapshots a real second client received, and replay
 * them through the production interpolation module. Only the *arrival times* are
 * synthetic, spaced exactly {SNAPSHOT_INTERVAL_MS} apart: the positions are the server's,
 * so the assertions stay about interpolation and never about how punctual the CI box was.
 */

const RENDER_HZ = 60;

interface Frame {
  readonly renderTime: number;
  readonly pos: readonly [number, number, number];
}

/** 60 fps playback of a snapshot stream, exactly as `client/boot/main.ts` drives it. */
function render(snapshots: readonly SnapshotMessage[], id: string): Frame[] {
  const arrivals = snapshots.map((_, i) => i * SNAPSHOT_INTERVAL_MS);
  const frames: Frame[] = [];
  let buffer = emptyBuffer();
  let cursor = 0;

  for (let t = 0; t <= (arrivals.at(-1) ?? 0); t += MS_PER_SECOND / RENDER_HZ) {
    while (cursor < snapshots.length && arrivals[cursor]! <= t) {
      buffer = push(buffer, snapshots[cursor]!, arrivals[cursor]!);
      cursor += 1;
    }
    const me = sample(buffer, t - INTERPOLATION_DELAY).find((p) => p.id === id);
    if (me !== undefined) frames.push({ renderTime: t, pos: me.pos });
  }
  return frames;
}

function planarStep(a: Frame, b: Frame): number {
  const dx = b.pos[0] - a.pos[0];
  const dz = b.pos[2] - a.pos[2];
  return Math.sqrt(dx * dx + dz * dz);
}

function stepsBetween(frames: readonly Frame[], from: number, to: number): number[] {
  const inside = frames.filter((f) => f.renderTime >= from && f.renderTime <= to);
  return inside.slice(1).map((f, i) => planarStep(inside[i]!, f));
}

function snapshotsOf(client: Client): SnapshotMessage[] {
  return client.received.filter((m): m is SnapshotMessage => m.t === 'snapshot');
}

/** The longest run over which the server actually reported the player advancing. */
function movingRun(snapshots: readonly SnapshotMessage[], id: string): [number, number] {
  const at = (i: number): readonly [number, number, number] =>
    snapshots[i]!.players.find((p) => p.id === id)?.p ?? [0, 0, 0];

  let best: [number, number] = [0, 0];
  let start = 0;
  for (let i = 1; i < snapshots.length; i += 1) {
    const [ax, , az] = at(i - 1);
    const [bx, , bz] = at(i);
    const moved = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2) > 0;
    if (!moved) start = i;
    else if (i - start > best[1] - best[0]) best = [start, i];
  }
  return best;
}

describe('what the other player sees', () => {
  it('draws a walking player continuously, not stepping at the snapshot rate', async () => {
    harness = await startServer();
    const mover = await joinedClient(harness.url, 'mover');
    const watcher = await joinedClient(harness.url, 'watcher');
    const moverId = (
      mover.received.find((m): m is JoinedMessage => m.t === 'joined') as JoinedMessage
    ).playerId;

    let seq = 0;
    const driving = setInterval(() => {
      mover.send({ t: 'input', seq: (seq += 1), keys: KEY_FORWARD, dir: [0, 0, -1] });
    }, TICK_DURATION_MS);
    await watcher.waitFor('snapshot', () => snapshotsOf(watcher).length >= 30);
    clearInterval(driving);

    const snapshots = snapshotsOf(watcher);
    const [from, to] = movingRun(snapshots, moverId);
    // Enough of a run that a stepping bug could not hide inside the window.
    expect(to - from).toBeGreaterThanOrEqual(8);

    const frames = render(snapshots, moverId);
    const window: [number, number] = [
      from * SNAPSHOT_INTERVAL_MS + INTERPOLATION_DELAY,
      to * SNAPSHOT_INTERVAL_MS + INTERPOLATION_DELAY,
    ];
    const steps = stepsBetween(frames, ...window);
    expect(steps.length).toBeGreaterThan(20);

    // Every rendered frame advances. Without interpolation exactly one frame in three
    // would, because 60 fps playback of a 20 Hz stream repeats each position twice.
    expect(steps.every((s) => s > 0)).toBe(true);

    // And every frame advances by strictly less than a whole snapshot's worth: that is
    // what "subdivided" means, and it is the half a stepping renderer fails.
    //
    // Deliberately not asserted: that the steps are all the *same* size. They alternate
    // in a 1:2 ratio, and that is correct. {SERVER_TICK_HZ} / {SNAPSHOT_HZ} is 1.5, so
    // consecutive snapshots are one tick apart and then two, alternating -- the stream
    // itself is unevenly spaced in simulation time, and interpolating it faithfully
    // reproduces that. A test demanding uniform steps would be asserting that the
    // interpolator lies about what the server sent.
    const biggestSnapshotStep = Math.max(
      ...snapshots.slice(from + 1, to + 1).map((snap, i) => {
        const here = snap.players.find((p) => p.id === moverId)?.p ?? [0, 0, 0];
        const before = snapshots[from + i]!.players.find((p) => p.id === moverId)?.p ?? [
          0, 0, 0,
        ];
        return Math.sqrt((here[0] - before[0]) ** 2 + (here[2] - before[2]) ** 2);
      }),
    );
    expect(Math.max(...steps)).toBeLessThan(biggestSnapshotStep * 0.4);
  });

  it('draws a player who has stopped as completely still', async () => {
    harness = await startServer();
    const mover = await joinedClient(harness.url, 'mover');
    const watcher = await joinedClient(harness.url, 'watcher');
    const moverId = (
      mover.received.find((m): m is JoinedMessage => m.t === 'joined') as JoinedMessage
    ).playerId;

    // Send nothing at all: NET-004a gives a silent player the neutral input, so they are
    // standing on the floor with no intent -- exactly the "hands off the keyboard" case.
    await watcher.waitFor('snapshot', () => snapshotsOf(watcher).length >= 20);

    const snapshots = snapshotsOf(watcher);
    const frames = render(snapshots, moverId);
    const steps = stepsBetween(frames, 0, Number.POSITIVE_INFINITY);
    expect(steps.length).toBeGreaterThan(20);

    // Exactly zero, not nearly zero. A capsule that shivers while its player is not
    // touching the keyboard is interpolating against a jittering clock, and no amount of
    // smoothing elsewhere hides it.
    expect(steps.every((s) => s === 0)).toBe(true);
  });
});
