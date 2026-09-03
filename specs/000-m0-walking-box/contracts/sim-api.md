# Contract: `shared/sim` public API

**Feature**: `000-m0-walking-box` · **Consumers**: `client/` in M0, `client/` **and** `server/`
from M1 onward.

This is the contract `NFR-003` exists to protect. Both runtimes import this module and nothing
else re-implements it.

---

## `step(state, input, map): PlayerState`

```ts
export function step(state: PlayerState, input: PlayerInput, map: GameMap): PlayerState;
```

Advances one player by exactly one fixed tick.

### Guarantees

| #   | Guarantee                                                                                                         | Why                                                                                   | Proven by                                        |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| C1  | **Pure.** Mutates neither `state`, `input`, nor `map`; returns a new `PlayerState`                                | `NFR-004`                                                                             | Deep-freeze all three arguments and call         |
| C2  | **Deterministic.** Same three arguments ⇒ identical output, every time, on every conforming engine                | `NFR-003`                                                                             | Replay test asserting equality tick by tick      |
| C3  | **No time.** Never reads `Date.now`, `performance.now`, or any clock. The timestep is `TICK_DURATION`             | `NFR-004`, `NET-004a`                                                                 | ESLint `no-restricted-properties` on `shared/**` |
| C4  | **No randomness.** Never calls `Math.random`                                                                      | `NFR-004`                                                                             | Same lint rule                                   |
| C5  | **Exact arithmetic only.** Uses `+ - * /`, `Math.sqrt`, and the exact helpers. No transcendental, no `Math.hypot` | [ADR-0001](../../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md) | Same lint rule                                   |
| C6  | **No I/O and no ambient state.** No module-level mutable variable, no cache, no logging                           | `NFR-004`                                                                             | Review + C2                                      |
| C7  | **Total.** Never throws for any `PlayerInput` that passed validation, including adversarial ones                  | `NFR-011`                                                                             | Property test over the validated input domain    |

C7 matters more than it looks: from M1 this function runs inside the server's tick loop with
inputs that arrived over a socket. A throw there is a room-wide outage, and `NFR-015` requires an
exception in one room not to stop another's.

### Explicitly _not_ in this module

- **Camera collision** (`FR-GP-020`) — client-side presentation. It changes what is drawn, never
  what is simulated, and lives in `client/render`.
- **The accumulator loop** — the _caller_ decides when to call `step()`. In M0 that caller is
  `client/boot`; in M1 it is the server's tick loop and the client's prediction buffer. Putting
  the loop inside `step()` would make it impossible to replay unacknowledged inputs during
  reconciliation (`NFR-007`).
- **Interpolation** (`NFR-008`) — rendering concern.
- **Spawn selection** (`FR-GP-038`) — M2, and server-side only, because choosing the spawn that
  maximises distance to the nearest living enemy requires knowing where every player is. The
  simulation sees one player at a time. It is an argmax, not a draw: the randomness in spawning
  belongs to `FR-GP-004`'s team-assignment tie-break, which is M3's and also lives outside the
  simulation step (`NFR-004`).

---

## Supporting exports

```ts
export function validateInput(value: unknown): PlayerInput | null;
export function capsuleHeight(state: PlayerState): number;
export function horizontalSpeed(state: PlayerState): number;
```

`validateInput` is the security boundary (`NFR-011`, `NET-004c`). It is written in M0 even though
nothing untrusted reaches it yet, because M1 must not have to invent it under pressure — and
because writing it now forces `PlayerInput`'s shape to be validatable, which is exactly the
property that makes `NFR-001` hold later.

It rejects, returning `null` rather than throwing:

- any non-finite component in `move` or `dir`;
- `dir` whose length differs from 1 by more than `AIM_EPSILON` — a non-unit vector would
  otherwise buy the sender a speed advantage;
- `dir` whose vertical component falls outside the `CAMERA_PITCH_MIN`..`CAMERA_PITCH_MAX` cone;
- `move` with length greater than 1, or a non-zero Y component;
- missing fields, wrong types, and extra fields.

---

## Call pattern

```ts
// client/boot — M0. The same step() is called by the server from M1.
accumulator += frameElapsedSeconds;
let substeps = 0;
while (accumulator >= TICK_DURATION && substeps < MAX_SUBSTEPS_PER_FRAME) {
  previous = current;
  current = step(current, sampleInput(), map);
  accumulator -= TICK_DURATION;
  substeps += 1;
}
if (substeps === MAX_SUBSTEPS_PER_FRAME) accumulator = 0; // drop the debt, never chase it
render(previous, current, accumulator / TICK_DURATION);
```

The discard on the last line is the guard against the catch-up spiral: after a stall, chasing the
backlog makes each frame slower, which grows the backlog further. Dropping simulated time is
visible as a small skip; chasing it freezes the page.
