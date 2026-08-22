# 08 — Roadmap

There is no deadline. The ordering below is therefore chosen so that **something is
playable as early as possible** and every later phase adds to a working game rather than
completing an unfinished one.

Each milestone has a single demo criterion. Do not start the next milestone until the
current one's criterion is genuinely met.

---

## M0 — Walking box
**Demo:** One player, one browser, walks around the arena in third person.

- Project scaffold, `/shared` `/client` `/server` split (`NFR-003`)
- Three.js scene, over-the-shoulder camera with pointer lock (`FR-GP-019`, `FR-GP-021`)
- Map JSON schema, loader, and the arena rendered from it (`FR-MAP-002`, `FR-MAP-003`)
- Movement, collision, gravity, jump, crouch, sprint — **in `/shared`, deterministic**
  (`FR-GP-015`–`FR-GP-018`, `NFR-004`)
- Camera collision (`FR-GP-020`)
- **Player is a capsule primitive.** No models yet.

> Build movement in `/shared` from day one. Retrofitting a client-only movement
> implementation into shared deterministic code later is the single most expensive
> mistake available in this project.

## M1 — Two players moving
**Demo:** Two browsers see each other move smoothly.

- WebSocket server, one hardcoded room (`NFR-002`, `NFR-015`)
- `join` / `input` / `snapshot` (`NET-003`, `NET-004`, `NET-009`)
- Server tick loop at {SERVER_TICK_HZ} (`NFR-005`)
- Client prediction and reconciliation (`NFR-006`, `NFR-007`)
- Remote entity interpolation (`NFR-008`)
- `playerJoined` / `playerLeft`, clean disconnect (`FR-GP-040`)
- Input validation and rate limiting (`NFR-010`, `NFR-011`)

> This is the hardest milestone and the whole reason the project exists. Do not rush it,
> and do not move on while remote players still jitter.

## M2 — Shooting
**Demo:** Two players can kill each other and respawn.

- Server-side hitscan raycast against level geometry and static hit volumes
  (`FR-GP-024`–`FR-GP-027`)
- Regional damage, health, death (`FR-GP-026`, `FR-GP-034`, `FR-GP-036`)
- Fire rate, magazine, reload (`FR-GP-029`–`FR-GP-031`)
- Respawn with spawn selection (`FR-GP-037`, `FR-GP-038`)
- `shot` / `damage` / `hitConfirm` / `kill` / `respawn` messages
- Minimum HUD: health, ammo, crosshair (`FR-UI-005`–`FR-UI-007`)

## M3 — An actual match
**Demo:** A full match runs start to finish and restarts on its own.

- FFA and TDM modes, team assignment, no friendly fire (`FR-GP-001`–`FR-GP-006`)
- Scoring, frag limit, time limit, match end and restart (`FR-GP-041`–`FR-GP-046`)
- Start screen with nickname and mode (`FR-UI-001`, `FR-GP-007`, `FR-GP-008`)
- Auto-match and private room codes (`FR-GP-010`–`FR-GP-012`)
- Scoreboard, kill feed, match timer (`FR-UI-009`–`FR-UI-011`)
- Results screen (`FR-UI-004`)

## M4 — It looks like a game
**Demo:** A stranger watching a 30-second clip thinks it is a real game.

- Rigged character models with idle/walk/run/shoot/reload/death (`NFR-016`, `NFR-017`)
- Animation state machine driven by replicated state
- Nameplates **with occlusion** (`FR-GP-048`) — do not ship nameplates without this
- 2D audio (`FR-UI-017`, `FR-UI-018`)
- Hit markers, damage indicators, muzzle flash, tracers, impacts (`FR-UI-008`)
- Arena art pass: materials, lighting, real level design of rooms and cover
  (`FR-MAP-004`, `FR-MAP-005`)

## M5 — Finish
**Demo:** Handed to someone with only a link, they play without asking a question.

- `localStorage`: nickname, last room code, local stats (`FR-UI-020`–`FR-UI-024`)
- Loading screen, disconnect screen, unsupported-environment screen
  (`FR-UI-002`, `FR-UI-013`, `FR-UI-014`)
- Performance pass to {TARGET_FPS} with a full room (`NFR-014`)
- Empty room cleanup (`FR-GP-046`)
- `README` with screenshots, a GIF, and an architecture write-up — for a portfolio piece
  this is not optional polish, it is the deliverable
- `assets/CREDITS.md` with every licence

---

## After v1

In the order that would most improve the project:

1. **Deploy it.** v1 is local-only by decision, but a portfolio piece nobody can click is
   worth much less. A container host (Railway / Render / Fly.io) fits `NFR-002`; serverless
   does not. See [11-open-questions.md](11-open-questions.md#q-001).
2. **Lag compensation** (`NFR-009`) — the highest-value technical addition, and the best
   thing on this list to talk about in an interview.
3. **Recoil and spread** (`FR-GP-033`) — the highest-value gameplay addition.
4. **3D positional audio** (`FR-UI-017`) — footsteps change how the game plays.
5. Spawn protection (`FR-GP-039`), settings menu (`FR-UI-015`), more maps (`FR-MAP-011`).
