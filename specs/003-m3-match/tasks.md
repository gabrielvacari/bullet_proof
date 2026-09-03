# Tasks: M3 — An actual match

**Input**: Design documents from `/specs/003-m3-match/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

> ## ⛔ Do not start this list yet
>
> Two gates in [plan.md § Blocking gates](plan.md#blocking-gates) are open:
>
> 1. **M1 and M2 must have met their demo criteria.** Constitution Principle V. M3's plan may
>    exist now; M3's code may not.
> 2. **[`Q-006`](../../requirements/11-open-questions.md) must be decided by the project owner.**
>    It is marked `Blocks: M3`. Researched with a recommendation in
>    [research.md § R6](research.md#r6--q-006-what-happens-to-an-idle-player-in-the-pointer-lock-released-state--unresolved-blocking);
>    **not** resolved here, because it is a product decision (Principle I).
>
> T001 and T002 are the tasks that close this warning.

**Tests**: **Required, not optional.** `vitest.config.ts` enforces 100% on `shared/protocol` and
90%/85% on `server/**`, and [contracts/nickname-rendering.md](contracts/nickname-rendering.md)
names four tests that must exist. Test tasks are written **before** the implementation they cover
and must fail first.

**Organization**: Grouped by the four user stories in [spec.md](spec.md), so each is independently
deliverable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable — different files, no dependency on an incomplete task
- **[Story]**: `[US1]`–`[US4]`. Setup, Foundational and Polish carry no story label

## Path conventions

Three source roots at the repository root — `shared/`, `client/`, `server/` — per
[plan.md § Project Structure](plan.md#project-structure). Tests live **beside their source** as
`*.test.ts`; there is no separate `tests/` tree.

---

## Phase 1: Setup — close the gates, then build the `NFR-012` boundary

**Purpose**: Establish that M3 may begin at all, then make the HTML sinks unreachable **before any
surface exists to reach for one**.

**Why this order**: M3 is the first milestone that draws attacker-controlled text in another
player's browser. A lint rule added after the scoreboard is a lint rule someone suppresses rather
than rewrite for. M0 ordered its `shared/` boundary the same way, for the same reason.

- [ ] T001 Confirm M1 and M2 are complete: `v0.2.0` and `v0.3.0` are tagged on `main` and both demo criteria in `requirements/08-roadmap.md` are met. **If either is not, stop here** — Constitution Principle V
- [ ] T002 Confirm [`Q-006`](../../requirements/11-open-questions.md) has been closed by the project owner as a `D-###` in `requirements/10-decision-log.md` and deleted from `requirements/11-open-questions.md`. **If it is still open, stop and ask** — do not guess (Principle I)
- [ ] T003 Re-read [plan.md](plan.md) against the interfaces M1 and M2 actually shipped — the room, the connection, the tick driver, the player state, the `kill` message — and record any divergence in [plan.md](plan.md) before writing code
- [ ] T004 Add the `client/**` HTML-sink ban to `eslint.config.js`: `no-restricted-syntax` on assignment to `innerHTML` and `outerHTML`, and `no-restricted-properties` on `insertAdjacentHTML`, `document.write`, `document.writeln` and `createContextualFragment`, each with a message naming `NFR-012`
- [ ] T005 Prove the ban bites: add a throwaway file under `client/` that assigns `innerHTML`, confirm `npm run lint` **fails**, then delete it
- [ ] T006 Create `client/hud/text.ts` with `setText(el, value)` — assigns `textContent` and nothing else. This is the only sanctioned sink for player-controlled text ([contracts/nickname-rendering.md](contracts/nickname-rendering.md), C1)
- [ ] T007 Create `client/hud/text.test.ts` with the fake-element fixture — `textContent` a plain property, `innerHTML` a **setter that throws** — and assert a hostile string lands verbatim in `textContent` with nothing thrown (contract test T-B, [research.md § R7](research.md#r7--enforcing-nfr-012-mechanically-and-testing-it-without-a-new-dependency))
- [ ] T008 Create `client/no-html-sinks.test.ts` scanning `client/**` source text for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and `createContextualFragment` — catches what the lint rule's syntax matching cannot see, e.g. `el['inner' + 'HTML']`. Mirrors the existing `shared/boundary.test.ts` pattern. Satisfies `M3-10`
- [ ] T009 Confirm `client/hud/text.ts` is **not** matched by any `coverage.exclude` entry in `vitest.config.ts` — the chokepoint must not join the excluded thin DOM shells (contract C5)

**Checkpoint**: the sinks are unreachable and demonstrated so, before a single surface exists.

---

## Phase 2: Foundational — constants and the protocol boundary

**Purpose**: The shared vocabulary and the validation boundary every story depends on.

**⚠️ BLOCKING**: no user story may begin until this phase is complete.

- [ ] T010 Add `ROOM_CODE_ALPHABET` and `ROOM_CODE_MAX_ATTEMPTS` to `shared/constants/index.ts`, and derive `MATCH_DURATION_TICKS`, `POST_MATCH_DURATION_TICKS` and `EMPTY_ROOM_GRACE_TICKS` with `Math.ceil` — never written down ([data-model.md § New constants](data-model.md#new-constants))
- [ ] T011 [P] Extend `shared/constants/index.test.ts`: assert `ROOM_CODE_ALPHABET` contains none of `0 O 1 I L`, has 31 characters, and that each derived tick count equals `Math.ceil(duration / TICK_DURATION_MS)`
- [ ] T012 Raise the two new constants with the project owner for addition to `requirements/07-constants.md` per [plan.md § Implications](plan.md#implications-for-requirements) — **do not edit the file from a spec**
- [ ] T013 [P] Add `GameMode`, `Team`, `MatchPhase`, `EndReason` and `WinnerKind` to `shared/protocol/types.ts` per [data-model.md § Shared vocabulary](data-model.md#shared-vocabulary) — no `SPECTATOR`, no `WAITING`, no third team
- [ ] T014 Add the M3 message payload types to `shared/protocol/types.ts`: `join`'s `mode`/`roomCode`, `joined`, `score` (`NET-017`), `matchStart` (`NET-019`), `matchEnd` (`NET-018`), and the snapshot's `match` block (`NET-009`) — shapes exactly as `requirements/06-network-protocol.md` specifies them
- [ ] T015 Create `shared/protocol/validate.test.ts` cases for `join` **first**: nickname too short, too long, wrong charset, non-string; `mode` not `FFA`/`TDM`; `roomCode` of wrong length, containing an excluded glyph, or non-string; a second `join` on one socket. Each maps to the error code in [data-model.md](data-model.md#inbound-validation--join-net-003)
- [ ] T016 Implement `validateJoin` in `shared/protocol/validate.ts`: nickname length counted in **code points**, charset as a **whitelist**, `roomCode` upper-cased before validation and lookup, returning a discriminated result rather than throwing (`NFR-011`, `FR-GP-008`, `FR-GP-012`)
- [ ] T017 Add the markup cases to `shared/protocol/validate.test.ts`: `<script>alert(1)</script>` and `"><img src=x onerror=alert(1)>` are rejected with `INVALID_NICKNAME` (contract test T-A)
- [ ] T018 Confirm `shared/protocol/**` reports 100% coverage with every rejection branch exercised — `npm run test:coverage`

**Checkpoint**: the security boundary exists, is validated, and is fully covered.

---

## Phase 3: User Story 1 — a match that starts, ends, and starts again (P1) 🎯 MVP

**Goal**: A clock, both end conditions, scoring, a result, a results screen, and an automatic
restart — in one room.

**Independent Test**: two browsers in a single room, FFA, with {MATCH_DURATION} and
{FRAG_LIMIT_FFA} shortened per [quickstart.md](quickstart.md). Delivering only this story already
demonstrates the demo criterion.

### Tests for User Story 1 ⚠️ write first, confirm they fail

- [ ] T019 [P] [US1] Create `server/room/match.test.ts`: the clock reaches zero after exactly `MATCH_DURATION_TICKS` calls to `tick()`, with no fake timers and no wall clock (`FR-GP-043`, [research.md § R4](research.md#r4--what-drives-the-match-clock))
- [ ] T020 [P] [US1] Add end-condition cases to `server/room/match.test.ts`: the clock expiring ends with reason `TIME`; a player reaching {FRAG_LIMIT_FFA} ends with reason `FRAG_LIMIT`; **both holding in the same tick emits exactly one `matchEnd`** (`M3-2`, guarantee G4)
- [ ] T021 [P] [US1] Add the restart case to `server/room/match.test.ts`: after `POST_MATCH_DURATION_TICKS` the phase returns to `PLAYING`, scores are zero, every player is respawned, and **every player ID and socket is unchanged** (`FR-GP-045`, `M3-1`, guarantee G5)
- [ ] T022 [P] [US1] Create `server/room/scoring.test.ts`: a kill awards exactly 1 point to the killer and leaves the victim's score unchanged; standings sort by kills descending; level scores produce a `DRAW` with no winner id (`FR-GP-041`, `FR-GP-044`, `M3-3`)
- [ ] T023 [P] [US1] Add the leaver case to `server/room/scoring.test.ts`: removing a player removes their score in the same operation and standings recompute with no ghost row (`FR-GP-040`, `M3-15`)

### Implementation for User Story 1

- [ ] T024 [US1] Create `server/room/match.ts` with `MatchState` per [data-model.md](data-model.md#matchstate): `phase`, `elapsedTicks`, `teamScores`, `endReason`, `winner`. `timeLeftMs` and `fragLimit` are **derived getters**, never stored fields
- [ ] T025 [US1] Add the match tick to `server/room/match.ts`: advance `elapsedTicks` while `PLAYING`, evaluate both end conditions, and guard the transition **on the phase** so the match can end only once regardless of check order
- [ ] T026 [US1] Add the restart transition to `server/room/match.ts`: after {POST_MATCH_DURATION}, reset `elapsedTicks` and all scores, respawn everyone, return to `PLAYING`, and emit `matchStart` (`NET-019`)
- [ ] T027 [US1] Create `server/room/scoring.ts`: per-player kills and deaths held on `RoomPlayer`, standings computed on demand, and a winner resolver that returns `DRAW` on a tie rather than taking the first sorted row (`FR-GP-044`)
- [ ] T028 [US1] Wire the M2 `kill` event into `server/room/scoring.ts` and emit `score` (`NET-017`) on every kill and on every join — **not** in the snapshot (`NET-009b`)
- [ ] T029 [US1] Add the `match` block (`timeLeftMs`, `phase`) to the snapshot builder wherever M1 assembles `NET-009`
- [ ] T030 [US1] Emit `matchEnd` (`NET-018`) with `reason`, `winner`, `standings` and `nextMatchInMs` from `server/room/match.ts`; ignore inputs while in the post-match phase without disabling rate limiting (`NFR-010`)
- [ ] T031 [P] [US1] Create `client/hud/match-status.ts`: remaining time and score relative to the frag limit, **overwritten by every snapshot**, optionally interpolated downward between them but never free-running (`FR-UI-011`, `M3-13`)
- [ ] T032 [P] [US1] Create `client/hud/results.ts`: the results overlay with standings, the winner or a draw, and the countdown — every nickname rendered through `setText` from T006 (`FR-UI-004`)
- [ ] T033 [US1] Handle `matchEnd` and `matchStart` in `client/net`: show and hide the results overlay, reset local match state, and never conclude locally that the match has ended
- [ ] T034 [US1] Add a full-lifecycle test to `server/room/match.test.ts` driving a room through match → end → results → restart → match with a fake socket, asserting the emitted message sequence — this is `M3-1` in automated form

**Checkpoint**: `M3-1`, `M3-2`, `M3-3` and `M3-15` are demonstrable. **This is the MVP — stop and
validate before Phase 4.**

---

## Phase 4: User Story 2 — two teams, no friendly fire (P2)

**Goal**: TDM: server-side team assignment, team scoring, team spawns, and bullets that pass
through teammates.

**Independent Test**: three browsers in one TDM room. Fire at a teammate point-blank, then at an
enemy standing directly behind one.

### Tests for User Story 2 ⚠️ write first, confirm they fail

- [ ] T035 [P] [US2] Create `server/room/teams.test.ts`: joining players one at a time never leaves team sizes differing by more than 1, counting living and dead alike; a tie is broken by the **injected** random source, asserted with a scripted stub (`FR-GP-004`, `M3-4`, [research.md § R5](research.md#r5--where-does-randomness-live))
- [ ] T036 [P] [US2] Add the no-setter case to `server/room/teams.test.ts` and to the protocol tests: no message type, handler, or public method assigns a team after join (`FR-GP-004`, `NET-007`, contract P2)
- [ ] T037 [P] [US2] Add friendly-fire cases to M2's raycast test file: a shot at a teammate at point-blank deals no damage, produces no hit marker, no `damage`, no `kill`; **and a shot at an enemy standing directly behind a teammate hits the enemy** (`FR-GP-005`, `FR-GP-025`, `M3-5`)
- [ ] T038 [P] [US2] Add TDM cases to `server/room/scoring.test.ts`: a kill increments both the killer's score and their team total; a team reaching {FRAG_LIMIT_TDM} ends the match; level team scores produce a `DRAW` (`FR-GP-041`, `FR-GP-043`, `FR-GP-044`)

### Implementation for User Story 2

- [ ] T039 [US2] Create `server/room/teams.ts`: assign a joining TDM player to the smaller team, breaking ties through `options.random`; assignment happens once and has no setter reachable from the network (`FR-GP-004`)
- [ ] T040 [US2] Add team totals to `server/room/scoring.ts` and include `teams` in `score` (`NET-017`) in TDM only — **omitted entirely in FFA**, per `FR-GP-006`
- [ ] T041 [US2] Add the TDM frag limit to `server/room/match.ts`, selecting {FRAG_LIMIT_TDM} or {FRAG_LIMIT_FFA} by mode as a derived value, never a second literal (`SC-4`)
- [ ] T042 [US2] Exclude teammates from the hit raycast in M2's cast — **excluded from the cast entirely, not zero-damage** — using the team data this story introduces (`FR-GP-005`)
- [ ] T043 [US2] Add `BLUE` and `RED` spawn clusters at opposite ends of `assets/maps/arena-01.json`, with at least {MIN_SPAWN_POINTS} spawns in total; `ANY` spawns remain for FFA and are unused in TDM (`FR-MAP-007`, `FR-MAP-008`)
- [ ] T044 [US2] Filter spawn candidates by the player's team in M2's spawn selection so `FR-GP-038` picks among team-valid spawns only
- [ ] T045 [P] [US2] Colour the local player's teammates in `client/render` and the HUD by team in TDM, and **show no team colour at all in FFA** (`FR-GP-006`) — capsule primitives, no models (`D-011`)

**Checkpoint**: `M3-4` and `M3-5` hold, and both modes produce a complete match.

---

## Phase 5: User Story 3 — get from a cold page into a match (P3)

**Goal**: The start screen, auto-match, private room codes, capacity, and many rooms in one
process.

**Independent Test**: one browser and a cold page — click Play with nobody else online; then create
a private room from a second browser and join it from a third.

### Tests for User Story 3 ⚠️ write first, confirm they fail

- [ ] T046 [P] [US3] Create `server/matchmaker/code.test.ts`: generated codes are {ROOM_CODE_LENGTH} characters from `ROOM_CODE_ALPHABET` and contain none of `0 O 1 I L`; a collision retries; exhausting `ROOM_CODE_MAX_ATTEMPTS` rejects rather than looping (`FR-GP-012`, [research.md § R3](research.md#r3--room-code-generation))
- [ ] T047 [P] [US3] Create `server/matchmaker/registry.test.ts`: auto-match picks the **fullest** public room of the requested mode with space, creates one when none qualifies, never returns a private room, and treats a room in `POST_MATCH` as a valid candidate (`FR-GP-010`, `FR-GP-011`, `FR-GP-045`)
- [ ] T048 [P] [US3] Add lookup cases to `server/matchmaker/registry.test.ts`: a code resolves in any letter case; an unknown code returns `ROOM_NOT_FOUND`; a destroyed room's code is released and no longer resolves (`FR-GP-012`, `FR-GP-046`, `M3-7`, `M3-8`)
- [ ] T049 [P] [US3] Create `server/room/room.test.ts`: the {MAX_PLAYERS_PER_ROOM}+1-th join receives `ROOM_FULL` and **no `playerJoined` is broadcast** — capacity is refused before the player is added to anything (`FR-GP-013`, `M3-8`)
- [ ] T050 [P] [US3] Add lifecycle cases to `server/room/room.test.ts`: a room emptying records the tick, refilling clears it, and staying empty for {EMPTY_ROOM_GRACE_PERIOD} destroys it with **no further ticks and no surviving timer** (`FR-GP-046`, guarantee G7)
- [ ] T051 [P] [US3] Create `server/scheduler.test.ts`: with two rooms registered, one throwing from `tick()`, the healthy room still advances and the throwing room is destroyed with `INTERNAL`; no broadcast crosses between rooms (`NFR-015`, `M3-11`, guarantee G8)

### Implementation for User Story 3

- [ ] T052 [US3] Create `server/matchmaker/code.ts`: draw {ROOM_CODE_LENGTH} characters using `crypto.randomInt` — **not** `Math.random() % 31`, which is biased against the tail of a 31-character alphabet — retrying on collision up to `ROOM_CODE_MAX_ATTEMPTS`
- [ ] T053 [US3] Create `server/matchmaker/registry.ts`: rooms indexed by id and by code, `autoMatch(mode)` selecting the fullest qualifying public room, `createPrivate(mode)`, and `byCode` upper-casing and performing **no** glyph substitution ([contracts/room-lifecycle.md](contracts/room-lifecycle.md))
- [ ] T054 [US3] Create `server/room/room.ts` per [contracts/room-lifecycle.md](contracts/room-lifecycle.md): `tick()`, `join()`, `leave()`, `destroy()`, `isEmpty`, `canAccept`. The room **does not own its clock** (guarantee G1) and takes its random source by injection (G6)
- [ ] T055 [US3] Create `server/scheduler.ts`: one timer at {SERVER_TICK_HZ} iterating every registered room with each `tick()` wrapped in its own `try`/`catch`; on a throw, log and destroy that room with `error` `INTERNAL` ([research.md § R1](research.md#r1--how-does-one-process-run-many-rooms))
- [ ] T056 [US3] Route `join` in `server/net`: no code → auto-match; `"NEW"` → create private; a code → look up, then capacity — emitting `INVALID_NICKNAME`, `INVALID_MODE`, `ROOM_NOT_FOUND` or `ROOM_FULL` as appropriate (`NET-003`, `NET-020`)
- [ ] T057 [US3] Update `server/index.ts` to bootstrap the registry and the scheduler in place of M1's single hardcoded room, keeping `NFR-002`'s one-process model
- [ ] T058 [US3] Create `client/boot/start-screen.ts`: nickname field, FFA/TDM selector, Play, "create private room", and "join with code" — **and nothing else** (`FR-UI-001`). Play is disabled until the nickname passes the same shared validator the server uses (`FR-GP-007`, `FR-GP-008`)
- [ ] T059 [US3] Handle `joined` and `error` in `client/net`: enter the arena on success; on error branch on `code`, never on `message` text, and render the message through `setText` (`NET-020`, contract C4)

**Checkpoint**: `M3-6`, `M3-7`, `M3-8` and `M3-11` hold. A stranger can reach the arena from a cold
page — `SC-1`.

---

## Phase 6: User Story 4 — see who is winning and who killed whom (P4)

**Goal**: The scoreboard and the kill feed, both rendering attacker-controlled text safely.

**Independent Test**: three browsers in one room. Hold `Tab` during a firefight; confirm the match
runs behind the overlay and entries expire on their own.

### Tests for User Story 4 ⚠️ write first, confirm they fail

- [ ] T060 [P] [US4] Create `client/net/roster.test.ts`: the roster builds from `playerJoined`/`playerLeft`/`score`; `playerLeft` removes the row entirely; a duplicated nickname produces a suffix derived from the **player ID**, never from join order, so two clients that joined at different times agree (`FR-GP-009`, `NET-011`, [research.md § R9](research.md#r9--how-the-client-knows-who-anyone-is))
- [ ] T061 [P] [US4] Create `client/hud/kill-feed.test.ts`: entries expire after {KILL_FEED_ENTRY_TTL}, at most {KILL_FEED_MAX_ENTRIES} render, and the feed is cleared on `matchStart` (`FR-UI-009`)
- [ ] T062 [P] [US4] Extend `client/hud/text.test.ts` with the bypass fixture applied to the scoreboard row, the kill feed entry and the results standing — hostile strings handed **directly** to each surface with the validator out of the call path (contract test T-B, `M3-9`)
- [ ] T063 [P] [US4] Add the layout case: a {NICKNAME_MAX_LENGTH}-character nickname renders in all three surfaces without overflow (contract test T-D)

### Implementation for User Story 4

- [ ] T064 [US4] Create `client/net/roster.ts`: player id → nickname, team, kills, deaths, maintained from `joined`, `playerJoined`, `playerLeft` and `score`; display names derived, never stored (`NET-009b`, `NET-010`, `NET-011`, `NET-017`)
- [ ] T065 [US4] Create `client/hud/scoreboard.ts`: shown while `Tab` is held, sorted by kills descending, grouped by team with team totals in TDM, and readable while the match runs behind it (`FR-UI-010`)
- [ ] T066 [US4] Create `client/hud/kill-feed.ts`: `<killer> killed <victim>` entries from `NET-015` with TTL and entry cap, names coloured by team in TDM (`FR-UI-009`)
- [ ] T067 [US4] Confirm every nickname in the scoreboard, kill feed and results screen goes through `setText` — every element built with `document.createElement`, no HTML string anywhere (contract C1, `M3-9`)
- [ ] T068 [US4] Make the scoreboard give way to the results overlay when a match ends while `Tab` is held

**Checkpoint**: all four stories are independently functional and `M3-9` holds.

---

## Phase 7: Polish & cross-cutting

- [ ] T069 Implement the outcome of [`Q-006`](../../requirements/11-open-questions.md) as the project owner decided it in T002. **If the decision was "leave as-is", this task is closed by doing nothing and recording that.** If it was "remove after a period with no input", add the timeout constant to `shared/constants/index.ts` and the idle counter to `server/room/room.ts`, reusing `FR-GP-040`'s removal path. **Do not choose the option yourself**
- [ ] T070 [P] Extend `shared/no-literals.test.ts` coverage to the new constants, and confirm no gameplay literal appears in `server/room/**` — verifies `M3-12` and `SC-4` mechanically rather than by review
- [ ] T071 [P] Raise with the project owner the four items in [plan.md § Implications](plan.md#implications-for-requirements): the two new constants, `NET-009`'s unenumerated `phase`, `FR-GP-046`'s two-milestone ownership, and the `client/hud/**` coverage threshold. **Do not edit `requirements/` or `vitest.config.ts` from a spec**
- [ ] T072 Run `npm run verify` and confirm `shared/protocol` reports 100% and `server/**` meets 90% lines / 85% branches with **no threshold relaxed**
- [ ] T073 Walk every manual check in [quickstart.md](quickstart.md) — `M3-1`, `M3-6`, `M3-7`, `M3-9`'s by-hand half, `M3-13`, and the TDM and kill-feed passes
- [ ] T074 Confirm all fifteen criteria in [spec.md § Success Criteria](spec.md#success-criteria) hold, then hand back to the project owner to tag `v0.4.0`

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1 (Setup)** — T001–T003 are gates and block everything. T004 → T005 are sequential (T005 proves T004). T006 → T007 → T008 are sequential. **T004–T005 must land before any HUD file exists.**
- **Phase 2 (Foundational)** — depends on Phase 1. **Blocks all four stories.**
- **Phase 3 (US1)** — depends on Phase 2 and on M1's room and M2's `kill` event.
- **Phase 4 (US2)** — depends on Phase 2. Touches `server/room/scoring.ts` and `server/room/match.ts` alongside US1, so in practice it follows US1 rather than running beside it. T042 and T044 reach into M2's raycast and spawn selection.
- **Phase 5 (US3)** — depends on Phase 2. Independent of US1 and US2 in code, but the match must exist before there is any point entering one, which is why it is P3 rather than P1.
- **Phase 6 (US4)** — depends on Phase 2 and on T006's sink. Needs US1's `score` handling to have something to display.
- **Phase 7 (Polish)** — depends on all four stories, except T069, which depends only on T002.

### Within Phase 2

T010 → T011 are sequential. T013 → T014 → T015 → T016 → T017 are sequential — the type, then the
failing tests, then the validator, then the adversarial cases. T012 is a conversation, not a code
change, and can happen at any point.

### Within each story

Tests are written first and must fail. Then: state → transitions → emission → client.

### Parallel opportunities

- **Phase 1**: none worth taking. The whole phase is a short chain, and its value is the ordering.
- **Phase 2**: the constants chain (T010–T011) and the protocol chain (T013–T017) are independent tracks.
- **Phase 3**: all five test tasks (T019–T023) together; then T031 and T032 together once the server emits.
- **Phase 4**: T035–T038 together.
- **Phase 5**: T046–T051 together — six independent test files.
- **Phase 6**: T060–T063 together.

### The hard serialisations

- `server/room/match.ts` is touched by T024, T025, T026, T030 and T041. Those five cannot be parallelised with each other regardless of who is available.
- `server/room/scoring.ts` is touched by T027, T028 and T040.
- `client/hud/text.ts` is touched only by T006 — **and that is the point**. One sink, one file, one thing to audit.

---

## Implementation strategy

### MVP first

1. Phase 1 — the gates closed and the `NFR-012` boundary demonstrated.
2. Phase 2 — the protocol boundary, validated and fully covered.
3. Phase 3 — User Story 1.
4. **Stop and validate.** At this point a match runs start to finish and restarts on its own, which
   is the milestone's demo criterion.

### Do not reorder to see the scoreboard sooner

Phases 1 and 2 produce nothing visible, and Phase 3's visible half is a timer and an overlay. The
temptation is to build the scoreboard first, because it is the part that looks like a game.

A scoreboard rendering a match that cannot end is not progress, and — more importantly — building
any surface before T004 lands means the HTML-sink ban arrives as a rewrite request rather than a
constraint. That is precisely how `NFR-012` stops being true without anyone deciding to break it.

### Incremental delivery

Each phase ends green: `npm run verify` passes at every checkpoint, and each commit cites its
requirement IDs in the body per [CONTRIBUTING.md](../../CONTRIBUTING.md).
