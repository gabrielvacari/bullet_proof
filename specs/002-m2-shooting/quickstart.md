# Quickstart: validating M2

**Feature**: `002-m2-shooting`

How to run M2 and confirm each of its exit criteria. This is a validation guide, not an
implementation guide — the code belongs in [tasks.md](tasks.md).

> **Nothing on this page is runnable yet.** M2 is blocked on two gates: M1's demo criterion, and
> the [`Q-003`](../../requirements/11-open-questions.md#q-003) ADR. See
> [plan.md § Gates](plan.md#gates). This document exists so the finish line is defined before the
> race starts, which is the only way `M2-13` gets checked instead of assumed.

---

## Prerequisites

```bash
node --version    # must be >= 24 (package.json engines)
npm ci
```

M2 needs **two browser windows and one server**. Unlike M0, there is no meaningful single-client
mode: a raycast with nothing to hit proves very little.

---

## Run

```bash
npm run dev       # Vite dev server for the client
# and, in a second shell, whatever script M1 adds to start the WebSocket server
```

There is no server script in `package.json` today — M0's `server/index.ts` is inert. Adding one
is M1's, not M2's; this page assumes it exists by the time M2 runs.

Open the printed URL in two windows, click each canvas to acquire pointer lock, and put them in
sight of each other. Left mouse fires, `R` reloads. Movement is unchanged from M0.

---

## Automated gate

```bash
npm run verify    # typecheck + lint + coverage thresholds — the same gate CI runs
```

Green before any commit. It covers, without a human in the loop:

| Criterion                                         | Checked by                                         |
| ------------------------------------------------- | -------------------------------------------------- |
| `M2-2` — no combat maths outside `shared/sim`     | ESLint boundary rules + the import-boundary test   |
| `M2-3` — no inbound message can assert an outcome | the protocol-shape test over `shared/protocol`     |
| `M2-4` — shots to kill, and mixed regions         | the damage tests                                   |
| `M2-5` — a wall stops the ray                     | the raycast resolution tests                       |
| `M2-6` — hit volumes depend only on the transform | the hit-volume tests                               |
| `M2-7` — excess fire requests discarded           | the fire-rate tests                                |
| `M2-8` — reload rules                             | the reload tests                                   |
| `M2-9` — a dead player is inert and untargetable  | the death tests                                    |
| `M2-10` — spawn selection and its fallback        | the spawn-selection tests                          |
| `M2-11` — no damage falloff, nothing beyond range | the range tests                                    |
| `M2-12` — combat determinism                      | the room replay test                               |
| `M2-15` — coverage thresholds                     | `npm run test:coverage`                            |
| `M2-16` — no combat literals                      | the literal-scan test, extended to the new modules |

If `npm run verify` passes but a criterion below fails, the test that should have caught it is
missing. Add it rather than accepting the manual check.

---

## Manual checks

Four criteria need eyes and two windows.

### `M2-1` — the demo criterion

Two players, in sight of each other. Kill each other repeatedly, in both directions, and let both
respawn several times each. Watch for:

- **Health falls by the right amount for where you aimed.** Torso hits should take five;
  head shots two. If every hit does the same damage, the region test is passing on geometry the
  arena never produces — go and check what the ray is actually intersecting.
- **The victim stops dead.** No sliding, no continuing to fall, no firing back from the corpse.
- **Respawn puts them somewhere else.** If a killed player reappears in front of their killer, the
  spawn set is too small, not the selection rule (see `M2-10` below).
- **Nothing throws.** Watch both consoles and the server's stdout for the whole session. A throw
  in shot resolution is a room-wide outage (`NFR-015`).

### `M2-13` — the crosshair tells the truth

This is the criterion the [`Q-003`](../../requirements/11-open-questions.md#q-003) ADR exists to
make checkable, and the one most likely to be waved through.

Stand **close** — three to four metres — because that is where the camera offset hurts most.
Put the crosshair on the edge of a wall, a doorway jamb, or the corner of a block, and fire.

**The impact must be where the crosshair was.** Then repeat at the far end of the arena. If close
range is wrong and long range is right, the shot is being cast along the camera's line rather than
the player's; if it is wrong at every range by roughly the same amount, the eye ray and the
crosshair ray are parallel and nothing is reconciling them. Either way, `FR-UI-007` is not met —
see [research.md § R1](research.md#r1--where-does-the-firing-ray-originate-q-003--blocking).

Then the case that only two players can show: have the other player stand just behind low cover so
that your camera sees over it but your character's eye does not. **The shot must hit the cover.**
That is the whole reason the two-cast method costs what it costs.

### `M2-14` — the HUD is readable during a fight

Hold fire until the magazine empties. The count must fall smoothly, the reload indicator must
appear and last exactly {RELOAD_TIME}, and firing during it must do nothing. Then die mid-reload:
the respawn must arrive with a full magazine and no leftover progress bar (`FR-GP-032`).

Read the health number while actually fighting rather than while standing still. If it can only be
read by stopping to look at it, `FR-UI-005` is technically met and practically not.

### The `NFR-009` check — confirm the trade-off, do not fix it

Throttle one client's network in DevTools to a few hundred milliseconds of latency and shoot at a
moving target. **You will have to lead it.** That is `NFR-009` working as specified — the server
evaluates shots against current positions and does not rewind. Confirm it behaves that way,
confirm it is survivable, and write nothing to compensate: lag compensation is `DEFERRED`, and a
position history buffer added "just in case" is the architecture
[`09-out-of-scope.md`](../../requirements/09-out-of-scope.md) forbids.

---

## Things that must **not** work

Worth ten minutes, because each is a requirement that only shows up when it is violated:

- **Shooting a teammate.** There are no teams in M2 (`FR-GP-003` is M3's), so there is nothing to
  test — but there must also be no team field quietly doing something.
- **Shooting yourself.** No input sequence may reduce your own health (`FR-GP-042`).
- **Shooting a dead player.** Their volumes are out of the cast until they respawn (`FR-GP-036`).
- **Firing faster than {FIRE_RATE_RPS}** by any client-side means — a modified client, a macro, a
  script sending inputs in a loop. The excess must vanish with no damage and no ammunition spent
  (`FR-GP-029`).
- **Firing during a reload**, and **reloading a full magazine** (`FR-GP-031`).
- **Damage falling off with distance.** Compare a point-blank torso hit with one at the far end of
  the arena; they must be identical (`FR-GP-028`).

---

## Definition of done

All sixteen criteria in [spec.md § Success Criteria](spec.md#success-criteria) hold, `npm run
verify` is green with no threshold relaxed, and the `Q-003` ADR is merged and linked from
[`docs/adr/README.md`](../../docs/adr/README.md)'s index with `Q-003` deleted from
[`11-open-questions.md`](../../requirements/11-open-questions.md) — an open question that has been
answered does not stay open (Constitution, _Document boundaries_).

Then `main` is tagged `v0.3.0` and M3 may begin — not before
([CONTRIBUTING.md](../../CONTRIBUTING.md), Constitution Principle V).
