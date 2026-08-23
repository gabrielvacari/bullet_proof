# 06 — Network Protocol

## Model

- One WebSocket per client.
- **JSON messages in v1.** Binary encoding is `DEFERRED` — see `NET-020`.
- Every message is an object with a `t` (type) field. Unknown types are ignored.
- The server simulates at {SERVER_TICK_HZ} and broadcasts snapshots at {SNAPSHOT_HZ}.
- The client sends **one input message per simulation tick**, capped at
  {MAX_INPUTS_PER_SECOND}.

### NET-001 — Message envelope

**Status:** PROPOSED
**Statement:** Every message is `{ "t": "<type>", ...fields }`. There is no nesting under a
`data` key and no envelope metadata beyond `t`.
**Acceptance:** A single switch on `t` routes every message.

### NET-002 — Every inbound message is validated

**Status:** REQUIRED
**Statement:** The server validates type, shape, and numeric range of every field before
the message reaches any game logic. See `NFR-011`.
**Acceptance:** Validators are defined next to the message types in `/shared/protocol`, so
client and server cannot drift.

---

## Client → Server

### NET-003 — `join`

```jsonc
{
  "t": "join",
  "nickname": "gabriel",     // FR-GP-008 validated
  "mode": "FFA" | "TDM",
  "roomCode": "X7K2"         // optional; omit for auto-match, "NEW" to create a private room
}
```

Server responds with `joined` or `error`. Sending `join` twice on one socket is an error.

### NET-004 — `input`

```jsonc
{
  "t": "input",
  "seq": 1042, // monotonically increasing, per-connection
  "keys": 27, // bitmask: 1=fwd 2=back 4=left 8=right 16=jump 32=sprint 64=crouch 128=fire 256=reload
  "dir": [0.0, -0.208, -0.978], // unit vector, aim direction — see ADR-0001
}
```

**NET-004c** — Aim is a **normalised direction vector**, not `yaw`/`pitch` angles. The
server validates that all three components are finite and that the vector's length is 1
within an epsilon before it reaches game logic (`NFR-011`); a non-unit vector would
otherwise buy the sender a speed advantage. Pitch limits (`CAMERA_PITCH_MIN`..`MAX`) are
enforced by clamping the vector's vertical component server-side.

The simulation never converts an angle, because ECMA-262 leaves `Math.sin`/`Math.cos`
implementation-approximated and this project runs the same simulation on Node and on three
different browser engines. Full reasoning in
[ADR-0001](../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md); it is what
makes `NFR-003`'s bit-identity criterion achievable. Snapshots (`NET-009`) still carry
`y`/`pt` for rendering — those never feed the simulation.

**NET-004a** — The server never uses a client-supplied delta time. Each `input` advances
the player by exactly one fixed server tick. Inputs arriving faster than the tick rate are
queued, up to {MAX_QUEUED_INPUTS}; beyond that the oldest are dropped.

**NET-004d** — One input per **tick**, not per rendered frame.

This paragraph used to say "per render frame", which cannot hold alongside `NET-004a`. At
60 fps against a {SERVER_TICK_HZ} server, sixty inputs arrive each second and thirty are
consumed: the queue grows by thirty a second and overflows {MAX_QUEUED_INPUTS} in a third
of a second, after which the oldest input is dropped on every tick, forever. That is
permanent rubber-banding for any player whose display is faster than the tick rate — which
is every player.

The client therefore accumulates held keys across frames and emits one input per elapsed
simulation tick, from the same fixed-timestep accumulator the prediction uses. The cap
{MAX_INPUTS_PER_SECOND} stays what `NFR-010` makes it: a rate limit against a hostile
client, not the normal sending rate.

**NET-004b** — `fire` in the `keys` bitmask is a _request_. The server decides whether the
shot happens, based on fire rate (`FR-GP-029`), ammo (`FR-GP-030`), reload state
(`FR-GP-031`), and alive state (`FR-GP-036`).

### NET-005 — `ping`

```jsonc
{ "t": "ping", "ts": 1723900000000 }
```

Server replies with `pong` echoing `ts`. Used for the client's RTT display only; it is not
part of the simulation.

### NET-006 — `leave`

```jsonc
{ "t": "leave" }
```

Explicit exit. Treated identically to a socket close (`FR-GP-040`).

**NET-007** — There is deliberately **no** client message for: dealing damage, scoring a
kill, setting position, changing team, or ending a match. Their absence is the protocol
enforcing `NFR-001`.

---

## Server → Client

### NET-008 — `joined`

```jsonc
{
  "t": "joined",
  "playerId": "p_7f3a",
  "roomId": "r_19",
  "roomCode": "X7K2", // present only for private rooms
  "mode": "TDM",
  "team": "BLUE", // null in FFA
  "mapId": "arena-01",
  "tickRate": 30,
  "config": {/* the tuning constants the client needs — see 07-constants.md */},
}
```

**NET-008a** — The server sends the authoritative gameplay constants at join time so the
client cannot run with stale or divergent values.

### NET-009 — `snapshot`

Sent at {SNAPSHOT_HZ}. The core message.

```jsonc
{
  "t": "snapshot",
  "tick": 84210,
  "ack": 1042, // last `input.seq` processed for THIS client — drives NFR-007
  "players": [
    {
      "id": "p_7f3a",
      "p": [12.5, 0.0, -3.2], // position
      "y": 1.57, // yaw
      "pt": -0.1, // pitch
      "v": [1.2, 0.0, 0.0], // velocity — needed for animation and interpolation
      "hp": 80,
      "st": 5, // state bitmask: 1=grounded 2=crouching 4=sprinting 8=reloading 16=dead
      "am": 23, // ammo — only sent for the receiving player
    },
  ],
  "match": { "timeLeftMs": 421000, "phase": "PLAYING" }, // "PLAYING" | "POST_MATCH"
}
```

**NET-009a** — Every living player is included regardless of line of sight — see
`FR-GP-049`.
**NET-009c** — `phase` is exactly one of `PLAYING` or `POST_MATCH`. The example above shows a
value, not the set; `FR-GP-045` requires the second one for the results period, and an
unenumerated field on the wire is a contract inferred from an example rather than stated.
**NET-009b** — Slow-changing data (nicknames, teams, scores) is **not** in the snapshot.
It arrives via `playerJoined`, `playerLeft`, and `score`.

### NET-010 — `playerJoined`

```jsonc
{ "t": "playerJoined", "id": "p_9c1b", "nickname": "ana", "team": "RED" }
```

### NET-011 — `playerLeft`

```jsonc
{ "t": "playerLeft", "id": "p_9c1b" }
```

Client must remove the model, nameplate, scoreboard row, and all interpolation state.

### NET-012 — `shot`

```jsonc
{ "t": "shot", "id": "p_7f3a", "from": [1, 2, 3], "to": [10, 2, 3], "hit": true }
```

Broadcast so all clients can render tracers, muzzle flash, and impact effects. Purely
cosmetic; carries no damage information.

### NET-013 — `damage`

Sent **only to the player who took damage**.

```jsonc
{ "t": "damage", "hp": 60, "from": "p_9c1b", "region": "TORSO", "dir": [0.7, 0, -0.7] }
```

Drives the directional damage indicator (`FR-UI-008`).

### NET-014 — `hitConfirm`

Sent **only to the player who landed the hit**.

```jsonc
{ "t": "hitConfirm", "region": "HEAD", "lethal": false }
```

Drives the hit marker. Deliberately does not reveal the victim's remaining health.

### NET-015 — `kill`

```jsonc
{ "t": "kill", "killer": "p_7f3a", "victim": "p_9c1b", "region": "HEAD" }
```

Broadcast. Drives the kill feed (`FR-UI-009`).

### NET-016 — `respawn`

```jsonc
{ "t": "respawn", "id": "p_9c1b", "p": [-30, 0, -30], "y": 0.78, "hp": 100 }
```

Broadcast. For the local player it also resets prediction state to the given transform.

### NET-017 — `score`

```jsonc
{
  "t": "score",
  "players": [{ "id": "p_7f3a", "k": 12, "d": 4 }],
  "teams": { "BLUE": 21, "RED": 18 }, // omitted in FFA
}
```

Sent on every kill and on join. Not part of the snapshot (`NET-009b`).

### NET-018 — `matchEnd`

```jsonc
{
  "t": "matchEnd",
  "reason": "TIME" | "FRAG_LIMIT",
  "winner": { "kind": "PLAYER" | "TEAM" | "DRAW", "id": "p_7f3a" },
  "standings": [ { "id": "p_7f3a", "nickname": "gabriel", "k": 20, "d": 7 } ],
  "nextMatchInMs": 15000
}
```

### NET-019 — `matchStart`

```jsonc
{ "t": "matchStart", "durationMs": 480000, "fragLimit": 20 }
```

Sent when a new match begins in the room (`FR-GP-045`).

### NET-020 — `error`

```jsonc
{ "t": "error", "code": "ROOM_FULL", "message": "This room is full." }
```

Codes: `ROOM_FULL`, `ROOM_NOT_FOUND`, `INVALID_NICKNAME`, `INVALID_MODE`,
`RATE_LIMITED`, `MALFORMED`, `INTERNAL`.
The `message` is for display; the client branches on `code`, never on `message` text.

### NET-021 — `pong`

```jsonc
{ "t": "pong", "ts": 1723900000000 }
```

---

## Deferred protocol work

### NET-022 — Binary encoding

**Status:** DEFERRED
**Statement:** Replace JSON snapshots with a packed binary format.
**Rationale:** At {MAX_PLAYERS_PER_ROOM} players and {SNAPSHOT_HZ}, JSON is comfortably
within budget. Revisit only if measurement shows bandwidth is a problem — do not
pre-optimise.

### NET-023 — Delta compression

**Status:** DEFERRED
**Statement:** Send only fields that changed since the client's last acknowledged snapshot.
**Rationale:** Same as above. Full snapshots are far simpler to debug, and debuggability
matters more than bytes at this scale.
