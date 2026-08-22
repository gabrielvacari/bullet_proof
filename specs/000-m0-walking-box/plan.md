# Implementation Plan: M0 — Walking box

**Branch**: `chore/adopt-spec-kit` (feature dir `000-m0-walking-box`) | **Date**: 2026-08-22 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/000-m0-walking-box/spec.md`

---

## Summary

Build the skeleton the whole project hangs off: the `shared` / `client` / `server` split, a
data-driven arena, and a deterministic movement simulation that is born in `shared/sim`.

The technical approach is decided by one thing above all else — `NFR-003`'s demand that the
client's prediction and the server's simulation be **bit-identical**. Phase 0 found that
JavaScript does not give that away for free: transcendental `Math` functions are
implementation-approximated, and this project deliberately runs the same simulation on Node and
on three different browser engines. [ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md)
resolves it by keeping angles out of the simulation entirely — aim arrives as a direction vector,
and `shared/` is restricted to arithmetic the language specification actually pins down.

Everything else follows: a pure `step(state, input, map)` with no `dt` parameter, an accumulator
loop owned by the caller rather than the simulation, and a map file read by exactly one loader
that both the renderer and collision consume.

M0 opens no socket. `server/` is scaffolded and inert. That is deliberate: M1 replaces the local
caller with a server and a prediction buffer, and the simulation itself does not change.

---

## Technical Context

**Language/Version**: TypeScript 5.6, `strict` with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. Target ES2022. Node ≥ 24.

**Primary Dependencies**: `three` 0.185 (client only — banned from `shared/`), `vite` 7 (client
bundler and dev server). No physics engine, no maths library, no state library.

**Storage**: None. The arena is a static JSON asset. `localStorage` arrives in M5 (`D-015` — there
is no database).

**Testing**: Vitest 3 with v8 coverage. Per-directory thresholds already configured; M0 is the
milestone that has to earn them.

**Target Platform**: Desktop Chrome, Firefox, Edge, Safari (WebGL2, Pointer Lock). Server is a
long-lived Node process (`NFR-002`) — inert in M0.

**Project Type**: Real-time multiplayer game. Three source roots sharing one deterministic core.

**Performance Goals**: {TARGET_FPS} rendered; simulation fixed at {SERVER_TICK_HZ} and independent
of frame rate (`M0-11`).

**Constraints**: Bit-identical simulation across engines (`NFR-003`); pure, clock-free,
randomness-free `shared/sim` (`NFR-004`); no gameplay literal outside `shared/constants` (`SC-4`);
100% coverage on `shared/sim`, `shared/map`, `shared/protocol`.

**Scale/Scope**: One player, one arena, one browser. Roughly 15 source files.

**Unknowns**: None outstanding. All resolved in [research.md](research.md); R1 required a project
owner decision, taken on 2026-08-22.

---

## Constitution Check

_GATE: passed before Phase 0; re-evaluated after Phase 1 design — see the bottom of this section._

| Principle                                   | Gate                                                                        | Verdict                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I — `requirements/` is supreme**          | Does the plan invent a requirement, or build anything `DEFERRED`/`DROPPED`? | **PASS.** M0 mints no requirement ID. Two blocking open questions were resolved by the owner into `D-016`/`D-017` before the spec; R1 became ADR-0001 and a deliberate amendment to `NET-004`, not a silent divergence. Coyote time was considered in R5 and **rejected** precisely because no requirement asks for it. |
| **II — shared, pure, deterministic**        | Is movement born in `shared/sim`? Is purity enforced mechanically?          | **PASS.** `step()` is pure with no `dt` ([contracts/sim-api.md](contracts/sim-api.md), C1–C7). Three enforcement layers, none of them a human remembering: ESLint scoped to `shared/**`, an import-boundary test, and 100% coverage. ADR-0001 removes the one construct that could have broken determinism silently.    |
| **III — server authoritative**              | Can any input assert an outcome?                                            | **PASS.** `PlayerInput` carries only intent — no position, velocity, speed, `dt`, or `seq`. `validateInput` is written in M0 despite nothing untrusted reaching it yet, so M1 does not have to invent the security boundary under pressure.                                                                             |
| **IV — every number in `shared/constants`** | Any literal outside it?                                                     | **PASS.** Five constants added to [07-constants.md](../../requirements/07-constants.md) rather than inlined. `TICK_DURATION` is computed from `SERVER_TICK_HZ`, not written twice. `M0-7` is verified by a literal-scan test, not by review.                                                                            |
| **V — milestone order**                     | Does the plan pull later work forward?                                      | **PASS.** No socket, no tick loop in `server/`, no weapon, no HUD, no model. `spawns[].team` and `blocks[].kind` are validated but unused — the _format_ is final at M0, the behaviour is not. Q-003 is explicitly left open for M2.                                                                                    |
| **VI — tests are the gate**                 | Are thresholds met without relaxation?                                      | **PASS.** No threshold is lowered. `passWithNoTests` is removed with the first test, closing `Q-008`.                                                                                                                                                                                                                   |

### Post-design re-evaluation

Re-checked after Phase 1. Two things changed during design, both tightening rather than relaxing:

1. **`SPRINT_FORWARD_MAX_ANGLE` became `SPRINT_FORWARD_MIN_DOT`.** An angle threshold would have
   required `Math.cos` in `shared/`, which ADR-0001 now forbids. Storing the cosine directly keeps
   Principle IV satisfied without violating Principle II. `FR-GP-016`, `D-017` and
   [07-constants.md](../../requirements/07-constants.md) were amended together, so no document is
   left describing the old form.
2. **A "cannot stand up under a ceiling" rule appeared** in the crouch state transitions. This is
   collision correctness, not a new game rule — without it, releasing `Ctrl` under an overhang
   teleports the capsule into geometry — so Principle I is not breached. Recorded in
   [data-model.md](data-model.md#state-transitions) so it is a decision on the record rather than
   an implementation surprise.

**No violations. Complexity Tracking is empty.**

---

## Project Structure

### Documentation (this feature)

```text
specs/000-m0-walking-box/
├── spec.md              # Phase -1: what and why           (approved)
├── plan.md              # This file
├── research.md          # Phase 0: R1–R7 decisions
├── data-model.md        # Phase 1: Vec3, PlayerInput, PlayerState, GameMap
├── contracts/
│   ├── sim-api.md       # the shared/sim contract, C1–C7
│   └── map-schema.md    # the arena file contract
├── quickstart.md        # Phase 1: how to validate M0
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source code (repository root)

```text
shared/                          # imported by BOTH runtimes — no DOM, no Node, no THREE
├── constants/
│   └── index.ts                 # every tuning value; TICK_DURATION derived here
├── math/
│   └── vec3.ts                  # add, scale, dot, length, normalise — exact ops only
├── map/
│   ├── types.ts                 # GameMap, Block, Spawn
│   └── load.ts                  # loadMap + MapValidationError (rules 1-9)
└── sim/
    ├── types.ts                 # PlayerState, PlayerInput
    ├── validate.ts              # validateInput — the NFR-011 boundary
    ├── collide.ts               # capsule vs AABB, per-axis resolution, ground probe
    └── step.ts                  # step(state, input, map) — the contract

client/
├── boot/
│   └── main.ts                  # canvas, accumulator loop, wiring
├── input/
│   ├── keyboard.ts              # key state -> move vector; cleared on blur
│   └── pointer-lock.ts          # lock lifecycle, mouse delta -> yaw/pitch -> dir vector
└── render/                      # excluded from coverage: needs real WebGL
    ├── scene.ts                 # Three.js scene, lights, arena mesh from GameMap
    ├── camera.ts                # over-the-shoulder offset, pitch clamp, camera collision
    └── player.ts                # capsule primitive, interpolated draw

server/
└── index.ts                     # inert entry point until M1

assets/maps/
└── arena-01.json                # the M0 blockout

index.html                       # Vite entry
vite.config.ts                   # client build
```

**Structure Decision.** The three roots come from
[05-architecture.md](../../requirements/05-architecture.md); M0 creates only the subdirectories it
needs, so the tree stays honest about what exists.

Two deviations from the suggested layout, both deliberate:

- **`shared/math/vec3.ts` is new.** Vector helpers are used by `sim`, `map` validation, and the
  client. Putting them in `sim` would make the map loader import the simulation, which inverts the
  dependency.
- **`client/net/` is absent.** It has a 90% coverage threshold and nothing to put in it until M1.

**Module resolution.** `package.json` gains an `imports` field
(`"#shared/*": "./shared/*"`, and the same for `#client/*` and `#server/*`), replacing
`tsconfig.json`'s `baseUrl`/`paths`. Phase 0 verified on Node v24.15.0 that TypeScript `paths` do
**not** resolve at runtime while subpath imports do, in both Node and Vite — see
[research.md § R2](research.md). Each mapping is a single string, never an array, because Vite
consults only the first element. Specifiers carry explicit `.ts` extensions, which requires
`allowImportingTsExtensions: true` (compatible with the existing `noEmit`).

Without this change M0 would appear to work — Vite would resolve the aliases for the client — and
M1 would fail the first time the server imported `shared/`.

---

## Implementation order

Dependency-ordered, not importance-ordered. `/speckit-tasks` expands this.

| #   | Slice                                                                                                   | Delivers                                                      | Gate                                                          |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | **Toolchain** — `imports` field, tsconfig, ESLint `shared/**` rules, Vite config, `dev`/`build` scripts | The boundary is enforced before any code can cross it         | Deliberately-wrong import fails lint                          |
| 2   | **Constants + `vec3`**                                                                                  | Every number in one place; exact-arithmetic helpers           | 100% coverage; **`passWithNoTests` removed here** (`Q-008`)   |
| 3   | **Map types + loader**                                                                                  | `loadMap`, rules 1–9, `arena-01.json` blockout                | 100%; every rejection path tested                             |
| 4   | **`PlayerInput`/`PlayerState` + `validateInput`**                                                       | The `NFR-011` boundary and the shape ADR-0001 requires        | 100%; adversarial inputs rejected                             |
| 5   | **Collision** — capsule vs AABB, per-axis, ground probe                                                 | The hardest correctness in M0                                 | 100%; slide, corner, landing, ceiling-blocked stand           |
| 6   | **`step()`**                                                                                            | Movement, sprint, crouch, jump, gravity, air control          | 100%; **determinism, purity and containment tests land here** |
| 7   | **Renderer** — scene, arena from `GameMap`, capsule, camera + collision                                 | Something visible                                             | Manual; excluded from coverage                                |
| 8   | **Input + accumulator loop**                                                                            | Pointer lock, key handling, fixed timestep with interpolation | `M0-11` at 30/60/144 fps; blur clears keys                    |
| 9   | **Inert `server/index.ts`**                                                                             | Proves `shared/` imports from Node, not just Vite             | `node server/index.ts` runs and imports `#shared/sim/step.ts` |

Slice 9 is small, but it is not optional: it is the only thing in M0 that proves the
module-resolution decision actually holds in the runtime that will need it in M1. **`/speckit-tasks`
moved it forward** to the end of the foundational phase (`T020`) — running it last would mean
discovering a resolution failure after every other line of M0 had been written against it.

Slices 1–6 are pure logic and fully testable without a browser. Slices 7–8 are where the demo
appears. **Do not reorder to see something on screen sooner** — that is precisely the mistake
[08-roadmap.md](../../requirements/08-roadmap.md) warns about.

---

## Risks

| Risk                                               | Mitigation                                                                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-engine float divergence                      | ADR-0001 removes the cause. Lint rule prevents reintroduction. **Residual: the CI determinism test runs only on Node**, so it cannot detect a regression that affects only Firefox — the lint rule is the real guard, not the test |
| Collision jitter on block edges and inside corners | Resolve Y first, then X, then Z; explicit tests for the stable-rest case                                                                                                                                                           |
| Accumulator spiral after a stall                   | `MAX_SUBSTEPS_PER_FRAME` with surplus time discarded                                                                                                                                                                               |
| Camera collision reaching into the simulation      | It lives in `client/render` and the lint boundary makes the inverse impossible                                                                                                                                                     |
| `shared/` purity eroding over time                 | Lint + boundary test + 100% coverage, all in CI                                                                                                                                                                                    |

---

## Complexity Tracking

No Constitution violations. This section is intentionally empty.
