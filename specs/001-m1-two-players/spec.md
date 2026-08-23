# Feature Specification: M1 — Two players moving

**Milestone**: `M1` in [08-roadmap.md](../../requirements/08-roadmap.md) · **Tag on completion**: `v0.2.0`

**Created**: 2026-08-22

**Status**: Draft — awaiting the project owner's review

**Demo criterion**: Two browsers see each other move smoothly.

> This spec **cites** requirement IDs; it does not restate them (Constitution, Principle I).
> Where this document and [`requirements/`](../../requirements/README.md) disagree,
> `requirements/` wins and this file is the bug.

---

## Objective

Put a socket between the client and the simulation without changing the simulation.

M0 ended with a pure `step(state, input, map)` called by a local accumulator in
`client/boot`. M1 replaces that **caller** — and only that caller — with three of them: a
server tick loop that owns the truth, a client prediction buffer that runs ahead of it, and a
reconciliation pass that reconciles the two. `shared/sim/step.ts` is not edited. If a task in
this milestone requires editing it, that is the signal something has been designed wrong, not
permission to edit it.

[08-roadmap.md](../../requirements/08-roadmap.md) calls M1 the hardest milestone and the whole
reason the project exists. The reason it is hard is that three clocks now disagree: the
server's fixed tick, each client's render frame, and the network delay between them. Every
requirement in this milestone is a rule about how that disagreement is resolved — and the one
mechanism that makes any of it work is `NFR-003`, the guarantee that the same input applied to
the same state produces the same output on both sides. M0 earned that guarantee; M1 spends it.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — See another player move (Priority: P1)

Two people open the page on the same server. Each sees the other's capsule walking, running,
jumping and crouching around the arena — moving continuously, not stepping between positions
20 times a second.

**Why this priority**: This _is_ the demo criterion. Everything else in M1 makes it correct or
makes it survive a hostile client; this is the part that makes it exist.

**Independent Test**: Two browser windows against one server process. No shooting, no score, no
UI. If both capsules move smoothly, the milestone's core is delivered.

**Acceptance Scenarios**:

1. **Given** a server is running and two clients have joined, **When** one player walks,
   **Then** the other client renders that motion continuously with no visible stepping or
   jitter, despite snapshots arriving at only {SNAPSHOT_HZ} (`NFR-008`).
2. **Given** a client has joined, **When** the server broadcasts a snapshot, **Then** it
   contains every living player in the room, regardless of walls or line of sight (`NET-009a`,
   `FR-GP-049`).
3. **Given** a remote player is behind a wall, **When** the local player looks at that wall,
   **Then** the remote capsule is hidden by the wall's depth, not by the server withholding it
   (`FR-GP-049`, and `D-006`'s accepted wallhack trade-off).
4. **Given** the server is running, **When** it is measured over a minute with one player and
   again with several, **Then** the tick interval is the same in both cases and independent of
   any client's frame rate (`NFR-005`).
5. **Given** a snapshot has not arrived for longer than the interpolation buffer covers,
   **When** the next frame is drawn, **Then** remote players hold their last known state rather
   than extrapolating into a position the server never reported.

---

### User Story 2 — Move without waiting for the server (Priority: P2)

The player who is moving feels no delay. Their own character responds on the frame the key is
pressed, and when the server's version of events differs, the difference is absorbed rather
than shown as a teleport.

**Why this priority**: `NFR-006` and `NFR-007`, and the reason `SC-3` is achievable at all. It
is P2 rather than P1 only because on a local network the demo criterion is visible without it —
which is precisely the trap: prediction that is missing is invisible until it is deployed, and
prediction that is wrong is invisible until someone moves quickly next to a wall.

**Independent Test**: One browser, one server, with artificial latency added. Local movement
must stay instant while the remote view of the same player lags behind.

**Acceptance Scenarios**:

1. **Given** any round-trip latency, **When** the player presses a movement key, **Then** their
   own character begins moving on the next rendered frame, before the server has confirmed
   anything (`NFR-006`).
2. **Given** the client has sent inputs the server has not yet acknowledged, **When** a snapshot
   arrives carrying `ack`, **Then** the client discards every input up to and including `ack`,
   adopts the server's state for itself, and replays the rest (`NFR-007`, `NET-009`).
3. **Given** the client and the server processed the same input sequence from the same state,
   **When** the replay finishes, **Then** the replayed state equals the client's already
   predicted state exactly — no correction is applied because none is needed (`NFR-003`).
4. **Given** a server-side correction is deliberately injected, **When** it arrives, **Then**
   the rendered character converges to the corrected position over several frames rather than
   teleporting, while the simulated state itself adopts the server's value immediately
   (`NFR-007`).
5. **Given** the connection stalls and no snapshot arrives, **When** the pending-input buffer
   reaches its cap, **Then** the oldest entries are dropped rather than growing without bound.

---

### User Story 3 — Join and leave without breaking the match (Priority: P3)

A player arriving is visible to everyone already there, and a player leaving disappears
completely — no frozen capsule left standing in the arena.

**Why this priority**: `FR-GP-040` is required and its failure mode is the most visible bug in
any multiplayer demo: the ghost. It is P3 because it is only observable once two players can
already see each other.

**Independent Test**: Open a second browser, confirm it appears in the first. Close it, confirm
it disappears. Repeat ten times and confirm nothing accumulates.

**Acceptance Scenarios**:

1. **Given** a client opens a socket, **When** it sends `join` with a valid nickname and mode,
   **Then** the server replies `joined` carrying the player's id, the map id, the tick rate and
   the authoritative constants (`NET-003`, `NET-008`, `NET-008a`).
2. **Given** a player joins, **When** the join succeeds, **Then** every other client in the room
   receives `playerJoined` with the new player's id and nickname (`NET-010`).
3. **Given** a player closes the tab, **When** the socket closes, **Then** every other client
   receives `playerLeft` and removes the model and all interpolation state within one tick, with
   no ghost body remaining (`NET-011`, `FR-GP-040`).
4. **Given** a player sends `leave`, **When** the server handles it, **Then** the outcome is
   identical to a socket close (`NET-006`).
5. **Given** a socket has already sent `join`, **When** it sends `join` again, **Then** the
   server rejects it with an `error` rather than creating a second player (`NET-003`).
6. **Given** the room already holds {MAX_PLAYERS_PER_ROOM} players, **When** another client
   joins, **Then** it receives `error` with code `ROOM_FULL` and is never added to the
   simulation (`FR-GP-013`, `NET-020`).
7. **Given** a player joins a room that is already running, **When** the join completes,
   **Then** they spawn immediately and appear in the next snapshot (`FR-GP-014`).

---

### User Story 4 — Survive a hostile client (Priority: P4)

A modified client sends malformed messages, floods inputs, claims a two-metre aim vector, or
asserts its own position. None of it reaches the simulation, and none of it degrades the match
for anyone else.

**Why this priority**: `NFR-010` and `NFR-011` are required, and this is where the protocol
either enforces `NFR-001` or quietly stops enforcing it. It is last only because it is
adversarial rather than user-visible — but the validator is written **before** the code that
would consume it, in the foundational phase, not after.

**Independent Test**: A test client that sends garbage. The server must stay up, the other
player must keep moving, and nothing in the simulation may change.

**Acceptance Scenarios**:

1. **Given** any inbound message, **When** it reaches the server, **Then** every field is
   checked for presence, type and range before any game logic sees it (`NFR-011`, `NET-002`).
2. **Given** a client sends `{"t":"input","dt":999999}` or a NaN aim vector, **When** the server
   processes it, **Then** the message is discarded, the simulation is unchanged, and the process
   does not crash (`NFR-011`).
3. **Given** a client sends `dir` that is not unit length, **When** the server validates it,
   **Then** the message is rejected — a longer vector must not buy extra speed (`NET-004c`).
4. **Given** a client aims outside the pitch limits, **When** the server validates it, **Then**
   the vertical component is clamped into {CAMERA_PITCH_MIN}..{CAMERA_PITCH_MAX} server-side
   rather than trusted (`NET-004c`).
5. **Given** a client sends more than {MAX_INPUTS_PER_SECOND} inputs in a second or a message
   larger than {MAX_MESSAGE_BYTES}, **When** the server notices, **Then** the excess is refused
   and the other players' experience is unaffected (`NFR-010`).
6. **Given** a client repeats malformed messages, **When** the count passes the limit, **Then**
   the connection is closed (`NFR-011`).
7. **Given** any message a client can construct, **When** the server routes it, **Then** there
   is no message type that sets health, position, velocity, score or kill status, because no
   such type exists in the protocol (`NFR-001`, `NET-007`).

---

### Edge Cases

- **Input arriving faster than the tick.** Queued up to {MAX_QUEUED_INPUTS}; beyond that the
  oldest are dropped (`NET-004a`). The server never advances a player more than one tick per
  tick, whatever the client's frame rate — otherwise frame rate becomes movement speed.
- **No input arriving at all.** A player whose inputs stall must still fall under gravity. The
  server applies a neutral input — no movement, no jump — retaining only the last known aim
  direction. It must **not** repeat the last input, which would leave a lagging player sprinting
  forward on their own.
- **A snapshot arriving out of order or duplicated.** Snapshots carry `tick`; one older than the
  newest already applied is discarded rather than rewinding the world.
- **`ack` referring to an input the client has already dropped.** Treated as "everything up to
  here is confirmed" — the buffer is trimmed, never resurrected.
- **The interpolation buffer running dry.** Hold the last known state. Do not extrapolate: no
  requirement asks for it, and a wrong guess is worse than a still capsule.
- **A player joining mid-flight.** They appear in the next snapshot with whatever state the
  server has; other clients must create their interpolation state on first sight, not on
  `playerJoined`, because the two can arrive in either order.
- **A socket closing mid-tick.** The player must be removable from the room without the tick
  loop observing a half-removed player.
- **An exception inside one room's tick.** Must not stop the process or any other room
  (`NFR-015`). M1 has one room, but the structure that makes this true is built now.
- **A client that connects and never sends `join`.** Holds a socket and no player slot; it must
  be closed rather than leaked.
- **The server restarting.** Every match ends. Accepted and expected (`NFR-002`); there is no
  reconnection into the same match (`D-009`).

---

## Requirements _(mandatory)_

This project's requirement IDs are permanent and live in
[`requirements/`](../../requirements/README.md). M1 mints none. It must satisfy these:

| ID                                                                                 | What M1 must satisfy                                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`NFR-001`](../../requirements/05-architecture.md)                                 | Server-authoritative: no inbound message asserts an outcome             |
| [`NFR-002`](../../requirements/05-architecture.md)                                 | One long-lived stateful Node process; state lives in memory             |
| [`NFR-003`](../../requirements/05-architecture.md)                                 | One simulation, imported by both runtimes — proven bit-identical        |
| [`NFR-005`](../../requirements/05-architecture.md)                                 | Fixed tick at {SERVER_TICK_HZ}, snapshots at {SNAPSHOT_HZ}              |
| [`NFR-006`](../../requirements/05-architecture.md)                                 | Client-side prediction of the local player                              |
| [`NFR-007`](../../requirements/05-architecture.md)                                 | Reconciliation: rewind to authoritative state, replay unacked inputs    |
| [`NFR-008`](../../requirements/05-architecture.md)                                 | Remote entity interpolation with an {INTERPOLATION_DELAY} buffer        |
| [`NFR-010`](../../requirements/05-architecture.md)                                 | Input rate limiting and message size cap                                |
| [`NFR-011`](../../requirements/05-architecture.md)                                 | Every inbound field validated before use                                |
| [`NFR-013`](../../requirements/05-architecture.md)                                 | A socket error is a readable message, not a frozen canvas               |
| [`NFR-015`](../../requirements/05-architecture.md)                                 | Room isolation — state, loop and broadcasts do not leak                 |
| [`NET-001`](../../requirements/06-network-protocol.md)                             | Every message is `{ t, ...fields }`; unknown types ignored              |
| [`NET-002`](../../requirements/06-network-protocol.md)                             | Validators live in `shared/protocol` so the two sides cannot drift      |
| [`NET-003`](../../requirements/06-network-protocol.md)                             | `join`; a second `join` on one socket is an error                       |
| [`NET-004`](../../requirements/06-network-protocol.md)                             | `input` with `seq`, `keys` bitmask and `dir`                            |
| [`NET-004a`](../../requirements/06-network-protocol.md)                            | No client `dt`; one input advances exactly one tick; queue capped       |
| [`NET-004c`](../../requirements/06-network-protocol.md)                            | `dir` is a unit vector, validated and pitch-clamped server-side         |
| [`NET-006`](../../requirements/06-network-protocol.md)                             | `leave` is identical to a socket close                                  |
| [`NET-007`](../../requirements/06-network-protocol.md)                             | No client message asserts damage, kills, position or team               |
| [`NET-008`](../../requirements/06-network-protocol.md)                             | `joined`, including the map id and tick rate                            |
| [`NET-008a`](../../requirements/06-network-protocol.md)                            | The server sends the authoritative constants at join                    |
| [`NET-009`](../../requirements/06-network-protocol.md)                             | `snapshot` with `tick`, `ack` and the player array                      |
| [`NET-009a`](../../requirements/06-network-protocol.md)                            | Every living player is included regardless of line of sight             |
| [`NET-009b`](../../requirements/06-network-protocol.md)                            | Nicknames do not travel in the snapshot                                 |
| [`NET-010`](../../requirements/06-network-protocol.md)                             | `playerJoined`                                                          |
| [`NET-011`](../../requirements/06-network-protocol.md)                             | `playerLeft`, and the client removing all interpolation state           |
| [`NET-020`](../../requirements/06-network-protocol.md)                             | `error` with a machine-readable `code`                                  |
| [`FR-GP-008`](../../requirements/02-gameplay.md)                                   | Nickname validated server-side; the server's decision is final          |
| [`FR-GP-009`](../../requirements/02-gameplay.md)                                   | Identity is the server-assigned id, never the nickname                  |
| [`FR-GP-013`](../../requirements/02-gameplay.md)                                   | Room capacity, enforced with `ROOM_FULL`                                |
| [`FR-GP-014`](../../requirements/02-gameplay.md)                                   | Join in progress: spawn within one tick                                 |
| [`FR-GP-021`](../../requirements/02-gameplay.md)                                   | Releasing pointer lock leaves the player in the match, still simulated  |
| [`FR-GP-040`](../../requirements/02-gameplay.md)                                   | Disconnection removes the player immediately; no ghost, no resume token |
| [`FR-GP-049`](../../requirements/02-gameplay.md)                                   | Occlusion is visual; the snapshot carries everyone                      |
| [`SC-4`](../../requirements/01-vision.md)                                          | A netcode constant changes behaviour by editing `shared/constants` only |
| [ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md) | Aim on the wire is `dir`; `y`/`pt` are presentation only                |

### The protocol subset M1 implements

`06-network-protocol.md` describes the finished protocol. M1 implements the messages the
roadmap assigns to it and **no others**. The rest are not missing; they belong to the milestone
that gives them meaning:

| Message                                                     | M1                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `join`, `input`, `leave`                                    | Implemented                                                    |
| `joined`, `snapshot`, `playerJoined`, `playerLeft`, `error` | Implemented                                                    |
| `ping` / `pong` (`NET-005`, `NET-021`)                      | Not implemented — no requirement consumes an RTT display in M1 |
| `shot`, `damage`, `hitConfirm`, `kill`, `respawn`           | M2                                                             |
| `score`, `matchStart`, `matchEnd`                           | M3                                                             |

Three fields inside implemented messages also wait for the milestone that owns their meaning.
This is scope, not divergence — each is an optional field that arrives with the state it
reports:

| Field                              | Waits for                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `snapshot.players[].hp`, `.am`     | M2 — there is no health (`FR-GP-034`) or ammo (`FR-GP-030`) to report yet   |
| `snapshot.players[].st` bits 8, 16 | M2 — reloading and dead are M2 states. Bits 1 and 2 are sent from M1        |
| `snapshot.match`                   | M3 — match phase and timer are `FR-GP-041`–`FR-GP-045`                      |
| `joined.team`, `joined.roomCode`   | M3 — teams are `FR-GP-004`, private rooms are `FR-GP-011`. `team` is `null` |

### Key Entities

- **Room** — one match in memory: its player table, its tick counter, its tick loop, its
  broadcast list. M1 has exactly one, created at startup, and it is never addressed by code that
  assumes there is only one (`NFR-015`). The matchmaker that would create a second is
  `FR-GP-010` in M3.
- **Connection** — one socket and everything the server must know to distrust it: whether it has
  joined, its input queue, its rate-limit budget, its malformed-message count. Deliberately
  separate from the player it owns, so that closing a socket cannot leave a half-removed player
  in the simulation.
- **Player (server-side)** — an id, a nickname, a `PlayerState` from `shared/sim`, the last
  validated aim direction, and the sequence number of the last input applied. The `PlayerState`
  is the same type the client predicts with; nothing is added to it that the simulation does not
  need.
- **PendingInput (client-side)** — an input that has been sent and not yet acknowledged, kept
  with its `seq` so it can be replayed after reconciliation. The buffer is the whole of
  `NFR-007`.
- **SnapshotBuffer (client-side)** — the recent snapshots of remote players with the local time
  each arrived, sampled {INTERPOLATION_DELAY} in the past. The whole of `NFR-008`.

---

## Out of scope for M1

Not oversights. Each is owned by a later milestone or is an explicit decision — see
[09-out-of-scope.md](../../requirements/09-out-of-scope.md) and
[08-roadmap.md](../../requirements/08-roadmap.md):

| Not in M1                                                               | Owned by                        |
| ----------------------------------------------------------------------- | ------------------------------- |
| Weapons, firing, raycast, damage, health, death, respawn, HUD           | M2                              |
| Modes, teams, scoring, match timer, start screen, nickname entry        | M3                              |
| Auto-match, private room codes, more than one room                      | M3 (`FR-GP-010`, `FR-GP-011`)   |
| Character models, animation, nameplates, audio, art pass                | M4                              |
| `localStorage`, the "Disconnected" screen (`FR-UI-013`), loading screen | M5                              |
| Lag compensation / server-side rewind                                   | DEFERRED — `NFR-009`            |
| Binary encoding, delta-compressed snapshots                             | DEFERRED — `NET-022`, `NET-023` |
| Reconnecting into the same match, session resume tokens                 | DROPPED — `D-009`, `FR-GP-040`  |
| Server-side visibility culling                                          | DEFERRED — `FR-GP-049`, `D-006` |
| Player-versus-player collision                                          | No requirement asks for it      |

Four rules with teeth:

- **Do not edit `shared/sim/step.ts`.** M1 changes the caller, never the callee. A diff touching
  that file is a failed milestone even if the demo works.
- **Do not add a client message that asserts an outcome.** `NET-007`'s value is that the handler
  does not exist. Adding one and validating it is not the same thing.
- **Do not optimise the wire format.** JSON is within budget at {MAX_PLAYERS_PER_ROOM} players
  and {SNAPSHOT_HZ} (`NET-022`, `NET-023`). Full snapshots are also what make a desync
  debuggable, and M1 is the milestone where desyncs happen.
- **Do not resolve [`Q-003`](../../requirements/11-open-questions.md).** Crosshair-to-ray
  alignment blocks M2 and must land as an ADR before firing code. M1 must not bake an aim
  convention into the snapshot and call it settled.

---

## Success Criteria _(mandatory)_

Per the Constitution's ID namespaces, milestone exit criteria are `M<N>-<n>` — `SC-1`…`SC-5`
are the project-wide criteria in [01-vision.md](../../requirements/01-vision.md) and are not
reused here.

M1 is done when all of these are demonstrably true:

| #         | Criterion                                                                                                                                         | Verified by                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **M1-1**  | Two browsers against one server see each other walk, sprint, crouch and jump, smoothly, with no stepping and no jitter.                           | Manual — the demo criterion           |
| **M1-2**  | `shared/sim/step.ts` is byte-identical to its M0 version.                                                                                         | `git diff main -- shared/sim/step.ts` |
| **M1-3**  | The client's predicted state and the server's authoritative state are identical for the same input sequence from the same start state.            | Cross-runtime determinism test        |
| **M1-4**  | The local player moves on the frame the key is pressed, at any latency.                                                                           | Manual with injected latency          |
| **M1-5**  | An injected server correction converges without a visible teleport, and the simulated state adopts the server's value immediately.                | Reconciliation test + manual          |
| **M1-6**  | Closing a browser removes that player from every other client within one tick, leaving no ghost body and no interpolation state.                  | Server + client test, then manual     |
| **M1-7**  | Malformed, oversized, out-of-range and adversarial messages are rejected before game logic, and repeated malformed messages close the connection. | Protocol and server tests             |
| **M1-8**  | A client flooding inputs is throttled without changing what any other player experiences.                                                         | Rate-limit test                       |
| **M1-9**  | No inbound message type can set position, velocity, health, score or kill status.                                                                 | Protocol test + review                |
| **M1-10** | The tick interval is constant, independent of player count and of any client's frame rate.                                                        | Tick-loop test                        |
| **M1-11** | Every living player appears in every snapshot regardless of line of sight.                                                                        | Room test                             |
| **M1-12** | An exception thrown inside a room's tick does not stop the process and does not stop another room's tick.                                         | Room isolation test                   |
| **M1-13** | `shared/protocol/**` is at 100%, `server/**` at 90%, `client/net/**` at 90%, and `npm run verify` is green with no threshold relaxed.             | `npm run test:coverage`               |
| **M1-14** | Changing {SERVER_TICK_HZ}, {SNAPSHOT_HZ} or {INTERPOLATION_DELAY} in `shared/constants` changes behaviour with no other edit.                     | Manual + review                       |

Only then is `v0.2.0` tagged
([CONTRIBUTING.md](../../CONTRIBUTING.md)).

---

## Assumptions

Stated so they can be corrected now rather than discovered later:

1. **One room, created at startup, in FFA.** `NFR-002` and the roadmap say "one hardcoded room".
   Team assignment (`FR-GP-004`) and matchmaking (`FR-GP-010`, `FR-GP-011`) are M3, so `joined`
   carries `mode: "FFA"` and `team: null`.
2. **The client sends a generated placeholder nickname.** The start screen where a player types
   one is `FR-UI-001` in M3. The nickname is validated server-side to `FR-GP-008` from M1
   regardless, because that validator is a security boundary and `NFR-011` does not wait for a UI.
   Nothing renders it in M1 — nameplates are `FR-GP-048` in M4.
3. **The client and server exchange JSON text frames over one WebSocket per client**, as
   `05-architecture.md` fixes. JSON `number` round-trips an IEEE 754 double exactly, so the wire
   format does not threaten `NFR-003`.
4. **Remote players are capsules.** `D-011` ships primitives through M0–M3.
5. **No player-versus-player collision.** Players pass through each other. No requirement asks
   for collision between players, and `FR-GP-027`'s hit volumes are M2's concern, not movement's.
6. **Server-side yaw and pitch are derived from the last validated `dir`** for `NET-009`'s `y`
   and `pt`. They are presentation data that never re-enters the simulation, exactly as ADR-0001
   permits, and the derivation happens in `server/`, never in `shared/`.
7. **Latency is simulated, not real, during development.** Both browsers are local. Testing
   `NFR-007` therefore requires deliberately injected delay; without it, reconciliation is
   correct-looking whether or not it works.

---

## Open questions raised by this milestone

Recorded here rather than guessed, per Constitution Principle I. Neither is a
`11-open-questions.md` entry today; both need the project owner's ruling, and each names the
recommendation M1 proceeds on in the meantime.

### OQ-A — How often does the client send `input`? ⚠️ **affects correctness, not taste**

[06-network-protocol.md](../../requirements/06-network-protocol.md)'s Model section says the
client sends **one input message per render frame**, capped at {MAX_INPUTS_PER_SECOND}.
`NET-004a` says **each input advances the player by exactly one fixed server tick**, with
surplus queued to {MAX_QUEUED_INPUTS} and the oldest dropped beyond that.

Those two readings cannot both hold. At 60 fps a client would emit 60 inputs per second while
the server consumes {SERVER_TICK_HZ} — 30. The queue fills in roughly a third of a second and
then permanently discards half of everything the player does, which appears as continuous
reconciliation, which is the rubber-banding `SC-3` forbids. At 144 fps it is worse. The
alternative reading — consume the whole queue each tick — is worse still: it makes frame rate
into movement speed, which is the exact class of advantage `NET-004c` refuses to hand a client.

**Recommendation, and what M1 does:** the client sends **one `input` per simulation tick** — the
same fixed {SERVER_TICK_HZ} timestep its prediction already runs at, one message per `step()`
call. Both sides then produce and consume at the same rate, {MAX_INPUTS_PER_SECOND} keeps its
stated role as a cap with better than 2× headroom for jitter bursts, and {MAX_QUEUED_INPUTS}
absorbs bursts instead of overflowing on every frame. No numbered requirement changes; only the
un-numbered Model bullet reads differently, and the project owner should amend that prose to say
"per simulation tick".

### OQ-B — The WebSocket transport, and the dependency it would need

`05-architecture.md` fixes WebSocket as the transport but names no library, and the Constitution
requires the project owner's approval for **any** new dependency. The obvious choice, `ws`, is
therefore not M1's to add unattended.

**Recommendation, and what M1 does:** implement the RFC 6455 handshake and frame codec directly
on `node:http`, adding no dependency, and keep it behind a transport interface so that swapping
in `ws` later touches one module and nothing else. The subset needed is small — the client
speaks it, not us — and its parts are pure functions, which suits the 90% threshold on
`server/**` better than a wrapper around a third-party socket would. Reasoning and the rejected
alternatives are in [research.md](research.md) R2; the plan carries it as a gate the owner can
overturn cheaply.

---

## Resolved before this spec

- [ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md) — aim
  reaches the simulation as a unit direction vector. M1 is the milestone that spends that
  decision: `NET-004` carries `dir`, the server validates and clamps it (`NET-004c`), and
  `NET-009` keeps `y`/`pt` as presentation only.
- [`D-009`](../../requirements/10-decision-log.md) — no reconnection into the same match, so M1
  needs no session tokens and no slot reservation.
- [`D-003`](../../requirements/10-decision-log.md) — prediction and reconciliation without lag
  compensation. `NFR-009` is settled, not open.

## Still open — not M1's to answer

- [`Q-003`](../../requirements/11-open-questions.md) — crosshair-to-ray alignment. Blocks M2.
  M1 must not pre-empt it.
- [`Q-002`](../../requirements/11-open-questions.md) — balance numbers, now including
  {INTERPOLATION_DELAY}, which trades smoothness against how stale remote players look. It is
  `PROPOSED`; tuning it is a constants edit (`SC-4`), not a code change.
- [`Q-006`](../../requirements/11-open-questions.md) — what happens to a player idle with
  pointer lock released. M1 makes them visible to others for the first time, which is what will
  eventually make this worth answering. It blocks M3.
- [`Q-001`](../../requirements/11-open-questions.md) — deployment. M1 is the first milestone
  with a server process to deploy, but v1 is local-only by `D-013`.
