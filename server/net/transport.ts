/**
 * The seam between the game and the socket.
 *
 * Everything above this line -- the room, the connection state, the tick -- speaks only
 * these two interfaces and has never heard of a frame, a mask or a handshake.
 *
 * That is deliberate, and gate `OQ-B` proved it. M1 could not add `ws` without the project
 * owner's approval, so it first shipped a hand-rolled RFC 6455 codec. When the dependency
 * was approved, swapping it for `ws` replaced one directory below this seam and changed
 * nothing above it -- not the room, not the session, not a single test of either.
 */

export interface Transport {
  /** Called once per accepted socket, after the handshake has completed. */
  onConnection(handler: (connection: Connection) => void): void;
  close(): Promise<void>;
}

export interface Connection {
  /** Stable for the life of the socket. Not a player id -- a socket may never join. */
  readonly id: string;
  send(text: string): void;
  /** Closes the socket. `onClose` still fires, so callers need only one removal path. */
  close(code?: number): void;
  onMessage(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
}
