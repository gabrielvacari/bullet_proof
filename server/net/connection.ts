import { MAX_MALFORMED_MESSAGES } from '#shared/constants/index.ts';
import { decode, encode } from '#shared/protocol/encode.ts';
import type { ErrorCode, ErrorMessage } from '#shared/protocol/types.ts';
import { parseClientMessage } from '#shared/protocol/validate.ts';

import type { Room } from '../room/room.ts';
import { type Bucket, createBucket, take } from './rate-limit.ts';
import type { Connection } from './transport.ts';

/**
 * Everything the server must know in order to distrust one socket.
 *
 * Deliberately **not** the player. A socket closing must not be able to leave a
 * half-removed player inside a tick that is already running, so the two are separate
 * objects with one direction of reference (FR-GP-040).
 *
 * This is also the layer that holds the state `shared/protocol` cannot: `seq` monotonicity
 * and the rate-limit budget are per connection, and `shared/` must stay pure.
 */

export interface Session {
  /** Called for every text frame the transport delivers. */
  handle(text: string, nowMs: number): void;
  /** Called when the socket closes, from either end. */
  disconnect(): void;
}

export function createSession(
  connection: Connection,
  room: Room,
  nowMs: number,
): Session {
  let playerId: string | null = null;
  let bucket: Bucket = createBucket(nowMs);
  let lastSeq = 0;
  let malformed = 0;
  /** RATE_LIMITED is sent once per throttling episode, not once per dropped message. */
  let throttled = false;

  const fail = (code: ErrorCode, message: string): void => {
    const error: ErrorMessage = { t: 'error', code, message };
    connection.send(encode(error));
  };

  /**
   * NFR-011: "malformed messages are discarded and, on repetition, the connection is
   * closed". The counter is not reset by an intervening valid message -- a client dripping
   * garbage slowly is still a client sending garbage, and a reset would make the limit
   * unreachable by exactly the client it is for.
   */
  const reject = (): void => {
    malformed += 1;
    fail('MALFORMED', 'Message rejected.');
    if (malformed >= MAX_MALFORMED_MESSAGES) connection.close();
  };

  return {
    handle(text, at) {
      const message = parseClientMessage(decode(text));
      if (message === null) {
        reject();
        return;
      }

      switch (message.t) {
        case 'join': {
          // NET-003: sending join twice on one socket is an error, not a second player.
          if (playerId !== null) {
            fail('MALFORMED', 'Already joined.');
            return;
          }

          const outcome = room.join(connection.id, message, connection);
          if (!outcome.ok) {
            fail(outcome.code, outcome.message);
            // A refused join leaves the socket holding nothing. Closing it is what stops
            // a rejected client from sitting on a connection for free.
            connection.close();
            return;
          }
          playerId = outcome.player.id;
          return;
        }

        case 'input': {
          // An input before joining has no player to apply it to. Treated as malformed,
          // because a well-behaved client cannot produce one.
          if (playerId === null) {
            reject();
            return;
          }

          const result = take(bucket, at);
          bucket = result.bucket;
          if (!result.allowed) {
            if (!throttled) {
              throttled = true;
              fail('RATE_LIMITED', 'Too many inputs.');
            }
            return;
          }
          throttled = false;

          // A replayed or reordered seq would be simulated twice, which is movement for
          // free. Dropped silently: TCP reordering is not the client's fault.
          if (message.seq <= lastSeq) return;
          lastSeq = message.seq;

          room.enqueue(playerId, message);
          return;
        }

        case 'leave': {
          // NET-006: identical to a socket close, down to the same code path.
          connection.close();
          return;
        }
      }
    },

    disconnect() {
      if (playerId === null) return;
      room.leave(playerId);
      playerId = null;
    },
  };
}
