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

| Constant                  | Value               | Status   | Notes                             |
| ------------------------- | ------------------- | -------- | --------------------------------- |
| `MAX_PLAYERS_PER_ROOM`    | `10`                | REQUIRED | Hard cap per `FR-GP-013`          |
| `MATCH_DURATION`          | `8 min` (480000 ms) | PROPOSED |                                   |
| `FRAG_LIMIT_FFA`          | `20`                | PROPOSED | Kills by one player               |
| `FRAG_LIMIT_TDM`          | `40`                | PROPOSED | Kills by one team                 |
| `POST_MATCH_DURATION`     | `15 s`              | PROPOSED | Results screen before restart     |
| `EMPTY_ROOM_GRACE_PERIOD` | `30 s`              | PROPOSED | Before an empty room is destroyed |

## Player

| Constant             | Value               | Status   | Notes                                                                                                                                                                                                  |
| -------------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PLAYER_MAX_HEALTH`  | `100`               | REQUIRED | No armour — `FR-GP-034`                                                                                                                                                                                |
| `RESPAWN_DELAY`      | `3 s`               | PROPOSED |                                                                                                                                                                                                        |
| `MIN_SPAWN_DISTANCE` | `15 m`              | PROPOSED | From nearest living enemy                                                                                                                                                                              |
| `PLAYER_HEIGHT`      | `1.8 m`             | PROPOSED | Standing capsule height                                                                                                                                                                                |
| `CROUCH_HEIGHT`      | `1.1 m`             | PROPOSED | Also the height of waist-high cover — `FR-MAP-005`                                                                                                                                                     |
| `PLAYER_RADIUS`      | `0.4 m`             | PROPOSED | Collision capsule radius                                                                                                                                                                               |
| `EYE_HEIGHT`         | `1.6 m`             | PROPOSED | Ray origin for firing                                                                                                                                                                                  |
| `IDLE_TIMEOUT`       | `120 s` (120000 ms) | PROPOSED | No valid input for this long removes the player as a disconnect — `D-019`. Deliberately generous: a short value punishes someone who tabbed away, which is a worse complaint than the problem it fixes |

## Movement

| Constant                 | Value                | Status   | Notes                                                                                                                                                                                       |
| ------------------------ | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WALK_SPEED`             | `5.0 m/s`            | PROPOSED |                                                                                                                                                                                             |
| `SPRINT_SPEED`           | `8.0 m/s`            | PROPOSED | Forward-dominant movement only                                                                                                                                                              |
| `CROUCH_SPEED`           | `2.5 m/s`            | PROPOSED |                                                                                                                                                                                             |
| `JUMP_VELOCITY`          | `6.0 m/s`            | PROPOSED | Gives roughly a 1.8 m apex with the gravity below                                                                                                                                           |
| `GRAVITY`                | `-20.0 m/s²`         | PROPOSED | Deliberately stronger than real gravity — snappier arcs                                                                                                                                     |
| `AIR_CONTROL`            | `0.3`                | PROPOSED | Fraction of ground acceleration applicable mid-air                                                                                                                                          |
| `SPRINT_FORWARD_MIN_DOT` | `0.7071067811865476` | PROPOSED | `cos 45°` — sprint applies while the movement input's dot with forward is at least this. Stored as a cosine, not an angle, because ADR-0001 bars trigonometry from the simulation — `D-017` |
| `GROUND_PROBE_DISTANCE`  | `0.05 m`             | PROPOSED | Downward probe below the capsule that defines grounded — `FR-GP-017`                                                                                                                        |

## Weapon

| Constant                | Value       | Status   | Notes                                                                         |
| ----------------------- | ----------- | -------- | ----------------------------------------------------------------------------- |
| `MAGAZINE_SIZE`         | `30`        | PROPOSED |                                                                               |
| `RELOAD_TIME`           | `2.0 s`     | PROPOSED |                                                                               |
| `FIRE_RATE_RPS`         | `8` shots/s | PROPOSED | ~480 RPM; server-enforced                                                     |
| `WEAPON_RANGE`          | `100 m`     | PROPOSED | Should comfortably exceed `ARENA_SIZE`                                        |
| `DAMAGE_HEAD`           | `50`        | REQUIRED | 2 shots to kill                                                               |
| `DAMAGE_TORSO`          | `20`        | REQUIRED | 5 shots to kill                                                               |
| `DAMAGE_LEGS`           | `10`        | REQUIRED | 10 shots to kill                                                              |
| `HEAD_CENTRE_FRACTION`  | `0.93`      | PROPOSED | Head sphere centre, as a fraction of the current capsule height — `FR-GP-027` |
| `HEAD_RADIUS_FRACTION`  | `0.07`      | PROPOSED | Small enough that a head shot is a skill shot                                 |
| `TORSO_TOP_FRACTION`    | `0.86`      | PROPOSED | Meets the head sphere without a gap                                           |
| `TORSO_BOTTOM_FRACTION` | `0.50`      | PROPOSED | Hip line; also the leg capsule's top                                          |
| `TORSO_RADIUS_FRACTION` | `0.14`      | PROPOSED | Must stay below `PLAYER_RADIUS`                                               |
| `LEG_TOP_FRACTION`      | `0.50`      | PROPOSED | Shares the torso's boundary — no gap, no overlap                              |
| `LEG_BOTTOM_FRACTION`   | `0.02`      | PROPOSED | Just above the floor, so a grazing ground-level shot still registers          |
| `LEG_RADIUS_FRACTION`   | `0.10`      | PROPOSED | Must stay below `PLAYER_RADIUS`                                               |

## Map

| Constant                     | Value                   | Status   | Notes                 |
| ---------------------------- | ----------------------- | -------- | --------------------- |
| `ARENA_SIZE`                 | `80 × 80 m`             | PROPOSED | Horizontal extent     |
| `ARENA_CROSSING_TIME_TARGET` | `~16 s` at `WALK_SPEED` | PROPOSED | Sanity check on scale |
| `MIN_ENCLOSED_ROOMS`         | `3`                     | PROPOSED | `FR-MAP-004`          |
| `MIN_SPAWN_POINTS`           | `12`                    | PROPOSED | `FR-MAP-007`          |

## Networking

| Constant                | Value    | Status   | Notes                                                                  |
| ----------------------- | -------- | -------- | ---------------------------------------------------------------------- |
| `SERVER_TICK_HZ`        | `30`     | PROPOSED | Fixed simulation step (33.33 ms)                                       |
| `SNAPSHOT_HZ`           | `20`     | PROPOSED | Broadcast rate                                                         |
| `INTERPOLATION_DELAY`   | `100 ms` | PROPOSED | ≈ 2 snapshot intervals — `NFR-008`                                     |
| `MAX_INPUTS_PER_SECOND` | `70`     | PROPOSED | Above 60 fps to allow headroom — `NFR-010`                             |
| `MAX_QUEUED_INPUTS`     | `10`     | PROPOSED | Per client, per tick queue depth                                       |
| `MAX_MESSAGE_BYTES`     | `1024`   | PROPOSED | Inbound message size cap                                               |
| `AIM_EPSILON`           | `0.001`  | PROPOSED | Tolerance when validating that `input.dir` is unit length — `NET-004c` |

## Identity & input

| Constant                 | Value                             | Status   | Notes                                                        |
| ------------------------ | --------------------------------- | -------- | ------------------------------------------------------------ |
| `NICKNAME_MIN_LENGTH`    | `2`                               | PROPOSED |                                                              |
| `NICKNAME_MAX_LENGTH`    | `16`                              | PROPOSED | Must fit a nameplate and a scoreboard row                    |
| `ROOM_CODE_LENGTH`       | `4`                               | PROPOSED | Alphabet excludes `0 O 1 I L` — `FR-GP-012`                  |
| `ROOM_CODE_ALPHABET`     | `23456789ABCDEFGHJKMNPQRSTUVWXYZ` | PROPOSED | The alphabet `FR-GP-012` describes by exclusion, written out |
| `ROOM_CODE_MAX_ATTEMPTS` | `10`                              | PROPOSED | Bounds the retry when a generated code collides              |

## Camera & client

| Constant                          | Value                                        | Status   | Notes                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CAMERA_OFFSET`                   | `[0.6, 1.7, -3.0]`                           | PROPOSED | Right, up, back — over the shoulder                                                                                                                                                  |
| `CAMERA_PITCH_MIN`                | `-1.2 rad`                                   | PROPOSED | ≈ -69°                                                                                                                                                                               |
| `CAMERA_PITCH_MAX`                | `+0.9 rad`                                   | PROPOSED | ≈ +52°                                                                                                                                                                               |
| `AIM_DIR_Y_MIN` / `AIM_DIR_Y_MAX` | `-0.9320390859672263` / `0.7833269096274834` | PROPOSED | `sin(CAMERA_PITCH_MIN)` / `sin(CAMERA_PITCH_MAX)` — the vertical component `input.dir` may take. Stored as sines because ADR-0001 bars trigonometry from the simulation — `NET-004c` |
| `MOUSE_SENSITIVITY_DEFAULT`       | `0.002 rad/px`                               | PROPOSED |                                                                                                                                                                                      |
| `NAMEPLATE_LOS_CHECK_HZ`          | `10`                                         | PROPOSED | Occlusion raycast rate — `FR-GP-048`                                                                                                                                                 |
| `TARGET_FPS`                      | `60`                                         | PROPOSED | `NFR-014`                                                                                                                                                                            |
| `MIN_VIEWPORT_WIDTH`              | `1024 px`                                    | PROPOSED | Below this the game refuses to load — `FR-UI-014`                                                                                                                                    |
| `KILL_FEED_MAX_ENTRIES`           | `5`                                          | PROPOSED |                                                                                                                                                                                      |
| `KILL_FEED_ENTRY_TTL`             | `6 s`                                        | PROPOSED |                                                                                                                                                                                      |
| `MAX_SUBSTEPS_PER_FRAME`          | `5`                                          | PROPOSED | Cap on simulation ticks consumed per rendered frame; surplus accumulated time is discarded, not simulated                                                                            |

---

## Derived values — do not hardcode

These follow from the constants above and must be computed, never written down twice:

- Shots to kill: `ceil(PLAYER_MAX_HEALTH / DAMAGE_<REGION>)` → 2 / 5 / 10
- Tick duration: `1000 / SERVER_TICK_HZ` → 33.33 ms
- Snapshot interval: `1000 / SNAPSHOT_HZ` → 50 ms
- Time to empty a magazine: `MAGAZINE_SIZE / FIRE_RATE_RPS` → 3.75 s
- Ticks per shot: `SERVER_TICK_HZ / FIRE_RATE_RPS` → 3.75 — **not an integer.** The cooldown
  accumulates fractionally; 3.75 is exactly representable, so it stays bit-identical across
  engines. Rounding to 4 would give 7.5 shots/s while `FIRE_RATE_RPS` said 8 — a silent `SC-4`
  failure
- Reload in ticks: `ceil(RELOAD_TIME / TICK_DURATION_MS)` → 60
- Respawn in ticks: `ceil(RESPAWN_DELAY / TICK_DURATION_MS)` → 90
- Spawn distance squared: `MIN_SPAWN_DISTANCE ** 2` → 225, so spawn selection compares squared
  distances and needs no `Math.sqrt`
- Aim cast range: `WEAPON_RANGE` plus the camera-to-eye distance from `CAMERA_OFFSET` → ≈ 103.06.
  The aim cast starts behind the eye, so it must run further to guarantee a focus point at least
  `WEAPON_RANGE` away from the eye — `ADR-0002`

Durations round **up**, so changing a duration constant can never silently shorten a duration
below what the requirement states.
