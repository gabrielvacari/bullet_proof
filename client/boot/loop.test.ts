import { describe, expect, it } from 'vitest';

import { MAX_SUBSTEPS_PER_FRAME, TICK_DURATION_S } from '#shared/constants/index.ts';

import { advance } from './loop.ts';

describe('advance', () => {
  it('runs no substep until a full tick has accumulated', () => {
    const result = advance(0, TICK_DURATION_S / 2);
    expect(result.substeps).toBe(0);
    expect(result.alpha).toBeCloseTo(0.5, 12);
  });

  it('runs exactly one substep for exactly one tick', () => {
    const result = advance(0, TICK_DURATION_S);
    expect(result.substeps).toBe(1);
    expect(result.accumulator).toBeCloseTo(0, 12);
    expect(result.alpha).toBeCloseTo(0, 12);
  });

  it('carries the remainder into the next frame as the interpolation alpha', () => {
    const result = advance(0, TICK_DURATION_S * 2.5);
    expect(result.substeps).toBe(2);
    expect(result.alpha).toBeCloseTo(0.5, 12);
  });

  it('accumulates across frames rather than dropping partial ticks', () => {
    const first = advance(0, TICK_DURATION_S * 0.6);
    expect(first.substeps).toBe(0);
    const second = advance(first.accumulator, TICK_DURATION_S * 0.6);
    expect(second.substeps).toBe(1);
  });

  it('caps substeps and discards the surplus after a stall', () => {
    // Without the cap, a stall queues hundreds of ticks and the page freezes trying to
    // catch up -- each slow frame adding more debt than it clears.
    const result = advance(0, TICK_DURATION_S * 500);
    expect(result.substeps).toBe(MAX_SUBSTEPS_PER_FRAME);
    expect(result.accumulator).toBe(0);
    expect(result.alpha).toBe(0);
  });

  it('keeps the remainder when the cap is reached without leftover debt', () => {
    const result = advance(0, TICK_DURATION_S * (MAX_SUBSTEPS_PER_FRAME + 0.5));
    expect(result.substeps).toBe(MAX_SUBSTEPS_PER_FRAME);
    expect(result.alpha).toBeCloseTo(0.5, 12);
  });

  it.each([
    ['a negative frame time', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('treats %s as no time passing', (_label, elapsed) => {
    const result = advance(0, elapsed);
    expect(result.substeps).toBe(0);
    expect(result.accumulator).toBe(0);
  });

  it('is frame-rate independent — M0-11', () => {
    // The same wall-clock second must produce the same number of simulation ticks
    // regardless of how it is divided into frames.
    const ticksOver = (frames: number): number => {
      const frameTime = 1 / frames;
      let accumulator = 0;
      let total = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        const result = advance(accumulator, frameTime);
        accumulator = result.accumulator;
        total += result.substeps;
      }
      return total;
    };

    /*
     * Within one tick, not exactly equal. Accumulating 1/60 sixty times does not land
     * on exactly 1.0 in IEEE 754, so a one-tick difference over a wall-clock second is
     * inherent to any float accumulator. It is also harmless: it bounds the discrepancy
     * at a single tick of movement, and from M1 the server is authoritative anyway.
     * The exactness that NFR-004 demands is of step() given identical inputs, which is
     * a separate guarantee and is exact.
     */
    expect(Math.abs(ticksOver(30) - ticksOver(60))).toBeLessThanOrEqual(1);
    expect(Math.abs(ticksOver(60) - ticksOver(144))).toBeLessThanOrEqual(1);
    expect(ticksOver(144)).toBeGreaterThanOrEqual(29);
  });
});
