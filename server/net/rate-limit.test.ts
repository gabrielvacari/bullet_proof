import { describe, expect, it } from 'vitest';

import {
  MAX_INPUTS_PER_SECOND,
  MS_PER_SECOND,
  SERVER_TICK_HZ,
} from '#shared/constants/index.ts';

import { createBucket, take } from './rate-limit.ts';

/**
 * NFR-010, over an injected clock. Every assertion here would otherwise need a real
 * second, which is why a rate limiter that reads its own clock is a rate limiter nobody
 * ends up testing.
 */

/** Takes `count` tokens starting at `nowMs`, all in the same instant. */
function burst(count: number, nowMs = 0): { allowed: number; refused: number } {
  let bucket = createBucket(nowMs);
  let allowed = 0;
  let refused = 0;

  for (let i = 0; i < count; i += 1) {
    const result = take(bucket, nowMs);
    bucket = result.bucket;
    if (result.allowed) allowed += 1;
    else refused += 1;
  }
  return { allowed, refused };
}

describe('take', () => {
  it('allows a burst up to the bucket size', () => {
    expect(burst(MAX_INPUTS_PER_SECOND)).toEqual({
      allowed: MAX_INPUTS_PER_SECOND,
      refused: 0,
    });
  });

  it('refuses everything beyond it', () => {
    const { allowed, refused } = burst(MAX_INPUTS_PER_SECOND * 10);
    expect(allowed).toBe(MAX_INPUTS_PER_SECOND);
    expect(refused).toBe(MAX_INPUTS_PER_SECOND * 9);
  });

  it('refills at MAX_INPUTS_PER_SECOND per second', () => {
    let bucket = createBucket(0);
    for (let i = 0; i < MAX_INPUTS_PER_SECOND; i += 1) bucket = take(bucket, 0).bucket;

    expect(take(bucket, 0).allowed).toBe(false);
    // Half a second buys back half a bucket.
    expect(take(bucket, MS_PER_SECOND / 2).allowed).toBe(true);
  });

  it('never refills past its capacity, however long the client is idle', () => {
    let bucket = createBucket(0);
    for (let i = 0; i < MAX_INPUTS_PER_SECOND; i += 1) bucket = take(bucket, 0).bucket;

    // A minute of silence buys back a full bucket and not one token more, so idling
    // cannot be saved up into a flood.
    const idleFor = MS_PER_SECOND * 60;
    const { allowed, refused } = takeMany(bucket, MAX_INPUTS_PER_SECOND * 2, idleFor);
    expect(allowed).toBe(MAX_INPUTS_PER_SECOND);
    expect(refused).toBe(MAX_INPUTS_PER_SECOND);
  });

  /**
   * An honest client sends one input per simulation tick (research.md R3, gate OQ-A). It
   * must never be throttled, and the headroom must be visible in the test rather than
   * inferred from the constants.
   */
  it('never throttles a client sending one input per simulation tick', () => {
    let bucket = createBucket(0);
    const tickMs = MS_PER_SECOND / SERVER_TICK_HZ;

    for (let tick = 1; tick <= SERVER_TICK_HZ * 10; tick += 1) {
      const result = take(bucket, tick * tickMs);
      bucket = result.bucket;
      expect(result.allowed).toBe(true);
    }
  });

  it('tolerates a stall that bunches several frames into one instant', () => {
    let bucket = createBucket(0);
    const tickMs = MS_PER_SECOND / SERVER_TICK_HZ;

    // Three ticks' worth of input arriving together, repeatedly, still fits the budget.
    for (let round = 1; round <= SERVER_TICK_HZ; round += 1) {
      const at = round * tickMs * 3;
      for (let i = 0; i < 3; i += 1) {
        const result = take(bucket, at);
        bucket = result.bucket;
        expect(result.allowed).toBe(true);
      }
    }
  });

  it('treats a backwards clock as no time passing rather than draining the bucket', () => {
    let bucket = createBucket(MS_PER_SECOND);
    for (let i = 0; i < MAX_INPUTS_PER_SECOND; i += 1) {
      bucket = take(bucket, MS_PER_SECOND).bucket;
    }

    // An NTP correction moves the clock back; the client gains nothing and loses nothing.
    expect(take(bucket, 0).allowed).toBe(false);
  });

  it('is pure — the bucket it was given is unchanged', () => {
    const before = createBucket(0);
    const { bucket } = take(before, 0);
    expect(before.tokens).toBe(MAX_INPUTS_PER_SECOND);
    expect(bucket).not.toBe(before);
  });
});

function takeMany(
  start: ReturnType<typeof createBucket>,
  count: number,
  nowMs: number,
): { allowed: number; refused: number } {
  let bucket = start;
  let allowed = 0;
  let refused = 0;

  for (let i = 0; i < count; i += 1) {
    const result = take(bucket, nowMs);
    bucket = result.bucket;
    if (result.allowed) allowed += 1;
    else refused += 1;
  }
  return { allowed, refused };
}
