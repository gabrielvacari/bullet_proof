# 07 — Tuning Constants

**Every number in this project lives here and nowhere else.**

These values must be defined once, in `/shared/constants`, and imported by both the server
and the client. The server sends the client-relevant subset at join time (`NET-008a`) so
the two can never disagree.

Values marked **PROPOSED** were chosen as sensible defaults, not confirmed by playtesting.
Expect to change them. That is the point of this file — changing a number here must never
require touching game logic (`SC-4`).

---

## Match

| Constant | Value | Status | Notes |
|----------|-------|--------|-------|
| `MAX_PLAYERS_PER_ROOM` | `10` | REQUIRED | Hard cap per `FR-GP-013` |
| `MATCH_DURATION` | `8 min` (480000 ms) | PROPOSED | |
| `FRAG_LIMIT_FFA` | `20` | PROPOSED | Kills by one player |
| `FRAG_LIMIT_TDM` | `40` | PROPOSED | Kills by one team |
| `POST_MATCH_DURATION` | `15 s` | PROPOSED | Results screen before restart |
| `EMPTY_ROOM_GRACE_PERIOD` | `30 s` | PROPOSED | Before an empty room is destroyed |

## Player

| Constant | Value | Status | Notes |
|----------|-------|--------|-------|
| `PLAYER_MAX_HEALTH` | `100` | REQUIRED | No armour — `FR-GP-034` |
| `RESPAWN_DELAY` | `3 s` | PROPOSED | |
| `MIN_SPAWN_DISTANCE` | `15 m` | PROPOSED | From nearest living enemy |
| `PLAYER_HEIGHT` | `1.8 m` | PROPOSED | Standing capsule height |
| `CROUCH_HEIGHT` | `1.1 m` | PROPOSED | Also the height of waist-high cover — `FR-MAP-005` |
| `PLAYER_RADIUS` | `0.4 m` | PROPOSED | Collision capsule radius |
| `EYE_HEIGHT` | `1.6 m` | PROPOSED | Ray origin for firing |

## Movement

| Constant | Value | Status | Notes |
|----------|-------|--------|-------|
| `WALK_SPEED` | `5.0 m/s` | PROPOSED | |
| `SPRINT_SPEED` | `8.0 m/s` | PROPOSED | Forward-dominant movement only |
| `CROUCH_SPEED` | `2.5 m/s` | PROPOSED | |
| `JUMP_VELOCITY` | `6.0 m/s` | PROPOSED | Gives roughly a 1.8 m apex with the gravity below |
| `GRAVITY` | `-20.0 m/s²` | PROPOSED | Deliberately stronger than real gravity — snappier arcs |
| `AIR_CONTROL` | `0.3` | PROPOSED | Fraction of ground acceleration applicable mid-air |

## Weapon

| Constant | Value | Status | Notes |
|----------|-------|--------|-------|
| `MAGAZINE_SIZE` | `30` | PROPOSED | |
| `RELOAD_TIME` | `2.0 s` | PROPOSED | |
| `FIRE_RATE_RPS` | `8` shots/s | PROPOSED | ~480 RPM; server-enforced |
| `WEAPON_RANGE` | `100 m` | PROPOSED | Should comfortably exceed `ARENA_SIZE` |
| `DAMAGE_HEAD` | `50` | REQUIRED | 2 shots to kill |
| `DAMAGE_TORSO` | `20` | REQUIRED | 5 shots to kill |
| `DAMAGE_LEGS` | `10` | REQUIRED | 10 shots to kill |

## Map

| Constant | Value | Status | Notes |
|----------|-------|--------|-------|
| `ARENA_SIZE` | `80 × 80 m` | PROPOSED | Horizontal extent |
| `ARENA_CROSSING_TIME_TARGET` | `~16 s` at `WALK_SPEED` | PROPOSED | Sanity check on scale |
| `MIN_ENCLOSED_ROOMS` | `3` | PROPOSED | `FR-MAP-004` |
| `MIN_SPAWN_POINTS` | `12` | PROPOSED | `FR-MAP-007` |

## Networking

| Constant | Value | Status | Notes |
|----------|-------|--------|-------|
| `SERVER_TICK_HZ` | `30` | PROPOSED | Fixed simulation step (33.33 ms) |
| `SNAPSHOT_HZ` | `20` | PROPOSED | Broadcast rate |
| `INTERPOLATION_DELAY` | `100 ms` | PROPOSED | ≈ 2 snapshot intervals — `NFR-008` |
| `MAX_INPUTS_PER_SECOND` | `70` | PROPOSED | Above 60 fps to allow headroom — `NFR-010` |
| `MAX_QUEUED_INPUTS` | `10` | PROPOSED | Per client, per tick queue depth |
| `MAX_MESSAGE_BYTES` | `1024` | PROPOSED | Inbound message size cap |

## Identity & input

| Constant | Value | Status | Notes |
|----------|-------|--------|-------|
| `NICKNAME_MIN_LENGTH` | `2` | PROPOSED | |
| `NICKNAME_MAX_LENGTH` | `16` | PROPOSED | Must fit a nameplate and a scoreboard row |
| `ROOM_CODE_LENGTH` | `4` | PROPOSED | Alphabet excludes `0 O 1 I L` — `FR-GP-012` |

## Camera & client

| Constant | Value | Status | Notes |
|----------|-------|--------|-------|
| `CAMERA_OFFSET` | `[0.6, 1.7, -3.0]` | PROPOSED | Right, up, back — over the shoulder |
| `CAMERA_PITCH_MIN` | `-1.2 rad` | PROPOSED | ≈ -69° |
| `CAMERA_PITCH_MAX` | `+0.9 rad` | PROPOSED | ≈ +52° |
| `MOUSE_SENSITIVITY_DEFAULT` | `0.002 rad/px` | PROPOSED | |
| `NAMEPLATE_LOS_CHECK_HZ` | `10` | PROPOSED | Occlusion raycast rate — `FR-GP-048` |
| `TARGET_FPS` | `60` | PROPOSED | `NFR-014` |
| `MIN_VIEWPORT_WIDTH` | `1024 px` | PROPOSED | Below this the game refuses to load — `FR-UI-014` |
| `KILL_FEED_MAX_ENTRIES` | `5` | PROPOSED | |
| `KILL_FEED_ENTRY_TTL` | `6 s` | PROPOSED | |

---

## Derived values — do not hardcode

These follow from the constants above and must be computed, never written down twice:

- Shots to kill: `ceil(PLAYER_MAX_HEALTH / DAMAGE_<REGION>)` → 2 / 5 / 10
- Tick duration: `1000 / SERVER_TICK_HZ` → 33.33 ms
- Snapshot interval: `1000 / SNAPSHOT_HZ` → 50 ms
- Time to empty a magazine: `MAGAZINE_SIZE / FIRE_RATE_RPS` → 3.75 s
