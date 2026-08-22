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
**Blocks:** M3 playtesting. **Severity:** low — the values only need to be *close*.

Every number in [07-constants.md](07-constants.md) marked PROPOSED is an educated guess.
They cannot be validated without playing. Most likely to be wrong:

- `GRAVITY` / `JUMP_VELOCITY` — jump feel is very sensitive to these.
- `ARENA_SIZE` — the classic mistake is building the arena far too large.
- `FIRE_RATE_RPS` with `DAMAGE_TORSO` — a 5-shot kill at 8 shots/s is a 0.5 s
  time-to-kill, which may be brutally fast in practice.
- `INTERPOLATION_DELAY` — trades smoothness against how stale remote players look.

### Q-003 — Crosshair-to-ray alignment
**Blocks:** M2. **Severity:** medium — it is a real gameplay bug if handled badly.

The camera is offset from the character (`CAMERA_OFFSET`), so the ray from the player's eye
and the ray through the screen centre are not the same line. Three approaches:

1. Cast from the camera through the crosshair, then use that point as the aim target for a
   ray originating at the player's eye. Standard, and what most third-person shooters do.
2. Cast straight from the eye along the camera's forward direction. Simplest, but shots
   visibly miss what the crosshair covers at close range.
3. Offset the crosshair on screen to match the eye ray. Accurate, but looks wrong.

**Recommendation:** (1). Decide and record it as an ADR before writing the firing code —
this choice is very expensive to change afterwards.

### Q-004 — Do bots get built?
**Blocks:** nothing. **Severity:** medium for the portfolio goal.

A visitor who arrives when nobody is online currently gets an empty arena. Simple bots
would fix the worst failure mode of a multiplayer portfolio demo. Currently `DEFERRED`
([09-out-of-scope.md](09-out-of-scope.md)). Worth revisiting after M5, alongside Q-001.

### Q-005 — Does crouch-jump exist?
**Blocks:** M0. **Severity:** low, but it must be decided before movement is written.

`FR-GP-018` says crouching and jumping are mutually exclusive. Confirm this is intended —
crouch-jumping to reach higher ledges is a genre convention, and `FR-MAP-010` allows blocks
you can jump onto. If crouch-jump is desired, `FR-GP-018` must be amended before M0.

### Q-006 — What happens to a player idle in pointer-lock-released state?
**Blocks:** M3. **Severity:** low.

`FR-GP-021` keeps a player in the match and killable after they press `Esc`. Over a long
match this leaves a stationary free kill in the arena. Options: leave as-is; kick after N
seconds of no input; or hide them from scoring. Not urgent, but it will look bad in a demo.

### Q-007 — Sprint while crouched, and sprint direction
**Blocks:** M0. **Severity:** low.

`FR-GP-016` restricts sprint to "forward-dominant" movement without defining the threshold
(an angle from forward? a sign check on the forward input?). And sprint while crouched is
unspecified — presumably it should simply not apply. Pin both down in the shared movement
module and record the rule.
