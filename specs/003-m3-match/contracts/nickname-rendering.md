# Contract: rendering player-controlled text

**Feature**: `003-m3-match` · **Requirement**: `NFR-012` · **Exit criteria**: `M3-9`, `M3-10`

**Consumers**: `client/hud` in M3 (scoreboard, kill feed, results screen, match status),
`client/render` in M4 (nameplates, `FR-GP-048`).

---

## Why this is a contract and not a style rule

M3 is the first milestone in which **one player's text is drawn in another player's browser**. A
nickname arrives over a socket from a machine the server does not control, is stored, is broadcast
to every other client, and is then written into three separate DOM surfaces. That is the complete
shape of a stored cross-site scripting vulnerability, and the only thing standing between this
project and one is the rule below.

`NFR-012` states it as an acceptance criterion, and the criterion is unusually precise:

> A nickname that passes server validation still cannot execute script in another player's browser.

Read the words _still cannot_. The requirement is explicitly **not** satisfied by the validator. It
is satisfied by the renderer, on its own, with the validator assumed to have failed.

---

## C1 — There is exactly one way player text reaches the DOM

Every surface that draws a nickname, a room code, or a server-supplied `error.message` does so
through a single helper in `client/hud` that assigns **`textContent`**.

```ts
// the only sanctioned sink for untrusted text
export function setText(el: Element, value: string): void;
```

Surfaces build structure with `document.createElement` and `append`. They never assemble markup as
a string.

**Why a chokepoint rather than a convention:** a convention has to be re-applied correctly in every
new surface by every future contributor, including M4's nameplates and M5's disconnect screen. A
chokepoint has to be correct once, and every call site is greppable.

## C2 — The HTML sinks are unreachable from `client/**`

Banned outright, enforced by ESLint before the first surface is written:

| Sink                                       | Ban                        |
| ------------------------------------------ | -------------------------- |
| assignment to `innerHTML` / `outerHTML`    | `no-restricted-syntax`     |
| `insertAdjacentHTML`                       | `no-restricted-properties` |
| `document.write`, `document.writeln`       | `no-restricted-properties` |
| `Range.prototype.createContextualFragment` | `no-restricted-properties` |

The rule lands in the **setup phase**, before any surface exists — the same ordering M0 used to
make its `shared/` boundary bite before any code could cross it, and for the same reason. A lint
rule added after the code is a lint rule that gets suppressed.

**A template string assigned to `innerHTML` is the specific pattern `NFR-012` names.** It is
banned by the assignment rule regardless of how the string was built, and no amount of escaping in
the template makes it permitted.

> If a future surface genuinely needs to build a subtree from a static template, the sanctioned
> route is `<template>` plus `cloneNode`, with every dynamic value filled in through `setText`. No
> exception to C2 is granted by this contract.

## C3 — The validator and the renderer are independent

`FR-GP-008` restricts nicknames to letters, digits, `_` and `-`, which excludes `<` and therefore
already blocks the obvious payload. **That is a second layer, not the layer.**

Two properties must hold separately:

- **Validator:** a nickname containing markup is rejected server-side, and the player joins
  nothing (`FR-GP-008`, `NFR-011`).
- **Renderer:** a hostile string handed **directly** to a surface, with the validator bypassed
  entirely, produces text and nothing else.

Neither is allowed to be the reason the other is not tested. The renderer must survive the day
someone widens the charset for a good reason — to allow spaces, or non-ASCII nicknames — and that
change must not silently become an injection.

## C4 — Server-supplied strings are not exempt

`error.message` (`NET-020`) is authored by the server, and it still goes through `setText`. Not
because it is dangerous today, but because "this string is safe" is a claim that decays: the same
surface renders both kinds of string, and a code path that treats one specially is the path the
next contributor copies.

`NET-020` also says the client branches on `code`, never on `message` text. That keeps the
untrusted-looking string purely presentational.

## C5 — The chokepoint is testable code

`setText` must **not** live in a file excluded from coverage. `vitest.config.ts` currently excludes
`client/boot/main.ts` and `client/input/pointer-lock.ts` as thin DOM shells; the chokepoint is not
a shell and must not join them.

`client/hud/**` sits at a 50% coverage threshold, which is **not** sufficient evidence that these
paths ran. The named tests in the next section are the gate, not the threshold.

---

## Required tests

Four, and each one fails for a different reason. All are named in the tasks that implement this
contract.

### T-A — the validator rejects markup

Feed `<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>`, an empty string, and a
200-character string to the shared nickname validator. Each is rejected; the server emits `error`
with `INVALID_NICKNAME`; no player is added to any room.

Satisfies `FR-GP-008`'s own acceptance criterion.

### T-B — the renderer is safe with the validator bypassed ★

**This is the test `NFR-012` actually asks for.** Call the rendering surface directly with hostile
strings — the validator is not in the call path.

The fixture is a hand-written fake element, which is what makes this possible with
`environment: 'node'` and **no new dependency**
([research.md § R7](../research.md#r7--enforcing-nfr-012-mechanically-and-testing-it-without-a-new-dependency)):

```ts
// shape only — the point is the booby trap on the second property
const el = {
  textContent: '',
  set innerHTML(_v: string) {
    throw new Error('innerHTML is not a sanctioned sink — NFR-012');
  },
  // append/createElement stubs as needed
};
```

Assertions:

1. `el.textContent` equals the hostile string **verbatim** — not escaped, not stripped, not
   truncated. Escaping would mean the string was treated as markup somewhere.
2. Nothing threw. A throw means some code path reached for `innerHTML`, and the test names it.
3. No element node was created from the string.

Run it against **every** surface that draws a nickname: scoreboard row, kill feed entry, results
screen standing. A surface added later without a matching case is a surface outside the contract.

### T-C — no HTML sink appears anywhere in `client/**`

A source-scanning test over `client/**` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
`document.write`, and `createContextualFragment`.

The repository already has this pattern: `shared/boundary.test.ts` and `shared/no-literals.test.ts`
both scan source text. It exists because ESLint's syntax matching can be evaded by anything
computed — `el['inner' + 'HTML'] = x`, or a bracket access through a variable — and a text scan
sees what the AST rule does not. Satisfies `M3-10`.

### T-D — a full-length nickname does not break a surface

{NICKNAME_MAX_LENGTH} is specified as "must fit a nameplate and a scoreboard row". Render a
maximum-length nickname in all three surfaces and confirm the layout holds. This is not a security
test; it is the reason the length limit exists, and it belongs beside the others so it is not
forgotten.

---

## What this contract does **not** do

- **It does not make the nickname trusted.** After validation it is still attacker-controlled text
  for the rest of its life, in every surface, in every milestone.
- **It does not cover a Content-Security-Policy.** A genuine fourth layer, deliberately out of
  scope: v1 is local-only (`D-013`) with no server configuration to attach a header to, and no
  requirement asks for one. Worth revisiting with
  [`Q-001`](../../../requirements/11-open-questions.md) when deployment is decided.
- **It does not stop at M3.** `FR-GP-048`'s nameplates in M4 render the same strings. If they are
  drawn as HTML overlays they use `setText` like everything else; if they are drawn into a canvas
  or a sprite texture, the binding rule is that **no code path builds markup from a nickname**.
  The contract is inherited, not re-derived.
