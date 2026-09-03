import { describe, expect, it } from 'vitest';

import type { Vec3 } from '#shared/math/vec3.ts';

import {
  KEY_BACK,
  KEY_CROUCH,
  KEY_FIRE,
  KEY_FORWARD,
  KEY_JUMP,
  KEY_LEFT,
  KEY_MASK_ALL,
  KEY_RELOAD,
  KEY_RIGHT,
  KEY_SPRINT,
  inputFromKeys,
  neutralInput,
} from './keys.ts';
import { STATE_CROUCHING, STATE_GROUNDED } from './types.ts';

const DIR: Vec3 = [0, 0, -1];

describe('inputFromKeys', () => {
  it('maps the four movement bits onto the strafe and forward axes', () => {
    expect(inputFromKeys(KEY_FORWARD, DIR).move).toEqual([0, 0, 1]);
    expect(inputFromKeys(KEY_BACK, DIR).move).toEqual([0, 0, -1]);
    expect(inputFromKeys(KEY_RIGHT, DIR).move).toEqual([1, 0, 0]);
    expect(inputFromKeys(KEY_LEFT, DIR).move).toEqual([-1, 0, 0]);
  });

  it('cancels opposing keys instead of preferring one', () => {
    expect(inputFromKeys(KEY_FORWARD | KEY_BACK, DIR).move).toEqual([0, 0, 0]);
    expect(inputFromKeys(KEY_LEFT | KEY_RIGHT, DIR).move).toEqual([0, 0, 0]);
  });

  it('normalises diagonals, so W+A is not faster than W', () => {
    const diagonal = inputFromKeys(KEY_FORWARD | KEY_LEFT, DIR).move;
    const straight = inputFromKeys(KEY_FORWARD, DIR).move;

    const lengthOf = (v: Vec3): number => Math.sqrt(v[0] * v[0] + v[2] * v[2]);
    expect(lengthOf(diagonal)).toBeCloseTo(lengthOf(straight), 15);
    expect(lengthOf(diagonal)).toBeCloseTo(1, 15);
  });

  it('never produces a vertical movement component', () => {
    for (let keys = 0; keys <= KEY_MASK_ALL; keys += 1) {
      expect(inputFromKeys(keys, DIR).move[1]).toBe(0);
    }
  });

  it('maps the three action bits', () => {
    expect(inputFromKeys(KEY_JUMP, DIR).jump).toBe(true);
    expect(inputFromKeys(KEY_SPRINT, DIR).sprint).toBe(true);
    expect(inputFromKeys(KEY_CROUCH, DIR).crouch).toBe(true);

    const none = inputFromKeys(0, DIR);
    expect(none.jump).toBe(false);
    expect(none.sprint).toBe(false);
    expect(none.crouch).toBe(false);
  });

  it('accepts and ignores fire and reload, which are M2 requests (NET-004b)', () => {
    expect(inputFromKeys(KEY_FIRE | KEY_RELOAD, DIR)).toEqual(inputFromKeys(0, DIR));
  });

  it('passes the aim vector through untouched -- it is already validated', () => {
    const dir: Vec3 = [0.6, 0, -0.8];
    expect(inputFromKeys(KEY_FORWARD, dir).dir).toBe(dir);
  });

  it('covers every defined bit in KEY_MASK_ALL and nothing beyond', () => {
    // 9 bits, so the mask is 2^9 - 1. Stated as an assertion rather than a comment so a
    // future bit cannot be added to the union without this failing.
    expect(KEY_MASK_ALL).toBe(511);
  });
});

describe('neutralInput', () => {
  it('is intent-free but keeps the aim direction', () => {
    const dir: Vec3 = [0, 0.5, -0.8660254037844386];
    expect(neutralInput(dir)).toEqual({
      move: [0, 0, 0],
      dir,
      jump: false,
      crouch: false,
      sprint: false,
    });
  });

  it('is not a repeat of a moving input -- a stalled player must stop', () => {
    const moving = inputFromKeys(KEY_FORWARD | KEY_SPRINT, DIR);
    expect(neutralInput(DIR).move).not.toEqual(moving.move);
    expect(neutralInput(DIR).sprint).toBe(false);
  });
});

describe('the NET-009 state bitmask', () => {
  /**
   * The positions are permanent. M1 sends these two; sprinting, reloading and dead join
   * them in the milestones that add the state they report, and nothing is renumbered.
   */
  it('pins grounded and crouching to their NET-009 bits', () => {
    expect(STATE_GROUNDED).toBe(1);
    expect(STATE_CROUCHING).toBe(2);
    expect(STATE_GROUNDED & STATE_CROUCHING).toBe(0);
  });
});
