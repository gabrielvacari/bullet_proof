import type { Vec3 } from '#shared/math/vec3.ts';

/**
 * Every message this project puts on a socket (NET-001).
 *
 * Both runtimes import these, which is what NET-002 means by "defined next to the message
 * types, so client and server cannot drift". A message is an object with a `t` field and
 * nothing else wrapping it -- there is no `data` key and no envelope metadata, so a single
 * switch on `t` routes everything.
 *
 * M1 implements the subset 08-roadmap.md assigns to it. `shot`, `damage`, `hitConfirm`,
 * `kill` and `respawn` arrive in M2; `score`, `matchStart` and `matchEnd` in M3. They are
 * absent rather than stubbed, because a stubbed message is a message that can be sent.
 */

/* -------------------------------------------------------- Client -> server ---- */

/** NET-003. The server replies `joined` or `error`; a second join on one socket is an error. */
export interface JoinMessage {
  readonly t: 'join';
  readonly nickname: string;
  readonly mode: GameMode;
  /** Optional. M1 has one room, so it selects nothing -- private rooms are FR-GP-011, M3. */
  readonly roomCode?: string;
}

/** NET-004. One tick of intent. */
export interface InputMessage {
  readonly t: 'input';
  /** Monotonically increasing per connection. Transport state, never simulation state. */
  readonly seq: number;
  /** The NET-004 bitmask. Decoded by shared/protocol/keys.ts and nowhere else. */
  readonly keys: number;
  /** Unit aim vector -- ADR-0001. Validated and pitch-clamped before use (NET-004c). */
  readonly dir: Vec3;
}

/** NET-006. Treated identically to a socket close (FR-GP-040). */
export interface LeaveMessage {
  readonly t: 'leave';
}

export type ClientMessage = JoinMessage | InputMessage | LeaveMessage;

/**
 * There is deliberately no client message that sets health, position, velocity, score,
 * team or kill status (NET-007). Their absence is the protocol enforcing NFR-001: a
 * validator that rejected such a message would be strictly weaker than a protocol in
 * which it cannot be expressed at all.
 */

/* -------------------------------------------------------- Server -> client ---- */

export type GameMode = 'FFA' | 'TDM';
export type Team = 'BLUE' | 'RED';

/**
 * The NET-008a subset: the tuning values the client needs in order to predict identically.
 * Sending them at join time is what stops a stale bundle from silently simulating a
 * different game from the server's.
 */
export interface ClientConfig {
  readonly serverTickHz: number;
  readonly snapshotHz: number;
  readonly interpolationDelay: number;
  readonly maxInputsPerSecond: number;
  readonly playerHeight: number;
  readonly crouchHeight: number;
  readonly playerRadius: number;
  readonly walkSpeed: number;
  readonly sprintSpeed: number;
  readonly crouchSpeed: number;
  readonly jumpVelocity: number;
  readonly gravity: number;
  readonly airControl: number;
}

/** NET-008. */
export interface JoinedMessage {
  readonly t: 'joined';
  readonly playerId: string;
  readonly roomId: string;
  readonly mode: GameMode;
  /** null in FFA. Team assignment is FR-GP-004, M3. */
  readonly team: Team | null;
  readonly mapId: string;
  readonly tickRate: number;
  readonly config: ClientConfig;
  /**
   * The transform the server has already assigned. Not in NET-008's example and not a new
   * requirement: FR-GP-014 puts the joining player in the arena within one tick, and the
   * client cannot predict from a position it has not been told. Echoing it is what makes
   * prediction and authority start from the same state, which is NFR-003's precondition.
   */
  readonly spawn: { readonly pos: Vec3; readonly yaw: number };
}

/**
 * NET-009. One player's replicated state.
 *
 * `hp` and `am` are absent in M1 because there is no health (FR-GP-034) or ammo
 * (FR-GP-030) yet, and `st` carries only the two bits whose state exists. A field is added
 * by the milestone that adds the thing it reports; the bit positions NET-009 defines stay
 * reserved so nothing is ever renumbered.
 */
export interface SnapshotPlayer {
  readonly id: string;
  /** Position -- the capsule base, as PlayerState carries it. */
  readonly p: Vec3;
  /** Velocity. Needed for interpolation now and for animation in M4. */
  readonly v: Vec3;
  /** Yaw, derived server-side from the last validated `dir`. Presentation only (ADR-0001). */
  readonly y: number;
  /** Pitch, same. */
  readonly pt: number;
  /** State bitmask. M1 sends STATE_GROUNDED and STATE_CROUCHING. */
  readonly st: number;
}

/** NET-009's state bitmask. Positions are permanent; M1 sends the first two. */
export const STATE_GROUNDED = 1;
export const STATE_CROUCHING = 2;

/** NET-009. */
export interface SnapshotMessage {
  readonly t: 'snapshot';
  readonly tick: number;
  /**
   * The last input.seq applied for THIS recipient, which drives NFR-007. It differs per
   * client, so snapshots are serialised per recipient rather than broadcast verbatim --
   * the same seam NET-009's owner-only `am` will use in M2.
   */
  readonly ack: number;
  /** Every living player, regardless of line of sight (NET-009a, FR-GP-049). */
  readonly players: readonly SnapshotPlayer[];
}

/** NET-010. Nicknames travel here, not in the snapshot (NET-009b). */
export interface PlayerJoinedMessage {
  readonly t: 'playerJoined';
  readonly id: string;
  readonly nickname: string;
  readonly team: Team | null;
}

/** NET-011. The client removes the model, the nameplate and all interpolation state. */
export interface PlayerLeftMessage {
  readonly t: 'playerLeft';
  readonly id: string;
}

/** NET-020. The client branches on `code`, never on `message` text. */
export type ErrorCode =
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'INVALID_NICKNAME'
  | 'INVALID_MODE'
  | 'RATE_LIMITED'
  | 'MALFORMED'
  | 'INTERNAL';

export interface ErrorMessage {
  readonly t: 'error';
  readonly code: ErrorCode;
  /** For display only. Never parsed, never branched on. */
  readonly message: string;
}

export type ServerMessage =
  | JoinedMessage
  | SnapshotMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | ErrorMessage;
