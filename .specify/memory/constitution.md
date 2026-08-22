# Bullet Proof Constitution

Browser-based 3D multiplayer arena shooter. Portfolio project.

This document governs how Spec Kit operates in this repository. It is binding on
`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, and `/speckit-implement`.

**It is not the source of truth for what gets built.**
[`requirements/`](../../requirements/README.md) is. This document says how to work with it.

---

## Core Principles

### I. `requirements/` is supreme (NON-NEGOTIABLE)

Every requirement in this project already exists, has a stable ID (`FR-GP-026`, `NFR-003`,
`NET-009`, `FR-MAP-002`), a status, and a testable acceptance criterion. A Spec Kit spec
**cites** those IDs; it never restates, rewords, or re-derives them.

- Never invent a requirement. If something is unspecified, it is in
  [`11-open-questions.md`](../../requirements/11-open-questions.md). If it blocks the work,
  **stop and ask the project owner** — do not guess, and do not proceed on an assumption.
- Never build anything marked `DROPPED` or `DEFERRED` in
  [`09-out-of-scope.md`](../../requirements/09-out-of-scope.md). Those are decisions, not gaps.
- A spec that contradicts `requirements/` is the bug. Fix the spec, or amend `requirements/`
  first and deliberately.

**Rationale:** two documents describing the same rule drift. The one with the requirement ID
wins, always, so there is never a question about which is current.

### II. The simulation is shared, pure, and deterministic (NON-NEGOTIABLE)

`NFR-003` and `NFR-004`. Movement integration, collision resolution, and the raycast are
implemented **once**, in `shared/`, imported by both client and server.

`shared/` must:

- import nothing from `client/` or `server/`;
- reference no `window`, `document`, `THREE`, or Node built-in;
- read no wall-clock time and use no unseeded randomness;
- take no `dt` from outside — the timestep is a constant.

The simulation step is a pure function of `(state, input, map)`. Same inputs twice ⇒
byte-identical output, proven by a test.

**Rationale:** two divergent implementations of movement is the most common cause of
prediction misfires, and retrofitting client-only movement into shared deterministic code is
the single most expensive mistake available in this project. This principle is the mitigation,
and it is enforced by lint rule and test, not by reviewer memory.

### III. The server is authoritative

`NFR-001`. The server holds the only true world state. Clients send **intent** and render the
result; they never assert outcomes.

No inbound message may set health, position, velocity, score, or kill status. A message
asserting "I killed player X" has no handler because no such message exists in the protocol
(`NET-007`). If a plan proposes one, the plan is wrong.

Every field of every inbound message is validated for presence, type, and range before it
reaches game logic (`NFR-011`). Player nicknames reach the DOM as `textContent`, never
`innerHTML`, in every surface that renders them (`NFR-012`).

### IV. Every number lives in `shared/constants`

`SC-4` and [`07-constants.md`](../../requirements/07-constants.md). A gameplay literal outside
`shared/constants` is a defect, regardless of whether it is correct.

Changing match length, damage, or weapon behaviour must require editing exactly one file and
nothing else. Values in prose are written `{CONSTANT_NAME}`; values in code are imported by
name. Derived values (shots to kill, tick duration) are computed, never written down twice.

Changing a constant's **value** is a product decision — ask the project owner. Adding a new
constant because a plan needs a number is fine; putting that number anywhere else is not.

### V. Milestone order is the plan (NON-NEGOTIABLE)

[`08-roadmap.md`](../../requirements/08-roadmap.md) defines M0–M5. Each has one demo criterion.
**Do not start the next milestone while the current one's criterion is unmet**, and do not pull
later-milestone work forward because it seems convenient.

A spec covers exactly one milestone. Work that belongs to a later milestone is listed in that
spec's out-of-scope table with the milestone that owns it — visible, not silently dropped.

**Rationale:** the ordering exists so something is playable as early as possible and every
phase adds to a working game rather than completing an unfinished one. Reordering destroys that.

### VI. Tests are the gate, per directory

Coverage targets are per directory, not a global average — see `vitest.config.ts` and
[CONTRIBUTING.md](../../CONTRIBUTING.md#testing):

| Directory                                     | Threshold                   |
| --------------------------------------------- | --------------------------- |
| `shared/sim`, `shared/protocol`, `shared/map` | **100%**                    |
| `server/`, `client/net/`                      | 90%                         |
| `client/render/`                              | excluded — needs real WebGL |

`npm run verify` (typecheck + lint + coverage) must be green before any commit. A uniform
global threshold would let the simulation hide behind the average, which is why there isn't one.

Lowering a threshold is a decision for the project owner, never a way to land a task.

---

## Technical Constraints

Fixed by [`05-architecture.md`](../../requirements/05-architecture.md). A plan may not
renegotiate these:

| Constraint         | Value                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime            | Node.js LTS, a **long-lived stateful process** — serverless is ruled out (`NFR-002`)                                                       |
| Transport          | WebSocket, JSON in v1. Binary encoding and delta compression are `DEFERRED` (`NET-022`, `NET-023`) — do not pre-optimise                   |
| Renderer           | Three.js, WebGL2, desktop browsers only                                                                                                    |
| Language           | TypeScript `strict`. No `any`. No `@ts-ignore` without a justifying comment                                                                |
| Build              | Vite, with a shared source directory imported by both runtimes                                                                             |
| Persistence        | `localStorage` only. **No database** (`D-015`)                                                                                             |
| Physics            | Hand-written AABB collision. No third-party physics engine — it would be non-deterministic across client and server, breaking Principle II |
| Language of record | English in documents, UI copy, code, identifiers, and commits (`D-014`)                                                                    |

**Adding any dependency requires the project owner's approval.** So does changing CI config or
a database-shaped decision — there is no database, and adding one is not an implementation detail.

---

## Development Workflow

### Document boundaries

Four kinds of document, and each answers exactly one question:

| Document                                        | Owns                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`requirements/`](../../requirements/README.md) | **What** gets built. Every requirement ID. The source of truth.                                                      |
| [`docs/adr/`](../../docs/adr/README.md)         | **Why** the architecture is like this — significant, expensive-to-reverse technical decisions with no requirement ID |
| `specs/NNN-*/`                                  | **How** one milestone gets built: scope, order, verification                                                         |
| [CONTRIBUTING.md](../../CONTRIBUTING.md)        | Process and tooling. Rules you follow, not decisions you relitigate                                                  |

Two tests before writing anything down:

1. Does it already have a requirement ID? → `requirements/`. Cite it, do not copy it.
2. Does it shape the architecture and would it be expensive to undo? → an ADR, before the code.

An open question that blocks a milestone must be resolved **before** that milestone's plan —
as a `D-###` in [`10-decision-log.md`](../../requirements/10-decision-log.md) for product
decisions, or an ADR for technical ones — and deleted from `11-open-questions.md`.

### ID namespaces — do not collide

The Spec Kit templates mint `FR-001` and `SC-001`. **This project does not use them.** Its
namespaces are already taken and permanent:

| Namespace                        | Meaning                         | Minted by            |
| -------------------------------- | ------------------------------- | -------------------- |
| `FR-GP-*`, `FR-UI-*`, `FR-MAP-*` | Functional requirements         | `requirements/` only |
| `NFR-*`, `NET-*`                 | Architecture, network protocol  | `requirements/` only |
| `SC-1`…`SC-5`                    | Project-wide success criteria   | `01-vision.md` only  |
| `D-*`                            | Product decisions               | `10-decision-log.md` |
| `ADR-*`                          | Architecture decisions          | `docs/adr/`          |
| **`M<N>-<n>`**                   | **Per-milestone exit criteria** | **a spec**           |

A spec's "Requirements" section is a table of **existing** IDs and what this milestone must
satisfy for each. A spec's "Success Criteria" section uses `M<N>-<n>` — never `SC-###`, which
would shadow `01-vision.md`.

**Requirement IDs are permanent.** Never renumber. To retire one, mark it `Status: DROPPED`
and keep the ID.

### Git

GitHub Flow, from [CONTRIBUTING.md](../../CONTRIBUTING.md):

- Branch from `main` as `<type>/<short-kebab-description>`, matching the commit type. Spec Kit
  feature directories are numbered `specs/NNN-name/`; **that number is not a branch name.**
- [Conventional Commits](https://www.conventionalcommits.org/), English, validated by
  commitlint. Scope comes from the enum in `commitlint.config.js`.
- Cite requirement IDs in the commit body: `Implements: FR-GP-017`. Squash merge is what makes
  that body the permanent traceability record.
- Milestones are annotated tags on `main` (`v0.1.0` … `v1.0.0`), never branches.

### The gate

`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`.

Each phase stops for the project owner's review. Do not advance on your own judgement. A task
that turns out to need a decision stops and asks rather than assuming — see Principle I.

---

## Traps

Mistakes that are cheap to avoid now and expensive to fix later. Check a plan against these:

- **Writing movement in `client/` first.** Principle II. The most expensive mistake available.
- **Deriving hit volumes from animated bones.** `FR-GP-027` deliberately uses static
  primitives. Do not "improve" this.
- **Rendering nameplates without the occlusion check.** `FR-GP-048`. Without it, labels draw
  through walls and every wall in the arena becomes decoration — which silently defeats the
  original design goal.
- **Assuming the crosshair ray equals the eye ray.** The camera is offset (`CAMERA_OFFSET`).
  Unresolved — [`Q-003`](../../requirements/11-open-questions.md#q-003). It must be an ADR
  before firing code exists in M2, not after.
- **Optimising the protocol early.** JSON is within budget. `NET-022`, `NET-023`.
- **Adding a database.** There is none, by decision (`D-015`).
- **Restoring `passWithNoTests: true` in `vitest.config.ts`.** It was removed at M0
  (`D-018`). Putting it back would let a suite that lost all its tests pass CI in silence.

---

## Governance

This constitution governs Spec Kit's behaviour and is subordinate to `requirements/`. Where it
conflicts with a requirement ID, the requirement wins and this document is amended.

Amendments require the project owner's approval and a version bump:

- **MAJOR** — a principle is removed or its meaning reversed.
- **MINOR** — a principle or a binding section is added.
- **PATCH** — clarification that changes no rule.

Every plan and every review verifies compliance with the principles above. Complexity that
violates one must be justified in the plan's Complexity Tracking section, or dropped.

**Version**: 1.0.0 | **Ratified**: 2026-08-22 | **Last Amended**: 2026-08-22
