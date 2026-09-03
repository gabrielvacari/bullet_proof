import type { Spawn } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

/**
 * Spawn selection -- FR-GP-038.
 *
 * The spawn whose nearest living enemy is furthest away. That single rule satisfies both
 * halves of the requirement without a second branch: a player never spawns within
 * MIN_SPAWN_DISTANCE of a living enemy *while any spawn satisfies that*, because the
 * argmax would have picked such a spawn; and when none does, the farthest is used,
 * because the argmax picks that too.
 *
 * **No randomness** (C4). Random spawn selection is the obvious implementation and it is
 * the one that cannot be replayed: M2-12 requires a recorded input sequence to reproduce
 * every death and respawn on the same tick, and a seeded generator would have to become
 * replicated state to manage that. The argmax needs neither.
 *
 * **No square root.** Distances are compared, never reported, so they are compared
 * squared -- which is exact for the same inputs on every engine and one operation
 * cheaper. MIN_SPAWN_DISTANCE_SQ exists for callers that want the criterion itself.
 *
 * Vertical distance is included. A spawn directly above an enemy on a walkway is close,
 * and flattening the comparison would call it safe.
 */
export function selectSpawn(
  spawns: readonly Spawn[],
  livingEnemies: readonly Vec3[],
): Spawn | null {
  // A map with no spawn points is a map that failed validation, but this is called from
  // inside the tick loop and C7 says it may not throw (NFR-015).
  let best: Spawn | null = null;
  let bestDistanceSq = -1;

  for (const spawn of spawns) {
    const distanceSq = nearestEnemyDistanceSq(spawn.pos, livingEnemies);

    if (best === null || distanceSq > bestDistanceSq) {
      best = spawn;
      bestDistanceSq = distanceSq;
      continue;
    }

    // Ties broken on the lowest id, lexicographically. With no enemies alive every
    // spawn ties at Infinity, so without a total order the answer would depend on the
    // map file's array order -- which is not a decision anyone made.
    if (distanceSq === bestDistanceSq && spawn.id < best.id) best = spawn;
  }

  return best;
}

/**
 * Squared distance from a spawn to the closest living enemy, or Infinity when none is
 * alive -- an empty arena is maximally safe everywhere, which is the right answer and
 * the one that keeps the argmax total.
 */
function nearestEnemyDistanceSq(pos: Vec3, livingEnemies: readonly Vec3[]): number {
  let nearest = Number.POSITIVE_INFINITY;

  for (const enemy of livingEnemies) {
    const dx = enemy[0] - pos[0];
    const dy = enemy[1] - pos[1];
    const dz = enemy[2] - pos[2];
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq < nearest) nearest = distanceSq;
  }

  return nearest;
}
