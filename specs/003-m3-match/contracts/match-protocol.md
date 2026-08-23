# Contract: the M3 additions to the wire protocol

**Feature**: `003-m3-match` · **Consumers**: `shared/protocol` (types and validators),
`server/net`, `client/net`.

**Requirements**: `NET-002`, `NET-003`, `NET-007`, `NET-008`, `NET-009`, `NET-010`, `NET-017`,
`NET-018`, `NET-019`, `NET-020`, `NFR-001`, `NFR-011`.

**Message shapes are specified in
[06-network-protocol.md](../../../requirements/06-network-protocol.md) and are not restated
here.** This contract covers what M3 owns: which messages it turns on, what the validators must
reject, and the two invariants that are easy to break by accident.

---

## What M3 turns on

| Message                    | M3's part                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `join` (`NET-003`)         | The `mode` and `roomCode` fields start routing. M1 owns the envelope and the socket    |
| `joined` (`NET-008`)       | `mode`, `team`, `roomCode` become meaningful. `config` (`NET-008a`) gains M3 constants |
| `snapshot` (`NET-009`)     | The `match` block: `timeLeftMs` and `phase`                                            |
| `playerJoined` (`NET-010`) | `team` becomes non-`null` in TDM                                                       |
| `score` (`NET-017`)        | **New in M3** — on every kill and on every join                                        |
| `matchEnd` (`NET-018`)     | **New in M3**                                                                          |
| `matchStart` (`NET-019`)   | **New in M3**                                                                          |
| `error` (`NET-020`)        | `ROOM_FULL`, `ROOM_NOT_FOUND`, `INVALID_NICKNAME`, `INVALID_MODE` start being emitted  |

Not M3's: `input`, `ping`, `leave`, `pong` (M1); `shot`, `damage`, `hitConfirm`, `kill`,
`respawn` (M2). M3 **subscribes** to `kill` for scoring and the kill feed; it does not own it.

---

## P1 — Validators live in `shared/protocol` and are exhaustive

`NET-002` requires validators next to the message types so client and server cannot drift.
`shared/protocol/**` is held at **100% coverage**, which means every rejection branch needs a
test — that is the point of the threshold, not an obstacle to it.

The `join` field rules and their error codes are tabulated in
[data-model.md § Inbound validation](../data-model.md#inbound-validation--join-net-003). Three
properties that the table states and that a test must pin down:

- Nickname length is counted in **code points**, so the rejection happens for the stated reason
  rather than by accident.
- The charset is a **whitelist** (`FR-GP-008`), never a blacklist of dangerous characters.
- `roomCode` is upper-cased before it is validated or looked up, and nothing else is normalised
  ([R3](../research.md#r3--room-code-generation)).

**Validation happens before any game logic** (`NFR-011`). A rejected `join` adds the player to no
room, mutates no state, and emits exactly one `error`.

## P2 — There is no message that asserts an outcome

`NET-007` says it directly: no client message exists for dealing damage, scoring a kill, setting
position, **changing team**, or **ending a match**. M3 is the milestone with the most temptation
here, because it is the milestone that introduces teams, scores and match ends.

The enforcement is the absence of the message, not a check inside a handler. Concretely, M3 must
not add:

- a `setTeam` / `switchTeam` / `selectTeam` message — `FR-GP-004` says the server assigns and
  players cannot switch;
- a `readyUp` / `startMatch` message — `FR-GP-010` requires no lobby, and `FR-GP-045` restarts the
  match on its own;
- a `reportScore` of any shape;
- a `rejoin` carrying a previous player ID or session token — `D-009` and `FR-GP-040` make a
  reconnecting player a **new** player, which is what removes an entire class of ghost-player bugs.

If a plan or a task wants one of these, the plan is wrong (Constitution, Principle III).

## P3 — The snapshot stays thin

`NET-009b` keeps nicknames, teams and scores **out** of the snapshot: they change slowly and
arrive through `playerJoined`, `playerLeft` and `score`. M3 adds only the `match` block.

The temptation is to fold scores into the snapshot "for consistency" — at {SNAPSHOT_HZ} × up to
{MAX_PLAYERS_PER_ROOM} players that is a nickname string resent 20 times a second, forever, so
that the scoreboard can avoid keeping a roster. Don't. The roster
([R9](../research.md#r9--how-the-client-knows-who-anyone-is)) is small, ordered delivery over TCP
makes it reliable, and this is the design decision that keeps `NET-022`/`NET-023` comfortably
`DEFERRED`.

## P4 — `config` carries M3's constants

`NET-008a` sends the client-relevant tuning constants at join time so the client cannot run with
stale or divergent values. M3 adds the ones its HUD needs: {MATCH_DURATION}, the mode's frag limit,
{POST_MATCH_DURATION}, {KILL_FEED_MAX_ENTRIES}, {KILL_FEED_ENTRY_TTL}.

The client **imports** these from `shared/constants` too — they are the same module — so `config`
is a consistency check, not the source. The value of `NET-008a` is that a stale client bundle is
detectable rather than silently wrong.

`fragLimit` is also carried by `matchStart` (`NET-019`), which is what a client joining mid-match
uses. Both are derived from {FRAG_LIMIT_FFA} / {FRAG_LIMIT_TDM} by mode; neither is written down
twice (`SC-4`, `M3-12`).

## P5 — Every string that crosses to a client is display text

`nickname` in `NET-010`, the nicknames inside `NET-018`'s `standings`, `roomCode` in `NET-008`,
and `message` in `NET-020` all reach the DOM. Every one of them goes through the sink in
[contracts/nickname-rendering.md](nickname-rendering.md).

`NET-020` also requires the client to branch on `code` and **never** on `message` text, which
keeps the one server-authored string purely presentational.

---

## Required tests

| Test                                                                                       | Criterion |
| ------------------------------------------------------------------------------------------ | --------- |
| Every `join` rejection branch: bad nickname, bad mode, bad code, second join on one socket | `M3-14`   |
| A `join` with an unknown room code produces `ROOM_NOT_FOUND` and joins nothing             | `M3-8`    |
| A `join` into a full room produces `ROOM_FULL` and adds no player                          | `M3-8`    |
| Room codes round-trip through any letter case                                              | `M3-7`    |
| `score` omits `teams` in FFA and includes both teams in TDM                                | `M3-4`    |
| `matchEnd` carries `DRAW` with no winner id when scores are level, in both modes           | `M3-3`    |
| Exactly one `matchEnd` is emitted when both end conditions hold in the same tick           | `M3-2`    |
| No protocol type or handler exists for setting a team, a score, or a match result          | `M3-4`    |
