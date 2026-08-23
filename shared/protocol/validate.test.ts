import { describe, expect, it } from 'vitest';

import {
  AIM_DIR_Y_MAX,
  AIM_DIR_Y_MIN,
  AIM_EPSILON,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
} from '#shared/constants/index.ts';
import { type Vec3, length } from '#shared/math/vec3.ts';
import { validateInput } from '#shared/sim/validate.ts';

import { KEY_MASK_ALL } from './keys.ts';
import { parseClientMessage, parseServerMessage } from './validate.ts';

const DIR = [0, 0, -1] as const;

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { t: 'input', seq: 1, keys: 0, dir: [...DIR], ...overrides };
}

function join(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { t: 'join', nickname: 'gabriel', mode: 'FFA', ...overrides };
}

/** Parses an input message and returns its dir, failing loudly if it was rejected. */
function parsedDir(raw: Record<string, unknown>): Vec3 {
  const parsed = parseClientMessage(raw);
  if (parsed === null || parsed.t !== 'input') throw new Error('expected an input');
  return parsed.dir;
}

/* ------------------------------------------------------------- Envelope ---- */

describe('parseClientMessage — the envelope (NET-001)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', '{"t":"leave"}'],
    ['an array', [{ t: 'leave' }]],
    ['a boolean', true],
  ])('rejects %s', (_label, value) => {
    expect(parseClientMessage(value)).toBeNull();
  });

  it('ignores an unknown type rather than treating it as an error', () => {
    expect(parseClientMessage({ t: 'shoot', target: 'p_1' })).toBeNull();
    expect(parseClientMessage({ t: 42 })).toBeNull();
    expect(parseClientMessage({})).toBeNull();
  });

  it('never throws, whatever it is given', () => {
    const hostile: unknown[] = [
      Object.create(null),
      { t: 'input', seq: 1n },
      {
        t: 'input',
        get seq(): never {
          throw new Error('trap');
        },
      },
      new Map(),
      Symbol('t'),
    ];
    for (const value of hostile) {
      expect(() => parseClientMessage(value)).not.toThrow();
    }
  });
});

/* ----------------------------------------------------------------- join ---- */

describe('parseClientMessage — join (NET-003, FR-GP-008)', () => {
  it('accepts a valid join', () => {
    expect(parseClientMessage(join())).toEqual({
      t: 'join',
      nickname: 'gabriel',
      mode: 'FFA',
    });
  });

  it('accepts both modes', () => {
    expect(parseClientMessage(join({ mode: 'TDM' }))).not.toBeNull();
  });

  it('rejects a nickname that is not a string', () => {
    expect(parseClientMessage(join({ nickname: 7 }))).toBeNull();
  });

  it('rejects a nickname outside the length bounds', () => {
    expect(
      parseClientMessage(join({ nickname: 'a'.repeat(NICKNAME_MIN_LENGTH - 1) })),
    ).toBeNull();
    expect(
      parseClientMessage(join({ nickname: 'a'.repeat(NICKNAME_MAX_LENGTH + 1) })),
    ).toBeNull();
    expect(parseClientMessage(join({ nickname: '' }))).toBeNull();
  });

  it('accepts a nickname exactly at each bound', () => {
    expect(
      parseClientMessage(join({ nickname: 'a'.repeat(NICKNAME_MIN_LENGTH) })),
    ).not.toBeNull();
    expect(
      parseClientMessage(join({ nickname: 'a'.repeat(NICKNAME_MAX_LENGTH) })),
    ).not.toBeNull();
  });

  /** FR-GP-008's own acceptance criterion, and the reason NFR-012 has less to defend. */
  it('rejects markup, whitespace and punctuation', () => {
    for (const nickname of [
      '<script>alert(1)</script>',
      'has space',
      'semi;colon',
      'quote"mark',
      'ampersand&',
      'emoji😀x',
    ]) {
      expect(parseClientMessage(join({ nickname }))).toBeNull();
    }
  });

  it('accepts letters, digits, underscore and hyphen', () => {
    expect(parseClientMessage(join({ nickname: 'a_b-C9' }))).not.toBeNull();
  });

  it('rejects a mode outside the union', () => {
    expect(parseClientMessage(join({ mode: 'CTF' }))).toBeNull();
    expect(parseClientMessage(join({ mode: 0 }))).toBeNull();
  });

  it('accepts a well-formed room code and rejects a malformed one', () => {
    expect(parseClientMessage(join({ roomCode: 'X7K2' }))).toEqual({
      t: 'join',
      nickname: 'gabriel',
      mode: 'FFA',
      roomCode: 'X7K2',
    });
    // Wrong length, ambiguous glyphs, lower case, and the wrong type.
    expect(parseClientMessage(join({ roomCode: 'X7K' }))).toBeNull();
    expect(parseClientMessage(join({ roomCode: 'X0K2' }))).toBeNull();
    expect(parseClientMessage(join({ roomCode: 'x7k2' }))).toBeNull();
    expect(parseClientMessage(join({ roomCode: 7 }))).toBeNull();
  });

  it('rejects missing and extra fields', () => {
    expect(parseClientMessage({ t: 'join', nickname: 'gabriel' })).toBeNull();
    expect(parseClientMessage(join({ team: 'BLUE' }))).toBeNull();
  });
});

/* ---------------------------------------------------------------- input ---- */

describe('parseClientMessage — input (NET-004)', () => {
  it('accepts a valid input', () => {
    expect(parseClientMessage(input())).toEqual({
      t: 'input',
      seq: 1,
      keys: 0,
      dir: [0, 0, -1],
    });
  });

  it('rejects a seq that is not a positive safe integer', () => {
    for (const seq of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', 2 ** 53]) {
      expect(parseClientMessage(input({ seq }))).toBeNull();
    }
  });

  it('rejects a keys value outside the nine defined bits', () => {
    expect(parseClientMessage(input({ keys: KEY_MASK_ALL + 1 }))).toBeNull();
    expect(parseClientMessage(input({ keys: -1 }))).toBeNull();
    expect(parseClientMessage(input({ keys: 1.5 }))).toBeNull();
    expect(parseClientMessage(input({ keys: '1' }))).toBeNull();
  });

  it('accepts every bit combination the protocol defines', () => {
    expect(parseClientMessage(input({ keys: KEY_MASK_ALL }))).not.toBeNull();
  });

  it('rejects a dir that is not three finite numbers', () => {
    for (const dir of [
      [0, 0],
      [0, 0, -1, 0],
      [0, 0, '-1'],
      [Number.NaN, 0, -1],
      [0, Number.POSITIVE_INFINITY, -1],
      'forward',
      null,
    ]) {
      expect(parseClientMessage(input({ dir }))).toBeNull();
    }
  });

  /** NET-004c: a longer vector would scale straight into velocity. */
  it('rejects a dir off unit length by more than AIM_EPSILON', () => {
    expect(parseClientMessage(input({ dir: [0, 0, -2] }))).toBeNull();
    expect(parseClientMessage(input({ dir: [0, 0, -0.5] }))).toBeNull();
    expect(parseClientMessage(input({ dir: [0, 0, 0] }))).toBeNull();
  });

  it('accepts a dir within AIM_EPSILON of unit length', () => {
    const withinTolerance = 1 - AIM_EPSILON / 2;
    expect(parseClientMessage(input({ dir: [0, 0, -withinTolerance] }))).not.toBeNull();
  });

  /** NET-004c says the server clamps the pitch, not that it drops the message. */
  it('clamps a dir above the pitch cone and keeps it unit length', () => {
    const dir = parsedDir(input({ dir: [0, 0.99, -0.14106735979665894] }));
    expect(dir[1]).toBe(AIM_DIR_Y_MAX);
    expect(length(dir)).toBeCloseTo(1, 12);
  });

  it('clamps a dir below the pitch cone and keeps it unit length', () => {
    const dir = parsedDir(input({ dir: [0, -0.99, -0.14106735979665894] }));
    expect(dir[1]).toBe(AIM_DIR_Y_MIN);
    expect(length(dir)).toBeCloseTo(1, 12);
  });

  it('leaves a dir inside the cone exactly as sent', () => {
    const inside = [0, AIM_DIR_Y_MAX, -Math.sqrt(1 - AIM_DIR_Y_MAX * AIM_DIR_Y_MAX)];
    expect(parsedDir(input({ dir: inside }))).toEqual(inside);
  });

  /**
   * Straight up and straight down have no horizontal component, so clamping the vertical
   * one leaves no heading to preserve. Rejected rather than guessed at. Unreachable for an
   * honest client, whose in-cone vectors always keep a horizontal length of about 0.36.
   */
  it('rejects a dir pointing exactly up or exactly down', () => {
    expect(parseClientMessage(input({ dir: [0, 1, 0] }))).toBeNull();
    expect(parseClientMessage(input({ dir: [0, -1, 0] }))).toBeNull();
  });

  /** NFR-011 names this message. There is no dt field, so there is nothing to read. */
  it('rejects the dt smuggling attempt NFR-011 names', () => {
    expect(parseClientMessage({ t: 'input', dt: 999_999 })).toBeNull();
    expect(parseClientMessage(input({ dt: 999_999 }))).toBeNull();
  });

  it('rejects missing fields', () => {
    expect(parseClientMessage({ t: 'input', seq: 1, keys: 0 })).toBeNull();
  });

  /**
   * Anything this validator accepts must also satisfy the simulation's own validator --
   * the clamp above must not be able to produce a vector shared/sim would refuse.
   */
  it('produces a dir the simulation validator also accepts', () => {
    for (const dir of [
      [0, 0.99, -0.14106735979665894],
      [0, -0.99, -0.14106735979665894],
      [0.6, 0, -0.8],
      [0, 0, -1],
    ]) {
      const parsed = parseClientMessage(input({ dir }));
      if (parsed === null || parsed.t !== 'input') throw new Error('expected an input');
      expect(
        validateInput({
          move: [0, 0, 0],
          dir: parsed.dir,
          jump: false,
          crouch: false,
          sprint: false,
        }),
      ).not.toBeNull();
    }
  });
});

/* ---------------------------------------------------------------- leave ---- */

describe('parseClientMessage — leave (NET-006)', () => {
  it('accepts a bare leave', () => {
    expect(parseClientMessage({ t: 'leave' })).toEqual({ t: 'leave' });
  });

  it('rejects a leave carrying anything else', () => {
    expect(parseClientMessage({ t: 'leave', playerId: 'p_1' })).toBeNull();
  });
});

/* ------------------------------------------------------------- Authority ---- */

describe('the protocol enforces NFR-001 by omission (NET-007)', () => {
  /**
   * M1-9. There is no inbound message that can set an outcome, so there is nothing to
   * validate: the absence is the enforcement. This test states that as an assertion so
   * that adding such a message would have to delete a test rather than merely pass one.
   */
  it('has no client message type beyond join, input and leave', () => {
    for (const t of [
      'damage',
      'kill',
      'setPosition',
      'setHealth',
      'score',
      'respawn',
      'snapshot',
      'joined',
    ]) {
      expect(parseClientMessage({ t, id: 'p_1', hp: 0 })).toBeNull();
    }
  });

  it('drops any outcome-shaped field smuggled into a valid message', () => {
    expect(parseClientMessage(input({ hp: 0 }))).toBeNull();
    expect(parseClientMessage(input({ pos: [0, 0, 0] }))).toBeNull();
    expect(parseClientMessage(input({ vel: [99, 0, 0] }))).toBeNull();
    expect(parseClientMessage(join({ team: 'RED' }))).toBeNull();
  });
});

/* --------------------------------------------------------- Server messages ---- */

const CONFIG = {
  serverTickHz: 30,
  snapshotHz: 20,
  interpolationDelay: 100,
  maxInputsPerSecond: 70,
  playerHeight: 1.8,
  crouchHeight: 1.1,
  playerRadius: 0.4,
  walkSpeed: 5,
  sprintSpeed: 8,
  crouchSpeed: 2.5,
  jumpVelocity: 6,
  gravity: -20,
  airControl: 0.3,
};

function joined(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'joined',
    playerId: 'p_1',
    roomId: 'r_1',
    mode: 'FFA',
    team: null,
    mapId: 'arena-01',
    tickRate: 30,
    config: { ...CONFIG },
    spawn: { pos: [0, 0, 0], yaw: 0 },
    ...overrides,
  };
}

function snapshotPlayer(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: 'p_1', p: [0, 0, 0], v: [0, 0, 0], y: 0, pt: 0, st: 1, ...overrides };
}

describe('parseServerMessage', () => {
  it('rejects anything that is not a message object', () => {
    expect(parseServerMessage(null)).toBeNull();
    expect(parseServerMessage([])).toBeNull();
    expect(parseServerMessage({ t: 'unknown' })).toBeNull();
  });

  it('accepts a well-formed joined', () => {
    expect(parseServerMessage(joined())).toEqual(joined());
  });

  it('accepts a team when one is present', () => {
    expect(parseServerMessage(joined({ team: 'BLUE' }))).not.toBeNull();
    expect(parseServerMessage(joined({ team: 'RED' }))).not.toBeNull();
    expect(parseServerMessage(joined({ team: 'GREEN' }))).toBeNull();
  });

  it('rejects a joined with a bad id, mode, tick rate, config or spawn', () => {
    expect(parseServerMessage(joined({ playerId: '' }))).toBeNull();
    expect(parseServerMessage(joined({ roomId: 7 }))).toBeNull();
    expect(parseServerMessage(joined({ mapId: null }))).toBeNull();
    expect(parseServerMessage(joined({ mode: 'CTF' }))).toBeNull();
    expect(parseServerMessage(joined({ tickRate: 0 }))).toBeNull();
    expect(parseServerMessage(joined({ tickRate: Number.NaN }))).toBeNull();
    expect(parseServerMessage(joined({ tickRate: '30' }))).toBeNull();
    expect(parseServerMessage(joined({ config: null }))).toBeNull();
    expect(
      parseServerMessage(joined({ config: { ...CONFIG, gravity: 'down' } })),
    ).toBeNull();
    expect(parseServerMessage(joined({ config: { serverTickHz: 30 } }))).toBeNull();
    expect(parseServerMessage(joined({ spawn: null }))).toBeNull();
    expect(parseServerMessage(joined({ spawn: { pos: [0, 0, 0] } }))).toBeNull();
    expect(parseServerMessage(joined({ spawn: { pos: 'origin', yaw: 0 } }))).toBeNull();
    expect(
      parseServerMessage(joined({ spawn: { pos: [0, 0, 0], yaw: 'north' } })),
    ).toBeNull();
    expect(parseServerMessage(joined({ extra: 1 }))).toBeNull();
  });

  it('accepts a well-formed snapshot', () => {
    const message = { t: 'snapshot', tick: 5, ack: 3, players: [snapshotPlayer()] };
    expect(parseServerMessage(message)).toEqual(message);
  });

  it('accepts an empty player list — a room can be momentarily empty', () => {
    expect(
      parseServerMessage({ t: 'snapshot', tick: 0, ack: 0, players: [] }),
    ).not.toBeNull();
  });

  it('rejects a snapshot with a bad tick, ack or player list', () => {
    expect(
      parseServerMessage({ t: 'snapshot', tick: -1, ack: 0, players: [] }),
    ).toBeNull();
    expect(
      parseServerMessage({ t: 'snapshot', tick: 1.5, ack: 0, players: [] }),
    ).toBeNull();
    expect(
      parseServerMessage({ t: 'snapshot', tick: 0, ack: -1, players: [] }),
    ).toBeNull();
    expect(
      parseServerMessage({ t: 'snapshot', tick: 0, ack: '0', players: [] }),
    ).toBeNull();
    expect(
      parseServerMessage({ t: 'snapshot', tick: 0, ack: 0, players: {} }),
    ).toBeNull();
    expect(parseServerMessage({ t: 'snapshot', tick: 0, ack: 0 })).toBeNull();
  });

  it('rejects a snapshot containing one malformed player', () => {
    for (const bad of [
      snapshotPlayer({ id: 7 }),
      snapshotPlayer({ p: [0, 0] }),
      snapshotPlayer({ v: null }),
      snapshotPlayer({ y: 'north' }),
      snapshotPlayer({ pt: Number.NaN }),
      snapshotPlayer({ st: -1 }),
      snapshotPlayer({ st: 1.5 }),
      snapshotPlayer({ hp: 100 }),
      'p_1',
    ]) {
      expect(
        parseServerMessage({ t: 'snapshot', tick: 0, ack: 0, players: [bad] }),
      ).toBeNull();
    }
  });

  it('accepts playerJoined and playerLeft, and rejects their malformed forms', () => {
    const arrived = { t: 'playerJoined', id: 'p_2', nickname: 'ana', team: null };
    expect(parseServerMessage(arrived)).toEqual(arrived);
    expect(parseServerMessage({ ...arrived, team: 'RED' })).not.toBeNull();
    expect(parseServerMessage({ ...arrived, team: 'PURPLE' })).toBeNull();
    expect(parseServerMessage({ ...arrived, nickname: 7 })).toBeNull();
    expect(parseServerMessage({ ...arrived, id: '' })).toBeNull();
    expect(parseServerMessage({ t: 'playerJoined', id: 'p_2' })).toBeNull();

    expect(parseServerMessage({ t: 'playerLeft', id: 'p_2' })).toEqual({
      t: 'playerLeft',
      id: 'p_2',
    });
    expect(parseServerMessage({ t: 'playerLeft', id: 7 })).toBeNull();
    expect(parseServerMessage({ t: 'playerLeft' })).toBeNull();
  });

  it('accepts every NET-020 code and rejects an invented one', () => {
    for (const code of [
      'ROOM_FULL',
      'ROOM_NOT_FOUND',
      'INVALID_NICKNAME',
      'INVALID_MODE',
      'RATE_LIMITED',
      'MALFORMED',
      'INTERNAL',
    ]) {
      expect(parseServerMessage({ t: 'error', code, message: 'x' })).not.toBeNull();
    }
    expect(parseServerMessage({ t: 'error', code: 'TEAPOT', message: 'x' })).toBeNull();
    expect(parseServerMessage({ t: 'error', code: 'INTERNAL', message: 7 })).toBeNull();
    expect(parseServerMessage({ t: 'error', code: 'INTERNAL' })).toBeNull();
  });
});
