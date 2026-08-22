# 10 — Decision Log

Decisions that were made deliberately, especially the ones that **override or contradict**
the original draft (`archive/v0-original-draft.md`). If an implementation choice seems to
conflict with something written elsewhere, the answer is here.

Format: `D-###` — decision, alternatives considered, and consequence.

---

### D-001 — Portfolio project, not a product

**Decision:** Optimise for demonstrating engineering quality to a technical reader.
**Consequence:** Systems correctness beats content quantity. One arena, one weapon, two
modes — but the netcode is done properly. Drives nearly every entry in
[09-out-of-scope.md](09-out-of-scope.md).

### D-002 — Real 3D with Three.js

**Alternatives:** 2D top-down (far cheaper, and would have made concealment trivial);
2.5D isometric.
**Decision:** Real 3D, over-the-shoulder camera.
**Consequence:** Accepts the cost of animated models, camera collision, 3D collision, and
a genuinely harder occlusion story. This is the single largest scope driver in the project.

### D-003 — Server-authoritative, but no lag compensation

**Alternatives:** Client-authoritative (trivial, and instantly cheatable); full
server-side rewind (what CS/Valorant do).
**Decision:** Server-authoritative simulation and hit detection, with client prediction and
reconciliation, and **no** rewind (`NFR-009`).
**Consequence:** Honest and uncheatable at the protocol level, but high-latency players
must lead moving targets. Rewind is the designated first post-v1 upgrade.

### D-004 — Regional damage replaces "5 shots to die"

**Overrides:** Original draft item 4, _"5 Shots to die"_.
**Decision:** head 50 / torso 20 / legs 10 against 100 health (`FR-GP-026`).
**Consequence:** Time-to-kill is now 2 to 10 shots depending on aim, not a flat 5. "Five
shots" remains true only for torso hits. This also forces per-region hit volumes, which is
why `FR-GP-027` pins them to static primitives rather than animated bones.

### D-005 — No armour, despite the project's name

**Overrides:** Original draft item 5, which stated the rule as a negation
(_"there is no bulletproof vest"_).
**Decision:** A single 100-point health pool, no armour layer, restated as a positive
design rule (`FR-GP-034`).
**Consequence:** Simple, readable combat maths. The name "Bullet Proof" is understood as
ironic. Armour as a map pickup was considered and rejected — it would have required item
spawning and synchronisation for little gain.

### D-006 — Concealment is visual, not networked

**Overrides:** The ambiguity in original draft item 8, _"if a player is inside a room the
other one cannot see where he is"_.
**Alternatives:** Server-side visibility culling (immune to wallhacks, requires a
per-client PVS every tick); hiding players from a minimap only.
**Decision:** Standard depth-buffer occlusion, plus a client-side line-of-sight check that
hides nameplates (`FR-GP-047`, `FR-GP-048`, `FR-GP-049`).
**Consequence:** A modified client can locate hidden players. Accepted and documented as a
known limitation rather than silently ignored. **The nameplate rule is the real work here**
— without it, labels render through walls and every wall in the arena stops mattering.

### D-007 — Automatic respawn, continuous match

**Alternatives:** Round-based elimination (tense, but a player who dies early sits
watching — poison for a portfolio demo a stranger tries for two minutes); limited lives.
**Decision:** Respawn after {RESPAWN_DELAY}, match ends on time or frag limit.
**Consequence:** A visitor is never left with nothing to do.

### D-008 — Auto-match plus private room codes

**Alternatives:** A public room list (needs lobby UI and multi-room management up front);
auto-match only.
**Decision:** Both a one-click "Play" and a shareable {ROOM_CODE_LENGTH}-character code
(`FR-GP-010`, `FR-GP-011`).
**Consequence:** A recruiter clicking the link plays instantly; a friend can be invited
into a specific match without depending on anyone else being online. A public room browser
stays deferred.

### D-009 — No reconnection into the same match

**Alternatives:** Hold the player's slot and score for ~30 s behind a session token.
**Decision:** A dropped socket removes the player permanently; rejoining creates a new
player (`FR-GP-040`).
**Consequence:** Eliminates session tokens, slot reservation, and an entire class of
ghost-player bugs. Worse experience on a flaky connection — accepted for v1.

### D-010 — One hand-authored, data-driven map

**Alternatives:** Several maps with voting; procedural generation.
**Decision:** One arena, defined in JSON, loaded by both client and server
(`FR-MAP-001`, `FR-MAP-002`).
**Consequence:** Client and server can never disagree about geometry — which kills the
classic "visually hit the wall, server says it hit a player" bug before it exists. Adding
maps later is cheap; only the level design costs time.

### D-011 — Free rigged models over primitives

**Alternatives:** Coloured capsules and boxes (zero asset cost, ships far sooner).
**Decision:** Free rigged characters from Mixamo / Kenney / Sketchfab CC0 (`NFR-016`).
**Consequence:** Meaningfully better screenshots, at the cost of glTF loading, an animation
state machine, and animation blending. Mitigated by `NFR-017`: animation is cosmetic and
never touches the simulation, and by shipping primitives through M0–M3 and models only in
M4.

### D-012 — 2D audio, not positional

**Decision:** Non-positional sound effects (`FR-UI-017`).
**Consequence:** Cheap and effective for a demo video. Loses the strongest audio
information in a shooter — hearing where footsteps come from. Explicitly deferred, not
forgotten.

### D-013 — Local development only in v1

**Decision:** No production deployment target chosen yet.
**Consequence:** The architecture must not depend on anything a plain long-lived Node
process cannot do (`NFR-002`), which rules out serverless hosts. A portfolio piece
eventually needs a public link — tracked as [Q-001](11-open-questions.md#q-001).

### D-014 — English everywhere

**Decision:** Documents, UI copy, code, identifiers, and commit messages in English.
**Consequence:** No i18n layer. Conversations about the project happen in Portuguese; the
artefact is in English.

### D-015 — `localStorage` is the only persistence

**Decision:** Nickname, last room code, and local career stats (`FR-UI-020`–`FR-UI-022`).
**Consequence:** No database, no accounts, no leaderboard. Local stats are per-browser and
trivially editable, so the UI must present them as personal, never competitive.
