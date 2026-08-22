import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CROUCH_HEIGHT,
  GROUND_PROBE_DISTANCE,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  TICK_DURATION_S,
} from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import type { GameMap } from '#shared/map/types.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

import { canStand, isGrounded, moveAndCollide } from './collide.ts';

let map: GameMap;

beforeAll(() => {
  map = loadMap(JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')));
});

/** Somewhere flat and far from every interior block. */
const OPEN: Vec3 = [20, 0, 20];

describe('ground', () => {
  it('reports a player standing on the floor as grounded', () => {
    expect(isGrounded(OPEN, PLAYER_HEIGHT, map)).toBe(true);
  });

  it('reports a player above the floor as airborne', () => {
    expect(isGrounded([20, 2, 20], PLAYER_HEIGHT, map)).toBe(false);
  });

  it('uses a probe, not a velocity test — a player at rest stays grounded', () => {
    // A velocity test would also call the apex of a jump "grounded", where vertical
    // velocity passes through zero. The probe cannot make that mistake.
    let pos = OPEN;
    let vel: Vec3 = [0, 0, 0];
    for (let tick = 0; tick < 20; tick += 1) {
      const result = moveAndCollide(pos, vel, PLAYER_HEIGHT, map, TICK_DURATION_S);
      pos = result.pos;
      vel = result.vel;
      expect(result.grounded).toBe(true);
    }
    expect(pos[1]).toBeCloseTo(0, 9);
  });

  it('probes no deeper than GROUND_PROBE_DISTANCE', () => {
    expect(isGrounded([20, GROUND_PROBE_DISTANCE / 2, 20], PLAYER_HEIGHT, map)).toBe(
      true,
    );
    expect(isGrounded([20, GROUND_PROBE_DISTANCE * 3, 20], PLAYER_HEIGHT, map)).toBe(
      false,
    );
  });
});

describe('walls', () => {
  it('stops a player walking straight into a wall', () => {
    // w1 spans x -6..6 at z = -10, half-depth 0.25 -> its near face is z = -9.75.
    let pos: Vec3 = [0, 0, -8];
    let vel: Vec3 = [0, 0, 0];
    for (let tick = 0; tick < 30; tick += 1) {
      const result = moveAndCollide(
        pos,
        [0, 0, -20],
        PLAYER_HEIGHT,
        map,
        TICK_DURATION_S,
      );
      pos = result.pos;
      vel = result.vel;
    }
    // Stopped short of the wall face by the player's own half-width.
    expect(pos[2]).toBeGreaterThanOrEqual(-9.75 - 1e-6);
    expect(vel[2]).toBe(0);
  });

  it('slides along a wall instead of sticking to it', () => {
    let pos: Vec3 = [0, 0, -8];
    let vel: Vec3 = [0, 0, 0];
    const startX = pos[0];
    // X velocity kept small enough that the player stays within w1's span (x -6..6),
    // so the wall is still in front of it at the end of the run.
    for (let tick = 0; tick < 30; tick += 1) {
      const result = moveAndCollide(
        pos,
        [2, 0, -20],
        PLAYER_HEIGHT,
        map,
        TICK_DURATION_S,
      );
      pos = result.pos;
      vel = result.vel;
    }
    // Blocked on Z, but the X component survives -- that is what sliding is.
    expect(vel[2]).toBe(0);
    expect(pos[2]).toBeGreaterThanOrEqual(-9.75 - 1e-6);
    expect(pos[0]).toBeGreaterThan(startX + 1);
    expect(pos[0]).toBeLessThan(6);
  });

  it('does not wedge in an inside corner', () => {
    // w1 (z = -10) meets w2 (x = -6) at an inside corner near (-6, -10).
    let pos: Vec3 = [-4, 0, -8];
    for (let tick = 0; tick < 60; tick += 1) {
      const result = moveAndCollide(
        pos,
        [-6, 0, -6],
        PLAYER_HEIGHT,
        map,
        TICK_DURATION_S,
      );
      pos = result.pos;
    }
    expect(Number.isFinite(pos[0])).toBe(true);
    expect(Number.isFinite(pos[2])).toBe(true);
    // Pressed into the corner, never through either wall.
    expect(pos[0]).toBeGreaterThanOrEqual(-6.25 - PLAYER_RADIUS - 1e-6);
    expect(pos[2]).toBeGreaterThanOrEqual(-10.25 - PLAYER_RADIUS - 1e-6);
  });

  it('reaches a stable rest position rather than oscillating', () => {
    let pos: Vec3 = [0, 0, -9];
    let previous: Vec3 = pos;
    for (let tick = 0; tick < 40; tick += 1) {
      const result = moveAndCollide(
        pos,
        [0, 0, -10],
        PLAYER_HEIGHT,
        map,
        TICK_DURATION_S,
      );
      previous = pos;
      pos = result.pos;
    }
    expect(pos[2]).toBeCloseTo(previous[2], 12);
  });

  it('stops a player moving in the positive Z direction too', () => {
    // The -Z cases above would pass even if only one sign of the Z resolution worked.
    let pos: Vec3 = [20, 0, 38];
    for (let tick = 0; tick < 120; tick += 1) {
      pos = moveAndCollide(pos, [0, 0, 50], PLAYER_HEIGHT, map, TICK_DURATION_S).pos;
    }
    expect(pos[2]).toBeLessThanOrEqual(40 - PLAYER_RADIUS + 1e-6);
  });

  it('never lets a player leave the arena through the perimeter', () => {
    let pos: Vec3 = [38, 0, 0];
    for (let tick = 0; tick < 120; tick += 1) {
      pos = moveAndCollide(pos, [50, 0, 0], PLAYER_HEIGHT, map, TICK_DURATION_S).pos;
    }
    expect(pos[0]).toBeLessThanOrEqual(40 - PLAYER_RADIUS + 1e-6);
  });
});

describe('falling and landing', () => {
  it('resolves a fall that penetrates the floor within a single tick', () => {
    // Fast enough that the boxes genuinely overlap, exercising the resolution branch
    // rather than the ground-snap shortcut.
    const result = moveAndCollide(
      [20, 0.3, 20],
      [0, -20, 0],
      PLAYER_HEIGHT,
      map,
      TICK_DURATION_S,
    );
    expect(result.pos[1]).toBeCloseTo(0, 9);
    expect(result.vel[1]).toBe(0);
    expect(result.grounded).toBe(true);
  });

  it('rests on the higher surface when two blocks meet under the feet', () => {
    // The two floor slabs meet at x = 0; the probe sees both.
    const result = moveAndCollide(
      [0, 0, 20],
      [0, 0, 0],
      PLAYER_HEIGHT,
      map,
      TICK_DURATION_S,
    );
    expect(result.pos[1]).toBeCloseTo(0, 9);
    expect(result.grounded).toBe(true);
  });

  it('lands on top of the floor rather than passing through it', () => {
    let pos: Vec3 = [20, 3, 20];
    let vel: Vec3 = [0, -10, 0];
    let grounded = false;
    for (let tick = 0; tick < 30 && !grounded; tick += 1) {
      const result = moveAndCollide(pos, vel, PLAYER_HEIGHT, map, TICK_DURATION_S);
      pos = result.pos;
      vel = result.vel;
      grounded = result.grounded;
    }
    expect(grounded).toBe(true);
    expect(pos[1]).toBeCloseTo(0, 9);
    expect(vel[1]).toBe(0);
  });
});

describe('ceilings', () => {
  it('stops upward motion against a ceiling and zeroes vertical velocity', () => {
    // Under the overhang: its underside sits at y = 1.1, exactly CROUCH_HEIGHT.
    const result = moveAndCollide(
      [14, 0, 14],
      [0, 30, 0],
      CROUCH_HEIGHT,
      map,
      TICK_DURATION_S,
    );
    expect(result.pos[1]).toBeCloseTo(1.1 - CROUCH_HEIGHT, 9);
    expect(result.vel[1]).toBe(0);
  });
});

describe('canStand', () => {
  it('allows standing in the open', () => {
    expect(canStand(OPEN, map)).toBe(true);
  });

  it('refuses to stand under a ceiling lower than PLAYER_HEIGHT', () => {
    // Without this, releasing Ctrl under an overhang teleports the box into geometry.
    expect(canStand([14, 0, 14], map)).toBe(false);
  });
});
