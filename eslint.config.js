import js from '@eslint/js';
import tseslint from 'typescript-eslint';

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
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@client/*', '@server/*', '../client/*', '../server/*'],
              message: 'shared/ must not import from client/ or server/ (NFR-003).',
            },
            {
              group: ['three', 'three/*'],
              message: 'shared/ must not depend on the renderer (NFR-003).',
            },
            {
              group: ['node:*', 'fs', 'path', 'http', 'ws'],
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
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'The simulation must not read wall-clock time (NFR-004).',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'The simulation must be deterministic; seed it outside sim (NFR-004).',
        },
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

  {
    files: ['**/*.{test,spec}.ts'],
    rules: {
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
