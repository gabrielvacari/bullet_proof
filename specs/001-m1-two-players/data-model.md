# Phase 1 Data Model: M1 — Two players moving

**Feature**: `001-m1-two-players` · **Date**: 2026-08-22

M0's types are unchanged. `PlayerState`, `PlayerInput`, `Vec3` and `GameMap` are exactly as
[`000-m0-walking-box/data-model.md`](../000-m0-walking-box/data-model.md) defined them, and
`shared/sim/types.ts` is not edited. What M1 adds is everything **around** them: the wire types
in `shared/protocol`, and the two buffers on the client that make prediction and interpolation
possible.

Everything in `shared/protocol` is plain data — objects and arrays, no classes, no methods —
because it is `JSON.stringify`d and `JSON.parse`d on the way through.

---

## Wire types — `shared/protocol`

Every message is `{ t: string, ...fields }` with no nesting and no envelope metadata
(`NET-001`). A single switch on `t` routes it; an unrecognised `t` is ignored, not an error.

### Client → server

#### `JoinMessage` — `NET-003`

| Field      | Type                  | Validation                                                                          |
| ---------- | --------------------- | ----------------------------------------------------------------------------------- |
| `t`        | `'join'`              | —                                                                                   |
| `nickname` | `string`              | {NICKNAME_MIN_LENGTH}–{NICKNAME_MAX_LENGTH} chars, `[A-Za-z0-9_-]` (`FR-GP-008`)    |
| `mode`     | `'FFA' \| 'TDM'`      | Member of the union; anything else is `INVALID_MODE`                                |
| `roomCode` | `string \| undefined` | Optional. Shape-checked; M1 has one room, so it selects nothing (`FR-GP-011` is M3) |

A second `join` on a socket that has already joined is an `error`, not a second player
(`NET-003`).

The nickname pattern is what makes `FR-GP-008`'s acceptance criterion true: `<script>alert(1)</script>`
fails on both the character class and the length. `NFR-012` still applies downstream — the
validator is not a licence to use `innerHTML` later.

#### `InputMessage` — `NET-004`

| Field  | Type      | Validation                                                                                   |
| ------ | --------- | -------------------------------------------------------------------------------------------- |
| `t`    | `'input'` | —                                                                                            |
| `seq`  | `number`  | Integer, finite, `> 0`, strictly greater than the last accepted `seq` on this connection     |
| `keys` | `number`  | Integer in `0..511` — the nine defined bits and nothing above them                           |
| `dir`  | `Vec3`    | Three finite numbers, unit length within {AIM_EPSILON}, `dir[1]` clamped into the pitch cone |

**No `dt`, ever** (`NET-004a`). There is no field to read, which is a stronger guarantee than a
validator that rejects one.

**`seq` must strictly increase.** A replayed or reordered `seq` is dropped: without that check a
client could resend an old input to be simulated twice, which is movement for free.

`dir` is **clamped**, not rejected, when its vertical component leaves
{AIM_DIR_Y_MIN}..{AIM_DIR_Y_MAX} — `NET-004c` says clamp, and dropping the message would drop a
tick of movement and stutter a player who merely looked up too far. The horizontal part is
renormalised so the result is still unit length. A `dir` with **no** horizontal component is
rejected instead: there is no heading to preserve. See
[research.md § R8](research.md#r8--clamp-or-reject-an-out-of-cone-aim-vector--resolved).

##### The `keys` bitmask

| Bit | Meaning | M1                                            |
| --- | ------- | --------------------------------------------- |
| 1   | forward | Decoded into `move`                           |
| 2   | back    | Decoded into `move`                           |
| 4   | left    | Decoded into `move`                           |
| 8   | right   | Decoded into `move`                           |
| 16  | jump    | `PlayerInput.jump`                            |
| 32  | sprint  | `PlayerInput.sprint`                          |
| 64  | crouch  | `PlayerInput.crouch`                          |
| 128 | fire    | Validated in range, ignored — M2 (`NET-004b`) |
| 256 | reload  | Validated in range, ignored — M2 (`NET-004b`) |

Decoded **once**, in `shared/protocol/keys.ts`, by both runtimes. Opposing bits cancel
(`forward|back` is zero on that axis) and the result is normalised, so `W`+`A` is not faster than
`W`. If this decoding existed twice, `NFR-003` would be false on the first diagonal — see
[research.md § R4](research.md#r4--where-the-keys-bitmask-is-decoded--resolved).

#### `LeaveMessage` — `NET-006`

`{ t: 'leave' }`. Handled identically to a socket close.

#### What is deliberately absent

There is no message that sets health, position, velocity, score, team, or kill status
(`NET-007`). Their absence is the protocol enforcing `NFR-001` — a validator that rejected such a
message would be strictly weaker than a protocol in which it cannot be expressed.

### Server → client

#### `JoinedMessage` — `NET-008`

| Field      | Type           | M1                                                                               |
| ---------- | -------------- | -------------------------------------------------------------------------------- |
| `playerId` | `string`       | `p_` + a short random suffix. Identity is this, never the nickname (`FR-GP-009`) |
| `roomId`   | `string`       | The single room's id                                                             |
| `roomCode` | omitted        | Private rooms are `FR-GP-011`, M3                                                |
| `mode`     | `'FFA'`        | Teams are `FR-GP-004`, M3                                                        |
| `team`     | `null`         | `null` in FFA, per `NET-008`                                                     |
| `mapId`    | `string`       | From the loaded `GameMap`                                                        |
| `tickRate` | `number`       | {SERVER_TICK_HZ}                                                                 |
| `config`   | `ClientConfig` | `NET-008a` — see below                                                           |
| `spawn`    | `{ pos, yaw }` | Where the client starts predicting from                                          |

`spawn` is not in `NET-008`'s example and is not a new requirement: `FR-GP-014` requires the
joining player to be in the arena within one tick, and the client cannot predict from a position
it has not been told. It is the transform the server has already assigned, echoed so prediction
and authority start from the same state — which is `NFR-003`'s precondition.

**`ClientConfig`** is the `NET-008a` subset: the tuning values the client needs in order to
predict identically. Sending them is what stops a stale bundle from silently simulating a
different game.

#### `SnapshotMessage` — `NET-009`

| Field     | Type               | Meaning                                                     |
| --------- | ------------------ | ----------------------------------------------------------- |
| `tick`    | `number`           | The server tick this state is from                          |
| `ack`     | `number`           | Last `input.seq` applied **for this recipient** — `NFR-007` |
| `players` | `SnapshotPlayer[]` | Every living player (`NET-009a`, `FR-GP-049`)               |

`ack` differs per recipient, so each client's snapshot is serialised individually. That is the
same seam `NET-009`'s `am` (ammo, "only sent for the receiving player") will use in M2.

**`SnapshotPlayer`**

| Field | Type     | M1                                                          |
| ----- | -------- | ----------------------------------------------------------- |
| `id`  | `string` | —                                                           |
| `p`   | `Vec3`   | Capsule base position                                       |
| `v`   | `Vec3`   | Velocity — needed for interpolation now and animation in M4 |
| `y`   | `number` | Yaw, derived server-side from the last validated `dir` (R7) |
| `pt`  | `number` | Pitch, same                                                 |
| `st`  | `number` | State bitmask: **1 = grounded, 2 = crouching** in M1        |
| `hp`  | omitted  | M2 — there is no health yet (`FR-GP-034`)                   |
| `am`  | omitted  | M2 — there is no ammo yet (`FR-GP-030`)                     |

`st` bits 4, 8 and 16 (sprinting, reloading, dead) are not sent in M1. Their positions are
reserved by `NET-009` and stay reserved; a bit is added by the milestone that adds the state it
reports, so nothing has to be renumbered.

Nicknames, teams and scores are **not** in the snapshot (`NET-009b`). They arrive once, with
`playerJoined`.

#### `PlayerJoinedMessage` — `NET-010`

`{ t, id, nickname, team }`. `team` is `null` in M1.

#### `PlayerLeftMessage` — `NET-011`

`{ t, id }`. The client removes the model **and all interpolation state** — the second half is
the one that gets forgotten and produces the ghost that `FR-GP-040` forbids.

#### `ErrorMessage` — `NET-020`

`{ t, code, message }`. The client branches on `code`, never on `message`.

| Code               | M1                                            |
| ------------------ | --------------------------------------------- |
| `ROOM_FULL`        | Room at {MAX_PLAYERS_PER_ROOM} (`FR-GP-013`)  |
| `INVALID_NICKNAME` | Fails `FR-GP-008`                             |
| `INVALID_MODE`     | `mode` outside the union                      |
| `RATE_LIMITED`     | `NFR-010`                                     |
| `MALFORMED`        | Failed validation (`NFR-011`)                 |
| `INTERNAL`         | An exception the room caught (`NFR-015`)      |
| `ROOM_NOT_FOUND`   | Not reachable in M1 — needs rooms by code, M3 |

---

## Server-side types

### `ServerPlayer`

| Field      | Type             | Note                                                          |
| ---------- | ---------------- | ------------------------------------------------------------- |
| `id`       | `string`         | Server-assigned; the only identity (`FR-GP-009`)              |
| `nickname` | `string`         | Validated at join, never re-validated, never used as identity |
| `state`    | `PlayerState`    | The M0 type, unchanged                                        |
| `lastDir`  | `Vec3`           | Last validated aim; feeds the neutral input and `y`/`pt`      |
| `lastSeq`  | `number`         | Becomes the recipient's `ack`                                 |
| `queue`    | `InputMessage[]` | Capped at {MAX_QUEUED_INPUTS}; oldest dropped (`NET-004a`)    |

### `Room`

Player table, tick counter, and a snapshot accumulator in milliseconds. `tick()` advances every
player by exactly one `step()` and is called by the loop, never by a message handler — a message
that could advance the simulation would make send rate into movement speed.

`Room` never reaches for a global. M1 creates one at startup, and `NFR-015` is about the second
one never being able to observe the first.

### `Connection`

One socket and everything needed to distrust it: `hasJoined`, the player id once assigned, the
rate-limit bucket, and the malformed-message count. **Deliberately not the player** — a socket
closing must not be able to leave a half-removed player inside a tick that is already running
(`FR-GP-040`).

---

## Client-side types

### `PendingInput` — the whole of `NFR-007`

`{ seq: number; input: PlayerInput }`, in send order. On a snapshot: drop everything with
`seq <= ack`, adopt the server's state, replay the remainder through `step()`. Capped at
{MAX_PENDING_INPUTS}, dropping oldest first, so a dead connection cannot grow it without bound.

### `SnapshotBufferEntry` — the whole of `NFR-008`

`{ receivedAtMs: number; tick: number; players: SnapshotPlayer[] }`, oldest first. Sampled at
`now - INTERPOLATION_DELAY`; entries older than the pair bracketing that time are dropped. An
entry whose `tick` is not newer than the newest already held is discarded.

Reading `Date.now()` here is fine: this is `client/net`, not `shared/`, and no value derived from
it ever enters `step()`.

### `RenderError` — the smoothing offset

A `Vec3` captured at reconciliation as `previouslyPredictedPos - replayedPos`, multiplied by
{RECONCILE_ERROR_DECAY_PER_TICK} every simulation tick and zeroed below
{RECONCILE_ERROR_EPSILON}. It is added to the **rendered** position only. The simulated state
adopts the server's value immediately, because anything else puts the client's opinion above the
server's (`NFR-001`).

---

## State transitions

### A connection

```
   opened ──join(valid)──▶ joined ──socket close / leave──▶ removed
     │                       │
     │                       └── join again ──▶ error, still joined (NET-003)
     │
     ├── join(invalid) ──▶ error, still unjoined
     ├── room full ──────▶ error ROOM_FULL, never simulated (FR-GP-013)
     └── malformed × MAX_MALFORMED_MESSAGES ──▶ closed (NFR-011)
```

An unjoined socket holds no player slot. It is closed rather than leaked.

### A tick

```
for each player:
    input = queue.shift() ?? neutralInput(player.lastDir)
    player.state = step(player.state, input, map)
    if input came from the queue: player.lastSeq = input.seq
tick += 1
if enough time has passed for SNAPSHOT_INTERVAL_MS: serialise per recipient and broadcast
```

The neutral input — no movement, no jump, retaining only `lastDir` — is why a player whose
connection stalls falls rather than freezes, and why one who unplugs their cable does not keep
sprinting. See [research.md § R1](research.md#r1--how-the-server-calls-step-without-changing-it--resolved).

### Reconciliation, per snapshot

```
drop pending where seq <= ack
before = predicted.pos
predicted = snapshot state for this player     // adopted exactly, never blended
for each remaining pending input in order:
    predicted = step(predicted, input, map)
renderError = before - predicted.pos           // decays; never fed back
```

---

## New constants

Added to `shared/constants/index.ts`, because Principle IV admits no literal anywhere else.

**`requirements/07-constants.md` is not edited by this milestone** — it is `requirements/`, and
this table is the list a human syncs into it.

| Constant                         | Value          | Why it is needed                                                                                                              |
| -------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `SERVER_PORT`                    | `8787`         | The port the Node process listens on, imported by `server/index.ts` **and** `vite.config.ts` so the proxy cannot drift (R10)  |
| `WS_PATH`                        | `'/ws'`        | The WebSocket path, shared by the same two files                                                                              |
| `MAX_MALFORMED_MESSAGES`         | `10`           | Malformed messages tolerated on one connection before it is closed — `NFR-011`'s "on repetition"                              |
| `MAX_PENDING_INPUTS`             | derived        | `MAX_INPUTS_PER_SECOND` — one second of unacknowledged input. Computed, not written down                                      |
| `RECONCILE_ERROR_DECAY_PER_TICK` | `0.85`         | Fraction of the render-side correction error carried into the next tick — `NFR-007`'s "without a visible teleport"            |
| `RECONCILE_ERROR_EPSILON`        | `0.001` m      | Below this the error is zeroed rather than decaying forever                                                                   |
| `MS_PER_SECOND`                  | `1000`         | Unit conversion, not a tuning value. Already used implicitly by the derived block; named so the rate limiter needs no literal |
| `SNAPSHOT_BUFFER_SIZE`           | derived        | `ceil(INTERPOLATION_DELAY / SNAPSHOT_INTERVAL_MS) + 2` — the entries interpolation needs. Computed, never written down        |
| `KEY_*` bit values               | from `NET-004` | Nine named bits. Protocol constants, not tuning values, and they live beside the codec in `shared/protocol/keys.ts`           |

`RECONCILE_ERROR_DECAY_PER_TICK` and `RECONCILE_ERROR_EPSILON` are `PROPOSED` in the sense
`07-constants.md` uses: chosen as sensible defaults and expected to be tuned. At
{SERVER_TICK_HZ}, a decay of `0.85` per tick brings a correction below 5% of its original size in
about 200 ms — fast enough not to feel like drifting, slow enough not to read as a jump.
