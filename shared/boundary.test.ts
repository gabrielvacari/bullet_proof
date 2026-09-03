import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The second of the three layers protecting Principle II.
 *
 * The ESLint rules in eslint.config.js are the first, but they match syntax: they see an
 * `import` declaration and a `Math.cos` member expression. This test reads the source
 * text instead, so it still fires for anything expressed in a form the rule does not
 * recognise -- a dynamic import, a computed member access, a re-export.
 *
 * Together with the 100% coverage thresholds, this is what makes NFR-003 and NFR-004
 * enforceable rather than aspirational.
 */

const SHARED = 'shared';

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

const FILES = sourceFiles(SHARED).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

/** Strips comments, so prose explaining a banned construct does not trip its own rule. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('shared/ contains source to check', () => {
  it('found files', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

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

  it.each(COMBAT_MODULES)('scans %s', (module) => {
    expect(FILES.map((file) => file.path)).toContain(module);
  });
});

describe.each(FILES)('$path', ({ text }) => {
  const body = code(text);

  it('imports nothing from client/ or server/', () => {
    expect(body).not.toMatch(/from\s+['"]#(client|server)\//);
    expect(body).not.toMatch(/from\s+['"][^'"]*\.\.\/(client|server)\//);
  });

  it('imports no renderer and no Node built-in', () => {
    expect(body).not.toMatch(/from\s+['"]three(\/|['"])/);
    expect(body).not.toMatch(/from\s+['"]node:/);
    expect(body).not.toMatch(/from\s+['"](fs|path|http|ws)['"]/);
  });

  it('uses no dynamic import to smuggle a dependency past the static check', () => {
    expect(body).not.toMatch(/\bimport\s*\(/);
    expect(body).not.toMatch(/\brequire\s*\(/);
  });

  it('touches no DOM, no Node global, and no ambient state', () => {
    expect(body).not.toMatch(/\bwindow\b/);
    expect(body).not.toMatch(/\bdocument\b/);
    expect(body).not.toMatch(/\bprocess\b/);
    expect(body).not.toMatch(/\bglobalThis\b/);
  });

  it('reads no clock and uses no randomness — NFR-004', () => {
    expect(body).not.toMatch(/Date\s*\.\s*now/);
    expect(body).not.toMatch(/performance\s*\.\s*now/);
    expect(body).not.toMatch(/new\s+Date\b/);
    expect(body).not.toMatch(/Math\s*\.\s*random/);
  });

  /**
   * ECMA-262 leaves these implementation-approximated, so two engines may return
   * different bits. The simulation integrates its results, so the difference grows
   * without bound. See ADR-0001.
   */
  it('calls no implementation-approximated Math function — ADR-0001', () => {
    const inexact = [
      'sin',
      'cos',
      'tan',
      'asin',
      'acos',
      'atan',
      'atan2',
      'sinh',
      'cosh',
      'tanh',
      'asinh',
      'acosh',
      'atanh',
      'pow',
      'exp',
      'expm1',
      'log',
      'log2',
      'log10',
      'log1p',
      'hypot',
      'cbrt',
    ];
    for (const fn of inexact) {
      expect(body).not.toMatch(new RegExp(`Math\\s*\\.\\s*${fn}\\b`));
    }
  });

  it('uses no computed member access on Math, which would evade the rule above', () => {
    expect(body).not.toMatch(/Math\s*\[/);
  });
});
