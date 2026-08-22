# 09 — Out of Scope

Everything here is a decision, not an omission. An implementation agent must **not** build
any of it, and must not add architecture whose only purpose is to support it.

`DROPPED` means rejected. `DEFERRED` means agreed for later — do not build it now, but do
not architecturally preclude it either.

---

## Platform

| Item                             | Status   | Reason                                                                                                                                          |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile / touch controls          | DROPPED  | Roughly doubles input work, forces a HUD redesign, and integrated mobile GPUs will not hold {TARGET_FPS}. Desktop-only is normal for the genre. |
| Gamepad support                  | DEFERRED | Cheap to add later behind the input abstraction; no value for v1.                                                                               |
| Fullscreen / PWA / offline       | DROPPED  | An always-online multiplayer game has nothing to do offline.                                                                                    |
| Legacy browsers, WebGL1 fallback | DROPPED  | `FR-UI-014` shows a message instead.                                                                                                            |

## Accounts & persistence

| Item                                | Status   | Reason                                                                                                |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| User accounts, login, OAuth         | DROPPED  | Nickname-only entry is what makes `SC-1` possible.                                                    |
| Database of any kind                | DROPPED  | No state needs to outlive the process.                                                                |
| Global leaderboards                 | DROPPED  | Would require accounts and a database, and `FR-UI-022` stats are client-side and trivially forgeable. |
| Progression, XP, unlocks, cosmetics | DROPPED  | Content treadmill; contributes nothing to the portfolio goal.                                         |
| Match history / replays             | DEFERRED | Genuinely interesting technically, but far beyond v1.                                                 |

## Multiplayer scope

| Item                                      | Status   | Reason                                                                                                                                                  |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill-based matchmaking                   | DROPPED  | Meaningless below a real player population.                                                                                                             |
| More than {MAX_PLAYERS_PER_ROOM} per room | DROPPED  | Hard requirement.                                                                                                                                       |
| Multi-process / horizontal scaling        | DROPPED  | `NFR-002`. One process, in-memory rooms.                                                                                                                |
| Reconnect into the same match             | DROPPED  | Decided explicitly: a dropped player rejoins as a new player (`FR-GP-040`). Removes session tokens, slot reservation, and a class of ghost-player bugs. |
| Spectator mode                            | DEFERRED |                                                                                                                                                         |
| Server browser / public room list         | DEFERRED | Auto-match plus private codes (`FR-GP-010`, `FR-GP-011`) covers both real use cases.                                                                    |
| Voice chat                                | DROPPED  | WebRTC is a project of its own.                                                                                                                         |
| Text chat                                 | DROPPED  | `FR-UI-016`. Low value, untrusted-input surface, needs moderation.                                                                                      |

## Netcode

| Item                                           | Status   | Reason                                                                                                        |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| Lag compensation / server-side rewind          | DEFERRED | `NFR-009`. The correct next step after v1, not a prerequisite.                                                |
| Server-side visibility culling (anti-wallhack) | DEFERRED | `FR-GP-049`. Requires a per-client PVS computed every tick. The wallhack exposure is accepted and documented. |
| Binary protocol                                | DEFERRED | `NET-022`. JSON is within budget at this scale.                                                               |
| Delta-compressed snapshots                     | DEFERRED | `NET-023`.                                                                                                    |
| WebRTC / UDP transport                         | DROPPED  | WebSocket over TCP is a stated technical requirement.                                                         |

## Gameplay

| Item                               | Status   | Reason                                                                              |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| Multiple weapons, weapon selection | DROPPED  | Would break the uniform damage model in `FR-GP-026`.                                |
| Weapon, health, or armour pickups  | DROPPED  | Requires item spawning, respawn timers, and pickup synchronisation.                 |
| Armour / bulletproof vest          | DROPPED  | `FR-GP-034` — deliberate, despite the project name.                                 |
| Health regeneration                | DROPPED  | `FR-GP-035`.                                                                        |
| Grenades, abilities, melee         | DROPPED  |                                                                                     |
| Recoil, spread, damage falloff     | DEFERRED | `FR-GP-033`, `FR-GP-028`. High-value later addition.                                |
| Fall damage, out-of-bounds damage  | DROPPED  | `FR-GP-042`; `FR-MAP-006` seals the arena instead.                                  |
| Additional modes (CTF, domination) | DROPPED  | Two modes is the requirement.                                                       |
| Multiple maps, map voting          | DEFERRED | `FR-MAP-011`.                                                                       |
| Bots / AI opponents                | DEFERRED | Would genuinely help a portfolio demo with no players online — reconsider after M5. |
| Spawn protection                   | DEFERRED | `FR-GP-039`.                                                                        |

## Operations

| Item                               | Status   | Reason                                                                                            |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| Production deployment              | DEFERRED | v1 is local-only by decision. See [11-open-questions.md](11-open-questions.md#q-001).             |
| Anti-cheat beyond server authority | DROPPED  | Server authority (`NFR-001`) is the defence. Client attestation is out of reach and out of scope. |
| Reporting, moderation, bans        | DROPPED  | No accounts, no persistence, no chat.                                                             |
| Analytics / telemetry              | DROPPED  |                                                                                                   |
| Localisation / i18n                | DROPPED  | English only, everywhere.                                                                         |
