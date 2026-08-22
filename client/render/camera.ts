import * as THREE from 'three';

import { CAMERA_OFFSET, EYE_HEIGHT, PLAYER_RADIUS } from '#shared/constants/index.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

import type { Aim } from '#client/input/aim.ts';

/**
 * Over-the-shoulder camera (FR-GP-019) with collision (FR-GP-020).
 *
 * This is a client concern only. It changes what is drawn, never what is simulated -- the
 * simulation has no camera and no concept of one.
 */

/** Keeps the camera just off any surface it would otherwise touch. */
const SKIN = 0.12;

export function updateCamera(
  camera: THREE.PerspectiveCamera,
  base: Vec3,
  aim: Aim,
  boxes: readonly THREE.Box3[],
): void {
  const pivot = new THREE.Vector3(base[0], base[1] + EYE_HEIGHT, base[2]);

  // The desired camera position, expressed in the player's aim frame.
  const offset = new THREE.Vector3(
    CAMERA_OFFSET[0],
    CAMERA_OFFSET[1] - EYE_HEIGHT,
    -CAMERA_OFFSET[2],
  );
  offset.applyEuler(new THREE.Euler(aim.pitch, aim.yaw, 0, 'YXZ'));

  const direction = offset.clone().normalize();
  const wanted = offset.length();
  const allowed = Math.min(wanted, firstHit(pivot, direction, wanted, boxes));

  camera.position.copy(pivot).addScaledVector(direction, allowed);
  camera.lookAt(pivot);
}

/**
 * Distance along `direction` at which the segment first enters level geometry.
 *
 * Slab-based ray/AABB intersection, with the boxes expanded by SKIN so the camera stops
 * short of a surface rather than resting exactly on it -- resting exactly on a face is
 * what produces the flicker where the wall's inside briefly becomes visible.
 */
function firstHit(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  boxes: readonly THREE.Box3[],
): number {
  let nearest = maxDistance;

  for (const box of boxes) {
    const expanded = box.clone().expandByScalar(SKIN + PLAYER_RADIUS * 0.1);
    const hit = rayBox(origin, direction, expanded);
    if (hit !== null && hit < nearest) nearest = hit;
  }
  return nearest;
}

function rayBox(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  box: THREE.Box3,
): number | null {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;

  for (const axis of ['x', 'y', 'z'] as const) {
    const d = direction[axis];
    const o = origin[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];

    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return null;
  }
  return near;
}
