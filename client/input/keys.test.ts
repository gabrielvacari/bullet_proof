import { describe, expect, it } from 'vitest';

import {
  KEY_BACK,
  KEY_CROUCH,
  KEY_FORWARD,
  KEY_JUMP,
  KEY_LEFT,
  KEY_FIRE,
  KEY_RELOAD,
  KEY_RIGHT,
  KEY_SPRINT,
  inputFromKeys,
} from '#shared/protocol/keys.ts';
import { validateInput } from '#shared/sim/validate.ts';

import { KEYS, keysFromHeld } from './keys.ts';

const FORWARD_DIR = [0, 0, -1] as const;

function held(...codes: string[]): ReadonlySet<string> {
  return new Set(codes);
}

describe('keysFromHeld', () => {
  it('is zero with nothing held', () => {
    expect(keysFromHeld(held())).toBe(0);
  });

  it('maps each key to its NET-004 bit', () => {
    expect(keysFromHeld(held(KEYS.forward))).toBe(KEY_FORWARD);
    expect(keysFromHeld(held(KEYS.back))).toBe(KEY_BACK);
    expect(keysFromHeld(held(KEYS.left))).toBe(KEY_LEFT);
    expect(keysFromHeld(held(KEYS.right))).toBe(KEY_RIGHT);
    expect(keysFromHeld(held(KEYS.jump))).toBe(KEY_JUMP);
  });

  it('accepts either the left or the right modifier', () => {
    expect(keysFromHeld(held(KEYS.sprint[0]))).toBe(KEY_SPRINT);
    expect(keysFromHeld(held(KEYS.sprint[1]))).toBe(KEY_SPRINT);
    expect(keysFromHeld(held(KEYS.crouch[0]))).toBe(KEY_CROUCH);
    expect(keysFromHeld(held(KEYS.crouch[1]))).toBe(KEY_CROUCH);
  });

  it('combines held keys into one mask', () => {
    expect(keysFromHeld(held(KEYS.forward, KEYS.left, KEYS.jump))).toBe(
      KEY_FORWARD | KEY_LEFT | KEY_JUMP,
    );
  });

  it('ignores keys the protocol does not define', () => {
    expect(keysFromHeld(held('KeyQ', 'F13', 'Escape'))).toBe(0);
  });

  it('never sets the fire or reload bits -- those are M2', () => {
    const everything = keysFromHeld(
      held(
        KEYS.forward,
        KEYS.back,
        KEYS.left,
        KEYS.right,
        KEYS.jump,
        KEYS.sprint[0],
        KEYS.crouch[0],
      ),
    );
    expect(everything & KEY_FIRE).toBe(0);
    expect(everything & KEY_RELOAD).toBe(0);
  });
});

describe('the keyboard and the simulation agree', () => {
  /**
   * Anything the keyboard can produce must survive the server's validator once it has
   * been through the shared decoder. This is the client half of NFR-003: the bitmask is
   * the only thing that crosses the wire, so it is the only thing prediction may use.
   */
  it('produces input the simulation validator accepts, for every key combination', () => {
    const codes = [
      KEYS.forward,
      KEYS.back,
      KEYS.left,
      KEYS.right,
      KEYS.jump,
      KEYS.sprint[0],
      KEYS.crouch[0],
    ];
    for (let mask = 0; mask < 1 << codes.length; mask += 1) {
      const combo = codes.filter((_, bit) => (mask & (1 << bit)) !== 0);
      const input = inputFromKeys(keysFromHeld(held(...combo)), FORWARD_DIR);
      expect(validateInput({ ...input })).not.toBeNull();
    }
  });
});
