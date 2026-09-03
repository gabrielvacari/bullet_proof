# Contract: the netcode surfaces

**Feature**: `001-m1-two-players` · **Consumers**: `server/index.ts` and `client/boot/main.ts`.

Three modules do the work `NFR-005`–`NFR-008` describe. Each is written so that the rule lives in
a function that takes its world as an argument, and the part that cannot be tested holds no rule
— which is how `server/**` and `client/net/**` reach 90% without relaxing anything
([research.md § R11](../research.md#r11--how-server-and-clientnet-reach-90--resolved)).

---

## `server/room` — authority

```ts
export function createRoom(id: string, map: GameMap): Room;

export interface Room {
  join(conn: Connection, msg: JoinMessage): JoinOutcome;
  leave(playerId: string): void;
  enqueue(playerId: string, input: InputMessage): void;
  tick(): void;
  readonly playerCount: number;
}
```

### Guarantees

| #   | Guarantee                                                                                                                                                      | Why                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | **`tick()` advances every player by exactly one `step()`**, whatever arrived since the last tick                                                               | `NET-004a`, `NFR-005`     |
| R2  | **`tick()` is the only thing that advances the simulation.** No message handler moves a player                                                                 | `NFR-001`                 |
| R3  | **`enqueue` caps the queue at {MAX_QUEUED_INPUTS}**, dropping the oldest                                                                                       | `NET-004a`                |
| R4  | **An empty queue yields a neutral input**, retaining only the last validated `dir` — never a repeat of the last input                                          | `NFR-001`, R1 in research |
| R5  | **`join` refuses the {MAX_PLAYERS_PER_ROOM}+1-th player** with `ROOM_FULL`, and does not add them to the simulation                                            | `FR-GP-013`               |
| R6  | **`leave` removes the player and everything about them within the same tick.** No ghost body, no orphaned queue                                                | `FR-GP-040`               |
| R7  | **`tick()` never throws out of the room.** An exception inside one player's step is caught, that player is removed with `INTERNAL`, and the room keeps ticking | `NFR-015`                 |
| R8  | **No global state.** Two rooms in one process cannot observe each other                                                                                        | `NFR-015`                 |
| R9  | **Snapshots are serialised per recipient**, because `ack` is per client                                                                                        | `NET-009`                 |
| R10 | **Every living player is in every snapshot**, regardless of line of sight                                                                                      | `NET-009a`, `FR-GP-049`   |

R7 is the one that is easy to skip because M1 has one room. It is written now because the shape
of the code — not a promise about it — is what `NFR-015` asks for, and adding a `try` around a
loop later means auditing everything the loop touched.

R2 is worth stating as a guarantee even though nothing currently violates it. The tempting
optimisation, once someone notices a client's input arriving mid-tick, is to apply it
immediately. That is send rate becoming movement speed.

---

## `server/room/loop.ts` — the fixed tick

```ts
export function createLoop(onTick: () => void, deps: LoopDeps): Loop;

export interface LoopDeps {
  readonly now: () => number; // injected clock
  readonly schedule: (fn: () => void, ms: number) => unknown; // injected timer
}
```

### Guarantees

| #   | Guarantee                                                                                                                                                         | Why                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| L1  | **`onTick` is called once per {TICK_DURATION_MS} of real time**, on average, with drift corrected against a real clock rather than accumulated from `setInterval` | `NFR-005`                                           |
| L2  | **The interval is independent of player count and of every client's frame rate**                                                                                  | `NFR-005`                                           |
| L3  | **A stall does not queue unbounded catch-up ticks.** Surplus is capped and the excess dropped                                                                     | The same reasoning as M0's `MAX_SUBSTEPS_PER_FRAME` |
| L4  | **Clock and scheduler are injected**, so drift is asserted over simulated time in microseconds                                                                    | `NFR-005` is otherwise untestable in CI             |

L3 mirrors `client/boot/loop.ts` exactly, and for the same reason: after a stall, chasing the
backlog makes each tick slower, which grows the backlog. The server's version is more dangerous
than the client's, because the client only freezes one page.

---

## `client/net/prediction.ts` — `NFR-006`, `NFR-007`

```ts
export function predict(
  state: PlayerState,
  input: PlayerInput,
  map: GameMap,
): PlayerState;

export function reconcile(
  pending: readonly PendingInput[],
  authoritative: PlayerState,
  ack: number,
  map: GameMap,
): Reconciliation;

export interface Reconciliation {
  readonly state: PlayerState;
  readonly pending: readonly PendingInput[];
  readonly error: Vec3; // render-side only
}
```

### Guarantees

| #   | Guarantee                                                                                           | Why                                   |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| C1  | **`predict` is `step`.** It adds nothing; it exists so the call site reads as prediction            | `NFR-003`                             |
| C2  | **`reconcile` drops every pending input with `seq <= ack`**, then replays the rest in order         | `NFR-007`                             |
| C3  | **The returned `state` is the server's, replayed** — never blended with the client's                | `NFR-001`                             |
| C4  | **When client and server saw the same inputs, `error` is exactly zero**, with no tolerance involved | `NFR-003`                             |
| C5  | **`error` is render-only** and is never an input to a later `predict`                               | `NFR-007`, `NFR-001`                  |
| C6  | **Pure.** No socket, no clock, no `Date.now`                                                        | Testability                           |
| C7  | **The pending buffer is capped at {MAX_PENDING_INPUTS}**, oldest dropped                            | Unbounded growth on a dead connection |

C4 is the criterion worth writing a test for before anything else. If it ever fails, the cause is
never in this file — it is two implementations of movement, and `NFR-003` has already been
broken somewhere upstream.

---

## `client/net/interpolation.ts` — `NFR-008`

```ts
export function push(
  buffer: SnapshotBuffer,
  snapshot: SnapshotMessage,
  receivedAtMs: number,
): SnapshotBuffer;

export function sample(
  buffer: SnapshotBuffer,
  renderTimeMs: number,
): readonly InterpolatedPlayer[];
```

### Guarantees

| #   | Guarantee                                                                                                                         | Why                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| I1  | **`sample` interpolates between the two entries bracketing `renderTimeMs`**, which the caller sets to `now - INTERPOLATION_DELAY` | `NFR-008`                                               |
| I2  | **A snapshot whose `tick` is not newer than the newest held is discarded**                                                        | The world does not rewind                               |
| I3  | **When the buffer runs dry, the newest known state is held** — never extrapolated                                                 | R6 in research; no requirement asks for extrapolation   |
| I4  | **A player absent from the newer of the two entries is not interpolated toward anything.** They left                              | `NET-011`, `FR-GP-040`                                  |
| I5  | **A player seen for the first time is rendered at their first known state**, not interpolated from the origin                     | Otherwise every joining player slides in from `[0,0,0]` |
| I6  | **The buffer holds at most {SNAPSHOT_BUFFER_SIZE} entries**                                                                       | Bounded memory                                          |
| I7  | **Pure.** `renderTimeMs` is a parameter; nothing here reads a clock                                                               | Testability                                             |

I4 and I5 are the two that produce visible bugs and no test failures: forget I4 and a player who
leaves glides gently to a halt instead of disappearing, which is exactly the ghost `FR-GP-040`
forbids; forget I5 and everyone who joins arrives by sliding across the arena from the origin.

---

## `server/net/transport.ts` — the seam under `OQ-B`

```ts
export interface Transport {
  onConnection(handler: (conn: Connection) => void): void;
  close(): Promise<void>;
}

export interface Connection {
  send(text: string): void;
  close(code?: number): void;
  onMessage(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
}
```

Everything above the socket speaks this interface and knows nothing about frames, masks or
handshakes. `server/net/ws/` implements it on `node:http`, adding no dependency.

If the project owner approves `ws`, a second implementation of this interface replaces the first
and nothing else in the codebase changes — which is the point of naming the seam before writing
either side of it.
