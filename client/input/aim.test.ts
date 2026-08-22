import { describe, expect, it } from 'vitest';

import {
  AIM_DIR_Y_MAX,
  AIM_DIR_Y_MIN,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  MOUSE_SENSITIVITY_DEFAULT,
} from '#shared/constants/index.ts';
import { length } from '#shared/math/vec3.ts';
import { validateInput } from '#shared/sim/validate.ts';

import { INITIAL_AIM, aimDirection, applyMouseDelta } from './aim.ts';

describe('applyMouseDelta', () => {
  it('turns left for a positive X delta and right for a negative one', () => {
    expect(applyMouseDelta(INITIAL_AIM, 100, 0).yaw).toBeLessThan(0);
    expect(applyMouseDelta(INITIAL_AIM, -100, 0).yaw).toBeGreaterThan(0);
  });

  it('scales rotation by the sensitivity constant', () => {
    const after = applyMouseDelta(INITIAL_AIM, 10, 0);
    expect(after.yaw).toBeCloseTo(-10 * MOUSE_SENSITIVITY_DEFAULT, 12);
  });

  it('clamps pitch so the view never flips over — FR-GP-019', () => {
    expect(applyMouseDelta(INITIAL_AIM, 0, -100_000).pitch).toBe(CAMERA_PITCH_MAX);
    expect(applyMouseDelta(INITIAL_AIM, 0, 100_000).pitch).toBe(CAMERA_PITCH_MIN);
  });

  it('ignores a non-finite delta rather than poisoning the aim', () => {
    expect(applyMouseDelta(INITIAL_AIM, Number.NaN, 0)).toEqual(INITIAL_AIM);
    expect(applyMouseDelta(INITIAL_AIM, 0, Number.POSITIVE_INFINITY)).toEqual(
      INITIAL_AIM,
    );
  });

  it('does not mutate the aim it is given', () => {
    const aim = { yaw: 1, pitch: 0.2 };
    applyMouseDelta(aim, 50, 50);
    expect(aim).toEqual({ yaw: 1, pitch: 0.2 });
  });
});

describe('aimDirection', () => {
  it('faces -Z at rest, matching the renderer default', () => {
    const dir = aimDirection(INITIAL_AIM);
    expect(dir[0]).toBeCloseTo(0, 12);
    expect(dir[1]).toBeCloseTo(0, 12);
    expect(dir[2]).toBeCloseTo(-1, 12);
  });

  it('always produces a unit vector', () => {
    for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.37) {
      for (let pitch = CAMERA_PITCH_MIN; pitch <= CAMERA_PITCH_MAX; pitch += 0.19) {
        expect(length(aimDirection({ yaw, pitch }))).toBeCloseTo(1, 12);
      }
    }
  });

  /**
   * The contract between this module and the simulation: whatever the client produces
   * must survive the server's validator. If this ever fails, honest input would be
   * rejected as if it were an attack.
   */
  it('produces a vector the simulation validator accepts, at every reachable aim', () => {
    for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.29) {
      for (let pitch = CAMERA_PITCH_MIN; pitch <= CAMERA_PITCH_MAX; pitch += 0.13) {
        const dir = aimDirection({ yaw, pitch });
        const accepted = validateInput({
          move: [0, 0, 0],
          dir,
          jump: false,
          crouch: false,
          sprint: false,
        });
        expect(accepted).not.toBeNull();
      }
    }
  });

  it('stays inside the vertical cone the constants describe', () => {
    expect(aimDirection({ yaw: 0, pitch: CAMERA_PITCH_MAX })[1]).toBeCloseTo(
      AIM_DIR_Y_MAX,
      12,
    );
    expect(aimDirection({ yaw: 0, pitch: CAMERA_PITCH_MIN })[1]).toBeCloseTo(
      AIM_DIR_Y_MIN,
      12,
    );
  });
});
