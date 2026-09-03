import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_INPUTS_PER_SECOND,
  MAX_MALFORMED_MESSAGES,
  MS_PER_SECOND,
} from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import type { GameMap } from '#shared/map/types.ts';
import { decode, encode } from '#shared/protocol/encode.ts';
import { KEY_FORWARD } from '#shared/protocol/keys.ts';
import type { ServerMessage } from '#shared/protocol/types.ts';

import { type Room, createRoom } from '../room/room.ts';
import { createSession } from './connection.ts';
import type { Connection } from './transport.ts';

/**
 * User Story 4: a hostile client reaches nothing and costs no one else anything.
 *
 * The session is the layer that holds what shared/protocol cannot -- seq monotonicity and
 * the rate-limit budget are per connection, and shared/ must stay pure.
 */

const MAP: GameMap = loadMap(
  JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')) as unknown,
);

function fakeConnection(id = 'c_1'): Connection & {
  sent: ServerMessage[];
  closes: number;
} {
  const sent: ServerMessage[] = [];
  let closes = 0;

  return {
    id,
    sent,
    get closes() {
      return closes;
    },
    send(text) {
      sent.push(decode(text) as ServerMessage);
    },
    close() {
      closes += 1;
    },
    onMessage() {
      /* the tests call handle() directly */
    },
    onClose() {
      /* the tests call disconnect() directly */
    },
  };
}

const JOIN = encode({ t: 'join', nickname: 'gabriel', mode: 'FFA' });

function input(seq: number, keys = KEY_FORWARD): string {
  return encode({ t: 'input', seq, keys, dir: [0, 0, -1] });
}

function errorsIn(sent: ServerMessage[]): string[] {
  return sent.filter((m) => m.t === 'error').map((m) => m.code);
}

let room: Room;

beforeEach(() => {
  room = createRoom('r_test', MAP);
});

describe('joining through a socket (NET-003)', () => {
  it('adds the player and replies joined', () => {
    const connection = fakeConnection();
    createSession(connection, room, 0).handle(JOIN, 0);

    expect(room.playerCount).toBe(1);
    expect(connection.sent[0]?.t).toBe('joined');
  });

  it('refuses a second join on the same socket rather than adding a player', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);

    session.handle(JOIN, 0);
    session.handle(JOIN, 0);

    expect(room.playerCount).toBe(1);
    expect(errorsIn(connection.sent)).toEqual(['MALFORMED']);
  });

  it('closes a socket whose join was refused, rather than leaving it holding nothing', () => {
    const full = createRoom('r_full', MAP);
    for (let i = 0; i < 10; i += 1) {
      createSession(fakeConnection(`c_${String(i)}`), full, 0).handle(JOIN, 0);
    }

    const late = fakeConnection('c_late');
    createSession(late, full, 0).handle(JOIN, 0);

    expect(errorsIn(late.sent)).toEqual(['ROOM_FULL']);
    expect(late.closes).toBe(1);
  });
});

describe('inputs (NET-004, NET-004a)', () => {
  it('reaches the room only after joining', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);

    session.handle(input(1), 0);
    expect(room.playerCount).toBe(0);
    expect(errorsIn(connection.sent)).toEqual(['MALFORMED']);
  });

  it('is queued for the player once joined', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);
    session.handle(input(1), 0);

    room.tick();
    expect(room.player('p_c_1')?.lastSeq).toBe(1);
  });

  /** A replayed input would be simulated twice, which is movement for free. */
  it('drops a replayed or reordered seq without counting it as malformed', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    session.handle(input(5), 0);
    session.handle(input(5), 0);
    session.handle(input(3), 0);

    room.tick();
    expect(room.player('p_c_1')?.lastSeq).toBe(5);
    room.tick();
    // Nothing else was queued, so the second tick had no input to apply.
    expect(room.player('p_c_1')?.lastSeq).toBe(5);
    expect(errorsIn(connection.sent)).toEqual([]);
  });

  it('accepts a seq that keeps increasing', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    for (let seq = 1; seq <= 3; seq += 1) session.handle(input(seq), 0);
    room.tick();
    room.tick();
    room.tick();

    expect(room.player('p_c_1')?.lastSeq).toBe(3);
  });
});

describe('rate limiting (NFR-010)', () => {
  it('throttles a flood and warns exactly once, not once per message', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    for (let seq = 1; seq <= MAX_INPUTS_PER_SECOND * 3; seq += 1) {
      session.handle(input(seq), 0);
    }

    expect(errorsIn(connection.sent)).toEqual(['RATE_LIMITED']);
  });

  it('does not close the flooding socket -- throttling is not disconnection', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    for (let seq = 1; seq <= MAX_INPUTS_PER_SECOND * 3; seq += 1) {
      session.handle(input(seq), 0);
    }

    expect(connection.closes).toBe(0);
    expect(room.playerCount).toBe(1);
  });

  it('warns again after the client has recovered and floods a second time', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    let seq = 0;
    const flood = (at: number): void => {
      for (let i = 0; i <= MAX_INPUTS_PER_SECOND * 2; i += 1) {
        seq += 1;
        session.handle(input(seq), at);
      }
    };

    flood(0);
    flood(MS_PER_SECOND * 10);
    expect(errorsIn(connection.sent)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
  });

  it('lets an honest client through untouched', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    for (let seq = 1; seq <= 30; seq += 1) {
      session.handle(input(seq), seq * (MS_PER_SECOND / 30));
    }
    expect(errorsIn(connection.sent)).toEqual([]);
  });
});

describe('malformed messages (NFR-011)', () => {
  it.each([
    ['not JSON at all', 'nonsense'],
    ['an unknown type', '{"t":"shoot"}'],
    ['the dt smuggling attempt', '{"t":"input","dt":999999}'],
    ['a NaN aim vector', '{"t":"input","seq":1,"keys":0,"dir":[null,0,-1]}'],
    ['an over-long aim vector', '{"t":"input","seq":1,"keys":0,"dir":[0,0,-2]}'],
    ['an outcome-shaped field', '{"t":"input","seq":1,"keys":0,"dir":[0,0,-1],"hp":0}'],
  ])('discards %s and answers MALFORMED', (_label, text) => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);
    session.handle(text, 0);

    expect(errorsIn(connection.sent)).toEqual(['MALFORMED']);
    expect(room.playerCount).toBe(1);
  });

  it('leaves the simulation untouched', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);
    const before = room.player('p_c_1')?.state;

    session.handle('{"t":"input","dt":999999}', 0);
    expect(room.player('p_c_1')?.state).toBe(before);
  });

  it('closes the connection once the count reaches MAX_MALFORMED_MESSAGES', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    for (let i = 0; i < MAX_MALFORMED_MESSAGES - 1; i += 1) session.handle('junk', 0);
    expect(connection.closes).toBe(0);

    session.handle('junk', 0);
    expect(connection.closes).toBe(1);
  });

  /** A client dripping garbage slowly is still a client sending garbage. */
  it('does not reset the count on an intervening valid message', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    for (let i = 0; i < MAX_MALFORMED_MESSAGES; i += 1) {
      session.handle('junk', 0);
      session.handle(input(i + 1), 0);
    }

    expect(connection.closes).toBe(1);
  });
});

describe('leaving (NET-006, FR-GP-040)', () => {
  it('closes the socket on leave, so both paths are the same code', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    session.handle(encode({ t: 'leave' }), 0);
    expect(connection.closes).toBe(1);
  });

  it('removes the player when the socket closes', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);
    session.handle(JOIN, 0);

    session.disconnect();
    expect(room.playerCount).toBe(0);
  });

  it('is idempotent, so a double close cannot remove someone else', () => {
    const first = fakeConnection('c_1');
    const second = fakeConnection('c_2');
    const session = createSession(first, room, 0);
    session.handle(JOIN, 0);
    createSession(second, room, 0).handle(JOIN, 0);

    session.disconnect();
    session.disconnect();
    expect(room.playerCount).toBe(1);
  });

  it('does nothing when a socket that never joined closes', () => {
    const connection = fakeConnection();
    const session = createSession(connection, room, 0);

    expect(() => {
      session.disconnect();
    }).not.toThrow();
    expect(room.playerCount).toBe(0);
  });
});
