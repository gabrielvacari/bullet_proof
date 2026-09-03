# Tasks: M2 — Shooting

**Input**: Design documents from `/specs/002-m2-shooting/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: **Required, not optional.** `vitest.config.ts` enforces 100% on `shared/sim`,
`shared/map` and `shared/protocol` and 90% on `server/` and `client/net/`, and M2 puts the
branchiest geometry in the project into the 100% directory. Test tasks are written **before** the
implementation they cover, and must fail first.

**Organization**: grouped by the three user stories in [spec.md](spec.md), so each is
independently deliverable and testable.

> ## ✅ Both gates are open — 2026-09-02
>
> M2 was behind two gates ([plan.md § Gates](plan.md#gates)), and neither is shut any more:
>
> 1. ~~**M1's demo criterion must be met**~~ — confirmed by the project owner and tagged
>    `v0.2.0`. Constitution Principle V is satisfied.
> 2. ~~**[`Q-003`] must land as an ADR**~~ — landed as
>    [ADR-0002](../../docs/adr/0002-the-firing-ray-runs-from-the-eye-to-the-aim-point.md).
>
> **The numbering jumps from `T030` to `T101` on purpose.** It recorded which tasks were behind
> Gate 2 while the ADR was pending. The split no longer gates anything, but the numbers are kept
> as they were rather than renumbered, so that every reference to a task id stays valid.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable — different files, no dependency on an incomplete task
- **[Story]**: `[US1]` / `[US2]` / `[US3]`. Setup, Foundational and Polish carry no story label
- **⛔**: blocked on Gate 2 — the `Q-003` ADR

## Path conventions

Three source roots at the repository root — `shared/`, `client/`, `server/` — per
[plan.md § Project Structure](plan.md#project-structure). Tests live **beside their source** as
`*.test.ts`; there is no separate `tests/` tree.

---

## Phase 1: Setup — the gates, and the decisions only a human can take

**Purpose**: Confirm M2 may start at all, and get the four things that need the project owner out
of the way before anyone is mid-implementation waiting on them.

**None of these is a code task.** Each is a check or a decision, and each blocks everything after
it.

- [x] T001 Verify **Gate 1**: M1's demo criterion in [08-roadmap.md](../../requirements/08-roadmap.md) is genuinely met and `v0.2.0` is tagged on `main` — two browsers see each other move smoothly, with no remote-player jitter (Constitution Principle V)
- [x] T002 Verify every row of [plan.md § Dependencies on M1](plan.md#dependencies-on-m1) exists, in particular that the snapshot builder can emit a **per-recipient** `am` field and does not serialise one JSON string for every socket (`NET-009`)
- [x] T003 ⛔ **Gate 2**: the project owner decides [`Q-003`](../../requirements/11-open-questions.md#q-003) from [research.md § R1](research.md#r1--where-does-the-firing-ray-originate-q-003--blocking) and merges the ADR into `docs/adr/`; add it to [`docs/adr/README.md`](../../docs/adr/README.md)'s index, remove that file's "Waiting to be written" paragraph, and delete `Q-003` from `requirements/11-open-questions.md`
- [x] T004 With the project owner's approval, add the thirteen constants from [data-model.md § New constants](data-model.md#new-constants) to `requirements/07-constants.md` — the eight hit-volume fractions in the Weapon or Player section, the five derived values under "Derived values — do not hardcode" (Constitution Principle IV)
- [x] T005 Confirm with the project owner that `FR-GP-032` and `FR-GP-038` — both `PROPOSED` and both load-bearing for `M2-8` and `M2-10` — are what M2 should build; changing either after Phase 2 changes tested behaviour rather than a constant

**Checkpoint**: M2 is allowed to start, the numbers it needs exist, and the one decision that
shapes the raycast has been taken by the person entitled to take it.

> **Status 2026-09-02 — four of five closed; `T001` is the only thing holding Gate 1 shut.**
>
> `T002` — all seven rows of [plan.md § Dependencies on M1](plan.md#dependencies-on-m1) hold on
> `main`. The row flagged as most likely to surprise does not: `broadcastSnapshot()` in
> `server/room/room.ts` already encodes **once per recipient**, because `ack` is per-client, and
> its comment names that seam as the one `am` will use. Player ids are a monotonic `c_N` counter
> from `server/net/ws-transport.ts`, so `M2-12`'s ascending-id tick order stays reproducible.
>
> `T003` — `ADR-0002` is merged and indexed, and `Q-003` is gone from `11-open-questions.md`.
> The "Waiting to be written" section was **rewritten rather than deleted**: it is a standing
> section, and it now records that neither remaining candidate is urgent. The stale claim the
> task meant to remove — that the firing-ray ADR was still owed — is what went.
>
> `T004` — all thirteen constants are in `07-constants.md`. The eight fractions are listed by
> name; the five derived values sit under "Derived values — do not hardcode" written as
> derivations rather than as bare identifiers, matching that section's existing entries.
>
> `T005` — `FR-GP-032` and `FR-GP-038` both read `REQUIRED`.
>
> `T001` **closed 2026-09-02**: the project owner walked the demo and confirmed it, and `v0.1.0`
> and `v0.2.0` are tagged on `main`. Phase 2 may begin.

---

## Phase 2: Foundational — constants, geometry, types, damage, spawning

**Purpose**: Everything all three stories depend on that **Gate 2 does not touch**.

**⚠️ BLOCKING**: no user story may begin until this phase is complete.

This phase is deliberately large. It is the answer to "what can be built while the ADR is
pending", and everything in it is identical under all three `Q-003` options
([research.md § R1](research.md#r1--where-does-the-firing-ray-originate-q-003--blocking)).

- [x] T006 [P] Add the eight hit-volume fractions from [data-model.md](data-model.md#new-constants) to `shared/constants/index.ts`, each exported by name with the requirement it serves in its comment
- [x] T007 [P] Add the five derived values to `shared/constants/index.ts` — `TICKS_PER_SHOT`, `RELOAD_TICKS`, `RESPAWN_TICKS`, `MIN_SPAWN_DISTANCE_SQ`, `AIM_CAST_RANGE` — each **computed** from existing constants, never written down as a number
- [x] T008 [P] Extend `shared/constants/index.test.ts`: `TICKS_PER_SHOT === SERVER_TICK_HZ / FIRE_RATE_RPS`; `RELOAD_TICKS` and `RESPAWN_TICKS` are whole numbers at the current values; every hit-volume radius fraction × `PLAYER_HEIGHT` is at or below `PLAYER_RADIUS` (invariant 1)
- [x] T009 Create `shared/math/ray.ts`: `rayAabb` (slab method), `raySphere` and `rayCapsule`, each returning the nearest non-negative parameter `t` or `null` — using only `+ - * /` and `Math.sqrt`, no trigonometry and no `Math.hypot` ([ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md))
- [x] T010 Create `shared/math/ray.test.ts` covering every branch: clean hit, clean miss, tangent/graze, origin **inside** the volume, target **behind** the origin, ray parallel to a slab, zero-length direction, and `t` exactly at the range limit — `shared/math` has no untested-branch budget
- [ ] T011 Extend `shared/sim/types.ts` per [data-model.md](data-model.md): `PlayerState` gains `health`, `magazine`, `fireCooldown`, `reloadTicks`, `respawnTicks`; `PlayerInput` gains `fire` and `reload`; add `HitRegion`, `HitVolume`, `ShotIntent`, `ShotResult`, `StepResult` and `TargetPlayer` — **no `armour`, no `weapon`, no `alive` flag, no score, no position history**
- [ ] T012 Extend `shared/sim/validate.ts` to validate and carry the two new intent flags, rejecting anything that is not a boolean
- [ ] T013 Extend `shared/sim/validate.test.ts` with the new rejection paths, and assert that no accepted `PlayerInput` can carry a target, victim, damage figure or hit flag — there is no such field to accept
- [ ] T014 Create `shared/sim/hitvolume.ts`: `hitVolumes(pos, crouching)` returning the head sphere, torso capsule and leg capsule as fractions of the current capsule height (`FR-GP-027`) — built on demand, never stored on the player
- [ ] T015 Create `shared/sim/hitvolume.test.ts`: standing and crouched dimensions; invariant 1 (every radius at or below `PLAYER_RADIUS`); invariant 2 (the three volumes are contiguous from the floor to the top of the capsule with no unhittable band); and identical output for identical `(pos, crouching)` regardless of anything else in the state
- [ ] T016 Create `shared/sim/damage.ts`: `damageFor(region)` from `DAMAGE_HEAD`/`DAMAGE_TORSO`/`DAMAGE_LEGS`, and `applyDamage(state, damage)` returning `DamageOutcome` per [contracts/combat-api.md](contracts/combat-api.md#applydamagestate-damage)
- [ ] T017 Create `shared/sim/damage.test.ts` covering C21–C24: health clamps at zero; `lethal` is true at most once per life; death clears `reloadTicks` and starts `respawnTicks`; health is never raised. Assert shots-to-kill (2 / 5 / 10) **derived** from the constants, and that mixed regions sum correctly — `M2-4`
- [ ] T018 Create `shared/sim/spawn.ts`: `selectSpawn(spawns, livingEnemies)` — the argmax of squared distance to the nearest living enemy, ties broken on the lowest spawn `id` lexicographically, no `Math.random` and no `Math.sqrt` ([research.md § R5](research.md#r5--spawn-selection-needs-no-randomness))
- [ ] T019 Create `shared/sim/spawn.test.ts`: the argmax; the `MIN_SPAWN_DISTANCE_SQ` criterion satisfied whenever a spawn satisfies it; the **no-valid-spawn fallback** against a synthetic map; the tie-break; and the empty-`livingEnemies` case — `M2-10`
- [ ] T020 Extend `shared/no-literals.test.ts` and `shared/boundary.test.ts` to cover `shared/math/ray.ts` and the new `shared/sim` modules, so a combat literal or a stray import fails the build rather than a review

**Checkpoint**: every piece of M2 that does not depend on `Q-003` exists, is covered, and is
provably free of clocks, randomness and inexact `Math`.

---

## Phase 3: User Story 2 — run out of ammunition and reload (P2)

**Goal**: The weapon has an economy. It fires at {FIRE_RATE_RPS}, holds {MAGAZINE_SIZE}, reloads,
and does none of that while its owner is dead.

**Independent Test**: one player, one server. Hold fire, count the shots, watch the magazine empty
and refill. No second player and no raycast involved.

> **Deviation from story priority, deliberate.** [spec.md](spec.md) ranks this P2 and "kill an
> opponent" P1, and this phase runs first anyway. Two reasons, and neither is convenience:
> a shot has to leave the barrel before anything can resolve it, so US1 depends on this code; and
> this phase is **not** behind Gate 2, so it is buildable while the `Q-003` ADR is pending. The
> milestone's MVP is still US1 — this is the order of construction, not the order of value.

### Tests for User Story 2 ⚠️ write first, confirm they fail

- [ ] T021 [P] [US2] Add fire-cadence tests to `shared/sim/step.test.ts`: over 300 ticks of held fire the shot count matches {FIRE_RATE_RPS} exactly — asserting the **average**, not any single interval, because the interval is 3.75 ticks ([research.md § R4](research.md#r4--durations-in-a-simulation-with-no-clock)). Also assert that a client "firing" on every single tick produces no more shots than one firing at the permitted rate — `M2-7`
- [ ] T022 [P] [US2] Add magazine tests to `shared/sim/step.test.ts`: the count falls by exactly one per emitted `ShotIntent`, never below zero, and no input sequence permanently disarms the player — `FR-GP-030`
- [ ] T023 [P] [US2] Add reload tests to `shared/sim/step.test.ts`: `R` on a partial magazine starts a reload; `R` on a full magazine does **nothing at all** — not a zero-length reload; firing an empty magazine starts one; no shot is produced during one; fire neither cancels nor restarts one; the magazine refills after exactly `RELOAD_TICKS` — `M2-8`
- [ ] T024 [P] [US2] Add death and respawn tests to `shared/sim/step.test.ts`: a dead player's input is ignored entirely — no movement, no fire, no reload — and only `respawnTicks` advances; death cancels an in-progress reload; respawn restores {PLAYER_MAX_HEALTH} and {MAGAZINE_SIZE} with no pending reload — `M2-9`, `FR-GP-032`

### Implementation for User Story 2

- [ ] T025 [US2] Widen `step()`'s return in `shared/sim/step.ts` to `StepResult` (`{ state, shot }`) per [contracts/combat-api.md](contracts/combat-api.md#stepstate-input-map--extended) — a deliberate breaking change to M0's contract
- [ ] T026 [US2] Add the dead branch to `shared/sim/step.ts` (state machine rule 1): decrement `respawnTicks`, respawn at zero, and return before anything else runs — `FR-GP-036`, `FR-GP-037`
- [ ] T027 [US2] Add the countdown decrements and reload completion to `shared/sim/step.ts` (rules 2–3), each floored at zero, refilling the magazine when `reloadTicks` reaches zero
- [ ] T028 [US2] Add the reload-start rules to `shared/sim/step.ts` (rules 4–6): reloading blocks firing; `input.reload` on a partial magazine starts one; firing an empty magazine starts one — `FR-GP-031`
- [ ] T029 [US2] Add the fire rule to `shared/sim/step.ts` (rule 7): decrement the magazine, **add** `TICKS_PER_SHOT` to `fireCooldown` rather than assigning it, and emit a `ShotIntent` carrying `eye`, `cameraEye` and `dir` — `FR-GP-024`, `FR-GP-029`
- [ ] T030 [US2] Update every existing `step()` caller and test for `StepResult` — `client/boot/main.ts`, `shared/sim/step.test.ts`, `shared/sim/containment.test.ts` — and confirm M0's determinism, purity and containment tests still pass unchanged in substance

**Checkpoint**: the weapon works end to end for one player. `M2-7`, `M2-8` and `M2-9` hold, and
nothing yet depends on `Q-003`.

---

## Phase 4: User Story 1 — kill an opponent and watch them come back (P1) 🎯 MVP

**Goal**: A shot leaves one player, is resolved by the server against the world, costs the victim
health, kills them, and puts them back somewhere sensible.

**Independent Test**: two browsers against one server. Health can be read from the snapshot in a
debug overlay — no HUD needed.

> ## ⛔ Every task in this phase requires Gate 2
>
> **`T003` must be complete: the `Q-003` ADR must be merged before `T101` begins.**
>
> The ADR decides where the ray originates and therefore what `resolveShot` does, what
> `NET-012`'s `from` means, and how `client/render/camera.ts` frames the character. Starting here
> without it is the failure mode [`docs/adr/README.md`](../../docs/adr/README.md) warns about, and
> a task that turns out to need a decision **stops and asks** (Constitution Principle I).
>
> If the ADR chooses an option other than the recommended one, re-read
> [research.md § R1](research.md#r1--where-does-the-firing-ray-originate-q-003--blocking) before
> `T102`: option 2 removes the camera reconstruction entirely, option 3 adds a client task on top
> of everything option 1 needs. `T105`–`T120` are unaffected either way.

### Tests for User Story 1 ⚠️ write first, confirm they fail

- [ ] T101 ⛔ [P] [US1] Create `shared/sim/hitscan.test.ts` with the resolution rules: nearest intersection wins; a wall between shooter and target absorbs the shot and deals no damage; a shot at a target beyond {WEAPON_RANGE} hits nothing; damage at 1 m equals damage at {WEAPON_RANGE} — `M2-5`, `M2-11`
- [ ] T102 ⛔ [P] [US1] Add the eligibility tests to `shared/sim/hitscan.test.ts`: the shooter is never a candidate for their own shot (`FR-GP-042`), and a player with `health <= 0` is absent from the cast (`FR-GP-036`) — `M2-9`
- [ ] T103 ⛔ [P] [US1] Add the tie-break tests to `shared/sim/hitscan.test.ts`, each constructed to land at **exactly** equal `t`: geometry beats a player; the lower player `id` beats the higher; `HEAD` beats `TORSO` beats `LEGS` within one player ([data-model.md § Resolution order](data-model.md#resolution-order--total-and-stable))
- [ ] T104 ⛔ [P] [US1] Add the C16 and C18 tests to `shared/sim/hitscan.test.ts`: identical `(pos, crouching)` gives an identical result regardless of anything else in the state (`M2-6`), and ten identical shots give ten identical results — no spread, no recoil, no bloom (`FR-GP-033`)

### Implementation for User Story 1

- [ ] T105 ⛔ [US1] Create `shared/sim/hitscan.ts`: `resolveShot(intent, shooterId, candidates, map)` per [contracts/combat-api.md](contracts/combat-api.md#resolveshotintent-shooterid-candidates-map), with the ray origin the ADR chose — pure, total, and reading geometry from the passed `GameMap` (`FR-MAP-002`)
- [ ] T106 ⛔ [US1] Implement the eligibility filter in `shared/sim/hitscan.ts` as an explicit seam that rejects the shooter and the dead. **Do not add teams** — `FR-GP-025`'s teammate exclusion is M3's and fills this same seam
- [ ] T107 ⛔ [US1] Add purity and determinism tests for `resolveShot` to `shared/sim/hitscan.test.ts`: deep-freeze every argument; assert a degenerate direction, an origin inside geometry and a target at exactly {WEAPON_RANGE} never throw (C7, `NFR-015`)
- [ ] T108 ⛔ [P] [US1] Add the five outbound message types from [contracts/combat-messages.md](contracts/combat-messages.md) to `shared/protocol` — `NET-012` through `NET-016` — with `hitConfirm` structurally unable to carry the victim's health
- [ ] T109 ⛔ [P] [US1] Add the `keys` bitmask decode to `shared/protocol`: validate as a non-negative safe integer, **mask** to the defined bits, and decode bits 128 and 256 into `fire` and `reload` — `NFR-011`, `NET-004b`
- [ ] T110 ⛔ [US1] Create the protocol-shape test in `shared/protocol`: no inbound message type has a field able to set health, ammunition, position, kill status or score — `M2-3`, `NET-007`, and it must still pass when M3 adds messages
- [ ] T111 ⛔ [US1] Add the movement phase to `server/room.ts`: `step()` every player in ascending player id, collecting `ShotIntent`s, per [contracts/combat-api.md § Call pattern](contracts/combat-api.md#call-pattern)
- [ ] T112 ⛔ [US1] Add the resolution phase to `server/room.ts`: resolve each intent in the same order against post-movement positions, apply damage immediately, and remove a player killed earlier in the tick from later casts
- [ ] T113 ⛔ [US1] Add the death and respawn phase to `server/room.ts`, calling `selectSpawn` with the positions of the living enemies at that moment — `FR-GP-037`, `FR-GP-038`
- [ ] T114 ⛔ [US1] Build `NET-012`–`NET-016` in `server/room.ts` from one `ShotResult` and one `DamageOutcome`: `shot` and `kill` broadcast, `damage` to the victim only, `hitConfirm` to the shooter only, and `NET-013`'s `dir` computed server-side and flattened
- [ ] T115 ⛔ [US1] Extend the snapshot builder in `server/` so `hp` is authoritative, `am` is **per-recipient**, and the `st` reloading and dead bits are derived from `reloadTicks` and `health` — `NET-009`
- [ ] T116 ⛔ [US1] Create the room replay test in `server/`: a recorded input sequence for several players reproduces every shot, hit, death and respawn on the same tick — `M2-12`
- [ ] T117 ⛔ [US1] Add the tick-order tests to the room suite: two lethal hits on one victim in one tick emit exactly one `kill`; a shot generated by a player who dies later in the same tick still resolves; health never goes doubly negative
- [ ] T118 ⛔ [US1] Add the disconnect tests to the room suite: a player who leaves between firing and resolution leaves no ghost hit volume and lands no shot — `FR-GP-040`
- [ ] T119 ⛔ [P] [US1] Add handlers for the five new messages to `client/net`, each tolerant of having nothing to render: `hitConfirm` and `damage` are no-ops in M2 beyond updating state, because `FR-UI-008` is M4's and the kill feed is M3's
- [ ] T120 ⛔ [US1] Extend the client prediction path in `client/net` to carry `magazine`, `reloadTicks` and `fireCooldown` through the existing `ack`/replay mechanism, and to accept the snapshot as the correction — **predict no hit, no damage, no death** ([research.md § R7](research.md#r7--what-the-client-is-allowed-to-predict))

**Checkpoint**: `M2-1` is demonstrable and `M2-3`–`M2-6`, `M2-11` and `M2-12` hold. **This is the
MVP — stop and validate before Phase 5.**

---

## Phase 5: User Story 3 — see what the weapon is doing (P3)

**Goal**: Health, ammunition and a crosshair that tells the truth.

**Independent Test**: one browser. Take damage, fire, reload, read the screen.

- [ ] T121 ⛔ [P] [US3] Create `client/hud/health.ts`: a numeric health readout updating from the snapshot within one snapshot of taking damage — `FR-UI-005`
- [ ] T122 ⛔ [P] [US3] Create `client/hud/ammo.ts`: `current / {MAGAZINE_SIZE}` plus a reload progress indicator driven by `RELOAD_TICKS` — **the derived tick count, not the raw {RELOAD_TIME}**, so the bar and the weapon cannot disagree ([research.md § R4](research.md#r4--durations-in-a-simulation-with-no-clock)) — `FR-UI-006`
- [ ] T123 ⛔ [US3] Create `client/hud/crosshair.ts` and adjust `client/render/camera.ts`'s framing per the `Q-003` ADR, so the crosshair marks the point the server's ray reaches — `FR-UI-007`, `M2-13`. Camera collision (`FR-GP-020`) stays client-side and stays out of the aim path
- [ ] T124 ⛔ [US3] Add the respawn countdown overlay to `client/hud/`, showing the remaining delay while dead — `FR-GP-037`
- [ ] T125 ⛔ [US3] Wire the HUD into `client/boot/main.ts`, reading only state the client already holds — no new network message and no new computation

**Checkpoint**: `M2-13` and `M2-14` hold. All three stories are independently functional.

---

## Phase 6: Polish & cross-cutting

- [ ] T126 [P] Extend `shared/boundary.test.ts` and `shared/no-literals.test.ts` to the modules added in Phases 4–5, and add the `M2-2` check: `server/room.ts` **imports** the cast rather than containing one
- [ ] T127 Run `npm run verify` and confirm `shared/sim`, `shared/map` and `shared/protocol` report 100% and `server/` and `client/net/` 90%, with no threshold relaxed — `M2-15`
- [ ] T128 Walk every manual check in [quickstart.md](quickstart.md), including the `NFR-009` latency check — confirm that a high-latency player must lead a moving target, and **write nothing to compensate**
- [ ] T129 Confirm all sixteen criteria in [spec.md § Success Criteria](spec.md#success-criteria) hold, then hand back to the project owner to tag `v0.3.0`

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1 (Setup)** — T001 and T002 gate everything. **T003 gates Phase 4 and Phase 5 only.** T004 gates Phase 2. T005 gates T016–T019.
- **Phase 2 (Foundational)** — depends on T001, T002, T004. **Blocks all three stories.**
- **Phase 3 (US2)** — depends on Phase 2. **Not blocked by T003**, which is the whole reason it runs first.
- **Phase 4 (US1)** — depends on Phase 2, Phase 3, **and T003**.
- **Phase 5 (US3)** — depends on Phase 4 for state to display and on T003 for the crosshair.
- **Phase 6 (Polish)** — depends on all three stories.

### Within Phase 2

T006–T008 are one track, T009–T010 another, T011–T013 a third. T014–T015 need T006 and T009.
T016–T017 need T006 and T011. T018–T019 need T007 and T011. T020 needs everything else to exist.

### Within Phase 3

Tests T021–T024 first, in parallel, and they must fail. Then T025 → T026 → T027 → T028 → T029 in
that order — **all five touch `shared/sim/step.ts` and none can be parallelised with the others.**
T030 last, because it updates callers against the finished signature.

### Within Phase 4

T101–T104 in parallel first, and they must fail. Then T105 → T106 → T107 (`hitscan.ts`,
serialised). T108–T110 are an independent protocol track that can run beside them.
T111 → T112 → T113 → T114 → T115 all touch `server/room.ts` and are serialised. T116–T118 follow
the room. T119 and T120 are a client track that needs T108.

### Parallel opportunities

- **Phase 2**: three independent tracks — constants (T006–T008), ray geometry (T009–T010), types
  and validation (T011–T013). Then damage (T016–T017) and spawning (T018–T019) in parallel.
- **Phase 3**: all four test tasks (T021–T024) together.
- **Phase 4**: all four test tasks (T101–T104) together; the protocol track (T108–T110) beside the
  hitscan track (T105–T107).
- **Phase 5**: T121 and T122 together.

### The hard serialisations

Two files are touched by many tasks and can never be parallelised across them:

- `shared/sim/step.ts` — T025, T026, T027, T028, T029.
- `server/room.ts` — T111, T112, T113, T114, T115.

---

## Implementation strategy

### Build the ungated two thirds first

1. **Phase 1** — the gates, and the four decisions only the project owner can take.
2. **Phase 2** — everything `Q-003` does not touch.
3. **Phase 3** — the weapon economy, testable with one player.
4. **Stop.** If the ADR has not landed, stop here. Everything from `T101` is genuinely blocked,
   and there is no partial version of the raycast worth writing on a guess.
5. **Phase 4** — the MVP, once the ADR exists.

### Do not put the raycast in `server/`

The server is `resolveShot`'s only caller in M2, which makes `server/room.ts` the obvious home for
it and the wrong one. `NFR-003` requires one implementation in `shared/`, and M4's tracer
rendering and any future `NFR-009` rewind both begin with "run the cast the way the server ran
it". `T126` checks this mechanically rather than trusting a reviewer to notice.

### Do not resolve `Q-003` by choosing during implementation

If `T003` has not happened when `T101` comes up, the correct action is to stop and ask, not to
pick the recommendation and carry on. The recommendation in
[research.md § R1](research.md#r1--where-does-the-firing-ray-originate-q-003--blocking) exists to
make the owner's decision cheap, not to substitute for it (Constitution Principle I).

### Incremental delivery

Each phase ends green — `npm run verify` passes at every checkpoint, and each commit cites its
requirement IDs in the body per [CONTRIBUTING.md](../../CONTRIBUTING.md).
