# 04 — Map

### FR-MAP-001 — One hand-authored arena
**Status:** REQUIRED
**Statement:** v1 ships exactly one arena, authored by hand. No procedural generation, no
map voting, no map rotation.
**Acceptance:** A single map definition file exists and is loaded by both client and
server.

### FR-MAP-002 — Map is data, not code
**Status:** REQUIRED
**Statement:** The arena is defined in a JSON file describing axis-aligned box volumes and
spawn points. Both the client renderer and the server collision/raycast system build from
that same file.
**Acceptance:** Moving a wall in the JSON changes both what is drawn and what blocks
bullets, with no code change. Client and server can never disagree about geometry.
**Rationale:** A single source of truth for geometry is what prevents the classic bug
where a shot visually hits a wall but registers a hit on the server.

### FR-MAP-003 — Map schema
**Status:** PROPOSED
**Statement:** The map file has this shape:

```json
{
  "id": "arena-01",
  "name": "Warehouse",
  "version": 1,
  "bounds": { "min": [-40, 0, -40], "max": [40, 12, 40] },
  "blocks": [
    { "id": "w1", "pos": [0, 1.5, -10], "size": [12, 3, 0.5], "kind": "wall" }
  ],
  "spawns": [
    { "id": "s1", "pos": [-30, 0, -30], "yaw": 0.78, "team": "ANY" }
  ]
}
```

- `blocks[].pos` is the centre of the box; `size` is full extent on each axis.
- `kind` is one of `wall` (full height, blocks sight and movement) or `cover`
  (waist-high, blocks sight only when crouched).
- `spawns[].team` is `ANY`, `BLUE`, or `RED`.

**Acceptance:** The schema is validated on load; an invalid map fails loudly at startup
rather than producing an unplayable match.

### FR-MAP-004 — Enclosed rooms
**Status:** REQUIRED
**Statement:** The arena contains at least {MIN_ENCLOSED_ROOMS} enclosed rooms — spaces
bounded by full-height walls with a limited number of entrances — so that a player inside
one is invisible from most of the arena.
**Acceptance:** Directly satisfies `FR-GP-047`. Standing in the centre of the arena, a
player inside a room is not visible.

### FR-MAP-005 — Waist-high cover
**Status:** REQUIRED
**Statement:** Open areas contain freestanding cover of height {CROUCH_HEIGHT} that
conceals a crouched player but not a standing one.
**Acceptance:** Directly gives crouch (`FR-GP-018`) a tactical purpose. Verified by
crouching behind a cover block and confirming the player is not visible from across the
arena.

### FR-MAP-006 — Sealed boundary
**Status:** REQUIRED
**Statement:** The arena is fully enclosed by geometry. There is no way to leave it, fall
out of it, or reach a position outside `bounds`.
**Acceptance:** No sequence of movement inputs — including jumping onto every block — puts
a player outside `bounds`.
**Rationale:** `FR-GP-042` says there is no fall damage and no out-of-bounds kill, so the
boundary is the only thing keeping a player in the playable space.

### FR-MAP-007 — Spawn point count
**Status:** PROPOSED
**Statement:** The arena has at least {MIN_SPAWN_POINTS} spawn points, distributed so that
`FR-GP-038` can usually satisfy {MIN_SPAWN_DISTANCE}.
**Acceptance:** With {MAX_PLAYERS_PER_ROOM} players alive, a valid spawn point satisfying
the distance rule exists in the large majority of cases.

### FR-MAP-008 — Team spawn zones in TDM
**Status:** PROPOSED
**Statement:** In TDM, spawn points tagged `BLUE` and `RED` are clustered at opposite ends
of the arena; `ANY` spawns are unused in TDM.
**Acceptance:** Teams start separated, not intermixed.

### FR-MAP-009 — Scale
**Status:** PROPOSED
**Statement:** The arena is approximately {ARENA_SIZE} on its horizontal axes — small
enough that {MAX_PLAYERS_PER_ROOM} players find each other quickly, large enough that
{FRAG_LIMIT_FFA} kills take a few minutes.
**Acceptance:** Crossing the arena at {WALK_SPEED} takes roughly
{ARENA_CROSSING_TIME_TARGET}. Tune by playtesting.

### FR-MAP-010 — No verticality beyond jumping
**Status:** PROPOSED
**Statement:** v1 has no stairs, ramps, ladders, or multi-storey layouts. Height variation
comes only from blocks low enough to jump onto.
**Acceptance:** Keeps the collision system to axis-aligned boxes and a grounded check.
Multi-level geometry is `DEFERRED`.

### FR-MAP-011 — Additional maps
**Status:** DEFERRED
**Statement:** More arenas, and a map selection or voting system.
**Rationale:** Level design is slower than it looks, and one good arena serves the
portfolio goal. The data-driven format (`FR-MAP-002`) already makes adding maps cheap
later.
