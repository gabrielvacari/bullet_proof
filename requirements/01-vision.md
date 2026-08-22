# 01 — Vision & Scope

## What this is

A browser-based, third-person, 3D multiplayer arena shooter. A visitor opens a URL,
types a nickname, and is shooting other people within seconds. No install, no account,
no tutorial.

## Why it exists

This is a **portfolio project**. Its job is to demonstrate, to a technical reader:

1. Real-time multiplayer networking done correctly — a server-authoritative simulation
   with client-side prediction, not a naive "client says it killed someone" toy.
2. 3D rendering in the browser with Three.js, including animated characters.
3. Clean architecture with shared code between client and server.

Every scope decision follows from that. Where "impressive to a technical reader" and
"more game content" conflict, correctness of the systems wins over quantity of content.
One well-built arena beats five mediocre ones.

## Success criteria

The project is done when all of the following are true:

- **SC-1** — A person who has never seen the game can go from opening the page to
  firing their first shot in under 10 seconds, with no instructions.
- **SC-2** — Two players on different machines can play a full match to completion
  without a desync, a stuck player, or a ghost player left behind.
- **SC-3** — Movement feels immediate on a connection with 100 ms round-trip latency —
  no rubber-banding of the local player under normal play.
- **SC-4** — Editing a single constants file changes match length, damage, or weapon
  behaviour, with no other code change.
- **SC-5** — A reader can open `requirements/` and understand the whole system without
  reading any source code.

## Target platform

- **Desktop browsers only.** Latest Chrome, Firefox, Edge, Safari.
- Mouse and keyboard required. Pointer Lock API required.
- On a viewport narrower than {MIN_VIEWPORT_WIDTH} px, the game must not load; it shows
  a static message telling the visitor to open it on a computer. See `FR-UI-010`.
- WebGL2 required. If unavailable, show a clear message rather than a blank canvas.

## Explicit non-goals

These are not oversights. They are decisions. See [09-out-of-scope.md](09-out-of-scope.md)
for the full list with reasoning.

- No mobile or touch support.
- No accounts, no server-side persistence, no database.
- No anti-cheat beyond server authority.
- No matchmaking, skill rating, or progression.
- No in-game text chat.
- No lag compensation / server-side rewind.
