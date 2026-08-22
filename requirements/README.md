# Bullet Proof — Requirements

Browser-based 3D multiplayer arena shooter. Node.js + WebSocket + Three.js.

This folder is the **single source of truth** for what gets built. It is written to be
consumed by an implementation agent: every requirement has a stable ID, a testable
acceptance criterion, and an explicit status.

## Read in this order

| #   | Document                                   | What it answers                                                |
| --- | ------------------------------------------ | -------------------------------------------------------------- |
| 01  | [Vision & Scope](01-vision.md)             | Why this exists, what "done" means, what it is not             |
| 02  | [Gameplay](02-gameplay.md)                 | `FR-GP-*` — modes, movement, combat, death, match flow         |
| 03  | [UI & UX](03-ui-ux.md)                     | `FR-UI-*` — screens, HUD, scoreboard, audio, persistence       |
| 04  | [Map](04-map.md)                           | `FR-MAP-*` — arena format, geometry, spawns                    |
| 05  | [Architecture](05-architecture.md)         | `NFR-*` — stack, processes, module boundaries                  |
| 06  | [Network Protocol](06-network-protocol.md) | `NET-*` — tick model, every message, prediction model          |
| 07  | [Tuning Constants](07-constants.md)        | Every number in one place                                      |
| 08  | [Roadmap](08-roadmap.md)                   | Phase ordering, `M0`–`M5`                                      |
| 09  | [Out of Scope](09-out-of-scope.md)         | What must NOT be built in v1                                   |
| 10  | [Decision Log](10-decision-log.md)         | Decisions made, and what they override                         |
| 11  | [Open Questions](11-open-questions.md)     | Unresolved — must be answered before the phase that needs them |

## Conventions

**Requirement IDs are permanent.** Never renumber. To retire one, mark it
`Status: DROPPED` and keep the ID. New requirements take the next free number.

**Every functional requirement has this shape:**

```
### FR-XX-000 — Short title
**Status:** REQUIRED | PROPOSED | DEFERRED | DROPPED
**Statement:** One sentence, imperative, testable.
**Acceptance:** Observable pass/fail condition.
```

**Status meanings:**

- `REQUIRED` — confirmed by the project owner. Build it.
- `PROPOSED` — a reasonable default chosen by the author, not yet confirmed. Build it,
  but it is safe to change. All numeric values in [07-constants.md](07-constants.md)
  are effectively PROPOSED.
- `DEFERRED` — agreed, but not in v1. Do not build. Do not architecturally preclude.
- `DROPPED` — explicitly rejected. Do not build.

**Numbers live in exactly one place.** Any constant referenced in prose is written as
`{CONSTANT_NAME}` and defined in [07-constants.md](07-constants.md). Never hardcode a
gameplay number in two documents, and never hardcode one in code outside the shared
config module.

## Project snapshot

| Aspect      | Decision                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| Goal        | Portfolio piece — must look good and be playable by a stranger in under 10 seconds           |
| Genre       | Third-person arena shooter, 3D                                                               |
| Modes       | Free-for-all, Team Deathmatch (blue vs red)                                                  |
| Players     | Up to {MAX_PLAYERS_PER_ROOM} per room                                                        |
| Renderer    | Three.js, real 3D, over-the-shoulder camera                                                  |
| Characters  | Free rigged models with animations (Mixamo / Kenney / Sketchfab CC0)                         |
| Authority   | Server-authoritative simulation and hit detection                                            |
| Transport   | WebSocket, binary-agnostic JSON in v1                                                        |
| Persistence | `localStorage` only — no database, no accounts                                               |
| Deploy      | Local development only in v1; architecture must stay deployable to a long-lived Node process |
| Language    | Documents, UI, code, and identifiers all in English                                          |
| Timeline    | Open-ended, incremental — see [08-roadmap.md](08-roadmap.md)                                 |
