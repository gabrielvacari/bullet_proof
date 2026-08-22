# ADR-0001 — GitHub Flow over Git Flow

**Status:** Accepted
**Date:** 2026-08-22
**Relates to:** CONTRIBUTING.md

## Context

The project needs a branching model. Git Flow was the initial preference.

Git Flow was designed for software with multiple released versions supported in parallel —
where a `release/*` branch stabilises version N while `develop` moves toward N+1, and
`hotfix/*` patches production without disturbing either. Its own author published a note in
2020 stating it is a poor fit for continuously delivered software.

This project has one developer, one environment, no released version to support, and no
scenario where two versions are in flight at once.

## Options considered

### Option A — Full Git Flow

`main` + `develop` + `feature/*` + `release/*` + `hotfix/*`.

Cost: two permanently divergent long-lived branches, and a ceremonial `release/*` merge per
milestone that protects against nothing, because there is no production version to protect.

Benefit: demonstrates familiarity with the model on a portfolio repository.

### Option B — GitHub Flow

`main` protected, short-lived `feature/*` branches, PR, squash merge.

Cost: no separation between "stable" and "in progress" beyond `main` itself — which means
`main` must genuinely stay green, enforced by CI.

Benefit: linear readable history; CI gate on every change; no branch bookkeeping.

### Option C — Simplified Git Flow

`main` + `develop` + `feature/*`, without `release/*` and `hotfix/*`.

Middle ground, but `develop` still duplicates what a protected `main` plus CI already
provides.

## Decision

**Option B — GitHub Flow.** Milestones are annotated tags on `main` (`v0.1.0` … `v1.0.0`)
rather than release branches.

The portfolio argument for Option A is real but weak: a reader who inspects the branching
model will be better impressed by a green protected `main` with a clean squash-merge
history and enforced Conventional Commits than by unused `release/*` branches.

## Consequences

- `main` must always be deployable, which makes CI a hard requirement rather than a nicety.
  Branch protection must require the `verify` job.
- Squash merge means individual work-in-progress commits are lost. Commit bodies must
  therefore carry the requirement IDs (`Implements: FR-GP-026`), because the squashed
  message becomes the only permanent record.
- No `develop` branch exists to stage risky work. Anything large must be broken into
  independently shippable PRs — which aligns with the milestone structure in
  `requirements/08-roadmap.md`.
- If the project ever needs to support a deployed version while developing the next, this
  decision must be revisited.
