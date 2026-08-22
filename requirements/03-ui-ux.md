# 03 — UI & UX

---

## Screens

### FR-UI-001 — Start screen
**Status:** REQUIRED
**Statement:** The entry screen collects a nickname, a game mode, and a join action, and
nothing else.
**Acceptance:** It contains: a nickname field, an FFA/TDM selector, a primary "Play"
button, a secondary "Create private room" action, and a "Join with code" input. No
tutorial, no settings, no login.
**Rationale:** `SC-1` — ten seconds from page open to first shot.

### FR-UI-002 — Loading state
**Status:** REQUIRED
**Statement:** While 3D assets load, the player sees a determinate progress indicator, not
a blank canvas or a frozen page.
**Acceptance:** Asset loading progress is reported by the Three.js `LoadingManager` and
displayed as a percentage.

### FR-UI-003 — In-game screen
**Status:** REQUIRED
**Statement:** During play the viewport is the 3D scene plus the HUD; no browser chrome,
scrollbars, or page scrolling.
**Acceptance:** The canvas fills the viewport at any window size and resizes correctly
without distorting the aspect ratio.

### FR-UI-004 — Results screen
**Status:** REQUIRED
**Statement:** At match end an overlay shows final standings, the winner, and a countdown
to the next match.
**Acceptance:** Shows per-player kills and deaths, and in TDM the team totals, sorted by
score descending.

---

## HUD

### FR-UI-005 — Health display
**Status:** REQUIRED
**Statement:** Current health is always visible during play.
**Acceptance:** Updates within one snapshot of taking damage. Displays a numeric value; a
bar is optional.

### FR-UI-006 — Ammo display
**Status:** REQUIRED
**Statement:** Rounds remaining in the magazine are always visible, and reloading is
visibly indicated.
**Acceptance:** Shows `current / {MAGAZINE_SIZE}`. During reload, shows a progress
indicator lasting exactly {RELOAD_TIME}.

### FR-UI-007 — Crosshair
**Status:** REQUIRED
**Statement:** A crosshair marks where shots will land.
**Acceptance:** The crosshair position corresponds to the actual aim ray. Because the
camera is offset from the character (`FR-GP-019`), the crosshair must reflect the ray the
**server** will cast, not merely the screen centre — otherwise close-range shots hit the
wrong point. Document the chosen approach in the ADR.

### FR-UI-008 — Hit feedback
**Status:** REQUIRED
**Statement:** The player receives immediate feedback when they land a hit and when they
take damage.
**Acceptance:** Landing a hit shows a hit marker on the crosshair; taking damage shows a
directional damage indicator or screen flash.

### FR-UI-009 — Kill feed
**Status:** REQUIRED
**Statement:** Recent kills appear as a list of `<killer> killed <victim>` entries.
**Acceptance:** Entries appear within one snapshot of the kill and disappear after
{KILL_FEED_ENTRY_TTL}. At most {KILL_FEED_MAX_ENTRIES} are shown at once. In TDM, names
are coloured by team. Nicknames are rendered as text, never as HTML — see `NFR-012`.

### FR-UI-010 — Scoreboard
**Status:** REQUIRED
**Statement:** Holding `Tab` shows a scoreboard with every player's nickname, kills, and
deaths, sorted by kills descending; TDM additionally shows team totals and groups players
by team.
**Acceptance:** Releasing `Tab` hides it. The scoreboard is readable while the match
continues to run behind it.

### FR-UI-011 — Match status
**Status:** REQUIRED
**Statement:** Remaining match time and the current score relative to the frag limit are
always visible.
**Acceptance:** The timer counts down from {MATCH_DURATION} and is driven by server state,
not by a purely local clock — it must resynchronise from each snapshot.

### FR-UI-012 — Respawn overlay
**Status:** REQUIRED
**Statement:** While dead, the player sees who killed them and a countdown to respawn.
**Acceptance:** The countdown reflects {RESPAWN_DELAY} and reaches zero exactly as the
player respawns.

### FR-UI-013 — Connection state
**Status:** REQUIRED
**Statement:** The player is told when the connection is lost.
**Acceptance:** A socket close shows a clear "Disconnected" overlay with a button
returning to the start screen. Per `FR-GP-040`, there is no automatic rejoin into the same
match.

### FR-UI-014 — Unsupported environment
**Status:** REQUIRED
**Statement:** On a viewport narrower than {MIN_VIEWPORT_WIDTH} px, or without WebGL2, the
game does not load and shows an explanatory message.
**Acceptance:** Opening the page on a phone shows "Play on a desktop computer" and never
downloads the 3D assets.

### FR-UI-015 — Settings menu
**Status:** DEFERRED
**Statement:** An in-game menu for mouse sensitivity, volume, and graphics quality.
**Rationale:** Not required for v1. Constants live in code
([07-constants.md](07-constants.md)). If added later, persist to `localStorage` alongside
`FR-UI-017`.

### FR-UI-016 — Text chat
**Status:** DROPPED
**Rationale:** Low value for a portfolio piece, and an untrusted-input surface (XSS,
moderation) with no offsetting benefit. Explicitly rejected. See
[09-out-of-scope.md](09-out-of-scope.md).

---

## Audio

### FR-UI-017 — Simple 2D audio
**Status:** REQUIRED
**Statement:** The game plays non-positional (2D) sound effects for: firing, reloading,
taking damage, dealing a killing blow, and dying.
**Acceptance:** Each event triggers its sound. Volume does not vary with distance or
direction.
**Note:** 3D positional audio via `THREE.PositionalAudio` is `DEFERRED`. It is a strong
later upgrade — footsteps are the single most valuable positional cue in a shooter — but
2D audio ships first.

### FR-UI-018 — Audio requires a gesture
**Status:** REQUIRED
**Statement:** The `AudioContext` is created or resumed only after a user gesture.
**Acceptance:** No browser autoplay warning appears in the console; audio works reliably
from the first shot.

### FR-UI-019 — Mute control
**Status:** PROPOSED
**Statement:** A key toggles all audio on and off.
**Acceptance:** The toggle takes effect immediately and its state persists per
`FR-UI-021`.

---

## Client persistence (`localStorage`)

`localStorage` is the **only** persistence in the system. There is no database and no
server-side player record. All stored data is per-browser, per-device, and untrusted.

### FR-UI-020 — Remember nickname
**Status:** REQUIRED
**Statement:** The last used nickname is stored and pre-fills the start screen on the next
visit.
**Acceptance:** After playing once and reloading, the nickname field is already filled.

### FR-UI-021 — Remember last room code
**Status:** REQUIRED
**Statement:** The most recently used private room code is stored and offered as a
one-click rejoin on the start screen.
**Acceptance:** After joining room `X7K2` and reloading, the start screen offers rejoining
`X7K2`. The entry is cleared if the server reports the room no longer exists.

### FR-UI-022 — Local career stats
**Status:** REQUIRED
**Statement:** Cumulative kills, deaths, and matches played are stored locally and shown
on the start screen.
**Acceptance:** Stats increase across sessions in the same browser.
**Constraints — must be stated in the UI:** these stats are local to one browser, are
never sent to the server, are trivially editable by the player, and must never be
presented as a leaderboard or compared between players.

### FR-UI-023 — Storage schema is versioned
**Status:** PROPOSED
**Statement:** All `localStorage` data lives under a single namespaced key containing a
schema version field.
**Acceptance:** Key is `bulletproof.v1`. Reading data with an unknown version discards it
and starts fresh rather than crashing.

### FR-UI-024 — Storage access is defensive
**Status:** REQUIRED
**Statement:** Every read and write to `localStorage` is wrapped in `try/catch` and the
game works correctly when storage is unavailable or returns garbage.
**Acceptance:** The game is fully playable in a private window with site data blocked;
stored values are validated on read, never trusted by shape.
