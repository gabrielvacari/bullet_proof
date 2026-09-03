# 11 — Open Questions

Unresolved items. Each names the milestone that forces an answer. An implementation agent
that reaches a blocking question must **stop and ask**, not guess.

Answered questions move to [10-decision-log.md](10-decision-log.md) and are deleted here.

---

### Q-001 — Where does this get deployed?

**Blocks:** post-M5. **Severity:** high for the portfolio goal, zero for building v1.

v1 is local-only by decision (`D-013`), but a portfolio piece nobody can click is worth
far less than one they can. A container host (Railway, Render, Fly.io) satisfies `NFR-002`;
Vercel, Netlify Functions, and Lambda do not, because match state lives in a long-lived
process. This must be answered before M5's README claims the game is playable.

**Also unanswered:** what happens when the free tier idles the process and every match dies?

### Q-002 — Actual balance numbers

**Blocks:** M3 playtesting. **Severity:** low — the values only need to be _close_.

Every number in [07-constants.md](07-constants.md) marked PROPOSED is an educated guess.
They cannot be validated without playing. Most likely to be wrong:

- `GRAVITY` / `JUMP_VELOCITY` — jump feel is very sensitive to these.
- `ARENA_SIZE` — the classic mistake is building the arena far too large.
- `FIRE_RATE_RPS` with `DAMAGE_TORSO` — a 5-shot kill at 8 shots/s is a 0.5 s
  time-to-kill, which may be brutally fast in practice.
- `INTERPOLATION_DELAY` — trades smoothness against how stale remote players look.

### Q-004 — Do bots get built?

**Blocks:** nothing. **Severity:** medium for the portfolio goal.

A visitor who arrives when nobody is online currently gets an empty arena. Simple bots
would fix the worst failure mode of a multiplayer portfolio demo. Currently `DEFERRED`
([09-out-of-scope.md](09-out-of-scope.md)). Worth revisiting after M5, alongside Q-001.

### Q-009 — Repository settings do not enforce the branching model

**Blocks:** nothing technically. **Severity:** medium — the stated process is currently
unenforced.

[CONTRIBUTING.md](../CONTRIBUTING.md) states that `main` is protected and that PRs are
**squash merged**. Neither is true of the repository as configured:

- **Branch protection is not enabled.** Anything can be pushed straight to `main`, and the
  `verify` job is not a required status check. GitHub Flow's only safety net is the CI
  gate, so without this the model is a convention rather than a rule.
- **Squash merge is not enforced.** PR #1 landed as a merge commit
  (`5ee7eda Merge pull request #1`), not a squash. This matters beyond tidiness: squash
  merging is what makes the commit body the permanent record of which requirement IDs a
  change implements, which is the whole traceability mechanism described in
  [CONTRIBUTING.md](../CONTRIBUTING.md#reference-requirement-ids).

Two things to decide:

1. Enable branch protection on `main` requiring a PR and the `verify` check. Note this also
   blocks the repository owner from pushing directly unless an administrator exception is
   configured.
2. Either configure the repository to allow squash merging only, or amend
   [CONTRIBUTING.md](../CONTRIBUTING.md) to accept merge commits. **The documentation and
   the repository settings must agree** — right now they do not.
