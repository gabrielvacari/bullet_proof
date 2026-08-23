# Implementation Plan: M1 — Two players moving

**Branch**: `feat/m1-two-players-moving` (feature dir `001-m1-two-players`) | **Date**: 2026-08-22 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-m1-two-players/spec.md`

---

## Summary

Put a socket between the client and the simulation, and change nothing about the simulation.

M0 delivered `step(state, input, map)` — pure, fixed-timestep, no `dt`, no idea a network
exists — called by an accumulator in `client/boot`. M1 gives it three callers instead of one: a
server tick loop that owns the truth, a client prediction buffer that runs ahead of it, and a
replay pass that reconciles them. `shared/sim/step.ts` is not edited, and `M1-2` verifies that
with `git diff` rather than with a promise.

Phase 0 turned up two questions the requirements do not settle, both recorded in
[spec.md](spec.md#open-questions-raised-by-this-milestone) and carried below as gates: how often
the client sends `input`, and what provides the WebSocket transport when adding a dependency
needs the project owner's approval. Neither blocks the milestone; both have a recommendation, and
both are cheap to reverse.

Everything else follows from `NFR-003`. Because there is exactly one implementation of movement
and JSON round-trips a double without loss, reconciliation needs no tolerance: when both sides
saw the same inputs, replay reproduces the prediction exactly. That single property is what makes
the rest of the design small.

---

## Technical Context

**Language/Version**: TypeScript 5.6, `strict` with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. Target ES2022. Node ≥ 24 — the server runs `.ts` directly via type
stripping, and Node 24's global `WebSocket` client is what the integration tests connect with.

**Primary Dependencies**: unchanged. `three` (client only, banned from `shared/`), `vite`,
`vitest`. **M1 adds none** — see the `OQ-B` gate. `@types/node` resolves transitively through
`vite`; promoting it to an explicit `devDependency` is a dependency change and therefore the
owner's call, noted under Risks.

**Storage**: none. Match state lives in the memory of one process and dies with it (`NFR-002`).
No database (`D-015`), no `localStorage` until M5.

**Testing**: Vitest 3 with v8 coverage. New thresholds bite for the first time this milestone:
`shared/protocol/**` at 100%, `server/**` at 90%, `client/net/**` at 90%. None may be relaxed.

**Target Platform**: desktop Chrome, Firefox, Edge, Safari. Server is one long-lived Node process
(`NFR-002`) — and from this milestone it actually does something.

**Project Type**: real-time multiplayer game. Three source roots sharing one deterministic core.

**Performance Goals**: tick fixed at {SERVER_TICK_HZ}, broadcasts at {SNAPSHOT_HZ}, both
independent of player count and of any client's frame rate (`NFR-005`, `M1-10`). Bandwidth is not
a goal: JSON is within budget and `NET-022`/`NET-023` are DEFERRED.

**Constraints**: server-authoritative (`NFR-001`); every inbound field validated (`NFR-011`);
`shared/` stays pure and free of clocks (`NFR-003`, `NFR-004`); no gameplay literal outside
`shared/constants` (`SC-4`); `shared/sim/step.ts` unchanged.

**Scale/Scope**: one room, up to {MAX_PLAYERS_PER_ROOM} players, roughly 18 new source files.

**Unknowns**: two, both resolved with a recommendation in [research.md](research.md) — R2 (`OQ-B`,
transport) and R3 (`OQ-A`, input rate). Both need the project owner's ruling; neither blocks work,
and each is carried as a gate below.

---

## Constitution Check

_GATE: passed before Phase 0; re-evaluated after Phase 1 design — see the bottom of this section._

| Principle                                   | Gate                                                                        | Verdict                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I — `requirements/` is supreme**          | Does the plan invent a requirement, or build anything `DEFERRED`/`DROPPED`? | **PASS, with two flags.** M1 mints no requirement ID. Nothing `DEFERRED` is built — no lag compensation (`NFR-009`), no binary encoding (`NET-022`), no delta compression (`NET-023`), no reconnection (`D-009`). The two questions the requirements leave open are **recorded, not guessed**: `OQ-A` and `OQ-B` below.            |
| **II — shared, pure, deterministic**        | Is movement still born in `shared/sim`? Is purity still enforced?           | **PASS.** `step()` is not edited (`M1-2`). The one place M1 could have broken this is the `keys` bitmask, which is decoded **once** in `shared/protocol` rather than on each side ([research.md § R4](research.md)). `Math.atan2` for `y`/`pt` stays in `server/`, where the ESLint ban does not apply and no value is integrated. |
| **III — server authoritative**              | Can any inbound message assert an outcome?                                  | **PASS.** The implemented client messages are `join`, `input`, `leave`. None carries position, velocity, health, score or kill status, because `NET-007` gives them no type to travel in. `dir` is clamped rather than trusted (`NET-004c`); `seq` must strictly increase; `dt` has no field to arrive in.                         |
| **IV — every number in `shared/constants`** | Any literal outside it?                                                     | **PASS.** Nine additions, listed in [data-model.md](data-model.md#new-constants) for a human to sync into `07-constants.md`, which this milestone does **not** edit. Three of the nine are derived and computed rather than written down.                                                                                          |
| **V — milestone order**                     | Does the plan pull later work forward?                                      | **PASS.** No shooting, no health, no scoring, no matchmaking, no models. Fields M1 cannot populate honestly (`hp`, `am`, `match`, `team`, `st` bits 4/8/16) are **omitted and tabulated**, not filled with placeholders. `Q-003` is left open for M2.                                                                              |
| **VI — tests are the gate**                 | Are thresholds met without relaxation?                                      | **PASS.** No threshold is lowered. One new coverage exclusion is requested — `client/net/socket.ts` — and only under the condition that every rule has already been extracted out of it, exactly as M0 did for `client/input/aim.ts`. [research.md § R11](research.md) says what happens if a decision ever reappears in it.       |

### Gates for the project owner

Two decisions this milestone could not take on its own. Both proceed on the recommendation, both
are reversible, and neither is silently baked in.

| Gate     | Question                                                                                       | Proceeding on                                                                                                                                                                 | Cost to reverse                                                       |
| -------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **OQ-A** | One `input` per render frame (the Model prose) or per simulation tick (`NET-004a`)?            | **Per simulation tick.** The per-frame reading overflows {MAX_QUEUED_INPUTS} in a third of a second at 60 fps and rubber-bands continuously — [research.md § R3](research.md) | One line in the client; a prose amendment in `06-network-protocol.md` |
| **OQ-B** | What provides the WebSocket transport, when adding `ws` needs approval the flow cannot obtain? | **A hand-rolled RFC 6455 codec on `node:http`**, behind `Transport` — no dependency, and the codec is pure functions                                                          | Replace one directory behind an interface that already exists         |

### Post-design re-evaluation

Re-checked after Phase 1. Three things changed during design, all of them tightening:

1. **The `keys` decoder moved into `shared/protocol`.** The first sketch had `client/input`
   building a `move` vector and the server decoding the bitmask — two implementations of what
   `W`+`A` means, which is `NFR-003` broken on the first diagonal. The client now predicts from
   the bitmask it is about to send, so anything lost in the encoding is lost identically on both
   sides.
2. **`dir` is clamped rather than rejected.** `NET-004c` says clamp; M0's `contracts/sim-api.md`
   said reject. `requirements/` wins (Principle I). Both survive: `shared/protocol` clamps,
   `shared/sim/validate.ts` keeps rejecting as the last line of defence, and no M0 test changes.
   The zero-horizontal edge case — straight up or straight down, where there is no heading to
   preserve — is rejected, and is unreachable for an honest client.
3. **Reconciliation lost its tolerance constant.** The first sketch compared predicted against
   authoritative positions against an epsilon. `NFR-003` plus lossless JSON round-tripping makes
   the difference exactly zero when both sides saw the same inputs, so the constant would have
   had no value to tune and would have hidden genuine desync below its threshold.

**No violations. Complexity Tracking is empty.**

---

## Project Structure

### Documentation (this feature)

```text
specs/001-m1-two-players/
├── spec.md                  # Phase -1: scope, exit criteria M1-1..M1-14, OQ-A and OQ-B
├── plan.md                  # This file
├── research.md              # Phase 0: R1–R11
├── data-model.md            # Phase 1: wire types, server/client state, new constants
├── contracts/
│   ├── protocol-api.md      # shared/protocol — the NFR-011 boundary, P1–P7
│   └── netcode-api.md       # room, loop, prediction, interpolation, transport
├── quickstart.md            # Phase 1: how to validate M1
└── tasks.md                 # Phase 2 — NOT created by /speckit-plan
```

### Source code (repository root)

New files only; everything unlisted is untouched.

```text
shared/
├── constants/index.ts       # MODIFIED: nine additions (data-model.md)
└── protocol/                # NEW — 100% coverage threshold
    ├── types.ts             # every message, client and server (NET-001..NET-020)
    ├── keys.ts              # the bitmask, decoded ONCE for both runtimes
    ├── validate.ts          # parseClientMessage / parseServerMessage — the NFR-011 boundary
    └── encode.ts            # JSON.stringify, with no rounding and a comment saying why

server/
├── index.ts                 # MODIFIED: HTTP + WebSocket bootstrap, one room, the tick loop
├── net/
│   ├── transport.ts         # the Transport / Connection interface — the OQ-B seam
│   ├── connection.ts        # per-socket state: joined, rate budget, malformed count
│   ├── rate-limit.ts        # token bucket, (state, nowMs) -> decision
│   └── ws/
│       ├── handshake.ts     # Sec-WebSocket-Accept, node:crypto
│       ├── frame.ts         # RFC 6455 encode/decode — pure, fuzzed
│       └── server.ts        # Transport over node:http
└── room/
    ├── room.ts              # players, join/leave/enqueue/tick — the authority
    ├── loop.ts              # fixed tick, injected clock and scheduler
    └── serialise.ts         # PlayerState -> SnapshotPlayer, including y/pt from dir

client/
├── boot/main.ts             # MODIFIED: the caller becomes predict + send + interpolate
├── input/keys.ts            # MODIFIED: held codes -> bitmask; movement maths moves to shared
└── net/                     # NEW — 90% coverage threshold
    ├── socket.ts            # WebSocket shell; excluded ONLY because it holds no rule
    ├── prediction.ts        # NFR-006, NFR-007 — pure
    └── interpolation.ts     # NFR-008 — pure

client/render/
└── remote.ts                # NEW: remote capsules, created and destroyed by id (excluded)

vite.config.ts               # MODIFIED: proxy WS_PATH to SERVER_PORT (research.md R10)
package.json                 # MODIFIED: a dev:server script. No dependency change
```

**Structure Decision.** The module names come straight from
[05-architecture.md](../../requirements/05-architecture.md)'s suggested boundaries — `server/net`,
`server/room`, `client/net` — which M0 deliberately left empty because there was nothing honest to
put in them. `server/matchmaker` stays empty for the same reason: it is `FR-GP-010` in M3.

One deviation from that list: **`server/net/ws/` is a subdirectory** rather than files in
`server/net`. It is the only part of the tree that would be deleted wholesale if `OQ-B` is decided
the other way, and a directory boundary makes that a `rm -r` rather than an audit.

**Module resolution** is unchanged from M0: `package.json` subpath imports with explicit `.ts`
extensions, no `tsconfig` paths. `vite.config.ts` importing `#shared/constants/index.ts` was
**verified** during Phase 0 — the config is transformed before it runs, so this was not obvious,
and the fallback would have been the port written down in two files, which `SC-4` makes a defect.

---

## Implementation order

Dependency-ordered, not importance-ordered. `/speckit-tasks` expands this.

| #   | Slice                                                         | Delivers                                                       | Gate                                                            |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | **Constants + `shared/protocol` types**                       | Every message shape, in one place, importable by both runtimes | Typecheck; the boundary test still passes                       |
| 2   | **`shared/protocol/keys.ts` + `validate.ts` + `encode.ts`**   | The `NFR-011` boundary, and one decoder for the bitmask        | **100%**; every rejection path; adversarial values              |
| 3   | **WebSocket transport** — handshake, frame codec, `Transport` | A socket, with no new dependency                               | Node's global `WebSocket` client connects and echoes            |
| 4   | **`server/room`** — room, loop, serialise                     | Authority: one tick, one `step()` per player, snapshots        | Room and loop tests with a fake transport and an injected clock |
| 5   | **`server/net`** — connection, rate limit, wiring to the room | A hostile client cannot reach the simulation                   | Rate-limit and malformed-message tests                          |
| 6   | **`client/net/prediction.ts`**                                | `NFR-006`, `NFR-007`                                           | **Tests first.** Zero-error convergence; injected correction    |
| 7   | **`client/net/interpolation.ts`**                             | `NFR-008`                                                      | **Tests first.** Bracketing, dry buffer, join, leave            |
| 8   | **`client/net/socket.ts` + `client/boot/main.ts` rewiring**   | The client talks to the server and predicts                    | Manual; the shell holds no rule                                 |
| 9   | **`client/render/remote.ts`**                                 | Other players are visible                                      | Manual — the demo criterion                                     |
| 10  | **Two integration tests, end to end over a real socket**      | Proof the wiring is right, which no unit test above can give   | Two clients join, see each other, one leaves and vanishes       |

Slices 6 and 7 are where the hard bugs live, and they are the two written **test-first** without
exception. Both are pure functions over explicit arguments precisely so that the failing test can
be written before there is a socket to attach it to.

Slices 1–7 need no browser. Slice 3 is deliberately early: if the hand-rolled transport is going
to be wrong, it should be wrong before the room, the client and the render layer are written
against it.

**Do not reorder to see a second capsule sooner.** Slice 9 is the visible one and slices 2, 6 and
7 are the milestone.

---

## Risks

| Risk                                                      | Mitigation                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-rolled RFC 6455 framing is subtly wrong              | Oversized frames are refused **before** decoding ({MAX_MESSAGE_BYTES}), which removes the large-payload paths entirely. The codec is pure and fuzzed with truncated input. **Residual: only Node's client and Chrome are exercised in practice** — see `OQ-B` |
| Client and server disagree about what a key bitmask means | One decoder in `shared/protocol`, called by both. The client predicts from the bitmask it sends, not from the key set it sampled                                                                                                                              |
| Prediction diverges and rubber-bands                      | `NFR-003` makes the zero-error case exact rather than approximate, so a test can assert equality instead of closeness — divergence fails loudly rather than looking like network noise                                                                        |
| Remote players jitter                                     | {INTERPOLATION_DELAY} is two full snapshot intervals, and the playback clock is monotonic by construction. **Residual: arrival jitter is playback jitter**; the fix is a server-tick timeline, deferred with reasons in [research.md § R6](research.md)       |
| The input queue drifts full or empty over minutes         | {MAX_QUEUED_INPUTS} bounds the growth; the neutral input covers starvation. Adaptive send-rate correction is the real fix and no requirement asks for it                                                                                                      |
| A ghost player after disconnect                           | `FR-GP-040` is tested on both sides — the server's removal and the client's interpolation-state removal — because the client half is the half that gets forgotten                                                                                             |
| `@types/node` is only a transitive dependency             | It resolves today, and `npm run typecheck` proves it every run. Promoting it to an explicit `devDependency` is a dependency change and therefore the owner's decision                                                                                         |
| The tick loop drifts under load                           | Drift corrected against a real clock rather than accumulated from `setInterval`, with the catch-up cap M0 already established for the client                                                                                                                  |

---

## Complexity Tracking

No Constitution violations. This section is intentionally empty.
