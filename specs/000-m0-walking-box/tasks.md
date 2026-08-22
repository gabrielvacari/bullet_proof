# Tasks: M0 — Walking box

**Input**: Design documents from `/specs/000-m0-walking-box/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: **Required, not optional.** `vitest.config.ts` already enforces 100% coverage on
`shared/sim`, `shared/map` and `shared/protocol`, and [spec.md](spec.md) names four tests that
must exist. Test tasks are written **before** the implementation they cover, and must fail first.

**Organization**: Grouped by the three user stories in [spec.md](spec.md), so each is
independently deliverable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable — different files, no dependency on an incomplete task
- **[Story]**: `[US1]` / `[US2]` / `[US3]`. Setup, Foundational and Polish carry no story label

## Path conventions

Three source roots at the repository root — `shared/`, `client/`, `server/` — per
[plan.md § Project Structure](plan.md#project-structure). Tests live **beside their source** as
`*.test.ts`; there is no separate `tests/` tree.

---

## Phase 1: Setup — toolchain and the boundary

**Purpose**: Make the `shared/` boundary mechanically enforced _before_ any code can cross it.

**Why first**: [research.md § R2](research.md) found that `tsconfig` `paths` do not resolve at
runtime. If this is not fixed now, M0 appears to work — Vite resolves the aliases for the
client — and M1 fails the first time the server imports `shared/`.

- [x] T001 Add the `imports` map (`#shared/*`, `#client/*`, `#server/*` — each a **single string, never an array**) and the `dev` / `build` scripts to `package.json`
- [x] T002 Point `tsconfig.json` at subpath imports: remove `baseUrl` and `paths`, add `allowImportingTsExtensions: true`
- [x] T003 [P] Add `shared/**` boundary rules to `eslint.config.js`: `no-restricted-imports` (blocking `#client/*`, `#server/*`, `three`, and relative paths escaping the directory), `no-restricted-globals` (`window`, `document`, `process`, `globalThis`), and `no-restricted-properties` blocking every transcendental `Math` member plus `Math.hypot`, `Math.random`, `Date.now`, `performance.now`
- [x] T004 [P] Create `vite.config.ts` for the client build and dev server
- [x] T005 [P] Create `index.html` as the Vite entry with the render canvas
- [x] T006 Prove the boundary bites: add a throwaway file under `shared/` importing `#client/*` and calling `Math.cos`, confirm `npm run lint` **fails on both**, then delete it

**Checkpoint**: the rules that protect Principle II are live and demonstrated, not aspirational.

---

## Phase 2: Foundational — constants, maths, map, contracts

**Purpose**: Everything all three stories depend on.

**⚠️ BLOCKING**: no user story may begin until this phase is complete.

- [x] T007 [P] Create `shared/constants/index.ts` with every value from [07-constants.md](../../requirements/07-constants.md), each exported by name; derive `TICK_DURATION` from `SERVER_TICK_HZ` rather than writing it down
- [x] T008 [P] Create `shared/constants/index.test.ts`: assert `TICK_DURATION === 1 / SERVER_TICK_HZ`, and assert `SPRINT_FORWARD_MIN_DOT` equals `Math.cos(Math.PI / 4)` within tolerance — the test file may use `Math`, `shared/` may not
- [x] T009 Remove `passWithNoTests: true` from `vitest.config.ts` in the same change as T008, and delete its explanatory comment block — closes [Q-008](../../requirements/11-open-questions.md)
- [x] T010 [P] Create `shared/math/vec3.ts`: `add`, `sub`, `scale`, `dot`, `length`, `normalise`, `lerp` — using only `+ - * /` and `Math.sqrt`, per [ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md)
- [x] T011 [P] Create `shared/math/vec3.test.ts` covering every branch including the zero-length normalise case
- [x] T012 [P] Create `shared/map/types.ts` with `GameMap`, `Block`, `Spawn` and `Vec3` per [data-model.md](data-model.md)
- [x] T013 Create `shared/map/load.ts`: `loadMap(raw: unknown): GameMap` and `MapValidationError`, implementing validation rules 1–9 from [data-model.md](data-model.md#validation-rules); every message names the offending `id` **and** the rule it broke
- [x] T014 Create `shared/map/load.test.ts` with one failing case per rule 1–9 plus the happy path — `shared/map` is at a 100% threshold, so an untested branch fails the build
- [x] T015 [P] Create `assets/maps/arena-01.json`: sealed floor and perimeter, one wall to slide along, one inside corner, one spawn — the rest of the blockout arrives in T042
- [x] T016 [P] Create `shared/sim/types.ts` with `PlayerState` and `PlayerInput` exactly as specified in [data-model.md](data-model.md) — **no `dt`, no `yaw`/`pitch`, no `seq`, no position or velocity on the input**
- [x] T017 Create `shared/sim/validate.ts`: `validateInput(value: unknown): PlayerInput | null`, returning `null` rather than throwing, per [contracts/sim-api.md](contracts/sim-api.md)
- [x] T018 Create `shared/sim/validate.test.ts` covering every rejection: non-finite components, `dir` off unit length by more than `AIM_EPSILON`, `dir` outside the pitch cone, `move` longer than 1, non-zero `move.y`, missing fields, wrong types, extra fields
- [x] T019 Create `shared/boundary.test.ts` asserting no file under `shared/` imports from `client/`, `server/`, `three`, or any Node built-in — catches what the lint rule's syntax matching misses
- [x] T020 Create the inert `server/index.ts` and confirm `node server/index.ts` runs and successfully imports `#shared/constants/index.ts`

**Checkpoint**: the contract exists, is validated, is covered, and provably resolves in **both**
runtimes.

> **Deviation from [plan.md](plan.md#implementation-order), deliberate.** The plan listed the inert
> server entry point as slice 9, last. It is T020 here instead. Its entire value is proving that
> the module-resolution decision holds in Node — the runtime that does not need it until M1 — so
> running it last would mean discovering a resolution failure after every other line of M0 was
> already written against it. Fail fast.

---

## Phase 3: User Story 1 — move around the arena in third person (P1) 🎯 MVP

**Goal**: A player walks, sprints and collides in an arena rendered from the map file, under a
third-person camera, driven by a deterministic simulation at a fixed timestep.

**Independent Test**: one browser, no server. Delivering only this story already demonstrates a
shared deterministic simulation driving a rendered scene — the milestone's whole technical point.

### Tests for User Story 1 ⚠️ write first, confirm they fail

- [x] T021 [P] [US1] Create `shared/sim/step.test.ts` with the determinism replay test (C2): run a recorded input sequence twice from the same state and assert equality **tick by tick**, not just on the final state
- [x] T022 [P] [US1] Add the purity test (C1) to `shared/sim/step.test.ts`: deep-freeze `state`, `input` and `map`, call `step()`, assert no throw and no mutation
- [x] T023 [P] [US1] Create `shared/sim/collide.test.ts`: sliding along a wall at an angle, an inside corner that must not wedge, and a player at rest on a surface that must not oscillate between ticks
- [x] T024 [P] [US1] Create `client/boot/loop.test.ts` for the accumulator: substep count and alpha for a range of elapsed times, and the `MAX_SUBSTEPS_PER_FRAME` cap discarding surplus time rather than queueing it

### Implementation for User Story 1

- [x] T025 [US1] Create `shared/sim/collide.ts`: capsule-versus-AABB via closest point on the box to the capsule's vertical segment, resolved per axis in **Y, then X, then Z** order (research.md § R4)
- [x] T026 [US1] Add the ground probe to `shared/sim/collide.ts`: a downward probe of `GROUND_PROBE_DISTANCE` evaluated **after** Y resolution — never derived from vertical velocity, which reads zero both at rest on a block and at a jump's apex
- [x] T027 [US1] Create `shared/sim/step.ts`: camera-relative movement from `input.move` and `input.dir` at `WALK_SPEED`, gravity integration, and grounded recomputation — satisfies `FR-GP-015`
- [x] T028 [US1] Add the sprint rule to `shared/sim/step.ts`: `SPRINT_SPEED` applies while the dot product of the movement input with forward is at least `SPRINT_FORWARD_MIN_DOT` — `FR-GP-016`, `D-017`
- [x] T029 [P] [US1] Create `client/render/scene.ts`: Three.js scene, lighting, and arena meshes built from the loaded `GameMap` with **no offset, scale or rounding applied** ([contracts/map-schema.md](contracts/map-schema.md))
- [x] T030 [P] [US1] Create `client/render/player.ts`: the capsule primitive, drawn by interpolating `(previous, current, alpha)`
- [x] T031 [US1] Create `client/render/camera.ts`: over-the-shoulder placement at `CAMERA_OFFSET` with yaw orbit — pitch clamping and camera collision are US3
- [x] T032 [P] [US1] Create `client/input/keyboard.ts`: held-key state translated into a camera-relative `move` vector, normalised so `W`+`A` is not faster than `W`
- [x] T033 [US1] Create `client/input/pointer-lock.ts`: request lock on canvas click, and convert mouse deltas into yaw/pitch and then into the unit `dir` vector — **this is the only place trigonometry is allowed**, per ADR-0001
- [x] T034 [US1] Create `client/boot/loop.ts`: the accumulator as a **pure** function returning substep count and interpolation alpha, so T024 can test it without a browser
- [x] T035 [US1] Create `client/boot/main.ts`: load the map, build the scene, and wire input → `loop.ts` → `step()` → render

**Checkpoint**: `M0-1` (partially), `M0-2`, `M0-3`, `M0-5` and `M0-11` are demonstrable. This is
the MVP — stop and validate before Phase 4.

---

## Phase 4: User Story 2 — traverse height and use cover (P2)

**Goal**: Jumping onto blocks, falling under gravity, and crouching to fit behind waist-high
cover.

**Independent Test**: same single browser — jump onto every block in the blockout and crouch
behind the cover block.

### Tests for User Story 2 ⚠️ write first, confirm they fail

- [x] T036 [P] [US2] Add jump tests to `shared/sim/step.test.ts`: ballistic arc from `JUMP_VELOCITY` under `GRAVITY`, a second `Space` while airborne doing nothing, and a player at rest on a block staying grounded without sinking or sliding
- [x] T037 [P] [US2] Add crouch tests to `shared/sim/step.test.ts`: capsule height and speed change, `Space` while crouched doing nothing (`D-016`), `Shift` while crouched not sprinting (`D-017`), and standing up refused under a ceiling
- [x] T038 [P] [US2] Create `shared/sim/containment.test.ts`: drive the player at every boundary wall and onto every jumpable block, asserting the position never leaves `bounds` — `FR-MAP-006`, `M0-6`

### Implementation for User Story 2

- [x] T039 [US2] Add the jump impulse to `shared/sim/step.ts`, gated on `grounded ∧ ¬crouching`, with no double jump — `FR-GP-017`, `D-016`
- [x] T040 [US2] Apply `AIR_CONTROL` to horizontal acceleration while airborne in `shared/sim/step.ts`
- [x] T041 [US2] Add crouch to `shared/sim/step.ts`: capsule height to `CROUCH_HEIGHT`, speed to `CROUCH_SPEED`, and sprint suppressed while crouched — `FR-GP-018`, `D-017`
- [x] T042 [US2] Add the stand-up ceiling check to `shared/sim/collide.ts`: releasing crouch under a gap shorter than `PLAYER_HEIGHT` leaves the player crouched rather than teleporting the capsule into geometry
- [x] T043 [US2] Extend `assets/maps/arena-01.json`: at least two jumpable blocks with one reachable only by jumping, one `cover` block at `CROUCH_HEIGHT`, and one low overhang for the ceiling check
- [x] T044 [US2] Make the rendered capsule in `client/render/player.ts` reflect `crouching`, so the height change is visible

**Checkpoint**: `M0-6` holds and User Stories 1 and 2 both work.

---

## Phase 5: User Story 3 — enter and leave pointer lock cleanly (P3)

**Goal**: The lock lifecycle, and a camera that never shows the inside of the world.

**Independent Test**: click, `Esc`, click again. No simulation state involved.

- [x] T045 [P] [US3] Add the resume overlay markup and styles to `index.html`
- [x] T046 [US3] Handle lock release in `client/input/pointer-lock.ts`: show the overlay and stop applying input on `Esc`, on browser-initiated exit, and on a denied request — all three land in the same state (`FR-GP-021`)
- [x] T047 [US3] Discard mouse and key input accumulated while unlocked in `client/input/pointer-lock.ts`, so resuming never produces a camera snap or a movement lurch
- [x] T048 [US3] Clear held-key state on window `blur` in `client/input/keyboard.ts`, so alt-tabbing away mid-stride does not leave the player walking
- [x] T049 [US3] Clamp pitch to `CAMERA_PITCH_MIN`..`CAMERA_PITCH_MAX` in `client/render/camera.ts` so the view never flips over — `FR-GP-019`
- [x] T050 [US3] Add camera collision to `client/render/camera.ts`: pull the camera toward the player when geometry intervenes, never showing the inside of a block or ending up behind a wall — `FR-GP-020`

**Checkpoint**: `M0-8` and `M0-10` hold. All three stories are independently functional.

---

## Phase 6: Polish & cross-cutting

- [x] T051 [P] Create `shared/no-literals.test.ts` scanning `shared/**` for numeric literals outside `shared/constants`, allowing only `0`, `1`, `2` and array indices — verifies `M0-7` and `SC-4` mechanically instead of by review
- [x] T052 [P] Close [Q-008](../../requirements/11-open-questions.md) in `requirements/11-open-questions.md` now that T009 has landed
- [x] T053 Run `npm run verify` and confirm `shared/sim`, `shared/map` and `shared/protocol` all report 100% with no threshold relaxed
- [ ] T054 Walk every manual check in [quickstart.md](quickstart.md) — `M0-1`, `M0-5`, `M0-8`, `M0-10`, and the manual half of `M0-11`
- [ ] T055 Confirm all eleven criteria in [spec.md § Success Criteria](spec.md#success-criteria) hold, then hand back to the project owner to tag `v0.1.0`

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1 (Setup)** — no dependencies. T001 → T002 are sequential (T002 removes what T001 replaces). T003/T004/T005 are parallel. T006 gates the phase.
- **Phase 2 (Foundational)** — depends on Phase 1. **Blocks all three stories.**
- **Phase 3 (US1)** — depends on Phase 2 only.
- **Phase 4 (US2)** — depends on Phase 2. Touches the same `step.ts` and `collide.ts` as US1, so in practice it follows US1 rather than running beside it.
- **Phase 5 (US3)** — depends on Phase 2, and on T031/T033 existing to extend.
- **Phase 6 (Polish)** — depends on all three stories.

### Within Phase 2

T007 → T008 → T009 in that order: the flag comes out with the first real test, not before and not
after. T010–T011 and T012–T015 are independent of each other. T016 → T017 → T018 are sequential.
T019 and T020 need at least one real `shared/` file to exist.

### Within each story

Tests are written first and must fail. Then: collision → step → renderer → input → wiring.

### Parallel opportunities

- **Phase 1**: T003, T004, T005 together.
- **Phase 2**: the `constants` chain (T007–T009), the `vec3` chain (T010–T011) and the `map` chain (T012–T015) are three independent tracks. T016 starts the `sim` track.
- **Phase 3**: all four test tasks (T021–T024) together; then T029/T030/T032 together once `step()` exists.
- **Phase 4**: T036, T037, T038 together.

### The one hard serialisation

`shared/sim/step.ts` is touched by T027, T028, T039, T040 and T041. Those five cannot be
parallelised with each other regardless of who is available.

---

## Implementation strategy

### MVP first

1. Phase 1 — the boundary, enforced and demonstrated.
2. Phase 2 — the contract, validated and covered.
3. Phase 3 — User Story 1.
4. **Stop and validate.** At this point the simulation is deterministic, shared, and rendering.

### Do not reorder to see something on screen sooner

Phases 1–2 and tasks T021–T028 produce nothing visible. The temptation is to build the Three.js
scene first because it is the part that looks like progress.

[08-roadmap.md](../../requirements/08-roadmap.md) names exactly this as the single most expensive
mistake available in this project: movement written in `client/` first, then retrofitted into
shared deterministic code. Phase 1 exists specifically so that the lint rules make that mistake
fail loudly rather than merely being discouraged.

### Incremental delivery

Each phase ends green — `npm run verify` passes at every checkpoint, and each commit cites its
requirement IDs in the body per [CONTRIBUTING.md](../../CONTRIBUTING.md).
