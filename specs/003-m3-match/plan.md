# Implementation Plan: M3 — An actual match

**Branch**: `docs/m3-match-plan` (feature dir `003-m3-match`) | **Date**: 2026-08-22 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-m3-match/spec.md`

> **This plan is documents only.** M3 depends on M1's networking and M2's combat, neither of which
> exists yet, and Constitution Principle V forbids starting a milestone while the previous one's
> demo criterion is unmet. Producing the plan now is the work that can honestly be done in
> parallel; producing the code is not. **No source file is written by this milestone's planning.**

---

## Summary

Turn a shooting range into a game: a match with a clock and an end, two modes with two sides, and a
way in from a cold page.

The technical approach is shaped by three decisions, each taken because it makes a requirement
testable rather than merely true:

1. **The room does not own its clock.** It exposes `tick()`; a single scheduler drives every room,
   wrapping each tick in its own `try`/`catch`. That turns `NFR-015` — "an exception in one room's
   tick does not stop another's" — from an accident of the event loop into a line of code with a
   test pointing at it, and it turns an eight-minute match into a test loop that runs in
   milliseconds. It is the same reasoning that keeps the accumulator loop outside `step()` in
   [M0's sim contract](../000-m0-walking-box/contracts/sim-api.md).
2. **The match clock counts ticks, not milliseconds.** `timeLeftMs` is derived from `elapsedTicks`,
   so there is exactly one clock in the room, tests need no fake timers, and the timer cannot
   disagree with the simulation it is timing.
3. **The nickname rendering boundary is built before the first surface that needs it.** M3 is the
   first milestone that draws attacker-controlled text in someone else's browser. `NFR-012` is
   satisfied by the renderer alone, with the validator assumed to have failed — which means the
   lint rule and the chokepoint land in setup, exactly as M0's `shared/` boundary did.

The architectural change underneath all of it is that the server stops managing **one** room and
starts managing **many**. That is the part most likely to be underestimated.

---

## Technical Context

**Language/Version**: TypeScript 5.6, `strict` with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. Target ES2022. Node ≥ 24.

**Primary Dependencies**: no new ones. `three` (client), `vite`, `vitest`. The one dependency M3
might have wanted — a DOM test environment — is deliberately avoided; see
[research.md § R7](research.md#r7--enforcing-nfr-012-mechanically-and-testing-it-without-a-new-dependency)
and [Implications](#implications-for-requirements).

**Storage**: none. Rooms, matches and scores live in process memory (`NFR-002`) and die with it.
There is no database (`D-015`), and `localStorage` is M5's.

**Testing**: Vitest 3, `environment: 'node'`. `server/**` at 90% lines / 85% branches,
`shared/protocol/**` at 100%, `client/hud/**` at 50%.

**Target Platform**: desktop Chrome, Firefox, Edge, Safari. Server is one long-lived Node process
(`NFR-002`).

**Project Type**: real-time multiplayer game. Three source roots sharing one deterministic core.

**Performance Goals**: {SERVER_TICK_HZ} ticks and {SNAPSHOT_HZ} snapshots per room. `NFR-014`'s
{TARGET_FPS} pass with a full room is M5's.

**Constraints**: server-authoritative (`NFR-001`); rooms isolated (`NFR-015`); randomness outside
the simulation step (`NFR-004`); every inbound field validated (`NFR-011`); nicknames never
rendered as markup (`NFR-012`); no gameplay literal outside `shared/constants` (`SC-4`).

**Scale/Scope**: up to {MAX_PLAYERS_PER_ROOM} per room, a handful of concurrent rooms in one
process. Roughly 20 new source files, concentrated in `server/` and `client/hud/`.

**Unknowns**: one, and it is blocking — [`Q-006`](../../requirements/11-open-questions.md). See
[Blocking gates](#blocking-gates). Everything else is resolved in [research.md](research.md).

---

## Blocking gates

**Both must be closed by the project owner before implementation begins.** Neither is closed by
this plan, and neither may be guessed (Constitution, Principle I).

### Gate 1 — M1 and M2 must have met their demo criteria

Principle V: "Do not start the next milestone while the current one's criterion is unmet." M3's
plan may exist now; M3's code may not. Two browsers must see each other move smoothly (M1) and be
able to kill each other and respawn (M2) before the first task here is started.

Where this plan rests on M1 or M2, it names the requirement ID rather than assuming an interface —
see [spec.md § Assumptions](spec.md#assumptions) items 2 and 3.

### Gate 2 — `Q-006` must be decided ⚠️

[`Q-006`](../../requirements/11-open-questions.md) — what happens to a player left idle in the
pointer-lock-released state — is marked **Blocks: M3**, and it does.

`FR-GP-021` keeps that player in the match and killable, which over a full {MATCH_DURATION} match
leaves a stationary free kill. In M2 that was a wasted target; in M3 it is a _scored_ one, and it
distorts the frag limit (`FR-GP-043`), the standings (`FR-GP-044`) and the results screen
(`FR-UI-004`). The most likely way the demo looks bad is a match that ends 20–0 because someone
alt-tabbed.

[research.md § R6](research.md#r6--q-006-what-happens-to-an-idle-player-in-the-pointer-lock-released-state--unresolved-blocking)
lays out the three options `Q-006` names, plus a fourth listed only to be rejected on the record,
with the cost of each. **Its recommendation is option 2** — remove the player after a period with
no input, treated exactly as a disconnect — because it is the only option that removes the body
rather than accounting around it, and because it composes with `FR-GP-040` and `D-009`, which
already specify clean removal and a new identity on return. Its cost is one new constant, one idle
counter, one close path, a place for the client to land, and a note on `FR-GP-021` that it is now
bounded.

**The decision is the project owner's.** It is a product decision, so it closes as a `D-###` in
[10-decision-log.md](../../requirements/10-decision-log.md) and is deleted from
[11-open-questions.md](../../requirements/11-open-questions.md), per the Constitution's rule that a
blocking open question is resolved before the milestone's plan. This plan is written ahead of its
dependencies on purpose, so the gate is recorded rather than pretended closed — that is the honest
form of the same rule.

**If the owner chooses option 1 (leave as-is)**, nothing is built, the gate closes with a decision
on the record, and M3 proceeds unchanged. `Q-006` itself rates the severity "low".

---

## Constitution Check

_GATE: passed before Phase 0; re-evaluated after Phase 1 design — see the bottom of this section._

| Principle                                   | Gate                                                                        | Verdict                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I — `requirements/` is supreme**          | Does the plan invent a requirement, or build anything `DEFERRED`/`DROPPED`? | **PASS, with one gate open.** M3 mints no requirement ID; Success Criteria are `M3-1`…`M3-15`. `Q-006` is **researched and left open**, not guessed. Two documentation gaps found during design are raised in [Implications](#implications-for-requirements) rather than fixed by editing `requirements/`.                 |
| **II — shared, pure, deterministic**        | Does anything M3 adds reach into `shared/sim`?                              | **PASS.** [R8](research.md#r8--does-any-match-logic-belong-in-shared) rejects a shared `matchStep()`. `shared/` gains protocol types and validators only. Randomness enters through an injected source in `server/` ([R5](research.md#r5--where-does-randomness-live)); `Math.random` is already unreachable in `shared/`. |
| **III — server authoritative**              | Can any inbound message assert an outcome?                                  | **PASS.** [contracts/match-protocol.md § P2](contracts/match-protocol.md) enumerates the messages M3 must **not** add — `setTeam`, `readyUp`, `reportScore`, `rejoin`. The room's `join` takes a nickname and nothing that reaches game state (G3).                                                                        |
| **IV — every number in `shared/constants`** | Any literal outside it?                                                     | **PASS.** Two new constants are **listed, not invented in prose** ([data-model.md](data-model.md#new-constants)) and raised for `07-constants.md`. Four tick counts are derived with `Math.ceil`, never written down.                                                                                                      |
| **V — milestone order**                     | Does the plan pull later work forward?                                      | **PASS, and it is the reason for Gate 1.** No models, no animation, no nameplates, no audio, no `localStorage`, no loading or disconnect screens. The arena gains team-tagged spawn **data**; the level **design** stays M4's, exactly as M0 kept the map format final and its design provisional.                         |
| **VI — tests are the gate**                 | Are thresholds met without relaxation?                                      | **PASS.** No threshold is lowered. Three injection seams ([R10](research.md#r10--making-server-testable-to-90)) make the 90% on `server/**` reachable without mocks-of-mocks. **Raising** `client/hud/**` is recommended to the owner, not done here — a CI-config change is their decision.                               |

### Post-design re-evaluation

Re-checked after Phase 1. Three things surfaced during design; all three tighten rather than
relax, and all three are recorded rather than absorbed:

1. **`MatchPhase` needs a second value.** `NET-009` shows `phase` with the single example
   `PLAYING`; `FR-GP-045`'s results period needs another. Adding it is unavoidable, so it is
   flagged as an amendment `06-network-protocol.md` should receive — see
   [Implications](#implications-for-requirements). Principle I is satisfied by not editing the file
   from a spec.
2. **`FR-GP-046` is listed under two milestones.** M3 is where rooms are first created dynamically,
   so a lifecycle without destruction leaks a tick loop per abandoned room. Scoped into M3, flagged
   for the owner, and M5's bullet becomes a verification pass.
3. **The `NFR-012` test needed a DOM that does not exist.** The obvious fix is a new dependency,
   which requires the owner's approval. [R7](research.md#r7--enforcing-nfr-012-mechanically-and-testing-it-without-a-new-dependency)
   found a better one: a hand-written fake element whose `innerHTML` setter throws, which proves
   the property **more** directly than jsdom would and adds nothing to `package.json`.

**No violations. Complexity Tracking is empty.**

---

## Project Structure

### Documentation (this feature)

```text
specs/003-m3-match/
├── spec.md                        # Phase -1: what and why
├── plan.md                        # This file
├── research.md                    # Phase 0: R1–R10; R6 is the open gate
├── data-model.md                  # Phase 1: Room, MatchState, roster, new constants
├── contracts/
│   ├── room-lifecycle.md          # the room and matchmaker contract, G1–G8
│   ├── match-protocol.md          # M3's protocol additions, P1–P5
│   └── nickname-rendering.md      # NFR-012, C1–C5 and its four tests
├── checklists/
│   └── requirements.md            # spec quality validation
├── quickstart.md                  # Phase 1: how to validate M3
└── tasks.md                       # Phase 2 — NOT created by /speckit-plan
```

### Source code (repository root)

Only what M3 adds or changes. `shared/sim`, `shared/map`, `shared/math` and `client/render` are
untouched by this milestone.

```text
shared/
├── constants/index.ts             # + ROOM_CODE_ALPHABET, ROOM_CODE_MAX_ATTEMPTS, derived ticks
└── protocol/                      # 100% coverage — the security boundary
    ├── types.ts                   # GameMode, Team, MatchPhase, EndReason, message payloads
    └── validate.ts                # join validation: nickname, mode, roomCode (NFR-011)

server/
├── index.ts                       # bootstrap: registry + scheduler (was inert at M0, socket at M1)
├── scheduler.ts                   # ONE timer; per-room try/catch — this is where NFR-015 lives
├── matchmaker/
│   ├── registry.ts                # rooms by id and by code; auto-match selection (R2)
│   └── code.ts                    # room code generation, crypto.randomInt, retry bound (R3)
└── room/
    ├── room.ts                    # tick(), join(), leave(), destroy()
    ├── match.ts                   # phase, elapsedTicks, end conditions, restart
    ├── scoring.ts                 # kills, deaths, team totals, standings, draws
    └── teams.ts                   # assignment to the smaller team; random tie-break (R5)

client/
├── boot/start-screen.ts           # FR-UI-001: nickname, mode, play, create, join by code
├── net/roster.ts                  # player id -> nickname/team/score; display names (R9)
└── hud/
    ├── text.ts                    # THE sink. textContent, and nothing else (NFR-012)
    ├── scoreboard.ts              # FR-UI-010
    ├── kill-feed.ts               # FR-UI-009
    ├── match-status.ts            # FR-UI-011
    └── results.ts                 # FR-UI-004

assets/maps/arena-01.json          # + BLUE/RED spawn clusters (FR-MAP-007, FR-MAP-008)
eslint.config.js                   # + the client/** HTML-sink ban (NFR-012)
```

**Structure Decision.** The layout follows
[05-architecture.md](../../requirements/05-architecture.md)'s suggested boundaries, which already
name `room`, `matchmaker`, `net` and `hud`. Three notes:

- **`server/scheduler.ts` is not in the suggested layout.** It exists because `NFR-015` needs a
  place to be true. Folding it into `index.ts` would bury the one `try`/`catch` the requirement
  turns on inside a bootstrap file.
- **`client/hud/text.ts` is one function.** That is the point: `NFR-012` is enforced by there being
  exactly one sink to audit, and a one-function file is the cheapest way to keep it that way.
- **`server/room/` is split four ways** rather than being one large `room.ts`, because `server/**`
  carries an 85% **branch** threshold and the end-condition and team-assignment branches are the
  ones a test must reach individually.

---

## Implementation order

Dependency-ordered, not importance-ordered. `/speckit-tasks` expands this.

| #   | Slice                                                                   | Delivers                                                          | Gate                                                                 |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | **The `NFR-012` boundary** — lint rule, `client/hud/text.ts`, its tests | The HTML sinks are unreachable before a surface exists            | A deliberate `innerHTML =` fails lint; the fake-element test passes  |
| 2   | **Constants + protocol types and validators**                           | The security boundary and the shared vocabulary                   | 100% on `shared/protocol`; every rejection branch tested             |
| 3   | **Match state** — phase, tick clock, end conditions, restart            | The demo criterion's core, testable with no socket and no browser | Both end conditions, the same-tick collision, the draw, the restart  |
| 4   | **Scoring and teams**                                                   | `FR-GP-041`, `FR-GP-004`, standings, draws                        | Team sizes never differ by more than 1; ties assertable via the stub |
| 5   | **The room** — join, leave, capacity, destroy                           | `FR-GP-013`, `FR-GP-014`, `FR-GP-040`, `FR-GP-046`                | Capacity refused before any add; destroy leaves nothing running      |
| 6   | **Scheduler + registry + codes**                                        | Many rooms, auto-match, private codes                             | **`M3-11` — a throwing room does not stop a healthy one**            |
| 7   | **No friendly fire**                                                    | `FR-GP-005` — teammates excluded from M2's raycast                | A shot at an enemy behind a teammate hits the enemy                  |
| 8   | **Map spawn data**                                                      | `FR-MAP-007`, `FR-MAP-008`                                        | TDM teams start separated; `ANY` unused in TDM                       |
| 9   | **HUD** — match status, scoreboard, kill feed, results                  | `FR-UI-009`–`FR-UI-011`, `FR-UI-004`                              | Every surface renders through the slice-1 sink                       |
| 10  | **Start screen**                                                        | `FR-UI-001`, `FR-GP-007`, auto-match and code entry               | `SC-1` — cold page to first shot                                     |

**Slice 1 is first and it is not negotiable.** Its entire value is that it lands before any surface
exists to violate it. A lint rule added after the scoreboard is a lint rule someone suppresses to
avoid a rewrite, and that is how `NFR-012` quietly stops being true. M0 ordered its `shared/`
boundary the same way and for the same reason.

Slices 2–7 are pure logic, fully testable with no browser and no socket. Slices 9–10 are where the
demo appears. **Do not reorder to see the scoreboard sooner** — the match lifecycle is the
milestone, and a scoreboard rendering a match that cannot end is not progress.

---

## Implications for `requirements/`

**Nothing under `requirements/` is edited by this planning work.** Design surfaced four items that
a human should act on; each is listed with what was found and what is recommended.

### 1. Two constants are missing from `07-constants.md`

| Constant                 | Suggested value                     | Needed by                                                                |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `ROOM_CODE_ALPHABET`     | `'23456789ABCDEFGHJKMNPQRSTUVWXYZ'` | `FR-GP-012` names the exclusions but not the alphabet                    |
| `ROOM_CODE_MAX_ATTEMPTS` | `10`                                | Bounds the collision retry in [R3](research.md#r3--room-code-generation) |

Both are tuning values, so Principle IV puts them in `07-constants.md` and `shared/constants` and
nowhere else. Adding a constant a plan needs is explicitly fine; putting the number anywhere else
is not.

### 2. `NET-009`'s `phase` has no enumerated value set

`NET-009` shows `"phase": "PLAYING"` as an example. `FR-GP-045` requires a second phase for the
results period. **Recommendation:** enumerate `phase` in `06-network-protocol.md` as `PLAYING` and
one post-match value, so the wire contract is stated rather than inferred from an example. M3 uses
`POST_MATCH`; the name is the owner's to confirm.

### 3. `FR-GP-046` is claimed by two milestones

[08-roadmap.md](../../requirements/08-roadmap.md) puts `FR-GP-041`–`FR-GP-046` under M3 and also
names empty-room cleanup under M5. **Recommendation:** M3 owns it. M3 is the milestone that first
creates rooms dynamically — M1 has one hardcoded room — so a room lifecycle without destruction
leaks a tick loop per abandoned room, and `FR-GP-046`'s own acceptance criterion ("no timers,
intervals, or simulation ticks continue to run for a destroyed room") is a property of the code M3
writes. M5's bullet then reads as a verification pass rather than new work. One of the two bullets
should be adjusted so the roadmap says which milestone owns it.

### 4. Two test-infrastructure decisions belong to the owner

- **`client/hud/**` sits at a 50% coverage threshold**, and the surfaces that render
  attacker-controlled text live there. The named tests in
  [contracts/nickname-rendering.md](contracts/nickname-rendering.md) are the real gate, but
  **raising this threshold is worth doing** now that the directory holds security-relevant code.
  It is a CI-config change, so it is the owner's call.
- **A DOM test environment (`jsdom` / `happy-dom`) is not being added.**
  [R7](research.md#r7--enforcing-nfr-012-mechanically-and-testing-it-without-a-new-dependency)
  found a fake-element fixture that proves the property more directly and adds no dependency. Noted
  because "adding any dependency requires the project owner's approval" cuts both ways: the
  decision _not_ to add one should also be visible.

### 5. If `Q-006` resolves to option 2

An idle-timeout constant joins `07-constants.md`, and `FR-GP-021` gains a note that the
pointer-lock-released state is now bounded. Both follow the owner's decision; neither is
pre-empted here.

---

## Risks

| Risk                                                                           | Mitigation                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`NFR-012` erodes as surfaces are added** — the highest-consequence risk here | Three layers, none of them a person remembering: a single sink, a lint ban landing in slice 1, and a source-scanning test with a precedent already in the repo. Plus a test that bypasses the validator entirely  |
| A room ticks forever after everyone leaves                                     | `emptySinceTick` + {EMPTY_ROOM_GRACE_PERIOD}, and a destruction test asserting no further ticks (G7). This is why `FR-GP-046` is scoped into M3                                                                   |
| The match lifecycle is only testable in real time                              | The room does not own its clock (G1). 14 400 ticks in a loop, no fake timers                                                                                                                                      |
| Two end conditions in one tick emit two `matchEnd`s                            | The transition fires only from `PLAYING` — guard on the phase, not on the order of the two checks                                                                                                                 |
| A ghost scoreboard row after a disconnect                                      | Scores live on `RoomPlayer`, so removal is one operation (`FR-GP-040`, `M3-15`)                                                                                                                                   |
| Auto-match scatters players across rooms                                       | Fullest-room-first ([R2](research.md#r2--which-room-does-auto-match-pick)). The failure is invisible with one room and obvious with three                                                                         |
| Team-tie assignment is flaky under test                                        | An injected random source ([R5](research.md#r5--where-does-randomness-live))                                                                                                                                      |
| The kill feed is ambiguous when two players share a nickname                   | The suffix derives from the player **ID**, never join order — clients that joined at different times would otherwise label the same player differently ([R9](research.md#r9--how-the-client-knows-who-anyone-is)) |
| The HUD timer drifts on a backgrounded tab                                     | Every snapshot overwrites `timeLeftMs`; the client never free-runs (`FR-UI-011`, `M3-13`)                                                                                                                         |
| M1/M2 ship interfaces this plan did not anticipate                             | Every dependency is named by requirement ID rather than by assumed signature. Re-read this plan against what M1 and M2 actually shipped before starting slice 2                                                   |

---

## Complexity Tracking

No Constitution violations. This section is intentionally empty.
