# Contract: the combat messages

**Feature**: `002-m2-shooting` · **Owner of the truth**:
[`06-network-protocol.md`](../../../requirements/06-network-protocol.md)

The message shapes are `NET-012` through `NET-016` and are **not** restated here — Constitution
Principle I. This page says what M2 must guarantee about them: who receives each one, what may
never appear in it, and where it is validated.

---

## The inbound surface is two bits

Everything M2 adds to the client→server direction is bits **128 (`fire`)** and **256 (`reload`)**
of `NET-004`'s existing `keys` bitmask. There is no new inbound message.

| Rule                                                                                                                                                 | Requirement          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Both bits are **requests**. The server decides whether a shot or a reload actually happens, from fire rate, ammunition, reload state and alive state | `NET-004b`           |
| `keys` is validated as a non-negative safe integer and **masked** to the defined bits before decoding. An undefined bit never reaches game logic     | `NFR-011`, `NET-002` |
| Validation lives in `shared/protocol`, beside the message type, so client and server cannot drift                                                    | `NET-002`            |
| Nothing inbound carries health, ammunition, a hit, a victim, a damage figure, a kill or a position                                                   | `NET-007`, `NFR-001` |

**That last row is a test, not a comment.** `M2-3` asserts that no inbound message type in
`shared/protocol` has a field able to assert an outcome. The absence is the mechanism; a test is
how it stays absent when someone adds a message in M3.

Masking rather than rejecting matches how `NET-001` already treats unknown message types — an
unrecognised bit is ignored, not an error — so adding a bit in a later milestone cannot break an
older client.

---

## Outbound: who gets what, and what must never be in it

| Message                | Recipients           | Must contain                            | Must **never** contain                                          |
| ---------------------- | -------------------- | --------------------------------------- | --------------------------------------------------------------- |
| `NET-012` `shot`       | Everyone in the room | The segment and whether it hit          | Any damage figure, victim id, region, or health. It is cosmetic |
| `NET-013` `damage`     | **The victim only**  | New health, attacker, region, direction | Anything about other players                                    |
| `NET-014` `hitConfirm` | **The shooter only** | Region, lethal                          | **The victim's remaining health**, or the victim's identity     |
| `NET-015` `kill`       | Everyone in the room | Killer, victim, region                  | Health, positions, score — scoring is `NET-017`, M3's           |
| `NET-016` `respawn`    | Everyone in the room | Id, position, yaw, health               | Ammunition — that is per-recipient snapshot data (`NET-009`)    |

Three of those "never" columns are information boundaries rather than tidiness:

- **`hitConfirm` withholding health is deliberate** (`NET-014` says so). A modified client that
  learned every victim's remaining health from its own hits would gain real, exploitable
  information — it would know exactly when one more shot kills. The value must not enter the
  message builder at all, rather than being stripped later.
- **`shot` carrying no damage information** is what lets it be broadcast to everyone. It is the
  tracer and the muzzle flash, nothing more, and it goes to players who could not see the shooter
  — consistent with `FR-GP-049`, which already accepts that position data is broadcast without a
  visibility check and documents the wallhack exposure as a known trade-off.
- **`kill` carrying no score** keeps `NET-009b`'s split intact: slow-changing data travels on its
  own message, and M3 adds `NET-017` without touching this one.

### Derivation

All five are built in `server/` from exactly one `ShotResult` and, where relevant, one
`DamageOutcome` ([combat-api.md](combat-api.md)). Building them from a shared source is what makes
it impossible for the tracer, the damage indicator, the hit marker and the kill feed to describe
different events.

`NET-013`'s `dir` is computed server-side, from the shooter's eye toward the victim, flattened to
horizontal and normalised. The victim's client is told **which way to point an arrow**, not where
the shooter is standing.

---

## `NET-009` snapshot: three fields stop being placeholders

`NET-009` already defines them; M2 is where they carry real values.

| Field | M2 obligation                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------- |
| `hp`  | The authoritative health. `FR-UI-005` requires the HUD to update within one snapshot of taking damage |
| `am`  | Ammunition — **only for the receiving player**                                                        |
| `st`  | Bit 8 `reloading` and bit 16 `dead` become meaningful, derived from `reloadTicks` and `health`        |

**`am` being per-recipient has a structural consequence**: the snapshot can no longer be
serialised once and written verbatim to every socket. That is a change to the snapshot builder M1
owns, and M2 depends on it. It is recorded here so it is found at planning time rather than
discovered while wiring — see [plan.md § Dependencies on M1](../plan.md#dependencies-on-m1).

`NET-009a` still holds: every living player is in the snapshot regardless of line of sight
(`FR-GP-049`). M2 adds no visibility filtering, and server-side culling stays `DEFERRED`.

---

## Ordering and delivery

- All five are sent in the tick that produced them. `NET-012` and `NET-015` are broadcast;
  `NET-013` and `NET-014` are unicast. WebSocket over TCP means per-connection order is preserved,
  so no sequence number is added — and none is defined by `06-network-protocol.md`.
- A `damage` and the `snapshot` that reflects the same hit may arrive in either order relative to
  one another only across different connections, never within one. The HUD therefore treats the
  snapshot's `hp` as authoritative and `NET-013` as the event that decorates it, not the other way
  round.
- **A client must tolerate every one of these messages without a renderer for it.** In M2, hit
  markers and damage indicators (`FR-UI-008`) are M4's and the kill feed (`FR-UI-009`) is M3's.
  Receiving `hitConfirm` with nothing to draw must be a no-op, not a crash.

---

## Message size and rate

`NET-022` and `NET-023` are `DEFERRED`: JSON, uncompressed, no deltas. M2 must not pre-optimise.

Worth a sanity check rather than an optimisation: at {FIRE_RATE_RPS} shots per second per player
and {MAX_PLAYERS_PER_ROOM} players, a fully automatic room produces at most 80 `shot` broadcasts
per second, each a short object, in addition to {SNAPSHOT_HZ} snapshots. That is comfortably
inside the budget `NET-022` cites. If measurement ever says otherwise, the answer is a measurement
and a decision by the project owner, not a binary encoder added quietly during M2.

{MAX_MESSAGE_BYTES} continues to cap inbound messages only; it is an `NFR-010` limit on what a
client may send, and none of these five is inbound.
