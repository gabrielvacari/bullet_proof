import { describe, expect, it } from 'vitest';

import { AIM_DIR_Y_MAX, AIM_DIR_Y_MIN } from '#shared/constants/index.ts';

import { validateInput } from './validate.ts';

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    move: [0, 0, 1],
    dir: [0, 0, -1],
    jump: false,
    crouch: false,
    sprint: false,
    ...overrides,
  };
}

describe('accepts well-formed input', () => {
  it('returns the parsed input', () => {
    const result = validateInput(valid());
    expect(result).toEqual({
      move: [0, 0, 1],
      dir: [0, 0, -1],
      jump: false,
      crouch: false,
      sprint: false,
    });
  });

  it('accepts a zero movement vector — standing still is valid intent', () => {
    expect(validateInput(valid({ move: [0, 0, 0] }))).not.toBeNull();
  });

  it('accepts a normalised diagonal', () => {
    const s = Math.SQRT1_2;
    expect(validateInput(valid({ move: [s, 0, s] }))).not.toBeNull();
  });

  it('accepts aim at the exact pitch limits', () => {
    const up = Math.sqrt(1 - AIM_DIR_Y_MAX ** 2);
    const down = Math.sqrt(1 - AIM_DIR_Y_MIN ** 2);
    expect(validateInput(valid({ dir: [0, AIM_DIR_Y_MAX, -up] }))).not.toBeNull();
    expect(validateInput(valid({ dir: [0, AIM_DIR_Y_MIN, -down] }))).not.toBeNull();
  });
});

describe('rejects the wrong shape', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'input'],
    ['an array', [1, 2, 3]],
  ])('rejects %s', (_label, value) => {
    expect(validateInput(value)).toBeNull();
  });

  it.each(['move', 'dir', 'jump', 'crouch', 'sprint'])('rejects a missing %s', (key) => {
    const input = Object.fromEntries(
      Object.entries(valid()).filter(([name]) => name !== key),
    );
    expect(validateInput(input)).toBeNull();
  });

  it('rejects extra fields — a client that has drifted, or smuggled state', () => {
    expect(validateInput(valid({ dt: 999_999 }))).toBeNull();
    expect(validateInput(valid({ pos: [0, 0, 0] }))).toBeNull();
  });

  it('rejects a field of the right name but the wrong type', () => {
    expect(validateInput(valid({ jump: 'yes' }))).toBeNull();
    expect(validateInput(valid({ crouch: 1 }))).toBeNull();
    expect(validateInput(valid({ sprint: null }))).toBeNull();
  });
});

describe('rejects malformed vectors', () => {
  it('rejects a vector that is not three numbers', () => {
    expect(validateInput(valid({ move: [0, 0] }))).toBeNull();
    expect(validateInput(valid({ move: [0, 0, 1, 1] }))).toBeNull();
    expect(validateInput(valid({ dir: 'forward' }))).toBeNull();
    expect(validateInput(valid({ dir: { x: 0, y: 0, z: -1 } }))).toBeNull();
  });

  it('rejects a non-numeric component in any position', () => {
    expect(validateInput(valid({ move: ['0', 0, 1] }))).toBeNull();
    expect(validateInput(valid({ move: [0, '0', 1] }))).toBeNull();
    expect(validateInput(valid({ move: [0, 0, '1'] }))).toBeNull();
  });

  it('rejects NaN and infinite components — NFR-011', () => {
    expect(validateInput(valid({ dir: [Number.NaN, 0, -1] }))).toBeNull();
    expect(validateInput(valid({ move: [Number.POSITIVE_INFINITY, 0, 0] }))).toBeNull();
    expect(validateInput(valid({ move: [0, 0, Number.NEGATIVE_INFINITY] }))).toBeNull();
  });
});

describe('rejects inputs that would buy an advantage', () => {
  it('rejects a movement vector longer than 1', () => {
    expect(validateInput(valid({ move: [10, 0, 0] }))).toBeNull();
    expect(validateInput(valid({ move: [1, 0, 1] }))).toBeNull();
  });

  it('rejects vertical movement intent — that is what jump is for', () => {
    expect(validateInput(valid({ move: [0, 1, 0] }))).toBeNull();
    expect(validateInput(valid({ move: [0, -0.5, 0] }))).toBeNull();
  });

  it('rejects a non-unit aim vector rather than normalising it — NET-004c', () => {
    expect(validateInput(valid({ dir: [0, 0, -5] }))).toBeNull();
    expect(validateInput(valid({ dir: [0, 0, -0.2] }))).toBeNull();
    expect(validateInput(valid({ dir: [0, 0, 0] }))).toBeNull();
  });

  it('rejects aim outside the pitch cone — FR-GP-019', () => {
    expect(validateInput(valid({ dir: [0, 1, 0] }))).toBeNull();
    expect(validateInput(valid({ dir: [0, -1, 0] }))).toBeNull();
  });
});
