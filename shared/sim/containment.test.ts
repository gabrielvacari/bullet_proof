import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

import { PLAYER_RADIUS } from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import { type Aabb, type GameMap, blockAabb } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

import { step } from './step.ts';
import type { PlayerInput, PlayerState } from './types.ts';

/**
 * M0-6 / FR-MAP-006 -- no sequence of movement inputs may put the player outside bounds.
 *
 * The map loader checks structurally that a floor and four perimeter walls seal the
 * arena. This proves it dynamically: it drives the player at every wall, into every
 * corner, and onto every jumpable block, and asserts containment every single tick.
 *
 * FR-GP-042 says there is no fall damage and no out-of-bounds kill, so the boundary is
 * the only thing keeping a player in the playable space.
 */

let map: GameMap;

beforeAll(() => {
  map = loadMap(JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')));
});

/** Eight compass directions, as unit aim vectors -- no trigonometry needed. */
const DIAGONAL = Math.SQRT1_2;
const HEADINGS: readonly Vec3[] = [
  [0, 0, -1],
  [DIAGONAL, 0, -DIAGONAL],
  [1, 0, 0],
  [DIAGONAL, 0, DIAGONAL],
  [0, 0, 1],
  [-DIAGONAL, 0, DIAGONAL],
  [-1, 0, 0],
  [-DIAGONAL, 0, -DIAGONAL],
];

function command(dir: Vec3, overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { move: [0, 0, 1], dir, jump: false, crouch: false, sprint: true, ...overrides };
}

function assertInside(state: PlayerState, context: string): void {
  const { min, max } = map.bounds;
  expect(state.pos[0], `${context}: x`).toBeGreaterThanOrEqual(min[0] - 1e-6);
  expect(state.pos[0], `${context}: x`).toBeLessThanOrEqual(max[0] + 1e-6);
  expect(state.pos[1], `${context}: y`).toBeGreaterThanOrEqual(min[1] - 1e-6);
  expect(state.pos[1], `${context}: y`).toBeLessThanOrEqual(max[1] + 1e-6);
  expect(state.pos[2], `${context}: z`).toBeGreaterThanOrEqual(min[2] - 1e-6);
  expect(state.pos[2], `${context}: z`).toBeLessThanOrEqual(max[2] + 1e-6);
  expect(Number.isFinite(state.pos[0]), `${context}: finite`).toBe(true);
}

function spawnState(pos: Vec3): PlayerState {
  return { pos, vel: [0, 0, 0], grounded: true, crouching: false };
}

describe('the player cannot leave the arena', () => {
  it.each(HEADINGS.map((dir, index) => [index, dir] as const))(
    'sprinting on heading %i for 600 ticks',
    (index, dir) => {
      let state = spawnState([0, 0, 0]);
      for (let tick = 0; tick < 600; tick += 1) {
        state = step(state, command(dir), map);
        assertInside(state, `heading ${String(index)} tick ${String(tick)}`);
      }
    },
  );

  it.each(HEADINGS.map((dir, index) => [index, dir] as const))(
    'sprint-jumping on heading %i, which is the fastest way at a wall',
    (index, dir) => {
      let state = spawnState([0, 0, 0]);
      for (let tick = 0; tick < 600; tick += 1) {
        state = step(state, command(dir, { jump: state.grounded }), map);
        assertInside(state, `jumping heading ${String(index)} tick ${String(tick)}`);
      }
    },
  );

  it('cannot be squeezed out through an inside corner', () => {
    // w1 and w2 meet at roughly (-6, -10); alternating headings press into the seam.
    let state = spawnState([-4, 0, -8]);
    for (let tick = 0; tick < 400; tick += 1) {
      const dir = tick % 2 === 0 ? ([-1, 0, 0] as Vec3) : ([0, 0, -1] as Vec3);
      state = step(state, command(dir), map);
      assertInside(state, `corner tick ${String(tick)}`);
    }
  });

  it('stays inside when jumping onto and off every block', () => {
    const tops = map.blocks.map(blockAabb).filter((box: Aabb) => box.max[1] < 2);
    for (const box of tops) {
      const centre: Vec3 = [
        (box.min[0] + box.max[0]) / 2,
        box.max[1],
        (box.min[2] + box.max[2]) / 2,
      ];
      let state = spawnState(centre);
      for (const dir of HEADINGS) {
        for (let tick = 0; tick < 60; tick += 1) {
          state = step(state, command(dir, { jump: state.grounded }), map);
          assertInside(state, 'block traversal');
        }
      }
    }
  });

  it('never ends up inside the perimeter geometry itself', () => {
    let state = spawnState([0, 0, 0]);
    for (let tick = 0; tick < 600; tick += 1) {
      state = step(state, command([1, 0, 0]), map);
    }
    // Stopped by its own half-width, not embedded in the wall.
    expect(state.pos[0]).toBeLessThanOrEqual(map.bounds.max[0] - PLAYER_RADIUS + 1e-6);
  });
});
