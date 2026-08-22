# Feature Specification: M0 — Walking box

**Milestone**: `M0` in [08-roadmap.md](../../requirements/08-roadmap.md) · **Tag on completion**: `v0.1.0`

**Created**: 2026-08-22

**Status**: Implemented — automated criteria green; manual criteria await the project owner

**Demo criterion**: One player, one browser, walks around the arena in third person.

> This spec **cites** requirement IDs; it does not restate them (Constitution, Principle I).
> Where this document and [`requirements/`](../../requirements/README.md) disagree,
> `requirements/` wins and this file is the bug.

---

## Objective

Stand up the skeleton the entire project hangs off: the `shared` / `client` / `server` split,
a data-driven arena, and a **deterministic movement simulation that lives in `shared/sim` from
its first line**.

There is no networking in M0. The client runs the shared simulation locally, against its own
input, at a fixed timestep. That is deliberate: M1 replaces the local caller with a server and
a prediction buffer, and _the simulation itself does not change_. If M0 ends with movement code
anywhere other than `shared/sim`, the milestone has failed even if the demo looks correct.

[08-roadmap.md](../../requirements/08-roadmap.md) names retrofitting client-only movement into
shared deterministic code as the single most expensive mistake available in this project. M0
exists to make that mistake impossible rather than merely discouraged.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Move around the arena in third person (Priority: P1)

A visitor opens the page, clicks the canvas, and controls a character from an over-the-shoulder
view. The mouse turns the character and orbits the camera; `W`/`A`/`S`/`D` move relative to
where the camera is pointing. Walls stop them; they slide along a wall rather than sticking to
it.

**Why this priority**: This _is_ the demo criterion. It is also the milestone's whole technical
purpose — the movement and collision code written here is imported unchanged by the server in
M1 and never rewritten.

**Independent Test**: Fully testable with one browser and no server. Deliver only this story and
M0 already demonstrates a shared deterministic simulation driving a rendered scene.

**Acceptance Scenarios**:

1. **Given** the arena is loaded and pointer lock is held, **When** the player holds `W`,
   **Then** the character moves away from the camera at {WALK_SPEED} and rotates to face its
   movement direction (`FR-GP-015`).
2. **Given** the player is moving forward, **When** they also hold `Shift`, **Then** speed
   becomes {SPRINT_SPEED}; **When** they strafe or backpedal instead, **Then** speed stays
   {WALK_SPEED} (`FR-GP-016`, `D-017`).
3. **Given** the player is walking toward a wall at an angle, **When** they collide with it,
   **Then** they slide along the wall and do not stop dead, pass through, or wedge in a corner.
4. **Given** the same starting state and the same recorded input sequence, **When** the
   simulation is run twice, **Then** every intermediate tick and the final state are identical
   (`NFR-004`).
5. **Given** the renderer is drawing at 144 fps and the simulation ticks at {SERVER_TICK_HZ},
   **When** the player moves, **Then** motion appears smooth with no stepping, and simulated
   distance travelled is independent of frame rate.

---

### User Story 2 — Traverse height and use cover (Priority: P2)

The player jumps onto low blocks, falls back down under gravity, and crouches to fit behind
waist-high cover — which is what makes crouch a tactical choice later rather than a slower walk.

**Why this priority**: Gravity, the grounded check, and the crouch capsule resize are the parts
of the simulation most likely to be subtly wrong, and every later milestone depends on them.
They are not needed for the raw "it walks" demo, which is why they sit behind P1.

**Independent Test**: Testable in the same single browser by jumping onto every block in the
blockout arena and crouching behind the cover block.

**Acceptance Scenarios**:

1. **Given** the player is grounded, **When** they press `Space`, **Then** they leave the ground
   with {JUMP_VELOCITY}, follow a ballistic arc under {GRAVITY}, and land (`FR-GP-017`).
2. **Given** the player is airborne, **When** they press `Space` again, **Then** nothing happens
   (`FR-GP-017`).
3. **Given** the player is standing still on top of a block, **When** no input is given,
   **Then** they remain grounded and do not sink, jitter, or slide off.
4. **Given** the player holds `Ctrl`, **When** they move, **Then** the collision capsule height
   drops to {CROUCH_HEIGHT}, speed drops to {CROUCH_SPEED}, and they are visibly shorter
   (`FR-GP-018`).
5. **Given** the player is crouched, **When** they press `Space`, **Then** nothing happens —
   crouch and jump are mutually exclusive (`FR-GP-018`, `D-016`).
6. **Given** the player is crouched, **When** they hold `Shift`, **Then** speed stays
   {CROUCH_SPEED} — a crouched player never sprints (`D-017`).

---

### User Story 3 — Enter and leave pointer lock cleanly (Priority: P3)

Clicking the canvas captures the mouse. Pressing `Esc` releases it and shows a "click to resume"
overlay instead of leaving the player staring at a scene that no longer responds.

**Why this priority**: `FR-GP-021` is required, and without it the demo is unusable after the
first `Esc` — but it is a client-side shell around a simulation that already works, so it is
last.

**Independent Test**: Click the canvas, press `Esc`, click again. No simulation state is
involved.

**Acceptance Scenarios**:

1. **Given** the page is loaded, **When** the player clicks the canvas, **Then** pointer lock is
   requested and mouse movement starts rotating the camera (`FR-GP-021`).
2. **Given** pointer lock is held, **When** the player presses `Esc`, **Then** the cursor is
   released, the resume overlay appears, and input stops affecting the character.
3. **Given** the overlay is showing, **When** the player clicks the canvas, **Then** pointer lock
   is restored and no input accumulated while unlocked is applied in a burst.
4. **Given** the camera is orbiting, **When** the player looks up or down past the limits,
   **Then** pitch clamps to {CAMERA_PITCH_MIN}..{CAMERA_PITCH_MAX} and never flips over
   (`FR-GP-019`).
5. **Given** the player backs into a wall, **When** level geometry lies between camera and
   character, **Then** the camera moves closer so the character stays visible, and never shows
   the inside of geometry (`FR-GP-020`).

---

### Edge Cases

- **Diagonal input.** `W`+`A` must not move faster than `W` alone. The movement input vector is
  normalised before speed is applied.
- **Accumulator runaway.** A long stall — a breakpoint, a backgrounded tab — must not queue
  hundreds of simulation ticks and freeze the page on resume. The number of ticks consumed per
  frame is capped, and time beyond the cap is dropped rather than simulated.
- **Focus loss mid-input.** Losing window focus while a key is held must not leave that key
  latched down. Held-key state is cleared on blur and on pointer-lock release.
- **Pointer lock denied or exited by the browser.** The request can fail or be revoked without
  an `Esc` press. Both paths land in the same overlay state as `FR-GP-021`.
- **Invalid map file.** A map failing schema validation fails loudly at startup with a message
  naming what is wrong, rather than producing an unplayable arena (`FR-MAP-003`).
- **Standing exactly on a block edge or in an inside corner.** Must resolve to a stable position,
  never oscillate between two collision responses across ticks.
- **Attempting to leave the arena.** No sequence of inputs, including jumping onto every block,
  may place the player outside `bounds` (`FR-MAP-006`).
- **WebGL2 unavailable.** M0 may fail with a plain console error; the user-facing
  unsupported-environment screen is `FR-UI-014` and belongs to M5.

---

## Requirements _(mandatory)_

This project's requirement IDs are permanent and live in
[`requirements/`](../../requirements/README.md). M0 mints none. It must satisfy these:

| ID                                                 | What M0 must satisfy                                  |
| -------------------------------------------------- | ----------------------------------------------------- |
| [`NFR-003`](../../requirements/05-architecture.md) | Movement and collision implemented once, in `shared/` |
| [`NFR-004`](../../requirements/05-architecture.md) | Simulation pure, fixed-timestep, deterministic        |
| [`FR-GP-015`](../../requirements/02-gameplay.md)   | Ground movement, camera-relative                      |
| [`FR-GP-016`](../../requirements/02-gameplay.md)   | Sprint — forward-dominant only, per `D-017`           |
| [`FR-GP-017`](../../requirements/02-gameplay.md)   | Jump and gravity                                      |
| [`FR-GP-018`](../../requirements/02-gameplay.md)   | Crouch — no crouch-jump, per `D-016`                  |
| [`FR-GP-019`](../../requirements/02-gameplay.md)   | Over-the-shoulder camera with pitch clamp             |
| [`FR-GP-020`](../../requirements/02-gameplay.md)   | Camera collision                                      |
| [`FR-GP-021`](../../requirements/02-gameplay.md)   | Pointer lock and the resume overlay                   |
| [`FR-GP-022`](../../requirements/02-gameplay.md)   | Mouse sensitivity as a single constant                |
| [`FR-MAP-002`](../../requirements/04-map.md)       | Map is data, shared by renderer and collision         |
| [`FR-MAP-003`](../../requirements/04-map.md)       | Map schema, validated loudly on load                  |
| [`FR-MAP-006`](../../requirements/04-map.md)       | Sealed boundary                                       |
| [`FR-MAP-010`](../../requirements/04-map.md)       | Height variation only from jumpable blocks            |
| [`SC-4`](../../requirements/01-vision.md)          | Editing `shared/constants` is the only change needed  |
| [`Q-008`](../../requirements/11-open-questions.md) | `passWithNoTests` removed with the first real test    |

**M0 ships a blockout arena, not a designed one.** `FR-MAP-004`, `FR-MAP-005`, `FR-MAP-007` and
`FR-MAP-009` describe the _finished_ arena and are satisfied at M4. M0 needs only enough
geometry — a sealed floor, walls, a few jumpable blocks, one waist-high cover block — to
exercise collision, gravity and camera collision. **The map file format must be final at M0;
the level design must not be.**

### Key Entities

- **PlayerState** — the simulated player: position, velocity, yaw, pitch, grounded, crouching.
  The complete output of one simulation tick, and the complete input to the next. Contains no
  rendering, animation, or timing state.
- **PlayerInput** — one tick of player _intent_: movement axes, aim angles, and the
  jump/crouch/sprint flags. Carries no position, velocity, speed, or `dt` — an input that could
  assert an outcome would violate `NFR-001` the moment M1 puts it behind a socket.
- **Map** — the arena as data (`FR-MAP-003`): `bounds`, `blocks` (centre, size, `kind`), and
  `spawns`. Read identically by the renderer and by collision, which is what prevents client and
  server from ever disagreeing about geometry (`FR-MAP-002`). Spawns are parsed and validated in
  M0 but only the first is used; spawn _selection_ is `FR-GP-038` in M2.

---

## Out of scope for M0

Not oversights. Each is owned by a later milestone — see
[09-out-of-scope.md](../../requirements/09-out-of-scope.md) and
[08-roadmap.md](../../requirements/08-roadmap.md):

| Not in M0                                                         | Owned by |
| ----------------------------------------------------------------- | -------- |
| WebSocket server, `join` / `input` / `snapshot`, server tick loop | M1       |
| Prediction, reconciliation, interpolation                         | M1       |
| Any second player, local or remote                                | M1       |
| Weapons, firing, raycast, damage, health, death, respawn          | M2       |
| Crosshair, HUD, hit volumes                                       | M2       |
| Modes, teams, scoring, match timer, start screen, room codes      | M3       |
| Character models, animation, nameplates, audio, art pass          | M4       |
| `localStorage`, loading screen, unsupported-environment screen    | M5       |

Two rules with teeth:

- **Do not build a `server/` tick loop in M0.** Scaffold the directory and its entry point;
  leave it inert. A tick loop written before the protocol exists gets rewritten in M1.
- **Do not resolve [`Q-003`](../../requirements/11-open-questions.md) (crosshair-to-ray
  alignment) here.** It blocks M2 and must land as an ADR before firing code. M0 must not
  quietly bake an aim convention into the camera and call it settled.

---

## Success Criteria _(mandatory)_

Per the Constitution's ID namespaces, milestone exit criteria are `M<N>-<n>` — `SC-1`…`SC-5` are
the project-wide criteria in [01-vision.md](../../requirements/01-vision.md) and are not reused
here.

M0 is done when all of these are demonstrably true:

| #         | Criterion                                                                                                                                                        | Verified by                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **M0-1**  | A player walks, sprints, crouches, jumps and falls around the arena in third person under pointer lock.                                                          | Manual — the demo criterion        |
| **M0-2**  | Every line of movement, collision and grounded logic lives under `shared/sim`. `client/` contains no movement maths.                                             | Lint boundary rule + review        |
| **M0-3**  | The same input sequence replayed from the same state produces identical output, tick by tick.                                                                    | Determinism test                   |
| **M0-4**  | `shared/sim/**` and `shared/map/**` are at 100% coverage and `npm run verify` is green.                                                                          | `npm run test:coverage`            |
| **M0-5**  | Moving a wall in the arena JSON changes both what is drawn and what blocks the player, with no code change.                                                      | Manual — edit the JSON and rerun   |
| **M0-6**  | No sequence of movement inputs, including jumping onto every block, puts the player outside `bounds`.                                                            | Containment test                   |
| **M0-7**  | Changing `WALK_SPEED` in `shared/constants` is the only edit needed to change walk speed; no gameplay literal exists elsewhere.                                  | Review + grep for numeric literals |
| **M0-8**  | Releasing pointer lock with `Esc` shows the resume overlay; clicking the canvas restores it with no input burst.                                                 | Manual                             |
| **M0-9**  | `passWithNoTests` is gone from `vitest.config.ts` and `Q-008` is closed.                                                                                         | Review                             |
| **M0-10** | Backing the camera into a wall never shows the inside of geometry or places the camera behind it.                                                                | Manual                             |
| **M0-11** | Simulated movement over a fixed input sequence differs by at most one tick between 30, 60 and 144 rendered fps, and jump height does not change with frame rate. | Manual + fixed-timestep test       |

Only then is `v0.1.0` tagged
([CONTRIBUTING.md](../../CONTRIBUTING.md)).

---

## Assumptions

Stated so they can be corrected now rather than discovered later:

1. **M0 is single-player and offline.** The client calls `shared/sim` directly; no WebSocket
   connection is opened.
2. **`server/` gets an entry point in M0 but no logic** — just enough for the directory split and
   path aliases to be real.
3. **The M0 arena is a blockout**, not the final level design.
4. **The player is a capsule primitive.** No glTF loading in M0 —
   [`D-011`](../../requirements/10-decision-log.md) ships primitives through M0–M3.
5. **The client simulates at {SERVER_TICK_HZ}** even with no server, so M1 changes the caller and
   not the simulation.
6. **Camera collision is client-side only** and never feeds back into the simulation.
7. **Collision is axis-aligned boxes against a vertical capsule**, per `FR-MAP-010`. No
   third-party physics engine — it would break `NFR-004` across the two runtimes.

---

## Resolved before this spec

- ~~`Q-005`~~ — crouch-jump. Resolved as [`D-016`](../../requirements/10-decision-log.md):
  crouching and jumping stay mutually exclusive; `FR-GP-018` unchanged.
- ~~`Q-007`~~ — sprint rule. Resolved as [`D-017`](../../requirements/10-decision-log.md):
  sprint applies within {SPRINT_FORWARD_MIN_DOT} of forward, never while crouched. Added
  `SPRINT_FORWARD_MIN_DOT` to [07-constants.md](../../requirements/07-constants.md) and amended
  `FR-GP-016`'s acceptance criterion.

## Still open — not M0's to answer

- [`Q-003`](../../requirements/11-open-questions.md) — crosshair-to-ray alignment. Blocks M2.
  Must be an ADR before firing code. M0 must not pre-empt it.
- [`Q-002`](../../requirements/11-open-questions.md) — balance numbers. {GRAVITY},
  {JUMP_VELOCITY} and {ARENA_SIZE} will feel wrong in M0 and that is expected; they are
  `PROPOSED`, and tuning them is a constants edit, not a code change (`SC-4`).
