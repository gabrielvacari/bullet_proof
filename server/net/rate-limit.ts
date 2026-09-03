import { MAX_INPUTS_PER_SECOND, MS_PER_SECOND } from '#shared/constants/index.ts';

/**
 * NFR-010. A token bucket per connection, refilled at MAX_INPUTS_PER_SECOND per second.
 *
 * `nowMs` is a parameter, not a clock read. That is the only reason "does a flood get
 * throttled after a second" is a question a test can answer in microseconds -- and a rate
 * limiter nobody can afford to test is a rate limiter nobody has tested.
 *
 * A bucket rather than a hard cap because MAX_INPUTS_PER_SECOND leaves only about 2x
 * headroom over an honest client's send rate: a garbage-collection pause that bunches
 * three frames together must not disconnect a player who did nothing wrong. Throttle
 * first; the connection is closed only for persistence (see connection.ts).
 */

export interface Bucket {
  readonly tokens: number;
  readonly lastMs: number;
}

/** Full at birth, so a client's first burst of inputs is not punished for arriving early. */
export function createBucket(nowMs: number): Bucket {
  return { tokens: MAX_INPUTS_PER_SECOND, lastMs: nowMs };
}

export interface Take {
  readonly bucket: Bucket;
  readonly allowed: boolean;
}

export function take(bucket: Bucket, nowMs: number): Take {
  const refilled = refill(bucket, nowMs);
  if (refilled.tokens < 1) return { bucket: refilled, allowed: false };

  return { bucket: { ...refilled, tokens: refilled.tokens - 1 }, allowed: true };
}

function refill(bucket: Bucket, nowMs: number): Bucket {
  // A clock that goes backwards -- an NTP correction, a test -- adds nothing rather than
  // draining the bucket by a negative amount.
  const elapsed = Math.max(0, nowMs - bucket.lastMs);
  const gained = (elapsed * MAX_INPUTS_PER_SECOND) / MS_PER_SECOND;

  return {
    tokens: Math.min(MAX_INPUTS_PER_SECOND, bucket.tokens + gained),
    lastMs: nowMs,
  };
}
