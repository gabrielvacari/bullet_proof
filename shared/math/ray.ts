/**
 * Exact ray intersection.
 *
 * The restriction vec3.ts documents applies here and matters more: this is the branchiest
 * arithmetic in the project, and it decides whether a shot hit. Only `+ - * /` and
 * Math.sqrt appear -- each one ECMA-262 requires to be IEEE 754 correctly rounded, and
 * therefore identical on every conforming engine (NFR-003, ADR-0001). No Math.hypot: it
 * is permitted to be *more* accurate than the naive expression, which is exactly the kind
 * of "better" that makes two engines disagree about a hit.
 *
 * Every function returns the **nearest non-negative** parameter `t` along the ray, or
 * `null` for a miss. `t` is a distance only when `dir` is a unit vector; callers in the
 * simulation always pass one, and nothing here depends on it.
 *
 * A ray that starts *inside* a volume returns `t = 0` rather than `null`. A shot fired
 * from inside geometry should stop immediately, and this is the case that silently
 * returns "miss" when written carelessly.
 */

import type { Aabb } from '#shared/map/types.ts';

import type { Vec3 } from './vec3.ts';

/**
 * Ray against an axis-aligned box, by the slab method.
 *
 * A zero component of `dir` makes the division produce an infinity, and the min/max
 * comparisons then behave correctly with no special case -- except when the origin lies
 * exactly on the slab, where it becomes 0 * Infinity = NaN and silently poisons every
 * later comparison. That case is handled explicitly rather than left to chance.
 */
export function rayAabb(origin: Vec3, dir: Vec3, box: Aabb, maxT: number): number | null {
  let near = 0;
  let far = maxT;

  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis] as number;
    const d = dir[axis] as number;
    const lo = box.min[axis] as number;
    const hi = box.max[axis] as number;

    if (d === 0) {
      // Parallel to this pair of planes: it can never cross them, so starting outside
      // them means it never hits at all.
      if (o < lo || o > hi) return null;
      continue;
    }

    const inv = 1 / d;
    let enter = (lo - o) * inv;
    let exit = (hi - o) * inv;
    if (enter > exit) {
      const swap = enter;
      enter = exit;
      exit = swap;
    }

    if (enter > near) near = enter;
    if (exit < far) far = exit;
    if (near > far) return null;
  }

  return near;
}

/**
 * Ray against a sphere.
 *
 * Solved as a quadratic in `t`. `dir` is not assumed to be unit length, so the leading
 * coefficient is carried rather than taken as 1: a caller that passes an unnormalised
 * direction gets a correct answer in its own parameter space instead of a wrong one.
 */
export function raySphere(
  origin: Vec3,
  dir: Vec3,
  centre: Vec3,
  radius: number,
  maxT: number,
): number | null {
  const ox = origin[0] - centre[0];
  const oy = origin[1] - centre[1];
  const oz = origin[2] - centre[2];

  const a = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2];
  // A ray with no direction is a point. It hits only if that point is already inside.
  if (a === 0) return ox * ox + oy * oy + oz * oz <= radius * radius ? 0 : null;

  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;

  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  // The near root first: it is the surface the ray meets on the way in.
  const near = (-b - root) / a;
  if (near >= 0) return near <= maxT ? near : null;

  // Near root behind the origin means the origin is inside, or the whole sphere is
  // behind. The far root separates the two.
  const far = (-b + root) / a;
  if (far < 0) return null;
  // Inside. The ray is already touching the volume at its own origin, so this is a hit
  // at zero regardless of how short maxT is -- the exit point is not what was asked for.
  return 0;
}

/**
 * Ray against a capsule: the volume swept by a sphere moving along a segment.
 *
 * The infinite-cylinder quadratic first, then the two caps. Solving the cylinder alone
 * would hit the surface a real capsule does not have beyond its ends, so a candidate `t`
 * is kept only when its projection falls within the segment; otherwise the caps decide.
 *
 * Written to cover the degenerate segment -- a capsule whose ends coincide is a sphere,
 * and the hit-volume fractions make that reachable if someone ever sets a top and bottom
 * fraction equal.
 */
export function rayCapsule(
  origin: Vec3,
  dir: Vec3,
  a: Vec3,
  b: Vec3,
  radius: number,
  maxT: number,
): number | null {
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const az = b[2] - a[2];
  const axisLengthSq = ax * ax + ay * ay + az * az;

  // A zero-length segment is a sphere, and the cylinder maths below would divide by it.
  if (axisLengthSq === 0) return raySphere(origin, dir, a, radius, maxT);

  const ox = origin[0] - a[0];
  const oy = origin[1] - a[1];
  const oz = origin[2] - a[2];

  // Containment first, and deliberately before any of the cylinder maths.
  //
  // Solved afterwards instead, an interior origin puts the near root behind the ray and
  // the far root ahead of it, and the nearest *non-negative* candidate is then the wall
  // on the way out -- a hit reported several metres away from a shooter standing inside
  // the volume. Answering zero up front is both correct and cheaper.
  if (insideCapsule(ox, oy, oz, ax, ay, az, axisLengthSq, radius)) return 0;

  const dirDotAxis = dir[0] * ax + dir[1] * ay + dir[2] * az;
  const oDotAxis = ox * ax + oy * ay + oz * az;

  // The ray and the origin offset, each with their component along the axis removed.
  const px = dir[0] - (dirDotAxis / axisLengthSq) * ax;
  const py = dir[1] - (dirDotAxis / axisLengthSq) * ay;
  const pz = dir[2] - (dirDotAxis / axisLengthSq) * az;
  const qx = ox - (oDotAxis / axisLengthSq) * ax;
  const qy = oy - (oDotAxis / axisLengthSq) * ay;
  const qz = oz - (oDotAxis / axisLengthSq) * az;

  const ca = px * px + py * py + pz * pz;
  const cb = px * qx + py * qy + pz * qz;
  const cc = qx * qx + qy * qy + qz * qz - radius * radius;

  let best: number | null = null;
  const keep = (t: number): void => {
    if (t >= 0 && t <= maxT && (best === null || t < best)) best = t;
  };

  // ca is zero when the ray runs parallel to the axis. The cylinder wall is then never
  // crossed -- the ray stays at a fixed distance from the axis for its whole length --
  // so there is no quadratic to solve and the caps alone decide.
  if (ca !== 0) {
    const discriminant = cb * cb - ca * cc;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-cb - root) / ca, (-cb + root) / ca]) {
        // Only the stretch of cylinder between the two caps is real surface.
        const along = oDotAxis + t * dirDotAxis;
        if (along >= 0 && along <= axisLengthSq) keep(t);
      }
    }
  }

  // The caps. A hit on either hemisphere is a hit on the capsule.
  const capA = raySphere(origin, dir, a, radius, maxT);
  if (capA !== null) keep(capA);
  const capB = raySphere(origin, dir, b, radius, maxT);
  if (capB !== null) keep(capB);

  return best;
}

/** Squared distance from the origin offset to the segment, against the radius. */
function insideCapsule(
  ox: number,
  oy: number,
  oz: number,
  ax: number,
  ay: number,
  az: number,
  axisLengthSq: number,
  radius: number,
): boolean {
  let along = (ox * ax + oy * ay + oz * az) / axisLengthSq;
  if (along < 0) along = 0;
  if (along > 1) along = 1;

  const dx = ox - along * ax;
  const dy = oy - along * ay;
  const dz = oz - along * az;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}
