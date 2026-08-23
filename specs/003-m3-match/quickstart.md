# Quickstart: validating M3

**Feature**: `003-m3-match`

How to run M3 and confirm each of its exit criteria. This is a validation guide, not an
implementation guide — the code belongs in `tasks.md`.

> **Read this before anything else.** M3 cannot be validated until M1 and M2 have met their demo
> criteria, and it must not be implemented before then (Constitution, Principle V; see
> [plan.md § Blocking gates](plan.md#blocking-gates)). This document describes how M3 will be
> validated, and it is written now so the criteria are agreed before the code exists.

---

## Prerequisites

```bash
node --version    # must be >= 24 (package.json engines)
npm ci
```

Plus, from the gates:

- **M1 done** — two browsers see each other move smoothly.
- **M2 done** — two players can kill each other and respawn.
- **[`Q-006`](../../requirements/11-open-questions.md) closed** by the project owner as a `D-###`.

---

## Run

```bash
npm run dev       # Vite dev server for the client
npm start         # the Node server (added in M1)
```

Open the printed URL in **three** browser windows. Two is enough for most checks; the third is what
makes TDM's no-friendly-fire case and the kill feed worth looking at.

Each window: type a nickname, pick a mode, click Play.

---

## Make the match short first

Every match-lifecycle check below is unbearable at {MATCH_DURATION} = 8 minutes. Before validating
manually, edit `shared/constants/index.ts`:

```
MATCH_DURATION   480_000  ->  30_000     (30 s)
FRAG_LIMIT_FFA        20  ->  3
FRAG_LIMIT_TDM        40  ->  5
```

**This is itself the check for `M3-12` and `SC-4`.** If changing those three values requires
touching anything else — a duration written down in the HUD, a limit hardcoded in an end
condition — then Principle IV has been broken and the literal-scan test should have caught it.

Put them back afterwards.

---

## Automated gate

```bash
npm run verify    # typecheck + lint + coverage thresholds — the same gate CI runs
```

Green before any commit. It covers, with no human in the loop:

| Criterion                                                | Checked by                                  |
| -------------------------------------------------------- | ------------------------------------------- |
| `M3-2` — both end conditions, each with the right reason | Match lifecycle tests, both modes           |
| `M3-3` — a tie is a draw in both modes                   | Match result tests                          |
| `M3-4` — team sizes never differ by more than 1          | Team assignment tests with a stubbed random |
| `M3-5` — no friendly fire, and teammates do not block    | Raycast tests                               |
| `M3-7` — codes round-trip in any letter case             | Matchmaker tests                            |
| `M3-8` — `ROOM_FULL` and `ROOM_NOT_FOUND`                | Room and protocol tests                     |
| `M3-9` — hostile text renders as text                    | The validator test **and** the bypass test  |
| `M3-10` — no HTML sink reachable in `client/**`          | ESLint + the source-scanning test           |
| `M3-11` — a throwing room does not stop a healthy one    | Scheduler isolation test                    |
| `M3-12` — no gameplay literal outside `shared/constants` | The literal-scan test                       |
| `M3-14` — thresholds met with none relaxed               | `npm run test:coverage`                     |
| `M3-15` — a leaver's score leaves within one tick        | Room tests                                  |

If `npm run verify` passes but a criterion below fails, the test that should have caught it is
missing. Add it rather than accepting the manual check.

---

## Manual checks

### `M3-1` — the demo criterion

Two windows, FFA, with the shortened constants. Play until the frag limit. Then:

- Play **stops** — nobody moves or fires.
- The results screen shows both players' kills and deaths, sorted by score, and names the winner.
- A countdown runs for {POST_MATCH_DURATION}.
- A new match starts **on its own**. Scores are zero. Both players are alive and respawned.
- **Neither browser reconnected.** No page reload, no flash of the start screen, no new player ID.

Then let a second match run out on the clock instead, and confirm the same thing happens with
reason `TIME`.

That whole sequence, unattended, is the milestone.

### `M3-6` — a lone player lands in a match

Open **one** window with the server freshly started. Click Play. You are in a playable arena with
a running clock — no lobby, no "waiting for players", no spinner (`FR-GP-010`).

Open a second window and click Play with the same mode. It joins **the same room**, not a new one.
Confirm by checking the scoreboard shows two players.

### `M3-7` — private rooms

Create a private room in window A. Read the code: {ROOM_CODE_LENGTH} characters, and none of them
is `0`, `O`, `1`, `I` or `L` (`FR-GP-012`). Read it aloud to yourself — that is the actual
acceptance criterion.

Type it into window B **in lower case**. B joins A's match.

Then, in window C, click plain Play with the same mode. **C must not land in the private room** —
it gets a public one, even though the private room has space (`FR-GP-011`).

Finally, close A and B, wait out {EMPTY_ROOM_GRACE_PERIOD}, and enter the code again. It must
report `ROOM_NOT_FOUND` (`FR-GP-046`).

### `M3-9` — the XSS check, by hand

The automated tests are the gate; this is the check that the gate is pointed at the real thing.

1. In DevTools, send a `join` with the nickname `<img src=x onerror=alert(1)>` directly over the
   socket, bypassing the page. The server rejects it with `INVALID_NICKNAME` and you join nothing.
2. Now the part that matters. In a second client's console, push that same string into the roster
   as if it had arrived from the server, and open the scoreboard.

   **Nothing executes. No dialog. The literal characters appear in the row.** Then check the
   element in the inspector: it is a text node, not markup.

Repeat for the kill feed and the results screen. If any surface renders it as an element, `NFR-012`
is violated and the milestone is not done, regardless of what the tests say.

### `M3-13` — the timer is the server's, not the browser's

Start a match. Background the tab for 30 seconds — switch to another window entirely, so the
browser throttles timers. Come back.

The clock must show the **server's** remaining time, corrected on the first snapshot, not
30 seconds more than it should. A visible one-frame correction is fine; a persistent drift is
`FR-UI-011` failing.

### TDM, by eye

Three windows, TDM. Confirm:

- Teams are `BLUE` and `RED`, assigned by the server, with no way to choose (`FR-GP-004`).
- Two teammates spawn at the **same end** of the arena and the enemy at the other (`FR-MAP-008`).
- Firing at a teammate at point-blank does nothing at all — no damage, no hit marker
  (`FR-GP-005`).
- Standing a teammate directly between you and an enemy, the enemy still takes the shot
  (`FR-GP-005`, `FR-GP-025`). **This is the one people get wrong**, because zero-damage friendly
  fire and an excluded hit volume look identical until someone stands in the way.
- The scoreboard groups by team and shows team totals (`FR-UI-010`).
- Switching to FFA afterwards shows **no** team colours anywhere (`FR-GP-006`).

### The kill feed and scoreboard

- A kill appears in the feed within one snapshot and disappears after {KILL_FEED_ENTRY_TTL}.
- More than {KILL_FEED_MAX_ENTRIES} rapid kills still show at most {KILL_FEED_MAX_ENTRIES}.
- Holding `Tab` shows the scoreboard **while the match keeps running behind it**; releasing hides
  it (`FR-UI-010`).
- Join two windows with the **same nickname**. Both connect, and both the scoreboard and the kill
  feed distinguish them (`FR-GP-009`). Check the two windows agree on which is which — a suffix
  derived from join order rather than player ID will disagree between clients.
- Use a {NICKNAME_MAX_LENGTH}-character nickname and confirm nothing in any surface overflows.

### `M3-15` — a leaver leaves cleanly

With three players and some scores on the board, close one window. Within a tick, in both remaining
windows: the model is gone, the scoreboard row is gone, and the standings recomputed. No ghost
body, no ghost hit volume, no row with a stale score (`FR-GP-040`).

Reopen that window and rejoin. It is a **new** player with a new ID and zero score — there is no
reconnection into the same match (`D-009`).

---

## Definition of done

All fifteen criteria in [spec.md § Success Criteria](spec.md#success-criteria) hold, `npm run
verify` is green with no threshold relaxed, and `Q-006` is closed in
[10-decision-log.md](../../requirements/10-decision-log.md).

Then `main` is tagged `v0.4.0` and M4 may begin — not before
([CONTRIBUTING.md](../../CONTRIBUTING.md), Constitution Principle V).
