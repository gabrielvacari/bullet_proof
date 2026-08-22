# Bullet Proof

Browser-based 3D multiplayer arena shooter. Node.js + WebSocket + Three.js.
Portfolio project — see [requirements/01-vision.md](requirements/01-vision.md).

## Read this first

**[`requirements/`](requirements/README.md) is the source of truth for what to build.**
Do not infer requirements from code, and do not invent them. Every requirement has a stable
ID (`FR-GP-026`, `NFR-003`, `NET-009`).

| Question                           | Document                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| What are the rules of the game?    | [02-gameplay.md](requirements/02-gameplay.md)                                     |
| What number should this be?        | [07-constants.md](requirements/07-constants.md) — **the only place numbers live** |
| What message does the server send? | [06-network-protocol.md](requirements/06-network-protocol.md)                     |
| Should I build this at all?        | [09-out-of-scope.md](requirements/09-out-of-scope.md)                             |
| Why is it like this?               | [10-decision-log.md](requirements/10-decision-log.md)                             |
| What is undecided?                 | [11-open-questions.md](requirements/11-open-questions.md)                         |
| What comes next?                   | [08-roadmap.md](requirements/08-roadmap.md)                                       |

## Rules

1. **Never invent a requirement.** If something is not specified, check
   [11-open-questions.md](requirements/11-open-questions.md). If it is an open question and
   it blocks you, **stop and ask** — do not guess and do not proceed on an assumption.
2. **Never build anything marked `DROPPED` or `DEFERRED`.** Those are decisions, not gaps.
   Check [09-out-of-scope.md](requirements/09-out-of-scope.md) before adding a feature that
   was not asked for.
3. **Never write a gameplay number outside `shared/constants`.** Reference it by name.
   `SC-4` requires that changing a value there is the only change needed.
4. **`shared/` must stay pure.** No imports from `client/` or `server/`. No `window`,
   `document`, `THREE`, or Node built-ins. No wall-clock time. No unseeded randomness.
   This is what makes `NFR-003` and `NFR-004` enforceable.
5. **The server is authoritative.** No client message may set health, position, score, or
   kill status. If you are about to add such a message, you are violating `NFR-001` — see
   `NET-007`.
6. **Validate every inbound field** before it reaches game logic (`NFR-011`). Never trust a
   client-supplied delta time (`NET-004a`).
7. **Nicknames are `textContent`, never `innerHTML`** (`NFR-012`).
8. **Follow the milestone order** in [08-roadmap.md](requirements/08-roadmap.md). Do not
   start M2 while M1's demo criterion is unmet.

## Process

Full detail in [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

- **Branching:** GitHub Flow. Branch from `main`, PR, squash merge. No `develop`.
- **Commits:** Conventional Commits, in English, validated by commitlint.
  Cite requirement IDs in the body: `Implements: FR-GP-026`.
- **Tests:** coverage targets are per directory, not global —
  100% in `shared/`, 90% in `server/` and `client/net/`, `client/render/` excluded.
- **TypeScript `strict`.** No `any`, no `@ts-ignore` without a justifying comment.
- **Significant architecture decisions** become numbered ADRs in
  [`docs/adr/`](docs/adr/README.md) — the simulation, the protocol, the authority model,
  aim conventions. Process and tooling are rules in [CONTRIBUTING.md](CONTRIBUTING.md), not
  ADRs. Anything with a requirement ID stays in `requirements/`.
  Product decisions go in
  [10-decision-log.md](requirements/10-decision-log.md).

## Spec Kit — not in use yet

Spec Kit is **not set up in this repository**. There is no `.specify/` directory, and no
Spec Kit workflow is active. Do not run `specify init` or any `/specify`, `/plan`, or
`/tasks` command unless the project owner explicitly asks.

If it is adopted later, the relationship is one-directional: `requirements/` stays the
source of truth, and generated specs cite requirement IDs rather than restating them.

## Traps specific to this project

These are the mistakes that are cheap to avoid now and expensive to fix later:

- **Writing movement in `client/` first.** Movement must be born in `shared/sim`
  (`NFR-003`). Retrofitting it later is the single most expensive mistake available here.
- **Deriving hit volumes from animated bones.** `FR-GP-027` deliberately uses static
  primitives. Do not "improve" this.
- **Rendering nameplates without the occlusion check.** `FR-GP-048`. Without it, labels
  draw through walls and every wall in the arena becomes decoration — which silently
  defeats the original design goal.
- **Assuming the crosshair ray equals the eye ray.** The camera is offset
  (`CAMERA_OFFSET`). This is unresolved — see
  [Q-003](requirements/11-open-questions.md#q-003). Decide it as an ADR before writing
  firing code.
- **Optimising the protocol early.** Binary encoding and delta compression are `DEFERRED`
  (`NET-022`, `NET-023`). JSON is within budget. Do not pre-optimise.
- **Adding a database.** There is none, by decision (`D-015`). `localStorage` only.
