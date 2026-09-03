# Phase 1 Data Model: M3 — An actual match

**Feature**: `003-m3-match` · **Date**: 2026-08-22

Three groups of types, and the boundary between them matters more than any single field:

| Group                                 | Lives in           | Crosses the wire?                 |
| ------------------------------------- | ------------------ | --------------------------------- |
| Match and room state                  | `server/` **only** | Never directly — only as messages |
| Message payloads and their validators | `shared/protocol`  | Yes, all of it                    |
| Client-side roster and feed state     | `client/`          | No — derived from messages        |

The reason match state never enters `shared/` is
[research.md § R8](research.md#r8--does-any-match-logic-belong-in-shared): a client that can
compute the match state is a client that can conclude the match ended, and `NFR-001` says only the
server does that.

---

## Shared vocabulary

Small unions used by all three groups. They belong in `shared/protocol` because both runtimes
compare against them.

| Type         | Values                         | Source                                             |
| ------------ | ------------------------------ | -------------------------------------------------- |
| `GameMode`   | `'FFA' \| 'TDM'`               | `FR-GP-001`, `NET-003`                             |
| `Team`       | `'BLUE' \| 'RED'`              | `FR-GP-003`. `null` in FFA — never a third value   |
| `MatchPhase` | `'PLAYING' \| 'POST_MATCH'`    | `NET-009`'s `phase`, extended — see the note below |
| `EndReason`  | `'TIME' \| 'FRAG_LIMIT'`       | `NET-018`                                          |
| `WinnerKind` | `'PLAYER' \| 'TEAM' \| 'DRAW'` | `NET-018`, `FR-GP-044`                             |

> **`MatchPhase` is an extension, and it is flagged.** `NET-009` shows `phase` with the single
> example value `PLAYING`; the value set is not enumerated in `requirements/`. `FR-GP-045` needs a
> second value to express the results period. Recorded as an implication for
> `06-network-protocol.md` in [plan.md](plan.md#implications-for-requirements). **No requirement
> file is edited by this milestone's planning work.**

There is no `'SPECTATOR'`, no `'WAITING'`, and no third team. `FR-GP-003` says two teams;
`FR-GP-010` says a lone player lands in a **playable** match, which is what rules out a lobby
phase.

---

## Server state

### `Room`

One match container. Created by auto-match or by an explicit private-room request; destroyed when
empty. Every field is server-side and mutable — this is deliberately **not** a pure structure, and
it is the reason it lives outside `shared/`.

| Field            | Type                        | Notes                                                                            |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `id`             | `string`                    | Server-minted. `NET-008`'s `roomId`                                              |
| `mode`           | `GameMode`                  | Fixed at creation. Never reassigned (`FR-GP-002`)                                |
| `visibility`     | `'PUBLIC' \| 'PRIVATE'`     | Private rooms are never auto-match candidates (`FR-GP-011`)                      |
| `code`           | `string \| null`            | Present only for private rooms (`NET-008`)                                       |
| `players`        | `Map<PlayerId, RoomPlayer>` | Keyed by the server-assigned ID, never by nickname (`FR-GP-009`)                 |
| `match`          | `MatchState`                | Below                                                                            |
| `emptySinceTick` | `number \| null`            | `null` while anyone is connected. Drives {EMPTY_ROOM_GRACE_PERIOD} (`FR-GP-046`) |

**Capacity** is `players.size < MAX_PLAYERS_PER_ROOM`, checked **before** the player is added to
anything (`FR-GP-013`: the overflow player "is not added to the simulation" — not added and then
removed).

### `MatchState`

| Field          | Type                           | Notes                                                                                                   |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `phase`        | `MatchPhase`                   | `PLAYING` from creation — there is no waiting phase                                                     |
| `elapsedTicks` | `number`                       | The **only** clock. `timeLeftMs` is derived from it ([R4](research.md#r4--what-drives-the-match-clock)) |
| `teamScores`   | `Record<Team, number> \| null` | `null` in FFA. `NET-017` omits `teams` in FFA for the same reason                                       |
| `endReason`    | `EndReason \| null`            | Set once, when the match ends                                                                           |
| `winner`       | `Winner \| null`               | `{ kind, id }` per `NET-018`. `DRAW` carries no id                                                      |

Per-player kills and deaths live on `RoomPlayer`, not here, so that removing a player removes their
score with them in one operation — which is what `FR-GP-040` requires ("removes them from the
match immediately, **along with their score**") and what `M3-15` verifies.

**Derived, never stored:**

- `timeLeftMs` — `MATCH_DURATION − elapsedTicks × TICK_DURATION_MS`, floored at zero.
- `fragLimit` — `mode === 'TDM' ? FRAG_LIMIT_TDM : FRAG_LIMIT_FFA`.
- `leader` / `standings` — sorted from `players` on demand. Storing a cached leader is how a
  scoreboard ends up disagreeing with the scores it was computed from.

### `RoomPlayer`

| Field      | Type                | Notes                                                                                       |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `id`       | `PlayerId`          | Minted by the server at join. **Identity** (`FR-GP-009`). M1 owns the format (`NET-008`)    |
| `nickname` | `string`            | Validated, then treated as untrusted display text forever after (`NFR-012`)                 |
| `team`     | `Team \| null`      | Assigned once at join. **No setter is reachable from the network** (`FR-GP-004`, `NET-007`) |
| `kills`    | `number`            | `FR-GP-041`                                                                                 |
| `deaths`   | `number`            | Shown by `FR-UI-004` and `FR-UI-010`                                                        |
| `sim`      | _M2's player state_ | Position, health, ammo, alive. **M3 does not define this** — see `FR-GP-034`, `FR-GP-036`   |

M3 adds `nickname`, `team`, `kills` and `deaths` to whatever M1 and M2 already keep per connection.
It does not restructure their state; where this document says `sim`, the interface is theirs.

---

## Message payloads (`shared/protocol`)

Shapes are specified by `NET-003`, `NET-008`, `NET-009`, `NET-010`, `NET-017`, `NET-018`,
`NET-019` and `NET-020` and are **not restated here**. What M3 owns is the _validation_, and
`NET-002` puts validators next to the types in `shared/protocol` so client and server cannot
drift. That directory is held at **100% coverage** because it is the security boundary
(`NFR-011`, `M3-14`).

### Inbound validation — `join` (`NET-003`)

Every field, checked for presence, type and range before it reaches any game logic (`NFR-011`).
Failure produces an `error` with the code named, and the player joins nothing.

| Field      | Rule                                                                                                                                     | Error code         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `nickname` | A string; length within {NICKNAME_MIN_LENGTH}..{NICKNAME_MAX_LENGTH}; characters limited to letters, digits, `_` and `-` (`FR-GP-008`)   | `INVALID_NICKNAME` |
| `mode`     | Exactly `'FFA'` or `'TDM'` (`FR-GP-001`, `FR-GP-002`)                                                                                    | `INVALID_MODE`     |
| `roomCode` | Absent, or the literal `'NEW'`, or {ROOM_CODE_LENGTH} characters from `ROOM_CODE_ALPHABET` after upper-casing (`FR-GP-011`, `FR-GP-012`) | `ROOM_NOT_FOUND`   |
| envelope   | A second `join` on one socket is an error (`NET-003`); message size is capped by `NFR-010`, which M1 owns                                | `MALFORMED`        |

Three properties of this table are load-bearing:

- **Length is measured in code points, not UTF-16 code units.** The charset rule makes the two
  agree for accepted nicknames, but the _rejection_ must happen for the right reason, and a
  16-code-unit check that accepts a 16-emoji string is a rejection that happened by accident.
- **The charset rule is a whitelist**, never a blacklist of dangerous characters. A blacklist that
  forgets one character becomes an injection; a whitelist that forgets one character becomes a
  complaint.
- **Passing validation does not make a nickname safe to render.** It is untrusted text for the
  rest of its life. The renderer must hold on its own —
  [contracts/nickname-rendering.md](contracts/nickname-rendering.md), `M3-9`.

### Outbound

Server → client messages carry no client-authored structure other than nicknames. The `standings`
array in `NET-018` and the `nickname` in `NET-010` are the two places attacker-controlled text
leaves the server, and both land in surfaces governed by the rendering contract.

**There is no inbound message that sets a score, a team, a kill, or a match result**, and that
absence is the enforcement of `NFR-001` — `NET-007` says so explicitly. If M3 finds itself wanting
one, M3 is wrong.

---

## Client state

### `Roster`

Player ID → `{ nickname, team, kills, deaths }`, maintained from `joined`, `playerJoined`
(`NET-010`), `playerLeft` (`NET-011`) and `score` (`NET-017`). Nicknames and scores are
deliberately absent from the snapshot (`NET-009b`), so this is the only place the client learns
them. `playerLeft` removes the row, the model, the nameplate and all interpolation state —
`NET-011` is explicit, and a missed removal is `M3-15`'s ghost row.

**Display name** is derived, never stored: bare when the nickname is unique within the roster,
nickname plus player ID when it is not (`FR-GP-009`). Derived from the **ID**, never from join
order — two clients that joined at different times have different orders and would label the same
player differently, making the kill feed ambiguous about who killed whom
([R9](research.md#r9--how-the-client-knows-who-anyone-is)).

### `KillFeed`

A bounded list of `{ killerId, victimId, atMs }`, appended from `NET-015` (M2's message). Entries
older than {KILL_FEED_ENTRY_TTL} are dropped, and at most {KILL_FEED_MAX_ENTRIES} render
(`FR-UI-009`). Cleared on `matchStart`.

This is the one clock in M3 allowed to be wall-clock: it is presentation, it is local, and nothing
downstream depends on it.

### `MatchHud`

`{ timeLeftMs, phase, fragLimit, myScore, leaderScore | teamScores }`, overwritten by **every**
snapshot. The client may interpolate `timeLeftMs` downward between snapshots for smoothness, but a
snapshot always wins (`FR-UI-011`, `M3-13`). The client never concludes the match has ended; that
arrives as `NET-018`.

---

## State transitions

### Match lifecycle

```
                    room created
                         │
                         ▼
                  ┌─────────────┐
                  │   PLAYING   │  elapsedTicks++ each tick
                  └─────────────┘
                         │
    timeLeftMs <= 0  ────┤──── any player kills >= FRAG_LIMIT_FFA        (FFA)
       (FR-GP-043)       │      any team kills  >= FRAG_LIMIT_TDM        (TDM)
                         ▼
                  ┌─────────────┐   emit matchEnd (NET-018)
                  │ POST_MATCH  │   inputs ignored; nobody disconnected
                  └─────────────┘
                         │
             POST_MATCH_DURATION elapsed
                         ▼
              scores reset, all respawned,
              elapsedTicks = 0, emit matchStart (NET-019)
                         │
                         └──────────▶ PLAYING
```

Rules, each traceable:

- **The match ends exactly once.** Both conditions are evaluated in the same tick; if both hold,
  one `matchEnd` is emitted with one `reason`. Guarding on the phase — the transition only fires
  from `PLAYING` — is what makes that true, rather than ordering the two checks carefully.
- **`FRAG_LIMIT` is checked after a kill is scored**, not on a timer, so a match ends on the tick
  the limit is reached rather than up to a tick later (`FR-GP-043`).
- **Nobody is disconnected between matches** (`FR-GP-045`). The socket, the player ID, the team and
  the roster all survive; only scores and positions reset.
- **A player joining during `POST_MATCH` is added to the room, sees the results, and plays the next
  match** (`FR-GP-045`). They are not added to the finished match's standings.
- **Inputs during `POST_MATCH`** move nobody. `FR-GP-045` says play stops. Rate limiting still
  applies (`NFR-010`) — a phase is not a reason to stop validating.
- **A player who dies just before the end** does not respawn into a finished match; the respawn
  timer is reset by the restart, which grants full health and a full magazine anyway
  (`FR-GP-037`, `FR-GP-032`).

### Room lifecycle

```
        join(mode, roomCode)
                │
    ┌───────────┼────────────────────────────┐
    │           │                            │
 no code     "NEW"                    a 4-char code
    │           │                            │
    ▼           ▼                            ▼
 pick the    create PRIVATE          look up by code
 fullest     with a generated              │
 PUBLIC      code                     ┌────┴────┐
 room of     (FR-GP-011)            found    not found
 this mode      │                     │          │
 with space     │                     ▼          ▼
 (FR-GP-010)    │                  capacity?  ROOM_NOT_FOUND
    │           │                   │    │
 none? create   │              space│    │full
 a PUBLIC one   │                   ▼    ▼
    │           │                 JOIN  ROOM_FULL
    └───────────┴───────────────────┘    (FR-GP-013)
                │
                ▼
        assign team if TDM (FR-GP-004)
        spawn (FR-GP-038, M2)
        emit joined / playerJoined / score
                │
        ... players leave ...
                │
        players.size === 0  ─▶  emptySinceTick = now
                │
        EMPTY_ROOM_GRACE_PERIOD elapsed, still empty
                │
                ▼
        destroyed: removed from the registry, code released,
        no timers and no ticks continue (FR-GP-046)
```

- **A room that refills before the grace period expires clears `emptySinceTick`** and lives on. Its
  match is _not_ restarted — no requirement asks for that, and `FR-GP-014` already covers joining
  in progress.
- **Destruction releases the code.** A private code for a destroyed room must produce
  `ROOM_NOT_FOUND`, which is exactly what `FR-UI-021`'s "cleared if the server reports the room no
  longer exists" depends on in M5.
- **Auto-match never returns a `PRIVATE` room**, regardless of how full the public ones are
  (`FR-GP-011`).

### Team assignment (`FR-GP-004`)

```
count(BLUE) vs count(RED)   ──▶  fewer wins
                  equal     ──▶  injected random source picks (R5)
```

Counted over **all** members, living and dead — a dead player still occupies a slot. Assignment
happens once, at join. There is no rebalancing when players leave: `FR-GP-004` constrains
assignment and forbids switching, so a 4-v-1 produced by departures is specified behaviour, not a
gap.

---

## New constants

Needed by M3 and **absent** from [07-constants.md](../../requirements/07-constants.md). Principle
IV admits no literal anywhere else, so these must be added there and to `shared/constants` before
the code that needs them. Listed here rather than invented in prose; the requirement file is
**not** edited by this planning work — see
[plan.md § Implications](plan.md#implications-for-requirements).

| Constant                 | Suggested value                     | Why it is needed                                                                                                      |
| ------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ROOM_CODE_ALPHABET`     | `'23456789ABCDEFGHJKMNPQRSTUVWXYZ'` | 31 characters — digits and uppercase letters minus `0 O 1 I L`. `FR-GP-012` names the exclusions but not the alphabet |
| `ROOM_CODE_MAX_ATTEMPTS` | `10`                                | Bounds the collision retry in [R3](research.md#r3--room-code-generation). An unbounded loop is a hang in waiting      |

Both are tuning values, which is why they are constants rather than literals in the generator.

**Conditional — only if [`Q-006`](../../requirements/11-open-questions.md) resolves to option 2:**

| Constant        | Why                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| an idle timeout | Time with no valid `input` before a player is removed. Value is a tuning decision the owner takes with the rest of `Q-006` |

**Derived — computed, never written down** (Principle IV):

| Derived                     | From                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| `MATCH_DURATION_TICKS`      | `Math.ceil(MATCH_DURATION / TICK_DURATION_MS)` → 14 400 at 30 Hz |
| `POST_MATCH_DURATION_TICKS` | `Math.ceil(POST_MATCH_DURATION / TICK_DURATION_MS)` → 450        |
| `EMPTY_ROOM_GRACE_TICKS`    | `Math.ceil(EMPTY_ROOM_GRACE_PERIOD / TICK_DURATION_MS)` → 900    |
| `ROOM_CODE_SPACE`           | `ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH` → 923 521        |

`Math.ceil`, not integer division: a tick rate that does not divide a duration evenly must round
**up**, or a phase ends fractionally early. All three happen to divide evenly at
{SERVER_TICK_HZ} = 30, which is exactly why the rounding must be written down — the next person to
try 24 Hz will not notice.

**Already present and used unchanged:** {MAX_PLAYERS_PER_ROOM}, {MATCH_DURATION},
{FRAG_LIMIT_FFA}, {FRAG_LIMIT_TDM}, {POST_MATCH_DURATION}, {EMPTY_ROOM_GRACE_PERIOD},
{NICKNAME_MIN_LENGTH}, {NICKNAME_MAX_LENGTH}, {ROOM_CODE_LENGTH}, {KILL_FEED_MAX_ENTRIES},
{KILL_FEED_ENTRY_TTL}, {MIN_SPAWN_POINTS}, {TICK_DURATION_MS}.

---

## Map data M3 adds

`FR-MAP-008` requires `BLUE` and `RED` spawns clustered at opposite ends of the arena, with `ANY`
spawns unused in TDM; `FR-MAP-007` requires at least {MIN_SPAWN_POINTS} spawn points so
`FR-GP-038` can usually satisfy {MIN_SPAWN_DISTANCE} with a full room.

The schema already carries `spawns[].team` — M0 validates it and uses none of it
([M0's map contract](../000-m0-walking-box/contracts/map-schema.md)). M3 is where it starts to
mean something. Nothing in `shared/map` changes; the change is **content**.

**As at M0: the data is final, the design is not.** M3 adds enough team-tagged spawns for TDM to
work in the blockout. `FR-MAP-004`, `FR-MAP-005` and `FR-MAP-009` — the real level design — remain
M4's, and M3 must not pull that work forward (Principle V).
