import { AIM_DIR_Y_MAX, AIM_DIR_Y_MIN, AIM_EPSILON } from '#shared/constants/index.ts';
import { type Vec3, isFinite3, lengthSquared } from '#shared/math/vec3.ts';

import type { PlayerInput } from './types.ts';

/**
 * The NFR-011 security boundary.
 *
 * Written in M0 even though nothing untrusted reaches it yet: M1 must not have to invent
 * it under pressure, and writing it now forces PlayerInput's shape to be validatable --
 * which is exactly the property that makes NFR-001 hold once inputs arrive over a socket.
 *
 * Returns null rather than throwing. A malformed message is discarded (NET-002); it must
 * not be able to interrupt a room's tick loop, because NFR-015 requires an exception in
 * one room not to stop another's.
 */
export function validateInput(value: unknown): PlayerInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  if (!hasExactKeys(raw)) return null;

  const move = asVec3(raw['move']);
  const dir = asVec3(raw['dir']);
  if (move === null || dir === null) return null;

  // Ground movement is horizontal by definition; a Y component would be an attempt to
  // move vertically without jumping.
  if (move[1] !== 0) return null;

  // A movement vector longer than 1 would buy the sender extra speed for free.
  if (lengthSquared(move) > 1 + AIM_EPSILON) return null;

  // A non-unit aim vector scales into velocity the same way, so it is rejected rather
  // than silently normalised -- NET-004c.
  const dirLengthSq = lengthSquared(dir);
  if (dirLengthSq < (1 - AIM_EPSILON) ** 2 || dirLengthSq > (1 + AIM_EPSILON) ** 2) {
    return null;
  }

  // Pitch limits, expressed as the vertical component of a unit vector so that no
  // trigonometry is needed -- ADR-0001.
  if (dir[1] < AIM_DIR_Y_MIN - AIM_EPSILON || dir[1] > AIM_DIR_Y_MAX + AIM_EPSILON) {
    return null;
  }

  const jump = raw['jump'];
  const crouch = raw['crouch'];
  const sprint = raw['sprint'];
  const fire = raw['fire'];
  const reload = raw['reload'];
  if (typeof jump !== 'boolean') return null;
  if (typeof crouch !== 'boolean') return null;
  if (typeof sprint !== 'boolean') return null;
  // fire and reload are requests, not outcomes (NET-004b). They are validated as
  // strictly as the rest: a truthy string or a 1 is not a boolean and does not become
  // one here.
  if (typeof fire !== 'boolean') return null;
  if (typeof reload !== 'boolean') return null;

  return { move, dir, jump, crouch, sprint, fire, reload };
}

const EXPECTED_KEYS: readonly string[] = [
  'move',
  'dir',
  'jump',
  'crouch',
  'sprint',
  'fire',
  'reload',
];

/**
 * Rejects extra fields as well as missing ones. An unrecognised field is either a client
 * that has drifted from the protocol or an attempt to smuggle state past the validator;
 * neither should be accepted silently.
 */
function hasExactKeys(raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw);
  if (keys.length !== EXPECTED_KEYS.length) return false;
  return EXPECTED_KEYS.every((key) => key in raw);
}

/** Not a gameplay number: the arity of a 3-vector. Named so the lint rule can tell. */
const VEC3_ARITY = 3;

function asVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== VEC3_ARITY) return null;
  const [x, y, z] = value as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number')
    return null;
  const vec: Vec3 = [x, y, z];
  return isFinite3(vec) ? vec : null;
}
