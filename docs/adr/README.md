# Architecture Decision Records

**Product** decisions — what the game does — live in
[`requirements/10-decision-log.md`](../../requirements/10-decision-log.md).

**Technical** decisions — how it is built — live here, one file per decision:

```
NNNN-short-kebab-title.md
```

Numbers are sequential and never reused. A superseded ADR is not deleted or edited; its
status becomes `Superseded by ADR-NNNN` and the new one links back.

## When to write one

When the decision is **expensive to reverse**. If you could change your mind next week for
free, it is not an ADR.

Concretely, in this project: anything touching the shared simulation, the wire protocol,
the authority model, or the coordinate/aim conventions.

## Waiting to be written

Every open question in
[`requirements/11-open-questions.md`](../../requirements/11-open-questions.md) is an ADR
waiting to happen. The urgent one is **Q-003 — crosshair ray alignment**, which must be
decided before firing code is written in M2, not after.

## Index

| ADR                                       | Title                     | Status   |
| ----------------------------------------- | ------------------------- | -------- |
| [0001](0001-github-flow-over-git-flow.md) | GitHub Flow over Git Flow | Accepted |
