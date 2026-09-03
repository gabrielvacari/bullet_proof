import { SNAPSHOT_BUFFER_SIZE } from '#shared/constants/index.ts';
import type { Vec3 } from '#shared/math/vec3.ts';
import type { SnapshotMessage, SnapshotPlayer } from '#shared/protocol/types.ts';

/**
 * NFR-008. Remote players are rendered {INTERPOLATION_DELAY} in the past, between the two
 * snapshots that bracket that moment, so motion arriving at SNAPSHOT_HZ is drawn
 * continuously rather than stepping twenty times a second.
 *
 * The timeline is **local arrival time**, not the server's tick. That choice is R6 in the
 * M1 research: a locally-sampled clock only moves forward, so playback is monotonic by
 * construction, and INTERPOLATION_DELAY -- two full snapshot intervals -- is the jitter
 * budget the constant exists to provide. Keying playback to the server's tick is better at
 * internet latencies and needs a clock-sync estimator and a smoothing constant that no
 * requirement asks for; it is where this should go if INTERPOLATION_DELAY ever has to
 * shrink.
 *
 * Nothing here reads a clock. `renderTimeMs` is a parameter, which is what makes every
 * case in the test file expressible.
 */

export interface SnapshotBufferEntry {
  readonly receivedAtMs: number;
  readonly tick: number;
  readonly players: readonly SnapshotPlayer[];
}

export interface SnapshotBuffer {
  readonly entries: readonly SnapshotBufferEntry[];
}

/** One remote player, ready to draw. */
export interface InterpolatedPlayer {
  readonly id: string;
  readonly pos: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  /** The NET-009 state bitmask, taken from the newer sample rather than blended. */
  readonly st: number;
}

export function emptyBuffer(): SnapshotBuffer {
  return { entries: [] };
}

/**
 * Adds a snapshot, dropping it if it is not newer than what is already held.
 *
 * TCP makes an out-of-order arrival nearly impossible, and "nearly" is not a reason to
 * leave the rendered world rewindable.
 */
export function push(
  buffer: SnapshotBuffer,
  snapshot: SnapshotMessage,
  receivedAtMs: number,
): SnapshotBuffer {
  const newest = buffer.entries.at(-1);
  if (newest !== undefined && snapshot.tick <= newest.tick) return buffer;

  const entries = [
    ...buffer.entries,
    { receivedAtMs, tick: snapshot.tick, players: snapshot.players },
  ];
  return { entries: entries.slice(-SNAPSHOT_BUFFER_SIZE) };
}

/**
 * Removes a player from every buffered snapshot (NET-011).
 *
 * Removing the model without this leaves the player's history in the buffer, and the next
 * sample brings the capsule back for as long as the buffer holds them. FR-GP-040 forbids
 * exactly that ghost, and this is the half of it that gets forgotten.
 */
export function forget(buffer: SnapshotBuffer, id: string): SnapshotBuffer {
  return {
    entries: buffer.entries.map((entry) => ({
      ...entry,
      players: entry.players.filter((player) => player.id !== id),
    })),
  };
}

/**
 * The state of every remote player at `renderTimeMs`, which the caller sets to
 * `now - INTERPOLATION_DELAY`.
 *
 * Outside the buffered range the nearest known state is **held**, never extrapolated:
 * guessing forward renders a position the server never reported and then corrects it. A
 * still capsule reads as a lagging player; a sliding one reads as a bug.
 */
export function sample(
  buffer: SnapshotBuffer,
  renderTimeMs: number,
): readonly InterpolatedPlayer[] {
  let previous: SnapshotBufferEntry | null = null;

  for (const entry of buffer.entries) {
    if (entry.receivedAtMs > renderTimeMs) {
      // Nothing older is buffered: the render time predates everything we have seen, so
      // there is no pair to blend and the earliest known state is held.
      if (previous === null) return hold(entry);

      // The loop guarantees previous.receivedAtMs <= renderTimeMs < entry.receivedAtMs,
      // so the span is strictly positive and needs no guard.
      const span = entry.receivedAtMs - previous.receivedAtMs;
      return blend(previous, entry, (renderTimeMs - previous.receivedAtMs) / span);
    }
    previous = entry;
  }

  // The buffer ran dry -- or was empty. Hold rather than extrapolate.
  return previous === null ? [] : hold(previous);
}

function hold(entry: SnapshotBufferEntry): readonly InterpolatedPlayer[] {
  return entry.players.map(present);
}

/**
 * The newer entry decides who exists. A player missing from it has left, and a player
 * missing from the older one has just arrived: the first is dropped rather than glided to
 * a halt, and the second is drawn where they are rather than slid in from the origin.
 */
function blend(
  before: SnapshotBufferEntry,
  after: SnapshotBufferEntry,
  alpha: number,
): readonly InterpolatedPlayer[] {
  const previous = new Map(before.players.map((player) => [player.id, player]));

  return after.players.map((player) => {
    const older = previous.get(player.id);
    if (older === undefined) return present(player);

    return {
      id: player.id,
      pos: mix(older.p, player.p, alpha),
      yaw: scalarMix(older.y, player.y, alpha),
      pitch: scalarMix(older.pt, player.pt, alpha),
      st: player.st,
    };
  });
}

function present(player: SnapshotPlayer): InterpolatedPlayer {
  return { id: player.id, pos: player.p, yaw: player.y, pitch: player.pt, st: player.st };
}

function mix(a: Vec3, b: Vec3, t: number): Vec3 {
  return [scalarMix(a[0], b[0], t), scalarMix(a[1], b[1], t), scalarMix(a[2], b[2], t)];
}

function scalarMix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
