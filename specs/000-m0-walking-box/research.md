# Phase 0 Research: M0 — Walking box

**Feature**: `000-m0-walking-box` · **Date**: 2026-08-22

Decisions taken to resolve unknowns in the Technical Context, with what else was considered
and why it lost. All resolved; nothing here blocks `/speckit-tasks`.

---

## R1 — Cross-runtime floating-point determinism ✅ RESOLVED

**Question:** `NFR-003` requires the client's prediction and the server's authoritative
simulation to produce **bit-identical** results for the same input sequence. What in JavaScript
can actually guarantee that across two different engines?

### Finding

ECMA-262 divides `Math` into two classes, and only one of them is reproducible:

| Operation                                                                     | Guarantee                                                                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `+` `-` `*` `/` `%`, `Math.sqrt`                                              | IEEE 754 correctly rounded — **exact**, identical on every conforming engine                               |
| `Math.abs` `floor` `ceil` `round` `trunc` `sign` `min` `max` `fround`         | **exact**                                                                                                  |
| `Math.sin` `cos` `tan` `atan2` `asin` `acos` `pow` `exp` `log` `hypot` `cbrt` | **implementation-approximated** — the spec explicitly permits different engines to return different values |

Transcendental functions are approximated by polynomial expansion, and the choice of expansion
is left to the implementer. Different engines choose differently, and _the same_ engine has
changed its choice between versions — V8's `Math.sin` results changed when it moved to an fdlibm
port, so two Chrome versions disagreed. The same JS engine on a different OS or CPU can also
differ.

**This project runs the simulation on two different engines by design.** The server is V8 via
Node; the client is whatever the visitor has — V8 in Chrome, SpiderMonkey in Firefox,
JavaScriptCore in Safari. `01-vision.md` requires all four.

### Why this hits M0 specifically

[`NET-004`](../../requirements/06-network-protocol.md) defines the input message as carrying
`yaw` and `pitch` **in radians**. `FR-GP-015` requires movement relative to the camera's facing
direction. Converting an angle into a direction vector requires `Math.sin` and `Math.cos`.

So as currently specified, the simulation must call `Math.cos(yaw)` — and a Firefox client and
the Node server can disagree in the last bits. That error is then integrated over every tick:
it does not stay small, it accumulates into position drift, which surfaces as reconciliation
corrections that look like rubber-banding and directly threaten `SC-3`.

M0 does not send a single packet, but M0 **defines `PlayerInput` and writes `step()`**. The
choice is made here whether it is written down here or not.

### Options

| #     | Approach                                                                                                                                                                                                                                                                                                                                               | Cost                                                                                                                                                                                                        | Consequence                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Aim enters the simulation as a normalised direction vector.** The client converts yaw/pitch → vector once, in `client/input`, using its own trig. `NET-004` carries `dir: [x,y,z]` instead of `yaw`/`pitch`. The server validates it (finite, unit length within epsilon) and uses it verbatim. `shared/sim` then touches only `+ - * /` and `sqrt`. | Amends `NET-004` (unlabelled, therefore PROPOSED). Message grows by one float. Pitch clamping becomes a vector operation. `NET-009` snapshots keep `y`/`pt` for rendering — they never feed the simulation. | Determinism by construction. Nothing in `shared/` can reintroduce the bug, because there is no angle in the simulation to convert.                                                                                           |
| **B** | **Ship a deterministic `sin`/`cos` in `shared/`.** A fixed polynomial approximation using only exact operations. Both runtimes call it instead of `Math`.                                                                                                                                                                                              | ~60 lines inside the 100%-coverage zone, plus accuracy tests. `NET-004` unchanged.                                                                                                                          | Determinism by construction, wire format untouched. Adds hand-rolled numerics to the module the project is judged on — and every future contributor must remember never to call `Math.cos` there.                            |
| **C** | **Accept the drift and absorb it in reconciliation.**                                                                                                                                                                                                                                                                                                  | Zero work now.                                                                                                                                                                                              | Rejected: it contradicts `NFR-003`'s own acceptance criterion, which demands a passing bit-identity test. It would also be invisible in CI — Vitest runs on Node, so a Node-vs-Node test passes while Firefox players drift. |

### Recommendation — A

It removes the failure mode rather than compensating for it, and it keeps `shared/sim` restricted
to arithmetic that the language specification actually pins down. B works but relies on a
convention a reviewer must enforce forever; A relies on the type system, because there is no
angle in `PlayerInput` to misuse.

A also has a second-order benefit: a direction vector is what the M2 raycast needs anyway.

**Resolved: Option A**, approved by the project owner on 2026-08-22 and recorded as
[ADR-0001](../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md).
`NET-004` was amended in the same change: the input message now carries `dir: [x, y, z]`
instead of `yaw`/`pitch`, with a new `NET-004c` covering validation and pitch clamping.

**Scope guard:** this decision is about _how aim is represented in the simulation's input_. It is
**not** [`Q-003`](../../requirements/11-open-questions.md), which is about _where the firing ray
originates_ given the camera offset. Q-003 stays open and stays M2's problem.

### Rules that follow either way

`shared/` may use only `+ - * /`, `Math.sqrt`, `Math.abs/min/max/floor/ceil/round/sign`.
Banned: every transcendental, plus `Math.hypot` (use `Math.sqrt(x*x + z*z)`), `Math.random`,
`Date.now`, `performance.now`. Enforced by an ESLint `no-restricted-properties` rule on
`shared/**`, not by review.

---

## R2 — How `shared/` is imported by two runtimes

**Question:** The client is bundled by Vite; the server is plain Node. `tsconfig.json` currently
declares `@shared/*` path aliases. Do those work at runtime?

**Finding — no, and this would have failed at M1.** TypeScript `paths` are a _type-checking_
convenience: `tsc` resolves them, but it does not rewrite import specifiers, and this project
runs `tsc --noEmit`. Vite resolves them only if `resolve.alias` is configured to match. Node
resolves them not at all.

Verified locally on Node v24.15.0:

- Node 24 executes `.ts` files directly via type stripping — no build step, no loader.
- Type stripping does **not** rewrite specifiers, so `@shared/x` throws at runtime.
- The `imports` field in `package.json` (`"#shared/*": "./shared/*"`) **does** resolve natively.

Vite also supports the `imports` field, resolving it through `resolveExports`.

**Decision:** subpath imports. `package.json` gains
`"imports": { "#shared/*": "./shared/*", "#server/*": "./server/*", "#client/*": "./client/*" }`,
and `tsconfig.json`'s `paths`/`baseUrl` are replaced by them.

- Import specifiers carry the explicit `.ts` extension (`#shared/sim/step.ts`), which Node's type
  stripping requires. `tsconfig` needs `allowImportingTsExtensions: true` — compatible with the
  existing `noEmit: true`.
- Each mapping is a **single string, never an array**. Vite only consults the first element of an
  array and errors instead of falling through, unlike Node and TypeScript.

**Alternatives rejected:** bundling the server with Vite SSR (adds a build step to a process that
is meant to be plain, and makes stack traces worse for no gain); relative imports (`../../shared/...`
is exactly the friction that causes people to copy code instead of sharing it, which is what
`NFR-003` exists to prevent).

**Bonus:** the `#`-prefix is itself the boundary guard — a specifier is either a bare package or a
declared subpath, so an accidental deep relative import out of `shared/` is visible in review.

---

## R3 — Fixed timestep with render interpolation

**Question:** `NFR-004` requires a fixed timestep; `NFR-014` targets {TARGET_FPS} with displays
running anywhere from 30 to 144 Hz. How do the two loops relate?

**Decision:** accumulator pattern. Real elapsed time is added to an accumulator; while the
accumulator holds at least one tick's worth, `step()` runs and drains one tick. The remainder,
divided by tick duration, is the interpolation alpha used to draw between the previous and current
simulated state.

Two guards, both from the spec's Edge Cases:

- **Substep cap.** At most a small fixed number of `step()` calls per frame. Surplus accumulated
  time is discarded, not simulated. Without this, a stall — a breakpoint, a backgrounded tab,
  a garbage-collection pause — queues hundreds of ticks and the page freezes trying to catch up,
  each slow frame adding more debt than it clears.
- **Render state is separate from simulation state.** The renderer reads `(previous, current,
alpha)` and never writes back. This is what keeps `step()` pure and what makes `M0-11`
  (identical movement at 30/60/144 fps) achievable.

The alpha lerp is also the natural seam for M1: remote-entity interpolation (`NFR-008`) is the
same mechanism with a delay buffer in front of it.

**Alternative rejected:** variable timestep scaled by frame time. Simpler, and fatally
incompatible with `NFR-004` — it makes jump height depend on frame rate, which is the classic
version of this bug.

---

## R4 — Collision representation and resolution

**Question:** How does a capsule player resolve against axis-aligned boxes?

**Decision:** discrete resolution with per-axis separation, three passes per tick.

1. Integrate velocity into a candidate position.
2. Resolve the **Y** axis first, then **X**, then **Z**, each against every overlapping block.
   Resolving Y first is what makes landing on a block and _then_ sliding along a wall behave
   correctly, rather than the player catching on the block's vertical face.
3. Recompute grounded from the Y resolution.

**The collision volume is an axis-aligned box**, half-extent {PLAYER_RADIUS} horizontally
and {PLAYER_HEIGHT} (or {CROUCH_HEIGHT}) tall. Blocks are AABBs from the map
(`FR-MAP-003`), so every test reduces to comparing six numbers — arithmetic only, no
`sqrt`, comfortably inside the R1 rules.

**Corrected during implementation.** This section originally said capsule-versus-AABB via
the closest point on the capsule's segment. That is a rounder shape, but _per-axis
resolution is not well defined for it_: the push-out distance for a circle depends on both
horizontal axes at once, so "resolve X, then Z" stops being a separation and becomes an
approximation whose result depends on which axis went first. An axis-aligned box makes each
axis genuinely independent, which is what the whole three-pass scheme relies on.

The player is still drawn as a capsule, and `FR-GP-027`'s hit volumes in M2 remain separate
primitives. This decision is about the movement volume only. The visible cost is that the
box catches very slightly on outside corners where a circle would slide; against
axis-aligned geometry at {PLAYER_RADIUS} that is not perceptible.

**Alternatives rejected:** swept/continuous collision (correct for fast movers, but at
{SPRINT_SPEED} and {SERVER_TICK_HZ} the player travels ~0.27 m per tick against a
{PLAYER_RADIUS} of 0.4 m — tunnelling is not reachable, so it is unjustified complexity);
a third-party physics engine (non-deterministic across the two runtimes, which breaks
Principle II, and `FR-MAP-010` deliberately keeps geometry to AABBs so that none is needed).

**Deferred:** if M2 ever adds a fast projectile, swept collision returns as a question. Hitscan
(`FR-GP-024`) does not need it.

---

## R5 — Grounded detection

**Question:** What makes a player "grounded"?

**Decision:** a short downward probe from the capsule bottom, of a fixed skin distance, evaluated
**after** Y resolution — not a test of whether vertical velocity is zero.

A velocity test fails in exactly the case that matters: a player standing still on a block has
zero vertical velocity every tick and would also read as grounded in mid-air at the apex of a
jump, where vertical velocity passes through zero. The probe distance is a new constant in
`shared/constants` (`GROUND_PROBE_DISTANCE`), because it is a tuning value and Principle IV
admits no literals.

**Not adopted:** coyote time (a grace period allowing a jump shortly after leaving a ledge). It is
a genuine feel improvement and standard in platformers, but it is not in any requirement, and
Principle I forbids inventing one. Worth raising with the project owner after M0 playtesting,
alongside [`Q-002`](../../requirements/11-open-questions.md).

---

## R6 — Enforcing the `shared/` boundary mechanically

**Question:** Principle II's rules are the ones most likely to erode quietly. What enforces them?

**Decision:** three layers, none of which is a human remembering.

1. **ESLint, scoped to `shared/**`** — `no-restricted-imports` blocking `#client/*`, `#server/*`
   and any relative path escaping the directory; `no-restricted-globals` blocking `window`,
   `document`, `process`, `globalThis`; `no-restricted-properties` blocking the banned `Math`
   members from R1 plus `Date.now` and `performance.now`.
2. **A test** asserting no file under `shared/` imports outside it — catches anything expressed in
   a form the lint rule does not see.
3. **Coverage thresholds already in `vitest.config.ts`** — 100% on `shared/sim`, `shared/map`,
   `shared/protocol`. Untested branches cannot accumulate there.

`three` is a client dependency and must never appear in `shared/`; the lint rule names it
explicitly.

---

## R7 — Removing `passWithNoTests`

[`Q-008`](../../requirements/11-open-questions.md) requires the flag to go with the first real
test. **Decision:** it is removed in the same change that lands the first `shared/sim` test, which
is the earliest implementation task. The flag is currently the only thing letting a suite that
lost all its tests pass CI silently.
