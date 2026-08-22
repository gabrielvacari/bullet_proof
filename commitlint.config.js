/**
 * Conventional Commits, enforced on commit-msg.
 * See CONTRIBUTING.md#commits.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'refactor',
        'test',
        'docs',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // Scopes mirror the module boundaries in requirements/05-architecture.md.
    'scope-enum': [
      2,
      'always',
      [
        // shared
        'sim',
        'protocol',
        'map',
        'constants',
        // server
        'server',
        'room',
        'matchmaker',
        'net',
        // client
        'client',
        'render',
        'input',
        'hud',
        'audio',
        'storage',
        // meta
        'repo', // project-level config: tooling, ci, hooks, editor
        'assets',
        'deps',
        'requirements',
        'adr',
      ],
    ],
    'scope-empty': [1, 'never'],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
};
