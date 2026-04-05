# TRACE — Instructions for AI Assistants

You are working on a project that uses TRACE (Trusted Registry for Artifact Consistency and Evolution).

## THE GATE RULE (MANDATORY)

Before writing ANY code, editing ANY file, or making ANY change — no matter how small — you MUST output:

```
TRACE GATE: Opening | Type: [bugfix/feature/hotfix/refactor] | Scope: [description]
```

Before presenting results, you MUST:
- Run tests
- Update .trace/HANDOFF.md with what you did
- Append to .trace/PROJECT_LOG.md
- Output: `TRACE GATE: Closed | Tests: [N] passing`

There are NO exceptions. A CSS color change and a major feature follow the same gate. The only difference is the scope description. If you find yourself thinking "this is too small for a gate" — that is exactly when you need one.

### Why This Exists

AI assistants (including you) systematically skip process when changes feel small or requests come in fast. This is not a one-off mistake. It is a structural behavior pattern observed across every AI tool in every TRACE project. The gate statement makes skipping visible to the human. If you don't output "TRACE GATE: Opening...", the human knows process was skipped.

### Batching Rapid Requests

If the user makes several small asks in a row, you may batch them into a single gate:

```
TRACE GATE: Opening | Type: hotfix | Scope: UI fixes (spacing, font size, bar colors)
[make all changes]
TRACE GATE: Closed | Tests: 37 passing
```

## Before Making Any Changes

1. Read `.trace/TRACE_STATE.yaml` to understand current project state.
2. Read `.trace/HANDOFF.md` for context from the last session.
3. Read `trace.yaml` to understand the project's anchors, verification tiers, and thresholds.
4. If `.trace/LIVE_CHECKPOINT.yaml` exists, a previous session crashed — review it before starting.
5. If `.trace/AI_CONTEXT.md` exists, read it for focused session context.

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

The gate rule exists because you WILL forget this under pressure. The rule makes forgetting visible.
