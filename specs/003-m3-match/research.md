# Phase 0 Research: M3 — An actual match

**Feature**: `003-m3-match` · **Date**: 2026-08-22

Decisions taken to resolve unknowns in the Technical Context, with what else was considered and
why it lost.

**One item is deliberately unresolved.** [R6](#r6--q-006-what-happens-to-an-idle-player-in-the-pointer-lock-released-state--unresolved-blocking)
is [`Q-006`](../../requirements/11-open-questions.md), which blocks M3. It carries a
recommendation and its cost, and nothing more: Constitution Principle I requires stopping and
asking, and the answer is a product decision that belongs to the project owner. Everything else
here is settled.

---

## R1 — How does one process run many rooms?

**Question:** M1 ships "one hardcoded room". M3 creates rooms on demand. `NFR-002` keeps every one
of them in a single process's memory and `NFR-015` requires that **an exception in one room's tick
does not stop another's**. What actually drives the ticks?

### Options

| #     | Approach                                                                                                                    | Cost                                                                                                      | Consequence                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **One timer per room.** Each room owns a `setInterval` at {SERVER_TICK_HZ}, started on creation and cleared on destruction. | Least code. Isolation looks free — a throw in one callback does not touch another's.                      | Timer cleanup becomes correctness: one missed `clearInterval` is a room that ticks forever with nobody in it, which is exactly what `FR-GP-046` exists to prevent. Hard to test without fake timers.    |
| **B** | **One scheduler ticking every room**, each room's tick wrapped in its own `try`/`catch`, in a fixed iteration order.        | One timer, one place that owns time. Requires the wrapper to be written deliberately rather than implied. | `NFR-015` becomes an explicit, testable line of code instead of an emergent property of the event loop. Destroying a room is removing it from a collection. Tests drive ticks by calling the scheduler. |

### Decision — B

The deciding argument is testability of `NFR-015`. Under A, "an exception in one room does not stop
another's tick" is true because of how the event loop happens to work, and there is nothing to
point at in review or in a test. Under B it is a `try`/`catch` with a test that puts a throwing
room next to a healthy one and asserts the healthy one advanced — which is `M3-11`.

Second argument: **the room must not own its clock**, for the same reason `step()` does not own the
accumulator loop ([M0's sim contract](../000-m0-walking-box/contracts/sim-api.md)). A room exposes
`tick()` and the caller decides when to call it. In production the caller is the scheduler; in
tests it is a loop that advances 14 400 ticks in a few milliseconds with no fake timers, which is
what makes `M3-2` (a match ending on {MATCH_DURATION}) a normal unit test rather than an
eight-minute one.

**Policy on a caught exception:** log it, then **destroy the room**, closing its sockets with
`error` code `INTERNAL` (`NET-020`). A tick that threw part-way leaves the room's state
unknown, and under `NFR-001` the server's state is the only truth there is — continuing to tick a
room whose invariants may be broken serves nobody, and it would produce exactly the ghost-player
class of bug that `D-009` was taken to eliminate. Rejected alternative: catch and continue, with a
consecutive-failure counter. It needs a new constant, it keeps a possibly corrupt match alive, and
"how many times may a room throw before we give up" is not a question any requirement asks.

**Dependency on M1.** The tick loop itself, the socket handling, and per-connection rate limiting
are `NFR-005`, `NFR-010` and `NFR-011`, all owned by M1. M3 generalises one room into a registry of
rooms; it does not re-specify how a tick is driven.

---

## R2 — Which room does auto-match pick?

**Question:** `FR-GP-010` says Play joins "a public room of the selected mode that has space; if
none exists, the server creates one". When several qualify, which one?

**Decision: the qualifying room with the _most_ players.** Candidates are filtered to: public
(`FR-GP-011` bars private rooms), matching mode (`FR-GP-002` — the server never reassigns a mode),
and holding fewer than {MAX_PLAYERS_PER_ROOM} (`FR-GP-013`). Among those, pick the fullest.

Packing players together is the whole point. The failure mode of any other policy shows up with two
players and two rooms: first-with-space by creation order, or a random pick, can leave two people
alone in separate arenas while both believe they clicked the same button. For a portfolio piece
whose worst realistic failure is an empty arena (see
[`Q-004`](../../requirements/11-open-questions.md)), spreading players thin is the one behaviour to
avoid.

**A room in its post-match phase is still a candidate.** `FR-GP-045` requires a player joining
during the results screen to be placed into the next match, so "playable" includes "about to
restart". The joiner sees the results screen for the remainder of {POST_MATCH_DURATION} and then
plays.

**Alternatives rejected:** first-with-space (identical with one room, spreads players with many);
random (same, plus untestable without injecting the random source for a decision that does not need
randomness); emptiest-first (actively maximises the failure mode).

---

## R3 — Room code generation

**Question:** `FR-GP-011` and `FR-GP-012` require a {ROOM_CODE_LENGTH}-character code from an
alphabet excluding `0`, `O`, `1`, `I`, `L`, readable aloud, accepted case-insensitively.

### The alphabet

Uppercase letters and digits, minus the five excluded glyphs:

```
23456789ABCDEFGHJKMNPQRSTUVWXYZ      (8 digits + 23 letters = 31 characters)
```

At {ROOM_CODE_LENGTH} = 4 that is 31⁴ = **923 521** codes. With the tens of concurrent rooms this
project will ever see, collisions are rare and guessing is impractical — which is the right level
of protection, because a room code is a share link, not a credential. Anyone holding it is meant
to get in.

The alphabet is a tuning value and therefore belongs in `shared/constants` (Principle IV), not
inlined in the generator. It is **new** — see [data-model.md § New constants](data-model.md#new-constants).

### Generation

Draw {ROOM_CODE_LENGTH} characters uniformly, check the code is not already in use, and retry on
collision up to a bounded number of attempts; on exhaustion, reject the request with `error`
`INTERNAL` rather than looping. An unbounded retry loop is a hang waiting for the day the code
space is crowded.

**Use `crypto.randomInt` from `node:crypto`, not `Math.random() * 31 | 0`.** Not for secrecy — for
correctness: 31 does not divide the range evenly, so the naive modulo is biased toward the first
characters of the alphabet, and biased codes shrink the effective space. `randomInt` rejects out of
range internally. This lives in `server/` only; `node:crypto` is banned from `shared/` by the
existing ESLint rule, and rightly so.

### Case and confusables

Submitted codes are upper-cased before lookup, and that is the **only** normalisation. Mapping a
typed `O` to `0` would be wrong in both directions: `0` is not in the alphabet either, so there is
nothing to map to. Excluding both members of every confusable pair is what `FR-GP-012` asks for,
and it means a code that cannot be read aloud unambiguously cannot be generated in the first place.

---

## R4 — What drives the match clock?

**Question:** `FR-GP-043` ends a match at {MATCH_DURATION}; `NET-009` puts `timeLeftMs` in every
snapshot; `FR-UI-011` requires the HUD timer to resynchronise from server state rather than
free-run.

**Decision: the room counts ticks. `timeLeftMs` is derived, never stored.**

```
timeLeftMs = MATCH_DURATION − elapsedTicks × TICK_DURATION_MS
```

`shared/constants` already derives `TICK_DURATION_MS` from `SERVER_TICK_HZ`, so the match length in
ticks is derived too and is never written down (Principle IV's "derived values — do not hardcode").
Durations that must be compared against a tick count — {POST_MATCH_DURATION},
{EMPTY_ROOM_GRACE_PERIOD} — are converted the same way, with `Math.ceil`, because a tick rate that
does not divide them evenly must round **up** rather than end a phase early.

Two reasons this beats reading the wall clock at match start:

1. **It is testable without fake timers.** Advancing 14 400 ticks in a loop is a millisecond. A
   wall-clock implementation forces every match-lifecycle test through timer mocking, which is how
   lifecycle tests become the ones nobody writes.
2. **One clock, not two.** The simulation already advances on ticks. A separate wall-clock match
   timer can disagree with it, and then "the match ended at 0:00 but the last shot was at 0:02" is
   a bug with no single source to check.

**Accepted cost:** if the process stalls, the match runs longer than {MATCH_DURATION} in wall-clock
seconds. That is the same drift the simulation already accepts, and no requirement specifies match
length in real seconds.

**Client side.** The HUD renders `match.timeLeftMs` from the most recent snapshot and may
interpolate forward between snapshots using local elapsed time for smoothness — but every snapshot
**overwrites** it. A tab that was backgrounded, throttled, or stalled corrects itself on the next
snapshot, which is `M3-13`. The client never decides that time has run out; the server announces
it with `NET-018`.

---

## R5 — Where does randomness live?

**Question:** `FR-GP-004` breaks a team-size tie randomly, `FR-GP-038` picks a spawn. `NFR-004`
requires the simulation to be free of unseeded randomness and puts any randomness "outside the
simulation step, server-side only".

**Decision: the room takes a random source as a constructor argument**, and every random decision
in M3 goes through it. In production it is backed by `crypto.randomInt`; in tests it is a stub that
returns a scripted sequence.

This is not ceremony. `M3-4` asserts that joining players one at a time never leaves TDM teams
differing by more than 1 — and the interesting case is precisely the tie, where the outcome is
random. Without an injectable source, that test either does not exist or is flaky. The same seam
serves `FR-GP-038`'s spawn choice, which M2 owns and M3 must not duplicate.

`shared/sim` is untouched by any of this. The existing ESLint rule already makes `Math.random`
unreachable there, which is the guarantee `NFR-003`'s bit-identity test rests on.

---

## R6 — `Q-006`: what happens to an idle player in the pointer-lock-released state? ⚠️ UNRESOLVED, BLOCKING

**Question:** [`Q-006`](../../requirements/11-open-questions.md). `FR-GP-021` keeps a player who
presses `Esc` in the match and **killable**. Over a full {MATCH_DURATION} match that leaves a
stationary, non-shooting body in the arena — a free kill that anyone can farm, and the exact thing
a visitor will do by accident when they alt-tab.

**Why it lands in M3 and not earlier.** In M2 the consequence is a wasted target. In M3 it is a
_scored_ wasted target: it distorts the frag limit (`FR-GP-043`), the standings (`FR-GP-044`), and
the results screen (`FR-UI-004`). The demo criterion is "a full match runs start to finish", and
the most likely way that demo looks bad is a match that ends 20–0 because someone was reading a
message.

### Options

| #     | Option                                                                                                       | Cost                                                                                                                                                                                                                                                                                                                                      | Consequence                                                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | **Leave as-is.** `FR-GP-021` stands unchanged.                                                               | Zero.                                                                                                                                                                                                                                                                                                                                     | Free kills stay farmable. A half-dropped connection that never closes its socket looks identical to an idle player, so the arena slowly fills with statues over a long session. Honest, and bad in exactly the two minutes a stranger spends on the demo.                |
| **2** | **Remove a player after a period with no input**, treated exactly as a disconnect.                           | One new constant; an idle counter per player, reset by any valid `input`; one close path. Reuses `FR-GP-040`'s removal, which already specifies clean removal within one tick, and `D-009`, which already says a returning player is a new player with a new ID and no score. The client needs somewhere to land — a start-screen return. | Removes the body rather than accounting around it. Composes with decisions already taken instead of adding a new state. Risk: it is hostile if the timeout is short — someone reading a message for 30 s should not lose their match. The number is tuning.              |
| **3** | **Hide idle players from scoring.** They stay in the arena and killable, but a kill on them awards no point. | A replicated per-player idle flag (the shooter has to be told why no point arrived, or the HUD lies); an exception carved into `FR-GP-041`, which currently has none.                                                                                                                                                                     | The most invasive of the three: it adds synchronised state and a scoring special case, and it does **not** remove the free kill — only its bookkeeping. It also creates a fresh exploit: idle deliberately to deny an enemy points.                                      |
| **4** | **Not in `Q-006`, listed to be rejected on the record:** make an unlocked player untargetable.               | Small.                                                                                                                                                                                                                                                                                                                                    | **Rejected.** It contradicts `FR-GP-021`'s own acceptance criterion ("remains killable"), and it is spawn-protection-shaped — `FR-GP-039`, which is `DEFERRED`. It also hands every player a one-key invulnerability button, which is a worse bug than the one it fixes. |

### Recommendation — Option 2, with a generous timeout

It is the only option that removes the stationary body instead of accounting around it, and it is
the only one that adds no new synchronised state: `FR-GP-040` already specifies removal within one
tick with no ghost body and no ghost hit volume, and `D-009` already says the player comes back as
a new player. The whole change is a counter and a close.

**Its cost, stated plainly:**

- One new constant in [07-constants.md](../../requirements/07-constants.md) (an idle timeout).
  Choosing its value is `Q-002`-flavoured tuning, and changing it later is a constants edit
  (`SC-4`).
- One new client-facing outcome — "you were removed for inactivity" — which needs somewhere to be
  shown. `FR-UI-013`'s disconnect screen is M5, so M3 would need a minimal return-to-start-screen
  path, or the owner accepts that M3 shows the generic disconnected state.
- A behavioural risk that is real: too short a timeout punishes a player who tabbed away for a
  moment, and the complaint is much more annoying than the problem it fixes. Recommend erring
  long — long enough that only a genuinely abandoned session trips it.
- `FR-GP-021` would need a note that it is now bounded, which is a change to `requirements/`.

**This is a product decision and it is not mine to take.** Constitution Principle I requires
stopping and asking. It is recorded as a blocking gate in
[plan.md § Blocking gates](plan.md#blocking-gates); the owner closes it as a `D-###` in
[10-decision-log.md](../../requirements/10-decision-log.md) and deletes it from
[11-open-questions.md](../../requirements/11-open-questions.md), and only then does the
corresponding task become implementable.

**If the owner picks Option 1**, nothing is built and the gate closes with a decision on the
record, which is a perfectly good outcome — `Q-006` itself rates the severity "low".

---

## R7 — Enforcing `NFR-012` mechanically, and testing it without a new dependency

**Question:** M3 is the first milestone that draws one player's text in another player's browser.
`NFR-012` requires nicknames to reach the DOM as text nodes, never as HTML and never through a
template string assigned to `innerHTML`. What enforces that, and what proves it?

### What makes this harder than it looks

`FR-GP-008` restricts nicknames to letters, digits, `_` and `-`. A test that feeds
`<script>alert(1)</script>` through the validator and watches it get rejected therefore proves
**nothing about the renderer** — the string never reaches it. Worse, that test keeps passing
forever, including on the day someone widens the charset to allow spaces or Unicode for a good
reason. The validator and the renderer must each be safe **alone**, and each must be tested alone.
That is the entire content of `M3-9`.

### Decision — three layers, none of which is a human remembering

1. **One chokepoint.** Every surface that draws player-controlled text does so through a single
   helper in `client/hud` that assigns `textContent`. Surfaces build their DOM with
   `document.createElement`, never from HTML strings.
2. **ESLint on `client/**`.** `no-restricted-syntax` banning assignment to `innerHTML` and
   `outerHTML`, and `no-restricted-properties` banning `insertAdjacentHTML`, `document.write`,
   `document.writeln`, and `Range.prototype.createContextualFragment`. This rule lands **in the
   setup phase, before the first surface is written** — the same order M0 used to make its
   `shared/` boundary bite before any code could cross it.
3. **Two independent tests**, described in
   [contracts/nickname-rendering.md](contracts/nickname-rendering.md): one proving the validator
   rejects markup, one proving the renderer is safe with the validator bypassed entirely.

### How the renderer is tested with `environment: 'node'`

`vitest.config.ts` sets no DOM environment. Three ways out:

| #     | Approach                                                                                                                                 | Verdict                                                                                                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A** | Add `jsdom` or `happy-dom` and a DOM environment.                                                                                        | **Requires the project owner's approval** — the Constitution's Technical Constraints make adding any dependency an owner decision. Raised in [plan.md § Implications](plan.md#implications-for-requirements); not assumed here.      |
| **B** | Make the chokepoint pure — return a description of nodes, and let an untested shell apply it.                                            | **Rejected.** It moves the security-relevant line into an untested file. The property under test _is_ "`textContent` was assigned and `innerHTML` was not"; a test that cannot see that assignment proves nothing.                   |
| **C** | **Test against a hand-written fake element** whose `textContent` is a plain property and whose `innerHTML` has a **setter that throws**. | **Chosen.** Zero dependencies. It proves both halves of the property directly: the hostile string lands verbatim in `textContent`, and any code path that reached for `innerHTML` fails the test loudly instead of silently passing. |

C is reinforced by a fourth guard the repository already has a precedent for: `shared/boundary.test.ts`
and `shared/no-literals.test.ts` scan source text. A sibling test scanning `client/**` for
`innerHTML` and friends catches anything expressed in a form the lint rule's syntax matching does
not see — which is `M3-10`.

**A note on coverage.** `client/hud/**` sits at a 50% threshold, and `client/boot/main.ts` and
`client/input/pointer-lock.ts` are excluded outright as thin DOM shells. **The nickname chokepoint
must not live in an excluded file**, and 50% coverage is not a guarantee that these paths ran. The
named tests in the contract are the gate here, not the threshold. Raising the `client/hud/**`
threshold is worth doing and is a CI-config change, so it is listed for the owner in
[plan.md](plan.md#implications-for-requirements) rather than done unilaterally.

**Content-Security-Policy** would be a genuine fourth layer, and it is deliberately _not_ in scope:
v1 is local-only by `D-013`, there is no server configuration to attach a header to yet, and no
requirement asks for it. Worth revisiting with [`Q-001`](../../requirements/11-open-questions.md)
when deployment is decided.

---

## R8 — Does any match logic belong in `shared/`?

**Question:** `NFR-003` puts the simulation in `shared/`. Is the match clock, the scoring, or the
end condition part of it?

**Decision: no. Match state is server-only. `shared/` gains protocol types and validators, nothing
else.**

The symmetry is tempting and wrong. `shared/sim`'s contract is `step(state, input, map)` — one
player, one tick, pure ([M0's contract](../000-m0-walking-box/contracts/sim-api.md)). A match is
not a function of one player's input, there is nothing for a client to predict about a clock, and
`NFR-001` means the client must never be in a position to conclude that the match ended. A shared
`matchStep()` would create a second place a match can end, and the two could disagree.

What **does** go into `shared/protocol`: the message types and validators for `join`, `joined`,
`score`, `matchStart` and `matchEnd`. `NET-002` requires validators to live next to the message
types in `shared/protocol` precisely so client and server cannot drift, and that directory is held
at 100% coverage because it is the security boundary (`NFR-011`).

---

## R9 — How the client knows who anyone is

**Question:** `NET-009b` deliberately keeps nicknames, teams and scores **out** of the snapshot.
The scoreboard, kill feed and results screen all need them. Where do they come from?

**Decision: the client maintains a roster**, built from `joined` (itself), `playerJoined`
(`NET-010`), `playerLeft` (`NET-011`), and `score` (`NET-017`). The snapshot supplies only what
changes every frame.

This is safe because the transport is WebSocket over TCP: messages are ordered and none are
dropped, so a `playerJoined` cannot arrive after the snapshot that first mentions the player. It is
worth naming as a property the design relies on — it is also one more reason the binary/delta
protocol work stays `DEFERRED` (`NET-022`, `NET-023`).

### The disambiguating suffix (`FR-GP-009`)

Two players may share a nickname; identity is the server-assigned player ID. The suffix is a
**presentation** concern computed in the roster: a nickname that is unique within the room renders
bare, and one that collides renders with its player ID appended.

**The suffix must be derived from the player ID, never from join order.** Join order differs
between clients that connected at different moments, so an order-derived suffix would label the
same two players differently in two browsers — and the kill feed would then be ambiguous about who
killed whom, which is the exact failure `FR-GP-009` exists to prevent. The ID is minted by the
server and is identical everywhere.

M3 must not assume the ID's length or shape — `NET-008`'s example is `p_7f3a`, but M1 owns the
format. Rendering the ID whole (`ana (p_9c1b)`) assumes nothing and needs no new constant. If M1's
IDs turn out to be long, a truncation length becomes a constant, not a literal.

**Kill feed lifetime** is a presentation clock and may use wall-clock time: entries expire after
{KILL_FEED_ENTRY_TTL} and at most {KILL_FEED_MAX_ENTRIES} are shown. The feed is **cleared on
`matchStart`** — carrying kills from the previous match into the new one's feed would be confusing
and no requirement asks for it. Recorded here as a design decision, not a requirement.

---

## R10 — Making `server/**` testable to 90%

**Question:** `server/**` sits at a 90% line threshold with an 85% branch threshold, and M3 is the
milestone that fills that directory. What has to be true for the match lifecycle to be testable at
all?

**Decision: three injection seams, all of them already justified above.**

| Seam                  | Why                                                                                          | From |
| --------------------- | -------------------------------------------------------------------------------------------- | ---- |
| **The tick**          | The room exposes `tick()`; the caller owns time. 14 400 ticks in a test loop, no fake timers | R1   |
| **The random source** | Team-size ties and spawn choice become assertable rather than flaky                          | R5   |
| **The socket**        | A fake socket recording sent messages — CONTRIBUTING already names this as the approach      | —    |

With those three, every one of `M3-2`, `M3-3`, `M3-4`, `M3-5`, `M3-8`, `M3-11` and `M3-15` is a
plain unit test with no browser, no timers, and no network. Without them, each becomes a manual
check — and manual checks of a match lifecycle are eight minutes long, which means they get run
once.

The three seams are also the reason this milestone's risk is manageable despite it being the first
one where the server does real work: nothing in the room needs a running process to be exercised.
