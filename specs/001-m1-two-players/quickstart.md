# Quickstart: validating M1

**Feature**: `001-m1-two-players`

How to run M1 and confirm each of its exit criteria. This is a validation guide, not an
implementation guide — the code belongs in [tasks.md](tasks.md).

---

## Prerequisites

```bash
node --version    # must be >= 24 (package.json engines)
npm ci
```

Node 24 is required for two reasons now, not one. The server still imports `shared/` as
TypeScript directly, via native type stripping and `package.json` subpath imports
([000-m0-walking-box/research.md § R2](../000-m0-walking-box/research.md)). From M1 it is also
what supplies the global `WebSocket` **client** the integration tests connect with, so the test
suite needs no dependency of its own ([research.md § R2](research.md)).

---

## Run

M1 is the first milestone with two processes. They are started separately, in two terminals:

```bash
npm run dev:server    # terminal 1 — the authoritative Node process
npm run dev           # terminal 2 — Vite; open the printed URL
```

Then **open the URL a second time, in a second window**. That second window is the milestone.

Vite proxies the WebSocket path to the server, so both pages and both sockets share one origin
and the client has no URL to configure ([research.md § R10](research.md)). If the server is not
running, the page loads and the character does not move — that is the client waiting for
authority, which is `NFR-001` behaving correctly, not a bug.

Controls are M0's: `W`/`A`/`S`/`D` move, mouse looks, `Shift` sprints, `Ctrl` crouches, `Space`
jumps, `Esc` releases the cursor.

---

## Automated gate

```bash
npm run verify    # typecheck + lint + coverage thresholds — the same gate CI runs
```

This must be green before any commit. It covers, without a human in the loop:

| Criterion                                       | Checked by                                            |
| ----------------------------------------------- | ----------------------------------------------------- |
| `M1-2` — `step()` unchanged                     | `git diff main -- shared/sim/step.ts` returns nothing |
| `M1-3` — prediction and authority agree exactly | the cross-runtime determinism test                    |
| `M1-5` — a correction converges, no teleport    | the reconciliation tests                              |
| `M1-6` — no ghost after disconnect              | the room test and the interpolation test              |
| `M1-7` — adversarial input rejected             | the `shared/protocol` rejection tests                 |
| `M1-8` — flooding is throttled                  | the rate-limit test                                   |
| `M1-9` — no message can assert an outcome       | the protocol type test                                |
| `M1-10` — the tick is constant                  | the loop test, over an injected clock                 |
| `M1-11` — everyone is in every snapshot         | the room test                                         |
| `M1-12` — a room's exception is contained       | the room isolation test                               |
| `M1-13` — thresholds met                        | coverage thresholds, none relaxed                     |

If `npm run verify` passes but a criterion below fails, the test that should have caught it is
missing. Add it rather than accepting the manual check.

---

## Manual checks

Four criteria need eyes and two browsers.

### `M1-1` — the demo criterion

Two windows, both connected. In window A, walk a circuit of the arena: walk, sprint forward,
crouch, jump onto a block, jump off.

**In window B, that motion must be continuous.** Not a capsule teleporting twenty times a second
between positions — a capsule moving. Watch the feet and the direction changes, which is where
stepping shows first. If it steps, {INTERPOLATION_DELAY} is not being applied or the buffer is
being sampled at the wrong time ([research.md § R6](research.md)).

Then the check that is easy to skip: **stand still in window A**. In window B the capsule must be
completely still. A capsule that shivers while its player is not touching the keyboard is
interpolating against a jittering clock, and no amount of smoothing elsewhere will hide it.

### `M1-4` — prediction is invisible until it is not

Throttle the network in DevTools (Network → add a custom profile with ~200 ms latency), or run
the server with an artificial delay.

In the throttled window, movement must still begin **on the frame the key goes down**. That is
`NFR-006`, and on localhost it is true whether or not prediction exists, which is exactly why
this check has to be done under latency.

Now the same window, watched from the other browser: the throttled player's motion should arrive
late. Local instant, remote late, is what correct looks like. Local late means prediction is not
running; remote instant means the server is not authoritative.

### `M1-5` — reconciliation, the manual half

Walk into a wall at an angle and hold the key. The server stops the player; the client predicted
the same stop from the same collision code, so nothing should visibly happen at all — no
twitching, no sliding back, no camera nudge once per snapshot.

Then force a real disagreement: while walking, kill the server process and restart it, or briefly
throttle to offline and back. The player must converge to wherever the server says they are, over
a few frames, without a teleport.

### `M1-6` — no ghost

With both windows connected, **close window B**. In window A its capsule must disappear
immediately — not freeze in place, not slide to a halt, not fade.

Repeat ten times, opening and closing the second window. Nothing may accumulate: no stray
capsules, no growing memory, and the server must still be ticking at the end.

Also check the other half of `FR-GP-040`: reopen the window. It is a **new** player with a new
id, not a resumed one (`D-009`).

### The `NFR-013` check

With both windows connected, stop the server. Neither page may freeze or throw into a dead canvas
— each must say the connection is gone. M1 owes only a readable message; the designed
"Disconnected" screen is `FR-UI-013`, in M5.

---

## Definition of done

All fourteen criteria in [spec.md § Success Criteria](spec.md#success-criteria) hold, `npm run
verify` is green with no threshold relaxed, and `git diff main -- shared/sim/step.ts` is empty.

The two open questions in [spec.md](spec.md#open-questions-raised-by-this-milestone) — `OQ-A`, the
client input rate, and `OQ-B`, the WebSocket transport — are answered by the project owner and
recorded, either by amending `06-network-protocol.md` or by ratifying what shipped.

Then `main` is tagged `v0.2.0` and M2 may begin — not before
([CONTRIBUTING.md](../../CONTRIBUTING.md), Constitution Principle V).
