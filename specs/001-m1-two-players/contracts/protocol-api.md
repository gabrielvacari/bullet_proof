# Contract: `shared/protocol` public API

**Feature**: `001-m1-two-players` · **Consumers**: `client/net` and `server/net`, in equal
measure.

`NET-002` requires the validators to live next to the message types "so client and server cannot
drift". This is that module. It is at a **100% coverage threshold** in `vitest.config.ts`, for
the same reason `shared/sim` is: it is the security boundary (`NFR-011`), and an untested branch
in a security boundary is an untested branch in the security boundary.

---

## Parsing — the `NFR-011` boundary

```ts
export function parseClientMessage(raw: unknown): ClientMessage | null;
export function parseServerMessage(raw: unknown): ServerMessage | null;
```

### Guarantees

| #   | Guarantee                                                                                                                          | Why                  | Proven by                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------- |
| P1  | **Total.** Never throws, for any input — including `null`, arrays, cyclic-free garbage, and objects with hostile keys              | `NFR-015`, `NFR-011` | Property test over adversarial values     |
| P2  | **Returns `null`, never a partial object.** A message is valid or it does not exist                                                | `NFR-011`            | Every rejection path tested               |
| P3  | **Every field is checked** for presence, type and range before any game logic can see the result                                   | `NFR-011`, `NET-002` | Per-field rejection tests                 |
| P4  | **Unknown `t` returns `null`** rather than throwing — an unrecognised type is ignored                                              | `NET-001`            | Test                                      |
| P5  | **Extra fields are rejected.** A message carrying a field the protocol does not define is not a message this protocol accepts      | `NFR-011`            | Test, mirroring M0's `validateInput`      |
| P6  | **Pure.** No clock, no randomness, no ambient state                                                                                | `shared/` purity     | ESLint on `shared/**` + the boundary test |
| P7  | **`dir` is clamped, not trusted.** Out-of-cone pitch is clamped and renormalised; a `dir` with no horizontal component is rejected | `NET-004c`           | Test, both branches                       |

P1 matters more than it looks. From M1 these functions run on bytes that arrived over a socket,
inside a process that is also running someone else's match. A throw here is an outage for every
player in the room, and `NFR-015` requires an exception in one room not to stop another's.

### What it rejects

- Anything that is not a non-null, non-array object, or whose `t` is not a known string.
- `join`: a nickname outside {NICKNAME_MIN_LENGTH}..{NICKNAME_MAX_LENGTH} or containing anything
  outside `[A-Za-z0-9_-]` (`FR-GP-008`); a `mode` outside `'FFA' | 'TDM'`.
- `input`: a non-integer or non-positive `seq`; a `keys` outside `0..511` or non-integer; a `dir`
  with a non-finite component, off unit length by more than {AIM_EPSILON}, or with zero
  horizontal component.
- Any message with a field the protocol does not define.

`seq` **monotonicity** is not checked here — it is per-connection state, and `shared/protocol` has
none. `server/net` checks it against the connection's last accepted `seq`. The split is
deliberate: this module must stay pure.

---

## Encoding

```ts
export function encode(message: ServerMessage | ClientMessage): string;
```

`JSON.stringify` with no replacer and no rounding. **Rounding would be a bug, not an
optimisation**: `NFR-003` requires the client's replay to reproduce the server's state exactly,
and `JSON.stringify` already emits the shortest string that round-trips an IEEE 754 double
without loss — verified in [research.md § R5](../research.md#r5--reconciliation-and-why-it-needs-no-epsilon-but-does-need-smoothing--resolved).

Trimming coordinates to three decimals would save perhaps 15% of the bandwidth `NET-022` has
already declared to be within budget, and cost the bit-identity the entire netcode design rests
on.

---

## The key decoder

```ts
export function inputFromKeys(keys: number, dir: Vec3): PlayerInput;
export function keysFromHeld(held: ReadonlySet<string>): number; // client-side mapping
```

`inputFromKeys` is the **single** implementation of what a bitmask means. Both the client's
prediction and the server's tick call it with the same integer and get the same `PlayerInput`.

The client must call it on **the bitmask it is about to send**, never on the key set it sampled.
Anything lost in the encoding is then lost identically on both sides, which is the property that
makes prediction converge. Predicting from the richer local value is the classic version of this
bug and it is invisible until someone strafes diagonally.

`keysFromHeld` maps `KeyboardEvent.code`s to bits and is the only browser-shaped thing here; it
takes a plain `Set<string>` so it stays testable without a DOM. `shared/` may not touch the DOM
(`NFR-003`) — a `Set` of strings is not the DOM.

---

## Not in this module

- **Rate limiting and `seq` monotonicity** — per-connection state, so `server/net` (`NFR-010`).
- **`y`/`pt` derivation from `dir`** — needs `Math.atan2`, which ADR-0001 bans from `shared/`. It
  is presentation, and it lives in `server/room/serialise.ts`
  ([research.md § R7](../research.md#r7--where-y-and-pt-in-the-snapshot-come-from--resolved)).
- **Anything about sockets.** This module has never heard of a socket; it validates values.
