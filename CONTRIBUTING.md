# Contributing to TRACE

Thank you for considering a contribution to TRACE. This document explains how to get started.

## Development Setup

```bash
git clone https://github.com/anuraj/trace-coherence.git
cd trace-coherence
npm install
npm test    # 45 tests should pass
```

## Running Tests

```bash
npm test                     # Run all 45 tests
node tests/test-all.js       # Same thing, directly
```

Tests create temporary directories, run CLI commands, verify output and side effects, then clean up. No external services or databases required.

## Project Structure

```
trace-coherence/
├── bin/trace.js          # CLI entry point and command router
├── src/
│   ├── check.js          # 5-pillar coherence validation
│   ├── checkpoint.js     # Mid-session recovery + auto-observation
│   ├── ci.js             # PR-scoped analysis + GitHub PR comments
│   ├── deps.js           # Dependency graph + transitive impact
│   ├── gate.js           # Session gates (start/end) with all checks
│   ├── impact.js         # Anchor Impact Protocol + consumer sync
│   ├── init.js           # New project scaffolding
│   ├── integrity.js      # SHA-256 tamper detection
│   ├── license.js        # Dependency license compliance
│   ├── metrics.js        # Outcome tracking + threshold calibration
│   ├── observe.js        # Auto-observation + search + AI context
│   ├── plan.js           # Kanban backlog + release notes
│   ├── scan.js           # Existing project onboarding
│   ├── status.js         # Quick health overview
│   ├── upgrade.js        # Schema migration
│   ├── utils.js          # Shared utilities
│   ├── validate.js       # Config validation
│   └── watch.js          # File watcher
├── templates/            # 11 templates for init/scan
├── tests/test-all.js     # Test suite (45 tests)
├── CHANGELOG.md
├── SECURITY.md
├── LICENSE               # MIT
└── package.json
```

## Contribution Guidelines

### Before you start
1. Check existing issues to avoid duplicate work
2. For large changes, open an issue first to discuss the approach

### Making changes
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Add or update tests (every new command needs at least 2 tests)
5. Run `npm test` — all tests must pass
6. Update CHANGELOG.md with your changes
7. Submit a pull request

### Code style
- No external linting tool — keep it consistent with existing code
- Use `printPass`, `printFail`, `printWarn`, `printInfo` from utils.js for terminal output
- Every command must handle missing `trace.yaml` gracefully (check `findProjectRoot()`)
- Wrap non-critical features in try/catch — a search failure shouldn't crash a gate check
- Use dynamic `import()` for cross-module dependencies to keep startup fast

### Test requirements
- New commands: at least 2 tests (happy path + error case)
- New config fields: validate.js must check them
- New .trace/ files: init.js and upgrade.js must create them

### What makes a good contribution
- Bug fixes with a failing test that reproduces the issue
- New language support in scan.js quality detection (e.g., Rust, Ruby)
- Performance improvements (scan.js on large codebases)
- Documentation improvements
- New CI integration templates (GitLab CI, CircleCI, etc.)

### What we probably won't accept
- AI/ML dependencies (TRACE stays zero-infrastructure)
- Features that require network calls or external services
- Changes that break the single-dependency promise
- Features that auto-modify trace.yaml without user review
