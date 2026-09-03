import {
  MAX_PENDING_INPUTS,
  RECONCILE_ERROR_DECAY_PER_TICK,
  RECONCILE_ERROR_EPSILON,
} from '#shared/constants/index.ts';
import type { GameMap } from '#shared/map/types.ts';
import { type Vec3, ZERO, lengthSquared, scale, sub } from '#shared/math/vec3.ts';
import { step } from '#shared/sim/step.ts';
import type { PlayerInput, PlayerState } from '#shared/sim/types.ts';

/**
 * Client-side prediction (NFR-006) and server reconciliation (NFR-007).
 *
 * Both are loops over `step()`. Nothing here re-implements movement, and nothing here
 * knows a socket exists -- which is what lets every case be a plain function call in a
 * test rather than a timing-dependent integration.
 *
 * There is no tolerance anywhere in this file, and that is deliberate. A tolerance exists
 * to absorb the float noise between two implementations of movement; this project has one,
 * running on arithmetic ECMA-262 pins down (ADR-0001), and JSON round-trips a double
 * without loss. So when both sides saw the same inputs the replay reproduces the
 * prediction *exactly*, and a test can assert equality instead of closeness. A tolerance
 * would have nothing to absorb and would hide real desync below its threshold.
 */

export interface PendingInput {
  readonly seq: number;
  readonly input: PlayerInput;
}

export interface Reconciliation {
  /** The server's state, replayed. Never blended with the client's (NFR-001). */
  readonly state: PlayerState;
  readonly pending: readonly PendingInput[];
  /** Render-side only, and never an input to a later predict (C5). */
  readonly error: Vec3;
}

/**
 * One predicted tick.
 *
 * This is `step`. It exists under another name so the call site reads as what it is, and
 * so there is one obvious place to look when prediction is suspected -- which will happen,
 * because prediction is what everything else gets blamed on.
 */
export function predict(
  state: PlayerState,
  input: PlayerInput,
  map: GameMap,
): PlayerState {
  return step(state, input, map).state;
}

/** Adds a sent input to the replay buffer, bounded so a dead connection cannot grow it. */
export function remember(
  pending: readonly PendingInput[],
  seq: number,
  input: PlayerInput,
): PendingInput[] {
  return [...pending, { seq, input }].slice(-MAX_PENDING_INPUTS);
}

/**
 * NFR-007: rewind to the authoritative state, replay everything the server has not yet
 * acknowledged.
 *
 * `current` is where the client had the player before this snapshot arrived, and the
 * returned `error` is the gap between that and where the replay puts them. It is added to the **rendered** position and decayed to nothing
 * over the following ticks, so a correction converges instead of teleporting. The
 * simulated state adopts the server's value immediately: smoothing it would mean every
 * later prediction started from a position the server never agreed to, and the error would
 * feed back into itself.
 */
export function reconcile(
  current: PlayerState,
  pending: readonly PendingInput[],
  authoritative: PlayerState,
  ack: number,
  map: GameMap,
): Reconciliation {
  const remaining = pending.filter((entry) => entry.seq > ack);

  let state = authoritative;
  for (const entry of remaining) state = step(state, entry.input, map).state;

  return { state, pending: remaining, error: sub(current.pos, state.pos) };
}

/** Shrinks the render-side correction toward zero, once per simulation tick. */
export function decayError(error: Vec3): Vec3 {
  const decayed = scale(error, RECONCILE_ERROR_DECAY_PER_TICK);
  return lengthSquared(decayed) < RECONCILE_ERROR_EPSILON * RECONCILE_ERROR_EPSILON
    ? ZERO
    : decayed;
}
