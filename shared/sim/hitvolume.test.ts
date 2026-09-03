import { describe, expect, it } from 'vitest';

import {
  CROUCH_HEIGHT,
  HEAD_CENTRE_FRACTION,
  HEAD_RADIUS_FRACTION,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
} from '#shared/constants/index.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

import { hitVolumes } from './hitvolume.ts';
import type { HitRegion, HitVolume } from './types.ts';

const ORIGIN: Vec3 = [0, 0, 0];

function byRegion(volumes: readonly HitVolume[], region: HitRegion): HitVolume {
  const found = volumes.find((v) => v.region === region);
  if (found === undefined) throw new Error(`no ${region} volume`);
  return found;
}

/** The lowest and highest points the volume occupies, caps included. */
function extent(volume: HitVolume): readonly [number, number] {
  return [
    Math.min(volume.a[1], volume.b[1]) - volume.radius,
    Math.max(volume.a[1], volume.b[1]) + volume.radius,
  ];
}

describe('hitVolumes', () => {
  it('returns exactly the three regions of FR-GP-027', () => {
    expect(hitVolumes(ORIGIN, false).map((v) => v.region)).toEqual([
      'HEAD',
      'TORSO',
      'LEGS',
    ]);
  });

  it('scales every dimension with the stance', () => {
    const standing = hitVolumes(ORIGIN, false);
    const crouched = hitVolumes(ORIGIN, true);

    for (const region of ['HEAD', 'TORSO', 'LEGS'] as const) {
      const tall = byRegion(standing, region);
      const short = byRegion(crouched, region);
      // Same fractions, smaller height: everything shrinks in proportion.
      expect(short.radius).toBeCloseTo((tall.radius / PLAYER_HEIGHT) * CROUCH_HEIGHT, 12);
      expect(short.a[1]).toBeCloseTo((tall.a[1] / PLAYER_HEIGHT) * CROUCH_HEIGHT, 12);
    }
  });

  it('drops the head with the body when crouching -- FR-GP-018', () => {
    // This is what makes crouch tactical rather than a pure downside: behind
    // CROUCH_HEIGHT cover, the head is genuinely harder to hit.
    const standingHead = byRegion(hitVolumes(ORIGIN, false), 'HEAD');
    const crouchedHead = byRegion(hitVolumes(ORIGIN, true), 'HEAD');
    expect(crouchedHead.a[1]).toBeLessThan(standingHead.a[1]);
    expect(crouchedHead.radius).toBeLessThan(standingHead.radius);
  });

  it('follows the player rather than sitting at the origin', () => {
    const moved = hitVolumes([10, 5, -3], false);
    const head = byRegion(moved, 'HEAD');
    expect(head.a[0]).toBe(10);
    expect(head.a[2]).toBe(-3);
    expect(head.a[1]).toBe(5 + HEAD_CENTRE_FRACTION * PLAYER_HEIGHT);
  });

  it('builds the head as a sphere -- coincident capsule ends', () => {
    const head = byRegion(hitVolumes(ORIGIN, false), 'HEAD');
    expect(head.a).toEqual(head.b);
    expect(head.radius).toBe(HEAD_RADIUS_FRACTION * PLAYER_HEIGHT);
  });

  describe('invariant 1 -- nothing protrudes past the movement box', () => {
    /**
     * A radius beyond PLAYER_RADIUS would let a hit volume stick out further than the
     * box the player collides with, and a player flush against a wall could then be shot
     * through it. Checked in both stances, since only the taller one is obvious.
     */
    it.each([
      ['standing', false],
      ['crouched', true],
    ])('holds while %s', (_label, crouching) => {
      for (const volume of hitVolumes(ORIGIN, crouching)) {
        expect(volume.radius).toBeLessThanOrEqual(PLAYER_RADIUS);
      }
    });
  });

  describe('invariant 2 -- no unhittable band', () => {
    it.each([
      ['standing', false, PLAYER_HEIGHT],
      ['crouched', true, CROUCH_HEIGHT],
    ])('covers floor to crown while %s', (_label, crouching, height) => {
      const volumes = hitVolumes(ORIGIN, crouching);
      const [legLow, legHigh] = extent(byRegion(volumes, 'LEGS'));
      const [torsoLow, torsoHigh] = extent(byRegion(volumes, 'TORSO'));
      const [headLow, headHigh] = extent(byRegion(volumes, 'HEAD'));

      // The legs reach the floor, and the head reaches the top of the capsule.
      expect(legLow).toBeLessThanOrEqual(0);
      expect(headHigh).toBeGreaterThanOrEqual(height - 1e-9);

      // And each region overlaps the next, so a ray cannot pass between them.
      expect(torsoLow).toBeLessThanOrEqual(legHigh);
      expect(headLow).toBeLessThanOrEqual(torsoHigh);
    });
  });

  describe('C16 -- a pure function of (pos, crouching) and nothing else', () => {
    it('gives an identical result for identical arguments', () => {
      expect(hitVolumes([1, 2, 3], false)).toEqual(hitVolumes([1, 2, 3], false));
      expect(hitVolumes([1, 2, 3], true)).toEqual(hitVolumes([1, 2, 3], true));
    });

    it('does not mutate the position it was given', () => {
      const pos: Vec3 = Object.freeze([1, 2, 3]);
      expect(() => hitVolumes(pos, false)).not.toThrow();
      expect(pos).toEqual([1, 2, 3]);
    });
  });
});
