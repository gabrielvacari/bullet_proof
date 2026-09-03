import { describe, expect, it } from 'vitest';

import {
  AIM_CAST_RANGE,
  CAMERA_OFFSET,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  DAMAGE_HEAD,
  DAMAGE_LEGS,
  DAMAGE_TORSO,
  EYE_HEIGHT,
  FIRE_RATE_RPS,
  HEAD_CENTRE_FRACTION,
  HEAD_RADIUS_FRACTION,
  INTERPOLATION_DELAY,
  LEG_BOTTOM_FRACTION,
  LEG_RADIUS_FRACTION,
  LEG_TOP_FRACTION,
  MAGAZINE_DURATION_S,
  MAGAZINE_SIZE,
  MAX_INPUTS_PER_SECOND,
  MAX_PENDING_INPUTS,
  MIN_SPAWN_DISTANCE,
  MIN_SPAWN_DISTANCE_SQ,
  MS_PER_SECOND,
  PLAYER_HEIGHT,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  RELOAD_TICKS,
  RELOAD_TIME,
  RESPAWN_DELAY,
  RESPAWN_TICKS,
  SERVER_TICK_HZ,
  SHOTS_TO_KILL_HEAD,
  SHOTS_TO_KILL_LEGS,
  SHOTS_TO_KILL_TORSO,
  SNAPSHOT_BUFFER_SIZE,
  SNAPSHOT_HZ,
  SNAPSHOT_INTERVAL_MS,
  SPRINT_FORWARD_MIN_DOT,
  SPRINT_SPEED,
  TICK_DURATION_MS,
  TICK_DURATION_S,
  TICKS_PER_SHOT,
  TORSO_BOTTOM_FRACTION,
  TORSO_RADIUS_FRACTION,
  TORSO_TOP_FRACTION,
  WALK_SPEED,
  WEAPON_RANGE,
} from './index.ts';

/**
 * These assertions exist so that a constant cannot drift away from the meaning
 * 07-constants.md gives it. They are cheap, and they are the reason
 * `passWithNoTests` could be removed (Q-008).
 */
describe('derived constants', () => {
  it('derives tick duration from the tick rate rather than restating it', () => {
    expect(TICK_DURATION_S).toBe(1 / SERVER_TICK_HZ);
    expect(TICK_DURATION_MS).toBe(MS_PER_SECOND / SERVER_TICK_HZ);
    expect(TICK_DURATION_MS).toBeCloseTo(33.33, 2);
  });

  it('derives the snapshot interval from the snapshot rate', () => {
    expect(SNAPSHOT_INTERVAL_MS).toBe(MS_PER_SECOND / SNAPSHOT_HZ);
  });

  it('derives magazine duration from size and fire rate', () => {
    expect(MAGAZINE_DURATION_S).toBe(MAGAZINE_SIZE / FIRE_RATE_RPS);
    expect(MAGAZINE_DURATION_S).toBeCloseTo(3.75, 5);
  });

  it('sizes the replay buffer from the send rate, so it can never be too short', () => {
    expect(MAX_PENDING_INPUTS).toBe(MAX_INPUTS_PER_SECOND);
  });

  it('sizes the interpolation buffer to bracket INTERPOLATION_DELAY, plus jitter', () => {
    expect(SNAPSHOT_BUFFER_SIZE).toBe(
      Math.ceil(INTERPOLATION_DELAY / SNAPSHOT_INTERVAL_MS) + 2,
    );
    // Two snapshots are the minimum that can bracket any sample time at all.
    expect(SNAPSHOT_BUFFER_SIZE).toBeGreaterThan(2);
  });

  it('derives shots to kill, giving the 2 / 5 / 10 of FR-GP-026', () => {
    expect(SHOTS_TO_KILL_HEAD).toBe(2);
    expect(SHOTS_TO_KILL_TORSO).toBe(5);
    expect(SHOTS_TO_KILL_LEGS).toBe(10);
    expect(SHOTS_TO_KILL_HEAD).toBe(Math.ceil(PLAYER_MAX_HEALTH / DAMAGE_HEAD));
    expect(SHOTS_TO_KILL_TORSO).toBe(Math.ceil(PLAYER_MAX_HEALTH / DAMAGE_TORSO));
    expect(SHOTS_TO_KILL_LEGS).toBe(Math.ceil(PLAYER_MAX_HEALTH / DAMAGE_LEGS));
  });
});

describe('SPRINT_FORWARD_MIN_DOT', () => {
  /**
   * The constant is a hardcoded cosine because ADR-0001 bars Math.cos from shared/.
   * This test lives outside shared/ conceptually -- test files are exempt from that
   * rule -- so it can verify the literal really is cos(45 degrees) and would catch a
   * typo in the digits.
   */
  it('is exactly the cosine of 45 degrees', () => {
    expect(SPRINT_FORWARD_MIN_DOT).toBeCloseTo(Math.cos(Math.PI / 4), 15);
  });

  it('admits W+A and W+D but excludes pure strafing', () => {
    const invSqrt2 = 1 / Math.sqrt(2);
    // A diagonal forward input: dot with forward (0,0,1 in local terms) is 1/sqrt(2).
    expect(invSqrt2).toBeGreaterThanOrEqual(SPRINT_FORWARD_MIN_DOT - Number.EPSILON);
    // A pure strafe has zero forward component.
    expect(0).toBeLessThan(SPRINT_FORWARD_MIN_DOT);
  });
});

describe('movement constants stay mutually consistent', () => {
  it('orders the three speeds crouch < walk < sprint', () => {
    expect(CROUCH_SPEED).toBeLessThan(WALK_SPEED);
    expect(WALK_SPEED).toBeLessThan(SPRINT_SPEED);
  });

  it('keeps the crouched capsule shorter than the standing one', () => {
    expect(CROUCH_HEIGHT).toBeLessThan(PLAYER_HEIGHT);
  });
});

describe('M2 derived constants', () => {
  it('derives the fire interval from the rate, and keeps it fractional', () => {
    expect(TICKS_PER_SHOT).toBe(SERVER_TICK_HZ / FIRE_RATE_RPS);
    expect(TICKS_PER_SHOT).toBe(3.75);
    // Not an integer, on purpose. Rounding to 4 would give 7.5 shots/s while
    // FIRE_RATE_RPS said 8 -- the silent SC-4 failure the float exists to avoid.
    expect(Number.isInteger(TICKS_PER_SHOT)).toBe(false);
  });

  it('carries the fire cooldown remainder exactly, so the rate cannot drift', () => {
    // Every partial sum of 3.75 is exactly representable in IEEE 754 binary. Eight
    // shots must land on exactly one second's worth of ticks, with no residue at all.
    let cooldown = 0;
    for (let shot = 0; shot < FIRE_RATE_RPS; shot += 1) cooldown += TICKS_PER_SHOT;
    expect(cooldown).toBe(SERVER_TICK_HZ);
  });

  it('derives reload and respawn in whole ticks, rounding up', () => {
    expect(RELOAD_TICKS).toBe(Math.ceil(RELOAD_TIME / TICK_DURATION_MS));
    expect(RESPAWN_TICKS).toBe(Math.ceil(RESPAWN_DELAY / TICK_DURATION_MS));
    expect(RELOAD_TICKS).toBe(60);
    expect(RESPAWN_TICKS).toBe(90);
    // Whole numbers at the current values, and never short of the stated duration.
    expect(Number.isInteger(RELOAD_TICKS)).toBe(true);
    expect(Number.isInteger(RESPAWN_TICKS)).toBe(true);
    expect(RELOAD_TICKS * TICK_DURATION_MS).toBeGreaterThanOrEqual(RELOAD_TIME);
    expect(RESPAWN_TICKS * TICK_DURATION_MS).toBeGreaterThanOrEqual(RESPAWN_DELAY);
  });

  it('squares the spawn distance so selection needs no square root', () => {
    expect(MIN_SPAWN_DISTANCE_SQ).toBe(MIN_SPAWN_DISTANCE * MIN_SPAWN_DISTANCE);
    expect(MIN_SPAWN_DISTANCE_SQ).toBe(225);
  });

  it('runs the aim cast further than the weapon, by the camera-to-eye distance', () => {
    // ADR-0002: the aim cast starts at the nominal camera, behind the eye, so it must
    // run further to guarantee a focus point at least WEAPON_RANGE from the eye.
    const dx = CAMERA_OFFSET[0];
    const dy = CAMERA_OFFSET[1] - EYE_HEIGHT;
    const dz = CAMERA_OFFSET[2];
    expect(AIM_CAST_RANGE).toBe(WEAPON_RANGE + Math.sqrt(dx * dx + dy * dy + dz * dz));
    expect(AIM_CAST_RANGE).toBeGreaterThan(WEAPON_RANGE);
  });
});

describe('hit volume fractions', () => {
  /**
   * Invariant 1 from data-model.md. A radius that exceeded PLAYER_RADIUS would let a hit
   * volume protrude past the movement box, and a player flush against a wall could then
   * be shot through it. Checked against PLAYER_HEIGHT because that is the taller stance
   * and therefore the larger absolute radius.
   */
  it('keeps every radius inside the movement capsule, in the taller stance', () => {
    for (const fraction of [
      HEAD_RADIUS_FRACTION,
      TORSO_RADIUS_FRACTION,
      LEG_RADIUS_FRACTION,
    ]) {
      expect(fraction * PLAYER_HEIGHT).toBeLessThanOrEqual(PLAYER_RADIUS);
    }
  });

  /**
   * Invariant 2. The legs start at the floor, the torso starts where the legs end, and
   * the head sphere reaches the top of the capsule -- so there is no band of a player
   * that cannot be hit, and no overlap that would make one region shadow another.
   */
  it('stacks the three volumes contiguously from floor to crown', () => {
    expect(LEG_TOP_FRACTION).toBe(TORSO_BOTTOM_FRACTION);
    expect(TORSO_TOP_FRACTION).toBeLessThan(HEAD_CENTRE_FRACTION);
    // The head sphere must reach down to the torso's top, leaving no gap at the neck.
    //
    // Measured as a real length rather than asserted as exact equality. These are
    // decimal fractions, so 0.93 - 0.07 is 0.8600000000000001 rather than 0.86, and
    // demanding bit-exact contiguity would assert something IEEE 754 cannot deliver and
    // the requirement does not need. A sub-millimetre seam is not an unhittable band; a
    // seam a reader could see would fail this by four orders of magnitude.
    const neckGap = HEAD_CENTRE_FRACTION - HEAD_RADIUS_FRACTION - TORSO_TOP_FRACTION;
    expect(Math.abs(neckGap) * PLAYER_HEIGHT).toBeLessThan(0.001);
    // And it must reach the top of the capsule rather than stopping short.
    expect(HEAD_CENTRE_FRACTION + HEAD_RADIUS_FRACTION).toBe(1);
    // The legs start just above the floor, so a grazing shot still registers.
    expect(LEG_BOTTOM_FRACTION).toBeGreaterThan(0);
    expect(LEG_BOTTOM_FRACTION).toBeLessThan(LEG_TOP_FRACTION);
  });
});
