import { type Server, createServer } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import { MAX_MESSAGE_BYTES, WS_PATH } from '#shared/constants/index.ts';

import type { Connection, Transport } from './transport.ts';

/**
 * A `Transport` over the `ws` library (gate `OQ-B`, approved by the project owner).
 *
 * This file is deliberately thin. Everything above the `Transport` seam -- the room, the
 * session, the tick -- has never heard of a frame, a mask or a handshake, and that did not
 * change when the implementation underneath did. Swapping the hand-rolled RFC 6455 codec
 * for `ws` replaced one directory and touched nothing else.
 *
 * `ws` also absorbs three things the hand-rolled version had to carry itself: fragmented
 * message reassembly, ping/pong, and the payload cap -- `maxPayload` enforces
 * MAX_MESSAGE_BYTES at the frame level, so an oversized message never reaches a buffer we
 * own (NFR-010).
 */

/** RFC 6455 §7.4.1. The server is shutting down. */
const CLOSE_GOING_AWAY = 1001;

let nextConnectionId = 0;

export function createWsTransport(server: Server): Transport {
  let onConnection: ((connection: Connection) => void) | null = null;

  const wss = new WebSocketServer({
    server,
    path: WS_PATH,
    maxPayload: MAX_MESSAGE_BYTES,
  });

  /**
   * The sockets this transport owns.
   *
   * An upgraded socket is no longer the HTTP server's business, so `server.close()` waits
   * on it forever without ever being able to close it -- and `wss.close()` does not close
   * connected clients either. Shutting the process down cleanly means closing them here
   * first. Without this the integration tests hang, which is how it was found the first
   * time; the library does not save us from it.
   */
  const live = new Set<WebSocket>();

  wss.on('connection', (socket: WebSocket) => {
    live.add(socket);
    socket.on('close', () => live.delete(socket));
    onConnection?.(attach(socket));
  });

  return {
    onConnection(handler) {
      onConnection = handler;
    },

    async close() {
      for (const socket of live) socket.close(CLOSE_GOING_AWAY);
      live.clear();
      await new Promise<void>((resolve) => {
        wss.close(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function attach(socket: WebSocket): Connection {
  nextConnectionId += 1;
  const id = `c_${String(nextConnectionId)}`;

  return {
    id,

    send(text) {
      // A socket can close between the room deciding to broadcast and the write landing.
      // That is ordinary, not an error: the close handler removes the player either way.
      if (socket.readyState === socket.OPEN) socket.send(text);
    },

    close(code) {
      socket.close(code);
    },

    onMessage(handler) {
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        // The protocol is JSON text (NET-001). A binary frame is not a message we have a
        // handler for, so it is dropped rather than coerced into one.
        if (isBinary) return;
        handler(data.toString('utf8'));
      });
    },

    onClose(handler) {
      socket.on('close', handler);
      // An error always precedes a close on a ws socket, so the close handler is the only
      // removal path. Swallowing it here keeps an ECONNRESET from crashing the process.
      socket.on('error', () => {
        /* handled by close */
      });
    },
  };
}

export function listen(port: number): Promise<{ server: Server; transport: Transport }> {
  const server = createServer();
  const transport = createWsTransport(server);
  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({ server, transport });
    });
  });
}
