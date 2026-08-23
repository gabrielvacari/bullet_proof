import { WS_PATH } from '#shared/constants/index.ts';
import { decode, encode } from '#shared/protocol/encode.ts';
import type {
  ClientMessage,
  ErrorMessage,
  JoinedMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  ServerMessage,
  SnapshotMessage,
} from '#shared/protocol/types.ts';
import { parseServerMessage } from '#shared/protocol/validate.ts';

/**
 * The WebSocket shell, and nothing more.
 *
 * Every rule this file could have held has been extracted: the buffer is in
 * interpolation.ts, the replay is in prediction.ts, the parsing is in shared/protocol.
 * What is left is `addEventListener` and a switch, which is the *only* reason
 * vitest.config.ts may exclude it from coverage -- the same bargain M0 struck for
 * client/input/pointer-lock.ts. If a decision ever appears here, it comes out into a
 * tested module rather than the exclusion staying.
 *
 * The URL is the page's own origin: Vite proxies WS_PATH to the server, so two browsers
 * reach the same match by opening the same address twice and there is nothing to configure.
 */

export interface SocketHandlers {
  /** The socket is ready; the caller sends `join` from here (NET-003). */
  onOpen(): void;
  onJoined(message: JoinedMessage): void;
  onSnapshot(message: SnapshotMessage, receivedAtMs: number): void;
  onPlayerJoined(message: PlayerJoinedMessage): void;
  onPlayerLeft(message: PlayerLeftMessage): void;
  onError(message: ErrorMessage): void;
  /** A socket that closed or failed. NFR-013: a readable state, not a frozen canvas. */
  onDisconnected(reason: string): void;
}

export interface GameSocket {
  send(message: ClientMessage): void;
  close(): void;
}

export function connect(handlers: SocketHandlers): GameSocket {
  const scheme = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${scheme}//${globalThis.location.host}${WS_PATH}`);

  socket.addEventListener('open', () => {
    handlers.onOpen();
  });

  socket.addEventListener('message', (event: MessageEvent<string>) => {
    // Every inbound message goes through the shared validator. A server that has drifted
    // from this bundle fails the same way a hostile peer would (NFR-013).
    const message: ServerMessage | null = parseServerMessage(decode(event.data));
    if (message === null) return;

    switch (message.t) {
      case 'joined':
        handlers.onJoined(message);
        return;
      case 'snapshot':
        handlers.onSnapshot(message, Date.now());
        return;
      case 'playerJoined':
        handlers.onPlayerJoined(message);
        return;
      case 'playerLeft':
        handlers.onPlayerLeft(message);
        return;
      case 'error':
        handlers.onError(message);
        return;
    }
  });

  socket.addEventListener('close', () => {
    handlers.onDisconnected('The connection to the server was lost.');
  });
  socket.addEventListener('error', () => {
    handlers.onDisconnected('The connection to the server failed.');
  });

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(encode(message));
    },
    close() {
      socket.close();
    },
  };
}
