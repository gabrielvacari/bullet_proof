import {
  AIR_CONTROL,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  GRAVITY,
  INTERPOLATION_DELAY,
  JUMP_VELOCITY,
  MAX_INPUTS_PER_SECOND,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SERVER_TICK_HZ,
  SNAPSHOT_HZ,
  SPRINT_SPEED,
  WALK_SPEED,
} from '#shared/constants/index.ts';
import type { Vec3 } from '#shared/math/vec3.ts';
import {
  STATE_CROUCHING,
  STATE_GROUNDED,
  type ClientConfig,
  type SnapshotPlayer,
} from '#shared/protocol/types.ts';
import type { PlayerState } from '#shared/sim/types.ts';

/**
 * PlayerState -> the wire (NET-009).
 *
 * `y` and `pt` are derived here from the player's last validated aim vector, and this is
 * the only place in the project that turns a direction back into an angle.
 *
 * That is exactly what ADR-0001 permits: it bans trigonometry from `shared/` because a
 * value that differs in the last bits between two engines would be *integrated* by the
 * simulation and grow without bound. Nothing here is integrated. These angles are written
 * to the wire, used to orient a model, and forgotten -- they never enter `step()`, and
 * `shared/boundary.test.ts` would fail any attempt to move this function into `shared/`.
 */

export function serialisePlayer(
  id: string,
  state: PlayerState,
  dir: Vec3,
): SnapshotPlayer {
  return {
    id,
    p: state.pos,
    v: state.vel,
    y: yawOf(dir),
    pt: pitchOf(dir),
    st: stateBits(state),
  };
}

/**
 * Yaw from a direction, matching client/input/aim.ts's convention: forward is -Z, and yaw
 * increases anticlockwise about Y.
 */
export function yawOf(dir: Vec3): number {
  return Math.atan2(-dir[0], -dir[2]);
}

/** Pitch from a unit direction. The vertical component is already the sine of the angle. */
export function pitchOf(dir: Vec3): number {
  return Math.asin(clampUnit(dir[1]));
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/**
 * NET-009's `st`. M1 sends the two bits whose state exists; sprinting, reloading and dead
 * join them in the milestones that add what they report.
 */
export function stateBits(state: PlayerState): number {
  return (state.grounded ? STATE_GROUNDED : 0) | (state.crouching ? STATE_CROUCHING : 0);
}

/**
 * NET-008a. The tuning values the client needs in order to predict identically.
 *
 * Sending them is what stops a stale bundle from silently simulating a different game --
 * the failure it prevents is a client that looks fine and drifts, which is the hardest
 * kind of netcode bug to attribute.
 */
export function clientConfig(): ClientConfig {
  return {
    serverTickHz: SERVER_TICK_HZ,
    snapshotHz: SNAPSHOT_HZ,
    interpolationDelay: INTERPOLATION_DELAY,
    maxInputsPerSecond: MAX_INPUTS_PER_SECOND,
    playerHeight: PLAYER_HEIGHT,
    crouchHeight: CROUCH_HEIGHT,
    playerRadius: PLAYER_RADIUS,
    walkSpeed: WALK_SPEED,
    sprintSpeed: SPRINT_SPEED,
    crouchSpeed: CROUCH_SPEED,
    jumpVelocity: JUMP_VELOCITY,
    gravity: GRAVITY,
    airControl: AIR_CONTROL,
  };
}
