import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MapValidationError, loadMap } from './load.ts';
import { blockAabb } from './types.ts';

/** The shipped arena, used as the known-good base every rejection case mutates. */
const VALID: unknown = JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8'));

/** Deep clone so a mutation in one test cannot leak into another. */
function base(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
}

function blocks(map: Record<string, unknown>): Record<string, unknown>[] {
  return map['blocks'] as Record<string, unknown>[];
}

function spawns(map: Record<string, unknown>): Record<string, unknown>[] {
  return map['spawns'] as Record<string, unknown>[];
}

/** Asserts the failure names both the offending element and the rule. */
function expectRejection(map: unknown, ...fragments: string[]): void {
  try {
    loadMap(map);
  } catch (error) {
    expect(error).toBeInstanceOf(MapValidationError);
    const { message } = error as MapValidationError;
    for (const fragment of fragments) expect(message).toContain(fragment);
    return;
  }
  throw new Error('expected loadMap to reject, but it returned');
}

describe('the shipped arena', () => {
  it('loads', () => {
    const map = loadMap(VALID);
    expect(map.id).toBe('arena-01');
    expect(map.blocks.length).toBeGreaterThan(0);
    expect(map.spawns.length).toBeGreaterThan(0);
  });

  it('derives half-extents rather than requiring them to be authored', () => {
    const map = loadMap(VALID);
    const floor = map.blocks.find((b) => b.id === 'floor-a')!;
    const box = blockAabb(floor);
    expect(box.min).toEqual([-40, -1, -40]);
    expect(box.max).toEqual([0, 0, 40]);
  });
});

describe('shape', () => {
  it('rejects a non-object map', () => {
    expectRejection(null, 'map: expected an object');
    expectRejection([], 'map: expected an object');
    expectRejection('arena', 'map: expected an object');
  });

  it('rejects a missing or empty id and name', () => {
    const missingId = base();
    delete missingId['id'];
    expectRejection(missingId, 'map.id');

    const emptyName = base();
    emptyName['name'] = '';
    expectRejection(emptyName, 'map.name');
  });

  it('rejects non-array blocks and spawns', () => {
    const badBlocks = base();
    badBlocks['blocks'] = {};
    expectRejection(badBlocks, 'map.blocks: expected an array');

    const badSpawns = base();
    badSpawns['spawns'] = 'none';
    expectRejection(badSpawns, 'map.spawns: expected an array');
  });

  it('rejects a non-object block or spawn entry', () => {
    const badBlock = base();
    blocks(badBlock)[0] = 'wall' as unknown as Record<string, unknown>;
    expectRejection(badBlock, 'blocks[0]: expected an object');

    const badSpawn = base();
    spawns(badSpawn)[0] = 7 as unknown as Record<string, unknown>;
    expectRejection(badSpawn, 'spawns[0]: expected an object');
  });
});

describe('rule 1 — every numeric field is finite', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
    ['a string', '3'],
  ])('rejects %s in a block position', (_label, value) => {
    const map = base();
    (blocks(map)[0]!['pos'] as unknown[])[1] = value;
    expectRejection(map, 'rule 1');
  });

  it('rejects a non-finite version and spawn yaw', () => {
    const badVersion = base();
    badVersion['version'] = Number.NaN;
    expectRejection(badVersion, 'map.version', 'rule 1');

    const badYaw = base();
    spawns(badYaw)[0]!['yaw'] = Number.POSITIVE_INFINITY;
    expectRejection(badYaw, 'yaw', 'rule 1');
  });

  it('rejects a vector that is not three numbers', () => {
    const short = base();
    blocks(short)[0]!['pos'] = [1, 2];
    expectRejection(short, 'expected [x, y, z]');

    const notArray = base();
    blocks(notArray)[0]!['size'] = { x: 1 };
    expectRejection(notArray, 'expected [x, y, z]');
  });
});

describe('rule 2 — bounds.min is less than bounds.max on every axis', () => {
  it('rejects a non-object bounds', () => {
    const map = base();
    map['bounds'] = 40;
    expectRejection(map, 'bounds: expected an object');
  });

  it.each([
    [0, 'x'],
    [1, 'y'],
    [2, 'z'],
  ])('rejects an inverted or zero-volume extent on axis %i', (axis, label) => {
    const map = base();
    const bounds = map['bounds'] as Record<string, number[]>;
    bounds['max']![axis] = bounds['min']![axis]!;
    expectRejection(map, `min.${label}`, 'rule 2');
  });
});

describe('rule 3 — block size is strictly positive', () => {
  it.each([
    [0, 'x'],
    [1, 'y'],
    [2, 'z'],
  ])('rejects a zero or negative extent on axis %i', (axis, label) => {
    const map = base();
    (blocks(map)[0]!['size'] as number[])[axis] = 0;
    expectRejection(map, `size.${label}`, 'rule 3');

    const negative = base();
    (blocks(negative)[0]!['size'] as number[])[axis] = -2;
    expectRejection(negative, `size.${label}`, 'rule 3');
  });
});

describe('rule 4 — every block intersects bounds', () => {
  it('rejects a block floating entirely outside', () => {
    const map = base();
    blocks(map).push({ id: 'stray', pos: [500, 1, 0], size: [1, 1, 1], kind: 'wall' });
    expectRejection(map, 'stray', 'rule 4');
  });

  it('rejects a block outside on the negative side too', () => {
    const map = base();
    blocks(map).push({
      id: 'stray-neg',
      pos: [0, -500, 0],
      size: [1, 1, 1],
      kind: 'wall',
    });
    expectRejection(map, 'stray-neg', 'rule 4');
  });

  it('accepts the enclosing shell, which necessarily sits just outside bounds', () => {
    // The floor spans y = -1..0 while bounds.min.y = 0. Containment would reject it.
    expect(() => loadMap(VALID)).not.toThrow();
  });
});

describe('rule 5 — spawns are inside bounds and not inside a block', () => {
  it('rejects a spawn outside bounds', () => {
    const map = base();
    spawns(map)[0]!['pos'] = [999, 0, 0];
    expectRejection(map, 's1', 'rule 5');
  });

  it('rejects a spawn buried inside a block', () => {
    const map = base();
    spawns(map)[0]!['pos'] = [0, 1.5, -10]; // the centre of w1
    expectRejection(map, 's1', 'w1', 'rule 5');
  });

  it('accepts a spawn resting exactly on the floor surface', () => {
    // y = 0 is the floor's top face, not strictly inside it.
    expect(() => loadMap(VALID)).not.toThrow();
  });
});

describe('rule 6 — ids are unique', () => {
  it('rejects duplicate block ids', () => {
    const map = base();
    blocks(map).push({ ...blocks(map)[5]!, id: 'w1' });
    expectRejection(map, 'duplicate id "w1"', 'rule 6');
  });

  it('rejects duplicate spawn ids', () => {
    const map = base();
    spawns(map).push({ ...spawns(map)[0]! });
    expectRejection(map, 'duplicate id "s1"', 'rule 6');
  });
});

describe('rule 7 — at least one spawn exists', () => {
  it('rejects an arena nobody can enter', () => {
    const map = base();
    map['spawns'] = [];
    expectRejection(map, 'rule 7');
  });
});

describe('rule 8 — kind and team are members of their unions', () => {
  it('rejects an unknown block kind', () => {
    const map = base();
    blocks(map)[0]!['kind'] = 'walll';
    expectRejection(map, 'floor', 'kind must be one of', 'rule 8');
  });

  it('rejects a non-string block kind', () => {
    const map = base();
    blocks(map)[0]!['kind'] = 3;
    expectRejection(map, 'rule 8');
  });

  it('rejects an unknown spawn team', () => {
    const map = base();
    spawns(map)[0]!['team'] = 'GREEN';
    expectRejection(map, 's1', 'team must be one of', 'rule 8');
  });

  it('rejects a non-string spawn team', () => {
    const map = base();
    spawns(map)[0]!['team'] = null;
    expectRejection(map, 'rule 8');
  });
});

describe('rule 9 — the arena is sealed', () => {
  it('rejects a map with no floor', () => {
    const map = base();
    map['blocks'] = blocks(map).filter((b) => !String(b['id']).startsWith('floor'));
    expectRejection(map, 'continuous floor', 'rule 9');
  });

  it('rejects a floor with a hole in it', () => {
    const map = base();
    // Replace the full floor with two slabs that leave a gap down the middle.
    map['blocks'] = [
      { id: 'floor-a', pos: [-25, -0.5, 0], size: [30, 1, 80], kind: 'wall' },
      { id: 'floor-b', pos: [25, -0.5, 0], size: [30, 1, 80], kind: 'wall' },
      ...blocks(map).filter((b) => !String(b['id']).startsWith('floor')),
    ];
    expectRejection(map, 'continuous floor', 'rule 9');
  });

  it.each([
    ['perim-nx', '-X'],
    ['perim-px', '+X'],
    ['perim-nz', '-Z'],
    ['perim-pz', '+Z'],
  ])('rejects a map missing the %s perimeter wall', (id, label) => {
    const map = base();
    map['blocks'] = blocks(map).filter((b) => b['id'] !== id);
    expectRejection(map, `${label} perimeter wall`, 'rule 9');
  });

  it('rejects a perimeter wall that does not span the full height of bounds', () => {
    const map = base();
    const wall = blocks(map).find((b) => b['id'] === 'perim-nx')!;
    wall['size'] = [1, 6, 81];
    wall['pos'] = [-40.5, 3, 0];
    expectRejection(map, '-X perimeter wall', 'rule 9');
  });

  it('accepts a perimeter built from several blocks rather than one', () => {
    // A designed arena (M4) will not have one block per face; rule 9 must not force it.
    const map = base();
    map['blocks'] = [
      ...blocks(map).filter((b) => b['id'] !== 'perim-nx'),
      { id: 'nx-lower', pos: [-40.5, 3, 0], size: [1, 6, 81], kind: 'wall' },
      { id: 'nx-upper', pos: [-40.5, 9, 0], size: [1, 6, 81], kind: 'wall' },
    ];
    expect(() => loadMap(map)).not.toThrow();
  });
});
