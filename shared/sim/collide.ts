import {
  GROUND_PROBE_DISTANCE,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
} from '#shared/constants/index.ts';
import { type Aabb, blockAabb } from '#shared/map/types.ts';
import type { GameMap } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

/**
 * Collision against the arena's axis-aligned boxes.
 *
 * The player's *collision* volume is an axis-aligned box, half-extent PLAYER_RADIUS
 * horizontally. The player is drawn as a capsule and M2's hit volumes are separate
 * primitives (FR-GP-027); this is the movement volume only.
 *
 * A box rather than a capsule because per-axis resolution is only well defined for one:
 * a circle's push-out distance depends on both horizontal axes at once, so "resolve X,
 * then Z" would stop being a separation and become an approximation whose result depends
 * on which axis ran first. See specs/000-m0-walking-box/research.md R4.
 *
 * Arithmetic only -- no sqrt, no trigonometry (ADR-0001).
 */

/** Guard against resting exactly on a face and oscillating between two resolutions. */
const SKIN = 1e-6;

export interface Collision {
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly grounded: boolean;
}

/** The player's collision box, given its base position and current height. */
export function playerBox(pos: Vec3, height: number): Aabb {
  return {
    min: [pos[0] - PLAYER_RADIUS, pos[1], pos[2] - PLAYER_RADIUS],
    max: [pos[0] + PLAYER_RADIUS, pos[1] + height, pos[2] + PLAYER_RADIUS],
  };
}

function overlaps(a: Aabb, b: Aabb): boolean {
  return (
    a.min[0] < b.max[0] - SKIN &&
    a.max[0] > b.min[0] + SKIN &&
    a.min[1] < b.max[1] - SKIN &&
    a.max[1] > b.min[1] + SKIN &&
    a.min[2] < b.max[2] - SKIN &&
    a.max[2] > b.min[2] + SKIN
  );
}

function boxesOf(map: GameMap): Aabb[] {
  return map.blocks.map(blockAabb);
}

/**
 * A downward probe of GROUND_PROBE_DISTANCE beneath the player's feet.
 *
 * Deliberately not a test of vertical velocity: that reads zero both for a player at rest
 * on a block and at the apex of a jump, so it would call a player in mid-air grounded.
 */
export function groundSurface(pos: Vec3, height: number, map: GameMap): number | null {
  const feet = playerBox(pos, height);
  const probe: Aabb = {
    min: [feet.min[0], pos[1] - GROUND_PROBE_DISTANCE, feet.min[2]],
    max: [feet.max[0], pos[1], feet.max[2]],
  };
  let surface: number | null = null;
  for (const box of boxesOf(map)) {
    if (!overlaps(probe, box)) continue;
    surface = surface === null ? box.max[1] : Math.max(surface, box.max[1]);
  }
  return surface;
}

export function isGrounded(pos: Vec3, height: number, map: GameMap): boolean {
  return groundSurface(pos, height, map) !== null;
}

/**
 * Is there room to stand up here? Releasing crouch under a low ceiling must leave the
 * player crouched rather than teleporting the box into geometry.
 */
export function canStand(pos: Vec3, map: GameMap): boolean {
  const standing = playerBox(pos, PLAYER_HEIGHT);
  return !boxesOf(map).some((box) => overlaps(standing, box));
}

/**
 * Integrates velocity and resolves penetration one axis at a time, Y first.
 *
 * Y first is what makes landing on a block and *then* sliding along a wall behave
 * correctly; resolving a horizontal axis first would catch the player on the block's
 * vertical face instead of putting them on top of it.
 */
export function moveAndCollide(
  pos: Vec3,
  vel: Vec3,
  height: number,
  map: GameMap,
  dt: number,
): Collision {
  const boxes = boxesOf(map);

  let [px, py, pz] = pos;
  let [vx, vy, vz] = vel;

  // --- Y ---------------------------------------------------------------------
  py += vy * dt;
  for (const box of boxes) {
    if (!overlaps(playerBox([px, py, pz], height), box)) continue;
    if (vy <= 0) {
      py = box.max[1];
    } else {
      py = box.min[1] - height;
    }
    vy = 0;
  }

  // --- X ---------------------------------------------------------------------
  px += vx * dt;
  for (const box of boxes) {
    if (!overlaps(playerBox([px, py, pz], height), box)) continue;
    px = vx > 0 ? box.min[0] - PLAYER_RADIUS : box.max[0] + PLAYER_RADIUS;
    vx = 0;
  }

  // --- Z ---------------------------------------------------------------------
  pz += vz * dt;
  for (const box of boxes) {
    if (!overlaps(playerBox([px, py, pz], height), box)) continue;
    pz = vz > 0 ? box.min[2] - PLAYER_RADIUS : box.max[2] + PLAYER_RADIUS;
    vz = 0;
  }

  /*
   * Snap to the surface underfoot.
   *
   * Without this a player can land within GROUND_PROBE_DISTANCE of the floor and read as
   * grounded while still carrying downward velocity -- which would let them jump during a
   * tick in which they are in fact still falling. Resolution alone does not catch it,
   * because at that distance the two boxes do not yet overlap.
   */
  const surface = groundSurface([px, py, pz], height, map);
  if (surface !== null && vy <= 0) {
    py = surface;
    vy = 0;
  }

  return { pos: [px, py, pz], vel: [vx, vy, vz], grounded: surface !== null };
}
