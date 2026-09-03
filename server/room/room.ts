import {
  MAX_PLAYERS_PER_ROOM,
  MAX_QUEUED_INPUTS,
  SERVER_TICK_HZ,
  SNAPSHOT_INTERVAL_MS,
  TICK_DURATION_MS,
} from '#shared/constants/index.ts';
import type { GameMap } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';
import { encode } from '#shared/protocol/encode.ts';
import { inputFromKeys, neutralInput } from '#shared/protocol/keys.ts';
import type {
  ErrorCode,
  InputMessage,
  JoinMessage,
  ServerMessage,
  SnapshotPlayer,
} from '#shared/protocol/types.ts';
import { spawnedPlayer, step } from '#shared/sim/step.ts';
import type { PlayerState } from '#shared/sim/types.ts';

import { clientConfig, serialisePlayer } from './serialise.ts';

/**
 * One match, in memory (NFR-002), and the only thing in the process that may advance the
 * simulation (NFR-001).
 *
 * `tick()` is the sole caller of `step()`. No message handler moves a player: the tempting
 * optimisation, once someone notices an input arriving mid-tick, is to apply it
 * immediately, and that turns send rate into movement speed.
 *
 * The room holds no global state and reaches for none. M1 creates exactly one, but
 * NFR-015 is about the second one never being able to observe the first, and that is a
 * property of the shape rather than of the count.
 */

/** What a room needs of a socket. Deliberately smaller than `Connection`. */
export interface Sink {
  send(text: string): void;
}

export interface ServerPlayer {
  readonly id: string;
  readonly nickname: string;
  state: PlayerState;
  /** Last validated aim. Feeds the neutral input and the snapshot's y/pt. */
  lastDir: Vec3;
  /** Becomes this recipient's `ack` (NFR-007). */
  lastSeq: number;
  queue: InputMessage[];
  readonly sink: Sink;
}

export type JoinOutcome =
  | { readonly ok: true; readonly player: ServerPlayer }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

export interface Room {
  readonly id: string;
  readonly mapId: string;
  join(connectionId: string, message: JoinMessage, sink: Sink): JoinOutcome;
  leave(playerId: string): void;
  enqueue(playerId: string, input: InputMessage): void;
  tick(): void;
  readonly playerCount: number;
  /** For the entry point's logging and for tests. Never used to mutate. */
  player(playerId: string): ServerPlayer | undefined;
}

export function createRoom(id: string, map: GameMap): Room {
  const players = new Map<string, ServerPlayer>();
  let tickCount = 0;
  let sinceSnapshotMs = 0;

  const spawn = map.spawns[0];
  if (spawn === undefined) throw new Error(`map ${map.id} has no spawn point`);

  /**
   * NFR-015. A failing player must not stop the room, and a room must not stop the
   * process. A socket can die between the tick starting and a broadcast reaching it, and
   * `step()` runs on input that arrived over a wire -- neither is allowed to take the
   * match down with it. The player is dropped rather than left in an unknown state.
   */
  const guard = (player: ServerPlayer, action: () => void): void => {
    try {
      action();
    } catch {
      players.delete(player.id);
      announce({ t: 'playerLeft', id: player.id });
    }
  };

  const announce = (message: ServerMessage): void => {
    const text = encode(message);
    for (const player of [...players.values()]) {
      guard(player, () => {
        player.sink.send(text);
      });
    }
  };

  const removePlayer = (playerId: string): void => {
    if (!players.delete(playerId)) return;
    // Removed from the table before the broadcast, so no snapshot serialised afterwards
    // can contain them. FR-GP-040: no ghost body, and no orphaned input queue.
    announce({ t: 'playerLeft', id: playerId });
  };

  function advance(player: ServerPlayer): void {
    const queued = player.queue.shift();
    const input =
      queued === undefined
        ? neutralInput(player.lastDir)
        : inputFromKeys(queued.keys, queued.dir);

    if (queued !== undefined) {
      player.lastDir = queued.dir;
      player.lastSeq = queued.seq;
    }

    player.state = step(player.state, input, map).state;
  }

  /**
   * Serialised per recipient, because `ack` is the last input applied for *that* client
   * (NET-009). It is also the seam NET-009's owner-only `am` will use in M2.
   *
   * Every living player is included regardless of line of sight (NET-009a, FR-GP-049):
   * concealment is a rendering property, and the wallhack that follows is D-006's
   * documented, accepted trade-off.
   */
  function broadcastSnapshot(): void {
    const serialised: SnapshotPlayer[] = [];
    for (const player of players.values()) {
      serialised.push(serialisePlayer(player.id, player.state, player.lastDir));
    }

    for (const player of [...players.values()]) {
      guard(player, () => {
        player.sink.send(
          encode({
            t: 'snapshot',
            tick: tickCount,
            ack: player.lastSeq,
            players: serialised,
          }),
        );
      });
    }
  }

  return {
    id,
    mapId: map.id,

    get playerCount() {
      return players.size;
    },

    player(playerId) {
      return players.get(playerId);
    },

    join(connectionId, message, sink) {
      if (players.size >= MAX_PLAYERS_PER_ROOM) {
        return { ok: false, code: 'ROOM_FULL', message: 'This room is full.' };
      }

      const playerId = `p_${connectionId}`;
      const player: ServerPlayer = {
        id: playerId,
        nickname: message.nickname,
        state: spawnedPlayer(spawn.pos),
        lastDir: forwardFrom(spawn.yaw),
        lastSeq: 0,
        queue: [],
        sink,
      };

      // Announced to everyone already here, before the new player joins the table, so
      // nobody receives their own arrival (NET-010).
      announce({
        t: 'playerJoined',
        id: playerId,
        nickname: player.nickname,
        team: null,
      });
      players.set(playerId, player);

      sink.send(
        encode({
          t: 'joined',
          playerId,
          roomId: id,
          mode: 'FFA',
          team: null,
          mapId: map.id,
          tickRate: SERVER_TICK_HZ,
          config: clientConfig(),
          spawn: { pos: spawn.pos, yaw: spawn.yaw },
        }),
      );

      // And everyone already here, so the newcomer's first frame is not an empty arena
      // (FR-GP-014). Nicknames arrive this way and never in the snapshot (NET-009b).
      for (const other of players.values()) {
        if (other.id === playerId) continue;
        sink.send(
          encode({
            t: 'playerJoined',
            id: other.id,
            nickname: other.nickname,
            team: null,
          }),
        );
      }

      return { ok: true, player };
    },

    leave(playerId) {
      removePlayer(playerId);
    },

    /**
     * NET-004a. Inputs arriving faster than the tick are queued, up to MAX_QUEUED_INPUTS;
     * beyond that the oldest are dropped.
     */
    enqueue(playerId, input) {
      const player = players.get(playerId);
      if (player === undefined) return;

      player.queue.push(input);
      if (player.queue.length > MAX_QUEUED_INPUTS) {
        player.queue = player.queue.slice(-MAX_QUEUED_INPUTS);
      }
    },

    tick() {
      tickCount += 1;

      for (const player of [...players.values()]) {
        guard(player, () => {
          advance(player);
        });
      }

      sinceSnapshotMs += TICK_DURATION_MS;
      if (sinceSnapshotMs < SNAPSHOT_INTERVAL_MS) return;
      sinceSnapshotMs -= SNAPSHOT_INTERVAL_MS;

      broadcastSnapshot();
    },
  };
}

/**
 * The aim vector a spawn's authored yaw implies.
 *
 * Trigonometry, and it belongs here rather than in `shared/`: this is a starting
 * orientation the server hands out once. The client is told the same yaw in `joined`, so
 * both sides begin from the same state without either recomputing the other's, and no
 * value derived here is ever integrated by the simulation (ADR-0001).
 */
function forwardFrom(yaw: number): Vec3 {
  return [-Math.sin(yaw), 0, -Math.cos(yaw)];
}
