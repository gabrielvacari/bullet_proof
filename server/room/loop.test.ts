import { describe, expect, it } from 'vitest';

import { TICK_DURATION_MS } from '#shared/constants/index.ts';

import { MAX_CATCHUP_TICKS, createLoop } from './loop.ts';

/**
 * NFR-005. The tick is fixed and independent of everything else in the process.
 *
 * The clock and the scheduler are injected, so "does it drift over a minute" is a question
 * a test can answer in microseconds. Without that, NFR-005 would be verifiable only by
 * watching a server for a minute, which is to say not verified at all.
 */

/**
 * A controllable clock and scheduler.
 *
 * `advance` moves time forward *and* runs whatever the scheduler had queued, which is
 * ordinary operation. `stall` moves the clock without running anything, which is what a
 * debugger, a long GC pause or a suspended laptop does to a real process.
 */
function fakeTime(): {
  now: () => number;
  schedule: (fn: () => void, ms: number) => unknown;
  advance: (ms: number) => void;
  stall: (ms: number) => void;
  pending: () => number;
} {
  let clock = 0;
  const queue: { at: number; fn: () => void }[] = [];

  return {
    now: () => clock,
    schedule: (fn, ms) => {
      queue.push({ at: clock + ms, fn });
      return null;
    },
    advance: (ms) => {
      const target = clock + ms;
      for (;;) {
        const next = queue
          .filter((entry) => entry.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        queue.splice(queue.indexOf(next), 1);
        // Never backwards: a callback scheduled before a stall still runs *after* it.
        clock = Math.max(clock, next.at);
        next.fn();
      }
      clock = target;
    },
    stall: (ms) => {
      clock += ms;
    },
    pending: () => queue.length,
  };
}

describe('createLoop', () => {
  it('does not tick before it is started', () => {
    const time = fakeTime();
    let ticks = 0;
    createLoop(() => (ticks += 1), time);

    time.advance(TICK_DURATION_MS * 10);
    expect(ticks).toBe(0);
  });

  /** L1. One tick per TICK_DURATION_MS of real time, on average. */
  it('ticks once per tick duration', () => {
    const time = fakeTime();
    let ticks = 0;
    const loop = createLoop(() => (ticks += 1), time);
    loop.start();

    time.advance(TICK_DURATION_MS * 10);
    expect(ticks).toBe(10);

    time.advance(TICK_DURATION_MS * 10);
    expect(ticks).toBe(20);
  });

  /**
   * L1 again, and the reason the interval is corrected against a clock rather than
   * accumulated: TICK_DURATION_MS is 33.33..., so a scheduler rounding to whole
   * milliseconds would lose a third of a millisecond per tick -- a second every fifty
   * seconds, and a match that runs slow by the end.
   */
  it('does not accumulate rounding drift over a minute of ticks', () => {
    const time = fakeTime();
    let ticks = 0;
    const loop = createLoop(() => (ticks += 1), time);
    loop.start();

    const minute = 60_000;
    time.advance(minute);

    const expected = Math.floor(minute / TICK_DURATION_MS);
    expect(ticks).toBe(expected);
  });

  /** L2. A slow tick is the loop's problem, not the tick rate's. */
  it('keeps the rate when a tick itself takes time', () => {
    const time = fakeTime();
    let ticks = 0;
    const loop = createLoop(() => {
      ticks += 1;
      // The work inside a tick consumes real time, as a room full of players would.
      time.advance(0);
    }, time);
    loop.start();

    time.advance(TICK_DURATION_MS * 5);
    expect(ticks).toBe(5);
  });

  /**
   * L3. After a stall -- a debugger, a long GC pause, a suspended laptop -- the loop must
   * not try to run every tick it missed. Chasing the backlog makes each tick slower, which
   * grows the backlog. This is the server's version of MAX_SUBSTEPS_PER_FRAME, and it is
   * the more dangerous one: the client only freezes its own page.
   */
  it('caps catch-up after a stall instead of running every missed tick', () => {
    const time = fakeTime();
    let ticks = 0;
    const loop = createLoop(() => (ticks += 1), time);
    loop.start();

    // The process is frozen for ten seconds: three hundred ticks' worth of debt, and
    // nothing runs the scheduler while it accumulates.
    time.advance(TICK_DURATION_MS);
    ticks = 0;
    time.stall(10_000);
    time.advance(1);

    expect(ticks).toBe(MAX_CATCHUP_TICKS);
  });

  it('resumes at the normal rate after a stall', () => {
    const time = fakeTime();
    let ticks = 0;
    const loop = createLoop(() => (ticks += 1), time);
    loop.start();

    time.stall(10_000);
    time.advance(1);
    ticks = 0;

    time.advance(TICK_DURATION_MS * 10);
    expect(ticks).toBe(10);
  });

  it('stops ticking once stopped, and schedules nothing more', () => {
    const time = fakeTime();
    let ticks = 0;
    const loop = createLoop(() => (ticks += 1), time);
    loop.start();

    time.advance(TICK_DURATION_MS * 3);
    loop.stop();
    const after = ticks;

    time.advance(TICK_DURATION_MS * 10);
    expect(ticks).toBe(after);
    expect(time.pending()).toBe(0);
  });

  it('ignores a second start', () => {
    const time = fakeTime();
    let ticks = 0;
    const loop = createLoop(() => (ticks += 1), time);
    loop.start();
    loop.start();

    time.advance(TICK_DURATION_MS * 4);
    expect(ticks).toBe(4);
  });

  it('ignores a stop before it was started', () => {
    const time = fakeTime();
    const loop = createLoop(() => undefined, time);
    expect(() => {
      loop.stop();
    }).not.toThrow();
  });
});
