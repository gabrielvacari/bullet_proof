# Phase 0 Research: M2 — Shooting

**Feature**: `002-m2-shooting` · **Date**: 2026-08-22

Decisions taken to resolve unknowns in the Technical Context, with what else was considered and
why it lost.

**One item is deliberately unresolved.** [R1](#r1--where-does-the-firing-ray-originate-q-003--blocking)
is [`Q-003`](../../requirements/11-open-questions.md#q-003), which blocks M2 by name. It is
researched here and **recommended**, not decided: the decision belongs to the project owner and
must land as an ADR before any firing code is written. Everything downstream of it is written to
be honest under the recommendation, and each affected section says what would change under the
alternatives.

---

## R1 — Where does the firing ray originate? (`Q-003`) ⛔ BLOCKING

**Question:** `CAMERA_OFFSET` puts the camera behind, above and to the right of the character.
`FR-UI-007` requires the crosshair to reflect the ray the **server** casts, and deliberately does
not say how. `FR-GP-024` requires the server to cast from the player's eye. Those two are the
same line only under one of the three approaches `Q-003` lists.

### What the code actually does today, and why it matters

`client/render/camera.ts` (M0) places the camera at `pivot + rotate(offset, aim)` where
`pivot = pos + [0, EYE_HEIGHT, 0]`, and then calls **`camera.lookAt(pivot)`**. Two consequences
that any Q-003 analysis has to start from:

1. **M0's camera is convergent, not parallel.** Because it re-aims at the pivot every frame, the
   screen-centre ray passes exactly through the player's eye. Under that camera the crosshair ray
   and the eye ray are the _same line_ beyond the pivot, and `Q-003` would be trivial.
2. **That camera cannot ship a crosshair.** Screen centre is the player's own eye, so the
   character's head sits under the crosshair and occludes whatever is being aimed at. This is
   fine for M0, which has no crosshair and only had to satisfy `FR-GP-019` and `FR-GP-020`.

So M2 does not merely pick a ray origin — it also has to move the camera to the conventional
over-the-shoulder framing where the view direction is **parallel** to the aim direction and the
character sits off to one side. **That is the moment the two rays actually diverge**, and it is
why `Q-003` is M2's and not M0's.

Under a parallel camera the separation does not shrink with distance. The screen-centre ray and
the eye ray are parallel lines a fixed `CAMERA_OFFSET.x` = `0.6 m` apart, at 1 m and at
{WEAPON_RANGE} alike. Six hundred millimetres is wider than a player, so "aim at the head, hit
nothing" is the default outcome, not an edge case.

### The three approaches, as `Q-003` states them

| #     | Approach                                                                                                 | What it costs                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Cast camera → crosshair to find a focus point; then cast **eye → focus point** and use that as the shot. | Two casts per shot. The server must know where the camera is, which drags `CAMERA_OFFSET` — and the question of whether camera collision (`FR-GP-020`) counts — into the authoritative path. Alternatively the client sends the focus point, which adds an inbound field that must be validated (`NFR-011`) and is a small but real trust surface. Standard, and what most third-person shooters do. |
| **2** | Cast from the eye along `input.dir` (the camera's forward direction).                                    | Nothing new: `input.dir` already exists, is already validated (`NET-004c`), and the eye is `pos + [0, EYE_HEIGHT, 0]`. But under a parallel camera it misses by `0.6 m` at **every** range, not just close up. Under M0's convergent camera it is exact — and that camera cannot carry a crosshair.                                                                                                  |
| **3** | Offset the crosshair on screen so it sits where the eye ray projects.                                    | The eye ray's projection is not a fixed screen position: it depends on the target's distance, converging on screen centre only at infinity. So a truthful version needs the same camera cast option 1 needs, and then draws the crosshair somewhere the player is not looking. `Q-003` calls it "accurate, but looks wrong"; it is also not cheaper.                                                 |

### Which way the requirements already lean, and the one place they do not agree

- **`FR-UI-007` leans to (1).** Its acceptance text — "the crosshair must reflect the ray the
  **server** will cast, not merely the screen centre — otherwise close-range shots hit the wrong
  point" — describes exactly the parallax that (2) produces, and rules out the naive reading.
- **`Q-003` itself recommends (1)** and says the choice is very expensive to change afterwards.
- **`NET-012` fits (1) naturally.** It carries `from` and `to` — a segment, not a direction — so
  a tracer drawn from the eye to the impact point is already what the protocol describes.
- **`FR-GP-024` reads like (2).** "The server casts a ray from the player's eye position along
  their aim direction" is literally option 2 unless "their aim direction" is read as _the
  direction from the eye to the aim point_ rather than as `input.dir`.

That last bullet is the only genuine conflict, and it is a wording conflict, not a design one:
under (1) the ray still starts at the eye and still travels along the player's aim direction —
"aim" simply means where the player is aiming rather than where the camera is pointing. It should
be settled explicitly in the ADR, and if the project owner wants it beyond doubt, `FR-GP-024`'s
statement wants one clarifying clause. **That is a `requirements/` edit for a human** — see
[plan.md § Requirements this plan implies](plan.md#requirements-this-plan-implies).

### Recommendation — (1), with the first cast on the server

Option 1, and specifically the variant where the **server reconstructs the camera** rather than
the client sending a focus point:

- It keeps `NET-004` exactly as `ADR-0001` left it. No new inbound field means no new trust
  surface and no new validator; `input.dir` still fully determines the shot.
- The camera position is a pure function of `(pos, crouching, dir)` and `CAMERA_OFFSET`, so it can
  be computed with exact arithmetic in `shared/` and stays inside `NFR-003`'s bit-identity
  guarantee.
- It resolves the one case that makes option 1 worth its cost: a player behind low cover whose
  camera sees over the top. The camera cast finds the target; the eye cast is stopped by the
  cover; the shot correctly hits the cover. Option 2 cannot express that at all.

**Camera collision (`FR-GP-020`) must be excluded from the aim cast.** When the camera pulls in
toward the player, its position changes, and if the aim cast used the pulled-in camera the aim
point would jump the instant a player backed into a wall. The aim cast uses the _nominal_ camera
position from `CAMERA_OFFSET`; collision stays what it has always been, a client-side rendering
concern in `client/render` that never feeds the simulation. This keeps `M0-2`'s boundary intact.

**What changes under the alternatives**, stated so the plan is honest about its exposure:

| If the owner chooses        | What changes                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(1) as above**            | Nothing. The plan and the task list are written for it.                                                                                                                                                                                                                                                                        |
| **(1), client-sends-focus** | `NET-004` gains an aim point; a validator for it (finite, within {WEAPON_RANGE} of the eye) joins `shared/protocol`; `T-` tasks for the camera reconstruction in `shared/` are replaced by validation tasks. The shot resolution itself is unchanged.                                                                          |
| **(2)**                     | The camera must stay convergent — `client/render/camera.ts` keeps its `lookAt(pivot)` — and the crosshair problem moves to framing: something other than screen centre must be found for the character. `hitscan` loses one cast. The plan's camera-reconstruction tasks disappear entirely, and `FR-UI-007` needs re-arguing. |
| **(3)**                     | Same server work as (1) — the cast is still needed — plus a client task to project the eye ray to a screen position each frame and move the crosshair there. Strictly more work than (1) for a worse result.                                                                                                                   |

**Status: OPEN. This must be an ADR before task `T101` (the first firing task) begins.**
See [plan.md § Gates](plan.md#gates).

---

## R2 — Where combat lives, and what happens to `step()`

**Question:** M0's contract is `step(state, input, map) → PlayerState`: one player, one tick, pure.
A raycast needs every _other_ player. Does `step()` grow, or does something new sit beside it?

**Finding — the two halves of firing have opposite requirements.**

- **"Does a shot leave the barrel this tick?"** depends only on the firing player: alive state,
  fire cadence, magazine, reload timer (`FR-GP-029`–`FR-GP-032`, `FR-GP-036`). The client wants
  to predict this so the ammo counter and the reload indicator feel instant (`FR-UI-006`).
- **"What did it hit, and what did that cost?"** depends on every other player's authoritative
  position. The client must **not** predict it (`NFR-001`).

**Decision:** split along that seam.

1. `step()` keeps its signature and its M0 contract, and gains the weapon state machine. Its
   return grows from `PlayerState` to `{ state, shot? }` where `shot` is a `ShotIntent` —
   the origin and direction of a shot that the rules permitted this tick. It carries no target,
   no damage and no victim, because at that point none is known.
2. A new room-level function resolves intents against the world:
   `resolveShot(intent, shooterId, players, map) → ShotResult`. Pure, deterministic, and in
   `shared/sim` for the same reason `step()` is (`NFR-003`) — it is the single definition of what
   a bullet does.

**Alternatives rejected:**

- **Widen `step()` to take the whole room.** It would make the client's prediction buffer replay
  every player's movement to replay its own, which is a much larger reconciliation than
  `NFR-007` needs, and it would break M0's contract C1–C7 and every determinism test written
  against it for no gain.
- **Put the raycast in `server/`.** It is the most tempting shortcut in M2 — the server is the
  only caller — and it is the same mistake `NFR-003` exists to prevent. The client needs the same
  code for nothing today, but M4's tracer effects and any future rewind (`NFR-009`) both start
  from "run the cast the way the server ran it".

### Tick order — fixed, documented, and not incidental

The spec's edge cases ("a shot fired on the tick its shooter dies", "two lethal hits in one
tick") are all really one question: what order does a tick resolve in? The answer must be part of
the contract, not an artefact of iteration order.

1. **Movement phase.** Every player's `step()` runs, in ascending player-id order, against the
   state at the start of the tick. Collects zero or more `ShotIntent`s.
2. **Resolution phase.** Each `ShotIntent` is resolved in the same ascending order, against the
   **post-movement** positions of that moment, and its damage is applied immediately.
3. **Death and respawn phase.** Players at zero health are marked dead and their respawn
   countdown starts; countdowns already running are decremented and expired ones respawn.

Consequences, all deliberate:

- A shot generated in phase 1 still resolves even if its shooter is killed in phase 2 by someone
  earlier in the order. The round had already left the barrel. The alternative — cancelling it —
  is equally deterministic but makes a player's death retroactively erase an action, which is
  worse to explain and worse to watch.
- A player killed by an earlier shot in the same tick is no longer a candidate for later shots in
  that tick, so two shooters cannot both be credited with the same kill. Exactly one `NET-015`
  per death falls out of this rather than needing a guard.
- **Player-id order must be stable and reproducible** for `M2-12`. Ids are minted server-side; a
  sequential generator (not a random one) keeps a replay reproducible.

**Shots are evaluated against current positions (`NFR-009`).** There is no rewind and no position
history buffer. A high-latency player must lead a moving target. This is a documented trade-off,
listed in [`09-out-of-scope.md`](../../requirements/09-out-of-scope.md), and the plan must not
"fix" it — building the history buffer now is the architecture that requirement forbids adding.

---

## R3 — Hit volumes: three static primitives

**Question:** `FR-GP-027` requires a head sphere, a torso capsule and a leg capsule, positioned
from the server-side transform and crouch state, not from a skeleton. What are their dimensions,
and how do they relate to the movement box M0 already has?

**Decision:** implement exactly the three primitives named, sized as **fractions of the current
capsule height** rather than as two absolute sets.

- One set of numbers covers standing and crouching. An absolute standing set plus an absolute
  crouched set is twice the constants and lets the two disagree the first time
  {PLAYER_HEIGHT} changes.
- Scaling with height is also what makes crouch tactical rather than a pure downside
  (`FR-GP-018`): the head drops with the body, so a crouched player behind {CROUCH_HEIGHT} cover
  is genuinely harder to hit in the head.

The primitives are built on demand for one cast and are never stored on `PlayerState`. Storing
them would let them drift from `pos` and `crouching`, which is precisely the class of bug
`FR-GP-027` exists to prevent.

**The movement box and the hit volumes are different shapes, on purpose.** M0 resolves movement
against an axis-aligned box of half-extent {PLAYER_RADIUS} (see
[000's research § R4](../000-m0-walking-box/research.md)), because per-axis resolution is only
well defined for a box. Hit volumes are round because that is what `FR-GP-027` says. The
relationship that matters is that the round volumes must sit **inside** the movement box
horizontally: a hit volume wider than the collision box could be hit through a wall the player is
flush against. Sizing every radius at or below {PLAYER_RADIUS} guarantees it, and a test asserts
it rather than a comment claiming it.

**Arithmetic.** Ray/AABB is the slab method — comparisons and division only. Ray/sphere and
ray/capsule are quadratics needing `Math.sqrt`, which ECMA-262 requires to be correctly rounded
and which `ADR-0001` explicitly permits. No trigonometry, no `Math.hypot`, no `Math.pow`.

**Rejected: three AABBs instead.** Cheaper, simpler, and already proven in `collide.ts` — and
directly contrary to `FR-GP-027`, which names the primitives. Not a decision this plan is allowed
to take.

**Rejected: deriving volumes from the model.** `FR-GP-027` and `NFR-017`. There is no animation
system in M2 at all, which makes the mistake almost impossible to make _today_ — which is exactly
why the volumes must be pinned to the transform now, before M4 arrives with bones and it becomes
tempting.

---

## R4 — Durations in a simulation with no clock

**Question:** Reload, respawn and fire cadence are durations. `NFR-004` bars the simulation from
reading a clock, and M0's ESLint rule blocks `Date.now` and `performance.now` in `shared/**`.
How is "2 seconds" expressed?

**Decision:** every duration is a countdown in **ticks**, stored on `PlayerState`, decremented by
one per `step()`, and derived from the millisecond constants — never written down as a tick count.

| Duration               | Derivation                               | At current values |
| ---------------------- | ---------------------------------------- | ----------------- |
| Reload                 | `ceil(RELOAD_TIME / TICK_DURATION_MS)`   | 60 ticks          |
| Respawn                | `ceil(RESPAWN_DELAY / TICK_DURATION_MS)` | 90 ticks          |
| Interval between shots | `SERVER_TICK_HZ / FIRE_RATE_RPS`         | **3.75 ticks**    |

`Math.ceil` is on `ADR-0001`'s permitted list (exact, correctly rounded on every engine).
Rounding **up** rather than to nearest is the rule so that a changed constant can never shorten a
duration below what the requirement states.

### The fire interval is not a whole number of ticks

{FIRE_RATE_RPS} = 8 against {SERVER_TICK_HZ} = 30 gives 3.75 ticks per shot. This is the one
place in M2 where the obvious implementation is wrong.

| #     | Approach                                                                                                                   | Verdict                                                                                                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Round to 4 ticks per shot.                                                                                                 | **Rejected.** Produces 7.5 shots/s. The constant would say 8 and the game would do 7.5, so changing {FIRE_RATE_RPS} would no longer change the fire rate as stated — a direct failure of `SC-4`, and invisible without a test.                  |
| **B** | Keep a **fractional** cooldown on `PlayerState`: subtract 1 each tick, and on firing add `SERVER_TICK_HZ / FIRE_RATE_RPS`. | **Chosen.** 3.75 and every partial sum of it are exactly representable in binary floating point, so it is bit-identical across engines and safe under `NFR-003`. Individual shots quantise to tick boundaries; the average rate is exactly 8/s. |
| **C** | Change {SERVER_TICK_HZ} or {FIRE_RATE_RPS} so they divide.                                                                 | **Not ours to take.** Both are `PROPOSED` values and both are named in [`Q-002`](../../requirements/11-open-questions.md#q-002). Changing a constant's value is a product decision for the project owner (Constitution, Principle IV).          |

Adding rather than assigning on fire (`cooldown += interval`) is what keeps the _average_ exact:
assigning would discard the fractional remainder every shot and silently degrade to option A.

**`FR-UI-006` follow-on.** The reload indicator must last "exactly {RELOAD_TIME}". At the current
values the tick count is exact, so the two agree. If {RELOAD_TIME} ever becomes a non-multiple of
the tick duration, the HUD must render the **tick-derived** duration, not the raw constant, or the
bar and the weapon will disagree. The client therefore reads the derived tick count, not the
millisecond value.

---

## R5 — Spawn selection needs no randomness

**Question:** `FR-GP-038` picks the spawn maximising distance to the nearest living enemy. M0's
[`contracts/sim-api.md`](../000-m0-walking-box/contracts/sim-api.md) lists spawn selection as
"M2, and server-side only, because it needs randomness that `NFR-004` bars from the simulation."
Is that true?

**Finding — no.** `FR-GP-038` contains no random element. It is an argmax over a fixed list, and
the only thing needing a rule is the tie-break. The randomness in M0's note belongs to
`FR-GP-004` (team assignment, "on a tie it picks randomly"), which is M3's and is a different
requirement.

**Decision:** spawn selection lives in `shared/sim`, is pure and deterministic, and breaks ties by
**lowest spawn `id`, lexicographically**. Ids are unique by map validation rule 6, so the
tie-break is total.

Two consequences worth stating:

- **Distances are compared squared.** `MIN_SPAWN_DISTANCE` becomes a squared threshold derived in
  `shared/constants`, so no `Math.sqrt` is needed at all and the comparison is pure arithmetic.
- **The M0 note is superseded, not wrong-headed.** It was written before `FR-GP-038` was read
  closely. It should be corrected — [`specs/000-m0-walking-box/contracts/sim-api.md`](../000-m0-walking-box/contracts/sim-api.md)
  is another feature's document and **this plan does not edit it**; the correction is listed in
  [plan.md § Requirements this plan implies](plan.md#requirements-this-plan-implies) for a human.

**The blockout arena has two spawn points**, at `[-30, 0, -30]` and `[30, 0, 30]`. That is enough
to demonstrate the demo criterion and not enough to exercise the rule: with two players there is
never a real choice, and the "no valid spawn satisfies {MIN_SPAWN_DISTANCE}" fallback is
unreachable. M2 adds spawns to `assets/maps/arena-01.json` so selection has something to choose
between, and unit-tests the fallback against a synthetic map. {MIN_SPAWN_POINTS} and the designed
arena remain `FR-MAP-007` and `FR-MAP-009`, satisfied at M4.

---

## R6 — Protocol surface and the validation boundary

**Question:** M2 adds five server→client messages and two input bits. What does `NFR-011` actually
have to cover?

**Finding — the inbound surface is two bits, and that is the point.** `NET-012` through `NET-016`
are all outbound; a validator on an outbound message would be theatre. The entire inbound addition
is bits 128 (`fire`) and 256 (`reload`) of `NET-004`'s existing `keys` bitmask, both of which are
_requests_ (`NET-004b`). There is no inbound damage, victim, hit, health or ammunition field
anywhere, and its absence is `NET-007` enforcing `NFR-001` — which `M2-3` verifies as a test, not
as a review comment.

**Decisions:**

- `keys` is validated as a non-negative safe integer and **masked** to the defined bits, so an
  undefined bit can never reach game logic. Rejecting outright would make the protocol brittle to
  a future bit; masking is the behaviour `NET-001` already takes for unknown message types.
- `hitConfirm` (`NET-014`) carries the region and whether the hit was lethal, and deliberately
  **not** the victim's remaining health. That is an information boundary, not an oversight: a
  modified client that learned every victim's health from its own hits would gain real
  information. The type must make it impossible to add by accident, which means the value never
  enters the message builder in the first place.
- `damage` (`NET-013`) carries a `dir` for the directional indicator. That vector is computed
  server-side from the shooter's eye to the victim, flattened and normalised — the victim's client
  is told which way to point an arrow, not where the shooter is standing.
- **`NET-009`'s `am` is per-recipient.** "Ammo — only sent for the receiving player" means the
  snapshot can no longer be serialised once and broadcast verbatim to every socket. That is a
  change to the snapshot builder M1 owns, and M2 depends on it. It is called out here so it is
  found at planning time rather than at wiring time.

---

## R7 — What the client is allowed to predict

**Question:** `NFR-006` predicts the local player. How much of combat is "the local player"?

**Decision:**

| Predicted client-side                          | Server-only                                     |
| ---------------------------------------------- | ----------------------------------------------- |
| Own movement (as in M1)                        | Whether a shot hit anything                     |
| Own magazine count, reload timer, fire cadence | Any damage figure, any health value             |
| The HUD's reload progress bar                  | Death, the respawn countdown, the respawn point |

The client runs the **same** `step()` weapon state machine as the server, so the two agree except
where the server discarded an input — the same condition M1's reconciliation already handles, via
the same `ack`/replay path (`NFR-007`). Snapshot `am` and the `st` reloading/dead bits are the
correction channel.

The visible failure mode is a magazine count that ticks down locally and jumps back when a
rate-limited input is dropped. It is bounded by `MAX_QUEUED_INPUTS`, it is the honest consequence
of prediction, and it is preferable to an ammo counter that lags by a round trip.

**Nothing about a hit is predicted.** No client-side "probably hit" state, no optimistic hit
marker. `NET-014` is the only thing that says a hit happened, and it comes from the server. This
is also why `FR-UI-008`'s hit marker sitting in M4 costs M2 nothing: the message it will listen to
is already correct.
