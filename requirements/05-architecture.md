# 05 — Architecture

## Stack

| Layer | Choice | Constraint |
|-------|--------|------------|
| Server runtime | Node.js (LTS) | Must be a **long-lived stateful process**. Serverless platforms are incompatible — see `NFR-002`. |
| Transport | WebSocket | One connection per client. No HTTP polling fallback. |
| Client renderer | Three.js | WebGL2. |
| Language | TypeScript | Strongly recommended — the shared simulation between client and server is exactly where types pay for themselves. See `NFR-004`. |
| Build | A bundler (Vite recommended) | Must support a shared source directory imported by both client and server. |
| Persistence | `localStorage` only | No database, no ORM, no file-backed state. |

---

## Non-functional requirements

### NFR-001 — Server-authoritative simulation
**Status:** REQUIRED
**Statement:** The server holds the only true world state. It simulates movement,
collision, firing, damage, death, and scoring. Clients send inputs and render the result;
they never assert outcomes.
**Acceptance:** No client message can directly set health, position, score, or kill
status. A message asserting "I killed player X" has no handler because no such message
exists in the protocol.

### NFR-002 — Stateful process
**Status:** REQUIRED
**Statement:** Match state lives in the memory of a single Node process. There is no
horizontal scaling, no shared state store, and no assumption that two rooms could live in
different processes.
**Acceptance:** Restarting the server ends all matches — this is acceptable and expected.
Documented because it rules out Vercel, Netlify Functions, and Lambda deployment targets.

### NFR-003 — Shared simulation code
**Status:** REQUIRED
**Statement:** Movement integration, collision resolution, and the raycast are implemented
**once**, in a shared module imported by both server and client.
**Acceptance:** The client's prediction and the server's authoritative simulation produce
bit-identical results for the same input sequence and starting state, verified by a test.
**Rationale:** Two divergent implementations of movement is the single most common cause
of prediction misfires. This requirement is the mitigation.

### NFR-004 — Deterministic simulation
**Status:** REQUIRED
**Statement:** The shared simulation is a pure function of `(state, input, dt)`. It uses a
fixed timestep, never reads wall-clock time, and never uses unseeded randomness.
**Acceptance:** Running the same inputs from the same state twice produces identical
output. Any randomness (spawn choice) lives outside the simulation step, server-side only.

### NFR-005 — Fixed tick rate
**Status:** PROPOSED
**Statement:** The server simulates at {SERVER_TICK_HZ} and broadcasts state snapshots at
{SNAPSHOT_HZ}.
**Acceptance:** Tick duration is constant and independent of render frame rate or player
count.

### NFR-006 — Client-side prediction
**Status:** REQUIRED
**Statement:** The local player's movement is simulated immediately on input, before the
server confirms it.
**Acceptance:** Local movement responds within one frame at any latency. Satisfies `SC-3`.

### NFR-007 — Server reconciliation
**Status:** REQUIRED
**Statement:** Each input carries a sequence number. Each snapshot reports the last input
the server processed for that client. The client rewinds to the authoritative state and
replays all unacknowledged inputs.
**Acceptance:** Deliberately injecting a server-side position correction results in the
local player converging smoothly, without a visible teleport under normal latency.

### NFR-008 — Remote entity interpolation
**Status:** REQUIRED
**Statement:** Other players are rendered in the past, interpolated between the two most
recent snapshots, with a buffer of {INTERPOLATION_DELAY}.
**Acceptance:** Remote players move smoothly at {SNAPSHOT_HZ}, with no visible stepping or
jitter.

### NFR-009 — No lag compensation
**Status:** REQUIRED
**Statement:** The server evaluates shots against the **current** server-side positions of
targets. It does not rewind the world to the shooter's view of the past.
**Acceptance:** Documented as a known trade-off: high-latency players must lead moving
targets slightly. Server-side rewind is `DEFERRED` — see [09-out-of-scope.md](09-out-of-scope.md).
**Rationale:** Rewind requires a per-player position history buffer and a rewind path
through the raycast. It is the correct next step after v1 is stable, and a strong talking
point, but it is not a prerequisite for a playable, honest game.

### NFR-010 — Input rate limiting
**Status:** REQUIRED
**Statement:** The server rejects clients sending more than {MAX_INPUTS_PER_SECOND} input
messages per second, or messages exceeding {MAX_MESSAGE_BYTES}.
**Acceptance:** A client flooding inputs is throttled or disconnected without degrading
the match for others.

### NFR-011 — All input is validated
**Status:** REQUIRED
**Statement:** Every field of every inbound message is validated for presence, type, and
range before use. Malformed messages are discarded and, on repetition, the connection is
closed.
**Acceptance:** Sending `{"type":"input","dt":999999}` or a NaN aim vector cannot corrupt
the simulation or crash the server.
**Note:** `dt` is never taken from the client — the server uses its own fixed timestep.
The client's reported `dt` is advisory only, or absent from the protocol entirely.

### NFR-012 — Nicknames are never rendered as markup
**Status:** REQUIRED
**Statement:** Player-supplied nicknames are inserted into the DOM as text nodes
(`textContent`), never as HTML, and never into a template string that is assigned to
`innerHTML`.
**Acceptance:** A nickname that passes server validation still cannot execute script in
another player's browser. This holds in the scoreboard, kill feed, nameplates, and results
screen.

### NFR-013 — Graceful client failure
**Status:** REQUIRED
**Statement:** An unhandled client error, WebGL context loss, or socket error shows a
readable message rather than a frozen canvas.
**Acceptance:** A thrown error during the render loop stops the loop and displays a
recoverable error state.

### NFR-014 — Performance target
**Status:** PROPOSED
**Statement:** The client sustains {TARGET_FPS} on mid-range integrated graphics with
{MAX_PLAYERS_PER_ROOM} players visible.
**Acceptance:** Measured with a frame-time counter under a full room. If unmet, reduce
shadow quality, use instanced geometry for level blocks, and cap the pixel ratio.

### NFR-015 — Room isolation
**Status:** REQUIRED
**Statement:** A room's state and simulation loop are fully independent. Broadcasts never
leak across rooms.
**Acceptance:** Two concurrent matches do not interfere, and an exception in one room's
tick does not stop the other's.

---

## Suggested module boundaries

Non-binding, but it satisfies `NFR-003`:

```
/shared      # imported by BOTH client and server — no DOM, no Node APIs
  constants  # the single source of every tuning value (07-constants.md)
  protocol   # message types and validators (06-network-protocol.md)
  sim        # movement, collision, raycast, damage — pure and deterministic
  map        # map schema, loader, validator

/server
  index      # HTTP + WebSocket bootstrap
  room       # one match: players, tick loop, scoring, match lifecycle
  matchmaker # public auto-match, private room codes, room lifecycle
  net        # connection handling, validation, rate limiting

/client
  boot       # start screen, asset loading, entry
  net        # socket, prediction buffer, reconciliation, interpolation
  render     # Three.js scene, camera, models, animation
  input      # keyboard, mouse, pointer lock
  hud        # health, ammo, crosshair, kill feed, scoreboard
  audio      # 2D sfx
  storage    # localStorage wrapper (FR-UI-020..024)

/assets      # models, animations, sounds, map JSON
```

**Hard rule:** `/shared` must import nothing from `/client` or `/server`, and must not
reference `window`, `document`, `THREE`, or any Node built-in. This is what makes
`NFR-003` and `NFR-004` enforceable rather than aspirational.

---

## Assets

### NFR-016 — Free licensed character models
**Status:** REQUIRED
**Statement:** Character models and animations come from free sources (Mixamo, Kenney,
Sketchfab CC0), in glTF/GLB format, with at minimum: idle, walk, run, shoot, reload, and
death animations.
**Acceptance:** Every asset's source and licence is recorded in `assets/CREDITS.md`.
Licence terms are checked before use — a portfolio piece is public.

### NFR-017 — Animation is cosmetic
**Status:** REQUIRED
**Statement:** Animation state is derived on the client from replicated player state
(velocity, grounded, crouching, firing, reloading, dead). Animation is never networked and
never affects the simulation.
**Acceptance:** Removing all animations leaves gameplay and hit detection completely
unchanged. Consistent with `FR-GP-027`.

### NFR-018 — Model swap is a one-line change
**Status:** PROPOSED
**Statement:** The character model is loaded from a single configured path, so replacing
it does not require touching gameplay code.
**Acceptance:** Changing one constant swaps every player's model.
