# Phase 1 Data Model: M0 — Walking box

**Feature**: `000-m0-walking-box` · **Date**: 2026-08-22

Types owned by `shared/`. All three are plain data: no methods, no class instances, no
prototypes, nothing that would survive `structuredClone` differently on two engines.

---

## `Vec3`

`readonly [number, number, number]` — a fixed-length tuple, not an object with `x`/`y`/`z`.

The tuple form is what `NET-004` and `NET-009` already put on the wire, so the simulation and
the protocol agree without a conversion layer. Coordinates are right-handed, Y up, matching
`FR-MAP-003`'s `bounds` and `pos` arrays and Three.js's own convention.

---

## `PlayerInput`

One tick of player **intent**. Produced by `client/input`, and after M1 also parsed from
`NET-004`.

| Field    | Type      | Validation                                                                                                      |
| -------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `move`   | `Vec3`    | Finite. Y is always `0`. Length ≤ 1 — the client normalises diagonals, and the server clamps rather than trusts |
| `dir`    | `Vec3`    | Finite. Unit length within `AIM_EPSILON`. Vertical component within the `CAMERA_PITCH_MIN`..`MAX` cone          |
| `jump`   | `boolean` | —                                                                                                               |
| `crouch` | `boolean` | —                                                                                                               |
| `sprint` | `boolean` | —                                                                                                               |

**What is deliberately absent**, and why each absence is load-bearing:

- **No `dt`.** The timestep is `TICK_DURATION`, a constant. `NET-004a` forbids a client-supplied
  delta time; having no field to read closes that hole by construction rather than by validation.
- **No `yaw`/`pitch`.** [ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md).
  An angle would force `Math.cos` into the simulation, and ECMA-262 does not pin down its result
  across engines.
- **No position, velocity, or speed.** An input that could assert an outcome would violate
  `NFR-001` the moment M1 puts it behind a socket. The type is the enforcement.
- **No `seq`.** Sequence numbers belong to the transport (`NET-004`, `NFR-007`), not the
  simulation. `step()` must not know that a network exists.

`move` is a vector rather than a key bitmask because the sim should not care which key produced
it; `client/input` translates `W`/`A`/`S`/`D` into a camera-relative vector, and after M1 the
server decodes `NET-004`'s bitmask into the same shape.

---

## `PlayerState`

The complete output of one simulation tick and the complete input to the next. M0 carries only
what movement needs; M2 adds health and ammo to the same object.

| Field       | Type      | Meaning                                                                                                                                                          |
| ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pos`       | `Vec3`    | Capsule **base** — the point where the player meets the floor, not the centre. Spawn points (`FR-MAP-003`) are floor positions, so this needs no offset at spawn |
| `vel`       | `Vec3`    | Metres per second                                                                                                                                                |
| `grounded`  | `boolean` | Recomputed every tick from the ground probe, never carried over                                                                                                  |
| `crouching` | `boolean` | Drives capsule height, and cannot become `false` under a ceiling                                                                                                 |

Not present in M0: `health`, `ammo`, `alive`, `team`, `score` (M2/M3); `yaw`, `pitch` (never —
orientation is presentation, per ADR-0001); anything animation-related (`NFR-017` — animation is
cosmetic and derived on the client).

### Derived, never stored

- **Capsule height** — `crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT`. Storing it would let it
  disagree with `crouching`.
- **Horizontal speed** — from `vel`. Storing it would let it disagree with `vel`.

### State transitions

```
        ┌──────────── jump (grounded ∧ ¬crouching) ────────────┐
        │                                                      ▼
   ┌─────────┐                                            ┌──────────┐
   │ GROUNDED│◀──────── ground probe hits ────────────────│ AIRBORNE │
   └─────────┘                                            └──────────┘
        │                                                      │
   full ground acceleration                        acceleration × AIR_CONTROL
        │                                                      │
        └──── crouch ⇄ stand (blocked while a ceiling is within PLAYER_HEIGHT) ────┘
```

Rules, each traceable to a requirement:

- Jump requires `grounded ∧ ¬crouching` — `FR-GP-018` and `D-016` make crouch and jump mutually
  exclusive. A second jump while airborne does nothing (`FR-GP-017`).
- `grounded` is recomputed after Y-axis collision resolution by a downward probe of
  `GROUND_PROBE_DISTANCE`. It is **not** derived from vertical velocity, which reads zero both
  when standing still on a block and at the apex of a jump.
- **Standing up is refused under a ceiling.** Releasing crouch inside a gap shorter than
  `PLAYER_HEIGHT` leaves the player crouched. Without this, releasing `Ctrl` under an overhang
  teleports the capsule into geometry. This is collision correctness, not a new game rule.
- Airborne horizontal acceleration is scaled by `AIR_CONTROL`.

---

## `GameMap`

The arena as data (`FR-MAP-002`, `FR-MAP-003`). Loaded from JSON, validated once at startup,
then immutable — the same object is read by collision and by the renderer, which is what makes it
impossible for them to disagree about geometry.

| Field     | Type                       |
| --------- | -------------------------- |
| `id`      | `string`                   |
| `name`    | `string`                   |
| `version` | `number`                   |
| `bounds`  | `{ min: Vec3; max: Vec3 }` |
| `blocks`  | `readonly Block[]`         |
| `spawns`  | `readonly Spawn[]`         |

**`Block`** — `{ id: string; pos: Vec3; size: Vec3; kind: 'wall' | 'cover' }`. `pos` is the box
**centre**; `size` is the **full** extent per axis (`FR-MAP-003`), so the half-extent used by
collision is derived, never stored.

**`Spawn`** — `{ id: string; pos: Vec3; yaw: number; team: 'ANY' | 'BLUE' | 'RED' }`. `yaw`
survives here because a spawn is authored content read by the _client_ to orient the camera on
entry; it never enters `PlayerInput` or `step()`. M0 validates all spawns and uses the first —
spawn selection is `FR-GP-038`, in M2.

`kind` is carried through M0 but has no collision effect yet: `wall` and `cover` both block
movement, and the difference (`cover` conceals only a crouched player) is a line-of-sight
property that first matters in M2.

### Validation rules

An invalid map fails loudly at startup rather than producing an unplayable match
(`FR-MAP-003`). Every rejection path is covered — `shared/map` is at a 100% threshold.

| #   | Rule                                                                  | Rejects                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every numeric field is finite                                         | `NaN`, `Infinity`, `null`, strings                                                                                                                                                                                                                                                        |
| 2   | `bounds.min < bounds.max` on all three axes                           | inverted or zero-volume arenas                                                                                                                                                                                                                                                            |
| 3   | `size` is strictly positive on all three axes                         | degenerate blocks that collide unpredictably                                                                                                                                                                                                                                              |
| 4   | Every block **intersects** `bounds`                                   | stray geometry floating somewhere unrelated. Intersection, not containment: `bounds` is the playable volume and the shell that encloses it necessarily sits just outside — `FR-MAP-003`'s own example puts a spawn at `y = 0` with `bounds.min.y = 0`, leaving nowhere inside for a floor |
| 5   | Every spawn lies inside `bounds` and not inside a block               | a player spawning stuck in a wall                                                                                                                                                                                                                                                         |
| 6   | `id` is unique across blocks, and across spawns                       | silent overwrite on lookup                                                                                                                                                                                                                                                                |
| 7   | At least one spawn exists                                             | an unplayable map that loads successfully                                                                                                                                                                                                                                                 |
| 8   | `kind` and `team` are members of their unions                         | typos becoming undefined behaviour                                                                                                                                                                                                                                                        |
| 9   | The arena is sealed: floor and perimeter walls fully enclose `bounds` | `FR-MAP-006` — no way to leave the arena                                                                                                                                                                                                                                                  |

Rule 9 is checked structurally at load, and separately proven by the containment test
(`M0-6`) which drives the player at every boundary and every jumpable block.

---

## New constants

Added to `shared/constants` and to [07-constants.md](../../requirements/07-constants.md), because
Principle IV admits no literal anywhere else.

| Constant                 | Value                | Why it is needed                                                                                                                     |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GROUND_PROBE_DISTANCE`  | `0.05 m`             | Depth of the downward probe defining `grounded` (R5)                                                                                 |
| `SPRINT_FORWARD_MIN_DOT` | `0.7071067811865476` | `cos 45°`, stored as a cosine so the sprint check needs no trigonometry (ADR-0001, `D-017`)                                          |
| `AIM_EPSILON`            | `0.001`              | Tolerance when validating that `dir` is unit length                                                                                  |
| `MAX_SUBSTEPS_PER_FRAME` | `5`                  | Accumulator cap that prevents the catch-up spiral (R3)                                                                               |
| `TICK_DURATION`          | derived              | `1 / SERVER_TICK_HZ`. **Computed, never written down** — `07-constants.md` already lists it under "Derived values — do not hardcode" |
