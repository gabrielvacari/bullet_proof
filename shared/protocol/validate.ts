import {
  AIM_DIR_Y_MAX,
  AIM_DIR_Y_MIN,
  AIM_EPSILON,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  ROOM_CODE_LENGTH,
} from '#shared/constants/index.ts';
import { type Vec3, isFinite3, lengthSquared, scale } from '#shared/math/vec3.ts';

import { KEY_MASK_ALL } from './keys.ts';
import type {
  ClientConfig,
  ClientMessage,
  ErrorCode,
  GameMode,
  InputMessage,
  JoinMessage,
  LeaveMessage,
  ServerMessage,
  SnapshotPlayer,
} from './types.ts';

/**
 * The NFR-011 boundary. Every field of every inbound message is checked for presence,
 * type and range here, before any game logic can see it (NET-002).
 *
 * Nothing in this file throws, for any input at all. From M1 these functions run on bytes
 * that arrived over a socket, inside a process that is also running someone else's match:
 * a throw here is an outage for every player in the room, and NFR-015 requires an
 * exception in one room not to stop another's. A message is either valid or it does not
 * exist -- there is no partial result.
 */

/** Not a gameplay number: the arity of a 3-vector. Named so the literal scan can tell. */
const VEC3_ARITY = 3;

/** FR-GP-008. Letters, digits, underscore and hyphen -- nothing that is markup. */
const NICKNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** FR-GP-012's alphabet, minus the glyphs that cannot be read aloud without ambiguity. */
const ROOM_CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]+$/;

const MODES: readonly string[] = ['FFA', 'TDM'];

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const object = asObject(raw);
  if (object === null) return null;

  switch (object['t']) {
    case 'join':
      return parseJoin(object);
    case 'input':
      return parseInput(object);
    case 'leave':
      return parseLeave(object);
    default:
      // An unrecognised type is ignored, not an error -- NET-001.
      return null;
  }
}

/**
 * The client's half of the boundary.
 *
 * A client trusts its server far more than a server trusts a client, but a bundle talking
 * to the wrong version of a server fails the same way a hostile peer would, and NFR-013
 * asks for a readable failure rather than a frozen canvas. Every field the client acts on
 * is checked here, and an unparseable message is dropped rather than thrown.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  const object = asObject(raw);
  if (object === null) return null;

  switch (object['t']) {
    case 'joined':
      return parseJoined(object);
    case 'snapshot':
      return parseSnapshot(object);
    case 'playerJoined':
      return parsePlayerJoined(object);
    case 'playerLeft':
      return parsePlayerLeft(object);
    case 'error':
      return parseError(object);
    default:
      return null;
  }
}

/* -------------------------------------------------------------- Client ---- */

function parseJoin(raw: Record<string, unknown>): JoinMessage | null {
  const hasRoomCode = 'roomCode' in raw;
  if (!hasExactKeys(raw, hasRoomCode ? JOIN_KEYS_WITH_CODE : JOIN_KEYS)) return null;

  const nickname = raw['nickname'];
  if (typeof nickname !== 'string') return null;
  if (nickname.length < NICKNAME_MIN_LENGTH) return null;
  if (nickname.length > NICKNAME_MAX_LENGTH) return null;
  if (!NICKNAME_PATTERN.test(nickname)) return null;

  const mode = raw['mode'];
  if (typeof mode !== 'string' || !MODES.includes(mode)) return null;

  if (!hasRoomCode) return { t: 'join', nickname, mode: mode as GameMode };

  const roomCode = raw['roomCode'];
  if (typeof roomCode !== 'string') return null;
  if (roomCode.length !== ROOM_CODE_LENGTH) return null;
  if (!ROOM_CODE_PATTERN.test(roomCode)) return null;

  return { t: 'join', nickname, mode: mode as GameMode, roomCode };
}

function parseInput(raw: Record<string, unknown>): InputMessage | null {
  if (!hasExactKeys(raw, INPUT_KEYS)) return null;

  const seq = raw['seq'];
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= 0) return null;

  const keys = raw['keys'];
  if (typeof keys !== 'number' || !Number.isSafeInteger(keys)) return null;
  if (keys < 0 || keys > KEY_MASK_ALL) return null;

  const dir = clampAim(asVec3(raw['dir']));
  if (dir === null) return null;

  return { t: 'input', seq, keys, dir };
}

function parseLeave(raw: Record<string, unknown>): LeaveMessage | null {
  return hasExactKeys(raw, LEAVE_KEYS) ? { t: 'leave' } : null;
}

/**
 * NET-004c. A non-unit vector is rejected outright -- a longer one would scale straight
 * into velocity and buy the sender free speed. A vector that is unit length but aimed
 * outside the pitch cone is **clamped**, not rejected, because NET-004c says the server
 * enforces the limits by clamping, and because dropping the message would drop a tick of
 * movement and stutter a player who merely looked up too far.
 *
 * The one case that cannot be clamped is a vector pointing exactly up or exactly down: it
 * has no horizontal component, so there is no heading left to preserve once the vertical
 * one is cut. That is rejected. Every legal in-cone vector has a horizontal length of at
 * least about 0.36, so no honest client can reach this path.
 */
function clampAim(dir: Vec3 | null): Vec3 | null {
  if (dir === null) return null;

  const low = 1 - AIM_EPSILON;
  const high = 1 + AIM_EPSILON;
  const lengthSq = lengthSquared(dir);
  if (lengthSq < low * low || lengthSq > high * high) return null;

  if (dir[1] >= AIM_DIR_Y_MIN && dir[1] <= AIM_DIR_Y_MAX) return dir;

  const y = dir[1] < AIM_DIR_Y_MIN ? AIM_DIR_Y_MIN : AIM_DIR_Y_MAX;
  const horizontalSq = dir[0] * dir[0] + dir[2] * dir[2];
  if (horizontalSq === 0) return null;

  // Rescale the horizontal part so the clamped vector is a unit vector again. Only
  // multiplication and Math.sqrt, both exactly specified -- ADR-0001.
  const wanted = Math.sqrt(1 - y * y);
  const factor = wanted / Math.sqrt(horizontalSq);
  const scaled = scale(dir, factor);
  return [scaled[0], y, scaled[2]];
}

/* -------------------------------------------------------------- Server ---- */

function parseJoined(raw: Record<string, unknown>): ServerMessage | null {
  if (!hasExactKeys(raw, JOINED_KEYS)) return null;

  const playerId = asId(raw['playerId']);
  const roomId = asId(raw['roomId']);
  const mapId = asId(raw['mapId']);
  if (playerId === null || roomId === null || mapId === null) return null;

  const mode = raw['mode'];
  if (typeof mode !== 'string' || !MODES.includes(mode)) return null;

  const team = raw['team'];
  if (team !== null && team !== 'BLUE' && team !== 'RED') return null;

  const tickRate = raw['tickRate'];
  if (typeof tickRate !== 'number' || !Number.isFinite(tickRate) || tickRate <= 0) {
    return null;
  }

  const config = asConfig(raw['config']);
  if (config === null) return null;

  const spawn = asObject(raw['spawn']);
  if (spawn === null || !hasExactKeys(spawn, SPAWN_KEYS)) return null;
  const pos = asVec3(spawn['pos']);
  const yaw = spawn['yaw'];
  if (pos === null || typeof yaw !== 'number' || !Number.isFinite(yaw)) return null;

  return {
    t: 'joined',
    playerId,
    roomId,
    mode: mode as GameMode,
    team,
    mapId,
    tickRate,
    config,
    spawn: { pos, yaw },
  };
}

function parseSnapshot(raw: Record<string, unknown>): ServerMessage | null {
  if (!hasExactKeys(raw, SNAPSHOT_KEYS)) return null;

  const tick = raw['tick'];
  const ack = raw['ack'];
  if (typeof tick !== 'number' || !Number.isSafeInteger(tick) || tick < 0) return null;
  if (typeof ack !== 'number' || !Number.isSafeInteger(ack) || ack < 0) return null;

  const rawPlayers = raw['players'];
  if (!Array.isArray(rawPlayers)) return null;

  const players: SnapshotPlayer[] = [];
  for (const entry of rawPlayers as unknown[]) {
    const player = asSnapshotPlayer(entry);
    if (player === null) return null;
    players.push(player);
  }

  return { t: 'snapshot', tick, ack, players };
}

function asSnapshotPlayer(value: unknown): SnapshotPlayer | null {
  const raw = asObject(value);
  if (raw === null || !hasExactKeys(raw, SNAPSHOT_PLAYER_KEYS)) return null;

  const id = asId(raw['id']);
  const p = asVec3(raw['p']);
  const v = asVec3(raw['v']);
  if (id === null || p === null || v === null) return null;

  const y = raw['y'];
  const pt = raw['pt'];
  const st = raw['st'];
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof pt !== 'number' || !Number.isFinite(pt)) return null;
  if (typeof st !== 'number' || !Number.isSafeInteger(st) || st < 0) return null;

  return { id, p, v, y, pt, st };
}

function parsePlayerJoined(raw: Record<string, unknown>): ServerMessage | null {
  if (!hasExactKeys(raw, PLAYER_JOINED_KEYS)) return null;

  const id = asId(raw['id']);
  const nickname = raw['nickname'];
  const team = raw['team'];
  if (id === null || typeof nickname !== 'string') return null;
  if (team !== null && team !== 'BLUE' && team !== 'RED') return null;

  return { t: 'playerJoined', id, nickname, team };
}

function parsePlayerLeft(raw: Record<string, unknown>): ServerMessage | null {
  if (!hasExactKeys(raw, PLAYER_LEFT_KEYS)) return null;
  const id = asId(raw['id']);
  return id === null ? null : { t: 'playerLeft', id };
}

function parseError(raw: Record<string, unknown>): ServerMessage | null {
  if (!hasExactKeys(raw, ERROR_KEYS)) return null;

  const code = raw['code'];
  const message = raw['message'];
  if (typeof code !== 'string' || !ERROR_CODES.includes(code)) return null;
  if (typeof message !== 'string') return null;

  return { t: 'error', code: code as ErrorCode, message };
}

/**
 * NET-008a's config. Validated as a whole rather than field by field: every value the
 * server sends is a finite number, and a config that has drifted in shape is exactly as
 * unusable as one that has drifted in type.
 */
function asConfig(value: unknown): ClientConfig | null {
  const raw = asObject(value);
  if (raw === null || !hasExactKeys(raw, CONFIG_KEYS)) return null;

  for (const key of CONFIG_KEYS) {
    const entry = raw[key];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
  }
  return raw as unknown as ClientConfig;
}

/* ---------------------------------------------------------------- Shared ---- */

const JOINED_KEYS: readonly string[] = [
  't',
  'playerId',
  'roomId',
  'mode',
  'team',
  'mapId',
  'tickRate',
  'config',
  'spawn',
];
const SPAWN_KEYS: readonly string[] = ['pos', 'yaw'];
const SNAPSHOT_KEYS: readonly string[] = ['t', 'tick', 'ack', 'players'];
const SNAPSHOT_PLAYER_KEYS: readonly string[] = ['id', 'p', 'v', 'y', 'pt', 'st'];
const PLAYER_JOINED_KEYS: readonly string[] = ['t', 'id', 'nickname', 'team'];
const PLAYER_LEFT_KEYS: readonly string[] = ['t', 'id'];
const ERROR_KEYS: readonly string[] = ['t', 'code', 'message'];
const CONFIG_KEYS: readonly (keyof ClientConfig)[] = [
  'serverTickHz',
  'snapshotHz',
  'interpolationDelay',
  'maxInputsPerSecond',
  'playerHeight',
  'crouchHeight',
  'playerRadius',
  'walkSpeed',
  'sprintSpeed',
  'crouchSpeed',
  'jumpVelocity',
  'gravity',
  'airControl',
];
const ERROR_CODES: readonly string[] = [
  'ROOM_FULL',
  'ROOM_NOT_FOUND',
  'INVALID_NICKNAME',
  'INVALID_MODE',
  'RATE_LIMITED',
  'MALFORMED',
  'INTERNAL',
];

const JOIN_KEYS: readonly string[] = ['t', 'nickname', 'mode'];
const JOIN_KEYS_WITH_CODE: readonly string[] = ['t', 'nickname', 'mode', 'roomCode'];
const INPUT_KEYS: readonly string[] = ['t', 'seq', 'keys', 'dir'];
const LEAVE_KEYS: readonly string[] = ['t'];

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Rejects extra fields as well as missing ones. An unrecognised field is either a client
 * that has drifted from the protocol or an attempt to smuggle state past the validator --
 * `{"t":"input","dt":999999}` is exactly the case NFR-011 names -- and neither should be
 * accepted silently.
 */
function hasExactKeys(
  raw: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(raw);
  if (keys.length !== expected.length) return false;
  return expected.every((key) => key in raw);
}

/** A non-empty string. Ids are opaque -- the client never parses one (FR-GP-009). */
function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== VEC3_ARITY) return null;
  const [x, y, z] = value as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number')
    return null;
  const vec: Vec3 = [x, y, z];
  return isFinite3(vec) ? vec : null;
}
