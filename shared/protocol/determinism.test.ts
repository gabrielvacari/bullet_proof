import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { loadMap } from '#shared/map/load.ts';
import type { GameMap } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';
import { spawnedPlayer, step } from '#shared/sim/step.ts';
import type { PlayerInput, PlayerState } from '#shared/sim/types.ts';

import { decode, encode } from './encode.ts';
import {
  KEY_BACK,
  KEY_CROUCH,
  KEY_FORWARD,
  KEY_JUMP,
  KEY_LEFT,
  KEY_MASK_ALL,
  KEY_RIGHT,
  KEY_SPRINT,
  inputFromKeys,
} from './keys.ts';
import type { InputMessage } from './types.ts';
import { parseClientMessage } from './validate.ts';

/**
 * M1-3, and the test CONTRIBUTING.md calls the one that matters most.
 *
 * NFR-003 requires the client's prediction and the server's authoritative simulation to
 * produce identical results for the same input sequence. In M1 those two simulations are
 * separated by a wire, so this drives a recorded input sequence through the whole of it --
 * encode, decode, validate, decode the bitmask, step -- and asserts that the result is
 * identical to stepping the same inputs directly.
 *
 * What it would catch: a bitmask decoded two different ways, a validator that quietly
 * altered a value, and any rounding introduced into the encoder. Each of those looks like
 * network jitter in a running game and like nothing at all in a unit test.
 */

const MAP: GameMap = loadMap(
  JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')) as unknown,
);

const SPAWN = MAP.spawns[0];
if (SPAWN === undefined) throw new Error('the arena has no spawn');
const SPAWN_POS = SPAWN.pos;

function start(): PlayerState {
  return spawnedPlayer(SPAWN_POS);
}

/**
 * A recorded sequence: every key combination in turn, aiming through a range of
 * directions, so the movement basis and the sprint dot product are both exercised.
 */
function recorded(): { keys: number; dir: Vec3 }[] {
  const combos = [
    0,
    KEY_FORWARD,
    KEY_FORWARD | KEY_LEFT,
    KEY_FORWARD | KEY_RIGHT | KEY_SPRINT,
    KEY_BACK | KEY_SPRINT,
    KEY_LEFT | KEY_CROUCH,
    KEY_FORWARD | KEY_JUMP,
    KEY_MASK_ALL,
  ];

  const frames: { keys: number; dir: Vec3 }[] = [];
  for (let tick = 0; tick < 120; tick += 1) {
    const angle = tick / 17;
    const pitch = Math.sin(tick / 23) * 0.5;
    const cosPitch = Math.cos(pitch);
    frames.push({
      keys: combos[tick % combos.length] ?? 0,
      // The trigonometry is the *test's*, standing in for client/input/aim.ts. The
      // simulation never sees an angle -- ADR-0001.
      dir: [-Math.sin(angle) * cosPitch, Math.sin(pitch), -Math.cos(angle) * cosPitch],
    });
  }
  return frames;
}

/** The client's side: predict from the bitmask it is about to send. */
function predictLocally(frames: readonly { keys: number; dir: Vec3 }[]): PlayerState {
  let state = start();
  for (const frame of frames) {
    state = step(state, inputFromKeys(frame.keys, frame.dir), MAP);
  }
  return state;
}

/** The server's side: everything the client sent, through the whole wire path. */
function applyOverTheWire(frames: readonly { keys: number; dir: Vec3 }[]): PlayerState {
  let state = start();

  frames.forEach((frame, index) => {
    const message: InputMessage = {
      t: 'input',
      seq: index + 1,
      keys: frame.keys,
      dir: frame.dir,
    };

    const received = parseClientMessage(decode(encode(message)));
    if (received === null || received.t !== 'input') {
      throw new Error(
        `the server rejected its own client's input at tick ${String(index)}`,
      );
    }

    state = step(state, inputFromKeys(received.keys, received.dir), MAP);
  });

  return state;
}

describe('NFR-003 across the wire', () => {
  it('produces an identical state from an identical input sequence', () => {
    const frames = recorded();
    expect(applyOverTheWire(frames)).toEqual(predictLocally(frames));
  });

  it('is identical tick by tick, not merely at the end', () => {
    const frames = recorded();

    let local = start();
    let remote = start();

    frames.forEach((frame, index) => {
      local = step(local, inputFromKeys(frame.keys, frame.dir), MAP);

      const message: InputMessage = {
        t: 'input',
        seq: index + 1,
        keys: frame.keys,
        dir: frame.dir,
      };
      const received = parseClientMessage(decode(encode(message)));
      if (received === null || received.t !== 'input') throw new Error('rejected');
      remote = step(remote, inputFromKeys(received.keys, received.dir), MAP);

      expect(remote).toEqual(local);
    });
  });

  it('replays to the same state twice, from the same start (NFR-004)', () => {
    const frames = recorded();
    expect(applyOverTheWire(frames)).toEqual(applyOverTheWire(frames));
  });

  /**
   * The encoder must not round. If it did, this is where it would show: the decoded aim
   * vector would differ in the last bits and the two positions would drift apart over the
   * 120 ticks above rather than staying identical.
   *
   * Compared with `===`, not Object.is, for one reason worth recording: JSON has no
   * negative zero, so a `-0` component arrives as `+0`. The two are indistinguishable
   * under every operation the simulation performs -- addition, multiplication, and a
   * division by a length that is always positive -- so the substitution changes no
   * result. The tick-by-tick assertion above is what proves that rather than assumes it.
   */
  it('carries every aim vector across the wire without loss', () => {
    for (const frame of recorded()) {
      const message: InputMessage = { t: 'input', seq: 1, keys: 0, dir: frame.dir };
      const received = parseClientMessage(decode(encode(message)));
      if (received === null || received.t !== 'input') throw new Error('rejected');

      for (let axis = 0; axis < 3; axis += 1) {
        // `===` rather than toBe, which uses Object.is and would separate -0 from +0.
        expect(received.dir[axis] === frame.dir[axis]).toBe(true);
      }
    }
  });

  /** The bitmask is decoded once, in shared/. Both sides therefore mean the same thing. */
  it('decodes every legal bitmask to the same PlayerInput on both sides', () => {
    const dir: Vec3 = [0, 0, -1];

    for (let keys = 0; keys <= KEY_MASK_ALL; keys += 1) {
      const local: PlayerInput = inputFromKeys(keys, dir);

      const received = parseClientMessage(
        decode(encode({ t: 'input', seq: 1, keys, dir })),
      );
      if (received === null || received.t !== 'input') throw new Error('rejected');

      expect(inputFromKeys(received.keys, received.dir)).toEqual(local);
    }
  });
});
