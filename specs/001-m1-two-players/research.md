# Phase 0 Research: M1 — Two players moving

**Feature**: `001-m1-two-players` · **Date**: 2026-08-22

Decisions taken to resolve unknowns in the Technical Context, with what else was considered and
why it lost. Two of them — R2 and R3 — are the spec's open questions `OQ-B` and `OQ-A`; they are
recorded here with a recommendation and are carried into [plan.md](plan.md) as gates the project
owner can overturn.

---

## R1 — How the server calls `step()` without changing it ✅ RESOLVED

**Question:** M0 left `step(state, input, map)` pure, with no `dt` and no notion of a network.
The server must now advance ten players thirty times a second from inputs that arrive
irregularly. What has to exist around `step()`, and does any of it belong inside it?

**Finding — nothing belongs inside it.** The pieces M1 needs are all caller-side:

| Piece                          | Where it lives                | Why not in `step()`                                                                   |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| The tick clock                 | `server/room/loop.ts`         | `step()` may not read a clock (`NFR-004`, contract C3)                                |
| The per-player input queue     | `server/room/room.ts`         | Queueing is transport policy (`NET-004a`), not simulation                             |
| `seq` and `ack`                | `shared/protocol`, `server/`  | Sequence numbers belong to the transport — [data-model.md](data-model.md) is explicit |
| Replay of unacknowledged input | `client/net/prediction.ts`    | Reconciliation is a caller loop over the same pure function (`NFR-007`)               |
| Interpolation                  | `client/net/interpolation.ts` | Rendering concern (`NFR-008`), listed as out of scope in the M0 sim contract          |

**Decision:** the server owns a `Room` that holds a player table and a tick counter, and a tick
loop that calls `room.tick()` on a fixed schedule. `room.tick()` advances every player by exactly
one `step()` call. `step()` is not edited, and `M1-2` checks that with `git diff`.

**One rule that is easy to get wrong.** When a player's input queue is empty on a tick — a
stalled client, a lost packet — the server must still advance them, or a lagging player floats
in mid-air. It applies a **neutral input**: zero movement, no jump, no sprint, no crouch,
retaining only the last validated `dir` so the player does not spin to face north.

The tempting alternative is to repeat the last input, which keeps movement smooth across a
dropped packet. It is rejected: a player whose connection dies would sprint forward for as long
as their socket takes to time out, and "hold `W`, then pull the network cable" would become a
movement technique. A player who sends nothing does nothing — that is what server authority
means (`NFR-001`).

**Alternatives rejected:**

- **Advance the whole queue each tick.** Frame rate would become movement speed — the same class
  of advantage `NET-004c` refuses to hand a client with a non-unit aim vector.
- **Variable timestep on the server**, scaled by real elapsed time. Directly contradicts
  `NFR-005` and destroys `NFR-003`, since the client cannot know what `dt` the server used.

---

## R2 — WebSocket transport, and the dependency it would need ✅ RESOLVED (owner may overturn)

**Question:** `05-architecture.md` fixes WebSocket as the transport and names no library. The
Constitution requires the project owner's approval for **any** new dependency. `ws` is the
obvious choice and it is not this milestone's to add unattended. What ships instead?

### Finding

The subset of RFC 6455 a server needs in order to talk to a browser is small, and this project's
own constraints make it smaller:

| Feature                          | Needed?                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Opening handshake                | Yes — `Sec-WebSocket-Accept` is `base64(sha1(key + GUID))`, one `node:crypto` call |
| Text frames, client → server     | Yes, always masked by the client                                                   |
| Text frames, server → client     | Yes, never masked                                                                  |
| Close frames                     | Yes, both directions                                                               |
| Ping/pong control frames         | Respond to a ping; we send none                                                    |
| Continuation (fragmented) frames | Handle for completeness; browsers do not fragment messages this small              |
| Payloads above 64 KiB            | No — `MAX_MESSAGE_BYTES` is 1024, so an oversized frame is refused, not decoded    |
| `permessage-deflate`             | No — not negotiated in the response, so the browser does not use it                |
| Binary frames                    | No — JSON in v1 (`NET-022` is DEFERRED)                                            |

**Verified locally on Node v24.15.0** with a throwaway probe: an `http.Server` `upgrade` handler
doing the accept-key hash, plus a 40-line frame codec, completes the handshake with Node's own
global `WebSocket` client and echoes a JSON message back. The same code path is what a browser
speaks.

That probe also settles the test story, which matters more than it first appears: **Node 24 ships
a global `WebSocket` client**, so the integration tests connect to the real server over a real
socket without adding a test dependency either.

### Options

| #     | Approach                                  | Cost                                                                                             | Consequence                                                                                                                                   |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Hand-rolled RFC 6455 over `node:http`** | ~200 lines, of which the codec is pure functions                                                 | No dependency, no approval gate. The pure codec suits the 90% `server/**` threshold better than a wrapper around someone else's socket would. |
| **B** | **Add `ws`**                              | One dependency, and the project owner's approval — which this milestone cannot obtain unattended | Battle-tested, and the standard answer. Also the right answer the moment anything beyond this subset is needed.                               |
| **C** | **Wait for approval before starting M1**  | Blocks the whole milestone on a question about 200 lines                                         | Rejected: the transport is the least interesting part of M1 and the easiest to swap.                                                          |

### Recommendation — A, behind an interface

`server/net/transport.ts` exposes exactly what the room needs — `onMessage`, `send`, `close`,
`onClose` — and `server/net/ws/` implements it. Replacing the implementation with `ws` later
touches that one directory and nothing that knows about the game.

The honest accounting: hand-rolled framing is the kind of code that is fine until it is not, and
the failure mode is a subtly corrupt frame under fragmentation or a large payload. Both are
mitigated by refusing anything over `MAX_MESSAGE_BYTES` before decoding it, and both are
directly tested.

**Carried into [plan.md](plan.md) as a gate.** If the owner approves `ws`, one directory is
deleted and one import changes.

---

## R3 — How often the client sends `input` ✅ RESOLVED (owner should amend the prose)

**Question:** [06-network-protocol.md](../../requirements/06-network-protocol.md)'s Model section
says the client sends **one input per render frame**, capped at {MAX_INPUTS_PER_SECOND}.
`NET-004a` says **each input advances the player by exactly one fixed server tick**, with surplus
queued to {MAX_QUEUED_INPUTS} and the oldest dropped beyond that. Which governs?

**Finding — they cannot both hold, and one of them is a numbered requirement.**

Take the per-frame reading at 60 fps. The client emits 60 inputs per second; the server consumes
{SERVER_TICK_HZ}, which is 30. The queue gains 30 entries a second, reaches {MAX_QUEUED_INPUTS}
in a third of a second, and from then on the server discards one input for every one it applies.
The client predicted all 60; the server applied 30. The predicted position runs ahead by half the
distance travelled, every second, forever — which reconciliation dutifully corrects, every
snapshot. That is rubber-banding, and `SC-3` forbids it. At 144 fps it is three times worse, and
it gets worse the better your monitor is.

The other way out — consume the whole queue each tick — is worse. It makes frame rate into
movement speed: a 144 Hz client simulates 144 ticks per second and outruns a 60 Hz one. That is
exactly the advantage `NET-004c` denies a client who sends a non-unit aim vector, granted through
a different door.

**Decision: one `input` per simulation tick.** The client already runs its prediction on a fixed
{SERVER_TICK_HZ} accumulator — M0 built that in `client/boot/loop.ts` — so it emits one message
per `step()` call, not per rendered frame. Both sides then produce and consume at the same rate.

What that does to the constants, without changing any of them:

- {MAX_INPUTS_PER_SECOND} = 70 keeps its stated role as a cap, now with better than 2× headroom
  over the 30/s a well-behaved client sends. It stops being a target and becomes a limit, which
  is what a limit should be.
- {MAX_QUEUED_INPUTS} = 10 absorbs jitter bursts — a third of a second of them — instead of
  overflowing on every frame.

No numbered requirement changes. The un-numbered Model bullet reads differently, and the owner
should amend it to say "per simulation tick". Recorded as `OQ-A` in [spec.md](spec.md).

**Residual, accepted:** the client's tick clock and the server's drift relative to each other, so
over minutes the queue slowly grows or starves. {MAX_QUEUED_INPUTS} bounds the growth and the
neutral input of R1 covers the starvation. Adaptive send-rate correction is the real fix and no
requirement asks for it.

---

## R4 — Where the `keys` bitmask is decoded ✅ RESOLVED

**Question:** `NET-004` puts movement on the wire as a bitmask (`1=fwd 2=back 4=left 8=right
16=jump 32=sprint 64=crouch`). `PlayerInput` carries a normalised `move` vector. Who converts,
and where does that code live?

**Finding — this is an `NFR-003` question wearing a plumbing costume.** If the client turns held
keys into a `move` vector and the server turns the bitmask into a `move` vector, there are two
implementations of "what does `W`+`A` mean", and they will eventually disagree about a normalised
diagonal in the last bits. That is precisely the divergence `NFR-003` exists to prevent, and it
would be invisible until someone strafes diagonally along a wall.

**Decision:** the bitmask is decoded in **`shared/protocol/keys.ts`**, imported by both runtimes.

- `client/input/keys.ts` maps held `KeyboardEvent.code`s to the bitmask — browser concern, client
  only.
- `shared/protocol/keys.ts` maps the bitmask to a `PlayerInput` — one implementation, 100%
  covered, called by the client's prediction and by the server's tick with the identical integer.
- M0's `movementFrom` moves into that shared function. `client/input/keys.ts` keeps only the
  `code` → bit mapping.

The client therefore predicts from **the bitmask it is about to send**, not from the key set it
sampled. Anything lost in the encoding is lost identically on both sides, which is the property
that makes prediction converge.

`fire` (128) and `reload` (256) are validated as in-range bits and ignored: they are `NET-004b`
requests that M2's weapon code answers.

**Alternative rejected:** send the `move` vector on the wire instead of a bitmask. It would delete
this whole question, and it is not ours to choose — `NET-004` specifies a bitmask, and a bitmask
is also strictly safer, because there is no continuous value for a modified client to inflate.

---

## R5 — Reconciliation, and why it needs no epsilon but does need smoothing ✅ RESOLVED

**Question:** `NFR-007` requires the client to rewind to the authoritative state and replay
unacknowledged inputs, converging "without a visible teleport". Most implementations compare the
predicted and authoritative positions against a tolerance first. What tolerance?

**Finding — none, because `NFR-003` removes the need for one.** A tolerance exists to absorb the
float noise between two implementations of movement. This project has one implementation, running
on arithmetic ECMA-262 pins down exactly (ADR-0001), and JSON round-trips an IEEE 754 double
without loss — **verified**: `JSON.parse(JSON.stringify(x))` returned the identical bits for
every value tried, because `JSON.stringify` emits the shortest round-trippable representation.

So when the client and server saw the same inputs, replay reproduces the predicted state
_exactly_, and the correction is zero without anyone deciding what "close enough" means. When
they differ — a dropped input, a server-side pitch clamp, an input dropped from a full queue —
the difference is real and must be shown.

**Decision:** always rewind and replay; never compare against a tolerance.

```
on snapshot(ack, authoritativeState):
    drop pending inputs with seq <= ack
    state = authoritativeState
    for each remaining pending input, in order:
        state = step(state, input, map)
```

**And separately, smooth the rendering.** `NFR-007`'s acceptance demands convergence without a
visible teleport, so the _simulated_ state adopts the server's value immediately — anything else
would put the client's opinion above the server's, in violation of `NFR-001` — while the
_rendered_ position carries a decaying error offset:

```
error = previouslyPredictedPos - replayedPos     // captured at reconciliation
render at (state.pos + error), with error *= RECONCILE_ERROR_DECAY_PER_TICK each tick
```

The decay is applied **per simulation tick**, not per frame, which makes it frame-rate
independent without needing `Math.pow`. Two new constants, `RECONCILE_ERROR_DECAY_PER_TICK` and
`RECONCILE_ERROR_EPSILON` — see [data-model.md](data-model.md#new-constants).

**Alternatives rejected:**

- **Snap the render too.** Simplest, and fails `NFR-007`'s acceptance criterion outright.
- **Smooth the simulated state.** Every subsequent prediction would then start from a position
  the server never agreed to, and the error would feed back into itself.
- **Replay only when the difference exceeds a tolerance.** Adds a constant nobody can tune, hides
  genuine desync below the threshold, and buys nothing that R5's zero-difference case does not
  already give for free.

---

## R6 — The interpolation timeline ✅ RESOLVED

**Question:** `NFR-008` renders remote players {INTERPOLATION_DELAY} in the past, between the two
most recent snapshots. In the past according to which clock? Snapshots carry a server `tick`, and
the client has only its own.

### Options

| #     | Timeline                                                                                                           | Cost                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Local arrival time.** Buffer each snapshot with the local time it arrived; sample at `now - INTERPOLATION_DELAY` | Network jitter becomes playback jitter, absorbed by the delay buffer                                                                        |
| **B** | **Server tick, with a clock offset estimate.** Convert `tick` to a server timestamp and maintain a smoothed offset | Immune to arrival jitter. Needs a clock-sync estimator, a smoothing constant, and a drift policy — none of them required by any requirement |
| **C** | **Extrapolate** past the newest snapshot when the buffer runs dry                                                  | Hides a stall, at the price of rendering positions the server never reported and correcting them afterwards                                 |

**Decision: A**, with the buffer keyed by arrival time and **no extrapolation**.

{INTERPOLATION_DELAY} is 100 ms, two full snapshot intervals at {SNAPSHOT_HZ}. That is the
jitter budget, and it is what the constant is _for_ — `07-constants.md` describes it as trading
smoothness against staleness. Option A is monotonic by construction, because it samples a clock
that only moves forward, and it introduces no constant that is not already in
`07-constants.md`.

Option B is the better answer at internet latencies and is where this should go if
{INTERPOLATION_DELAY} ever has to shrink. It is not M1's, because M1 has no measurement saying A
is insufficient, and inventing a smoothing constant would breach Principle IV's spirit as well as
Principle I's letter.

Option C is rejected on the same grounds as R1's "repeat the last input": guessing forward
produces motion the server never authorised. When the buffer runs dry, remote players **hold**.
A still capsule reads as a lagging player; a sliding one reads as a bug.

**What the buffer holds:** the last `ceil(INTERPOLATION_DELAY / SNAPSHOT_INTERVAL_MS) + 2`
snapshots — derived from existing constants, not a new one. Older entries are dropped once a
newer pair brackets the sample time.

**Snapshots that arrive out of order** are discarded by comparing `tick` against the newest
already buffered. TCP makes this nearly impossible, and "nearly" is not a reason to leave the
world rewindable.

---

## R7 — Where `y` and `pt` in the snapshot come from ✅ RESOLVED

**Question:** `NET-009` snapshots carry `y` (yaw) and `pt` (pitch) so remote models can be
oriented. `PlayerState` has neither — ADR-0001 deliberately kept orientation out of the
simulation, and `NET-004` now carries `dir`, a vector. So who produces the angles?

**Decision:** the server keeps each player's last validated `dir` and converts it to `y`/`pt`
when serialising a snapshot, in `server/room/`.

This is what ADR-0001 already contemplates in as many words: "`NET-009` snapshots keep `y` (yaw)
and `pt` (pitch) — they drive model orientation and camera presentation for remote players and
never feed the simulation." The conversion needs `Math.atan2` and `Math.asin`, which are banned
inside `shared/**` by the ESLint rule and are perfectly fine in `server/**` — the ban exists
because a divergent value would compound through integration, and nothing here is integrated.
The angle is written to the wire, drawn, and forgotten.

**Alternative rejected:** amend `NET-009` to carry `dir` and let each client derive the angles.
Marginally fewer bytes and one fewer conversion — and it reopens a decision ADR-0001 closed, for
no gain. The wire format is the contract; presentation data is allowed to be presentation-shaped.

**Guard:** the conversion function lives in `server/room/serialise.ts` and nothing imports it back
into the simulation. `shared/boundary.test.ts` already fails any attempt to move it into
`shared/`.

---

## R8 — Clamp or reject an out-of-cone aim vector ✅ RESOLVED

**Question:** `NET-004c` says the server enforces the pitch limits "by clamping the vector's
vertical component server-side". M0's `validateInput` **rejects** a `dir` outside the cone
(`contracts/sim-api.md` in `000-m0-walking-box`). Which is right?

**Finding — `NET-004c` is, and the two are not actually in conflict** once the layers are named.
`requirements/` wins over a spec artefact (Principle I), and the resolution keeps both:

- **`shared/protocol/input.ts`** parses `NET-004`, and **clamps** `dir[1]` into
  {AIM_DIR_Y_MIN}..{AIM_DIR_Y_MAX}, renormalising the horizontal part so the result is still a
  unit vector.
- **`shared/sim/validate.ts`** stays exactly as M0 wrote it: the last line of defence, rejecting
  anything outside the cone. Nothing that has been clamped can fail it, so no M0 test changes.

Clamping rather than rejecting is also better behaviour. A client that momentarily overshoots the
pitch limit gets its aim corrected; rejection would drop the whole input, which drops a tick of
movement, which shows up as a stutter the player did not cause.

**One edge case, and it must be rejected rather than clamped.** A unit vector with `dir[1] = ±1`
points straight up or straight down and has **no horizontal component at all**, so after clamping
there is no heading to renormalise — the yaw is genuinely undefined. Any `dir` whose horizontal
length is zero is rejected. Every legal in-cone vector has horizontal length
`sqrt(1 - y²) ≥ sqrt(1 - 0.932²) ≈ 0.36`, so no honest client can ever hit this path.

---

## R9 — Rate limiting, malformed messages, and the clock ✅ RESOLVED

**Question:** `NFR-010` caps inputs at {MAX_INPUTS_PER_SECOND} and messages at
{MAX_MESSAGE_BYTES}. `NFR-011` says malformed messages are discarded "and, on repetition, the
connection is closed". What are the mechanics, and how is any of it tested without waiting a
real second?

**Decision:** a token bucket per connection, and an injected clock.

- **Bucket.** Capacity {MAX_INPUTS_PER_SECOND}, refilled at {MAX_INPUTS_PER_SECOND} tokens per
  second. One token per `input`. Empty bucket ⇒ the message is dropped and one `error` with code
  `RATE_LIMITED` is sent — one, not one per dropped message, or the throttle becomes an
  amplifier pointed at our own socket.
- **Size.** Checked on the raw frame, **before** parsing (`MAX_MESSAGE_BYTES`). An oversized frame
  is never decoded, which is also what keeps R2's hand-rolled codec small.
- **Malformed.** A counter per connection; at {MAX_MALFORMED_MESSAGES} the socket is closed. A
  well-behaved client never sends one, so the counter is not reset on success — a client dripping
  garbage slowly is still a client sending garbage.
- **Clock.** Every one of these takes `nowMs` as a parameter. `server/net/rate-limit.ts` is then a
  pure function of `(state, nowMs)` and its tests run in microseconds, which is the only reason
  the 90% `server/**` threshold is reachable on this code at all.

Rate limiting deliberately lives on the **connection**, not the room: a flooding client must be
throttled without the room's tick noticing, which is `NFR-010`'s acceptance criterion word for
word.

**Alternative rejected:** close the socket on the first breach. {MAX_INPUTS_PER_SECOND} has only
2× headroom over an honest client's send rate, so a garbage-collection pause that bunches three
frames together could disconnect an innocent player. Throttle first, disconnect on persistence.

---

## R10 — Two browsers, one origin ✅ RESOLVED

**Question:** the client is served by Vite on one port; the server listens on another. Two
browsers must reach the same server, and the client must not carry a hardcoded URL.

**Decision:** Vite proxies the WebSocket path to the Node process, so the page and the socket
share an origin and the client connects to `` `ws://${location.host}${WS_PATH}` `` with no
configuration at all.

- `SERVER_PORT` and `WS_PATH` join `shared/constants`, and **both** `server/index.ts` and
  `vite.config.ts` import them, so the proxy target and the listen port cannot drift.
- **Verified** that `vite.config.ts` resolves `#shared/constants/index.ts`: a probe import
  printed the real value during `vite build`. This is not obvious — the config is transformed
  before it runs — and the fallback would have been a literal port in two files, which `SC-4`
  would have made a defect.
- `npm run dev` must therefore start both processes. A `dev:server` script runs the Node process;
  `dev` runs Vite. Two terminals, documented in [quickstart.md](quickstart.md) — no process
  manager, and no new dependency to run two commands.

**Alternative rejected:** serve the client from the Node process in development. It would collapse
this to one command and lose Vite's HMR, which is most of why the dev server exists.

---

## R11 — How `server/**` and `client/net/**` reach 90% ✅ RESOLVED

**Question:** `vitest.config.ts` sets 90% on both, and neither may be relaxed. Sockets, timers
and `requestAnimationFrame` are the classic excuses for missing a coverage target.

**Decision:** every rule is extracted into a pure function that takes its world as an argument,
leaving genuinely untestable shells thin enough to exclude — the pattern `client/input/aim.ts`
already established in M0, and the same reasoning `vitest.config.ts` records for
`client/boot/main.ts`.

| Module                        | Testable because                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `shared/protocol/*`           | Pure parse/serialise. 100% threshold, no sockets involved                            |
| `server/net/ws/frame.ts`      | Buffer in, frames out. Fuzzed with truncated and oversized input                     |
| `server/net/rate-limit.ts`    | `(state, nowMs)` in, decision out (R9)                                               |
| `server/room/room.ts`         | Constructed with a fake transport; `tick()` called directly, never on a timer        |
| `server/room/loop.ts`         | Scheduler and clock injected; drift asserted over simulated time                     |
| `client/net/prediction.ts`    | Pure over `(pendingInputs, snapshot, map)` — no socket                               |
| `client/net/interpolation.ts` | Pure over `(buffer, renderTimeMs)` — no clock read inside                            |
| `client/net/socket.ts`        | Thin `WebSocket` shell over the above; **excluded**, and only after the logic is out |

Two integration tests run the real thing end to end, over a real socket, using Node's built-in
`WebSocket` client (R2): two clients join, both see each other, one disconnects and vanishes.
They are slow, there are two of them, and they are the only tests that would catch a wiring
mistake every unit test above would happily miss.

**Excluding `client/net/socket.ts` is a rule with a condition**, and the condition is the whole
point: it may hold nothing but `addEventListener`, `JSON.parse` guarded by a shared validator,
and a call into a tested module. The moment a decision appears in it, it comes out of the
exclusion list rather than the decision staying in the file.
