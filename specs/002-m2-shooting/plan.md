# Implementation Plan: M2 — Shooting

**Branch**: `docs/m2-shooting-plan` (feature dir `002-m2-shooting`) | **Date**: 2026-08-22 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-m2-shooting/spec.md`

**Status**: **Planning complete, implementation blocked.** See [Gates](#gates).

---

## Summary

Give the two players M1 puts in a room something to do to each other: a server-side hitscan
raycast, regional damage, a magazine that runs dry, death, and an automatic respawn that does not
drop the victim in front of their killer.

The technical shape is decided by three things.

**First, the authority model becomes concrete.** Until M2 nothing a client said was worth lying
about. From here the protocol carries a fire _request_ (`NET-004b`) and nothing else — no damage
message, no kill message, no inbound health field. `NFR-001` is enforced by the absence of a
field, not by a check, and `M2-3` tests that the absence is real.

**Second, the simulation's constraints do not relax for combat.** The raycast and the damage
rules live in `shared/sim` under exactly the rules `step()` lives under: pure, deterministic,
fixed timestep, no clock, no randomness, and no implementation-approximated `Math` member
([ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md)). Two
consequences shaped the design more than anything else: every duration is a tick countdown
derived from a constant rather than a timestamp, and spawn selection — which M0's contract
assumed needed randomness — turns out not to, so it stays in `shared/`
([research.md § R4](research.md#r4--durations-in-a-simulation-with-no-clock),
[§ R5](research.md#r5--spawn-selection-needs-no-randomness)).

**Third, and unresolved: where the ray starts.** `CAMERA_OFFSET` puts the camera off the
character, so the crosshair ray and the eye ray are different lines.
[`Q-003`](../../requirements/11-open-questions.md#q-003) is researched in
[research.md § R1](research.md#r1--where-does-the-firing-ray-originate-q-003--blocking) with a
recommendation, and **this plan does not decide it**. The design is arranged so that only
`resolveShot`'s body and one field of `ShotIntent` depend on the answer; everything else — the
data model, the contracts, the task list — is identical under all three options.

M2 opens no new architectural question beyond that one. It adds no dependency, no database, no
history buffer, and no protocol optimisation.

---

## Gates

Neither of these is a formality, and neither is an implementation agent's to waive.

### Gate 1 — M1's demo criterion is met

Constitution Principle V. M2 consumes M1's protocol, room, tick loop, snapshot and prediction
buffer. **No source file may be written against this plan until M1 is demonstrably done.**

Producing this plan now is not starting M2. It is the part of M2 that can honestly be done in
parallel: reading the requirements, finding the tick-order and fractional-cadence problems before
they are discovered at a keyboard, and putting `Q-003` in front of the project owner with the
analysis already done.

### Gate 2 — the `Q-003` ADR exists

**`T101` — the first task that writes firing code — must not begin until an ADR resolving
[`Q-003`](../../requirements/11-open-questions.md#q-003) is merged.**
[`docs/adr/README.md`](../../docs/adr/README.md) already names this as the urgent one.

Why a gate and not an assumption: `FR-GP-024`'s ray origin, `NET-012`'s `from` field, the client's
crosshair placement and `client/render/camera.ts`'s entire framing all follow from the answer.
Retrofitting a different one means touching the raycast, the protocol payload and the HUD at once,
which is precisely what `Q-003` means by "very expensive to change afterwards".

The research recommends **option 1** — camera cast to a focus point, then eye to that point, with
the first cast reconstructed **server-side** so `NET-004` is untouched. The plan below is written
for that. [Research § R1](research.md#r1--where-does-the-firing-ray-originate-q-003--blocking)
states what changes under each alternative; the short version is that option 2 deletes the
camera-reconstruction tasks and re-opens `FR-UI-007`, and option 3 adds a client task on top of
everything option 1 needs.

**Do not resolve it by choosing during implementation.** Constitution Principle I: a task that
turns out to need a decision stops and asks.

### What this plan may proceed with today

Documents only. `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`,
`quickstart.md`, `tasks.md`. Nothing under `shared/`, `server/`, `client/`, `assets/` or
`requirements/`.

---

## Technical Context

**Language/Version**: TypeScript 5.6, `strict` with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. Target ES2022. Node ≥ 24. Unchanged from M0.

**Primary Dependencies**: none added. `three` stays client-only and stays banned from `shared/`.
No physics engine, no maths library, no geometry library — ray/AABB, ray/sphere and ray/capsule
are ten to thirty lines each and must be exact arithmetic under our own control (Principle II).

**Storage**: none. Still no database (`D-015`), and M2 adds no state that outlives the process.

**Testing**: Vitest 3 with v8 coverage. `shared/sim` is at a 100% threshold and M2 adds the
largest body of branchy geometry code the project will ever have to that directory.

**Target Platform**: desktop Chrome, Firefox, Edge, Safari. Server is a long-lived Node process
(`NFR-002`), and from M1 it is actually running.

**Project Type**: real-time multiplayer game. Three source roots sharing one deterministic core.

**Performance Goals**: {TARGET_FPS} rendered; server tick fixed at {SERVER_TICK_HZ}. The raycast
runs at most once per player per tick — at most {MAX_PLAYERS_PER_ROOM} casts per tick, each
against 14 blocks and up to 9 × 3 primitives. No spatial index is needed at this scale and adding
one would be pre-optimisation.

**Constraints**: bit-identical simulation across engines (`NFR-003`); pure, clock-free,
randomness-free `shared/sim` (`NFR-004`); server-authoritative outcomes (`NFR-001`); every inbound
field validated (`NFR-011`); no gameplay literal outside `shared/constants` (`SC-4`); 100%
coverage on `shared/sim`, `shared/map`, `shared/protocol` and 90% on `server/`, `client/net/`.

**Scale/Scope**: up to {MAX_PLAYERS_PER_ROOM} players in one hardcoded room. Roughly eight new
source files and four extended ones.

**Unknowns**: **one, and it is blocking** — `Q-003`, researched in
[research.md § R1](research.md) and awaiting the project owner's ADR. Everything else is resolved
in [research.md](research.md).

---

## Constitution Check

_GATE: evaluated before Phase 0; re-evaluated after Phase 1 design — see the bottom of this
section._

| Principle                                   | Gate                                                                        | Verdict                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I — `requirements/` is supreme**          | Does the plan invent a requirement, or build anything `DEFERRED`/`DROPPED`? | **PASS.** M2 mints no requirement ID; every entry in the spec's requirements table already existed. The one blocking open question is escalated as [Gate 2](#gates), not guessed. No recoil or spread (`FR-GP-033`), no spawn protection (`FR-GP-039`), no lag compensation or position history (`NFR-009`), no visibility culling (`FR-GP-049`).              |
| **II — shared, pure, deterministic**        | Is the raycast born in `shared/sim`? Is purity enforced mechanically?       | **PASS.** [contracts/combat-api.md](contracts/combat-api.md) inherits M0's C1–C7 verbatim and adds C8–C28. `sqrt` is the only non-trivial `Math` member used, and `ADR-0001` permits it explicitly. The existing ESLint `shared/**` rule and boundary test cover the new files with no change.                                                                 |
| **III — server authoritative**              | Can any inbound message assert an outcome?                                  | **PASS.** The entire inbound addition is two bits of an existing bitmask, both requests (`NET-004b`). `M2-3` is a test over `shared/protocol` asserting no inbound type has an outcome-bearing field — so the property survives M3 adding messages. `hitConfirm` withholds the victim's health by construction (`NET-014`).                                    |
| **IV — every number in `shared/constants`** | Any literal outside it?                                                     | **PASS, with an action for the owner.** Eight hit-volume fractions and five derived values are needed and are listed in [data-model.md](data-model.md#new-constants) rather than invented in prose. They must be added to [07-constants.md](../../requirements/07-constants.md) — see [below](#requirements-this-plan-implies). `M2-16` verifies mechanically. |
| **V — milestone order**                     | Does the plan pull later work forward?                                      | **PASS.** [Gate 1](#gates) is explicit. No teams, no scoring, no kill feed, no hit markers, no animation, no audio. `FR-GP-025`'s team filter exists as a **seam** the caller fills; M2 fills it with "not me, not dead" and M3 adds teams — the rule itself is not implemented early.                                                                         |
| **VI — tests are the gate**                 | Are thresholds met without relaxation?                                      | **PASS.** No threshold is lowered. The heaviest new code lands in the 100% directory on purpose: geometry with untested branches is exactly where a hit-registration bug hides.                                                                                                                                                                                |

### Post-design re-evaluation

Re-checked after Phase 1. Three things changed during design, all of them tightening:

1. **`step()`'s return type widens** from `PlayerState` to `{ state, shot }`. This breaks M0's
   published contract, so it is recorded as a deliberate amendment in
   [contracts/combat-api.md](contracts/combat-api.md) rather than as an incidental refactor. The
   alternative — widening `step()` to take the whole room — was rejected because it would force
   the client's prediction to replay every player's movement to replay its own
   ([research.md § R2](research.md#r2--where-combat-lives-and-what-happens-to-step)).
2. **Spawn selection moved into `shared/sim`.** M0's contract had listed it as server-only "because
   it needs randomness". Reading `FR-GP-038` closely, it does not: it is an argmax with a
   tie-break, and the randomness in that note belongs to `FR-GP-004` (team assignment, M3). Moving
   it in means it is covered at 100% and the client can render a respawn identically. Principle I
   is not breached — the requirement is unchanged, only a spec's assumption about it.
3. **A tick order became part of the contract.** The spec's edge cases about simultaneous kills
   are all one question, and answering it incidentally would leave `M2-12` failing
   intermittently. It is now written down in
   [research.md § R2](research.md#tick-order--fixed-documented-and-not-incidental) and in the
   contract's call pattern.

**No violations. Complexity Tracking is empty.**

---

## Dependencies on M1

M2 cannot be planned honestly without naming what it assumes M1 leaves behind. Each of these is a
thing to check on the day Gate 1 opens, not to discover while wiring:

| Assumed to exist                                          | Why M2 needs it                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `shared/protocol` with message types and validators       | M2 adds five outbound types and two input bits to it, rather than creating it                                                 |
| The server room and its tick loop                         | The two-phase tick in [contracts/combat-api.md](contracts/combat-api.md#call-pattern) is an extension of M1's loop            |
| Stable, reproducible player ids                           | Tick order is ascending player id (`M2-12`). A random id generator would make a replay unreproducible                         |
| The snapshot builder                                      | `hp`, `am` and the `st` bits become real. **`am` is per-recipient**, so the snapshot can no longer be serialised once for all |
| Prediction and reconciliation (`NFR-006`, `NFR-007`)      | The client predicts its own ammunition and reload through the same `ack`/replay path                                          |
| Input validation and rate limiting (`NFR-010`, `NFR-011`) | `M2-7`'s "a flooding client gains nothing" is partly M1's rate limit and partly M2's cooldown                                 |
| A script to start the server                              | `package.json` has none today; `server/index.ts` is inert                                                                     |

The per-recipient snapshot is the one most likely to be a surprise. If M1 builds a single JSON
string and writes it to every socket, M2 has to change that, and it is cheaper for M1 to know now.

---

## Project Structure

### Documentation (this feature)

```text
specs/002-m2-shooting/
├── spec.md                      # Phase -1: what and why, and the two gates
├── plan.md                      # This file
├── research.md                  # Phase 0: R1-R7. R1 is Q-003 and is UNRESOLVED
├── data-model.md                # Phase 1: PlayerState/PlayerInput extensions, hit volumes, new constants
├── contracts/
│   ├── combat-api.md            # the shared/sim combat contract, C8-C28 on top of M0's C1-C7
│   └── combat-messages.md       # NET-012..016, who receives what, what must never be in it
├── quickstart.md                # Phase 1: how to validate M2
└── tasks.md                     # Phase 2
```

### Source code (repository root)

Only what M2 adds or changes. Everything else is M0's and M1's.

```text
shared/
├── constants/
│   └── index.ts                 # + hit-volume fractions, + TICKS_PER_SHOT, RELOAD_TICKS,
│                                #   RESPAWN_TICKS, MIN_SPAWN_DISTANCE_SQ, AIM_CAST_RANGE
├── math/
│   └── ray.ts                   # NEW - ray/AABB (slab), ray/sphere, ray/capsule. sqrt only
├── sim/
│   ├── types.ts                 # + health, magazine, fireCooldown, reloadTicks, respawnTicks;
│   │                            #   + fire/reload intent; + HitRegion, ShotIntent, ShotResult
│   ├── validate.ts              # + the two new intent flags
│   ├── step.ts                  # + the weapon state machine; returns { state, shot }
│   ├── hitvolume.ts             # NEW - the three static primitives from (pos, crouching)
│   ├── hitscan.ts               # NEW - resolveShot: the cast, the filter, the tie-break
│   ├── damage.ts                # NEW - applyDamage: clamp, lethality, death side effects
│   └── spawn.ts                 # NEW - selectSpawn: argmax with a deterministic tie-break
└── protocol/
    └── ...                      # + the five outbound message types and the keys bitmask decode

server/
├── room.ts                      # + the two-phase tick; builds NET-012..016 from a ShotResult
└── ...

client/
├── hud/                         # NEW directory
│   ├── health.ts                # FR-UI-005
│   ├── ammo.ts                  # FR-UI-006
│   └── crosshair.ts             # FR-UI-007 - shape decided by the Q-003 ADR
├── render/
│   └── camera.ts                # framing changes with the Q-003 ADR; collision unchanged
└── net/
    └── ...                      # + handlers for the five new messages, tolerant of having nothing to draw

assets/maps/
└── arena-01.json                # + spawn points, so FR-GP-038 has a real choice to make
```

**Structure Decision.** Combat is split into four small `shared/sim` modules rather than one
`combat.ts`, along the lines the contract already draws: volumes, casting, damage, spawning. Each
is separately testable to 100%, and `hitscan.ts` — the one whose shape `Q-003` governs — is
isolated so the gate has a single blast radius.

**`shared/math/ray.ts` is new and is deliberately not inside `sim`.** It is geometry, not game
rules: the same intersection routines are wanted by the client's nameplate occlusion check in M4
(`FR-GP-048`). Putting them in `sim` would make a rendering concern import the simulation, which
inverts the dependency — the same reasoning that put `vec3.ts` outside `sim` in M0.

**`client/hud/` is new**, matching the module boundary suggested in
[05-architecture.md](../../requirements/05-architecture.md). It has no coverage threshold of its
own, so its logic — formatting, the reload bar's progress — should stay thin, with anything worth
testing derived from state the simulation already computes.

---

## Implementation order

Dependency-ordered, not importance-ordered. [tasks.md](tasks.md) expands this.

| #   | Slice                                                              | Delivers                                                         | Gate                                                                           |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | **Constants**                                                      | The hit-volume fractions and the derived tick counts             | 100%; `TICKS_PER_SHOT` asserted against {FIRE_RATE_RPS} and {SERVER_TICK_HZ}   |
| 2   | **`shared/math/ray.ts`**                                           | Ray/AABB, ray/sphere, ray/capsule — pure geometry, no game rules | 100%; misses, grazes, origin-inside, degenerate direction                      |
| 3   | **`PlayerState`/`PlayerInput` extension + validation**             | The shape everything else is written against                     | 100%; the two new bits validated and masked                                    |
| 4   | **`hitvolume.ts`**                                                 | The three primitives, and the two invariants as tests            | 100%; standing and crouched; radius ≤ {PLAYER_RADIUS}                          |
| 5   | **The weapon state machine in `step()`**                           | Fire cadence, magazine, reload, death inertness                  | 100%; **C10–C12 land here**; the fractional cadence is proven over a long span |
| 6   | **`damage.ts` + `spawn.ts`**                                       | Regional damage, clamping, lethality, respawn placement          | 100%; the no-valid-spawn fallback against a synthetic map                      |
| 7   | ⛔ **`hitscan.ts`** — `resolveShot`                                | The cast, the eligibility filter, the tie-break                  | **Gate 2 must be open.** 100%; every tie case at exactly equal `t`             |
| 8   | **`shared/protocol` additions**                                    | The five outbound types; the bitmask decode                      | 100%; `M2-3`'s no-outcome-field test                                           |
| 9   | **`server/room.ts`** — the two-phase tick and the message builders | Combat actually happening                                        | 90%; the room replay test (`M2-12`); simultaneous-kill cases                   |
| 10  | **`client/net`** handlers                                          | Five messages received without a renderer for them               | 90%; a `hitConfirm` with nothing to draw is a no-op                            |
| 11  | **`client/hud`** — health, ammo, crosshair                         | `FR-UI-005`–`FR-UI-007`                                          | Manual; the reload bar reads the derived tick count, not {RELOAD_TIME}         |
| 12  | **`assets/maps/arena-01.json`** — more spawns                      | Spawn selection with something to choose between                 | The map loader's rules 1–9 still pass                                          |

Slices 1–6 and 8 are unblocked by Gate 2 and can proceed the moment Gate 1 opens. **Slice 7 is the
gated one**, and slices 9–11 depend on it.

That is not an accident of ordering — it is why the design put `cameraEye` in `ShotIntent` and
kept `ShotResult` identical under all three Q-003 options. Roughly three quarters of M2 can be
built and tested while the ADR is still being decided.

**Do not reorder to get something shooting on screen sooner.** Slices 1–6 produce nothing visible.
The equivalent temptation in M0 was to build the Three.js scene before the simulation; here it is
to put the raycast in `server/room.ts` because the server is its only caller today. `NFR-003`
forbids it, and M4's tracers and any future `NFR-009` rewind both start from "run the cast the way
the server ran it".

---

## Requirements this plan implies

**This plan does not edit `requirements/`, `docs/`, or another feature's spec.** Constitution
Principle I and the document boundaries: `requirements/` is amended deliberately, by the project
owner. Everything M2's design implies about those documents is collected here so a human can act
on it in one pass.

### 1. `Q-003` must be answered as an ADR, then deleted from `11-open-questions.md`

The blocking item. [research.md § R1](research.md#r1--where-does-the-firing-ray-originate-q-003--blocking)
has the analysis and a recommendation. On acceptance the ADR is added to
[`docs/adr/README.md`](../../docs/adr/README.md)'s index and its "Waiting to be written" paragraph
is removed, and `Q-003` leaves `11-open-questions.md` — an answered question does not stay open.

### 2. Thirteen constants need to be added to `07-constants.md`

Eight hit-volume fractions and five derived values, listed with proposed values and reasoning in
[data-model.md § New constants](data-model.md#new-constants). Adding a constant because a plan
needs a number is explicitly fine under Principle IV; putting the number anywhere else is not.
The derived five belong under that document's existing "Derived values — do not hardcode"
heading.

### 3. `FR-GP-024`'s wording and the Q-003 answer should be made to agree

`FR-GP-024` says the server "casts a ray from the player's eye position along their aim
direction". Under the recommended option 1 that is still true — the ray starts at the eye and
goes where the player is aiming — but "their aim direction" could also be read as `input.dir`,
which is option 2. It is a wording ambiguity, not a design conflict, and it is worth one
clarifying clause in the same change that lands the ADR. Discussed in
[research.md § R1](research.md#which-way-the-requirements-already-lean-and-the-one-place-they-do-not-agree).

### 4. M0's `contracts/sim-api.md` contains one superseded sentence

It lists spawn selection as "M2, and server-side only, because it needs randomness that `NFR-004`
bars from the simulation". `FR-GP-038` has no random element; the randomness in that sentence
belongs to `FR-GP-004`, which is M3's. The reasoning is in
[research.md § R5](research.md#r5--spawn-selection-needs-no-randomness). Correcting another
feature's document is not this plan's to do — flagged, not edited.

### 5. `FR-GP-032` and `FR-GP-038` are `PROPOSED`, and M2 is where they get built

Both are load-bearing for M2 (`M2-8`, `M2-10`) and both are marked `PROPOSED` — a reasonable
default, not confirmed. Worth a moment's confirmation from the project owner before slice 6,
because changing either afterwards changes tested behaviour rather than a constant.

---

## Risks

| Risk                                                                               | Mitigation                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q-003 is decided differently from the recommendation**                           | Contained by design: only `resolveShot`'s body and `ShotIntent.cameraEye` depend on it. `ShotResult`, the contract's C13–C20, and slices 1–6 are identical under all three options. Worst case is slice 7 plus a `client/render/camera.ts` framing change |
| **Q-003 is never decided and slice 7 is started anyway**                           | Gate 2 is named in the spec, the plan and the task list, and `T101` states it as its precondition. This is the failure mode `docs/adr/README.md` already warns about                                                                                      |
| The raycast quietly ends up in `server/` because the server is its only caller     | Existing ESLint boundary rules do not catch this — they stop `shared/` reaching out, not `server/` keeping logic in. `M2-2` is a review criterion plus a test asserting `server/room.ts` imports the cast rather than containing one                      |
| Fractional fire cadence rounded to whole ticks                                     | `SC-4` failure, silent without a test. A test counts shots over a long tick span and asserts the average is {FIRE_RATE_RPS}, not that any single interval is                                                                                              |
| Hit-volume dimensions drifting from the movement box                               | Invariant 1 in [data-model.md](data-model.md#hitvolume) is a test, not a comment: every radius ≤ {PLAYER_RADIUS}                                                                                                                                          |
| Tie-breaks decided by iteration order                                              | Every tie case has an explicit rule and a test at exactly equal `t`. `M2-12`'s replay would catch a violation only intermittently, which is why it is not the primary defence                                                                             |
| A throw in shot resolution taking down a room                                      | C7 (total over validated input) plus `NFR-015`. Degenerate inputs — zero-length direction, origin inside geometry, a target at exactly {WEAPON_RANGE} — are property-tested rather than reasoned about                                                    |
| Someone "improving" hit volumes to follow the model once M4 lands animation        | `FR-GP-027`, `NFR-017`, and a test asserting hit results depend only on `(pos, crouching)`. The volumes are pinned to the transform now, before bones exist and it becomes tempting                                                                       |
| A position history buffer added "so rewind is easy later"                          | `NFR-009` and [09-out-of-scope.md](../../requirements/09-out-of-scope.md) both forbid it. C20 makes it visible in the signature: there is no timestamp parameter to feed one                                                                              |
| {FIRE_RATE_RPS} against {DAMAGE_TORSO} gives a 0.5 s time-to-kill and feels brutal | That is [`Q-002`](../../requirements/11-open-questions.md#q-002), and `M2-16` makes it a constants edit. M2 must not "fix" it by changing a value — that is a product decision (Principle IV)                                                             |

---

## Complexity Tracking

No Constitution violations. This section is intentionally empty.
