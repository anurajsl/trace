# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) | [Semantic Versioning](https://semver.org/)

## [1.0.0] - 2026-03-15

### Added — 31 CLI commands across 21 source files (5842 lines)

**Onboarding**
- `trace init` — New project scaffolding with full enforcement
- `trace scan` — Existing project onboarding with 4-phase auto-detection and baseline

**Coherence**
- `trace check` — Full 5-pillar coherence validation
- `trace status` — Quick health overview
- `trace deps` / `trace deps <id>` — Dependency graph with transitive impact analysis
- `trace impact <anchor_id>` — Pre-work blast radius with consumer sync verification at gate end
- `trace search "query"` — Full-text search across all TRACE artifacts

**Session Management**
- `trace gate start` — Preconditions, integrity verification, config validation, AI context generation
- `trace gate end` — 5-pillar check, quality tools, consumer sync, planning reconciliation, metrics
- `trace checkpoint` — Crash recovery with auto-observation and dynamic context refresh
- `trace override` — Emergency bypass with tracked debt

**Security**
- `trace integrity` — SHA-256 tamper detection, verified at gate start, regenerated at gate end

**Planning**
- `trace plan` — Kanban-style backlog board in YAML
- `trace plan add` / `trace plan move` — CLI-driven item management
- `trace plan release` — Auto-generate release notes from completed items

**CI/CD**
- `trace ci` — PR-scoped analysis with JSON output and GitHub PR commenting
- `trace metrics` — Outcome-based threshold calibration (one-way ratchet, suggestion only)

**Quality Integration**
- Gate end runs project's lint/typecheck/format tools from trace.yaml quality.checks
- `trace scan` auto-detects ESLint, Biome, Prettier, tsc, Ruff, Flake8, mypy, Black, go vet

**Maintenance**
- `trace validate` — Config validation with typo detection ("did you mean?"), type checking, and clear error messages
- `trace upgrade` — Schema migration that adds missing sections with sensible defaults, never removes existing config
- `trace watch` — File watcher that monitors anchors and consumers, runs checks on save

**Testing**
- 69 tests covering all commands, edge cases, config validation, schema migration, and error handling
- Zero-dependency test runner

**License Compliance**
- `trace license` — Scans dependencies for license incompatibilities. Detects project license from package.json/LICENSE file. Checks Node.js, Python, and Go deps against a compatibility matrix. Flags GPL/AGPL in permissive projects, unknown licenses for review.

**AI Process Enforcement (v1.0.0 addition)**
- AI_INSTRUCTIONS.md template now includes mandatory gate statement rules
- `trace hook install` / `trace hook uninstall` / `trace hook status` — Git pre-commit hook that blocks incoherent commits
- `trace watch` upgraded with auto-session mode: detects ungated file changes, auto-opens lightweight sessions, logs to PROJECT_LOG and HANDOFF, flags consumer drift. Closes after 5min inactivity.
- `trace watch --no-auto-session` for warnings-only mode
- `trace watch --timeout <min>` for custom inactivity timeout

Three-layer defense against AI ceremony skipping:
  Layer 1: AI_INSTRUCTIONS.md tells AI to follow gates (behavioral nudge)
  Layer 2: trace watch auto-session captures changes even when AI skips gates (passive operator)
  Layer 3: Pre-commit hook blocks incoherent commits (hard enforcement)

**Dependency Governance (v1.0.1)**
- `trace deps audit` command — checks all packages against configurable policy rules
- Three policy modes: strict (allowlist only), moderate (rule-based), permissive (flag only)
- Blocked package detection with glob patterns
- License compliance (allowed/blocked license lists)
- Staleness detection (flag packages without recent updates)
- Pre-1.0 version warnings
- npm audit integration at gate end
- `dependencies:` section added to trace.yaml template
- Supports npm, pip, and cargo projects

**MCP Server — Autonomous AI Integration (v1.0.1)**
- `trace mcp` — Start MCP server for AI tool integration
- `trace mcp setup` — Show configuration for Claude Code, Cursor, Kiro
- `trace-mcp` binary entry point for MCP client configuration
- 6 MCP tools: trace_context, trace_impact, trace_check, trace_status, trace_deps_check, trace_log
- JSON-RPC 2.0 over stdio (standard MCP protocol)
- No additional dependencies — implements protocol directly using Node.js core
- AI tools now call TRACE automatically: check impact before modifying files, validate coherence after changes, check dependency policy before adding packages
- Shifts TRACE from reactive (catches problems after) to proactive (prevents problems during)

**Token Optimization (v1.0.1)**
- Handoff truncation: AI context includes only last 3 session entries instead of full history
- Smart context deduplication: MCP trace_context returns brief summary when AI_CONTEXT.md is fresh (<30min)
- Brief check mode: trace_check returns one-line result when coherent, full details only on failures
- Scoped context: `trace gate start --scope <name>` and MCP `trace_context({scope: "name"})` filter anchors by scope
- Scopes defined in trace.yaml under `scopes:` section
- Estimated 55-60% reduction in token overhead per session

**Organization Governance (v1.0.2)**
- `policies:` section in trace.yaml — data, compliance, and workflow rules injected into AI context
- Org config inheritance — `~/.trace/org-config.yaml` provides org-wide defaults for all projects
- Config merging: policies combine (org + project), dependencies merge blocked lists, thresholds use project override
- `trace metrics --json` — machine-readable report for dashboards and org-wide aggregation
- Org config template included in templates/org-config.yaml
- 4 new tests (69 total)

**Automation & GitHub Action (v1.0.3)**
- `trace activate` — installs pre-commit, post-commit, and post-checkout hooks in one command
- `trace activate status` — shows which hooks are active
- `trace deactivate` — removes all TRACE hooks
- Post-commit hook: regenerates AI context + logs commit to PROJECT_LOG
- Post-checkout hook: regenerates AI context when switching branches
- `--quiet` flag for gate start (used by automated hooks)
- GitHub Action (action/action.yml): one-line CI integration with PR comment support
- 4 new tests (69 total)

**Smart Insights (v1.0.3)**
- Coherence Score (0-100) — shown in status, check, metrics, MCP, and JSON output
- Auto-anchor discovery — suggests unregistered files with 3+ importers
- Dead consumer detection — flags stale consumer relationships
- Session diff summary — shows anchors/consumers/score at gate end
- Complexity trends — warns when anchor files approach threshold
- Git co-change analysis — detects files that change together in scan
- 4 new tests (69 total)

**Review Feedback (v1.0.3)**
- `trace acknowledge` command — mark specific drift as intentional to prevent alert fatigue
- `trace acknowledge --list` / `trace acknowledge --remove <idx>` — manage acknowledged drift
- Acknowledged drift filtered from consumer sync in gate end and trace check
- `planning.enabled: false` config toggle — skip plan checks for teams using Jira/Linear
- .trace/ACKNOWLEDGED_DRIFT.yaml stores acknowledged entries
- 5 new tests (69 total)
