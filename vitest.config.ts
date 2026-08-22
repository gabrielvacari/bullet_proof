import { defineConfig } from 'vitest/config';

/**
 * Coverage targets are PER DIRECTORY, not a single repository number.
 * Rationale in CONTRIBUTING.md#testing:
 *   - shared/ is pure and deterministic (NFR-004) -> 100%, no excuses
 *   - client/render/ needs real WebGL -> excluded; unit tests there find nothing
 * A uniform global threshold would let the simulation hide behind the average.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['**/*.{test,spec}.ts'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',

      // Only these are measured. Excluded code is out of the denominator too --
      // it must not silently inflate the average either.
      include: ['shared/**/*.ts', 'server/**/*.ts', 'client/**/*.ts'],
      exclude: [
        'client/render/**', // real WebGL required
        // Thin DOM shells: they bind listeners and call into pure modules that ARE
        // tested (client/input/aim.ts, client/input/keys.ts, client/boot/loop.ts).
        // Testing them would amount to testing the browser's event dispatch.
        'client/input/pointer-lock.ts',
        'client/boot/main.ts',
        '**/*.d.ts',
        '**/*.{test,spec}.ts',
        '**/__fixtures__/**',
        '**/index.ts', // re-export barrels only
      ],

      thresholds: {
        // Floor for anything not matched below.
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,

        // The simulation IS the project. It is pure. 100% or the build fails.
        'shared/sim/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // Validators are the security boundary (NFR-011).
        'shared/protocol/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'shared/map/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'server/**': {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        // Prediction and reconciliation -- where the hard bugs live.
        'client/net/**': {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        'client/hud/**': { lines: 50, functions: 50, branches: 40, statements: 50 },
        'client/storage/**': { lines: 50, functions: 50, branches: 40, statements: 50 },
      },
    },
  },
});
