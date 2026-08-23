import { type Server, createServer } from 'node:http';
import type { Duplex } from 'node:stream';

import { WS_PATH } from '#shared/constants/index.ts';

import type { Connection, Transport } from '../transport.ts';
import {
  CLOSE_NORMAL,
  CLOSE_PROTOCOL_ERROR,
  CLOSE_TOO_LARGE,
  OPCODE_CLOSE,
  OPCODE_PING,
  OPCODE_TEXT,
  type PendingFragment,
  closeFrame,
  decodeFrames,
  encodeText,
  pongFrame,
} from './frame.ts';
import { isUpgradeAcceptable, rejectResponse, upgradeResponse } from './handshake.ts';

/**
 * A `Transport` over node:http, adding no dependency (research.md R2, gate OQ-B).
 *
 * This file is the thin part: the decisions live in frame.ts and handshake.ts, which are
 * pure and fully covered. What is left here is socket plumbing, and it is exercised
 * end-to-end by server/integration.test.ts against Node's own WebSocket client -- the only
 * test that would catch a wiring mistake the unit tests are blind to.
 */

let nextConnectionId = 0;

export function createWsTransport(server: Server): Transport {
  let onConnection: ((connection: Connection) => void) | null = null;

  server.on('upgrade', (request, socket: Duplex, head: Buffer) => {
    if (!isUpgradeAcceptable(request.headers, request.url, WS_PATH)) {
      socket.write(rejectResponse());
      socket.destroy();
      return;
    }

    // isUpgradeAcceptable has already established that this is a 24-character string.
    const key = request.headers['sec-websocket-key'] as string;
    socket.write(upgradeResponse(key));

    const connection = attach(socket);
    onConnection?.(connection);

    // Bytes that arrived in the same packet as the handshake are already in `head`.
    if (head.length > 0) socket.emit('data', head);
  });

  return {
    onConnection(handler) {
      onConnection = handler;
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** Wraps one upgraded socket as a Connection. */
function attach(socket: Duplex): Connection {
  nextConnectionId += 1;
  const id = `c_${String(nextConnectionId)}`;

  let onMessage: ((text: string) => void) | null = null;
  let onClose: (() => void) | null = null;
  let closed = false;
  let buffered = Buffer.alloc(0);
  let fragment: PendingFragment | null = null;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    socket.destroy();
    onClose?.();
  };

  const shutdown = (code: number): void => {
    if (!closed) socket.write(closeFrame(code));
    finish();
  };

  socket.on('data', (chunk: Buffer) => {
    if (closed) return;
    buffered =
      buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, chunk]);

    const result = decodeFrames(buffered, fragment);
    buffered = Buffer.from(result.rest);
    fragment = result.pending;

    for (const frame of result.frames) {
      if (frame.opcode === OPCODE_TEXT) {
        onMessage?.(frame.payload);
      } else if (frame.opcode === OPCODE_PING) {
        socket.write(pongFrame(Buffer.from(frame.payload, 'utf8')));
      } else if (frame.opcode === OPCODE_CLOSE) {
        shutdown(CLOSE_NORMAL);
        return;
      }
      // A pong needs no answer: this server never sends a ping.
    }

    if (result.error !== null) {
      shutdown(result.error === 'TOO_LARGE' ? CLOSE_TOO_LARGE : CLOSE_PROTOCOL_ERROR);
    }
  });

  socket.on('close', finish);
  socket.on('error', finish);

  return {
    id,
    send(text) {
      if (!closed) socket.write(encodeText(text));
    },
    close(code = CLOSE_NORMAL) {
      shutdown(code);
    },
    onMessage(handler) {
      onMessage = handler;
    },
    onClose(handler) {
      onClose = handler;
    },
  };
}

/** Convenience for the entry point and the integration tests: an http server plus its transport. */
export function listen(port: number): Promise<{ server: Server; transport: Transport }> {
  const server = createServer((_request, response) => {
    // The client is served by Vite in development; this process serves only the socket.
    response.writeHead(404);
    response.end();
  });
  const transport = createWsTransport(server);

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({ server, transport });
    });
  });
}
