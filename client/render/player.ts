import * as THREE from 'three';

import { CROUCH_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS } from '#shared/constants/index.ts';
import { type Vec3, lerp } from '#shared/math/vec3.ts';
import type { PlayerState } from '#shared/sim/types.ts';

/**
 * The player as a capsule primitive. No rigged model in M0 -- D-011 ships primitives
 * through M0-M3, and NFR-017 keeps animation cosmetic when it does arrive.
 */
export interface PlayerView {
  readonly object: THREE.Object3D;
  /** Interpolated world position of the capsule base, for the camera to follow. */
  readonly draw: (previous: PlayerState, current: PlayerState, alpha: number) => Vec3;
}

export function createPlayerView(scene: THREE.Scene): PlayerView {
  const material = new THREE.MeshLambertMaterial({ color: 0xd8dee9 });
  const object = new THREE.Group();

  const standing = capsule(PLAYER_HEIGHT, material);
  const crouched = capsule(CROUCH_HEIGHT, material);
  crouched.visible = false;
  object.add(standing, crouched);
  scene.add(object);

  const draw = (previous: PlayerState, current: PlayerState, alpha: number): Vec3 => {
    // Rendering interpolates between the two most recent simulated states, so a 30 Hz
    // simulation still looks smooth on a 144 Hz display.
    const position = lerp(previous.pos, current.pos, alpha);
    object.position.set(position[0], position[1], position[2]);

    standing.visible = !current.crouching;
    crouched.visible = current.crouching;
    return position;
  };

  return { object, draw };
}

/**
 * A capsule of the given total height, positioned so the group's origin is the capsule
 * base -- matching PlayerState.pos, which is where the player meets the floor.
 */
function capsule(height: number, material: THREE.Material): THREE.Mesh {
  const cylinderHeight = Math.max(height - 2 * PLAYER_RADIUS, 0.01);
  const geometry = new THREE.CapsuleGeometry(PLAYER_RADIUS, cylinderHeight, 4, 12);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = height / 2;
  return mesh;
}
