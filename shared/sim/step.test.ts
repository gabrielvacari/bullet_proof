import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  AIR_CONTROL,
  EYE_HEIGHT,
  FIRE_RATE_RPS,
  MAGAZINE_SIZE,
  PLAYER_MAX_HEALTH,
  RELOAD_TICKS,
  RESPAWN_TICKS,
  SERVER_TICK_HZ,
  TICKS_PER_SHOT,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_HEIGHT,
  SPRINT_SPEED,
  TICK_DURATION_S,
  WALK_SPEED,
} from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import type { GameMap } from '#shared/map/types.ts';
import { type Vec3, length, horizontal } from '#shared/math/vec3.ts';

import { spawnedPlayer, step } from './step.ts';
import type { PlayerInput, PlayerState } from './types.ts';

let map: GameMap;

beforeAll(() => {
  map = loadMap(JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')));
});

/** Open floor, far from every interior block. */
function resting(pos: Vec3 = [20, 0, 20]): PlayerState {
  return { ...spawnedPlayer(pos), grounded: true };
}

/** Looking down -Z, the Three.js default forward. */
const FORWARD: Vec3 = [0, 0, -1];

function input(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    move: [0, 0, 0],
    dir: FORWARD,
    jump: false,
    crouch: false,
    sprint: false,
    fire: false,
    reload: false,
    ...overrides,
  };
}

/** Freezes a value and everything reachable from it. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

describe('C1 — purity', () => {
  it('mutates neither state, input nor map', () => {
    const state = deepFreeze(resting());
    const command = deepFreeze(input({ move: [0, 0, 1], jump: true }));
    const frozenMap = deepFreeze(structuredClone(map));

    expect(() => step(state, command, frozenMap).state).not.toThrow();
    expect(state).toEqual(resting());
    expect(command.move).toEqual([0, 0, 1]);
  });

  it('returns a new object rather than the one it was given', () => {
    const state = resting();
    expect(step(state, input(), map).state).not.toBe(state);
  });
});

describe('C2 — determinism', () => {
  /**
   * The test the whole milestone exists for. Equality is asserted tick by tick, not just
   * on the final state: two runs that diverge and reconverge would pass an end-state
   * comparison and still be a prediction bug.
   */
  it('replays an input sequence to identical states, tick by tick', () => {
    const sequence: PlayerInput[] = [
      input({ move: [0, 0, 1] }),
      input({ move: [0, 0, 1], sprint: true }),
      input({ move: [0.6, 0, 0.8], sprint: true }),
      input({ jump: true }),
      input({ move: [0, 0, 1] }),
      input({ move: [-1, 0, 0] }),
      input({ crouch: true, move: [0, 0, 1] }),
      input({ move: [0, 0, -1] }),
      input({ dir: [0.5, -0.2, -0.842_614_977_317_635_9], move: [0, 0, 1] }),
      input({ move: [0, 0, 0] }),
    ];

    const run = (): PlayerState[] => {
      let state = resting();
      const trace: PlayerState[] = [];
      for (let repeat = 0; repeat < 6; repeat += 1) {
        for (const command of sequence) {
          state = step(state, command, map).state;
          trace.push(state);
        }
      }
      return trace;
    };

    const first = run();
    const second = run();
    expect(first).toHaveLength(second.length);
    for (let tick = 0; tick < first.length; tick += 1) {
      expect(second[tick]).toStrictEqual(first[tick]);
    }
  });

  it('is unaffected by wall-clock time between runs', () => {
    const state = resting();
    const command = input({ move: [0, 0, 1], sprint: true });
    const a = step(state, command, map).state;
    for (let spin = 0; spin < 100_000; spin += 1) {
      /* burn time; a clock-reading simulation would drift here */
    }
    const b = step(state, command, map).state;
    expect(b).toStrictEqual(a);
  });
});

describe('FR-GP-015 — ground movement', () => {
  it('moves the player away from the camera when pressing forward', () => {
    const after = step(resting(), input({ move: [0, 0, 1] }), map).state;
    // dir is (0,0,-1), so forward intent must decrease Z.
    expect(after.pos[2]).toBeLessThan(20);
    expect(after.pos[0]).toBeCloseTo(20, 9);
  });

  it('moves at WALK_SPEED', () => {
    const after = step(resting(), input({ move: [0, 0, 1] }), map).state;
    expect(length(horizontal(after.vel))).toBeCloseTo(WALK_SPEED, 9);
  });

  it('is relative to where the camera points, not to the world', () => {
    const looking: Vec3 = [-1, 0, 0];
    const after = step(resting(), input({ move: [0, 0, 1], dir: looking }), map).state;
    expect(after.pos[0]).toBeLessThan(20);
    expect(after.pos[2]).toBeCloseTo(20, 9);
  });

  it('strafes perpendicular to the facing direction', () => {
    const after = step(resting(), input({ move: [1, 0, 0] }), map).state;
    expect(after.pos[0]).toBeGreaterThan(20);
    expect(after.pos[2]).toBeCloseTo(20, 9);
  });

  it('does not let a diagonal move faster than a straight one', () => {
    const straight = step(resting(), input({ move: [0, 0, 1] }), map).state;
    const s = Math.SQRT1_2;
    const diagonal = step(resting(), input({ move: [s, 0, s] }), map).state;
    expect(length(horizontal(diagonal.vel))).toBeCloseTo(
      length(horizontal(straight.vel)),
      9,
    );
  });

  it('stands still with no movement input', () => {
    const after = step(resting(), input(), map).state;
    expect(after.pos[0]).toBeCloseTo(20, 9);
    expect(after.pos[2]).toBeCloseTo(20, 9);
  });
});

describe('FR-GP-016 / D-017 — sprint', () => {
  it('applies SPRINT_SPEED to forward movement', () => {
    const after = step(resting(), input({ move: [0, 0, 1], sprint: true }), map).state;
    expect(length(horizontal(after.vel))).toBeCloseTo(SPRINT_SPEED, 9);
  });

  it('applies to a forward diagonal, which is within 45 degrees', () => {
    const s = Math.SQRT1_2;
    const after = step(resting(), input({ move: [s, 0, s], sprint: true }), map).state;
    expect(length(horizontal(after.vel))).toBeCloseTo(SPRINT_SPEED, 9);
  });

  it('does not apply to pure strafing', () => {
    const after = step(resting(), input({ move: [1, 0, 0], sprint: true }), map).state;
    expect(length(horizontal(after.vel))).toBeCloseTo(WALK_SPEED, 9);
  });

  it('does not apply to backpedalling', () => {
    const after = step(resting(), input({ move: [0, 0, -1], sprint: true }), map).state;
    expect(length(horizontal(after.vel))).toBeCloseTo(WALK_SPEED, 9);
  });

  it('does not apply while crouched — CROUCH_SPEED wins', () => {
    const after = step(
      resting(),
      input({ move: [0, 0, 1], sprint: true, crouch: true }),
      map,
    ).state;
    expect(length(horizontal(after.vel))).toBeCloseTo(CROUCH_SPEED, 9);
  });
});

describe('capsule height follows the crouch state', () => {
  it('is CROUCH_HEIGHT while crouched and PLAYER_HEIGHT otherwise', () => {
    const crouched = step(resting(), input({ crouch: true }), map).state;
    expect(crouched.crouching).toBe(true);
    const standing = step(crouched, input(), map).state;
    expect(standing.crouching).toBe(false);
    // The heights themselves are derived, never stored.
    expect(CROUCH_HEIGHT).toBeLessThan(PLAYER_HEIGHT);
  });
});

describe('the fixed timestep is internal', () => {
  it('advances by exactly one tick per call, with no dt argument', () => {
    const after = step(resting(), input({ move: [0, 0, 1] }), map).state;
    const travelled = 20 - after.pos[2];
    expect(travelled).toBeCloseTo(WALK_SPEED * TICK_DURATION_S, 9);
    // NET-004a: there is no dt parameter to supply, so a client cannot inflate it.
    expect(step.length).toBe(3);
  });
});

describe('FR-GP-017 — jump and gravity', () => {
  it('leaves the ground with JUMP_VELOCITY', () => {
    const after = step(resting(), input({ jump: true }), map).state;
    expect(after.vel[1]).toBe(JUMP_VELOCITY);
    expect(after.pos[1]).toBeGreaterThan(0);
  });

  it('follows a ballistic arc and lands again', () => {
    let state = step(resting(), input({ jump: true }), map).state;
    let apex = state.pos[1];
    let ticks = 1;
    while (!state.grounded && ticks < 200) {
      state = step(state, input(), map).state;
      apex = Math.max(apex, state.pos[1]);
      ticks += 1;
    }
    expect(state.grounded).toBe(true);
    expect(state.pos[1]).toBeCloseTo(0, 9);

    /*
     * The continuous formula v^2 / 2g gives 0.9 m, but a discrete fixed-step integrator
     * overshoots it: the launch tick moves a full JUMP_VELOCITY * dt before any gravity
     * is applied. What matters is the gameplay consequence, asserted here -- the jump
     * clears step-a (0.6 m) and cannot reach step-b (1.3 m) from the ground.
     */
    const continuousApex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * -GRAVITY);
    expect(apex).toBeGreaterThan(continuousApex);
    expect(apex).toBeGreaterThan(0.6);
    expect(apex).toBeLessThan(1.3);
  });

  it('ignores a second jump while airborne', () => {
    const airborne = step(resting(), input({ jump: true }), map).state;
    const again = step(airborne, input({ jump: true }), map).state;
    expect(again.vel[1]).toBeLessThan(JUMP_VELOCITY);
  });

  it('falls under gravity when walking off an edge', () => {
    // step-a's top is at 0.6; walking off it must start a fall.
    let state: PlayerState = {
      ...spawnedPlayer([-15, 0.6, 0]),
      grounded: true,
    };
    for (let tick = 0; tick < 40; tick += 1) {
      state = step(state, input({ move: [1, 0, 0] }), map).state;
    }
    expect(state.pos[1]).toBeCloseTo(0, 6);
  });

  it('can jump onto a block, and cannot reach the higher one from the ground', () => {
    // step-a spans x -17..-13, z -2..2, top 0.6. Facing +Z so that forward intent
    // carries the player onto it.
    const facingPositiveZ: Vec3 = [0, 0, 1];
    let state = resting([-15, 0, -5]);
    for (let tick = 0; tick < 120; tick += 1) {
      state = step(
        state,
        input({ move: [0, 0, 1], dir: facingPositiveZ, jump: state.grounded }),
        map,
      ).state;
    }
    expect(state.pos[1]).toBeGreaterThanOrEqual(0.6 - 1e-6);
    // step-b's top is at 1.3, deliberately above a single jump from ground level.
    expect(state.pos[1]).toBeLessThan(1.3);
  });

  it('applies only AIR_CONTROL of the intended change while airborne', () => {
    const airborne = step(resting(), input({ jump: true }), map).state;
    expect(airborne.grounded).toBe(false);
    const steered = step(airborne, input({ move: [0, 0, 1] }), map).state;
    const speed = length(horizontal(steered.vel));
    expect(speed).toBeCloseTo(WALK_SPEED * AIR_CONTROL, 9);
    expect(speed).toBeLessThan(WALK_SPEED);
  });
});

describe('FR-GP-018 / D-016 — crouch and jump are mutually exclusive', () => {
  it('refuses to jump while crouched', () => {
    const after = step(resting(), input({ crouch: true, jump: true }), map).state;
    expect(after.crouching).toBe(true);
    expect(after.vel[1]).toBeLessThanOrEqual(0);
    expect(after.pos[1]).toBeCloseTo(0, 9);
  });

  it('refuses to stand up under a ceiling — collision correctness, not a game rule', () => {
    // Under the overhang, whose underside is exactly CROUCH_HEIGHT.
    const crouched: PlayerState = {
      ...spawnedPlayer([14, 0, 14]),
      grounded: true,
      crouching: true,
    };
    const released = step(crouched, input(), map).state;
    expect(released.crouching).toBe(true);
  });

  it('stands up again once clear of the ceiling', () => {
    const crouched: PlayerState = {
      ...spawnedPlayer([20, 0, 20]),
      grounded: true,
      crouching: true,
    };
    expect(step(crouched, input(), map).state.crouching).toBe(false);
  });
});

/* ------------------------------------------------- The weapon (US2) ---- */

/** Runs `ticks` ticks of the same input, collecting every shot that left the barrel. */
function run(
  from: PlayerState,
  command: PlayerInput,
  ticks: number,
): { state: PlayerState; shots: number } {
  let state = from;
  let shots = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    const result = step(state, command, map);
    state = result.state;
    if (result.shot !== null) shots += 1;
  }
  return { state, shots };
}

describe('fire cadence — FR-GP-029, M2-7', () => {
  it('fires at exactly FIRE_RATE_RPS over a long hold', () => {
    // Asserted as an average over 300 ticks, never as a single interval: the interval
    // is 3.75 ticks, so no two consecutive shots are the same number of ticks apart.
    const ticks = SERVER_TICK_HZ * 10;
    const held = { ...resting(), magazine: Number.MAX_SAFE_INTEGER };
    const { shots } = run(held, input({ fire: true }), ticks);
    expect(shots).toBe((ticks / SERVER_TICK_HZ) * FIRE_RATE_RPS);
  });

  it('gives a client firing every tick no more shots than the rate allows', () => {
    // M2-7. There is no discard branch: a client sending fire faster than the tick rate
    // simply meets a cooldown that has not expired.
    const ticks = SERVER_TICK_HZ * 4;
    const held = { ...resting(), magazine: Number.MAX_SAFE_INTEGER };
    const flooding = run(held, input({ fire: true }), ticks);
    expect(flooding.shots).toBe((ticks / SERVER_TICK_HZ) * FIRE_RATE_RPS);
  });

  it('accumulates the cooldown rather than assigning it', () => {
    // Assigning would discard the 0.75 remainder every shot and quietly give 7.5
    // shots/s while FIRE_RATE_RPS said 8 — the silent SC-4 failure.
    const first = step(resting(), input({ fire: true }), map);
    expect(first.shot).not.toBeNull();
    // A full shot's worth, less the tick the shot itself consumed.
    expect(first.state.fireCooldown).toBe(TICKS_PER_SHOT - 1);
  });

  it('emits the shot from the eye, carrying the aim it was given', () => {
    const shooter = resting([20, 0, 20]);
    const result = step(shooter, input({ fire: true }), map);
    expect(result.shot?.eye).toEqual([20, EYE_HEIGHT, 20]);
    expect(result.shot?.dir).toEqual(FORWARD);
    // ADR-0002: the aim cast starts at the nominal camera, which is not the eye.
    expect(result.shot?.cameraEye).not.toEqual(result.shot?.eye);
  });
});

describe('the magazine — FR-GP-030', () => {
  it('falls by exactly one per emitted shot, and never below zero', () => {
    // Counted over one magazine rather than over a fixed span: rule 6 reloads an empty
    // magazine on the next trigger pull, so a long hold deliberately fires far more
    // than MAGAZINE_SIZE rounds.
    let state = resting();
    let shots = 0;
    for (let tick = 0; tick < SERVER_TICK_HZ * 20 && state.magazine > 0; tick += 1) {
      const result = step(state, input({ fire: true }), map);
      state = result.state;
      if (result.shot !== null) shots += 1;
      expect(state.magazine).toBeGreaterThanOrEqual(0);
    }
    expect(shots).toBe(MAGAZINE_SIZE);
    expect(state.magazine).toBe(0);
  });

  it('cannot be permanently disarmed by any input sequence', () => {
    // Fire until empty, then keep holding fire: the empty magazine starts a reload and
    // the weapon comes back. A player who cannot ever shoot again is the failure here.
    const window = (RELOAD_TICKS + MAGAZINE_SIZE * 4) * 2;
    const first = run(resting(), input({ fire: true }), window);
    expect(first.shots).toBeGreaterThan(MAGAZINE_SIZE);

    // Still firing after that, which is the actual property. Asserting a non-empty
    // magazine at an arbitrary instant would be asserting a coincidence: with the
    // trigger held the magazine passes through zero on every cycle.
    const second = run(first.state, input({ fire: true }), window);
    expect(second.shots).toBeGreaterThan(MAGAZINE_SIZE);
  });
});

describe('reloading — FR-GP-031, M2-8', () => {
  it('starts a reload on request when the magazine is partial', () => {
    const partial = { ...resting(), magazine: MAGAZINE_SIZE - 1 };
    expect(step(partial, input({ reload: true }), map).state.reloadTicks).toBe(
      RELOAD_TICKS,
    );
  });

  it('does nothing at all on a full magazine — not a zero-length reload', () => {
    const full = resting();
    const after = step(full, input({ reload: true }), map).state;
    expect(after.reloadTicks).toBe(0);
    expect(after.magazine).toBe(MAGAZINE_SIZE);
  });

  it('starts a reload when fire is pressed on an empty magazine', () => {
    const empty = { ...resting(), magazine: 0 };
    const after = step(empty, input({ fire: true }), map);
    expect(after.shot).toBeNull();
    expect(after.state.reloadTicks).toBe(RELOAD_TICKS);
  });

  it('produces no shot while a reload runs', () => {
    const reloading = { ...resting(), reloadTicks: RELOAD_TICKS, magazine: 0 };
    const { shots } = run(reloading, input({ fire: true }), RELOAD_TICKS - 1);
    expect(shots).toBe(0);
  });

  it('is neither cancelled nor restarted by the fire input', () => {
    const reloading = { ...resting(), reloadTicks: RELOAD_TICKS, magazine: 0 };
    // One tick of held fire mid-reload must only advance the countdown.
    const after = step(reloading, input({ fire: true, reload: true }), map).state;
    expect(after.reloadTicks).toBe(RELOAD_TICKS - 1);
  });

  it('refills the magazine after exactly RELOAD_TICKS', () => {
    const empty = { ...resting(), magazine: 0, reloadTicks: RELOAD_TICKS };
    const justBefore = run(empty, input(), RELOAD_TICKS - 1);
    expect(justBefore.state.magazine).toBe(0);

    const onTime = step(justBefore.state, input(), map).state;
    expect(onTime.magazine).toBe(MAGAZINE_SIZE);
    expect(onTime.reloadTicks).toBe(0);
  });
});

describe('death and respawn — FR-GP-032, FR-GP-036, FR-GP-037, M2-9', () => {
  const dead = (): PlayerState => ({
    ...resting(),
    health: 0,
    respawnTicks: RESPAWN_TICKS,
  });

  it('ignores a dead player’s input entirely', () => {
    const everything = input({
      move: [0, 0, 1],
      jump: true,
      sprint: true,
      fire: true,
      reload: true,
    });
    const after = step(dead(), everything, map);
    expect(after.shot).toBeNull();
    expect(after.state.pos).toEqual(dead().pos);
    expect(after.state.vel).toEqual(dead().vel);
    expect(after.state.reloadTicks).toBe(0);
  });

  it('advances only the respawn countdown while dead', () => {
    const after = step(dead(), input({ fire: true }), map).state;
    expect(after.respawnTicks).toBe(RESPAWN_TICKS - 1);
    expect(after.health).toBe(0);
  });

  it('respawns with full health and a full magazine, nothing pending', () => {
    const almost = { ...dead(), respawnTicks: 1, magazine: 0 };
    const alive = step(almost, input(), map).state;
    expect(alive.health).toBe(PLAYER_MAX_HEALTH);
    expect(alive.magazine).toBe(MAGAZINE_SIZE);
    expect(alive.reloadTicks).toBe(0);
    expect(alive.fireCooldown).toBe(0);
    expect(alive.respawnTicks).toBe(0);
  });

  it('cancels an in-progress reload on death — FR-GP-032', () => {
    // The reload is cleared where death happens (applyDamage); step must not resume it.
    const killed = { ...resting(), health: 0, respawnTicks: RESPAWN_TICKS, magazine: 0 };
    const { state } = run(killed, input(), RESPAWN_TICKS - 1);
    expect(state.reloadTicks).toBe(0);
  });
});
