# TRACE — Instructions for AI Assistants

You are working on a project that uses TRACE (Trusted Registry for Artifact Consistency and Evolution).

## Before Making Any Changes

1. Read `.trace/TRACE_STATE.yaml` to understand current project state.
2. Read `.trace/HANDOFF.md` for context from the last session.
3. Read `trace.yaml` to understand the project's anchors, verification tiers, and thresholds.
4. If `.trace/LIVE_CHECKPOINT.yaml` exists, a previous session crashed — review it before starting.

## During Changes

- **Never modify an anchor file without checking all its consumers.** Anchors and consumers are listed in `trace.yaml` under `anchors:`.
- **Fix root causes, not symptoms.** When you find a bug, identify which anchor or consumer drifted and fix it at the source.
- **Follow the execution contract** for the type of change (feature, bugfix, hotfix, refactor) defined in `trace.yaml` under `contracts:`.
- **Respect thresholds.** Check `trace.yaml` under `thresholds:` for file size and complexity limits.
- **Never remove a test without adding a replacement.** Test counts are monotonic.

## After Changes

- Update all consumer files if you modified an anchor.
- Update documentation in the registry if behavior changed.
- Ensure the code review checklist items in `trace.yaml` are satisfied.
- Update `.trace/HANDOFF.md` with what you did and what comes next.
- Append a session entry to `.trace/PROJECT_LOG.md`.
- Update `.trace/TRACE_STATE.yaml` with current status.

## Key Principle

You have no memory between sessions. The `.trace/` directory IS your memory. Keep it accurate, and the next contributor (human or AI) can pick up exactly where you left off.
