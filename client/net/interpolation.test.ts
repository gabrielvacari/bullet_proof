import { describe, expect, it } from 'vitest';

import { SNAPSHOT_BUFFER_SIZE, SNAPSHOT_INTERVAL_MS } from '#shared/constants/index.ts';
import type { SnapshotMessage, SnapshotPlayer } from '#shared/protocol/types.ts';

import {
  type SnapshotBuffer,
  emptyBuffer,
  forget,
  push,
  sample,
} from './interpolation.ts';

/**
 * NFR-008. Remote players are rendered in the past, between the two snapshots that
 * bracket the render time, so that motion arriving at SNAPSHOT_HZ is drawn continuously.
 *
 * Everything here is a pure function over an explicit render time: the buffer never reads
 * a clock, which is the only reason these cases can be written at all.
 */

function player(
  id: string,
  x: number,
  overrides: Partial<SnapshotPlayer> = {},
): SnapshotPlayer {
  return { id, p: [x, 0, 0], v: [1, 0, 0], y: 0, pt: 0, st: 1, ...overrides };
}

function snapshot(tick: number, players: SnapshotPlayer[]): SnapshotMessage {
  return { t: 'snapshot', tick, ack: 0, players };
}

/** Two snapshots one interval apart, arriving at t=1000 and t=1000+interval. */
function twoFrames(): SnapshotBuffer {
  let buffer = emptyBuffer();
  buffer = push(buffer, snapshot(1, [player('p_1', 0)]), 1000);
  buffer = push(buffer, snapshot(2, [player('p_1', 10)]), 1000 + SNAPSHOT_INTERVAL_MS);
  return buffer;
}

describe('sample — interpolating between the bracketing snapshots', () => {
  it('returns the midpoint halfway between two entries', () => {
    const at = 1000 + SNAPSHOT_INTERVAL_MS / 2;
    const [only] = sample(twoFrames(), at);
    expect(only?.id).toBe('p_1');
    expect(only?.pos[0]).toBeCloseTo(5, 12);
  });

  it('returns each endpoint exactly at its own time', () => {
    const buffer = twoFrames();
    expect(sample(buffer, 1000)[0]?.pos[0]).toBe(0);
    expect(sample(buffer, 1000 + SNAPSHOT_INTERVAL_MS)[0]?.pos[0]).toBe(10);
  });

  it('interpolates yaw and pitch alongside position', () => {
    let buffer = emptyBuffer();
    buffer = push(buffer, snapshot(1, [player('p_1', 0, { y: 0, pt: 0 })]), 0);
    buffer = push(
      buffer,
      snapshot(2, [player('p_1', 0, { y: 1, pt: 0.5 })]),
      SNAPSHOT_INTERVAL_MS,
    );

    const [only] = sample(buffer, SNAPSHOT_INTERVAL_MS / 2);
    expect(only?.yaw).toBeCloseTo(0.5, 12);
    expect(only?.pitch).toBeCloseTo(0.25, 12);
  });

  it('carries the newer entry state flags rather than blending them', () => {
    let buffer = emptyBuffer();
    buffer = push(buffer, snapshot(1, [player('p_1', 0, { st: 0 })]), 0);
    buffer = push(
      buffer,
      snapshot(2, [player('p_1', 10, { st: 3 })]),
      SNAPSHOT_INTERVAL_MS,
    );

    expect(sample(buffer, SNAPSHOT_INTERVAL_MS / 2)[0]?.st).toBe(3);
  });

  /**
   * I3. When nothing newer has arrived, hold. Extrapolating would render a position the
   * server never reported and then correct it -- a still capsule reads as a lagging
   * player, a sliding one reads as a bug, and no requirement asks for the guess.
   */
  it('holds the newest known state when the buffer has run dry', () => {
    const buffer = twoFrames();
    const wellPast = 1000 + SNAPSHOT_INTERVAL_MS * 10;
    expect(sample(buffer, wellPast)[0]?.pos[0]).toBe(10);
  });

  it('holds the oldest known state when asked for a time before the buffer starts', () => {
    expect(sample(twoFrames(), 0)[0]?.pos[0]).toBe(0);
  });

  it('returns nothing at all from an empty buffer', () => {
    expect(sample(emptyBuffer(), 1000)).toEqual([]);
  });

  it('samples a single-entry buffer at that entry', () => {
    const buffer = push(emptyBuffer(), snapshot(1, [player('p_1', 7)]), 1000);
    expect(sample(buffer, 5000)[0]?.pos[0]).toBe(7);
  });

  /**
   * I4. A player absent from the newer entry has left. Interpolating them toward their
   * last known position makes them glide to a halt instead of disappearing, which is
   * exactly the ghost FR-GP-040 forbids.
   */
  it('drops a player who is absent from the newer entry', () => {
    let buffer = emptyBuffer();
    buffer = push(buffer, snapshot(1, [player('p_1', 0), player('p_2', 5)]), 0);
    buffer = push(buffer, snapshot(2, [player('p_1', 10)]), SNAPSHOT_INTERVAL_MS);

    const ids = sample(buffer, SNAPSHOT_INTERVAL_MS / 2).map((p) => p.id);
    expect(ids).toEqual(['p_1']);
  });

  /**
   * I5. Forget this and everyone who joins arrives by sliding across the arena from the
   * origin, because there is no older entry to interpolate from.
   */
  it('renders a player seen for the first time at their first known state', () => {
    let buffer = emptyBuffer();
    buffer = push(buffer, snapshot(1, [player('p_1', 0)]), 0);
    buffer = push(
      buffer,
      snapshot(2, [player('p_1', 10), player('p_2', 40)]),
      SNAPSHOT_INTERVAL_MS,
    );

    const arrived = sample(buffer, SNAPSHOT_INTERVAL_MS / 2).find((p) => p.id === 'p_2');
    expect(arrived?.pos).toEqual([40, 0, 0]);
  });
});

describe('push — what the buffer accepts and how much it keeps', () => {
  /** I2. TCP makes this nearly impossible, and "nearly" is not a reason to rewind. */
  it('discards a snapshot no newer than the newest already held', () => {
    let buffer = emptyBuffer();
    buffer = push(buffer, snapshot(5, [player('p_1', 0)]), 0);
    buffer = push(buffer, snapshot(4, [player('p_1', 99)]), 10);
    buffer = push(buffer, snapshot(5, [player('p_1', 98)]), 20);

    expect(buffer.entries).toHaveLength(1);
    expect(sample(buffer, 100)[0]?.pos[0]).toBe(0);
  });

  it('keeps entries in arrival order', () => {
    let buffer = emptyBuffer();
    for (let tick = 1; tick <= 3; tick += 1) {
      buffer = push(buffer, snapshot(tick, []), tick * SNAPSHOT_INTERVAL_MS);
    }
    expect(buffer.entries.map((e) => e.tick)).toEqual([1, 2, 3]);
  });

  /** I6. Bounded memory: a session that runs for an hour holds the same few snapshots. */
  it('never exceeds SNAPSHOT_BUFFER_SIZE, dropping the oldest', () => {
    let buffer = emptyBuffer();
    for (let tick = 1; tick <= SNAPSHOT_BUFFER_SIZE * 3; tick += 1) {
      buffer = push(buffer, snapshot(tick, []), tick * SNAPSHOT_INTERVAL_MS);
    }

    expect(buffer.entries).toHaveLength(SNAPSHOT_BUFFER_SIZE);
    expect(buffer.entries.at(-1)?.tick).toBe(SNAPSHOT_BUFFER_SIZE * 3);
  });

  it('is pure — the buffer it was given is unchanged', () => {
    const before = emptyBuffer();
    const after = push(before, snapshot(1, []), 0);
    expect(before.entries).toHaveLength(0);
    expect(after).not.toBe(before);
  });
});

describe('forget — removing a player who has left (NET-011)', () => {
  it('removes every trace of the player from the buffer', () => {
    let buffer = emptyBuffer();
    buffer = push(buffer, snapshot(1, [player('p_1', 0), player('p_2', 5)]), 0);
    buffer = push(
      buffer,
      snapshot(2, [player('p_1', 10), player('p_2', 15)]),
      SNAPSHOT_INTERVAL_MS,
    );

    const cleaned = forget(buffer, 'p_2');
    const ids = sample(cleaned, SNAPSHOT_INTERVAL_MS / 2).map((p) => p.id);
    expect(ids).toEqual(['p_1']);
  });
});
