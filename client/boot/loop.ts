import { MAX_SUBSTEPS_PER_FRAME, TICK_DURATION_S } from '#shared/constants/index.ts';

/**
 * The fixed-timestep accumulator, kept as a pure function so it can be tested without a
 * browser -- the render loop that calls it cannot be.
 *
 * The simulation runs at SERVER_TICK_HZ while the display runs at whatever rate it runs
 * at. Decoupling them is not an optimisation: it is the M1 prerequisite, because this
 * accumulator is exactly where the prediction buffer is inserted.
 */
export interface Advance {
  /** How many times to call step() this frame. */
  readonly substeps: number;
  /** Time left over, carried into the next frame. */
  readonly accumulator: number;
  /** Interpolation factor between the previous and current simulated state, 0..1. */
  readonly alpha: number;
}

export function advance(accumulator: number, elapsedSeconds: number): Advance {
  // A negative or non-finite frame time can come from a clock adjustment or a stalled
  // tab; treat it as no time passing rather than letting it corrupt the accumulator.
  const elapsed =
    Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;

  let remaining = accumulator + elapsed;
  let substeps = 0;
  while (remaining >= TICK_DURATION_S && substeps < MAX_SUBSTEPS_PER_FRAME) {
    remaining -= TICK_DURATION_S;
    substeps += 1;
  }

  /*
   * Drop the debt rather than chase it.
   *
   * After a stall -- a breakpoint, a backgrounded tab, a long GC pause -- the accumulator
   * can hold hundreds of ticks. Simulating them all makes the frame slower, which adds
   * more debt than it clears, and the page freezes. Discarding is visible as a small
   * skip; chasing is visible as a hang.
   */
  if (remaining >= TICK_DURATION_S) remaining = 0;

  return { substeps, accumulator: remaining, alpha: remaining / TICK_DURATION_S };
}
