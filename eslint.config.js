import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Math members whose results ECMA-262 leaves implementation-approximated.
 * Two conforming engines may return different bits, and this project runs the same
 * simulation on Node and on three browser engines -- so a call to any of these inside
 * shared/ silently breaks NFR-003's bit-identity guarantee.
 * See docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md.
 */
const INEXACT_MATH = [
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

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'assets/**'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': 'allow-with-description', minimumDescriptionLength: 10 },
      ],
    },
  },

  /**
   * shared/ is sacred (CLAUDE.md rule 4).
   * It must run identically on Node and in the browser, or NFR-003 and NFR-004
   * -- deterministic, shared simulation -- become unenforceable.
   */
  {
    files: ['shared/**/*.ts'],
    ignores: ['shared/**/*.{test,spec}.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            /*
             * `regex`, not `group`. ESLint matches `group` with gitignore syntax, where a
             * leading `#` starts a comment -- so a pattern like '#client/**' is silently
             * discarded and matches nothing. Our subpath imports all begin with `#`.
             */
            {
              regex: '^#(client|server)/',
              message: 'shared/ must not import from client/ or server/ (NFR-003).',
            },
            {
              regex: '(^|/)\\.\\./(client|server)/',
              message: 'shared/ must not reach into client/ or server/ (NFR-003).',
            },
            {
              regex: '^three(/|$)',
              message: 'shared/ must not depend on the renderer (NFR-003).',
            },
            {
              regex: '^(node:|fs$|path$|http$|ws$)',
              message: 'shared/ must run in the browser too (NFR-003).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'shared/ must not touch the DOM (NFR-003).' },
        { name: 'document', message: 'shared/ must not touch the DOM (NFR-003).' },
        { name: 'process', message: 'shared/ must not depend on Node (NFR-003).' },
        {
          name: 'globalThis',
          message: 'shared/ must not reach for ambient state (NFR-004).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'The simulation must not read wall-clock time (NFR-004).',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'The simulation must not read wall-clock time (NFR-004).',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'The simulation must be deterministic; seed it outside sim (NFR-004).',
        },
        ...INEXACT_MATH.map((property) => ({
          object: 'Math',
          property,
          message:
            `Math.${property} is implementation-approximated (ECMA-262) and can differ ` +
            'between engines, which breaks NFR-003. Use exact arithmetic -- see ADR-0001.',
        })),
      ],
    },
  },

  /**
   * Gameplay numbers live in shared/constants and nowhere else (SC-4).
   * This is a nudge, not a proof -- review still has to look.
   */
  {
    files: ['shared/sim/**/*.ts', 'server/room/**/*.ts'],
    rules: {
      'no-magic-numbers': [
        'warn',
        {
          ignore: [0, 1, -1, 2],
          ignoreArrayIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],
    },
  },

  /**
   * Config files at the repo root are plain JS and are not part of the
   * TypeScript project, so the type-aware rules cannot resolve them.
   */
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  /**
   * Tests are held to different rules on purpose. A test asserting that a constant
   * really does equal cos(45 degrees) has to be able to call Math.cos -- that is the
   * point of the assertion. Test code is never imported by the simulation.
   */
  {
    files: ['**/*.{test,spec}.ts'],
    rules: {
      'no-magic-numbers': 'off',
      'no-restricted-properties': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
