# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) | [Semantic Versioning](https://semver.org/)

## [1.0.0] - 2026-03-15

### Added — 22 CLI commands across 18 source files (4,379 lines)

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
- 37 tests covering all commands, edge cases, config validation, schema migration, and error handling
- Zero-dependency test runner

**License Compliance**
- `trace license` — Scans dependencies for license incompatibilities. Detects project license from package.json/LICENSE file. Checks Node.js, Python, and Go deps against a compatibility matrix. Flags GPL/AGPL in permissive projects, unknown licenses for review.
