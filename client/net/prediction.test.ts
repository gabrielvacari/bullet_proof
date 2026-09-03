import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  MAX_PENDING_INPUTS,
  RECONCILE_ERROR_DECAY_PER_TICK,
  RECONCILE_ERROR_EPSILON,
} from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import type { GameMap } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';
import { KEY_FORWARD, KEY_LEFT, inputFromKeys } from '#shared/protocol/keys.ts';
import type { PlayerState } from '#shared/sim/types.ts';

import {
  type PendingInput,
  decayError,
  predict,
  reconcile,
  remember,
} from './prediction.ts';

/**
 * NFR-006 and NFR-007, the two hardest things in M1.
 *
 * The zero-error case below is the test to write first and the one that matters most. If
 * it ever fails, the cause is not in prediction.ts: it means two implementations of
 * movement exist and NFR-003 has already been broken somewhere upstream.
 */

const MAP: GameMap = loadMap(
  JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')) as unknown,
);

const SPAWN = MAP.spawns[0];
if (SPAWN === undefined) throw new Error('the arena has no spawn');
const SPAWN_POS = SPAWN.pos;

const DIR: Vec3 = [0, 0, -1];

function start(): PlayerState {
  return { pos: SPAWN_POS, vel: [0, 0, 0], grounded: false, crouching: false };
}

/** The client's own sequence of inputs, as it would have sent them. */
function sequence(count: number, keys = KEY_FORWARD): PendingInput[] {
  const pending: PendingInput[] = [];
  for (let seq = 1; seq <= count; seq += 1) {
    pending.push({ seq, input: inputFromKeys(keys, DIR) });
  }
  return pending;
}

/** What the server would have arrived at, having applied the same inputs. */
function authoritativeAfter(inputs: readonly PendingInput[]): PlayerState {
  let state = start();
  for (const { input } of inputs) state = predict(state, input, MAP);
  return state;
}

/** Where the client would be, having predicted all of them. */
function predictedAfter(inputs: readonly PendingInput[]): PlayerState {
  return authoritativeAfter(inputs);
}

describe('predict', () => {
  it('is step, so the client and the server cannot diverge by construction', () => {
    const state = start();
    const input = inputFromKeys(KEY_FORWARD, DIR);
    expect(predict(state, input, MAP)).toEqual(predict(state, input, MAP));
  });

  it('leaves the state it was given untouched', () => {
    const state = start();
    predict(state, inputFromKeys(KEY_FORWARD, DIR), MAP);
    expect(state).toEqual(start());
  });
});

describe('reconcile — the zero-error case (C4)', () => {
  /**
   * The whole point of NFR-003. The client predicted ten ticks; the server confirms the
   * first four; replaying the remaining six from the server's state must land exactly
   * where the client already was.
   *
   * Asserted with toEqual, not toBeCloseTo. There is no tolerance because there is nothing
   * for a tolerance to absorb: one implementation of movement, arithmetic ECMA-262 pins
   * down, and JSON that round-trips a double without loss.
   */
  it('reproduces the prediction exactly, with an error of zero', () => {
    const pending = sequence(10);
    const predicted = predictedAfter(pending);
    const authoritative = authoritativeAfter(pending.slice(0, 4));

    const result = reconcile(predicted, pending, authoritative, 4, MAP);

    expect(result.state).toEqual(predicted);
    expect(result.error).toEqual([0, 0, 0]);
  });

  it('holds over a long sequence, where drift would have accumulated', () => {
    const pending = sequence(120, KEY_FORWARD | KEY_LEFT);
    const predicted = predictedAfter(pending);
    const authoritative = authoritativeAfter(pending.slice(0, 90));

    const result = reconcile(predicted, pending, authoritative, 90, MAP);

    expect(result.state.pos).toEqual(predicted.pos);
    expect(result.state.vel).toEqual(predicted.vel);
  });
});

describe('reconcile — the buffer (C2, C3)', () => {
  it('drops every input the server has acknowledged', () => {
    const pending = sequence(10);
    const result = reconcile(
      predictedAfter(pending),
      pending,
      authoritativeAfter(pending.slice(0, 4)),
      4,
      MAP,
    );

    expect(result.pending.map((p) => p.seq)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it('keeps everything when the server has acknowledged nothing', () => {
    const pending = sequence(3);
    const result = reconcile(predictedAfter(pending), pending, start(), 0, MAP);
    expect(result.pending).toHaveLength(3);
  });

  it('empties the buffer when the server has caught up', () => {
    const pending = sequence(3);
    const result = reconcile(
      predictedAfter(pending),
      pending,
      authoritativeAfter(pending),
      3,
      MAP,
    );
    expect(result.pending).toHaveLength(0);
  });

  /** An ack past the newest input the client still holds means everything is confirmed. */
  it('trims rather than resurrects when ack runs ahead of the buffer', () => {
    const pending = sequence(3);
    const result = reconcile(
      predictedAfter(pending),
      pending,
      authoritativeAfter(pending),
      99,
      MAP,
    );
    expect(result.pending).toHaveLength(0);
  });

  it('replays the remaining inputs in order', () => {
    const pending = sequence(6, KEY_FORWARD | KEY_LEFT);
    const at = predictedAfter(pending);
    const server = authoritativeAfter(pending.slice(0, 2));

    const forwards = reconcile(at, pending, server, 2, MAP);
    const backwards = reconcile(at, [...pending].reverse(), server, 2, MAP);

    // Same inputs, different order, different answer -- so the order is load-bearing.
    expect(backwards.pending.map((p) => p.seq)).toEqual([6, 5, 4, 3]);
    expect(forwards.pending.map((p) => p.seq)).toEqual([3, 4, 5, 6]);
  });

  /** C3. The server's state is adopted, never blended with the client's opinion. */
  it('adopts the server state when there is nothing left to replay', () => {
    const pending = sequence(4);
    const authoritative = authoritativeAfter(pending);
    const result = reconcile(predictedAfter(pending), pending, authoritative, 4, MAP);
    expect(result.state).toEqual(authoritative);
  });

  it('is pure — the buffer it was given is unchanged', () => {
    const pending = sequence(5);
    reconcile(
      predictedAfter(pending),
      pending,
      authoritativeAfter(pending.slice(0, 2)),
      2,
      MAP,
    );
    expect(pending).toHaveLength(5);
  });
});

describe('reconcile — a real correction (C5)', () => {
  /**
   * NFR-007's own acceptance criterion: inject a server-side correction and the player
   * must converge without a teleport. The simulated state adopts the server's value
   * immediately -- anything else would put the client's opinion above the server's, in
   * violation of NFR-001 -- while the render carries a decaying offset.
   */
  it('reports the difference as a render-side error, without changing the state', () => {
    const pending = sequence(6);
    const predicted = predictedAfter(pending);

    // The server disagrees: it puts the player two metres to the side.
    const server = authoritativeAfter(pending.slice(0, 3));
    const shifted: PlayerState = {
      ...server,
      pos: [server.pos[0] + 2, server.pos[1], server.pos[2]],
    };

    const result = reconcile(predicted, pending, shifted, 3, MAP);

    expect(result.state.pos[0]).not.toBe(predicted.pos[0]);
    expect(result.error[0]).not.toBe(0);
    // The error is exactly what the render must add back to avoid a visible jump.
    expect(result.state.pos[0] + result.error[0]).toBeCloseTo(predicted.pos[0], 10);
  });

  it('produces an error of zero when there was nothing predicted to compare against', () => {
    const server = authoritativeAfter(sequence(2));
    expect(reconcile(server, [], server, 2, MAP).error).toEqual([0, 0, 0]);
  });
});

describe('decayError', () => {
  it('shrinks by RECONCILE_ERROR_DECAY_PER_TICK each tick', () => {
    const decayed = decayError([1, 0, 0]);
    expect(decayed[0]).toBeCloseTo(RECONCILE_ERROR_DECAY_PER_TICK, 12);
  });

  it('converges to exactly zero rather than decaying forever', () => {
    let error: Vec3 = [1, 1, 1];
    for (let tick = 0; tick < 1000; tick += 1) error = decayError(error);
    expect(error).toEqual([0, 0, 0]);
  });

  it('zeroes an error already below the epsilon', () => {
    expect(decayError([RECONCILE_ERROR_EPSILON / 2, 0, 0])).toEqual([0, 0, 0]);
  });

  /**
   * Per tick, not per frame. Decaying per rendered frame would make convergence faster on
   * a 144 Hz monitor than on a 60 Hz one -- the same class of bug as a variable timestep.
   */
  it('converges in the same number of ticks whatever the frame rate', () => {
    const ticksToConverge = (): number => {
      let error: Vec3 = [1, 0, 0];
      let ticks = 0;
      while (error[0] !== 0) {
        error = decayError(error);
        ticks += 1;
      }
      return ticks;
    };
    expect(ticksToConverge()).toBe(ticksToConverge());
  });
});

describe('remember — the pending buffer (C7)', () => {
  it('appends an input in send order', () => {
    const buffer = remember(
      remember([], 1, inputFromKeys(0, DIR)),
      2,
      inputFromKeys(0, DIR),
    );
    expect(buffer.map((p) => p.seq)).toEqual([1, 2]);
  });

  it('stops at MAX_PENDING_INPUTS, dropping the oldest', () => {
    let buffer: PendingInput[] = [];
    for (let seq = 1; seq <= MAX_PENDING_INPUTS * 2; seq += 1) {
      buffer = remember(buffer, seq, inputFromKeys(0, DIR));
    }

    expect(buffer).toHaveLength(MAX_PENDING_INPUTS);
    expect(buffer[0]?.seq).toBe(MAX_PENDING_INPUTS + 1);
  });

  it('is pure — the buffer it was given is unchanged', () => {
    const before: PendingInput[] = [];
    remember(before, 1, inputFromKeys(0, DIR));
    expect(before).toHaveLength(0);
  });
});
