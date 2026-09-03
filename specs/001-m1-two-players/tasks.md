# Tasks: M1 — Two players moving

**Input**: Design documents from `/specs/001-m1-two-players/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: **Required, not optional.** `vitest.config.ts` enforces 100% on
`shared/protocol/**` and 90% on `server/**` and `client/net/**`; M1 is the milestone that has to
earn all three. Reconciliation and interpolation are written **test-first** without exception —
[research.md § R11](research.md) explains why they were designed as pure functions specifically
so the failing test can exist before there is a socket to attach it to.

**Organization**: Grouped by the four user stories in [spec.md](spec.md), so each is
independently deliverable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable — different files, no dependency on an incomplete task
- **[Story]**: `[US1]` / `[US2]` / `[US3]` / `[US4]`. Setup, Foundational and Polish carry no
  story label

## Path conventions

Three source roots at the repository root — `shared/`, `client/`, `server/` — per
[plan.md § Project Structure](plan.md#project-structure). Tests live **beside their source** as
`*.test.ts`; there is no separate `tests/` tree.

**`shared/sim/step.ts` is not in any task below.** M1 changes the caller, never the callee. A
task that seems to need an edit there is a task that has been designed wrong — see
[spec.md § Out of scope](spec.md#out-of-scope-for-m1).

---

## Phase 1: Setup — two processes, one origin

**Purpose**: Make the topology real before anything depends on it.

**Why first**: M1 is the first milestone with two processes. If the client cannot reach the
server, every later task is written against a guess.

- [x] T001 Add the new constants to `shared/constants/index.ts`: `SERVER_PORT`, `WS_PATH`, `MAX_MALFORMED_MESSAGES`, `RECONCILE_ERROR_DECAY_PER_TICK`, `RECONCILE_ERROR_EPSILON`, `MS_PER_SECOND`, plus the derived `MAX_PENDING_INPUTS` and `SNAPSHOT_BUFFER_SIZE` — computed from existing constants, never written down twice ([data-model.md](data-model.md#new-constants))
- [x] T002 Extend `shared/constants/index.test.ts` to assert the derived values follow from their sources, so a hand-edited literal fails the build
- [x] T003 [P] Add the WebSocket proxy to `vite.config.ts`, importing `SERVER_PORT` and `WS_PATH` from `#shared/constants/index.ts` so the proxy target and the listen port cannot drift ([research.md § R10](research.md))
- [x] T004 [P] Add the `dev:server` script to `package.json` running the server entry point
- [x] T005 Confirm the topology: `npm run build` succeeds with the config import, and the M0 server entry point still runs

**Checkpoint**: the client can reach the server's origin, and every number M1 needs exists in
exactly one file.

---

## Phase 2: Foundational — `shared/protocol`

**Purpose**: The wire, and the `NFR-011` boundary that guards it. Everything in all four stories
depends on this.

**⚠️ BLOCKING**: no user story may begin until this phase is complete.

**Why it is foundational rather than part of User Story 4**: the validator is written _before_
the code that would consume it, not after. M0 established the pattern by writing `validateInput`
when nothing untrusted could reach it yet.

- [x] T006 Create `shared/protocol/types.ts` with every message M1 implements — `JoinMessage`, `InputMessage`, `LeaveMessage`, `JoinedMessage`, `SnapshotMessage`, `SnapshotPlayer`, `PlayerJoinedMessage`, `PlayerLeftMessage`, `ErrorMessage`, `ErrorCode` — per [data-model.md](data-model.md#wire-types--sharedprotocol). **No inbound type may carry health, position, velocity, score or kill status** (`NET-007`)
- [x] T007 Create `shared/protocol/keys.ts`: the nine named `NET-004` bits and `inputFromKeys(keys, dir)` — the **single** implementation of what a bitmask means, called by both the client's prediction and the server's tick ([research.md § R4](research.md))
- [x] T008 Create `shared/protocol/keys.test.ts`: opposing bits cancel, diagonals are normalised so `W`+`A` is not faster than `W`, and bits 128/256 are accepted and ignored (`NET-004b`)
- [x] T009 Rewrite `client/input/keys.ts` to produce the **bitmask** from held `KeyboardEvent.code`s, deleting `movementFrom`/`inputFrom`; update `client/input/keys.test.ts` to match. The client must predict from the bitmask it is about to send, never from the key set it sampled
- [x] T010 Create `shared/protocol/validate.ts`: `parseClientMessage` and `parseServerMessage`, returning `null` rather than throwing, per [contracts/protocol-api.md](contracts/protocol-api.md) P1–P7. `dir` is **clamped** into the pitch cone and renormalised; a `dir` with no horizontal component is rejected ([research.md § R8](research.md))
- [x] T011 Create `shared/protocol/validate.test.ts` covering every rejection path: non-objects, arrays, unknown `t`, extra fields, missing fields, non-integer or non-positive `seq`, `keys` outside `0..511`, non-finite `dir`, `dir` off unit length by more than `AIM_EPSILON`, `dir` straight up and straight down, nicknames failing `FR-GP-008`, `mode` outside the union — `shared/protocol` is at 100%, so an untested branch fails the build
- [x] T012 [P] Create `shared/protocol/encode.ts`: `JSON.stringify` with **no rounding**, and a comment recording that rounding would trade `NFR-003`'s bit-identity for bandwidth `NET-022` has already declared to be within budget
- [x] T013 [P] Add `shared/protocol/encode.test.ts` asserting a double survives the round trip bit-for-bit — the property reconciliation depends on
- [x] T014 Confirm `shared/boundary.test.ts` and `shared/no-literals.test.ts` still pass over the new `shared/protocol` directory, and that ESLint's `shared/**` rules apply to it unchanged

**Checkpoint**: both runtimes can speak the protocol, no malformed value can cross it, and there
is exactly one implementation of what a key means.

---

## Phase 3: User Story 1 — see another player move (P1) 🎯 MVP

**Goal**: Two browsers, one server, two capsules moving smoothly.

**Independent Test**: two windows against one server process. No prediction, no scoring, no UI.
If both capsules move continuously, the milestone's core is delivered.

### Tests for User Story 1 ⚠️ write first, confirm they fail

- [x] T015 [P] [US1] Create `client/net/interpolation.test.ts` for `sample()`: interpolation between the two entries bracketing the render time, a dry buffer holding the newest state rather than extrapolating (I3), a player absent from the newer entry not being interpolated toward anything (I4), and a player seen for the first time being rendered at their first known state rather than sliding in from the origin (I5)
- [x] T016 [P] [US1] Add buffer tests to `client/net/interpolation.test.ts` for `push()`: a snapshot whose `tick` is not newer than the newest held is discarded (I2), and the buffer never exceeds `SNAPSHOT_BUFFER_SIZE` (I6)
- [x] T017 [P] [US1] Create `server/net/ws/frame.test.ts`: masked client frames decode, server frames encode unmasked, a truncated buffer yields no frame rather than throwing, control frames are recognised, and a payload above `MAX_MESSAGE_BYTES` is refused **before** being decoded
- [x] T018 [P] [US1] Create `server/room/room.test.ts` driven by a fake transport: `tick()` advances every player by exactly one `step()` (R1), an empty queue yields a neutral input rather than a repeat of the last one (R4), and every living player appears in every snapshot regardless of position (R10, `NET-009a`)
- [x] T019 [P] [US1] Create `server/room/loop.test.ts` with an injected clock and scheduler: the tick interval is constant over simulated time, independent of how long `onTick` takes, and a stall does not queue unbounded catch-up ticks (L1–L4)

### Implementation for User Story 1

- [x] T020 [US1] Create `server/net/transport.ts`: the `Transport` and `Connection` interfaces from [contracts/netcode-api.md](contracts/netcode-api.md) — the seam that makes `OQ-B` reversible
- [x] T021 [US1] Create `server/net/ws/handshake.ts`: `Sec-WebSocket-Accept` as `base64(sha1(key + GUID))` via `node:crypto`, and the 101 response headers
- [x] T022 [US1] Create `server/net/ws/frame.ts`: RFC 6455 encode and decode as **pure functions** over `Buffer`, handling masked client frames, continuation frames, close and ping, and refusing anything above `MAX_MESSAGE_BYTES` before decoding it
- [x] T023 [US1] Create `server/net/ws/server.ts`: `Transport` over `node:http`, upgrading only on `WS_PATH` and rejecting every other upgrade
- [x] T024 [US1] Create `server/room/serialise.ts`: `PlayerState` → `SnapshotPlayer`, deriving `y`/`pt` from the player's last validated `dir`. **This conversion lives here and never in `shared/`** — it needs `Math.atan2`, which ADR-0001 bans from the simulation, and nothing integrates its result ([research.md § R7](research.md))
- [x] T025 [US1] Create `server/room/room.ts`: the player table, `join`/`leave`/`enqueue`/`tick`, one `step()` per player per tick, the `MAX_QUEUED_INPUTS` cap dropping the oldest (`NET-004a`), and per-recipient snapshot serialisation because `ack` differs per client (R9)
- [x] T026 [US1] Create `server/room/loop.ts`: the fixed tick with an injected clock and scheduler, drift corrected against the clock rather than accumulated by a naive interval, and the catch-up cap M0 established for the client
- [x] T027 [US1] Rewrite `server/index.ts`: bootstrap the HTTP server, the WebSocket transport, one room loaded from `assets/maps/arena-01.json`, and the tick loop. The M0 `describeRuntime` probe goes — its job was to prove `shared/` resolves under Node, and the server now does that by working
- [x] T028 [US1] Create `client/net/interpolation.ts`: the snapshot buffer and `sample(buffer, renderTimeMs)` as **pure functions**, sampled at `now - INTERPOLATION_DELAY` by the caller so nothing here reads a clock (I7)
- [x] T029 [US1] Create `client/net/socket.ts`: the `WebSocket` shell — connect to the page's own origin at `WS_PATH`, parse every inbound message through `shared/protocol`, and call into tested modules. **It must hold no rule**; that is the only reason it may be excluded from coverage
- [x] T030 [P] [US1] Create `client/render/remote.ts`: remote capsules created and destroyed by player id, drawn from interpolated state
- [x] T031 [US1] Rewire `client/boot/main.ts`: connect, send `join`, drive remote capsules from the interpolation buffer. Local movement still runs M0's local loop at this point — prediction is User Story 2
- [x] T032 [US1] Add the coverage exclusion for `client/net/socket.ts` to `vitest.config.ts`, in the same change as T029, with a comment naming what was extracted out of it — the M0 precedent for `client/input/pointer-lock.ts`

**Checkpoint**: `M1-1`, `M1-10` and `M1-11` are demonstrable. Two capsules move. **Stop and
validate before Phase 4.**

---

## Phase 4: User Story 2 — move without waiting for the server (P2)

**Goal**: The local player responds on the frame the key is pressed, and server corrections are
absorbed rather than shown.

**Independent Test**: one browser with injected latency. Local movement instant, remote view
late.

### Tests for User Story 2 ⚠️ write first, confirm they fail

- [x] T033 [P] [US2] Create `client/net/prediction.test.ts` with the **zero-error** test first (C4): given the same inputs the server applied, `reconcile()` returns a state identical to the prediction and an `error` of exactly zero — asserted as equality, not closeness, because `NFR-003` makes it exact
- [x] T034 [P] [US2] Add the reconciliation tests to `client/net/prediction.test.ts`: inputs with `seq <= ack` are dropped, the remainder replay **in order**, the returned state is the server's replayed rather than blended (C3), and an injected correction produces a non-zero `error` that is not fed back into the next prediction (C5)
- [x] T035 [P] [US2] Add the buffer-cap test to `client/net/prediction.test.ts`: with no snapshot arriving, the pending buffer stops at `MAX_PENDING_INPUTS` dropping oldest first (C7)
- [x] T036 [P] [US2] Create `shared/protocol/determinism.test.ts`: a recorded input sequence encoded to `NET-004` messages, decoded through `parseClientMessage` and `inputFromKeys`, and stepped — asserting the result is identical to stepping the same inputs directly. This is the `NFR-003` test that would catch the bitmask being decoded two different ways (`M1-3`)

### Implementation for User Story 2

- [x] T037 [US2] Create `client/net/prediction.ts`: `predict` (which is `step`, named for the call site), `reconcile` returning `{ state, pending, error }`, and the pending buffer — all pure over their arguments (C1–C7)
- [x] T038 [US2] Add the render-side error decay to `client/net/prediction.ts`: multiply by `RECONCILE_ERROR_DECAY_PER_TICK` **per simulation tick**, so it is frame-rate independent without `Math.pow`, and zero it below `RECONCILE_ERROR_EPSILON`
- [x] T039 [US2] Send `input` from `client/boot/main.ts` — **one message per simulation tick**, not per rendered frame, per [research.md § R3](research.md) and gate `OQ-A`. `seq` increments once per `step()` call
- [x] T040 [US2] Drive local movement from `client/net/prediction.ts` in `client/boot/main.ts`, replacing M0's local-only loop, and add the render error offset to the drawn position only — never to the simulated state
- [x] T041 [US2] Enforce `seq` monotonicity per connection in `server/net/connection.ts`: an input whose `seq` is not strictly greater than the last accepted is dropped, so a replayed input cannot be simulated twice

**Checkpoint**: `M1-3`, `M1-4` and `M1-5` hold. Movement is instant and corrections are invisible.

---

## Phase 5: User Story 3 — join and leave without breaking the match (P3)

**Goal**: Arrivals are announced, departures are complete, and nothing accumulates.

**Independent Test**: open and close a second window ten times. No ghosts, no growth.

### Tests for User Story 3 ⚠️ write first, confirm they fail

- [x] T042 [P] [US3] Add lifecycle tests to `server/room/room.test.ts`: `playerJoined` reaches everyone already in the room, `playerLeft` reaches everyone on close **and** on `leave` (`NET-006`), the `MAX_PLAYERS_PER_ROOM`+1-th join is refused with `ROOM_FULL` and never enters the simulation (`FR-GP-013`), a second `join` on one socket is an `error` rather than a second player (`NET-003`), and a player joining mid-match appears in the next snapshot (`FR-GP-014`)
- [x] T043 [P] [US3] Add the ghost test to `server/room/room.test.ts`: after `leave`, the player is absent from the next snapshot and from the room's own state — no orphaned input queue, no reserved slot (`FR-GP-040`, `D-009`)
- [x] T044 [P] [US3] Add the room isolation test to `server/room/room.test.ts`: an exception raised inside one player's step removes that player with `INTERNAL` and leaves the room ticking; a second room in the same process is unaffected (`NFR-015`, R7)

### Implementation for User Story 3

- [x] T045 [US3] Create `server/net/connection.ts`: per-socket state — `hasJoined`, the assigned player id, the last accepted `seq` — kept **separate from the player** so a socket closing cannot leave a half-removed player inside a running tick
- [x] T046 [US3] Implement the join path in `server/room/room.ts` and `server/index.ts`: validate, assign an id, reply `joined` with the map id, tick rate, `NET-008a` config and the spawn transform, then broadcast `playerJoined` (`NET-008`, `NET-010`)
- [x] T047 [US3] Implement the leave path: socket close and `leave` follow the identical code path, removing the player and broadcasting `playerLeft` within one tick (`NET-006`, `NET-011`, `FR-GP-040`)
- [x] T048 [US3] Wrap each player's step in `server/room/room.ts` so an exception removes that player rather than stopping the room, and the room's tick never throws out of the loop (`NFR-015`)
- [x] T049 [US3] Handle `playerLeft` in `client/net/socket.ts` and `client/render/remote.ts`: remove the capsule **and the interpolation state**. The second half is the half that gets forgotten and is exactly what produces the ghost
- [x] T050 [US3] Close a socket that never sends `join` rather than leaking it, and show a readable message on socket close in `client/boot/main.ts` — `NFR-013` only; the designed "Disconnected" screen is `FR-UI-013` in M5

**Checkpoint**: `M1-6` and `M1-12` hold.

---

## Phase 6: User Story 4 — survive a hostile client (P4)

**Goal**: Garbage, floods and forged values reach nothing and cost no one else anything.

**Independent Test**: a test client that sends garbage while another player keeps moving.

### Tests for User Story 4 ⚠️ write first, confirm they fail

- [x] T051 [P] [US4] Create `server/net/rate-limit.test.ts`: the token bucket refills at `MAX_INPUTS_PER_SECOND`, a burst inside the budget passes, a flood is refused, and every assertion runs over an **injected** `nowMs` rather than a real second
- [x] T052 [P] [US4] Create `server/net/connection.test.ts`: a malformed message is discarded and answered with `MALFORMED`, the counter is **not** reset by an intervening valid message, and the connection is closed at `MAX_MALFORMED_MESSAGES` (`NFR-011`)
- [x] T053 [P] [US4] Add the authority test to `shared/protocol/validate.test.ts`: no parsed client message exposes a field that could set position, velocity, health, score or kill status — the type-level statement of `NET-007` (`M1-9`)

### Implementation for User Story 4

- [x] T054 [US4] Create `server/net/rate-limit.ts`: a token bucket of capacity `MAX_INPUTS_PER_SECOND`, refilled per `MS_PER_SECOND`, as a pure function of `(state, nowMs)` ([research.md § R9](research.md))
- [x] T055 [US4] Enforce `MAX_MESSAGE_BYTES` on the raw frame in `server/net/ws/server.ts`, **before** parsing — which is also what keeps the hand-rolled codec small
- [x] T056 [US4] Wire rate limiting and the malformed counter into `server/net/connection.ts`: dropped inputs cost the sender one `RATE_LIMITED` error, not one per message, and repetition closes the socket
- [x] T057 [US4] Handle `error` in `client/net/socket.ts` by branching on `code`, never on `message` text (`NET-020`)

**Checkpoint**: `M1-7`, `M1-8` and `M1-9` hold. All four stories are independently functional.

---

## Phase 7: Polish & cross-cutting

- [x] T058 [P] Create `server/integration.test.ts`: two clients connect over a **real** socket using Node's global `WebSocket`, both join, each appears in the other's snapshot, one disconnects and vanishes from the other's next snapshot. Slow, few, and the only test that catches a wiring mistake every unit test would miss
- [x] T059 [P] Verify `M1-2` as a review step: the diff against `main` for `shared/sim/step.ts` is empty. It is a review step, not a test — a test asserting a file's contents would be a test of version control
- [x] T060 Run `npm run verify` and confirm `shared/protocol` reports 100%, `server/**` 90% and `client/net/**` 90%, with **no threshold relaxed and no exclusion added** beyond T032's
- [ ] T061 Walk every manual check in [quickstart.md](quickstart.md) — `M1-1`, `M1-4`, `M1-5`, `M1-6` and the `NFR-013` check
- [ ] T062 Confirm all fourteen criteria in [spec.md § Success Criteria](spec.md#success-criteria) hold, then hand `OQ-A` and `OQ-B` to the project owner for a ruling before `v0.2.0` is tagged

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1 (Setup)** — no dependencies. T001 → T002 sequential; T003/T004 parallel; T005 gates the phase.
- **Phase 2 (Foundational)** — depends on Phase 1 for the constants. **Blocks all four stories.**
- **Phase 3 (US1)** — depends on Phase 2 only.
- **Phase 4 (US2)** — depends on Phase 2, and on T025/T029 existing to send inputs into and receive `ack` from.
- **Phase 5 (US3)** — depends on Phase 3's room and socket.
- **Phase 6 (US4)** — depends on Phase 5's `connection.ts`.
- **Phase 7 (Polish)** — depends on all four stories.

### Within Phase 2

T006 first: every other file imports the types. T007 → T008 → T009 in that order, because T009
deletes the code T007 replaces and the test must exist before the deletion. T010 → T011 are
sequential; T012 → T013 are an independent pair.

### Within each story

Tests are written first and must fail. Then: transport → room → client → render.

### Parallel opportunities

- **Phase 1**: T003 and T004 together.
- **Phase 2**: the `keys` chain (T007–T009), the `validate` chain (T010–T011) and the `encode`
  pair (T012–T013) are three tracks once T006 lands.
- **Phase 3**: all five test tasks (T015–T019) together; then T020–T023 (transport) and
  T024–T026 (room) are two tracks; T030 parallel with either.
- **Phase 4**: T033–T036 together.
- **Phase 5**: T042–T044 together.
- **Phase 6**: T051–T053 together.

### The hard serialisations

- `client/boot/main.ts` is touched by T031, T039, T040 and T050. Those four cannot be
  parallelised with each other.
- `server/room/room.ts` is touched by T025, T046, T047 and T048.
- `server/net/connection.ts` is touched by T041, T045 and T056.

---

## Implementation strategy

### MVP first

1. Phase 1 — the topology.
2. Phase 2 — the protocol and its boundary.
3. Phase 3 — User Story 1.
4. **Stop and validate.** At this point two browsers see each other move, which is the demo
   criterion, and everything after it makes that correct rather than merely existing.

### Write the two hard modules test-first, without exception

`client/net/prediction.ts` and `client/net/interpolation.ts` are where the hard bugs live, and
both fail quietly: prediction that is subtly wrong looks like network jitter, and interpolation
that is subtly wrong looks like a slow computer. Both were designed as pure functions over
explicit arguments for exactly this reason — the failing test can be written before a socket
exists.

The first test to write is T033, the zero-error case. If it ever fails, the cause is not in
`prediction.ts`; it is two implementations of movement, and `NFR-003` has already been broken
somewhere upstream.

### Do not reorder to see a second capsule sooner

Phase 2 and tasks T015–T019 produce nothing visible. The visible task is T030, and it is nine
tasks after the tests that make it correct.

### Incremental delivery

Each phase ends green — `npm run verify` passes at every checkpoint, and each commit cites its
requirement IDs in the body per [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Deviations from the design documents, deliberate

Recorded here rather than discovered in review:

> **`keysFromHeld` stays in `client/input/keys.ts`.**
> [contracts/protocol-api.md](contracts/protocol-api.md) sketches it alongside `inputFromKeys` in
> `shared/protocol/keys.ts`. It is split instead: the `KeyboardEvent.code` → bit mapping is a
> browser concern and belongs in `client/input`, while the bit → `PlayerInput` decoding is the
> part `NFR-003` requires both runtimes to share. Only the second half needs to be in `shared/`,
> and putting a table of browser key codes there would blur a boundary the whole project depends
> on staying sharp.

> **The room's exception handling is written in User Story 3, not deferred to Polish.**
> `NFR-015` is about the shape of the code, not a promise about it. Wrapping a loop in a `try`
> after the fact means auditing everything the loop touched.

> **`reconcile` takes the current predicted state as its first argument.**
> [contracts/netcode-api.md](contracts/netcode-api.md) sketches
> `reconcile(pending, authoritative, ack, map)` and computes the render error from "the
> previously predicted position". That position is not derivable from the buffer — replaying
> it would need the state the buffer _started_ from, which the caller holds and the function
> does not. Passing it in keeps `reconcile` a pure function of what the caller actually has,
> and makes it impossible to hand it a stale prediction by accident.

> **The transport closes its own sockets on shutdown.**
> Not in any task, and found by the integration test hanging for ten seconds. An upgraded
> socket is no longer the HTTP server's business, so `server.close()` waits on it forever and
> the process had no clean shutdown path at all. `Transport.close()` now closes every live
> connection with `CLOSE_GOING_AWAY` first. This is what `NFR-002` means when it says
> restarting the server ends every match — the alternative was a server that could not be
> restarted.

> **`SERVER_PORT` is 8787, not 8080.**
> 8080 was occupied on the first machine this ran on, and the failure mode is a server that
> refuses to start with an `EADDRINUSE` stack trace rather than anything a reader can act on.
