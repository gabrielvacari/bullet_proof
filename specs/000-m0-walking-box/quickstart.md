# Quickstart: validating M0

**Feature**: `000-m0-walking-box`

How to run M0 and confirm each of its exit criteria. This is a validation guide, not an
implementation guide — the code belongs in `tasks.md`.

---

## Prerequisites

```bash
node --version    # must be >= 24 (package.json engines)
npm ci
```

Node 24 is required, not merely recommended: the server imports `shared/` as TypeScript directly,
via native type stripping and `package.json` subpath imports. See
[research.md § R2](research.md).

---

## Run

```bash
npm run dev       # Vite dev server; open the printed URL
```

Click the canvas to acquire pointer lock. `W`/`A`/`S`/`D` move, mouse looks, `Shift` sprints,
`Ctrl` crouches, `Space` jumps, `Esc` releases the cursor.

There is no server to start. M0 is single-player and offline by design — the client calls
`shared/sim` directly, and `server/` exists only as an inert entry point until M1.

---

## Automated gate

```bash
npm run verify    # typecheck + lint + coverage thresholds — the same gate CI runs
```

This must be green before any commit. It covers, without a human in the loop:

| Criterion                                       | Checked by                                       |
| ----------------------------------------------- | ------------------------------------------------ |
| `M0-2` — no movement maths outside `shared/sim` | ESLint boundary rules + the import-boundary test |
| `M0-3` — determinism                            | the replay test                                  |
| `M0-4` — 100% on `shared/sim` and `shared/map`  | coverage thresholds                              |
| `M0-6` — containment                            | the containment test                             |
| `M0-7` — no gameplay literals                   | the literal-scan test                            |
| `M0-9` — `passWithNoTests` removed              | its absence from `vitest.config.ts`              |
| `M0-11` — frame-rate independence               | the fixed-timestep test                          |

If `npm run verify` passes but a criterion below fails, the test that should have caught it is
missing. Add it rather than accepting the manual check.

---

## Manual checks

Five criteria need eyes. Each maps to an acceptance scenario in [spec.md](spec.md).

### `M0-1` — the demo criterion

Walk the arena. Sprint forward and confirm the speed change; strafe while holding `Shift` and
confirm there is **no** speed change (`D-017`). Crouch and confirm the capsule shortens and slows.
Jump, and confirm the arc is symmetric and the landing is clean.

Then: crouch and press `Space`. Nothing should happen (`D-016`). Hold `Shift` while crouched.
Nothing should happen.

### `M0-5` — the map is the single source of geometry

Open `assets/maps/arena-01.json`, move a wall's `pos` by a few metres, save, reload.

**The wall must move in the render _and_ stop the player in its new position.** If only one
changed, `FR-MAP-002` is broken and the M2 hit-registration bug is already latent — fix it now,
not after combat exists.

Then break the file deliberately: set a `size` component to `0`, or a `pos` to `null`. Startup
must fail with a message naming the block's `id` and the rule it broke, not a blank canvas.

### `M0-8` — pointer lock lifecycle

Click to lock. Press `Esc`. The overlay must appear and the character must stop responding.
Click again to resume.

Now the case that is easy to get wrong: while unlocked, move the mouse a long way and wiggle the
movement keys. On resume, the camera must **not** snap, and the character must not lurch. Input
accumulated while unlocked is discarded, not queued.

Also alt-tab away while holding `W` and come back. The character must not still be walking.

### `M0-10` — camera collision

Back the character into a wall, then into an inside corner, then under the low overhang. The
camera must pull in toward the character. At no point may it show the inside of geometry, end up
behind a wall, or clip through the floor.

### `M0-11` — frame-rate independence (manual half)

Throttle the frame rate in DevTools (or cap the display to 30 Hz) and repeat a fixed action:
jump from a marked spot and note where you land. The landing point must be identical at 30, 60,
and 144 fps. If jump height changes with frame rate, the accumulator is wrong — see
[research.md § R3](research.md).

---

## Definition of done

All eleven criteria in [spec.md § Success Criteria](spec.md#success-criteria) hold, `npm run
verify` is green, and `passWithNoTests` is gone from `vitest.config.ts`
([Q-008](../../requirements/11-open-questions.md) closed).

Then `main` is tagged `v0.1.0` and M1 may begin — not before
([CONTRIBUTING.md](../../CONTRIBUTING.md), Constitution Principle V).
