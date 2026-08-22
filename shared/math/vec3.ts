/**
 * Exact vector arithmetic.
 *
 * Every operation here uses only `+ - * /` and Math.sqrt, which ECMA-262 requires to be
 * IEEE 754 correctly rounded -- identical on every conforming engine. That restriction is
 * what makes NFR-003's bit-identity guarantee reachable at all; see
 * docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md.
 */

/** Right-handed, Y up. A tuple rather than an object, so it matches the wire format. */
export type Vec3 = readonly [number, number, number];

export const ZERO: Vec3 = [0, 0, 0];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Squared length. Prefer this wherever a comparison does not need the square root. */
export function lengthSquared(v: Vec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

/** Written as sqrt of the sum rather than Math.hypot, which is not exactly specified. */
export function length(v: Vec3): number {
  return Math.sqrt(lengthSquared(v));
}

/**
 * Unit vector in the same direction. A zero-length vector has no direction, so it is
 * returned unchanged rather than producing NaN -- callers in the simulation treat "no
 * input" and "no direction" identically, and a NaN would poison every later tick.
 */
export function normalise(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) return ZERO;
  return scale(v, 1 / len);
}

/**
 * Shortens the vector to `max` if it is longer, otherwise returns it unchanged. Used to
 * clamp a movement input without trusting the sender to have normalised it.
 */
export function clampLength(v: Vec3, max: number): Vec3 {
  const lenSq = lengthSquared(v);
  if (lenSq <= max * max) return v;
  return scale(v, max / Math.sqrt(lenSq));
}

/** Linear interpolation. Used for render interpolation only, never inside the simulation. */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Drops the Y component. Ground movement is horizontal by definition. */
export function horizontal(v: Vec3): Vec3 {
  return [v[0], 0, v[2]];
}

/** True when every component is finite -- the first thing input validation checks. */
export function isFinite3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}
