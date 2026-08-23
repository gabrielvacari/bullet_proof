# Contract: the room and its match

**Feature**: `003-m3-match` · **Consumers**: `server/matchmaker`, `server/net`, and the tick
scheduler.

**Requirements**: `FR-GP-010`–`FR-GP-014`, `FR-GP-041`–`FR-GP-046`, `NFR-001`, `NFR-002`,
`NFR-004`, `NFR-015`.

This is the contract that makes the demo criterion testable. Everything in it exists so that "a
full match runs start to finish and restarts on its own" can be proven in a unit test rather than
watched for eight minutes.

---

## Shape

```ts
// server/room — one match. Server-side only; never imported by client/.
export function createRoom(options: RoomOptions): Room;

export interface RoomOptions {
  mode: GameMode;
  visibility: 'PUBLIC' | 'PRIVATE';
  code: string | null;
  map: GameMap;
  random: RandomSource; // injected — R5
}

export interface Room {
  tick(): void; // advance exactly one server tick
  join(conn: Connection, nickname: string): JoinResult;
  leave(playerId: PlayerId): void;
  destroy(): void;
  readonly isEmpty: boolean;
  readonly canAccept: boolean; // players.size < MAX_PLAYERS_PER_ROOM
}
```

`Connection` and the socket-facing half of `join` belong to M1 (`NET-003`, `NFR-010`,
`NFR-011`). This contract does not re-specify them.

---

## Guarantees

| #   | Guarantee                                                                                                                                           | Why                             | Proven by                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| G1  | **The room does not own its clock.** `tick()` advances exactly one tick and reads no wall clock. The caller decides when                            | `NFR-004`-adjacent; testability | A test advancing `MATCH_DURATION_TICKS` in a loop |
| G2  | **`tick()` never throws out of the room** for any state reachable through this API                                                                  | `NFR-015`                       | The scheduler's isolation test, `M3-11`           |
| G3  | **No method sets health, position, score, team, or kill status from client data.** `join` takes a nickname and nothing else that reaches game state | `NFR-001`, `NET-007`            | Signature review + protocol review                |
| G4  | **The match ends exactly once**, with one `reason`, even when both conditions hold in the same tick                                                 | `FR-GP-043`                     | A test forcing both simultaneously                |
| G5  | **Restart preserves every connection.** Scores reset, players respawn, nobody's socket closes and nobody's ID changes                               | `FR-GP-045`                     | A restart test asserting IDs and sockets survive  |
| G6  | **Randomness enters only through `options.random`.** No `Math.random`, no `crypto` call inside room logic                                           | `NFR-004`                       | A stub source; a grep test                        |
| G7  | **`destroy()` leaves nothing running.** No timer, no interval, no pending callback, and the room is unreachable from the registry                   | `FR-GP-046`                     | A destruction test asserting no further ticks     |
| G8  | **Rooms never address each other.** No broadcast reaches a socket outside the room; no shared mutable state exists between rooms                    | `NFR-015`                       | A two-room test asserting message isolation       |

G1 mirrors `shared/sim`'s contract, where the caller owns the accumulator loop
([M0's sim contract](../../000-m0-walking-box/contracts/sim-api.md)). The reasoning is the same
in both places: a component that schedules itself cannot be driven by a test, and a match
lifecycle that can only be observed in real time is a match lifecycle that is never tested.

G2 deserves emphasis. `NFR-015` requires an exception in one room's tick not to stop another's, and
that is enforced **outside** the room, in the scheduler:

```ts
for (const room of rooms.values()) {
  try {
    room.tick();
  } catch (err) {
    log(err);
    destroyRoom(room, 'INTERNAL'); // R1 — a half-ticked room's state is unknown
  }
}
```

Continuing to tick a room whose invariants may be broken is how ghost players are born — the class
of bug `D-009` was taken specifically to eliminate.

---

## `join` results

| Result             | When                                    | Requirement            |
| ------------------ | --------------------------------------- | ---------------------- |
| joined             | Capacity available, nickname valid      | `FR-GP-014`            |
| `ROOM_FULL`        | `players.size === MAX_PLAYERS_PER_ROOM` | `FR-GP-013`            |
| `INVALID_NICKNAME` | Fails `FR-GP-008`                       | `FR-GP-007`, `NFR-011` |

**Capacity is checked before the player is added to anything.** `FR-GP-013` says the overflow
player "is not added to the simulation" — not added and then removed. An add-then-check
implementation broadcasts a `playerJoined` for a player who is about to vanish, and every client
then has a row that never fills in.

**Joining mid-match** places the player in the arena within one tick with a score of zero and the
room's actual `timeLeftMs` (`FR-GP-014`). Joining during `POST_MATCH` places them in the room but
not in the finished match's standings (`FR-GP-045`).

---

## The matchmaker

```ts
export interface Matchmaker {
  autoMatch(mode: GameMode): Room; // never returns a PRIVATE room
  createPrivate(mode: GameMode): Room; // returns a room with a code
  byCode(code: string): Room | null; // upper-cases before lookup
}
```

| Rule                                                                                       | Requirement                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `autoMatch` picks the **fullest** public room of that mode with space; creates one if none | `FR-GP-010`, [R2](../research.md#r2--which-room-does-auto-match-pick) |
| `autoMatch` never returns a private room, no matter how full the public ones are           | `FR-GP-011`                                                           |
| A room in `POST_MATCH` is a valid auto-match candidate                                     | `FR-GP-045`                                                           |
| Codes are {ROOM_CODE_LENGTH} characters from `ROOM_CODE_ALPHABET`, generated with retry    | `FR-GP-012`, [R3](../research.md#r3--room-code-generation)            |
| `byCode` upper-cases and does nothing else — no glyph substitution                         | `FR-GP-012`                                                           |
| A destroyed room's code is released and subsequently returns `null`                        | `FR-GP-046`                                                           |
| Mode is never reassigned: a TDM request never lands in an FFA room                         | `FR-GP-002`                                                           |

---

## Emitted messages

The room emits; it does not decide transport. Shapes are `requirements/06-network-protocol.md`'s
and are not restated.

| Event                         | Message                   | Audience                   |
| ----------------------------- | ------------------------- | -------------------------- |
| A player joins                | `joined` / `playerJoined` | The joiner / everyone else |
| A player leaves or is removed | `playerLeft`              | Everyone remaining         |
| Any kill                      | `score`                   | Everyone (`NET-017`)       |
| A player joins                | `score`                   | Everyone (`NET-017`)       |
| Match ends                    | `matchEnd`                | Everyone (`NET-018`)       |
| Match begins                  | `matchStart`              | Everyone (`NET-019`)       |
| Every snapshot                | the `match` block         | Everyone (`NET-009`)       |

`NET-017` omits `teams` in FFA, and `NET-008`'s `team` is `null` in FFA. FFA carries no team field
anywhere — `FR-GP-006` says no team field is meaningful, and a `null` that surfaces as a colour in
the HUD is `FR-GP-006`'s acceptance criterion failing.

---

## Scoring and the end conditions

| Rule                                                                                         | Requirement              |
| -------------------------------------------------------------------------------------------- | ------------------------ |
| A kill awards exactly 1 point to the killer; the victim's score is unchanged                 | `FR-GP-041`              |
| In TDM the same kill also increments the killer's team total                                 | `FR-GP-041`              |
| A teammate cannot be killed at all — the raycast excludes them (M2's cast, M3's team data)   | `FR-GP-005`, `FR-GP-025` |
| The only way to die is enemy fire; there is no self-damage and no environmental death        | `FR-GP-042`              |
| Ends on `timeLeftMs <= 0`, or a player at {FRAG_LIMIT_FFA}, or a team at {FRAG_LIMIT_TDM}    | `FR-GP-043`              |
| The winner is the top player (FFA) or top team (TDM); level scores are a `DRAW`, no overtime | `FR-GP-044`              |
| A leaving player's score leaves with them, within one tick, and standings recompute          | `FR-GP-040`, `M3-15`     |

**`FR-GP-042` is worth naming here** even though M2 owns damage: it guarantees that the only path
into `kills` and `deaths` is an enemy's shot. That is what makes scoring a small piece of code
rather than a set of cases about falls, suicides and out-of-bounds.

**A draw is a real outcome, not a fallback.** `FR-GP-044` is explicit that a 10–10 TDM match
displays a draw. Sorting the standings and taking the first row silently converts every tie into a
win for whoever happens to sort first, which is the bug this line exists to prevent.
