# Feature Specification: M3 — An actual match

**Milestone**: `M3` in [08-roadmap.md](../../requirements/08-roadmap.md) · **Tag on completion**: `v0.4.0`

**Created**: 2026-08-22

**Status**: Draft — planned ahead of its dependencies. **M3 must not be implemented until M1 and
M2 have met their demo criteria** (Constitution, Principle V).

**Demo criterion**: A full match runs start to finish and restarts on its own.

> This spec **cites** requirement IDs; it does not restate them (Constitution, Principle I).
> Where this document and [`requirements/`](../../requirements/README.md) disagree,
> `requirements/` wins and this file is the bug.

---

## Objective

Turn a shooting range into a game. After M2 two players can kill each other and respawn, but
nothing counts, nothing ends, and there is no way in except a hardcoded one. M3 adds the three
things that make those kills mean something:

1. **A match** — a clock, a frag limit, an end, a result, and an automatic restart
   (`FR-GP-041`–`FR-GP-045`).
2. **Sides** — FFA where everyone is hostile, and TDM where they are not (`FR-GP-001`–`FR-GP-006`).
3. **A way in** — a start screen, auto-match, and private room codes (`FR-UI-001`,
   `FR-GP-007`–`FR-GP-014`).

M3 is also the milestone where the server stops managing **one** room and starts managing **many**.
That is the real architectural change here, and it is the one most likely to be underestimated: a
room becomes a thing with a lifecycle — created, played, restarted, emptied, destroyed — and
`NFR-015` requires each one to be genuinely isolated, including against an exception thrown inside
another room's tick.

M3 is also the first milestone that renders **attacker-controlled text**. Nicknames arrive from
clients and are drawn in the scoreboard, the kill feed, and the results screen. `NFR-012` is a
security requirement, not a formatting preference, and this spec treats it as the milestone's
second non-negotiable after the demo criterion — see
[contracts/nickname-rendering.md](contracts/nickname-rendering.md).

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Play a match that starts, ends, and starts again (Priority: P1)

Two players are in the arena. Kills accumulate into a score they can see. A timer counts down. When
the clock runs out or someone reaches the frag limit, play stops, a results screen shows who won,
and after a short pause a fresh match begins with the scores reset — without anyone clicking
anything and without anyone being disconnected.

**Why this priority**: This _is_ the demo criterion. It is also the piece that cannot be faked: a
match lifecycle either runs on its own or it does not.

**Independent Test**: Two browsers, one room, FFA. Delivering only this story already demonstrates
the milestone's headline claim. Testable end to end by lowering {MATCH_DURATION} and
{FRAG_LIMIT_FFA} in `shared/constants` — which is itself a check on `SC-4`.

**Acceptance Scenarios**:

1. **Given** a match is running, **When** a player kills another, **Then** the killer's score
   increases by exactly 1 and the victim's score is unchanged (`FR-GP-041`).
2. **Given** a match is running, **When** {MATCH_DURATION} elapses, **Then** the match ends with
   reason `TIME` (`FR-GP-043`).
3. **Given** a match is running, **When** one player reaches {FRAG_LIMIT_FFA} kills before the
   clock expires, **Then** the match ends immediately with reason `FRAG_LIMIT` (`FR-GP-043`).
4. **Given** a match has ended, **When** the results screen is shown, **Then** it lists every
   player's kills and deaths sorted by score descending, names the winner, and counts down to the
   next match (`FR-UI-004`, `FR-GP-044`).
5. **Given** the results screen is showing, **When** {POST_MATCH_DURATION} elapses, **Then** a new
   match begins in the same room with every score reset to zero and every player respawned —
   **and nobody is disconnected** (`FR-GP-045`).
6. **Given** two players finish level on score in FFA, **When** the match ends, **Then** the result
   is a draw; no overtime is played and no arbitrary winner is picked (`FR-GP-044`).
7. **Given** a match is running, **When** the player looks at the HUD, **Then** remaining time and
   the score relative to the frag limit are visible, and the timer resynchronises from server
   state rather than free-running on a local clock (`FR-UI-011`).
8. **Given** a player joins a match with time remaining, **When** they enter the arena, **Then**
   they spawn within one tick with a score of zero and the **correct** remaining time on their HUD
   (`FR-GP-014`).

---

### User Story 2 — Play as a team without shooting your own side (Priority: P2)

A player picks TDM. The server puts them on `BLUE` or `RED` — they do not choose. Their teammates
are visibly distinguished, their bullets pass straight through them, and the score that matters is
the team's.

**Why this priority**: TDM is half of `FR-GP-001`, and no friendly fire is the rule most likely to
be got subtly wrong: `FR-GP-005` requires teammate hit volumes to be **excluded from the raycast
entirely**, not merely to deal zero damage. A teammate must not stop a bullet.

**Independent Test**: Three browsers in one TDM room. Fire at a teammate at point-blank range, then
fire at an enemy standing directly behind a teammate.

**Acceptance Scenarios**:

1. **Given** an empty TDM room, **When** players join one at a time, **Then** each is assigned to
   the smaller team, ties are broken randomly, and the team sizes never differ by more than 1
   (`FR-GP-004`).
2. **Given** a TDM match, **When** a client sends any message attempting to set or change a team,
   **Then** nothing changes — no such message exists in the protocol (`FR-GP-004`, `NET-007`).
3. **Given** a TDM match, **When** a player fires at a teammate at point-blank range, **Then** the
   teammate's health is unchanged and there is no hit marker, no damage event, and no kill
   (`FR-GP-005`).
4. **Given** an enemy standing directly behind a teammate, **When** the player fires at the enemy,
   **Then** the enemy is hit — the teammate does not block the shot (`FR-GP-005`, `FR-GP-025`).
5. **Given** a TDM match, **When** a player scores a kill, **Then** 1 point is added to both their
   personal score and their team's total (`FR-GP-041`).
6. **Given** a TDM match, **When** one team reaches {FRAG_LIMIT_TDM}, **Then** the match ends and
   that team is the winner (`FR-GP-043`, `FR-GP-044`).
7. **Given** a TDM match ending with the teams level, **When** the results screen is shown,
   **Then** it shows a draw (`FR-GP-044`).
8. **Given** an FFA match, **When** the player looks at the HUD, **Then** no team colours appear
   anywhere, and every other player is a valid target (`FR-GP-006`).
9. **Given** a TDM match, **When** players spawn, **Then** they spawn among the spawn points tagged
   for their team, clustered at opposite ends of the arena; `ANY` spawns are unused
   (`FR-MAP-008`, `FR-GP-038`).

---

### User Story 3 — Get from a cold page into a match (Priority: P3)

A stranger opens the page, types a nickname, picks a mode, and clicks Play. They land in a match
even if nobody else is online. Someone who wants to play with a specific friend creates a private
room instead and reads them a short code over a call.

**Why this priority**: `SC-1` — ten seconds from opening the page to the first shot — is a
project-level success criterion, and `FR-UI-001` is the screen that has to deliver it. It sits
behind US1 and US2 only because a match must exist before there is any point entering one.

**Independent Test**: One browser and a cold page. Click Play with nobody else online; then create
a private room from a second browser and join it from a third.

**Acceptance Scenarios**:

1. **Given** the start screen, **When** it loads, **Then** it contains a nickname field, an
   FFA/TDM selector, a primary Play action, a "create private room" action, and a "join with code"
   input — **and nothing else**: no tutorial, no settings, no login (`FR-UI-001`).
2. **Given** an empty or invalid nickname, **When** the player looks at the Play button, **Then**
   it is disabled (`FR-GP-007`).
3. **Given** a client that bypasses the page and sends a `join` with a nickname that is empty, 200
   characters long, or contains `<script>alert(1)</script>`, **When** the server processes it,
   **Then** it is rejected with an `error` and the player is not added to any room
   (`FR-GP-008`, `NFR-011`, `NET-020`).
4. **Given** nobody else is online, **When** a player clicks Play, **Then** the server creates a
   public room of the chosen mode and the player lands in a playable match (`FR-GP-010`).
5. **Given** a public room of the chosen mode with space, **When** a player clicks Play, **Then**
   they are placed in that room rather than a new one (`FR-GP-010`).
6. **Given** a player creating a private room, **When** the room is created, **Then** they receive
   a code of {ROOM_CODE_LENGTH} characters drawn from an alphabet with no visually ambiguous
   glyphs, and that room is never returned by auto-match (`FR-GP-011`, `FR-GP-012`).
7. **Given** a valid room code typed in any letter case, **When** a second player submits it,
   **Then** they join the same match (`FR-GP-012`).
8. **Given** a code for a room that has been destroyed or never existed, **When** a player submits
   it, **Then** they get an `error` with code `ROOM_NOT_FOUND` and stay on the start screen
   (`NET-020`).
9. **Given** a room already holding {MAX_PLAYERS_PER_ROOM} players, **When** another player tries
   to join it, **Then** they receive `ROOM_FULL` and are **not** added to the simulation
   (`FR-GP-013`).
10. **Given** two players joining with the same nickname, **When** both connect, **Then** both
    succeed and are distinguishable in the scoreboard and kill feed by a disambiguating suffix —
    identity is the server-assigned player ID, never the nickname (`FR-GP-009`).

---

### User Story 4 — See who is winning and who killed whom (Priority: P4)

Holding `Tab` shows every player's kills and deaths while the match keeps running behind it. Recent
kills scroll past as short entries. In TDM both are coloured by team.

**Why this priority**: The match is playable without either surface, which is why they sit last —
but the milestone is not finished without them, and this is where the milestone's **security**
work lands: the scoreboard, the kill feed, and the results screen are the first three places in
the project where one player's text is drawn in another player's browser.

**Independent Test**: Three browsers in one room. Hold `Tab` during a firefight; confirm the match
keeps running behind the overlay and that entries expire on their own.

**Acceptance Scenarios**:

1. **Given** a match in progress, **When** the player holds `Tab`, **Then** a scoreboard shows
   every player's nickname, kills, and deaths sorted by kills descending, and the match continues
   to run behind it; releasing `Tab` hides it (`FR-UI-010`).
2. **Given** a TDM match, **When** the scoreboard is shown, **Then** players are grouped by team
   and team totals are displayed (`FR-UI-010`).
3. **Given** a kill occurs, **When** the next snapshot arrives, **Then** a `<killer> killed
<victim>` entry appears, and it disappears after {KILL_FEED_ENTRY_TTL} (`FR-UI-009`).
4. **Given** more than {KILL_FEED_MAX_ENTRIES} kills in quick succession, **When** the feed
   renders, **Then** at most {KILL_FEED_MAX_ENTRIES} entries are shown (`FR-UI-009`).
5. **Given** a nickname that passes server validation, **When** it is rendered in the scoreboard,
   the kill feed, or the results screen, **Then** it appears as **text** and cannot execute script
   in another player's browser (`NFR-012`, `FR-UI-009`).
6. **Given** a hostile string is fed **directly** to a rendering surface, bypassing the validator
   entirely, **When** the surface renders, **Then** no element node is created from it and no
   script runs — the rendering layer is safe on its own, not only because the validator is
   (`NFR-012`).

---

### Edge Cases

- **Both end conditions in the same tick.** The clock expires on the tick a player reaches the
  frag limit. The match must end exactly once, with one `reason`, and must not emit two
  `matchEnd` messages (`FR-GP-043`, `NET-018`).
- **A player dies as the match ends.** Death, the respawn countdown, and the match end overlap.
  The player must not respawn into a match that has ended, and must not be stuck in a death
  overlay through the results screen (`FR-GP-037`, `FR-GP-045`).
- **Someone joins during the results screen.** They are placed into the **next** match, not the
  finished one, and never see a stale scoreboard as if it were live (`FR-GP-045`).
- **The leader disconnects.** `FR-GP-040` removes the player _and their score_ within one tick.
  Standings recompute; the match continues; no ghost row remains in the scoreboard.
- **Everyone disconnects mid-match.** The room has zero players and a running tick loop. See
  `FR-GP-046` and the ownership question raised in [Assumptions](#assumptions).
- **Team sizes drift after disconnects.** `FR-GP-004` constrains assignment at **join** time only,
  and `FR-GP-004` also forbids switching teams. A 4-v-1 caused by four players leaving is
  therefore correct behaviour, not a bug. Nothing rebalances mid-match.
- **A room code collides with an existing one.** Generation must retry rather than hand two rooms
  the same code, and must terminate rather than loop forever when the code space is crowded.
- **A room code containing an excluded glyph is submitted.** `O`, `0`, `I`, `1`, `L` cannot appear
  in a generated code (`FR-GP-012`); a submitted code containing one cannot match any room.
- **Auto-match must never leak a private room.** A private room with space is not a candidate, no
  matter how full the public rooms are (`FR-GP-011`).
- **An exception is thrown inside one room's tick.** The other rooms keep ticking. `NFR-015`
  makes this a requirement, and multi-room is what first makes it testable.
- **A player idles in the pointer-lock-released state.** `FR-GP-021` keeps them in the match and
  killable, which over a full match leaves a stationary free kill. **Unresolved —
  [`Q-006`](../../requirements/11-open-questions.md).** M3 must not guess; see
  [research.md § R6](research.md) and the gate in [plan.md](plan.md#blocking-gates).
- **A nickname of maximum length in every surface.** {NICKNAME_MAX_LENGTH} is specified as "must
  fit a nameplate and a scoreboard row" — a full-length nickname must not break the scoreboard,
  kill feed, or results layout.
- **Two players with identical nicknames on opposite teams.** The disambiguating suffix
  (`FR-GP-009`) must be present in both the scoreboard and the kill feed, so a kill entry is never
  ambiguous about who killed whom.
- **A match ends while the scoreboard is held open.** The overlay must give way to the results
  screen rather than sitting on top of it.
- **The very first match in a brand-new room.** There is no waiting-for-players phase: `FR-GP-010`
  requires a single player clicking Play to land in a playable match, so the clock starts when the
  room is created.

---

## Requirements _(mandatory)_

This project's requirement IDs are permanent and live in
[`requirements/`](../../requirements/README.md). M3 mints none. It must satisfy these:

### Modes and teams

| ID                                               | What M3 must satisfy                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| [`FR-GP-001`](../../requirements/02-gameplay.md) | Exactly two modes, FFA and TDM, both producing a playable match         |
| [`FR-GP-002`](../../requirements/02-gameplay.md) | Mode chosen before connecting; the server never reassigns it            |
| [`FR-GP-003`](../../requirements/02-gameplay.md) | TDM has exactly two teams, `BLUE` and `RED`                             |
| [`FR-GP-004`](../../requirements/02-gameplay.md) | Server-side assignment to the smaller team; random tie-break; no switch |
| [`FR-GP-005`](../../requirements/02-gameplay.md) | No friendly fire — teammates excluded from the raycast entirely         |
| [`FR-GP-006`](../../requirements/02-gameplay.md) | FFA has no teams and no team colours                                    |

### Joining

| ID                                               | What M3 must satisfy                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`FR-GP-007`](../../requirements/02-gameplay.md) | Nickname mandatory; Play disabled until valid; server rejects likewise              |
| [`FR-GP-008`](../../requirements/02-gameplay.md) | Nickname charset and length validated on **both** sides; server final               |
| [`FR-GP-009`](../../requirements/02-gameplay.md) | Nicknames are not unique; identity is the player ID; suffix disambiguates           |
| [`FR-GP-010`](../../requirements/02-gameplay.md) | Auto-match: Play always lands in a playable match                                   |
| [`FR-GP-011`](../../requirements/02-gameplay.md) | Private rooms by code; never returned by auto-match                                 |
| [`FR-GP-012`](../../requirements/02-gameplay.md) | Code format: {ROOM_CODE_LENGTH} chars, unambiguous alphabet, case-insensitive entry |
| [`FR-GP-013`](../../requirements/02-gameplay.md) | Capacity {MAX_PLAYERS_PER_ROOM}; overflow gets `ROOM_FULL` and is not simulated     |
| [`FR-GP-014`](../../requirements/02-gameplay.md) | Join in progress: spawn within one tick, score zero, correct time left              |

### Match flow

| ID                                               | What M3 must satisfy                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`FR-GP-041`](../../requirements/02-gameplay.md) | 1 point per kill, server-side only; TDM also credits the team                           |
| [`FR-GP-043`](../../requirements/02-gameplay.md) | Ends on {MATCH_DURATION}, {FRAG_LIMIT_FFA}, or {FRAG_LIMIT_TDM}                         |
| [`FR-GP-044`](../../requirements/02-gameplay.md) | Winner is highest player (FFA) or team (TDM); ties are draws                            |
| [`FR-GP-045`](../../requirements/02-gameplay.md) | Results for {POST_MATCH_DURATION}, then restart in place, nobody dropped                |
| [`FR-GP-046`](../../requirements/02-gameplay.md) | Empty rooms destroyed after {EMPTY_ROOM_GRACE_PERIOD} — see [Assumptions](#assumptions) |

### UI

| ID                                            | What M3 must satisfy                                             |
| --------------------------------------------- | ---------------------------------------------------------------- |
| [`FR-UI-001`](../../requirements/03-ui-ux.md) | Start screen: nickname, mode, Play, create private, join by code |
| [`FR-UI-004`](../../requirements/03-ui-ux.md) | Results screen: standings, winner, countdown; TDM team totals    |
| [`FR-UI-009`](../../requirements/03-ui-ux.md) | Kill feed with TTL, entry cap, team colours, text-only names     |
| [`FR-UI-010`](../../requirements/03-ui-ux.md) | `Tab` scoreboard, sorted, grouped by team in TDM                 |
| [`FR-UI-011`](../../requirements/03-ui-ux.md) | Match timer and frag progress, resynchronised from server state  |

### Map

| ID                                           | What M3 must satisfy                                                |
| -------------------------------------------- | ------------------------------------------------------------------- |
| [`FR-MAP-007`](../../requirements/04-map.md) | Enough spawn points for `FR-GP-038` to hold with a full room        |
| [`FR-MAP-008`](../../requirements/04-map.md) | `BLUE`/`RED` spawns clustered at opposite ends; `ANY` unused in TDM |

### Architecture and protocol

| ID                                                     | What M3 must satisfy                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| [`NFR-001`](../../requirements/05-architecture.md)     | No client message sets a score, a team, or a match outcome           |
| [`NFR-002`](../../requirements/05-architecture.md)     | Every room lives in the memory of one Node process                   |
| [`NFR-004`](../../requirements/05-architecture.md)     | Team assignment and spawn choice are randomness **outside** the step |
| [`NFR-011`](../../requirements/05-architecture.md)     | `nickname`, `mode`, and `roomCode` validated before any game logic   |
| [`NFR-012`](../../requirements/05-architecture.md)     | Nicknames reach the DOM as text, in every surface, always            |
| [`NFR-015`](../../requirements/05-architecture.md)     | Rooms isolated; one room's exception does not stop another's tick    |
| [`NET-003`](../../requirements/06-network-protocol.md) | `join` carries `mode` and optional `roomCode` (`"NEW"` creates)      |
| [`NET-008`](../../requirements/06-network-protocol.md) | `joined` returns `mode`, `team`, `roomCode`, and the config          |
| [`NET-009`](../../requirements/06-network-protocol.md) | The snapshot's `match` block carries `timeLeftMs` and `phase`        |
| [`NET-010`](../../requirements/06-network-protocol.md) | `playerJoined` carries `nickname` and `team`                         |
| [`NET-017`](../../requirements/06-network-protocol.md) | `score` on every kill and on join; `teams` omitted in FFA            |
| [`NET-018`](../../requirements/06-network-protocol.md) | `matchEnd` with reason, winner, standings, and `nextMatchInMs`       |
| [`NET-019`](../../requirements/06-network-protocol.md) | `matchStart` when a new match begins in the room                     |
| [`NET-020`](../../requirements/06-network-protocol.md) | `ROOM_FULL`, `ROOM_NOT_FOUND`, `INVALID_NICKNAME`, `INVALID_MODE`    |
| [`SC-1`](../../requirements/01-vision.md)              | Page open to first shot in under ten seconds                         |
| [`SC-4`](../../requirements/01-vision.md)              | Match length and frag limits change by editing constants only        |

### Key Entities

- **Room** — one match container: its mode, its visibility (public or private), its code if
  private, its connected players, its match state, and its own tick loop. Rooms are created by
  auto-match or on request and destroyed when empty. `NFR-015` makes isolation between them a
  requirement, and `NFR-002` keeps every one of them in a single process's memory.
- **MatchState** — the clock, the phase, the per-player scores, and the team totals in TDM. Lives
  on the server. It is the answer to "what is `timeLeftMs` and is play running?", and it is what
  `NET-018` and `NET-019` announce transitions of. **No client message can write to it**
  (`NFR-001`, `NET-007`).
- **Player identity** — the server-assigned player ID, permanently. The nickname is a display
  label attached to it, not a key: `FR-GP-009` allows duplicates, and `FR-GP-040` gives a
  reconnecting player a **new** ID rather than restoring an old one (`D-009`).
- **Team** — `BLUE` or `RED` in TDM, `null` in FFA. Assigned once, at join, by the server
  (`FR-GP-004`). It has no setter reachable from the network.
- **Scoreboard row** — a nickname, kills, and deaths, derived on the client from `NET-010`,
  `NET-011`, and `NET-017`. Nicknames are deliberately **not** in the snapshot (`NET-009b`), so
  the client keeps a roster.

---

## Out of scope for M3

Not oversights. Each is owned by a later milestone or is a standing decision — see
[09-out-of-scope.md](../../requirements/09-out-of-scope.md) and
[10-decision-log.md](../../requirements/10-decision-log.md):

| Not in M3                                                                | Owner / decision                           |
| ------------------------------------------------------------------------ | ------------------------------------------ |
| Character models, animation, nameplates, audio, art pass, the real arena | M4                                         |
| `localStorage` — remembered nickname, remembered room code, local stats  | M5 (`FR-UI-020`–`FR-UI-024`, `D-015`)      |
| Loading screen, disconnect screen, unsupported-environment screen        | M5 (`FR-UI-002`, `FR-UI-013`, `FR-UI-014`) |
| Performance pass with a full room                                        | M5 (`NFR-014`)                             |
| A public room browser or server list                                     | DEFERRED — `D-008` ships codes instead     |
| Skill-based matchmaking, rating, progression, unlocks                    | DROPPED                                    |
| Reconnecting into the same match; session tokens; slot reservation       | DROPPED — `D-009`, `FR-GP-040`             |
| Any database or server-side persistence of scores or players             | DROPPED — `D-015`                          |
| In-game text chat                                                        | DROPPED — `FR-UI-016`                      |
| Global leaderboards, match history, replays                              | DROPPED / DEFERRED                         |
| Additional modes (CTF, domination), spectators, bots                     | DROPPED / DEFERRED                         |
| Round-based play, limited lives, overtime                                | DROPPED — `D-007`, `FR-GP-044`             |
| Spawn protection                                                         | DEFERRED — `FR-GP-039`                     |
| Multi-process or horizontally scaled rooms                               | DROPPED — `NFR-002`                        |

Three rules with teeth:

- **No message may set a score, a team, or a match result.** If M3 finds itself wanting one, it
  has violated `NFR-001`, and `NET-007` says the handler does not exist because the message does
  not exist.
- **Do not build a "waiting for players" phase.** `FR-GP-010` requires a lone player clicking Play
  to land in a playable match. A lobby that waits for a second player would break it, and it is
  not in any requirement.
- **Do not resolve [`Q-006`](../../requirements/11-open-questions.md) inside this milestone's
  code.** It is a product decision for the project owner. M3 researches it and stops
  ([research.md § R6](research.md)).

---

## Success Criteria _(mandatory)_

Per the Constitution's ID namespaces, milestone exit criteria are `M<N>-<n>` — `SC-1`…`SC-5` are
the project-wide criteria in [01-vision.md](../../requirements/01-vision.md) and are not reused
here.

M3 is done when all of these are demonstrably true:

| #         | Criterion                                                                                                                                                             | Verified by                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **M3-1**  | A full match runs from start to end and a new one begins on its own, with no input from anyone and nobody disconnected.                                               | Manual — the demo criterion            |
| **M3-2**  | Both end conditions work independently: the clock expiring ends a match, and the frag limit ends a match, each with the correct `reason`.                             | Server tests, both modes               |
| **M3-3**  | A tie ends as a draw in both FFA and TDM. No arbitrary winner, no overtime.                                                                                           | Server test                            |
| **M3-4**  | Joining one at a time never leaves TDM team sizes differing by more than 1, and no inbound message can change a team.                                                 | Server test + protocol review          |
| **M3-5**  | A shot at a teammate deals no damage, produces no hit marker and no kill — **and does not block a bullet travelling to an enemy behind them**.                        | Server test                            |
| **M3-6**  | A lone player clicking Play lands in a playable match with nobody else online; a second player clicking Play joins the same room.                                     | Manual, two browsers                   |
| **M3-7**  | A private room's code joins a second client to the same match, is accepted in any letter case, and that room is never returned by auto-match.                         | Server test + manual                   |
| **M3-8**  | The {MAX_PLAYERS_PER_ROOM}+1-th join receives `ROOM_FULL` and never enters the simulation; an unknown code receives `ROOM_NOT_FOUND`.                                 | Server test                            |
| **M3-9**  | A nickname passing server validation cannot execute script in another player's browser — **and neither can one that bypasses validation entirely**, in every surface. | XSS tests per contract                 |
| **M3-10** | No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or equivalent sink is reachable from any code path that renders a nickname.                                        | Lint rule + grep test                  |
| **M3-11** | An exception thrown inside one room's tick does not stop another room's tick or leak a broadcast across rooms.                                                        | Server test with two rooms             |
| **M3-12** | Changing {MATCH_DURATION}, {FRAG_LIMIT_FFA}, or {FRAG_LIMIT_TDM} in `shared/constants` is the only edit needed to change match length or length-of-game.              | Review + the literal-scan test         |
| **M3-13** | The HUD timer tracks the server's remaining time and corrects itself from snapshots; it does not drift on a client whose tab was backgrounded.                        | Manual — background a tab, then return |
| **M3-14** | `server/**` is at its 90% coverage threshold and `shared/protocol/**` at 100%, with no threshold relaxed, and `npm run verify` is green.                              | `npm run test:coverage`                |
| **M3-15** | Scores are removed with the player who leaves, within one tick, leaving no ghost row and no stale standing.                                                           | Server test + manual                   |

Only then is `v0.4.0` tagged ([CONTRIBUTING.md](../../CONTRIBUTING.md)).

---

## Assumptions

Stated so they can be corrected now rather than discovered later.

1. **M3 does not start until M1 and M2 are done.** This spec is written ahead of them deliberately
   — the plan is work that can honestly be done in parallel — but Principle V forbids
   implementing it while either demo criterion is unmet. Everywhere this document rests on
   something M1 or M2 owns, it names the requirement ID rather than assuming an interface.
2. **M1 owns the socket, the room's tick loop, and the `join` message's transport shape**
   (`NET-003`, `NET-004`, `NET-009`, `NFR-010`, `NFR-011`). M3 adds `mode` and `roomCode` routing
   on top of it. If M1 ships a single hardcoded room, M3's first job is generalising it to many —
   see [plan.md](plan.md).
3. **M2 owns kills.** Damage, death, the `kill` message (`NET-015`), respawn (`NET-016`) and spawn
   selection (`FR-GP-038`) exist before M3 starts. M3 subscribes to kills for scoring and the kill
   feed; it does not compute damage. `FR-GP-005`'s teammate exclusion is a change **inside M2's
   raycast**, driven by team data M3 introduces.
4. **There is no waiting-for-players phase**, per `FR-GP-010`. A match starts when its room is
   created and the clock runs whether one player is present or ten.
5. **Match phases are `PLAYING` and a post-match phase.** `NET-009` shows `phase` with the single
   example value `PLAYING`; the value set is not enumerated in `requirements/`. M3 needs a second
   value to express `FR-GP-045`'s results period. This is recorded as an implication for
   `06-network-protocol.md` in [plan.md](plan.md#implications-for-requirements) — **the file is
   not edited by this milestone's planning work**.
6. **`FR-GP-046` is listed in two milestones.** [08-roadmap.md](../../requirements/08-roadmap.md)
   puts `FR-GP-041`–`FR-GP-046` in M3 _and_ names empty-room cleanup under M5. M3 is the milestone
   that first creates rooms dynamically, so a room lifecycle without destruction leaks a tick loop
   per abandoned room. This spec therefore scopes room **destruction** into M3 and treats M5's
   bullet as its verification pass. Flagged for the project owner in
   [plan.md](plan.md#implications-for-requirements); no requirement file is edited.
7. **Teams are not rebalanced after a disconnect.** `FR-GP-004` constrains assignment at join and
   forbids switching. A lopsided match caused by players leaving is specified behaviour.
8. **The character is still a capsule primitive** ([`D-011`](../../requirements/10-decision-log.md)
   ships primitives through M0–M3). Team identity in M3 is conveyed by capsule colour and HUD
   colour, not by a model. Nameplates are `FR-GP-048` in M4 and are **not** built here — and when
   they are, they inherit this milestone's nickname-rendering contract.
9. **The arena stays a blockout.** M3 adds `BLUE`/`RED` spawn tags and enough spawn points for
   `FR-GP-038` and `FR-MAP-008`. The finished level design is `FR-MAP-004`, `FR-MAP-005` and
   `FR-MAP-009`, satisfied at M4. As at M0: the **data** is final, the **design** is not.
10. **Rooms are in-memory only** (`NFR-002`, `D-015`). Restarting the server ends every match, and
    that is expected. No score, no room, and no code outlives the process.

---

## Still open — recorded, not guessed

- [`Q-006`](../../requirements/11-open-questions.md) — **blocks M3.** What happens to a player left
  idle in the pointer-lock-released state. Researched in [research.md § R6](research.md) with a
  recommendation and its cost. **The project owner must close it before implementation begins**;
  it is listed as a gate in [plan.md](plan.md#blocking-gates).
- [`Q-002`](../../requirements/11-open-questions.md) — balance numbers. `Q-002` names M3
  playtesting as the thing that answers it. {MATCH_DURATION}, {FRAG_LIMIT_FFA} and
  {FRAG_LIMIT_TDM} will very likely be wrong on first play; they are `PROPOSED`, and changing them
  is a constants edit, not a code change (`SC-4`, `M3-12`).
