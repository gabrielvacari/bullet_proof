import { describe, expect, it } from 'vitest';

import {
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  DAMAGE_HEAD,
  DAMAGE_LEGS,
  DAMAGE_TORSO,
  FIRE_RATE_RPS,
  MAGAZINE_DURATION_S,
  MAGAZINE_SIZE,
  PLAYER_HEIGHT,
  PLAYER_MAX_HEALTH,
  SERVER_TICK_HZ,
  SHOTS_TO_KILL_HEAD,
  SHOTS_TO_KILL_LEGS,
  SHOTS_TO_KILL_TORSO,
  SNAPSHOT_HZ,
  SNAPSHOT_INTERVAL_MS,
  SPRINT_FORWARD_MIN_DOT,
  SPRINT_SPEED,
  TICK_DURATION_MS,
  TICK_DURATION_S,
  WALK_SPEED,
} from './index.ts';

/**
 * These assertions exist so that a constant cannot drift away from the meaning
 * 07-constants.md gives it. They are cheap, and they are the reason
 * `passWithNoTests` could be removed (Q-008).
 */
describe('derived constants', () => {
  it('derives tick duration from the tick rate rather than restating it', () => {
    expect(TICK_DURATION_S).toBe(1 / SERVER_TICK_HZ);
    expect(TICK_DURATION_MS).toBe(1000 / SERVER_TICK_HZ);
    expect(TICK_DURATION_MS).toBeCloseTo(33.33, 2);
  });

  it('derives the snapshot interval from the snapshot rate', () => {
    expect(SNAPSHOT_INTERVAL_MS).toBe(1000 / SNAPSHOT_HZ);
  });

  it('derives magazine duration from size and fire rate', () => {
    expect(MAGAZINE_DURATION_S).toBe(MAGAZINE_SIZE / FIRE_RATE_RPS);
    expect(MAGAZINE_DURATION_S).toBeCloseTo(3.75, 5);
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
