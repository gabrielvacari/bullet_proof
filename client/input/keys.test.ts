import { describe, expect, it } from 'vitest';

import { length } from '#shared/math/vec3.ts';
import { validateInput } from '#shared/sim/validate.ts';

import { KEYS, inputFrom, movementFrom } from './keys.ts';

const FORWARD_DIR = [0, 0, -1] as const;

function held(...codes: string[]): ReadonlySet<string> {
  return new Set(codes);
}

describe('movementFrom', () => {
  it('is zero with nothing held', () => {
    expect(movementFrom(held())).toEqual([0, 0, 0]);
  });

  it('maps WASD to the camera-relative axes', () => {
    expect(movementFrom(held(KEYS.forward))).toEqual([0, 0, 1]);
    expect(movementFrom(held(KEYS.back))).toEqual([0, 0, -1]);
    expect(movementFrom(held(KEYS.right))).toEqual([1, 0, 0]);
    expect(movementFrom(held(KEYS.left))).toEqual([-1, 0, 0]);
  });

  it('cancels opposing keys instead of picking one', () => {
    expect(movementFrom(held(KEYS.forward, KEYS.back))).toEqual([0, 0, 0]);
    expect(movementFrom(held(KEYS.left, KEYS.right))).toEqual([0, 0, 0]);
  });

  it('normalises diagonals so W+A is not faster than W', () => {
    const diagonal = movementFrom(held(KEYS.forward, KEYS.right));
    expect(length(diagonal)).toBeCloseTo(1, 12);
    expect(length(movementFrom(held(KEYS.forward)))).toBeCloseTo(1, 12);
  });

  it('never produces a vertical component — that is what jump is for', () => {
    for (const combo of [
      [KEYS.forward],
      [KEYS.forward, KEYS.right],
      [KEYS.back, KEYS.left],
      [KEYS.jump, KEYS.forward],
    ]) {
      expect(movementFrom(held(...combo))[1]).toBe(0);
    }
  });
});

describe('inputFrom', () => {
  it('reads the action keys', () => {
    const input = inputFrom(held(KEYS.jump, KEYS.sprint[0], KEYS.crouch[0]), FORWARD_DIR);
    expect(input.jump).toBe(true);
    expect(input.sprint).toBe(true);
    expect(input.crouch).toBe(true);
  });

  it('accepts either the left or the right modifier', () => {
    expect(inputFrom(held(KEYS.sprint[1]), FORWARD_DIR).sprint).toBe(true);
    expect(inputFrom(held(KEYS.crouch[1]), FORWARD_DIR).crouch).toBe(true);
  });

  it('reports every action as false when nothing is held', () => {
    const input = inputFrom(held(), FORWARD_DIR);
    expect(input.jump).toBe(false);
    expect(input.crouch).toBe(false);
    expect(input.sprint).toBe(false);
  });

  /** Anything the keyboard can produce must survive the server's validator. */
  it('produces input the simulation validator accepts, for every key combination', () => {
    const codes = [
      KEYS.forward,
      KEYS.back,
      KEYS.left,
      KEYS.right,
      KEYS.jump,
      KEYS.sprint[0],
      KEYS.crouch[0],
    ];
    for (let mask = 0; mask < 1 << codes.length; mask += 1) {
      const combo = codes.filter((_, bit) => (mask & (1 << bit)) !== 0);
      const input = inputFrom(held(...combo), FORWARD_DIR);
      expect(validateInput({ ...input })).not.toBeNull();
    }
  });
});
