# Architecture Decision Records

One file per decision:

```
NNNN-short-kebab-title.md
```

Numbers are sequential and never reused. The unnumbered `template.md` is the starting
point. A superseded ADR is never deleted or rewritten: its status becomes
`Superseded by ADR-NNNN`, and the new one links back.

## What an ADR is for

**Significant decisions about how the system is built** — ones that shape the architecture,
are expensive to reverse, and where a future reader would otherwise ask "why on earth is it
like this?"

Concretely, in this project: the shared simulation, the wire protocol, the authority model,
coordinate and aim conventions, collision representation, and the rendering approach.

## What an ADR is not for

**Process and project mechanics.** Branching model, commit conventions, tooling, CI, code
style. Those are rules, not open questions — they live in
[CONTRIBUTING.md](../../CONTRIBUTING.md) as things you follow, not decisions you relitigate.

**Anything with a requirement ID.** `NFR-003` (one shared deterministic simulation) is a
significant technical decision, but it already has an ID and a rationale in
[`requirements/`](../../requirements/README.md). It stays there. Copying it into an ADR
would create a second source that drifts from the first.

So the test is two questions:

1. Does it shape the architecture, and would it be expensive to undo? If no, it is not an
   ADR.
2. Does it already have a requirement ID? If yes, it belongs in `requirements/`.

## Waiting to be written

Candidates are in
[`requirements/11-open-questions.md`](../../requirements/11-open-questions.md). Nothing is
currently urgent: the two decisions that blocked a milestone — how aim is represented, and where
the firing ray originates — are ADR-0001 and ADR-0002.

## Index

| ADR                                                               | Status   | Subject                                                                 |
| ----------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| [0001](0001-aim-enters-the-simulation-as-a-direction-vector.md)   | Accepted | Aim reaches the simulation as a direction vector, never an angle        |
| [0002](0002-the-firing-ray-runs-from-the-eye-to-the-aim-point.md) | Accepted | The firing ray runs from the eye to the aim point, not along the camera |
