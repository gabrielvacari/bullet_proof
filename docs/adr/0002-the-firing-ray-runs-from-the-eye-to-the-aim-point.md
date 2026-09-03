# ADR-0002 — The firing ray runs from the eye to the aim point

**Status:** Accepted
**Date:** 2026-08-23
**Relates to:** `Q-003`, `FR-GP-024`, `FR-UI-007`, `FR-GP-019`, `FR-GP-020`, `NET-004`, `NET-012`,
`NFR-001`, `NFR-003`

## Context

`CAMERA_OFFSET` puts the camera behind, above and to the right of the character. `FR-UI-007`
requires the crosshair to reflect the ray the **server** casts, and deliberately does not say how
that is achieved. `FR-GP-024` requires the server to cast from the player's eye. Those two are the
same line only under some of the approaches available.

Two facts about the code as it stands at M0 set up the whole decision.

**M0's camera is convergent, not parallel.** `client/render/camera.ts` places the camera at
`pivot + rotate(CAMERA_OFFSET, aim)` where `pivot = pos + [0, EYE_HEIGHT, 0]`, and then calls
`camera.lookAt(pivot)`. Because it re-aims at the pivot every frame, the screen-centre ray passes
exactly through the player's eye. Under that camera the crosshair ray and the eye ray are the same
line beyond the pivot, and this question would be trivial.

**That camera cannot ship a crosshair.** Screen centre is the player's own eye, so the character's
head sits under the crosshair and occludes whatever is being aimed at. That was fine for M0, which
has no crosshair and only had to satisfy `FR-GP-019` and `FR-GP-020`.

So M2 does not merely pick a ray origin. It also has to move to the conventional over-the-shoulder
framing, where the view direction is **parallel** to the aim direction and the character sits off
to one side. **That is the moment the two rays actually diverge** — which is why this is M2's
question and not M0's.

Under a parallel camera the separation does not shrink with distance. The screen-centre ray and
the eye ray are parallel lines a fixed `CAMERA_OFFSET.x` apart — 0.6 m at one metre and at
{WEAPON_RANGE} alike. Six hundred millimetres is wider than a player, so "aim at the head, hit
nothing" would be the default outcome rather than an edge case.

## Options considered

### Option A — cast camera → crosshair for a focus point, then eye → focus point

Two casts. The first finds what the player is looking at; the second is the shot, and it starts at
the eye. Standard, and what most third-person shooters do.

Costs: the server must know where the camera is. Either it reconstructs the camera itself — which
drags `CAMERA_OFFSET` into the authoritative path — or the client sends the focus point, which
adds an inbound field that must be validated and is a small but real trust surface.

### Option B — cast from the eye along `input.dir`

Nothing new is needed: `input.dir` already exists and is already validated (`NET-004c`), and the
eye is `pos + [0, EYE_HEIGHT, 0]`.

Costs: under a parallel camera it misses by 0.6 m at **every** range. It is exact only under M0's
convergent camera, and that camera cannot carry a crosshair.

### Option C — offset the crosshair on screen to match the eye ray

Costs: the eye ray's projection is not a fixed screen position. It depends on the target's
distance, converging on screen centre only at infinity. A truthful version therefore needs the same
camera cast Option A needs, and then draws the crosshair somewhere the player is not looking.
Strictly more work than A for a worse result.

## Decision

**Option A, with the server reconstructing the camera** rather than the client sending a focus
point.

- `NET-004` stays exactly as [ADR-0001](0001-aim-enters-the-simulation-as-a-direction-vector.md)
  left it. No new inbound field means no new trust surface and no new validator; `input.dir` still
  fully determines the shot.
- The nominal camera position is a pure function of `(pos, crouching, dir)` and `CAMERA_OFFSET`, so
  it is computed with exact arithmetic in `shared/` and stays inside `NFR-003`'s bit-identity
  guarantee.
- **Camera collision (`FR-GP-020`) is excluded from the aim cast.** When the camera pulls in toward
  the player its position changes, and an aim cast using the pulled-in camera would make the aim
  point jump the instant a player backed into a wall. The aim cast uses the _nominal_ offset;
  collision stays what it has always been — a client-side rendering concern that never feeds the
  simulation.

`FR-GP-024`'s statement is amended in the same change to say that "aim direction" means the
direction from the eye to the aim point, not the camera's forward direction. That was a wording
ambiguity, not a design conflict: under this decision the ray still starts at the eye and still
travels along where the player is aiming.

## Consequences

**Easier.** The case that makes this worth its cost now works: a player behind low cover whose
camera sees over the top. The camera cast finds the target, the eye cast is stopped by the cover,
and the shot correctly hits the cover. Option B cannot express that at all. `NET-012` already
carries `from` and `to` — a segment, not a direction — so the tracer the protocol describes is
exactly the segment this produces.

**Harder.** Every shot costs two raycasts instead of one, and the aim cast must run further than
{WEAPON_RANGE} because it starts behind the eye — hence the derived `AIM_CAST_RANGE`. More
significantly, `CAMERA_OFFSET` is now a **gameplay** constant rather than a presentation one:
changing it moves where shots land. It must stay in `shared/constants` and be sent at join time
with the rest of the authoritative config (`NET-008a`).

**What we can no longer do cheaply.** The camera framing is now load-bearing. Any future change to
how the camera sits — a shoulder swap, a zoom, a different offset while crouched — changes hit
behaviour and is no longer a pure rendering tweak. It becomes a gameplay change requiring its own
tests. A shoulder-swap feature, which is otherwise a small piece of polish, would need the aim cast
to follow it and would need the server to know which shoulder is active, which means a new
replicated field.

This ADR does not revisit [ADR-0001](0001-aim-enters-the-simulation-as-a-direction-vector.md).
That one settled _how aim is represented_ — a unit direction vector, no angles in the simulation.
This one settles _where the firing ray originates_. Both constraints hold together: the camera
reconstruction uses `input.dir` and exact arithmetic only.
