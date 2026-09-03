import {
  CAMERA_OFFSET,
  EYE_HEIGHT,
  MAGAZINE_SIZE,
  PLAYER_MAX_HEALTH,
  RELOAD_TICKS,
  TICKS_PER_SHOT,
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
import type { PlayerInput, PlayerState, ShotIntent, StepResult } from './types.ts';

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

export function step(state: PlayerState, input: PlayerInput, map: GameMap): StepResult {
  // Rule 1, and it returns before anything else runs. A dead player simulates nothing:
  // no movement, no gravity, no fire, no reload -- only the respawn countdown advances
  // (C9, FR-GP-036). Letting movement run first would have a corpse slide and fall.
  if (state.health <= 0) return { state: deadTick(state), shot: null };

  const crouching = resolveCrouch(state, input, map);
  const height = capsuleHeight(crouching);

  const horizontalVel = horizontalVelocity(state, input, crouching);
  const velocity: Vec3 = [
    horizontalVel[0],
    verticalVelocity(state, input, crouching),
    horizontalVel[2],
  ];

  const collided = moveAndCollide(state.pos, velocity, height, map, TICK_DURATION_S);

  const moved: PlayerState = {
    ...state,
    pos: collided.pos,
    vel: collided.vel,
    grounded: collided.grounded,
    crouching,
  };

  return weaponTick(moved, input);
}

/**
 * Rule 1. The countdown, and the state half of a respawn.
 *
 * Position is deliberately not set here. Choosing where to reappear needs every living
 * enemy's position (FR-GP-038), and step() sees exactly one player by design (C8) -- so
 * the room places the player using selectSpawn on the same tick it observes this
 * transition. Restoring the rest here keeps "what a life starts with" in one place.
 */
function deadTick(state: PlayerState): PlayerState {
  const respawnTicks = state.respawnTicks - 1;
  if (respawnTicks > 0) return { ...state, respawnTicks };

  return {
    ...spawnedPlayer(state.pos),
    // Stance and footing are re-derived on the first live tick, but a corpse that was
    // crouched must not stand up inside a ceiling on the way back.
    crouching: state.crouching,
  };
}

/**
 * Rules 2 through 7, in order, once per tick after movement.
 *
 * The order is the contract's and is load-bearing: the countdowns tick before anything
 * reads them, a completed reload refills before the fire rule could see an empty
 * magazine, and firing is last so that every gate above it has already been applied.
 */
function weaponTick(state: PlayerState, input: PlayerInput): StepResult {
  // Rule 2. The reload countdown only -- the fire cooldown is spent further down.
  const reloadTicks = Math.max(0, state.reloadTicks - 1);
  let magazine = state.magazine;

  // Rule 3. A reload that has just finished refills, and does so before the fire rule
  // below can conclude the magazine is empty and start another one.
  const wasReloading = state.reloadTicks > 0;
  if (wasReloading && reloadTicks === 0) magazine = MAGAZINE_SIZE;

  /*
   * The fire cooldown is read *before* this tick is charged against it, and charged
   * afterwards. Decrementing first instead hands a fresh player a whole free tick --
   * their cooldown of zero becomes -1, and that credit survives into every later shot,
   * which is one extra round per burst.
   *
   * Flooring it at zero on a firing tick is the opposite mistake and a subtler one:
   * TICKS_PER_SHOT is 3.75, so a shot comes due when the cooldown is at -0.25 rather
   * than 0, and clamping that away costs a quarter tick every time. That is 7.5 rounds/s
   * while FIRE_RATE_RPS still reads 8 -- the SC-4 failure the fractional constant exists
   * to prevent (C12). Both were live while this was written; both are caught by the
   * cadence test.
   */
  const ready = state.fireCooldown <= 0;
  const spent = state.fireCooldown - 1;

  /*
   * The floor tracks whether the trigger is *held*, not whether a shot left this tick.
   *
   * Flooring on every non-firing tick loses the remainder on the tick immediately before
   * a shot is due -- the cooldown passes through -0.25 there -- and puts the rate
   * straight back to 7.5 rounds/s. Holding the trigger keeps the remainder; releasing it
   * drops the credit, so a player who has not fired for a minute cannot bank a minute of
   * shots and spend them at once.
   */
  const idle = {
    ...state,
    fireCooldown: input.fire ? spent : Math.max(0, spent),
    reloadTicks,
    magazine,
  };

  // Rule 4. A reload still running produces no shot, and the fire input neither cancels
  // nor restarts it -- holding the trigger through a reload is not a cancel gesture.
  if (reloadTicks > 0) return { state: idle, shot: null };

  // Rule 5. A full magazine does nothing at all, rather than a zero-length reload that
  // would still block firing for a tick.
  if (input.reload && magazine < MAGAZINE_SIZE) {
    return { state: { ...idle, reloadTicks: RELOAD_TICKS }, shot: null };
  }

  // Rule 6. Firing an empty magazine reloads instead of doing nothing, so a player who
  // never presses R is not permanently disarmed.
  if (input.fire && magazine === 0) {
    return { state: { ...idle, reloadTicks: RELOAD_TICKS }, shot: null };
  }

  // Rule 7. Excess fire requests need no discard branch: a client firing every tick
  // simply meets a cooldown that has not expired, so M2-7 holds by construction.
  if (!input.fire || !ready || magazine === 0) {
    return { state: idle, shot: null };
  }

  return {
    state: {
      ...idle,
      magazine: magazine - 1,
      // Added, never assigned. TICKS_PER_SHOT is 3.75, and assigning would discard the
      // remainder every shot -- 7.5 shots/s while FIRE_RATE_RPS said 8 (C12).
      fireCooldown: state.fireCooldown + TICKS_PER_SHOT - 1,
    },
    shot: shotFrom(idle, input),
  };
}

/**
 * The shot that left the barrel. Both origins are computed here so the server and the
 * client's prediction cannot derive them differently (NFR-003).
 */
function shotFrom(state: PlayerState, input: PlayerInput): ShotIntent {
  const eye: Vec3 = [state.pos[0], state.pos[1] + EYE_HEIGHT, state.pos[2]];
  return { eye, cameraEye: nominalCamera(state, input.dir), dir: input.dir };
}

/**
 * The **nominal** camera position -- ADR-0002.
 *
 * Camera collision (FR-GP-020) is excluded on purpose. An aim cast from the pulled-in
 * camera would make the aim point jump the instant a player backed into a wall, and
 * would drag a client/render concern into the authoritative path.
 *
 * CAMERA_OFFSET is expressed in the player's frame: right, up, and back along the aim.
 * Built from dir with arithmetic only, so no trigonometry enters the simulation.
 */
function nominalCamera(state: PlayerState, dir: Vec3): Vec3 {
  const forward = normalise(horizontal(dir));
  // Right-handed, Y up: right is forward rotated -90 degrees about Y, which is a swap
  // and a sign rather than a rotation matrix.
  const right: Vec3 = [-forward[2], 0, forward[0]];

  return [
    state.pos[0] + right[0] * CAMERA_OFFSET[0] + forward[0] * CAMERA_OFFSET[2],
    state.pos[1] + CAMERA_OFFSET[1],
    state.pos[2] + right[2] * CAMERA_OFFSET[0] + forward[2] * CAMERA_OFFSET[2],
  ];
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
