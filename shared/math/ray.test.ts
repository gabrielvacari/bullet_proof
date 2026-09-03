import { describe, expect, it } from 'vitest';

import type { Aabb } from '#shared/map/types.ts';

import { rayAabb, rayCapsule, raySphere } from './ray.ts';
import type { Vec3 } from './vec3.ts';

/**
 * shared/math is held at 100%, and this is the file that decides whether a shot hit.
 * Every branch below is a case someone could get wrong and not notice until a player
 * reported being shot through a wall.
 */

const BOX: Aabb = { min: [-1, -1, -1], max: [1, 1, 1] };
const FAR = 100;

describe('rayAabb', () => {
  it('returns the near face for a clean hit', () => {
    expect(rayAabb([0, 0, -5], [0, 0, 1], BOX, FAR)).toBe(4);
  });

  it('misses a box it is aimed past', () => {
    expect(rayAabb([5, 5, -5], [0, 0, 1], BOX, FAR)).toBeNull();
  });

  it('returns zero from inside, rather than the far wall', () => {
    expect(rayAabb([0, 0, 0], [0, 0, 1], BOX, FAR)).toBe(0);
  });

  it('misses a box entirely behind the origin', () => {
    expect(rayAabb([0, 0, 5], [0, 0, 1], BOX, FAR)).toBeNull();
  });

  it('misses when parallel to a slab it starts outside', () => {
    // Zero X component, and X = 5 is outside the box's X slab: it can never enter.
    expect(rayAabb([5, 0, -5], [0, 0, 1], BOX, FAR)).toBeNull();
  });

  it('hits when parallel to slabs it starts inside', () => {
    // Zero X and Y components, both already within their slabs.
    expect(rayAabb([0, 0, -5], [0, 0, 1], BOX, FAR)).toBe(4);
  });

  it('accepts a hit exactly at the range limit, and rejects one just past it', () => {
    expect(rayAabb([0, 0, -5], [0, 0, 1], BOX, 4)).toBe(4);
    expect(rayAabb([0, 0, -5], [0, 0, 1], BOX, 3.999)).toBeNull();
  });

  it('hits when aimed along a negative axis', () => {
    // Entry and exit come out of the slab maths in the wrong order when the direction
    // component is negative, and have to be swapped. Every other case here aims along a
    // positive axis and never reaches that branch.
    expect(rayAabb([0, 0, 5], [0, 0, -1], BOX, FAR)).toBe(4);
    expect(rayAabb([5, 0, 0], [-1, 0, 0], BOX, FAR)).toBe(4);
  });

  it('misses when parallel to a slab it starts below', () => {
    // The mirror of the case above: outside the X slab on the low side.
    expect(rayAabb([-5, 0, -5], [0, 0, 1], BOX, FAR)).toBeNull();
  });

  it('grazes a corner without falling through the near > far test', () => {
    // Aimed exactly along the box's edge at x = 1.
    expect(rayAabb([1, 0, -5], [0, 0, 1], BOX, FAR)).toBe(4);
  });
});

describe('raySphere', () => {
  const CENTRE: Vec3 = [0, 0, 0];

  it('returns the near surface for a clean hit', () => {
    expect(raySphere([0, 0, -5], [0, 0, 1], CENTRE, 1, FAR)).toBe(4);
  });

  it('misses a sphere it is aimed past', () => {
    expect(raySphere([0, 5, -5], [0, 0, 1], CENTRE, 1, FAR)).toBeNull();
  });

  it('counts an exact tangent as a hit', () => {
    // Discriminant is exactly zero: one root, touching the surface.
    expect(raySphere([0, 1, -5], [0, 0, 1], CENTRE, 1, FAR)).toBe(5);
  });

  it('returns zero from inside, whatever the range allows', () => {
    expect(raySphere(CENTRE, [0, 0, 1], CENTRE, 1, FAR)).toBe(0);
    // Even a range too short to reach the exit: the ray already touches the volume.
    expect(raySphere(CENTRE, [0, 0, 1], CENTRE, 1, 0.5)).toBe(0);
  });

  it('misses a sphere entirely behind the origin', () => {
    expect(raySphere([0, 0, 5], [0, 0, 1], CENTRE, 1, FAR)).toBeNull();
  });

  it('treats a zero-length direction as the point it starts at', () => {
    expect(raySphere(CENTRE, [0, 0, 0], CENTRE, 1, FAR)).toBe(0);
    expect(raySphere([0, 0, 5], [0, 0, 0], CENTRE, 1, FAR)).toBeNull();
  });

  it('accepts a hit exactly at the range limit, and rejects one just past it', () => {
    expect(raySphere([0, 0, -5], [0, 0, 1], CENTRE, 1, 4)).toBe(4);
    expect(raySphere([0, 0, -5], [0, 0, 1], CENTRE, 1, 3.999)).toBeNull();
  });
});

describe('rayCapsule', () => {
  const A: Vec3 = [0, 0, 0];
  const B: Vec3 = [0, 2, 0];
  const R = 0.5;

  it('hits the cylinder wall side on', () => {
    expect(rayCapsule([-5, 1, 0], [1, 0, 0], A, B, R, FAR)).toBe(4.5);
  });

  it('hits the end cap from above', () => {
    expect(rayCapsule([0, 5, 0], [0, -1, 0], A, B, R, FAR)).toBe(2.5);
  });

  it('misses a capsule it passes over', () => {
    expect(rayCapsule([-5, 5, 0], [1, 0, 0], A, B, R, FAR)).toBeNull();
  });

  it('does not hit the cylinder beyond the segment ends', () => {
    // Level with the axis line but well above B: only the cap could catch it, and at
    // this radius it does not.
    expect(rayCapsule([-5, 4, 0], [1, 0, 0], A, B, R, FAR)).toBeNull();
  });

  it('returns zero from inside, rather than the wall on the way out', () => {
    expect(rayCapsule([0, 1, 0], [1, 0, 0], A, B, R, FAR)).toBe(0);
  });

  it('finds the near cap when running parallel to the axis', () => {
    // Parallel to the axis: no cylinder crossing exists, so a cap must answer.
    expect(rayCapsule([0, -5, 0], [0, 1, 0], A, B, R, FAR)).toBe(4.5);
  });

  it('misses when parallel to the axis and outside the radius', () => {
    expect(rayCapsule([5, -5, 0], [0, 1, 0], A, B, R, FAR)).toBeNull();
  });

  it('treats a degenerate segment as a sphere', () => {
    expect(rayCapsule([-5, 0, 0], [1, 0, 0], A, A, R, FAR)).toBe(4.5);
  });

  it('misses a capsule entirely behind the origin', () => {
    expect(rayCapsule([5, 1, 0], [1, 0, 0], A, B, R, FAR)).toBeNull();
  });

  it('accepts a hit exactly at the range limit, and rejects one just past it', () => {
    expect(rayCapsule([-5, 1, 0], [1, 0, 0], A, B, R, 4.5)).toBe(4.5);
    expect(rayCapsule([-5, 1, 0], [1, 0, 0], A, B, R, 4.499)).toBeNull();
  });

  it('takes the nearer of two candidate surfaces', () => {
    // Aimed at the seam where the cap and the cylinder meet: both produce a root, and
    // the nearer one must win.
    const t = rayCapsule([-5, 2, 0], [1, 0, 0], A, B, R, FAR);
    expect(t).toBe(4.5);
  });
});
