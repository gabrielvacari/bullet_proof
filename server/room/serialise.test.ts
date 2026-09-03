import { describe, expect, it } from 'vitest';

import {
  AIR_CONTROL,
  GRAVITY,
  INTERPOLATION_DELAY,
  SERVER_TICK_HZ,
  SNAPSHOT_HZ,
  WALK_SPEED,
} from '#shared/constants/index.ts';
import type { Vec3 } from '#shared/math/vec3.ts';
import { STATE_CROUCHING, STATE_GROUNDED } from '#shared/protocol/types.ts';
import type { PlayerState } from '#shared/sim/types.ts';

import { clientConfig, pitchOf, serialisePlayer, stateBits, yawOf } from './serialise.ts';

/**
 * The one place in the project that turns a direction back into an angle.
 *
 * ADR-0001 bans trigonometry from shared/ because the simulation *integrates* its result.
 * Nothing here is integrated: these angles orient a model and are then forgotten, which is
 * exactly the exception the ADR names.
 */

const STANDING: PlayerState = {
  pos: [1, 2, 3],
  vel: [4, 5, 6],
  grounded: true,
  crouching: false,
};

/** The convention client/input/aim.ts produces: forward is -Z, yaw turns anticlockwise. */
function aim(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];
}

describe('yawOf and pitchOf', () => {
  it('recover the angles client/input/aim.ts started from', () => {
    for (const yaw of [0, 0.5, -0.5, 3, -3]) {
      for (const pitch of [0, 0.4, -0.4]) {
        const dir = aim(yaw, pitch);
        expect(yawOf(dir)).toBeCloseTo(yaw, 10);
        expect(pitchOf(dir)).toBeCloseTo(pitch, 10);
      }
    }
  });

  it('reads a level forward vector as zero yaw and zero pitch', () => {
    // Math.atan2(-0, 1) is -0, which JSON.stringify writes as 0, so it never reaches a
    // client as anything else. Asserted by value rather than by Object.is for that reason.
    expect(yawOf([0, 0, -1])).toBeCloseTo(0, 15);
    expect(pitchOf([0, 0, -1])).toBeCloseTo(0, 15);
  });

  /**
   * A unit vector can arrive with a vertical component a few ULPs past 1 after the
   * validator's clamp and renormalise. Math.asin would return NaN, which would then be
   * serialised into every client's snapshot.
   */
  it('survives a vertical component just outside [-1, 1]', () => {
    expect(pitchOf([0, 1.0000000000001, 0])).toBeCloseTo(Math.PI / 2, 10);
    expect(pitchOf([0, -1.0000000000001, 0])).toBeCloseTo(-Math.PI / 2, 10);
    expect(Number.isNaN(pitchOf([0, 2, 0]))).toBe(false);
  });
});

describe('stateBits (NET-009)', () => {
  it('reports grounded and crouching, and nothing M1 does not have', () => {
    expect(stateBits(STANDING)).toBe(STATE_GROUNDED);
    expect(stateBits({ ...STANDING, crouching: true })).toBe(
      STATE_GROUNDED | STATE_CROUCHING,
    );
    expect(stateBits({ ...STANDING, grounded: false })).toBe(0);
    expect(stateBits({ ...STANDING, grounded: false, crouching: true })).toBe(
      STATE_CROUCHING,
    );
  });
});

describe('serialisePlayer', () => {
  it('carries position, velocity, orientation and state', () => {
    const serialised = serialisePlayer('p_1', STANDING, [0, 0, -1]);
    expect(serialised.id).toBe('p_1');
    expect(serialised.p).toEqual([1, 2, 3]);
    expect(serialised.v).toEqual([4, 5, 6]);
    expect(serialised.y).toBeCloseTo(0, 15);
    expect(serialised.pt).toBeCloseTo(0, 15);
    expect(serialised.st).toBe(STATE_GROUNDED);
  });

  /** M2 adds these with the state they report; M1 has neither health nor ammo. */
  it('carries no health and no ammo', () => {
    const serialised = serialisePlayer('p_1', STANDING, [0, 0, -1]);
    expect(serialised).not.toHaveProperty('hp');
    expect(serialised).not.toHaveProperty('am');
  });
});

describe('clientConfig (NET-008a)', () => {
  it('sends the authoritative values, so a stale bundle cannot diverge silently', () => {
    const config = clientConfig();
    expect(config.serverTickHz).toBe(SERVER_TICK_HZ);
    expect(config.snapshotHz).toBe(SNAPSHOT_HZ);
    expect(config.interpolationDelay).toBe(INTERPOLATION_DELAY);
    expect(config.walkSpeed).toBe(WALK_SPEED);
    expect(config.gravity).toBe(GRAVITY);
    expect(config.airControl).toBe(AIR_CONTROL);
  });

  it('is entirely finite numbers, as its validator requires', () => {
    for (const value of Object.values(clientConfig())) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
