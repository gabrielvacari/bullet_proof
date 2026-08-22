import * as THREE from 'three';

import type { GameMap } from '#shared/map/types.ts';
import { blockAabb } from '#shared/map/types.ts';

/**
 * The arena, built from the loaded GameMap and nothing else.
 *
 * No offset, no scale, no rounding is applied to any position or size. The renderer and
 * the collision system read the same numbers, which is the whole point of FR-MAP-002 --
 * applying a transform here would silently reintroduce the client/server geometry
 * disagreement the data-driven map exists to prevent. Materials and lighting are the
 * renderer's business; geometry is not.
 */
export interface Stage {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
}

const WALL_COLOUR = 0x5a6273;
const COVER_COLOUR = 0x7d6b57;
const SKY_COLOUR = 0x12141a;

export function createStage(canvas: HTMLCanvasElement, map: GameMap): Stage {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOUR);
  scene.fog = new THREE.Fog(SKY_COLOUR, 40, 120);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x35302a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const wallMaterial = new THREE.MeshLambertMaterial({ color: WALL_COLOUR });
  const coverMaterial = new THREE.MeshLambertMaterial({ color: COVER_COLOUR });

  for (const block of map.blocks) {
    const geometry = new THREE.BoxGeometry(block.size[0], block.size[1], block.size[2]);
    const mesh = new THREE.Mesh(
      geometry,
      block.kind === 'cover' ? coverMaterial : wallMaterial,
    );
    mesh.position.set(block.pos[0], block.pos[1], block.pos[2]);
    mesh.name = block.id;
    scene.add(mesh);
  }

  return { scene, renderer, camera };
}

export function resize(stage: Stage, width: number, height: number): void {
  stage.renderer.setSize(width, height, false);
  stage.camera.aspect = width / height;
  stage.camera.updateProjectionMatrix();
}

/** Cached AABBs for camera occlusion, so the camera does not re-derive them per frame. */
export function collisionBoxes(map: GameMap): THREE.Box3[] {
  return map.blocks.map((block) => {
    const box = blockAabb(block);
    return new THREE.Box3(
      new THREE.Vector3(box.min[0], box.min[1], box.min[2]),
      new THREE.Vector3(box.max[0], box.max[1], box.max[2]),
    );
  });
}
