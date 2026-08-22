# Contract: arena map file

**Feature**: `000-m0-walking-box` · **File**: `assets/maps/arena-01.json` ·
**Requirements**: `FR-MAP-002`, `FR-MAP-003`, `FR-MAP-006`, `FR-MAP-010`

This file is a contract in the strict sense: it is hand-authored content read by two independent
consumers — the renderer and the collision system — and `FR-MAP-002` requires that moving a wall
in it changes both, with no code change. That single source is what kills the classic bug where a
shot visually hits a wall but the server registers a hit on a player.

**The format is final at M0. The level design is not** — M0 ships a blockout; `FR-MAP-004`,
`FR-MAP-005`, `FR-MAP-007` and `FR-MAP-009` describe the finished arena and are satisfied at M4.

---

## Format

Exactly as specified by `FR-MAP-003`, unchanged:

```jsonc
{
  "id": "arena-01",
  "name": "Warehouse",
  "version": 1,
  "bounds": { "min": [-40, 0, -40], "max": [40, 12, 40] },
  "blocks": [{ "id": "w1", "pos": [0, 1.5, -10], "size": [12, 3, 0.5], "kind": "wall" }],
  "spawns": [{ "id": "s1", "pos": [-30, 0, -30], "yaw": 0.78, "team": "ANY" }],
}
```

| Field           | Meaning                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bounds`        | Axis-aligned arena extent. No player position may ever leave it (`FR-MAP-006`)                                                                                                                           |
| `blocks[].pos`  | The box **centre** — not a corner                                                                                                                                                                        |
| `blocks[].size` | **Full** extent per axis. Half-extents are derived by the loader, never authored                                                                                                                         |
| `blocks[].kind` | `wall` (full height, blocks sight and movement) or `cover` (waist-high, blocks sight only when crouched)                                                                                                 |
| `spawns[].yaw`  | Initial facing, radians. Read by the **client** to orient the camera on entry. It never enters `PlayerInput` — see [ADR-0001](../../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md) |
| `spawns[].team` | `ANY`, `BLUE`, or `RED`. Parsed and validated in M0; selection is `FR-GP-038` in M2                                                                                                                      |

`kind` has no collision effect in M0 — `wall` and `cover` both block movement. The distinction is
a line-of-sight property that first matters in M2.

---

## Loader contract

```ts
export function loadMap(raw: unknown): GameMap; // throws MapValidationError
export class MapValidationError extends Error {} // message names the offending id and rule
```

**Fails loudly at startup, never silently** (`FR-MAP-003`). A map that cannot be trusted must stop
the process rather than produce an arena where the renderer and collision disagree — which is the
exact failure `FR-MAP-002` exists to prevent, and it would surface as an unexplainable hit
registration hours later.

The error message names both the offending element's `id` and the rule it broke. "Invalid map" is
not an acceptable message for a file a human edits by hand.

Validation rules 1–9 are enumerated in [data-model.md](../data-model.md#validation-rules). Every
rejection path is covered — `shared/map` sits at a 100% coverage threshold, so an unreachable or
untested branch fails the build.

---

## Consumption

Both consumers read the **same loaded object**. Neither re-parses the file, and neither keeps its
own copy of the geometry.

| Consumer        | Reads              | Must not                                                   |
| --------------- | ------------------ | ---------------------------------------------------------- |
| `shared/sim`    | `bounds`, `blocks` | know that a renderer exists                                |
| `client/render` | `bounds`, `blocks` | apply any offset, scale, or rounding to positions or sizes |
| `client/boot`   | `spawns[0]`        | pick a spawn by any rule — that is `FR-GP-038`, M2         |

The renderer applying its own transform to geometry would silently reintroduce the divergence
this contract exists to prevent. Materials, colours and lighting are the renderer's business;
positions and sizes are not.

---

## M0 blockout requirements

The M0 arena must contain enough to exercise every code path the milestone claims to deliver:

- a floor and a fully sealed perimeter (`FR-MAP-006`) — otherwise `M0-6` is untestable;
- at least one wall to slide along, and one inside corner, for collision resolution;
- at least two blocks low enough to jump onto, one reachable only by jumping (`FR-MAP-010`);
- at least one waist-high `cover` block at `CROUCH_HEIGHT` (`FR-MAP-005`), so the crouch capsule
  resize is visible;
- at least one overhang low enough to stand under while crouched, to exercise the
  refuse-to-stand-under-a-ceiling rule;
- at least one spawn point.

It does **not** need {MIN_ENCLOSED_ROOMS} rooms, {MIN_SPAWN_POINTS} spawns, or {ARENA_SIZE}
proportions. Those are M4's.
