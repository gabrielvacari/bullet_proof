# Phase 1 Data Model: M2 — Shooting

**Feature**: `002-m2-shooting` · **Date**: 2026-08-22

What M2 adds to the types M0 established. Everything here is plain data — no methods, no class
instances, nothing whose identity or prototype could differ between two engines.

Two types are extended (`PlayerState`, `PlayerInput`) and four are new (`HitRegion`,
`HitVolume`, `ShotIntent`, `ShotResult`). None of them stores a timestamp, because the
simulation has no clock (`NFR-004`).

---

## `PlayerInput` — two new intent flags

| Field    | Type      | Validation                              |
| -------- | --------- | --------------------------------------- |
| `fire`   | `boolean` | Decoded from `NET-004`'s `keys` bit 128 |
| `reload` | `boolean` | Decoded from `NET-004`'s `keys` bit 256 |

Everything M0 said about this type still holds, and holds harder now that there is something
worth lying about. Both new fields are **requests** (`NET-004b`): they say what the player
pressed, never what happened. There is still no `dt`, no `seq`, no position, no velocity — and
now also no target, no victim, no damage figure and no hit flag. `NET-007` is that absence, and
`M2-3` is the test that proves the absence is real rather than merely intended.

`keys` is validated as a non-negative safe integer and **masked** to the defined bits before
decoding, so an undefined bit cannot reach game logic
([research.md § R6](research.md#r6--protocol-surface-and-the-validation-boundary)).

---

## `PlayerState` — health, ammunition, and three countdowns

M0's four fields (`pos`, `vel`, `grounded`, `crouching`) are unchanged. M2 adds:

| Field          | Type     | Meaning                                                                                                     |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `health`       | `number` | Integer, `0`..{PLAYER_MAX_HEALTH}. Clamped at zero — it never goes negative (`FR-GP-034`)                   |
| `magazine`     | `number` | Integer, `0`..{MAGAZINE_SIZE}. Reserve ammunition is unlimited, so there is no second counter (`FR-GP-030`) |
| `fireCooldown` | `number` | Ticks until the next shot is permitted. **Fractional** — see below                                          |
| `reloadTicks`  | `number` | Ticks remaining in a reload; `0` means not reloading (`FR-GP-031`)                                          |
| `respawnTicks` | `number` | Ticks remaining before respawn; `0` means none pending (`FR-GP-037`)                                        |

**Deliberately absent**, each for a reason:

- **No `armour`, `shield` or `vest`.** `FR-GP-034` requires that no such value exist in player
  state — not that it be zero. There is no field to set.
- **No `alive` flag.** Derived: `health > 0`. Two fields could disagree; one cannot.
- **No `weapon` or `weaponId`.** `FR-GP-023` requires no code path to change a player's weapon,
  and the cheapest way to guarantee that is to have nothing to change.
- **No `kills`, `deaths` or `score`.** Scoring is `FR-GP-041`, in M3, and belongs to the room
  rather than to the simulated player (`NET-009b` keeps it out of the snapshot too).
- **No `lastHitBy`, `killer`, or damage history.** A kill is an event the room emits
  (`NET-015`), not a property a player carries.
- **No position history buffer.** `NFR-009` — no rewind, by decision. Adding the buffer "for
  later" is the architecture [`09-out-of-scope.md`](../../requirements/09-out-of-scope.md)
  forbids.

### Derived, never stored

- **`alive`** — `health > 0`.
- **`reloading`** — `reloadTicks > 0`. Feeds `NET-009`'s `st` bit 8.
- **`dead`** — `!alive`. Feeds `NET-009`'s `st` bit 16.
- **`canFire`** — `alive && !reloading && magazine > 0 && fireCooldown <= 0`. Never stored,
  because every input to it is already state.

### Why `fireCooldown` is a float

{FIRE_RATE_RPS} = 8 against {SERVER_TICK_HZ} = 30 is `3.75` ticks per shot — not an integer. The
cooldown is **decremented by 1 each tick and incremented by `TICKS_PER_SHOT` on firing**, so the
fractional remainder is carried rather than discarded and the long-run rate is exactly
{FIRE_RATE_RPS}.

`3.75` and every partial sum of it are exactly representable in IEEE 754 binary, so this is
bit-identical across engines and stays inside `NFR-003`. Rounding to 4 ticks instead would give
7.5 shots/s while the constant said 8 — a silent `SC-4` failure. Full reasoning in
[research.md § R4](research.md#r4--durations-in-a-simulation-with-no-clock).

### State transitions

```
                         health reaches 0 (FR-GP-036)
   ┌────────────────────────────────────────────────────────────┐
   │                                                            ▼
┌──────┐   fire & canFire   ┌──────────┐                    ┌──────┐
│ALIVE │──────────────────▶│ SHOT OUT │                    │ DEAD │
│      │◀──────────────────└──────────┘                    │      │
└──────┘                                                    └──────┘
   ▲   │  reload | empty magazine                              │
   │   ▼                                                       │
   │  ┌───────────┐   reloadTicks reaches 0                    │
   │  │ RELOADING │────────────────────────────────────────────┤
   │  └───────────┘   magazine := MAGAZINE_SIZE                │
   │                                                           │
   └──────── respawnTicks reaches 0: full health, full ────────┘
             magazine, no pending reload (FR-GP-037, FR-GP-032)
```

Rules, each traceable to a requirement:

- **A dead player simulates nothing.** Inputs are ignored entirely; movement, firing and
  reloading all stop, and the hit volumes leave the raycast (`FR-GP-036`). Only `respawnTicks`
  advances.
- **Death cancels a reload.** `reloadTicks` is cleared on death, and respawn grants
  {MAGAZINE_SIZE} with no pending reload (`FR-GP-032`).
- **Firing with an empty magazine starts a reload** rather than doing nothing (`FR-GP-031`).
- **Reloading a full magazine does nothing** — not a zero-length reload, no reload at all
  (`FR-GP-031`).
- **A reload in progress is not cancelled or restarted by the fire input**, and no shot is
  produced while it runs (`FR-GP-031`).
- **Health never regenerates and is never restored during a life** (`FR-GP-035`). The only
  transition that raises it is respawn.
- **Nothing but enemy fire reduces health** (`FR-GP-042`): no fall damage, no out-of-bounds
  damage, no self-damage. The shooter is excluded from their own cast, so there is no code path
  to test for.

---

## `HitRegion`

`'HEAD' | 'TORSO' | 'LEGS'` — the same three strings `NET-013`, `NET-014` and `NET-015` already
carry, so the simulation's value goes on the wire without a mapping layer.

Damage per region comes from {DAMAGE_HEAD}, {DAMAGE_TORSO} and {DAMAGE_LEGS} (`FR-GP-026`), and
does **not** vary with distance (`FR-GP-028`).

---

## `HitVolume`

The three static primitives of `FR-GP-027`, built on demand from a player's `pos` and
`crouching` and **never stored** — a stored volume could drift from the transform it claims to
describe, which is the bug the requirement exists to prevent.

| Region  | Shape   | Definition                                                                                         |
| ------- | ------- | -------------------------------------------------------------------------------------------------- |
| `HEAD`  | Sphere  | Centre at `pos.y + HEAD_CENTRE_FRACTION × h`, radius `HEAD_RADIUS_FRACTION × h`                    |
| `TORSO` | Capsule | Segment `TORSO_BOTTOM_FRACTION × h` → `TORSO_TOP_FRACTION × h`, radius `TORSO_RADIUS_FRACTION × h` |
| `LEGS`  | Capsule | Segment `LEG_BOTTOM_FRACTION × h` → `LEG_TOP_FRACTION × h`, radius `LEG_RADIUS_FRACTION × h`       |

`h` is the player's current capsule height — {PLAYER_HEIGHT} standing, {CROUCH_HEIGHT} crouched,
exactly as `collide.ts` already derives it. Expressing every dimension as a fraction of `h` means
one set of numbers covers both stances, and it is what makes crouch tactical rather than a pure
downside: the head drops with the body, so a crouched player behind {CROUCH_HEIGHT} cover is
genuinely harder to hit in the head (`FR-GP-018`).

**Two invariants, both asserted by test rather than claimed by comment:**

1. Every radius is at or below {PLAYER_RADIUS}, so a hit volume can never protrude beyond the
   movement box and be hit through a wall the player is flush against.
2. The three volumes are contiguous and reach from the ground to the top of the capsule, so
   there is no band of a player's body that no shot can hit.

**They are not derived from a skeleton, a mesh, or an animation, and never will be.**
`FR-GP-027` and `NFR-017`. There is no animation system in M2, which makes the mistake almost
impossible to make today — which is exactly why the volumes are pinned to the transform now,
before M4 arrives with bones.

---

## `ShotIntent`

What `step()` produces on a tick where the weapon rules permitted a shot. Emitted alongside the
new `PlayerState`, not stored on it.

| Field       | Type   | Meaning                                                                      |
| ----------- | ------ | ---------------------------------------------------------------------------- |
| `eye`       | `Vec3` | `pos + [0, EYE_HEIGHT, 0]` — the origin `FR-GP-024` names                    |
| `cameraEye` | `Vec3` | The nominal camera position, from `CAMERA_OFFSET` and `dir`                  |
| `dir`       | `Vec3` | The unit aim vector the player sent, unchanged from `PlayerInput` (ADR-0001) |

**It carries no target, no victim, no damage and no hit flag**, because at the moment it is
produced none of those is known — `step()` sees one player. Resolution is a separate, room-level
step ([research.md § R2](research.md#r2--where-combat-lives-and-what-happens-to-step)).

**`cameraEye` is the field the [Q-003 gate](plan.md#gates) governs.** Under the recommended
option 1 it is the origin of the aim cast that finds the focus point. Under option 2 it is unused
and the field disappears. The rest of this data model is identical either way, which is what
makes it safe to plan M2 while `Q-003` is still open.

**Camera collision (`FR-GP-020`) is excluded from `cameraEye`.** It uses the nominal offset only.
Feeding the pulled-in camera into the shot would make the aim point jump the instant a player
backed into a wall, and would drag a `client/render` concern into the authoritative path.

---

## `ShotResult`

The single value from which `NET-012`, `NET-013`, `NET-014` and `NET-015` are all derived, so
those four messages can never describe different events.

| Field      | Type                               | Meaning                                                           |
| ---------- | ---------------------------------- | ----------------------------------------------------------------- |
| `from`     | `Vec3`                             | The eye. Goes straight into `NET-012`'s `from`                    |
| `to`       | `Vec3`                             | Impact point, or the point at {WEAPON_RANGE} if nothing was hit   |
| `kind`     | `'NONE' \| 'GEOMETRY' \| 'PLAYER'` | What stopped the ray                                              |
| `victimId` | `string \| null`                   | Set only when `kind === 'PLAYER'`                                 |
| `region`   | `HitRegion \| null`                | Set only when `kind === 'PLAYER'`                                 |
| `damage`   | `number`                           | `0` unless `kind === 'PLAYER'`; from the region, never from range |

`lethal` is **not** here. Whether a hit killed depends on the victim's health at the moment the
damage lands, which is the applier's business, not the caster's. `NET-014`'s `lethal` is computed
where the damage is applied.

### Resolution order — total, and stable

`FR-GP-025` requires the nearest intersection among level geometry and the hit volumes of
**eligible** targets. Eligibility in M2 excludes the shooter (`FR-GP-042`) and the dead
(`FR-GP-036`); M3 adds teammates to that filter (`FR-GP-025`), which is why the filter exists as
a seam now rather than being inlined as "everyone else".

Ties must not be decided by iteration order, or a replay could differ from the run it replays:

1. Smallest ray parameter `t` wins.
2. On an exact tie between geometry and a player, **geometry wins** — the bullet is stopped.
   Conservative, and it makes shooting through a wall corner impossible rather than
   float-dependent.
3. On an exact tie between two players, the lower player `id` wins, lexicographically.
4. On an exact tie between two regions of the same player, the fixed order `HEAD`, `TORSO`,
   `LEGS` decides. Arbitrary, but written down, which is the property that matters.

### Arithmetic

Ray/AABB is the slab method — comparison and division only. Ray/sphere and ray/capsule are
quadratics needing `Math.sqrt`, which `ADR-0001` permits because ECMA-262 requires it to be
correctly rounded. **No trigonometry, no `Math.hypot`, no `Math.pow`, no `Math.random`, no
clock** — the same rules `step()` lives under, enforced by the same ESLint rule on `shared/**`.

---

## New constants

M2 needs numbers that do not exist yet. Per Constitution Principle IV they are listed here and
belong in `shared/constants` and in
[`07-constants.md`](../../requirements/07-constants.md) — **this plan does not edit
`requirements/`**; adding them is listed in
[plan.md § Requirements this plan implies](plan.md#requirements-this-plan-implies) for the
project owner.

All proposed values are `PROPOSED` in the sense
[`README.md`](../../requirements/README.md) defines: a sensible default, expected to move with
playtesting, and changeable without touching code (`SC-4`).

### Hit volume geometry — fractions of the current capsule height

| Constant                | Proposed | Standing (1.8 m) | Crouched (1.1 m) | Why                                                                     |
| ----------------------- | -------- | ---------------- | ---------------- | ----------------------------------------------------------------------- |
| `HEAD_CENTRE_FRACTION`  | `0.93`   | 1.674 m          | 1.023 m          | Head sphere centre above the capsule base                               |
| `HEAD_RADIUS_FRACTION`  | `0.07`   | 0.126 m          | 0.077 m          | Small enough that a head shot is a skill shot                           |
| `TORSO_TOP_FRACTION`    | `0.86`   | 1.548 m          | 0.946 m          | Meets the head sphere without a gap                                     |
| `TORSO_BOTTOM_FRACTION` | `0.50`   | 0.900 m          | 0.550 m          | Hip line; also the leg capsule's top                                    |
| `TORSO_RADIUS_FRACTION` | `0.14`   | 0.252 m          | 0.154 m          | Below {PLAYER_RADIUS} — invariant 1                                     |
| `LEG_TOP_FRACTION`      | `0.50`   | 0.900 m          | 0.550 m          | Shares the torso's boundary — no gap, no overlap                        |
| `LEG_BOTTOM_FRACTION`   | `0.02`   | 0.036 m          | 0.022 m          | Just above the floor, so a grazing shot at ground level still registers |
| `LEG_RADIUS_FRACTION`   | `0.10`   | 0.180 m          | 0.110 m          | Below {PLAYER_RADIUS} — invariant 1                                     |

### Derived — computed, never written down twice

Following M0's habit and `07-constants.md`'s own "Derived values — do not hardcode" section:

| Constant                | Derivation                                                               | At current values |
| ----------------------- | ------------------------------------------------------------------------ | ----------------- |
| `TICKS_PER_SHOT`        | `SERVER_TICK_HZ / FIRE_RATE_RPS`                                         | `3.75`            |
| `RELOAD_TICKS`          | `Math.ceil(RELOAD_TIME / TICK_DURATION_MS)`                              | `60`              |
| `RESPAWN_TICKS`         | `Math.ceil(RESPAWN_DELAY / TICK_DURATION_MS)`                            | `90`              |
| `MIN_SPAWN_DISTANCE_SQ` | `MIN_SPAWN_DISTANCE * MIN_SPAWN_DISTANCE`                                | `225`             |
| `AIM_CAST_RANGE`        | `WEAPON_RANGE` + the camera-to-eye distance derived from `CAMERA_OFFSET` | ≈ `103.06`        |

`Math.ceil` is on `ADR-0001`'s permitted list. Rounding **up** is the rule so that changing a
duration constant can never silently shorten a duration below what the requirement states.

`MIN_SPAWN_DISTANCE_SQ` exists so spawn selection compares squared distances and needs no
`Math.sqrt` at all ([research.md § R5](research.md#r5--spawn-selection-needs-no-randomness)).

`AIM_CAST_RANGE` exists only under the recommended Q-003 option 1 — the aim cast starts behind
the eye, so it must run further to guarantee a focus point at least {WEAPON_RANGE} from the eye.
Under option 2 it is not needed.

### Constants M2 uses that already exist

Listed so the plan can be checked against `07-constants.md` without re-reading it:
{PLAYER_MAX_HEALTH}, {DAMAGE_HEAD}, {DAMAGE_TORSO}, {DAMAGE_LEGS}, {MAGAZINE_SIZE},
{RELOAD_TIME}, {FIRE_RATE_RPS}, {WEAPON_RANGE}, {RESPAWN_DELAY}, {MIN_SPAWN_DISTANCE},
{EYE_HEIGHT}, {PLAYER_HEIGHT}, {CROUCH_HEIGHT}, {PLAYER_RADIUS}, {CAMERA_OFFSET},
{SERVER_TICK_HZ}, {MAX_QUEUED_INPUTS}, {MAX_INPUTS_PER_SECOND}, {MAX_MESSAGE_BYTES}.

Every one of them is imported by name. `M2-16` verifies mechanically that no combat number
exists anywhere else.

---

## `GameMap` — unchanged

M2 adds no field to the map. It reads `blocks` for the raycast — **the same loaded `GameMap` the
renderer draws** (`FR-MAP-002`), which is what makes "the shot visually hit a wall but the server
registered a hit on a player" impossible rather than merely unlikely — and it reads `spawns` for
`FR-GP-038`.

The blockout arena's data does change: it has two spawn points today, which is enough for the
demo criterion and not enough to exercise spawn **selection**. M2 adds more spawns to
`assets/maps/arena-01.json`. That is content, not schema — `MIN_SPAWN_POINTS` and the designed
arena remain `FR-MAP-007` and `FR-MAP-009`, satisfied at M4.

`spawns[].team` is still validated and still unused: M2 has no teams, so every spawn is eligible
for every player. M3 supplies teams to the same filter.
