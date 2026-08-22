import { describe, expect, it } from 'vitest';

import {
  ZERO,
  add,
  clampLength,
  dot,
  horizontal,
  isFinite3,
  length,
  lengthSquared,
  lerp,
  normalise,
  scale,
  sub,
  type Vec3,
} from './vec3.ts';

describe('component arithmetic', () => {
  it('adds, subtracts and scales componentwise', () => {
    expect(add([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33]);
    expect(sub([10, 20, 30], [1, 2, 3])).toEqual([9, 18, 27]);
    expect(scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
  });

  it('does not mutate its arguments', () => {
    const a: Vec3 = [1, 2, 3];
    const b: Vec3 = [4, 5, 6];
    add(a, b);
    sub(a, b);
    scale(a, 3);
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([4, 5, 6]);
  });

  it('computes the dot product', () => {
    expect(dot([1, 0, 0], [0, 0, 1])).toBe(0);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(dot([0, 0, -1], [0, 0, -1])).toBe(1);
  });
});

describe('length', () => {
  it('computes squared length without a square root', () => {
    expect(lengthSquared([3, 0, 4])).toBe(25);
  });

  it('computes length as the square root of the sum', () => {
    expect(length([3, 0, 4])).toBe(5);
    expect(length(ZERO)).toBe(0);
  });
});

describe('normalise', () => {
  it('produces a unit vector', () => {
    expect(length(normalise([3, 0, 4]))).toBeCloseTo(1, 15);
    expect(normalise([5, 0, 0])).toEqual([1, 0, 0]);
  });

  it('returns zero for a zero-length vector instead of NaN', () => {
    // A NaN here would poison every subsequent tick of the simulation.
    expect(normalise(ZERO)).toEqual(ZERO);
    expect(isFinite3(normalise(ZERO))).toBe(true);
  });
});

describe('clampLength', () => {
  it('leaves a vector shorter than the limit untouched', () => {
    const v: Vec3 = [0.5, 0, 0];
    expect(clampLength(v, 1)).toBe(v);
  });

  it('leaves a vector exactly at the limit untouched', () => {
    const v: Vec3 = [1, 0, 0];
    expect(clampLength(v, 1)).toBe(v);
  });

  it('shortens a vector longer than the limit, preserving direction', () => {
    const clamped = clampLength([10, 0, 0], 1);
    expect(length(clamped)).toBeCloseTo(1, 15);
    expect(clamped[0]).toBeGreaterThan(0);
  });
});

describe('lerp', () => {
  it('returns the endpoints at t = 0 and t = 1', () => {
    expect(lerp([0, 0, 0], [10, 20, 30], 0)).toEqual([0, 0, 0]);
    expect(lerp([0, 0, 0], [10, 20, 30], 1)).toEqual([10, 20, 30]);
  });

  it('interpolates linearly in between', () => {
    expect(lerp([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });
});

describe('horizontal', () => {
  it('drops the Y component', () => {
    expect(horizontal([1, 99, 3])).toEqual([1, 0, 3]);
  });
});

describe('isFinite3', () => {
  it('accepts finite vectors', () => {
    expect(isFinite3([0, -1, 2.5])).toBe(true);
  });

  it('rejects NaN and infinities in any component', () => {
    expect(isFinite3([Number.NaN, 0, 0])).toBe(false);
    expect(isFinite3([0, Number.POSITIVE_INFINITY, 0])).toBe(false);
    expect(isFinite3([0, 0, Number.NEGATIVE_INFINITY])).toBe(false);
  });
});
