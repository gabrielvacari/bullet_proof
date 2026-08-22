import type { Vec3 } from '#shared/math/vec3.ts';

import {
  type Aabb,
  type Block,
  type BlockKind,
  type Bounds,
  type GameMap,
  type Spawn,
  type SpawnTeam,
  blockAabb,
} from './types.ts';

/**
 * Thrown when a map cannot be trusted. FR-MAP-003 requires loading to fail loudly at
 * startup rather than producing an arena where the renderer and collision disagree --
 * that failure would otherwise surface hours later as an unexplainable hit registration.
 *
 * The message names the offending element's id and the rule it broke. "Invalid map" is
 * not an acceptable message for a file a human edits by hand.
 */
export class MapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapValidationError';
  }
}

const KINDS: readonly string[] = ['wall', 'cover'];
const TEAMS: readonly string[] = ['ANY', 'BLUE', 'RED'];

/**
 * Axes as accessor functions rather than numeric indices.
 *
 * `noUncheckedIndexedAccess` types `v[i]` as `number | undefined` whenever `i` is a
 * variable, which would force a non-null assertion at every use. Reading a tuple through
 * a closure over a literal index keeps the type exact and costs nothing.
 */
interface Axis {
  readonly label: 'x' | 'y' | 'z';
  readonly of: (v: Vec3) => number;
}

const X: Axis = { label: 'x', of: (v) => v[0] };
const Y: Axis = { label: 'y', of: (v) => v[1] };
const Z: Axis = { label: 'z', of: (v) => v[2] };
const AXES: readonly Axis[] = [X, Y, Z];

/** Tolerance for floating-point comparisons of authored coordinates. */
const EPSILON = 1e-9;

function fail(message: string): never {
  throw new MapValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${where}: expected a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Rule 1: every numeric field is finite. Rejects NaN, Infinity, null and strings. */
function requireFinite(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${where}: expected a finite number, got ${JSON.stringify(value)} (rule 1)`);
  }
  return value;
}

function requireVec3(value: unknown, where: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    fail(`${where}: expected [x, y, z], got ${JSON.stringify(value)}`);
  }
  return [
    requireFinite(value[0], `${where}.x`),
    requireFinite(value[1], `${where}.y`),
    requireFinite(value[2], `${where}.z`),
  ];
}

function requireBounds(value: unknown): Bounds {
  if (!isRecord(value)) fail(`bounds: expected an object, got ${JSON.stringify(value)}`);
  const min = requireVec3(value['min'], 'bounds.min');
  const max = requireVec3(value['max'], 'bounds.max');

  // Rule 2: min < max on all three axes.
  for (const axis of AXES) {
    if (axis.of(min) >= axis.of(max)) {
      fail(`bounds: min.${axis.label} must be less than max.${axis.label} (rule 2)`);
    }
  }
  return { min, max };
}

function intersectsBounds(bounds: Bounds, box: Aabb): boolean {
  return AXES.every(
    (axis) =>
      axis.of(box.max) >= axis.of(bounds.min) - EPSILON &&
      axis.of(box.min) <= axis.of(bounds.max) + EPSILON,
  );
}

function containsPoint(bounds: Bounds, p: Vec3): boolean {
  return AXES.every(
    (axis) =>
      axis.of(p) >= axis.of(bounds.min) - EPSILON &&
      axis.of(p) <= axis.of(bounds.max) + EPSILON,
  );
}

function requireBlock(value: unknown, index: number): Block {
  if (!isRecord(value)) fail(`blocks[${String(index)}]: expected an object`);
  const id = requireString(value['id'], `blocks[${String(index)}].id`);
  const pos = requireVec3(value['pos'], `block "${id}".pos`);
  const size = requireVec3(value['size'], `block "${id}".size`);

  // Rule 3: size is strictly positive on all three axes.
  for (const axis of AXES) {
    if (axis.of(size) <= 0) {
      fail(`block "${id}": size.${axis.label} must be greater than zero (rule 3)`);
    }
  }

  // Rule 8: kind is a member of its union.
  const kind = value['kind'];
  if (typeof kind !== 'string' || !KINDS.includes(kind)) {
    fail(
      `block "${id}": kind must be one of ${KINDS.join(', ')}, got ${JSON.stringify(kind)} (rule 8)`,
    );
  }
  return { id, pos, size, kind: kind as BlockKind };
}

function requireSpawn(value: unknown, index: number): Spawn {
  if (!isRecord(value)) fail(`spawns[${String(index)}]: expected an object`);
  const id = requireString(value['id'], `spawns[${String(index)}].id`);
  const pos = requireVec3(value['pos'], `spawn "${id}".pos`);
  const yaw = requireFinite(value['yaw'], `spawn "${id}".yaw`);

  // Rule 8: team is a member of its union.
  const team = value['team'];
  if (typeof team !== 'string' || !TEAMS.includes(team)) {
    fail(
      `spawn "${id}": team must be one of ${TEAMS.join(', ')}, got ${JSON.stringify(team)} (rule 8)`,
    );
  }
  return { id, pos, yaw, team: team as SpawnTeam };
}

/** Rule 6: ids are unique within their collection. */
function requireUniqueIds(items: readonly { id: string }[], collection: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      fail(`${collection}: duplicate id "${item.id}" (rule 6)`);
    }
    seen.add(item.id);
  }
}

interface Rect {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
}

/**
 * Does the union of `rects` fully cover `target`?
 *
 * Coordinate compression: the union of axis-aligned rectangles covers the target exactly
 * when every cell of the grid formed by all rectangle edges is covered by some rectangle.
 * Checking cell centres is sufficient because no rectangle boundary falls strictly inside
 * a cell -- every edge is, by construction, a grid line.
 *
 * This is what lets rule 9 accept a perimeter built from many blocks (which a designed
 * arena will be at M4) rather than demanding one block per face.
 */
function unionCovers(rects: readonly Rect[], target: Rect): boolean {
  const cuts = (lo: number, hi: number, edges: readonly number[]): number[] => {
    const inside = new Set<number>([lo, hi]);
    for (const edge of edges) {
      if (edge > lo && edge < hi) inside.add(edge);
    }
    return [...inside].sort((a, b) => a - b);
  };

  const uu = cuts(
    target.u0,
    target.u1,
    rects.flatMap((r) => [r.u0, r.u1]),
  );
  const vv = cuts(
    target.v0,
    target.v1,
    rects.flatMap((r) => [r.v0, r.v1]),
  );

  return midpoints(uu).every((uMid) =>
    midpoints(vv).every((vMid) =>
      rects.some((r) => r.u0 <= uMid && r.u1 >= uMid && r.v0 <= vMid && r.v1 >= vMid),
    ),
  );
}

/** Centre of each interval between consecutive sorted cuts. */
function midpoints(sorted: readonly number[]): number[] {
  const mids: number[] = [];
  let previous: number | null = null;
  for (const value of sorted) {
    if (previous !== null) mids.push((previous + value) / 2);
    previous = value;
  }
  return mids;
}

/** Blocks whose extent spans `plane` on `axis` -- i.e. that sit in that face. */
function blocksOnPlane(boxes: readonly Aabb[], axis: Axis, plane: number): Aabb[] {
  return boxes.filter(
    (b) => axis.of(b.min) <= plane + EPSILON && axis.of(b.max) >= plane - EPSILON,
  );
}

function project(box: Aabb, u: Axis, v: Axis): Rect {
  return { u0: u.of(box.min), u1: u.of(box.max), v0: v.of(box.min), v1: v.of(box.max) };
}

/**
 * Rule 9: the arena is sealed -- a floor and four perimeter walls fully enclose `bounds`
 * (FR-MAP-006).
 *
 * The ceiling is deliberately exempt. Nothing in the movement model produces sustained
 * upward motion: GRAVITY is constant and downward, and a single JUMP_VELOCITY impulse
 * cannot exceed the perimeter walls, which are required to span the full height of
 * `bounds`. A player can therefore reach the top of the arena only by leaving through a
 * side, which is exactly what the four wall checks forbid.
 */
function requireSealed(bounds: Bounds, blocks: readonly Block[]): void {
  const boxes = blocks.map(blockAabb);

  const floorRects = blocksOnPlane(boxes, Y, bounds.min[1]).map((b) => project(b, X, Z));
  const floorTarget: Rect = {
    u0: bounds.min[0],
    u1: bounds.max[0],
    v0: bounds.min[2],
    v1: bounds.max[2],
  };
  if (!unionCovers(floorRects, floorTarget)) {
    fail('bounds: the arena has no continuous floor across its full extent (rule 9)');
  }

  const walls: readonly { axis: Axis; across: Axis; plane: number; label: string }[] = [
    { axis: X, across: Z, plane: bounds.min[0], label: '-X' },
    { axis: X, across: Z, plane: bounds.max[0], label: '+X' },
    { axis: Z, across: X, plane: bounds.min[2], label: '-Z' },
    { axis: Z, across: X, plane: bounds.max[2], label: '+Z' },
  ];

  for (const wall of walls) {
    const rects = blocksOnPlane(boxes, wall.axis, wall.plane).map((b) =>
      project(b, wall.across, Y),
    );
    const target: Rect = {
      u0: wall.across.of(bounds.min),
      u1: wall.across.of(bounds.max),
      v0: bounds.min[1],
      v1: bounds.max[1],
    };
    if (!unionCovers(rects, target)) {
      fail(`bounds: the ${wall.label} perimeter wall does not seal the arena (rule 9)`);
    }
  }
}

/**
 * Parses and validates an arena file. Rules are numbered as in
 * specs/000-m0-walking-box/data-model.md.
 */
export function loadMap(raw: unknown): GameMap {
  if (!isRecord(raw)) fail(`map: expected an object, got ${JSON.stringify(raw)}`);

  const id = requireString(raw['id'], 'map.id');
  const name = requireString(raw['name'], 'map.name');
  const version = requireFinite(raw['version'], 'map.version');
  const bounds = requireBounds(raw['bounds']);

  if (!Array.isArray(raw['blocks'])) fail('map.blocks: expected an array');
  if (!Array.isArray(raw['spawns'])) fail('map.spawns: expected an array');

  const blocks = raw['blocks'].map(requireBlock);
  const spawns = raw['spawns'].map(requireSpawn);

  requireUniqueIds(blocks, 'blocks');
  requireUniqueIds(spawns, 'spawns');

  /*
   * Rule 4: every block must intersect bounds -- it may not float somewhere unrelated.
   *
   * Deliberately intersection and not containment. `bounds` is the playable volume, and
   * the geometry that *encloses* it necessarily sits just outside: FR-MAP-003's own
   * example puts a spawn at y = 0 with bounds.min.y = 0, which leaves nowhere inside
   * bounds for a floor to be. Requiring containment would make a sealed arena
   * unexpressible.
   */
  for (const block of blocks) {
    if (!intersectsBounds(bounds, blockAabb(block))) {
      fail(`block "${block.id}": lies entirely outside bounds (rule 4)`);
    }
  }

  // Rule 7: at least one spawn exists, or the map loads successfully and is unplayable.
  if (spawns.length === 0)
    fail('map.spawns: at least one spawn point is required (rule 7)');

  // Rule 5: spawns are inside bounds and not inside a block.
  for (const spawn of spawns) {
    if (!containsPoint(bounds, spawn.pos)) {
      fail(`spawn "${spawn.id}": lies outside bounds (rule 5)`);
    }
    for (const block of blocks) {
      const box = blockAabb(block);
      const inside = AXES.every(
        (axis) =>
          axis.of(spawn.pos) > axis.of(box.min) + EPSILON &&
          axis.of(spawn.pos) < axis.of(box.max) - EPSILON,
      );
      if (inside) {
        fail(`spawn "${spawn.id}": lies inside block "${block.id}" (rule 5)`);
      }
    }
  }

  requireSealed(bounds, blocks);

  return { id, name, version, bounds, blocks, spawns };
}
