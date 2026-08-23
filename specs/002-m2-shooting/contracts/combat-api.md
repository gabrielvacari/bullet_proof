# Contract: `shared/sim` combat API

**Feature**: `002-m2-shooting` · **Consumers**: `server/` (the only caller that matters in M2) and
`client/` (the weapon state machine, for prediction).

M2 extends the module `NFR-003` exists to protect. Everything below is imported by both runtimes
and re-implemented by neither.

**M0's [`contracts/sim-api.md`](../../000-m0-walking-box/contracts/sim-api.md) guarantees C1–C7
apply unchanged to every function on this page.** They are not restated; they are inherited. In
particular:

- **C1 pure** — no argument is mutated, a new value is returned.
- **C2 deterministic** — same arguments ⇒ identical output on every conforming engine.
- **C3 no time** — no `Date.now`, no `performance.now`, no clock of any kind. Durations are tick
  counts derived from constants ([data-model.md](../data-model.md#new-constants)).
- **C4 no randomness** — no `Math.random`. Spawn selection included
  ([research.md § R5](../research.md#r5--spawn-selection-needs-no-randomness)).
- **C5 exact arithmetic only** — `+ - * /`, `Math.sqrt`, and the exact helpers
  (`abs`, `floor`, `ceil`, `round`, `trunc`, `sign`, `min`, `max`, `fround`). **No
  implementation-approximated `Math` member**: no `sin`, `cos`, `tan`, `atan2`, `asin`, `acos`,
  `pow`, `exp`, `log`, `hypot` or `cbrt`, per
  [ADR-0001](../../../docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md). Ray
  intersection needs `sqrt` and nothing more.
- **C6 no I/O, no ambient state** — no module-level mutable variable, no cache, no logging.
- **C7 total** — never throws for any input that passed validation.

C7 carries more weight in M2 than it did in M0. From here, a throw inside shot resolution is a
throw inside the server's tick loop, and `NFR-015` requires an exception in one room not to stop
another's.

---

## `step(state, input, map)` — extended

```ts
export function step(state: PlayerState, input: PlayerInput, map: GameMap): StepResult;

export interface StepResult {
  readonly state: PlayerState;
  /** Present only on a tick where the weapon rules permitted a shot. */
  readonly shot: ShotIntent | null;
}
```

The signature is unchanged; the return type widens. This is a breaking change to M0's contract and
is called out as one: every existing caller and every existing test reads `.state`.

### Additional guarantees

| #   | Guarantee                                                                                                                                                   | Why                     | Proven by                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------- |
| C8  | **One player's business only.** `step()` never sees another player. It decides whether a shot _left the barrel_, never what it hit                          | `NFR-006`, `NFR-001`    | Signature; no room argument exists      |
| C9  | **A dead player simulates nothing.** With `health <= 0`, input is ignored entirely: no movement, no fire, no reload. Only `respawnTicks` advances           | `FR-GP-036`             | Test over the full input domain         |
| C10 | **The weapon rules are the only gate on `shot`.** Alive, not reloading, magazine above zero, `fireCooldown <= 0`, and `input.fire` — all five, every time   | `FR-GP-029`–`FR-GP-031` | Test per rule, each in isolation        |
| C11 | **Ammunition can only fall by one per emitted `ShotIntent`** and never below zero                                                                           | `FR-GP-030`             | Property test over long input sequences |
| C12 | **The average fire rate is exactly {FIRE_RATE_RPS}.** `fireCooldown` accumulates rather than being assigned, so the fractional remainder is never discarded | `FR-GP-029`, `SC-4`     | Count shots over a fixed tick span      |

### The weapon state machine, in order

Evaluated once per tick, after the movement M0 already does:

1. If dead — decrement `respawnTicks`; if it reaches zero, respawn (full health, full magazine,
   `reloadTicks = 0`, `fireCooldown = 0`) at the point `selectSpawn` chose. Return; nothing else
   runs (`FR-GP-036`, `FR-GP-037`, `FR-GP-032`).
2. Decrement `fireCooldown` by 1 and `reloadTicks` by 1, each floored at zero.
3. If `reloadTicks` just reached zero from a running reload, set `magazine = MAGAZINE_SIZE`.
4. If reloading — no shot, and the fire input neither cancels nor restarts it (`FR-GP-031`).
5. If `input.reload` and `magazine < MAGAZINE_SIZE` — start a reload. A full magazine does
   nothing at all, not a zero-length reload (`FR-GP-031`).
6. If `input.fire` and `magazine === 0` — start a reload (`FR-GP-031`).
7. If `input.fire` and `fireCooldown <= 0` and `magazine > 0` — decrement `magazine`, add
   `TICKS_PER_SHOT` to `fireCooldown`, and emit a `ShotIntent`.

Excess fire requests fall out of rule 7 with no special case: a client sending fire faster than
the tick rate simply meets a cooldown that has not expired, and `M2-7`'s "no damage, no ammunition
consumed" holds by construction rather than by a discard branch (`FR-GP-029`, `NET-004b`).

---

## `resolveShot(intent, shooterId, candidates, map)`

```ts
export function resolveShot(
  intent: ShotIntent,
  shooterId: string,
  candidates: readonly TargetPlayer[],
  map: GameMap,
): ShotResult;

export interface TargetPlayer {
  readonly id: string;
  readonly pos: Vec3;
  readonly crouching: boolean;
  readonly health: number;
}
```

One cast, one answer. The room passes the candidates it considers eligible; the function filters
the shooter and the dead out of them itself, so neither rule can be forgotten at a call site.

`TargetPlayer` is deliberately narrower than `PlayerState`: velocity, ammunition and reload state
cannot influence a hit, so they are not in scope to be accidentally read.

### Guarantees

| #   | Guarantee                                                                                                                              | Why                      | Proven by                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------- |
| C13 | **No ambient target set.** Candidates arrive as an argument; there is no room, registry or module-level list to consult                | C6, `NFR-015`            | Signature + purity test                           |
| C14 | **The shooter is never a candidate**, and neither is any player with `health <= 0`                                                     | `FR-GP-042`, `FR-GP-036` | Test                                              |
| C15 | **Nearest intersection wins, and every tie is broken by a total documented order**                                                     | `FR-GP-025`, `NFR-004`   | Tie tests at exactly equal `t`                    |
| C16 | **Hit volumes are a pure function of `(pos, crouching)`** and of nothing else — no skeleton, mesh, animation, velocity or elapsed time | `FR-GP-027`, `NFR-017`   | Signature; volumes are built inside the cast      |
| C17 | **Damage depends only on region.** Identical at 1 m and at {WEAPON_RANGE}, and zero beyond it                                          | `FR-GP-026`, `FR-GP-028` | Range test at both ends and past the end          |
| C18 | **Perfect accuracy.** The ray follows the aim exactly: no spread, no recoil, no bloom, no per-shot deviation of any kind               | `FR-GP-033`              | Ten identical shots produce ten identical results |
| C19 | **Geometry is read from the passed `GameMap`** — the same one the renderer draws                                                       | `FR-MAP-002`             | Signature                                         |
| C20 | **Evaluated against the positions given, with no history.** There is no rewind parameter, no timestamp, and no buffer to rewind into   | `NFR-009`                | Signature; review                                 |

C20 is a requirement, not a limitation to be worked around. `NFR-009` states the trade-off:
high-latency players must lead moving targets. Server-side rewind is `DEFERRED`, and adding the
history buffer that would enable it is exactly the architecture
[`09-out-of-scope.md`](../../../requirements/09-out-of-scope.md) forbids introducing early.

### Q-003 is the only thing on this page that is not settled

Under the recommended option 1, `resolveShot` performs **two** casts: `cameraEye` along `dir` to
find a focus point, then `eye` toward that point for the shot itself. Under option 2 it performs
one, from `eye` along `dir`, and `intent.cameraEye` is unused.

**Both produce the same `ShotResult` shape, and C13–C20 hold either way.** That is what makes it
safe to write this contract before the ADR lands — and it is also why no `resolveShot` code may be
written until it does. See [plan.md § Gates](../plan.md#gates).

---

## `applyDamage(state, damage)`

```ts
export function applyDamage(state: PlayerState, damage: number): DamageOutcome;

export interface DamageOutcome {
  readonly state: PlayerState;
  /** True when this application took the player from alive to dead. */
  readonly lethal: boolean;
}
```

| #   | Guarantee                                                                                                               | Why                      |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| C21 | **Health clamps at zero.** It never goes negative, so it cannot be driven doubly negative by two hits in one tick       | `FR-GP-034`              |
| C22 | **`lethal` is true at most once per life.** Applying damage to an already-dead player changes nothing and returns false | `FR-GP-036`, `NET-015`   |
| C23 | **Death clears `reloadTicks` and starts `respawnTicks`** at `RESPAWN_TICKS`                                             | `FR-GP-032`, `FR-GP-037` |
| C24 | **Health is never raised here.** No regeneration, no restoration during a life — only respawn refills it                | `FR-GP-035`              |

C22 is what makes "exactly one `NET-015` per death" fall out of the model instead of needing a
guard in the room. Combined with the tick order in
[research.md § R2](../research.md#tick-order--fixed-documented-and-not-incidental) — a player
killed by an earlier shot leaves the candidate set for later shots in the same tick — two
simultaneous lethal hits can never both be credited.

---

## `selectSpawn(spawns, livingEnemies)`

```ts
export function selectSpawn(
  spawns: readonly Spawn[],
  livingEnemies: readonly Vec3[],
): Spawn;
```

| #   | Guarantee                                                                                                                                                              | Why                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| C25 | **Returns the spawn maximising the distance to the nearest living enemy**                                                                                              | `FR-GP-038`            |
| C26 | **Deterministic. Ties break on the lowest spawn `id`, lexicographically** — no randomness anywhere                                                                     | `NFR-004`, `FR-GP-038` |
| C27 | **Compares squared distances**, so no `Math.sqrt` is called and `MIN_SPAWN_DISTANCE_SQ` is the threshold                                                               | C5                     |
| C28 | **Total.** With an empty `livingEnemies` it returns the lowest-`id` spawn; it never returns `null`, because map validation rule 7 guarantees at least one spawn exists | C7                     |

`FR-GP-038`'s acceptance criterion — never within {MIN_SPAWN_DISTANCE} of a living enemy _while
any valid spawn satisfies that_ — follows from C25 rather than needing a separate branch: the
argmax already picks a satisfying spawn whenever one exists, and the farthest otherwise. The
fallback still gets its own test (`M2-10`), because "unreachable in the shipped arena" is not the
same as "correct".

`livingEnemies` is a list of positions rather than of players, so the function cannot read health,
team or ammunition it has no business knowing. In M2 "enemy" means every other living player;
`FR-GP-025`'s team filter is applied by the caller in M3.

---

## What is **not** in this module

- **Message construction.** `NET-012`–`NET-016` are built in `server/`, from a `ShotResult` and a
  `DamageOutcome`. The simulation does not know a network exists — the same rule that kept `seq`
  out of `PlayerInput` in M0.
- **The camera's rendered transform**, including collision (`FR-GP-020`). `cameraEye` is a nominal
  position computed from `CAMERA_OFFSET`; what the player actually sees stays in `client/render`.
- **Kill credit, scoring, kill feed.** `FR-GP-041` and `FR-UI-009` are M3's.
- **Hit markers, damage indicators, tracers, muzzle flash.** `FR-UI-008` is M4's. M2 emits the
  messages; M4 draws them.
- **Any rewind, history or interpolation of past positions.** `NFR-009`.

---

## Call pattern

```ts
// server/room — one tick. Order is fixed and documented: research.md R2.
const intents: Array<{ shooterId: string; intent: ShotIntent }> = [];

for (const id of playerIdsAscending) {
  const { state, shot } = step(players[id], inputFor(id), map);
  players[id] = state;
  if (shot) intents.push({ shooterId: id, intent: shot });
}

for (const { shooterId, intent } of intents) {
  const result = resolveShot(intent, shooterId, targetsOf(players), map);
  broadcastShot(result); // NET-012 — cosmetic, no damage information

  if (result.kind !== 'PLAYER') continue;
  const { state, lethal } = applyDamage(players[result.victimId], result.damage);
  players[result.victimId] = state;

  sendDamage(result.victimId, state.health, shooterId, result.region); // NET-013, victim only
  sendHitConfirm(shooterId, result.region, lethal); // NET-014, shooter only — no health
  if (lethal) broadcastKill(shooterId, result.victimId, result.region); // NET-015
}
```

The two loops are separate on purpose. Resolving each shot as it is generated would make a shot's
outcome depend on how far through the movement phase the tick had got, which is a different answer
for the same inputs depending on iteration order — and `M2-12` would catch it only intermittently,
which is the worst way to catch anything.
