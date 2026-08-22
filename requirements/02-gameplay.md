# 02 — Gameplay

All numeric values are defined in [07-constants.md](07-constants.md) and referenced here
as `{CONSTANT_NAME}`.

---

## Game modes

### FR-GP-001 — Two game modes
**Status:** REQUIRED
**Statement:** The game supports exactly two modes: Free-For-All (FFA) and Team
Deathmatch (TDM).
**Acceptance:** Both modes are selectable from the start screen and produce a playable
match.

### FR-GP-002 — Mode is chosen before joining
**Status:** REQUIRED
**Statement:** The player selects the mode on the start screen, alongside the nickname,
before any connection to a match is established.
**Acceptance:** The start screen has a mode selector; the client sends the chosen mode in
the `join` message; the server never reassigns it.

### FR-GP-003 — TDM has two teams
**Status:** REQUIRED
**Statement:** In TDM, players belong to one of two teams: `BLUE` or `RED`.
**Acceptance:** Every player in a TDM match has a team; no third team or spectator team
exists.

### FR-GP-004 — Automatic team assignment
**Status:** REQUIRED
**Statement:** The server assigns each joining TDM player to the team with fewer players;
on a tie it picks randomly. Players cannot choose or switch teams.
**Acceptance:** Joining players one at a time never produces a team-size difference
greater than 1. No client message can change a team.

### FR-GP-005 — No friendly fire
**Status:** REQUIRED
**Statement:** In TDM, shots that hit a teammate deal no damage and do not register as a
hit.
**Acceptance:** Firing at a teammate at point-blank range leaves their health unchanged
and produces no hit marker, no damage event, and no kill.
**Note:** Teammate hitboxes are ignored entirely by the hit raycast — a teammate does not
block a bullet. See `FR-GP-025`.

### FR-GP-006 — FFA has no teams
**Status:** REQUIRED
**Statement:** In FFA every player is hostile to every other player, and no team field is
meaningful.
**Acceptance:** All other players can be damaged and killed; the HUD shows no team colours.

---

## Joining a match

### FR-GP-007 — Nickname is mandatory
**Status:** REQUIRED
**Statement:** A player must provide a nickname before entering a match.
**Acceptance:** The play button is disabled until a valid nickname is entered. A `join`
message with a missing or invalid nickname is rejected by the server with an `error`.

### FR-GP-008 — Nickname validation
**Status:** PROPOSED
**Statement:** A nickname is {NICKNAME_MIN_LENGTH}–{NICKNAME_MAX_LENGTH} characters,
containing only letters, digits, `_` and `-`. Validation runs on both client and server;
the server's decision is final.
**Acceptance:** Submitting `<script>alert(1)</script>`, an empty string, or a 200-character
string is rejected server-side. The server never trusts client-side validation.

### FR-GP-009 — Nicknames are not unique
**Status:** PROPOSED
**Statement:** Two players may share a nickname. Identity is the server-assigned player
ID, never the nickname.
**Acceptance:** Two clients joining with the same nickname both connect successfully and
are distinguishable in the scoreboard and kill feed by a disambiguating suffix.

### FR-GP-010 — Quick play (auto-match)
**Status:** REQUIRED
**Statement:** A primary "Play" action joins the player to a public room of the selected
mode that has space; if none exists, the server creates one.
**Acceptance:** A single player clicking Play always lands in a playable match, even when
nobody else is online.

### FR-GP-011 — Private rooms by code
**Status:** REQUIRED
**Statement:** A player can create a private room and receive a short join code, and
another player can join by entering that code.
**Acceptance:** Creating a private room returns a code of {ROOM_CODE_LENGTH} characters.
Entering that code from a second client joins the same match. Private rooms are never
returned by auto-match.

### FR-GP-012 — Room code format
**Status:** PROPOSED
**Statement:** Room codes are {ROOM_CODE_LENGTH} uppercase characters drawn from an
alphabet that excludes visually ambiguous glyphs (`0`, `O`, `1`, `I`, `L`).
**Acceptance:** A generated code can be read aloud and typed without ambiguity. Code entry
is case-insensitive.

### FR-GP-013 — Room capacity
**Status:** REQUIRED
**Statement:** A room holds at most {MAX_PLAYERS_PER_ROOM} players.
**Acceptance:** The {MAX_PLAYERS_PER_ROOM}+1-th player attempting to join a full room
receives an `error` with code `ROOM_FULL` and is not added to the simulation.

### FR-GP-014 — Join in progress
**Status:** REQUIRED
**Statement:** Players may join a match already in progress; they spawn immediately with
a score of zero.
**Acceptance:** Joining a match with 3 minutes remaining puts the player in the arena
within one tick, with the correct remaining time on their HUD.

---

## Movement & camera

### FR-GP-015 — Ground movement
**Status:** REQUIRED
**Statement:** The player moves with `W`/`A`/`S`/`D` relative to the camera's facing
direction, at {WALK_SPEED}.
**Acceptance:** Holding `W` moves the character away from the camera; the character model
rotates to face its movement direction.

### FR-GP-016 — Sprinting
**Status:** REQUIRED
**Statement:** Holding `Shift` while moving forward increases speed to {SPRINT_SPEED}.
**Acceptance:** Sprint applies only to forward-dominant movement, not to strafing or
backpedalling. Sprint has no stamina cost in v1.

### FR-GP-017 — Jumping
**Status:** REQUIRED
**Statement:** Pressing `Space` while grounded applies an upward impulse of
{JUMP_VELOCITY}; the player is subject to gravity {GRAVITY}.
**Acceptance:** The player leaves the ground, follows a ballistic arc, and lands. A
second `Space` press while airborne does nothing. Jump height is identical on client
prediction and server simulation for the same input sequence.

### FR-GP-018 — Crouching
**Status:** REQUIRED
**Statement:** Holding `Ctrl` puts the player in a crouched state: movement speed drops
to {CROUCH_SPEED} and the collision and hit capsule height drops to {CROUCH_HEIGHT}.
**Acceptance:** A crouched player is visibly shorter, moves slower, and can be fully
concealed behind cover of height {CROUCH_HEIGHT} that does not conceal a standing player.
Crouching and jumping are mutually exclusive — a crouched player cannot jump.

### FR-GP-019 — Third-person camera
**Status:** REQUIRED
**Statement:** The camera sits behind and slightly above the player's shoulder, at offset
{CAMERA_OFFSET}, and is rotated by mouse movement under Pointer Lock.
**Acceptance:** Horizontal mouse movement orbits the camera and turns the character;
vertical movement pitches the camera within {CAMERA_PITCH_MIN}..{CAMERA_PITCH_MAX}.

### FR-GP-020 — Camera collision
**Status:** REQUIRED
**Statement:** When level geometry lies between the camera and the player, the camera
moves closer to the player so the player remains visible.
**Acceptance:** Backing into a wall never places the camera inside or behind the wall,
and never shows the inside of level geometry.

### FR-GP-021 — Pointer lock
**Status:** REQUIRED
**Statement:** Clicking the canvas requests pointer lock; losing pointer lock pauses input
and shows a "click to resume" overlay. The match continues running on the server.
**Acceptance:** Pressing `Esc` releases the cursor and shows the overlay; the player
remains in the match and remains killable.

### FR-GP-022 — Mouse sensitivity
**Status:** PROPOSED
**Statement:** Camera rotation speed is controlled by a sensitivity value defaulting to
{MOUSE_SENSITIVITY_DEFAULT}.
**Acceptance:** The value is a single constant. A settings UI to change it is
`DEFERRED` — see `FR-UI-011`.

---

## Weapon & combat

### FR-GP-023 — Single weapon
**Status:** REQUIRED
**Statement:** Every player carries the same single weapon for the entire match. There are
no weapon pickups, no weapon selection, and no secondary weapon.
**Acceptance:** No code path exists to change a player's weapon.

### FR-GP-024 — Hitscan fire
**Status:** REQUIRED
**Statement:** Firing is instantaneous (hitscan): the server casts a ray from the player's
eye position along their aim direction, up to {WEAPON_RANGE}. There are no travelling
projectiles.
**Acceptance:** A shot at a target {WEAPON_RANGE} away registers in the same tick it is
fired. A shot beyond {WEAPON_RANGE} never hits.

### FR-GP-025 — Raycast resolution order
**Status:** REQUIRED
**Statement:** The ray hits the nearest intersection among: level geometry, and the hit
volumes of players who are valid targets. In TDM, teammates' hit volumes are excluded
from the cast entirely.
**Acceptance:** A shot at an enemy standing behind a wall hits the wall and deals no
damage. In TDM, a shot at an enemy standing behind a teammate hits the enemy.

### FR-GP-026 — Regional damage
**Status:** REQUIRED
**Statement:** Damage depends on which hit region the ray intersects:
head {DAMAGE_HEAD}, torso {DAMAGE_TORSO}, legs {DAMAGE_LEGS}.
**Acceptance:** With health {PLAYER_MAX_HEALTH}, a kill takes 2 head shots, 5 torso shots,
or 10 leg shots, and mixed regions sum correctly.
**Supersedes:** the original draft's "5 shots to die", which is only true for torso hits.
See [10-decision-log.md](10-decision-log.md#d-004).

### FR-GP-027 — Static hit volumes
**Status:** REQUIRED
**Statement:** Server-side hit volumes are three static primitives (head sphere, torso
capsule, leg capsule) positioned from the player's server-side transform and crouch state.
They are **not** derived from the animated skeleton.
**Acceptance:** Hit results are identical regardless of which animation is playing.
**Rationale:** Deriving hitboxes from Mixamo bone transforms would require the server to
run the animation system, which is a large cost for a portfolio project and a common
source of desync. This is a deliberate simplification — record it in the ADR.

### FR-GP-028 — No damage falloff
**Status:** REQUIRED
**Statement:** Damage does not decrease with distance. A hit at 1 m and a hit at
{WEAPON_RANGE} deal identical damage for the same region.
**Acceptance:** Verified by test at both ranges.

### FR-GP-029 — Fire rate
**Status:** REQUIRED
**Statement:** The weapon is fully automatic while the fire input is held, at
{FIRE_RATE_RPS} shots per second, enforced by the server.
**Acceptance:** A client sending fire inputs faster than {FIRE_RATE_RPS} has the excess
shots discarded server-side, with no damage dealt and no ammo consumed.

### FR-GP-030 — Magazine and ammo
**Status:** REQUIRED
**Statement:** The weapon holds {MAGAZINE_SIZE} rounds. Reserve ammunition is unlimited.
**Acceptance:** Firing decrements the magazine; the magazine never goes below zero; the
player can never permanently run out of ammunition.

### FR-GP-031 — Reload
**Status:** REQUIRED
**Statement:** Pressing `R`, or firing with an empty magazine, starts a reload taking
{RELOAD_TIME}, after which the magazine is refilled to {MAGAZINE_SIZE}.
**Acceptance:** Firing is impossible during reload. The reload timer is authoritative on
the server. Reloading a full magazine does nothing.

### FR-GP-032 — Reload is interrupted by death
**Status:** PROPOSED
**Statement:** Dying cancels an in-progress reload. Respawning grants a full magazine.
**Acceptance:** A player who dies mid-reload respawns with {MAGAZINE_SIZE} rounds and no
pending reload timer.

### FR-GP-033 — Crosshair accuracy
**Status:** PROPOSED
**Statement:** In v1 the weapon is perfectly accurate: the ray follows the exact aim
direction with no spread, recoil, or bloom.
**Acceptance:** Ten consecutive shots at a fixed target from a stationary player all hit
the same region.
**Note:** Recoil and spread are `DEFERRED`. They are the single highest-value addition to
combat feel once the netcode is solid.

---

## Health, death & respawn

### FR-GP-034 — Health and no armour
**Status:** REQUIRED
**Statement:** A player has a single health pool of {PLAYER_MAX_HEALTH}. There is no
armour, shield, or vest — all damage applies directly to health.
**Acceptance:** No armour value exists in the player state.
**Note:** This is a deliberate design choice despite the project's name. See
[10-decision-log.md](10-decision-log.md#d-005).

### FR-GP-035 — No health regeneration or pickups
**Status:** PROPOSED
**Statement:** Health does not regenerate over time and cannot be restored during a life.
The only way to return to full health is to die and respawn.
**Acceptance:** A player left at 20 health for 60 seconds still has 20 health.

### FR-GP-036 — Death
**Status:** REQUIRED
**Statement:** A player whose health reaches 0 or below dies: they stop simulating, their
model plays a death animation, and they cannot move or fire.
**Acceptance:** Inputs from a dead player are ignored by the server. A dead player's hit
volumes are removed from the raycast.

### FR-GP-037 — Automatic respawn
**Status:** REQUIRED
**Statement:** A dead player automatically respawns after {RESPAWN_DELAY} at a spawn point,
with full health and a full magazine.
**Acceptance:** No player input is required to respawn. A death-camera or overlay shows a
countdown during the delay.

### FR-GP-038 — Spawn point selection
**Status:** PROPOSED
**Statement:** The server picks the spawn point that maximises distance to the nearest
living enemy, among spawn points valid for the player's team.
**Acceptance:** A player never spawns within {MIN_SPAWN_DISTANCE} of a living enemy while
any valid spawn point satisfies that constraint. If none does, the farthest is used.

### FR-GP-039 — Spawn protection
**Status:** DEFERRED
**Statement:** Brief invulnerability after respawn.
**Rationale:** Adds a state to synchronise and a HUD affordance. Revisit only if spawn
camping proves to be a real problem in playtesting.

### FR-GP-040 — Disconnection
**Status:** REQUIRED
**Statement:** When a player's socket closes, the server removes them from the match
immediately, along with their score. Reconnecting is a fresh join with a new player ID.
**Acceptance:** A disconnected player disappears from the arena, the scoreboard, and the
player count within one tick. No ghost body or ghost hit volume remains. No session
resume token exists.

---

## Match flow

### FR-GP-041 — Scoring
**Status:** REQUIRED
**Statement:** A kill awards 1 point to the killer. In TDM the point also counts toward
the team's total.
**Acceptance:** Scores are computed server-side only; no client message can alter a score.

### FR-GP-042 — Suicide and environmental death
**Status:** PROPOSED
**Statement:** There is no fall damage, no out-of-bounds area, and no self-damage, so a
player can only die by enemy fire.
**Acceptance:** No code path can kill a player except `FR-GP-026` damage from an enemy.
**Note:** This makes the arena's boundary a hard requirement — see `FR-MAP-006`.

### FR-GP-043 — Match end condition
**Status:** REQUIRED
**Statement:** A match ends when either the time limit {MATCH_DURATION} is reached, or the
frag limit is reached — {FRAG_LIMIT_FFA} kills by one player in FFA, or
{FRAG_LIMIT_TDM} kills by one team in TDM — whichever happens first.
**Acceptance:** Both conditions are tested independently and each ends the match.

### FR-GP-044 — Match result
**Status:** REQUIRED
**Statement:** On match end, the winner is the highest-scoring player (FFA) or team (TDM).
Ties are shown as a draw; no overtime is played.
**Acceptance:** A match ending 10–10 in TDM displays a draw, not an arbitrary winner.

### FR-GP-045 — Post-match and restart
**Status:** REQUIRED
**Statement:** On match end, play stops, a results screen shows final standings for
{POST_MATCH_DURATION}, then a new match starts in the same room with scores reset and all
players respawned.
**Acceptance:** Players are not disconnected between matches. A player joining during the
results screen is placed into the next match.

### FR-GP-046 — Empty room cleanup
**Status:** PROPOSED
**Statement:** A room with zero connected players is destroyed after
{EMPTY_ROOM_GRACE_PERIOD}, freeing its simulation loop.
**Acceptance:** No timers, intervals, or simulation ticks continue to run for a destroyed
room.

---

## Visibility & concealment

### FR-GP-047 — Walls occlude players
**Status:** REQUIRED
**Statement:** Level geometry visually blocks players behind it. A player inside a room
with the door out of view is not visible to a player outside it.
**Acceptance:** Standing outside a closed room, an enemy inside it is not drawn on screen.
**Implementation note:** This is standard 3D depth-buffer occlusion — no special system is
required for the character models themselves. The work is entirely in `FR-GP-048`.

### FR-GP-048 — Nameplates must respect occlusion
**Status:** REQUIRED
**Statement:** A player's floating nameplate, team indicator, or any other screen-space
overlay attached to a player is hidden when line of sight to that player is blocked.
**Acceptance:** An enemy behind a wall has no visible nameplate. Verified by walking an
enemy behind cover and confirming the label disappears.
**Rationale:** This is the requirement that actually implements the original draft's
"if a player is inside a room the other one cannot see where he is". Without it,
nameplates render through walls and defeat all cover. Implement with a client-side
raycast from camera to player, evaluated at {NAMEPLATE_LOS_CHECK_HZ}, not every frame.

### FR-GP-049 — Occlusion is visual only
**Status:** REQUIRED
**Statement:** The server broadcasts the positions of all players to all clients,
regardless of line of sight. Concealment is a rendering property, not a networking one.
**Acceptance:** The state snapshot contains every living player.
**Known limitation — accepted:** A modified client can read positions of hidden players
(a wallhack). This is an explicit, documented trade-off, not a bug. Server-side visibility
culling is `DEFERRED` — see [09-out-of-scope.md](09-out-of-scope.md).

### FR-GP-050 — Cover geometry
**Status:** REQUIRED
**Statement:** The arena contains walls and freestanding cover that players can use to
break line of sight and interrupt an enemy's fire.
**Acceptance:** See `FR-MAP-004` and `FR-MAP-005` for the concrete geometry requirements.
