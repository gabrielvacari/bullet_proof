import { describe, expect, it } from 'vitest';

import { MIN_SPAWN_DISTANCE_SQ } from '#shared/constants/index.ts';
import type { Spawn } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

import { selectSpawn } from './spawn.ts';

function spawn(id: string, pos: Vec3): Spawn {
  return { id, pos, yaw: 0, team: 'ANY' };
}

/** Squared distance from a chosen spawn to the closest enemy, for assertions. */
function nearestSq(pos: Vec3, enemies: readonly Vec3[]): number {
  return Math.min(
    ...enemies.map(
      (e) => (e[0] - pos[0]) ** 2 + (e[1] - pos[1]) ** 2 + (e[2] - pos[2]) ** 2,
    ),
  );
}

describe('selectSpawn', () => {
  it('picks the spawn furthest from the nearest living enemy', () => {
    const spawns = [
      spawn('a', [0, 0, 0]),
      spawn('b', [50, 0, 0]),
      spawn('c', [10, 0, 0]),
    ];
    expect(selectSpawn(spawns, [[0, 0, 0]])?.id).toBe('b');
  });

  it('measures against the *nearest* enemy, not the average', () => {
    // 'b' is far from the crowd but has one enemy right beside it; 'a' is the safer
    // choice even though more enemies are nearer to it in total.
    const spawns = [spawn('a', [0, 0, 0]), spawn('b', [50, 0, 0])];
    const enemies: Vec3[] = [
      [20, 0, 0],
      [21, 0, 0],
      [51, 0, 0],
    ];
    expect(selectSpawn(spawns, enemies)?.id).toBe('a');
  });

  it('counts vertical distance -- a spawn above an enemy is not safe', () => {
    const spawns = [spawn('low', [0, 0, 0]), spawn('high', [0, 3, 0])];
    // The enemy stands on the lower spawn: the higher one is only 3 m away, so
    // neither is good, but 'high' is the further of the two.
    expect(selectSpawn(spawns, [[0, 0, 0]])?.id).toBe('high');
    // And a spawn directly above an enemy loses to one genuinely far away.
    const withFar = [...spawns, spawn('far', [40, 3, 0])];
    expect(selectSpawn(withFar, [[0, 0, 0]])?.id).toBe('far');
  });

  it('satisfies MIN_SPAWN_DISTANCE whenever any spawn does -- FR-GP-038', () => {
    const spawns = [
      spawn('near', [1, 0, 0]),
      spawn('alsoNear', [2, 0, 0]),
      spawn('safe', [40, 0, 0]),
    ];
    const enemies: Vec3[] = [[0, 0, 0]];
    const chosen = selectSpawn(spawns, enemies);
    expect(nearestSq(chosen!.pos, enemies)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE_SQ);
  });

  it('falls back to the farthest when no spawn satisfies the criterion', () => {
    // Every spawn is inside MIN_SPAWN_DISTANCE. The requirement says use the farthest,
    // not refuse to spawn.
    const spawns = [spawn('a', [1, 0, 0]), spawn('b', [5, 0, 0]), spawn('c', [3, 0, 0])];
    const enemies: Vec3[] = [[0, 0, 0]];
    const chosen = selectSpawn(spawns, enemies);
    expect(chosen?.id).toBe('b');
    expect(nearestSq(chosen!.pos, enemies)).toBeLessThan(MIN_SPAWN_DISTANCE_SQ);
  });

  it('breaks exact ties on the lowest id, not on array order', () => {
    const enemies: Vec3[] = [[0, 0, 0]];
    // Mirrored either side of the enemy: identical distance, different ids.
    const spawns = [spawn('z', [10, 0, 0]), spawn('a', [-10, 0, 0])];
    expect(selectSpawn(spawns, enemies)?.id).toBe('a');
    // Reversing the input must not change the answer.
    expect(selectSpawn([...spawns].reverse(), enemies)?.id).toBe('a');
  });

  it('is deterministic with no enemies alive, where every spawn ties', () => {
    const spawns = [spawn('c', [0, 0, 0]), spawn('a', [9, 0, 0]), spawn('b', [4, 0, 0])];
    expect(selectSpawn(spawns, [])?.id).toBe('a');
    expect(selectSpawn([...spawns].reverse(), [])?.id).toBe('a');
  });

  it('returns null rather than throwing when a map has no spawns', () => {
    // Never reachable through a validated map, but this runs inside the tick loop and
    // C7 forbids throwing there (NFR-015).
    expect(selectSpawn([], [[0, 0, 0]])).toBeNull();
  });

  it('does not mutate what it is given', () => {
    const spawns = Object.freeze([spawn('a', [0, 0, 0]), spawn('b', [20, 0, 0])]);
    const enemies = Object.freeze([[0, 0, 0] as Vec3]);
    expect(() => selectSpawn(spawns, enemies)).not.toThrow();
    expect(spawns.map((s) => s.id)).toEqual(['a', 'b']);
  });
});
