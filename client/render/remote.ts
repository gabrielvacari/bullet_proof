import * as THREE from 'three';

import { CROUCH_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS } from '#shared/constants/index.ts';
import { STATE_CROUCHING } from '#shared/protocol/types.ts';

import type { InterpolatedPlayer } from '#client/net/interpolation.ts';

/**
 * The other players, as capsules (D-011 ships primitives through M0-M3).
 *
 * Created and destroyed **by player id**, driven entirely by what `sample()` returns. A
 * capsule that is not in the current sample is disposed of rather than left standing:
 * FR-GP-040's ghost is a rendering bug as much as a server one, and this is the half that
 * is easy to forget.
 *
 * Nameplates are FR-GP-048 and belong to M4, with the occlusion check that makes them
 * honest. Nothing here renders a nickname, so NFR-012 has nothing to defend yet.
 */

export interface RemoteViews {
  /** Replaces the whole set with what the interpolation buffer produced this frame. */
  update(players: readonly InterpolatedPlayer[], self: string | null): void;
  /** NET-011: drop a player the server says has gone, without waiting for a snapshot. */
  remove(id: string): void;
}

export function createRemoteViews(scene: THREE.Scene): RemoteViews {
  const views = new Map<string, THREE.Group>();
  const material = new THREE.MeshLambertMaterial({ color: 0xbf616a });

  const dispose = (id: string): void => {
    const view = views.get(id);
    if (view === undefined) return;
    scene.remove(view);
    view.traverse((child) => {
      // Geometry is per-capsule; the material is shared and outlives every view.
      if (child instanceof THREE.Mesh) {
        (child.geometry as THREE.BufferGeometry).dispose();
      }
    });
    views.delete(id);
  };

  return {
    update(players, self) {
      const seen = new Set<string>();

      for (const player of players) {
        // The local player is drawn by client/render/player.ts from the *predicted*
        // state, not from the snapshot -- drawing them here as well would show them
        // twice, once a full INTERPOLATION_DELAY behind themselves.
        if (player.id === self) continue;
        seen.add(player.id);

        const view = views.get(player.id) ?? create(player.id);
        view.position.set(player.pos[0], player.pos[1], player.pos[2]);
        view.rotation.y = player.yaw;

        const crouching = (player.st & STATE_CROUCHING) !== 0;
        const [standing, crouched] = view.children;
        if (standing !== undefined) standing.visible = !crouching;
        if (crouched !== undefined) crouched.visible = crouching;
      }

      for (const id of [...views.keys()]) {
        if (!seen.has(id)) dispose(id);
      }
    },

    remove: dispose,
  };

  function create(id: string): THREE.Group {
    const group = new THREE.Group();
    const standing = capsule(PLAYER_HEIGHT, material);
    const crouched = capsule(CROUCH_HEIGHT, material);
    crouched.visible = false;
    group.add(standing, crouched);
    scene.add(group);
    views.set(id, group);
    return group;
  }
}

/** Matches client/render/player.ts: the group's origin is the capsule base. */
function capsule(height: number, material: THREE.Material): THREE.Mesh {
  const cylinderHeight = Math.max(height - 2 * PLAYER_RADIUS, 0.01);
  const geometry = new THREE.CapsuleGeometry(PLAYER_RADIUS, cylinderHeight, 4, 12);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = height / 2;
  return mesh;
}
