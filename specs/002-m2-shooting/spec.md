# Feature Specification: M2 — Shooting

**Milestone**: `M2` in [08-roadmap.md](../../requirements/08-roadmap.md) · **Tag on completion**: `v0.3.0`

**Created**: 2026-08-22

**Status**: **Unblocked** as of 2026-09-02 — both gates in [Gates](#gates) are open. Implementation may start.

**Demo criterion**: Two players can kill each other and respawn.

> This spec **cites** requirement IDs; it does not restate them (Constitution, Principle I).
> Where this document and [`requirements/`](../../requirements/README.md) disagree,
> `requirements/` wins and this file is the bug.

---

## Objective

Turn two players who can see each other move into two players who can fight. Everything that
decides the outcome of a fight — where the ray goes, what it hits, how much that costs, when a
player dies, and where they come back — is computed on the server, from the server's own state,
in `shared/sim`.

M2 is where `NFR-001` stops being a slogan. Until now no client message could assert anything
because nothing was worth asserting. From M2 the protocol carries a _fire request_
(`NET-004b`) and nothing else: no damage message, no kill message, no health field inbound.
A client that wants to lie has no field to lie in.

The second thing M2 fixes forever is **where a bullet comes from**. The camera is offset from
the character (`CAMERA_OFFSET`), so the ray through the crosshair and the ray from the player's
eye are different lines. `FR-UI-007` requires the crosshair to reflect the ray the _server_
casts. That choice is [`Q-003`](../../requirements/11-open-questions.md#q-003), it is expensive
to change once combat exists, and **this spec does not settle it** — see [Gates](#gates).

---

## Gates

M2 must not begin until both hold. Neither is a formality.

### Gate 1 — M1's demo criterion is met

Constitution Principle V. M2 consumes the protocol, the room, the server tick loop, the
snapshot, and the prediction buffer that M1 builds (`NET-003`, `NET-004`, `NET-009`,
`NFR-005`–`NFR-008`). There is nothing in M2 that can be honestly finished on top of a
protocol that does not exist yet.

Planning M2 now is not the same as starting it. This document, the plan and the task list are
the work that can honestly be done in parallel with M1; **no source file may be written against
them until M1 is demonstrably done.**

### Gate 2 — [`Q-003`](../../requirements/11-open-questions.md#q-003) has landed as an ADR

`FR-UI-007` requires the crosshair to reflect the ray the server casts, and deliberately does
not say how. `docs/adr/README.md` names this as the urgent ADR. The three candidate approaches
and their costs are analysed in [research.md § R1](research.md), with a recommendation — but the
decision is the **project owner's**, taken as an ADR, not by an implementation agent.

Do not write firing code before that ADR exists. `FR-GP-024`'s ray origin, `NET-012`'s `from`
field, and the client's crosshair placement all follow from it, and retrofitting a different
answer means touching the raycast, the protocol payload and the HUD at once.

This is **not** the question [ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md)
answered. That one settled _how aim is represented_ — a unit direction vector, no angles in the
simulation. Q-003 asks _where the ray originates_. Both are M2's to respect; only one is
already decided.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Kill an opponent and watch them come back (Priority: P1)

Two players in the same room. One aims at the other and holds fire. The server decides that a
shot happens, casts a ray from the shooter's eye, finds the nearest thing it hits, and applies
damage if that thing was an opponent's hit volume. Enough hits and the opponent dies, stops
moving, and respawns a few seconds later somewhere away from whoever killed them.

**Why this priority**: This _is_ the demo criterion. It is also the milestone's technical
purpose — the raycast and the damage rules written here are the authority model made concrete,
and every later milestone (scoring in M3, hit feedback in M4) reads their output.

**Independent Test**: Two browsers against one server, no HUD required — health can be read
from the snapshot in a debug overlay. Delivering only this story already demonstrates
server-authoritative combat.

**Acceptance Scenarios**:

1. **Given** two living players with clear line of sight, **When** the shooter fires at the
   opponent's torso, **Then** the opponent's health drops by {DAMAGE_TORSO} and no one else's
   changes (`FR-GP-024`, `FR-GP-026`).
2. **Given** an opponent standing behind a wall, **When** the shooter fires at them, **Then**
   the ray stops at the wall and no damage is dealt (`FR-GP-025`).
3. **Given** a full-health opponent, **When** the shooter lands two head shots, five torso
   shots, or ten leg shots, **Then** the opponent dies — and mixed regions sum to the same
   total (`FR-GP-026`).
4. **Given** an opponent at 1 m and the same opponent at {WEAPON_RANGE}, **When** each is hit
   in the same region, **Then** the damage is identical; **When** a target beyond
   {WEAPON_RANGE} is fired at, **Then** nothing is hit (`FR-GP-024`, `FR-GP-028`).
5. **Given** a player whose health reaches zero, **When** the tick resolves, **Then** they stop
   simulating, their inputs are ignored, and their hit volumes leave the raycast entirely
   (`FR-GP-036`).
6. **Given** a dead player, **When** {RESPAWN_DELAY} has elapsed, **Then** they respawn with no
   input of their own, at full health and a full magazine, at a spawn point not within
   {MIN_SPAWN_DISTANCE} of a living enemy while any valid spawn satisfies that
   (`FR-GP-037`, `FR-GP-038`).
7. **Given** the same starting room state and the same recorded input sequence, **When** the
   server simulation is replayed, **Then** every shot, hit, death and respawn falls on the same
   tick as before (`NFR-004`).
8. **Given** a player firing at themselves is impossible by construction, **When** any shot is
   resolved, **Then** the shooter's own hit volumes are never candidates and no code path
   damages the shooter (`FR-GP-042`).

---

### User Story 2 — Run out of ammunition and reload (Priority: P2)

The weapon is automatic while fire is held, and it runs dry. The player presses `R`, or keeps
firing on an empty magazine, and waits out a reload during which they cannot shoot. Reserve
ammunition is unlimited, so nobody is ever permanently disarmed.

**Why this priority**: It is what makes a fight a fight rather than a beam. It is also the part
of M2 most exposed to a cheating client — fire rate and magazine are the two things a modified
client would most like to control, and `FR-GP-029` requires the server to be the one enforcing
them. But a player can already be killed without it, which is why it sits behind P1.

**Independent Test**: One player, one server. Hold fire, count shots, watch the magazine empty
and refill.

**Acceptance Scenarios**:

1. **Given** the fire input is held, **When** ticks elapse, **Then** shots are produced at
   {FIRE_RATE_RPS} and no faster, regardless of how many input messages arrive (`FR-GP-029`,
   `NET-004b`).
2. **Given** a client sending fire requests far faster than the tick rate, **When** the server
   processes them, **Then** the excess is discarded with no damage dealt and no ammunition
   consumed (`FR-GP-029`, `NFR-010`).
3. **Given** a magazine holding {MAGAZINE_SIZE} rounds, **When** shots are fired, **Then** the
   count decrements once per shot and never falls below zero (`FR-GP-030`).
4. **Given** an empty magazine, **When** the player fires or presses `R`, **Then** a reload
   starts, lasts exactly {RELOAD_TIME}, and ends with {MAGAZINE_SIZE} rounds (`FR-GP-031`).
5. **Given** a reload in progress, **When** the player holds fire, **Then** no shot is produced
   and the reload is not cancelled or restarted (`FR-GP-031`).
6. **Given** a full magazine, **When** the player presses `R`, **Then** nothing happens
   (`FR-GP-031`).
7. **Given** a reload in progress, **When** the player dies, **Then** the reload is cancelled,
   and on respawn they hold {MAGAZINE_SIZE} rounds with no pending reload (`FR-GP-032`).

---

### User Story 3 — See what the weapon is doing (Priority: P3)

The player can read their own health and ammunition without guessing, and a crosshair marks
where the shot will land.

**Why this priority**: `FR-UI-005`–`FR-UI-007` are all `REQUIRED`, and a shooter without a
crosshair is not demonstrable — but this is a presentation layer over a combat model that
already works, so it is last. It is also the story that Gate 2 constrains most directly.

**Independent Test**: One browser. Take damage from any source, fire, reload, and read the
screen.

**Acceptance Scenarios**:

1. **Given** the player is alive, **When** they take damage, **Then** the displayed health
   updates within one snapshot and shows a numeric value (`FR-UI-005`).
2. **Given** the player is firing, **When** the magazine changes, **Then** the display shows
   `current / {MAGAZINE_SIZE}` (`FR-UI-006`).
3. **Given** a reload starts, **When** it is in progress, **Then** a progress indicator lasting
   exactly {RELOAD_TIME} is shown (`FR-UI-006`).
4. **Given** a target close enough for the camera offset to matter, **When** the player places
   the crosshair on it and fires, **Then** the server's ray reaches the point the crosshair
   covered — the crosshair reflects the server's ray, not merely the screen centre
   (`FR-UI-007`, and the Gate 2 ADR).
5. **Given** the player is dead, **When** the respawn countdown runs, **Then** an overlay shows
   the remaining time (`FR-GP-037`).

---

### Edge Cases

- **A shot fired on the tick its shooter dies.** Order within the tick must be fixed and
  documented, not incidental. Whichever order is chosen, it must be the same on every replay.
- **Two lethal hits on the same victim in the same tick, from two different shooters.** Exactly
  one `kill` may be emitted, and the victim's health must not go doubly negative or trigger two
  respawn timers.
- **A player disconnecting between firing and the shot resolving.** `FR-GP-040` requires no
  ghost body and no ghost hit volume: a shot must not hit someone who has already left, and a
  shot from someone who has already left must not land.
- **The eye position inside or flush against geometry.** A player pressed into a wall must not
  be able to shoot through it, and must not have every shot blocked at zero distance either.
- **A ray landing exactly on a hit-volume boundary**, or on the seam between two hit regions.
  The region must be decided deterministically, never by float luck differing between runs.
- **A ray hitting a wall and a hit volume at the same distance.** Resolution order must be
  total and stable (`FR-GP-025`).
- **A crouched target.** Hit volumes follow the crouch state (`FR-GP-027`), so a crouched
  player's head must genuinely be harder to hit — otherwise crouch is a pure downside and
  `FR-GP-018`'s tactical purpose is lost.
- **Fire rate that does not divide the tick rate.** {FIRE_RATE_RPS} shots per second against
  {SERVER_TICK_HZ} ticks per second is not a whole number of ticks per shot. The cadence must
  be exact and identical on every run — see [research.md § R4](research.md).
- **Death during a respawn countdown is impossible**, but a disconnect during one is not. A
  dead player who leaves must not respawn into an empty slot.
- **No valid spawn satisfies {MIN_SPAWN_DISTANCE}.** `FR-GP-038` says the farthest is used;
  that fallback must be tested, not assumed unreachable.
- **A player at exactly {PLAYER_MAX_HEALTH} taking exactly lethal damage**, and a player taking
  damage that would push health below zero. Health must clamp, and death must trigger once.

---

## Requirements _(mandatory)_

This project's requirement IDs are permanent and live in
[`requirements/`](../../requirements/README.md). M2 mints none. It must satisfy these:

| ID                                                      | What M2 must satisfy                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`FR-GP-023`](../../requirements/02-gameplay.md)        | One weapon for everyone, with no code path to change it                          |
| [`FR-GP-024`](../../requirements/02-gameplay.md)        | Hitscan from the player's eye, up to {WEAPON_RANGE}, resolved in the same tick   |
| [`FR-GP-025`](../../requirements/02-gameplay.md)        | Nearest-intersection resolution across geometry and eligible players             |
| [`FR-GP-026`](../../requirements/02-gameplay.md)        | Regional damage — head / torso / legs                                            |
| [`FR-GP-027`](../../requirements/02-gameplay.md)        | Three **static** hit primitives, never derived from the skeleton                 |
| [`FR-GP-028`](../../requirements/02-gameplay.md)        | No damage falloff                                                                |
| [`FR-GP-029`](../../requirements/02-gameplay.md)        | Server-enforced fire rate; excess shots discarded                                |
| [`FR-GP-030`](../../requirements/02-gameplay.md)        | Magazine of {MAGAZINE_SIZE}, unlimited reserve, never below zero                 |
| [`FR-GP-031`](../../requirements/02-gameplay.md)        | Reload, server-authoritative, blocking fire                                      |
| [`FR-GP-032`](../../requirements/02-gameplay.md)        | Death cancels a reload; respawn grants a full magazine                           |
| [`FR-GP-033`](../../requirements/02-gameplay.md)        | Perfect accuracy — **no** spread, recoil or bloom in v1                          |
| [`FR-GP-034`](../../requirements/02-gameplay.md)        | One health pool, no armour value anywhere in player state                        |
| [`FR-GP-035`](../../requirements/02-gameplay.md)        | No regeneration, no restoration during a life                                    |
| [`FR-GP-036`](../../requirements/02-gameplay.md)        | Death: inputs ignored, hit volumes removed from the cast                         |
| [`FR-GP-037`](../../requirements/02-gameplay.md)        | Automatic respawn after {RESPAWN_DELAY}, with a countdown shown                  |
| [`FR-GP-038`](../../requirements/02-gameplay.md)        | Spawn selection maximising distance to the nearest living enemy                  |
| [`FR-GP-042`](../../requirements/02-gameplay.md)        | No self-damage, no fall damage, no environmental death                           |
| [`FR-GP-049`](../../requirements/02-gameplay.md)        | Every living player is in the snapshot; concealment stays a rendering property   |
| [`FR-UI-005`](../../requirements/03-ui-ux.md)           | Health always visible, updating within one snapshot                              |
| [`FR-UI-006`](../../requirements/03-ui-ux.md)           | Ammo as `current / {MAGAZINE_SIZE}`, with a reload indicator                     |
| [`FR-UI-007`](../../requirements/03-ui-ux.md)           | Crosshair matching the ray the **server** casts — gated on the Q-003 ADR         |
| [`NET-004b`](../../requirements/06-network-protocol.md) | `fire` is a request; the server decides whether a shot happens                   |
| [`NET-009`](../../requirements/06-network-protocol.md)  | Snapshot `hp`, `am` and the `st` reloading/dead bits become real                 |
| [`NET-012`](../../requirements/06-network-protocol.md)  | `shot` broadcast — cosmetic, carrying no damage information                      |
| [`NET-013`](../../requirements/06-network-protocol.md)  | `damage`, to the victim only                                                     |
| [`NET-014`](../../requirements/06-network-protocol.md)  | `hitConfirm`, to the shooter only, never revealing remaining health              |
| [`NET-015`](../../requirements/06-network-protocol.md)  | `kill` broadcast                                                                 |
| [`NET-016`](../../requirements/06-network-protocol.md)  | `respawn` broadcast, resetting local prediction state                            |
| [`NFR-001`](../../requirements/05-architecture.md)      | The server holds the only true health, ammo and kill state                       |
| [`NFR-003`](../../requirements/05-architecture.md)      | The raycast and damage rules live once, in `shared/`                             |
| [`NFR-004`](../../requirements/05-architecture.md)      | Combat is deterministic: no clock, no randomness, fixed timestep                 |
| [`NFR-009`](../../requirements/05-architecture.md)      | Shots evaluated against **current** positions — no rewind. Documented, not fixed |
| [`NFR-011`](../../requirements/05-architecture.md)      | Every inbound field validated before it reaches combat logic                     |
| [`NFR-015`](../../requirements/05-architecture.md)      | A throw while resolving a shot must not take down another room                   |
| [`NFR-017`](../../requirements/05-architecture.md)      | Animation never touches hit detection                                            |
| [`FR-MAP-002`](../../requirements/04-map.md)            | The raycast reads the same `GameMap` the renderer draws                          |
| [`SC-4`](../../requirements/01-vision.md)               | Every combat number comes from `shared/constants` and nowhere else               |

**`FR-GP-025`'s teammate exclusion has nothing to exclude in M2.** Teams arrive in M3
(`FR-GP-003`, `FR-GP-004`). M2 builds the _target-eligibility filter_ — the seam the rule needs
— and in M2 it rejects only the shooter themselves and the dead. M3 supplies teams to it. The
filter is written now because retrofitting it into a raycast that assumed "everyone else"
means touching the hot path again; the team rule itself is **not** pulled forward.

### Key Entities

- **PlayerState (extended)** — M0's movement state gains what combat needs: health, magazine
  count, alive state, and the countdowns for reload, respawn and the next permitted shot.
  Still no orientation (presentation, per ADR-0001) and still nothing animation-related
  (`NFR-017`). Every duration is carried as simulation ticks, never as a timestamp — the
  simulation has no clock (`NFR-004`).
- **PlayerInput (extended)** — gains `fire` and `reload` **intent** flags, mirroring
  `NET-004`'s bitmask bits 128 and 256. Both are requests (`NET-004b`). The input still cannot
  assert a hit, a victim, a damage figure or a tick — an input able to do so would violate
  `NFR-001` the moment it arrives over a socket.
- **HitVolume** — one of three static primitives (head, torso, legs) placed from a player's
  server-side transform and crouch state (`FR-GP-027`). Not a bone, not a mesh, not animated.
  It exists only for the duration of a cast and is never stored on the player.
- **ShotResult** — what one cast produced: whether anything was hit, what kind of thing, which
  region, which player, at what point along the ray. It is the single value from which
  `NET-012`, `NET-013`, `NET-014` and `NET-015` are derived, so those four messages can never
  describe different events.

---

## Out of scope for M2

Not oversights. Each is owned by a later milestone or is a standing decision — see
[09-out-of-scope.md](../../requirements/09-out-of-scope.md) and
[08-roadmap.md](../../requirements/08-roadmap.md):

| Not in M2                                                             | Owned by / status                         |
| --------------------------------------------------------------------- | ----------------------------------------- |
| Lag compensation, server-side rewind, position history buffers        | `NFR-009` — DEFERRED, and deliberately so |
| Recoil, spread, bloom, damage falloff                                 | `FR-GP-033`, `FR-GP-028` — DEFERRED       |
| Spawn protection / post-respawn invulnerability                       | `FR-GP-039` — DEFERRED                    |
| Armour, shields, health pickups, health regeneration                  | `FR-GP-034`, `FR-GP-035` — DROPPED        |
| Multiple weapons, weapon selection, ammunition pickups                | DROPPED                                   |
| Teams, friendly fire rules, team-restricted spawns                    | M3 (`FR-GP-003`–`FR-GP-006`)              |
| Scoring, kill/death counters, `score`, frag limit, match end          | M3 (`FR-GP-041`, `FR-GP-043`, `NET-017`)  |
| Kill feed, scoreboard, match timer, results screen                    | M3 (`FR-UI-004`, `FR-UI-009`–`FR-UI-011`) |
| Hit markers, damage indicators, muzzle flash, tracers, impact effects | M4 (`FR-UI-008`)                          |
| Death animations, reload animations, any animation at all             | M4 (`NFR-016`, `NFR-017`)                 |
| Nameplates and their occlusion check                                  | M4 (`FR-GP-048`)                          |
| Weapon sounds, hit sounds, any audio                                  | M4 (`FR-UI-017`, `FR-UI-018`)             |
| Server-side visibility culling / anti-wallhack                        | `FR-GP-049` — DEFERRED, exposure accepted |
| Binary protocol, delta-compressed snapshots                           | `NET-022`, `NET-023` — DEFERRED           |

Three rules with teeth:

- **`NET-012`, `NET-013`, `NET-014` and `NET-015` are emitted in M2; nothing renders them yet.**
  `FR-UI-008`'s hit markers and damage indicators are M4, and the kill feed is M3. M2's client
  must receive all four without error and must not crash on a message it has no picture for.
  Emitting them now is not pulling M4 forward — the roadmap places these messages in M2, and a
  message whose producer and consumer are built in different milestones is exactly why they are
  specified in [`06-network-protocol.md`](../../requirements/06-network-protocol.md) rather than
  invented at render time.
- **Do not add a position history buffer.** `NFR-009` is a decision. The server evaluates shots
  against current positions and high-latency players lead their targets. Building the buffer
  "so rewind is easy later" is the exact architecture `09-out-of-scope.md` forbids adding.
- **Do not derive hit volumes from anything animated.** `FR-GP-027` and `NFR-017`. There is no
  animation system in M2 at all, which makes the mistake hard to make now — and that is
  precisely why the volumes must be pinned to the transform now, before M4 arrives with bones.

---

## Success Criteria _(mandatory)_

Per the Constitution's ID namespaces, milestone exit criteria are `M<N>-<n>` — `SC-1`…`SC-5` are
the project-wide criteria in [01-vision.md](../../requirements/01-vision.md) and are not reused
here.

M2 is done when all of these are demonstrably true:

| #         | Criterion                                                                                                                                               | Verified by                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **M2-1**  | Two players in two browsers shoot each other, die, and respawn, repeatedly, without the server or either client erroring.                               | Manual — the demo criterion    |
| **M2-2**  | Every line of raycast, damage, death, reload and respawn-timing logic lives under `shared/sim`. `server/` orchestrates; `client/` computes nothing.     | Lint boundary rule + review    |
| **M2-3**  | No inbound message can set health, ammunition, kill status or position. The protocol has no such field, and `fire` and `reload` are requests only.      | Protocol test + review         |
| **M2-4**  | A kill takes 2 head, 5 torso or 10 leg hits, and mixed regions sum correctly — all derived from `shared/constants`, never written down.                 | Damage test                    |
| **M2-5**  | A shot at an opponent behind a wall hits the wall and deals no damage; a shot at an opponent behind an ineligible target still reaches the opponent.    | Raycast test                   |
| **M2-6**  | Hit results depend only on transform and crouch state. No skeleton, mesh or animation input exists anywhere in the hit path.                            | Test + review                  |
| **M2-7**  | A client sending fire requests far faster than {FIRE_RATE_RPS} has the excess discarded — no damage, no ammunition consumed, no queue growth.           | Server test                    |
| **M2-8**  | Firing is impossible during a reload; a reload takes exactly {RELOAD_TIME}; dying cancels it and respawn grants exactly {MAGAZINE_SIZE}.                | Reload test                    |
| **M2-9**  | A dead player's inputs are ignored and their hit volumes are absent from every cast until they respawn.                                                 | Test                           |
| **M2-10** | A player never respawns within {MIN_SPAWN_DISTANCE} of a living enemy while any valid spawn satisfies it, and the no-valid-spawn fallback is exercised. | Spawn-selection test           |
| **M2-11** | Damage at 1 m equals damage at {WEAPON_RANGE} for the same region; nothing beyond {WEAPON_RANGE} is ever hit.                                           | Range test                     |
| **M2-12** | Replaying a recorded room input sequence reproduces every shot, hit, death and respawn on the same tick — no clock, no randomness in the combat path.   | Determinism test               |
| **M2-13** | The crosshair marks the point the server's ray actually reaches, verified at the close range where the camera offset is largest.                        | Manual, against the Gate 2 ADR |
| **M2-14** | Health and ammunition are readable at a glance during play, and the reload indicator lasts exactly {RELOAD_TIME}.                                       | Manual                         |
| **M2-15** | `shared/sim` and `shared/protocol` report 100%, `server/` and `client/net/` 90%, and `npm run verify` is green with no threshold relaxed.               | `npm run test:coverage`        |
| **M2-16** | Changing {DAMAGE_TORSO} in `shared/constants` is the only edit needed to change torso damage; no combat literal exists elsewhere.                       | Literal-scan test              |

Only then is `v0.3.0` tagged ([CONTRIBUTING.md](../../CONTRIBUTING.md)).

---

## Assumptions

Stated so they can be corrected now rather than discovered later:

1. **M1 is finished before any M2 code is written.** M2 has no standalone mode: the raycast
   needs two players, and two players need a server. Constitution Principle V.
2. **M2 runs in one hardcoded room, in FFA shape, with no teams and no score.** Every other
   living player is an eligible target. Teams are M3's to add through the eligibility filter
   this milestone builds.
3. **The player is still a capsule primitive.** `D-011` ships primitives through M0–M3, so the
   hit volumes are the only "body" that exists — and they are hit volumes, not geometry, and
   are not drawn.
4. **The M2 arena is still the blockout.** It needs enough spawn points spread far enough apart
   for `FR-GP-038` to have a real choice to make; `MIN_SPAWN_POINTS` and the designed arena are
   `FR-MAP-007` and `FR-MAP-009`, satisfied at M4.
5. **`shared/protocol` exists by M2**, created in M1 for `join`/`input`/`snapshot`. M2 adds
   message types and validators to it rather than starting it.
6. **Health, ammunition and the countdowns live in the simulated player state**, so the client's
   prediction can carry them and the server's reconciliation can correct them by the same
   mechanism M1 already built for position.
7. **The client predicts nothing that decides an outcome.** It may predict its own ammunition
   and reload indicator for responsiveness, but a hit, a kill and a health value are the
   server's alone (`NFR-001`); the snapshot is the correction path.
8. **High-latency players must lead moving targets.** `NFR-009`. This is a documented trade-off
   in a portfolio project, not a defect to be reported during M2 playtesting.

---

## Still open — not M2's to answer by guessing

- [`Q-003`](../../requirements/11-open-questions.md#q-003) — crosshair-to-ray alignment.
  **Blocks this milestone.** Researched in [research.md § R1](research.md) with a
  recommendation; it must land as an ADR decided by the project owner. See [Gates](#gates).
- [`Q-002`](../../requirements/11-open-questions.md#q-002) — balance numbers. {FIRE_RATE_RPS}
  against {DAMAGE_TORSO} gives a 0.5 s time-to-kill, which the question itself flags as
  possibly brutal. M2 must make that a constants edit (`M2-16`), not a code change; it must not
  "fix" it by changing a value.
- [`Q-006`](../../requirements/11-open-questions.md#q-006) — a player idle with pointer lock
  released is still killable (`FR-GP-021`). M2 makes that observable for the first time, since
  they are now a free kill rather than merely a stationary box. The question is M3's to answer;
  M2 must not invent a rule for it.
