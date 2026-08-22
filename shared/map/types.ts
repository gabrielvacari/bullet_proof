import type { Vec3 } from '#shared/math/vec3.ts';

/** Full-height geometry, or waist-high cover -- FR-MAP-003. */
export type BlockKind = 'wall' | 'cover';

export type SpawnTeam = 'ANY' | 'BLUE' | 'RED';

export interface Block {
  readonly id: string;
  /** The **centre** of the box, not a corner. */
  readonly pos: Vec3;
  /** The **full** extent on each axis. Half-extents are derived, never authored. */
  readonly size: Vec3;
  readonly kind: BlockKind;
}

export interface Spawn {
  readonly id: string;
  /** Floor position. PlayerState.pos is the capsule base, so this needs no offset. */
  readonly pos: Vec3;
  /**
   * Initial facing, radians. Read by the client to orient the camera on entry; it never
   * enters PlayerInput or step(). See ADR-0001.
   */
  readonly yaw: number;
  readonly team: SpawnTeam;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * The arena as data (FR-MAP-002). One loaded instance is read by both the collision
 * system and the renderer, which is what makes it impossible for them to disagree about
 * geometry -- and what kills the classic "shot visually hits a wall, server registers a
 * hit on a player" bug before it can exist.
 */
export interface GameMap {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly bounds: Bounds;
  readonly blocks: readonly Block[];
  readonly spawns: readonly Spawn[];
}

/** Axis-aligned extents, derived from a block's centre and full size. */
export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export function blockAabb(block: Block): Aabb {
  const [cx, cy, cz] = block.pos;
  const hx = block.size[0] / 2;
  const hy = block.size[1] / 2;
  const hz = block.size[2] / 2;
  return { min: [cx - hx, cy - hy, cz - hz], max: [cx + hx, cy + hy, cz + hz] };
}
