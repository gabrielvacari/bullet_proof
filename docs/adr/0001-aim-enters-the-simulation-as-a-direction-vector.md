# ADR-0001 — Aim enters the simulation as a direction vector, not an angle

**Status:** Accepted
**Date:** 2026-08-22
**Relates to:** `NFR-003`, `NFR-004`, `NET-004`, `NET-009`, `FR-GP-015`, `FR-GP-019`, `SC-3`

## Context

`NFR-003` requires the client's predicted simulation and the server's authoritative simulation
to produce **bit-identical** results for the same input sequence, verified by a test. That
requirement is the mitigation for the most common cause of prediction misfires, and every other
netcode decision in this project leans on it.

JavaScript only partly supports it. ECMA-262 splits `Math` into two classes:

- `+ - * /`, `Math.sqrt`, and the exact integer-ish helpers (`abs`, `floor`, `ceil`, `round`,
  `trunc`, `sign`, `min`, `max`, `fround`) are IEEE 754 correctly rounded. Every conforming
  engine returns the same bits.
- `sin`, `cos`, `tan`, `atan2`, `asin`, `acos`, `pow`, `exp`, `log`, `hypot`, `cbrt` are
  **implementation-approximated**. The specification explicitly permits engines to return
  different values, because each picks its own polynomial expansion. Engines have also changed
  their choice between versions — V8's `Math.sin` results shifted when it moved to an fdlibm
  port, so two Chrome releases disagreed with each other.

This project runs the simulation on two different engines _by design_. The server is V8 under
Node. The client is whatever the visitor has: V8 in Chrome, SpiderMonkey in Firefox,
JavaScriptCore in Safari — `01-vision.md` requires all four.

`NET-004` as originally written carries `yaw` and `pitch` in radians. `FR-GP-015` requires
movement relative to the camera's facing direction. Turning an angle into a movement direction
requires `sin` and `cos`. So the simulation, as specified, had to call a function whose result
the language does not pin down.

The error per call is a fraction of an ULP. That is not the problem. The problem is that the
simulation **integrates** it: a direction that differs in the last bits produces a velocity that
differs, which produces a position that differs, tick after tick, growing without bound. It
surfaces as reconciliation corrections on a player who did nothing wrong — visible rubber-banding,
which `SC-3` forbids.

It would also have been invisible in CI. Vitest runs on Node, so a Node-versus-Node determinism
test passes with full marks while Firefox players drift.

The decision is forced now, at M0, because M0 defines `PlayerInput` and writes `step()`. Nothing
is sent over a socket in M0, but the shape of the simulation's input is fixed here and every
later milestone inherits it.

## Options considered

### Option A — aim enters the simulation as a normalised direction vector

`PlayerInput` carries `dir: [x, y, z]`, a unit vector. The client converts yaw/pitch into that
vector once per tick in `client/input`, using its own engine's trig. The server validates the
received vector — finite, and unit length within an epsilon — and uses it verbatim without
recomputing it. `shared/sim` then touches only exactly-specified arithmetic.

Costs: amends `NET-004`, which is unlabelled and therefore `PROPOSED`. The input message grows
by one float. Server-side pitch clamping becomes a vector operation rather than a scalar clamp.

### Option B — ship a deterministic `sin`/`cos` inside `shared/`

A fixed polynomial approximation built only from exact operations, called by both runtimes in
place of `Math`. The wire format is untouched.

Costs: roughly sixty lines of hand-rolled numerics inside the 100%-coverage module that this
portfolio project is most likely to be judged on, plus accuracy tests. And it holds only as long
as every future contributor remembers never to call `Math.cos` in that directory — a rule a
reviewer must enforce forever.

### Option C — accept the drift and absorb it in reconciliation

Do nothing; let server corrections clean up the divergence.

Costs: contradicts `NFR-003`'s own acceptance criterion, which demands a passing bit-identity
test. Rejected outright.

## Decision

**Option A.** Aim reaches `shared/sim` as a normalised direction vector. Angles are a client-side
and presentation concern and do not appear in `PlayerInput`.

Consequently:

- `NET-004` carries `dir: [x, y, z]` instead of `yaw` and `pitch`. The server validates it before
  it reaches game logic, per `NFR-011`.
- `NET-009` snapshots keep `y` (yaw) and `pt` (pitch) — they drive model orientation and camera
  presentation for remote players and never feed the simulation.
- `shared/` may use only `+ - * /`, `Math.sqrt`, and the exact helpers. Every transcendental is
  banned, along with `Math.hypot` (write `Math.sqrt(x*x + z*z)`), `Math.random`, `Date.now`, and
  `performance.now`. An ESLint `no-restricted-properties` rule scoped to `shared/**` enforces
  this rather than a reviewer's memory.

## Consequences

**Easier.** Determinism stops being a discipline and becomes a property of the type: there is no
angle in `PlayerInput` for anyone to convert, so the bug cannot be reintroduced by a contributor
who has not read this document. The M2 hitscan raycast (`FR-GP-024`) also wants a direction
vector, so the conversion is not duplicated later.

**Harder.** Input messages are slightly larger and marginally less readable in a debug log —
`dir: [0, 0, -1]` says less at a glance than `yaw: 3.1416`. Validation is also stricter work:
a scalar angle only needs a range check, whereas a vector needs a finiteness check _and_ a
normalisation check, since a client sending a non-unit vector would otherwise gain a speed
advantage. That validator is now a security boundary and is covered accordingly.

**What we can no longer do cheaply.** Any future simulation feature that genuinely needs an angle
— arc-based spread, a cone-shaped area effect, angular recoil (`FR-GP-033`, currently deferred)
— cannot simply call `Math.atan2` in `shared/`. It must either be reformulated in vector terms or
force Option B after all. That is a real constraint on the deferred recoil-and-spread work, and it
is the price of this decision.

This ADR does **not** settle [Q-003](../../requirements/11-open-questions.md#q-003). Q-003 asks
_where the firing ray originates_ given `CAMERA_OFFSET`; this ADR asks _how aim is represented_.
Q-003 remains open and remains M2's to answer.
