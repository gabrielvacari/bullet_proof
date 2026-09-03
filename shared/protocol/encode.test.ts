import { describe, expect, it } from 'vitest';

import { GRAVITY, TICK_DURATION_S, WALK_SPEED } from '#shared/constants/index.ts';

import { decode, encode } from './encode.ts';
import { parseClientMessage } from './validate.ts';
import type { InputMessage } from './types.ts';

describe('encode', () => {
  it('produces a NET-001 envelope with no nesting and no metadata', () => {
    const message: InputMessage = { t: 'input', seq: 1, keys: 0, dir: [0, 0, -1] };
    expect(encode(message)).toBe('{"t":"input","seq":1,"keys":0,"dir":[0,0,-1]}');
  });

  /**
   * This is the property reconciliation depends on. If a double did not survive the wire
   * exactly, the client's replay could not reproduce the server's state, and NFR-003's
   * bit-identity guarantee would hold everywhere except the one place it is spent.
   */
  it('round-trips a double bit-for-bit, which is why nothing here rounds', () => {
    const awkward = [
      1 / 3,
      0.1 + 0.2,
      GRAVITY * TICK_DURATION_S,
      WALK_SPEED * TICK_DURATION_S,
      Math.sqrt(2),
      Number.MIN_SAFE_INTEGER,
      Number.EPSILON,
      -0.9320390859672263,
    ];

    for (const value of awkward) {
      const message: InputMessage = {
        t: 'input',
        seq: 1,
        keys: 0,
        dir: [value, 0, -1],
      };
      const returned = decode(encode(message)) as { dir: [number, number, number] };
      expect(Object.is(returned.dir[0], value)).toBe(true);
    }
  });

  it('survives a full encode / decode / validate round trip', () => {
    const message: InputMessage = { t: 'input', seq: 42, keys: 17, dir: [0, 0, -1] };
    expect(parseClientMessage(decode(encode(message)))).toEqual(message);
  });
});

describe('decode', () => {
  it('returns null for text that is not JSON rather than throwing', () => {
    expect(decode('not json')).toBeNull();
    expect(decode('')).toBeNull();
    expect(decode('{"t":')).toBeNull();
  });

  it('returns the parsed value for valid JSON of any shape', () => {
    expect(decode('null')).toBeNull();
    expect(decode('[1,2]')).toEqual([1, 2]);
    expect(decode('{"t":"leave"}')).toEqual({ t: 'leave' });
  });
});
