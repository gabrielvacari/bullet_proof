import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SC-4 / M0-7 -- every gameplay number lives in shared/constants and nowhere else.
 *
 * ESLint's no-magic-numbers is configured as a warning and only on some directories, so
 * it nudges rather than proves. This scans the source text and fails the build, which is
 * what "changing a constant is the only change needed" actually requires.
 */

/** Structural values that are never gameplay tuning: identity, halves, axis indices. */
const ALLOWED = new Set(['0', '1', '2', '-1', '3']);

/** A named uppercase constant declaration is exactly how a value is *supposed* to appear. */
const NAMED_CONSTANT = /^\s*(?:export\s+)?const\s+[A-Z][A-Z0-9_]*(?::[^=]+)?\s*=/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** Strips comments, string literals and template literals. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Numbers used as a tuple or array index are structure, not tuning. */
function stripIndices(line: string): string {
  return line.replace(/\[\s*-?\d+\s*\]/g, '[]');
}

const FILES = sourceFiles('shared')
  // The constants module is the one place a number is allowed to be written down.
  .filter((path) => !path.startsWith(join('shared', 'constants')));

/**
 * The scan finds whatever is on disk, which means a module that stopped being scanned --
 * moved, renamed, or dropped by a directory the walk no longer descends into -- would
 * make this file quietly weaker while still reporting green. Naming the combat modules
 * turns that silent loss into a failure.
 */
const COMBAT_MODULES = [
  join('shared', 'math', 'ray.ts'),
  join('shared', 'sim', 'hitvolume.ts'),
  join('shared', 'sim', 'damage.ts'),
  join('shared', 'sim', 'spawn.ts'),
];

describe('the combat modules are actually scanned', () => {
  it.each(COMBAT_MODULES)('%s is in the scanned set', (module) => {
    expect(FILES).toContain(module);
  });
});

describe.each(FILES)('%s contains no gameplay literal', (path) => {
  it('writes every number by name', () => {
    const offenders: string[] = [];

    code(readFileSync(path, 'utf8'))
      .split('\n')
      .forEach((raw, index) => {
        if (NAMED_CONSTANT.test(raw)) return;
        const line = stripIndices(raw);
        for (const match of line.matchAll(/(?<![\w.$])-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)) {
          const literal = match[0];
          if (ALLOWED.has(literal)) continue;
          offenders.push(`line ${String(index + 1)}: ${literal} — ${raw.trim()}`);
        }
      });

    expect(offenders).toEqual([]);
  });
});

describe('the scan itself', () => {
  it('would catch a planted gameplay literal', () => {
    // Guards against the scan silently matching nothing and passing for the wrong reason.
    const planted = 'const speed = velocity * 5.0;';
    const found = [...stripIndices(code(planted)).matchAll(/(?<![\w.$])-?\d+(?:\.\d+)?/g)]
      .map((m) => m[0])
      .filter((literal) => !ALLOWED.has(literal));
    expect(found).toEqual(['5.0']);
  });

  it('found files to scan', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });
});
