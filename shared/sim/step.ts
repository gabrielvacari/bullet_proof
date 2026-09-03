import {
  MAGAZINE_SIZE,
  PLAYER_MAX_HEALTH,
  AIR_CONTROL,
  CROUCH_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  SPRINT_FORWARD_MIN_DOT,
  SPRINT_SPEED,
  TICK_DURATION_S,
  WALK_SPEED,
} from '#shared/constants/index.ts';
import type { GameMap } from '#shared/map/types.ts';
import { type Vec3, add, horizontal, normalise, scale, sub } from '#shared/math/vec3.ts';

import { canStand, capsuleHeight, moveAndCollide } from './collide.ts';
import type { PlayerInput, PlayerState } from './types.ts';

/**
 * Advances one player by exactly one fixed tick.
 *
 * The contract this must satisfy is in specs/000-m0-walking-box/contracts/sim-api.md:
 * pure, deterministic, clock-free, randomness-free, exact arithmetic only, and total for
 * any input that passed validateInput. From M1 this same function runs inside the server's
 * tick loop and inside the client's prediction buffer -- there is no second implementation.
 *
 * There is deliberately no `dt` parameter. The timestep is TICK_DURATION_S, a constant
 * (NET-004a).
 */
/**
 * A player at the start of a life: full health, full magazine, nothing pending.
 *
 * Respawn restores exactly this (FR-GP-037, FR-GP-032), and so does joining, so the two
 * cannot drift apart. Written as a factory rather than a frozen constant because
 * `pos` differs every time and the rest must not be shared between players.
 */
export function spawnedPlayer(pos: Vec3): PlayerState {
  return {
    pos,
    vel: [0, 0, 0],
    grounded: false,
    crouching: false,
    health: PLAYER_MAX_HEALTH,
    magazine: MAGAZINE_SIZE,
    fireCooldown: 0,
    reloadTicks: 0,
    respawnTicks: 0,
  };
}

export function step(state: PlayerState, input: PlayerInput, map: GameMap): PlayerState {
  const crouching = resolveCrouch(state, input, map);
  const height = capsuleHeight(crouching);

  const horizontalVel = horizontalVelocity(state, input, crouching);
  const velocity: Vec3 = [
    horizontalVel[0],
    verticalVelocity(state, input, crouching),
    horizontalVel[2],
  ];

  const collided = moveAndCollide(state.pos, velocity, height, map, TICK_DURATION_S);

  return {
    // Combat state passes through untouched. The weapon state machine joins step() in
    // Phase 3; until then movement must not quietly reset a magazine or a countdown.
    ...state,
    pos: collided.pos,
    vel: collided.vel,
    grounded: collided.grounded,
    crouching,
  };
}

/**
 * Crouching is sticky under a ceiling: releasing the key in a gap shorter than
 * PLAYER_HEIGHT leaves the player crouched. Without that, standing up would teleport the
 * collision box into geometry. This is collision correctness, not a game rule.
 */
function resolveCrouch(state: PlayerState, input: PlayerInput, map: GameMap): boolean {
  if (input.crouch) return true;
  if (!state.crouching) return false;
  return !canStand(state.pos, map);
}

function verticalVelocity(
  state: PlayerState,
  input: PlayerInput,
  crouching: boolean,
): number {
  // Crouch and jump are mutually exclusive -- FR-GP-018, D-016.
  if (input.jump && state.grounded && !crouching) return JUMP_VELOCITY;
  return state.vel[1] + GRAVITY * TICK_DURATION_S;
}

/**
 * Movement intent is camera-relative (FR-GP-015): `move.x` strafes, `move.z` goes forward.
 * The basis comes from the aim vector, never from an angle -- ADR-0001.
 */
function horizontalVelocity(
  state: PlayerState,
  input: PlayerInput,
  crouching: boolean,
): Vec3 {
  const forward = normalise(horizontal(input.dir));
  const right: Vec3 = [-forward[2], 0, forward[0]];

  const direction = add(scale(right, input.move[0]), scale(forward, input.move[2]));
  const target = scale(direction, groundSpeed(input, crouching));

  // On the ground, velocity follows intent immediately -- that is what makes movement
  // feel instant (SC-3). In the air, only AIR_CONTROL of the difference is applied.
  if (state.grounded) return target;

  const current = horizontal(state.vel);
  return add(current, scale(sub(target, current), AIR_CONTROL));
}

/**
 * Sprint applies to forward-dominant movement only (FR-GP-016, D-017), tested as a dot
 * product against local forward rather than an angle, so no trigonometry is needed.
 * A crouched player never sprints.
 */
function groundSpeed(input: PlayerInput, crouching: boolean): number {
  if (crouching) return CROUCH_SPEED;
  if (!input.sprint) return WALK_SPEED;

  const forwardness = normalise(input.move)[2];
  return forwardness >= SPRINT_FORWARD_MIN_DOT ? SPRINT_SPEED : WALK_SPEED;
}
