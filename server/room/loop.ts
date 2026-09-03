import { MAX_SUBSTEPS_PER_FRAME, TICK_DURATION_MS } from '#shared/constants/index.ts';

/**
 * The fixed tick (NFR-005).
 *
 * TICK_DURATION_MS is 33.33..., so a loop that simply asked the scheduler for 33 ms would
 * lose a third of a millisecond every tick -- a whole second every fifty seconds, and a
 * match that ends late. The interval is therefore measured against a real clock and the
 * error corrected on the next sleep, rather than accumulated.
 *
 * The clock and the scheduler are parameters. That is what makes "is the tick still fixed
 * after a minute" a question a test can answer in microseconds instead of a minute.
 */

export interface LoopDeps {
  readonly now: () => number;
  readonly schedule: (fn: () => void, ms: number) => unknown;
}

export interface Loop {
  start(): void;
  stop(): void;
}

/**
 * Ticks the loop will run to catch up after a stall before giving up on the rest.
 *
 * The same reasoning as the client's MAX_SUBSTEPS_PER_FRAME, and the same constant: after
 * a stall, running every missed tick makes each one slower, which grows the backlog
 * further. Dropping simulated time shows as a small skip; chasing it never ends. The
 * server's version matters more -- a client that freezes only freezes its own page.
 */
export const MAX_CATCHUP_TICKS = MAX_SUBSTEPS_PER_FRAME;

export function createLoop(onTick: () => void, deps: LoopDeps): Loop {
  let running = false;
  let nextAt = 0;

  const run = (): void => {
    if (!running) return;

    let ticks = 0;
    while (deps.now() >= nextAt && ticks < MAX_CATCHUP_TICKS) {
      onTick();
      nextAt += TICK_DURATION_MS;
      ticks += 1;
    }

    // The backlog is unrecoverable: drop it rather than chase it.
    if (deps.now() >= nextAt) nextAt = deps.now() + TICK_DURATION_MS;

    const sleep = Math.max(0, nextAt - deps.now());
    deps.schedule(run, sleep);
  };

  return {
    start() {
      if (running) return;
      running = true;
      nextAt = deps.now() + TICK_DURATION_MS;
      deps.schedule(run, TICK_DURATION_MS);
    },
    stop() {
      running = false;
    },
  };
}
