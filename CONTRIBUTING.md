# Contributing

How work happens in this repository. These rules are enforced by tooling, not by good
intentions — see [Enforcement](#enforcement).

The **what** lives in [`requirements/`](requirements/README.md). This document is only the
**how**.

---

## Branching — GitHub Flow

`main` is protected, always green, and always deployable.

```
main    ──●───●───●───●──▶
           \  /   \  /
 feat/…     ●─●    │
 fix/…             ●─●
```

1. Branch from `main`.
2. Commit using [Conventional Commits](#commits).
3. Open a PR. CI must pass.
4. **Squash merge.** One feature, one commit on `main`.
5. Delete the branch.

There is no `develop`, no `release/*`, and no `hotfix/*`. One environment, one version in
flight, no long-lived parallel branches. This is not up for discussion — follow it.

### Branch naming

`<type>/<short-kebab-description>`, matching the commit type:

```
feat/client-prediction
fix/crouch-capsule-height
refactor/extract-shared-sim
docs/network-protocol
```

### Milestones are tags, not branches

Each roadmap milestone ([08-roadmap.md](requirements/08-roadmap.md)) is an annotated tag on
`main` once its demo criterion is genuinely met:

| Milestone               | Tag      |
| ----------------------- | -------- |
| M0 Walking box          | `v0.1.0` |
| M1 Two players moving   | `v0.2.0` |
| M2 Shooting             | `v0.3.0` |
| M3 An actual match      | `v0.4.0` |
| M4 It looks like a game | `v0.5.0` |
| M5 Finish               | `v1.0.0` |

---

## Commits

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/). **English, always** —
per `D-014`. Validated by commitlint on `commit-msg`; a non-conforming message is rejected
locally, before it ever reaches a branch.

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

| Type       | Use for                                           |
| ---------- | ------------------------------------------------- |
| `feat`     | A new capability a player can observe             |
| `fix`      | A bug fix                                         |
| `perf`     | A change made for speed or frame time             |
| `refactor` | Restructuring with no behaviour change            |
| `test`     | Adding or fixing tests only                       |
| `docs`     | Documentation, including `requirements/` and ADRs |
| `build`    | Bundler, `package.json`, dependencies             |
| `ci`       | GitHub Actions, hooks, lint config                |
| `chore`    | Everything else — assets, gitignore, housekeeping |
| `revert`   | Reverting a previous commit                       |

### Scopes

Scopes mirror the module boundaries in
[05-architecture.md](requirements/05-architecture.md#suggested-module-boundaries):

`sim` · `protocol` · `map` · `constants` · `server` · `room` · `matchmaker` · `net` ·
`client` · `render` · `input` · `hud` · `audio` · `storage`

Meta scopes: `repo` (project-level tooling, CI, hooks) · `assets` · `deps` ·
`requirements` · `adr`

Scope is optional but strongly preferred. `feat(sim): add crouch capsule` is worth far
more in six months than `feat: add crouch`.

### Subject

Imperative mood, lowercase, no trailing period, ≤ 72 characters.

```
✅ feat(net): reconcile predicted state against server snapshot
✅ fix(sim): clamp pitch before computing the aim ray
✅ docs(requirements): record crosshair ray decision as ADR-0004

❌ Added reconciliation.
❌ feat: stuff
❌ fix(sim): Fixed the bug where the player would sometimes fall through the floor when jumping
```

### Reference requirement IDs

When a commit implements or changes a requirement, name its ID in the body. This is what
makes `requirements/` traceable to code, and it is the main reason the IDs are stable.

```
feat(sim): apply regional damage multipliers

Head 50 / torso 20 / legs 10 against 100 health, using the static hit
volumes rather than animated bone transforms.

Implements: FR-GP-026, FR-GP-027
```

### Breaking changes

`!` after the scope, plus a `BREAKING CHANGE:` footer. In this project the network
protocol is the main thing that breaks:

```
feat(protocol)!: move ammo out of the shared snapshot

Ammo is now sent only to the owning player.

BREAKING CHANGE: clients older than v0.3.0 will read ammo as undefined.
Refs: NET-009
```

---

## Testing

Coverage targets are **per directory**, not a single repository number. A uniform 95% would
force mock-heavy tests around Three.js that verify their own mocks, while letting the
simulation — the part that actually has to be correct — hide behind the average.

| Path                                 | Lines      | Why                                                      |
| ------------------------------------ | ---------- | -------------------------------------------------------- |
| `shared/sim/**`                      | **100%**   | Pure and deterministic by `NFR-004`. There is no excuse. |
| `shared/protocol/**`                 | **100%**   | Validators are the security boundary — `NFR-011`         |
| `shared/map/**`                      | **100%**   | Pure                                                     |
| `server/**`                          | **90%**    | Testable with a fake socket                              |
| `client/net/**`                      | **90%**    | Prediction and reconciliation — where the hard bugs live |
| `client/hud/**`, `client/storage/**` | 50%        | DOM, low risk                                            |
| `client/render/**`                   | _excluded_ | Needs real WebGL; unit tests here find nothing           |

Enforced in [`vitest.config.ts`](vitest.config.ts) and gated in CI. Excluded is excluded
from the _denominator_ — it does not silently drag the average up either.

### The test that matters most

`NFR-003` requires client and server to run the same simulation. One property test proves
it, and it catches an entire class of prediction bugs that no unit test will:

```
test: given a random sequence of N inputs from an identical starting state,
      the client's predicted state and the server's authoritative state are
      byte-identical.
```

Write it as soon as `shared/sim` exists. It is worth more than the rest of the suite.

### Also required

- **Deterministic replay fixture** — a recorded input sequence with a known final state,
  replayed in CI. Catches physics regressions that unit tests miss.
- **Bug fixes start with a failing test.** A `fix:` commit without a test that fails before
  it and passes after should be questioned in review.

---

## Code

- **TypeScript `strict`.** Non-negotiable — `shared/` is imported by two runtimes with
  different globals, which is exactly where types earn their cost.
- **`shared/` is sacred.** It must not import from `client/` or `server/`, and must not
  reference `window`, `document`, `THREE`, or any Node built-in. Enforced by an ESLint
  boundary rule, not by discipline.
- **No gameplay number outside `shared/constants`.** If you type a number into game logic,
  it belongs in [07-constants.md](requirements/07-constants.md) instead. `SC-4` depends on
  this.
- **No `any`, no `@ts-ignore`** without a comment explaining why.

---

## Architecture decisions

Product decisions go in
[requirements/10-decision-log.md](requirements/10-decision-log.md).
Decisions with **no requirement ID** — project mechanics, and implementation choices a
requirement deliberately leaves open — go in [`docs/adr/`](docs/adr/README.md) as numbered
ADRs. The full boundary is in [docs/adr/README.md](docs/adr/README.md#where-a-decision-belongs).

Write an ADR when the decision is expensive to reverse. The open questions in
[11-open-questions.md](requirements/11-open-questions.md) are all ADRs waiting to be
written — `Q-003` (crosshair ray alignment) especially, and before M2, not after.

---

## Enforcement

| Rule                           | Enforced by                                | When             |
| ------------------------------ | ------------------------------------------ | ---------------- |
| Commit message format          | commitlint + husky `commit-msg`            | Local, on commit |
| Lint + format on changed files | lint-staged + husky `pre-commit`           | Local, on commit |
| Type checking                  | `tsc --noEmit`                             | CI               |
| Lint                           | ESLint                                     | CI               |
| Tests + coverage thresholds    | Vitest                                     | CI               |
| `main` stays green             | Branch protection: require CI + require PR | GitHub           |

If a hook is slowing you down, fix the hook. Do not use `--no-verify`.

## Setup

```bash
nvm use            # reads .nvmrc
npm install        # installs deps and sets up husky hooks
npm test           # should pass on a clean checkout
```
