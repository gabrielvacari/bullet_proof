import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  AIR_CONTROL,
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

import { step } from './step.ts';
import type { PlayerInput, PlayerState } from './types.ts';

let map: GameMap;

beforeAll(() => {
  map = loadMap(JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')));
});

/** Open floor, far from every interior block. */
function resting(pos: Vec3 = [20, 0, 20]): PlayerState {
  return { pos, vel: [0, 0, 0], grounded: true, crouching: false };
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

    expect(() => step(state, command, frozenMap)).not.toThrow();
    expect(state).toEqual(resting());
    expect(command.move).toEqual([0, 0, 1]);
  });

  it('returns a new object rather than the one it was given', () => {
    const state = resting();
    expect(step(state, input(), map)).not.toBe(state);
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
          state = step(state, command, map);
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
    const a = step(state, command, map);
    for (let spin = 0; spin < 100_000; spin += 1) {
      /* burn time; a clock-reading simulation would drift here */
    }
    const b = step(state, command, map);
    expect(b).toStrictEqual(a);
  });
});

describe('FR-GP-015 — ground movement', () => {
  it('moves the player away from the camera when pressing forward', () => {
    const after = step(resting(), input({ move: [0, 0, 1] }), map);
    // dir is (0,0,-1), so forward intent must decrease Z.
    expect(after.pos[2]).toBeLessThan(20);
    expect(after.pos[0]).toBeCloseTo(20, 9);
  });

  it('moves at WALK_SPEED', () => {
    const after = step(resting(), input({ move: [0, 0, 1] }), map);
    expect(length(horizontal(after.vel))).toBeCloseTo(WALK_SPEED, 9);
  });

  it('is relative to where the camera points, not to the world', () => {
    const looking: Vec3 = [-1, 0, 0];
    const after = step(resting(), input({ move: [0, 0, 1], dir: looking }), map);
    expect(after.pos[0]).toBeLessThan(20);
    expect(after.pos[2]).toBeCloseTo(20, 9);
  });

  it('strafes perpendicular to the facing direction', () => {
    const after = step(resting(), input({ move: [1, 0, 0] }), map);
    expect(after.pos[0]).toBeGreaterThan(20);
    expect(after.pos[2]).toBeCloseTo(20, 9);
  });

  it('does not let a diagonal move faster than a straight one', () => {
    const straight = step(resting(), input({ move: [0, 0, 1] }), map);
    const s = Math.SQRT1_2;
    const diagonal = step(resting(), input({ move: [s, 0, s] }), map);
    expect(length(horizontal(diagonal.vel))).toBeCloseTo(
      length(horizontal(straight.vel)),
      9,
    );
  });

  it('stands still with no movement input', () => {
    const after = step(resting(), input(), map);
    expect(after.pos[0]).toBeCloseTo(20, 9);
    expect(after.pos[2]).toBeCloseTo(20, 9);
  });
});

describe('FR-GP-016 / D-017 — sprint', () => {
  it('applies SPRINT_SPEED to forward movement', () => {
    const after = step(resting(), input({ move: [0, 0, 1], sprint: true }), map);
    expect(length(horizontal(after.vel))).toBeCloseTo(SPRINT_SPEED, 9);
  });

  it('applies to a forward diagonal, which is within 45 degrees', () => {
    const s = Math.SQRT1_2;
    const after = step(resting(), input({ move: [s, 0, s], sprint: true }), map);
    expect(length(horizontal(after.vel))).toBeCloseTo(SPRINT_SPEED, 9);
  });

  it('does not apply to pure strafing', () => {
    const after = step(resting(), input({ move: [1, 0, 0], sprint: true }), map);
    expect(length(horizontal(after.vel))).toBeCloseTo(WALK_SPEED, 9);
  });

  it('does not apply to backpedalling', () => {
    const after = step(resting(), input({ move: [0, 0, -1], sprint: true }), map);
    expect(length(horizontal(after.vel))).toBeCloseTo(WALK_SPEED, 9);
  });

  it('does not apply while crouched — CROUCH_SPEED wins', () => {
    const after = step(
      resting(),
      input({ move: [0, 0, 1], sprint: true, crouch: true }),
      map,
    );
    expect(length(horizontal(after.vel))).toBeCloseTo(CROUCH_SPEED, 9);
  });
});

describe('capsule height follows the crouch state', () => {
  it('is CROUCH_HEIGHT while crouched and PLAYER_HEIGHT otherwise', () => {
    const crouched = step(resting(), input({ crouch: true }), map);
    expect(crouched.crouching).toBe(true);
    const standing = step(crouched, input(), map);
    expect(standing.crouching).toBe(false);
    // The heights themselves are derived, never stored.
    expect(CROUCH_HEIGHT).toBeLessThan(PLAYER_HEIGHT);
  });
});

describe('the fixed timestep is internal', () => {
  it('advances by exactly one tick per call, with no dt argument', () => {
    const after = step(resting(), input({ move: [0, 0, 1] }), map);
    const travelled = 20 - after.pos[2];
    expect(travelled).toBeCloseTo(WALK_SPEED * TICK_DURATION_S, 9);
    // NET-004a: there is no dt parameter to supply, so a client cannot inflate it.
    expect(step.length).toBe(3);
  });
});

describe('FR-GP-017 — jump and gravity', () => {
  it('leaves the ground with JUMP_VELOCITY', () => {
    const after = step(resting(), input({ jump: true }), map);
    expect(after.vel[1]).toBe(JUMP_VELOCITY);
    expect(after.pos[1]).toBeGreaterThan(0);
  });

  it('follows a ballistic arc and lands again', () => {
    let state = step(resting(), input({ jump: true }), map);
    let apex = state.pos[1];
    let ticks = 1;
    while (!state.grounded && ticks < 200) {
      state = step(state, input(), map);
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
    const airborne = step(resting(), input({ jump: true }), map);
    const again = step(airborne, input({ jump: true }), map);
    expect(again.vel[1]).toBeLessThan(JUMP_VELOCITY);
  });

  it('falls under gravity when walking off an edge', () => {
    // step-a's top is at 0.6; walking off it must start a fall.
    let state: PlayerState = {
      pos: [-15, 0.6, 0],
      vel: [0, 0, 0],
      grounded: true,
      crouching: false,
    };
    for (let tick = 0; tick < 40; tick += 1) {
      state = step(state, input({ move: [1, 0, 0] }), map);
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
      );
    }
    expect(state.pos[1]).toBeGreaterThanOrEqual(0.6 - 1e-6);
    // step-b's top is at 1.3, deliberately above a single jump from ground level.
    expect(state.pos[1]).toBeLessThan(1.3);
  });

  it('applies only AIR_CONTROL of the intended change while airborne', () => {
    const airborne = step(resting(), input({ jump: true }), map);
    expect(airborne.grounded).toBe(false);
    const steered = step(airborne, input({ move: [0, 0, 1] }), map);
    const speed = length(horizontal(steered.vel));
    expect(speed).toBeCloseTo(WALK_SPEED * AIR_CONTROL, 9);
    expect(speed).toBeLessThan(WALK_SPEED);
  });
});

describe('FR-GP-018 / D-016 — crouch and jump are mutually exclusive', () => {
  it('refuses to jump while crouched', () => {
    const after = step(resting(), input({ crouch: true, jump: true }), map);
    expect(after.crouching).toBe(true);
    expect(after.vel[1]).toBeLessThanOrEqual(0);
    expect(after.pos[1]).toBeCloseTo(0, 9);
  });

  it('refuses to stand up under a ceiling — collision correctness, not a game rule', () => {
    // Under the overhang, whose underside is exactly CROUCH_HEIGHT.
    const crouched: PlayerState = {
      pos: [14, 0, 14],
      vel: [0, 0, 0],
      grounded: true,
      crouching: true,
    };
    const released = step(crouched, input(), map);
    expect(released.crouching).toBe(true);
  });

  it('stands up again once clear of the ceiling', () => {
    const crouched: PlayerState = {
      pos: [20, 0, 20],
      vel: [0, 0, 0],
      grounded: true,
      crouching: true,
    };
    expect(step(crouched, input(), map).crouching).toBe(false);
  });
});
