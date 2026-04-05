# Contributing to TRACE

## What TRACE Is

TRACE is a CLI tool that enforces structural coherence in AI-augmented software projects. It tracks which files are sources of truth (anchors), which files depend on them (consumers), and whether everything stays in sync across development sessions.

It is a verification and enforcement tool. It does not write code, generate suggestions, or interact with AI APIs.

## What TRACE Is Not

**Not a linter.** Linters check syntax and style. TRACE checks whether your changes are structurally complete (did you update every file that depends on what you changed?).

**Not an AI tool.** TRACE does not call any AI API, does not use machine learning, and does not generate code. It works alongside AI tools by providing the structural memory that AI can't maintain.

**Not a test runner.** TRACE orchestrates your existing test tools (Jest, pytest, cargo test) but does not run its own assertions against your code.

**Not a dependency manager.** TRACE audits dependencies against policy rules but does not install, update, or resolve packages. That's npm/pip/cargo's job.

**Not a replacement for git.** TRACE uses git for diff detection and crash recovery but does not manage branches, merges, or commits.

## Architecture Overview

```
trace-cli/
  bin/trace.js          CLI router (all commands dispatched here)
  bin/trace-mcp.js       MCP server entry point
  src/
    check.js            5-pillar coherence validation
    checkpoint.js       Crash recovery via git diff
    ci.js               PR-scoped analysis for CI/CD
    deps.js             Anchor dependency graph
    deps-audit.js       Dependency governance engine
    gate.js             Session boundary enforcement (start/end)
    hook.js             Git pre-commit hook management
    impact.js           Blast radius analysis
    init.js             New project scaffolding
    integrity.js        SHA-256 tamper detection
    license.js          License compliance scanning
    metrics.js          Outcome analysis + threshold calibration
    observe.js          Auto-observation via git diff
    plan.js             YAML Kanban board
    scan.js             Existing project onboarding
    status.js           Quick health overview
    upgrade.js          Schema migration
    utils.js            Shared helpers (colors, YAML, file ops)
    validate.js         Config validation with typo detection
    watch.js            File watcher + auto-session mode
    mcp-server.js       MCP server for AI tool integration
  templates/            Template files for trace init
  tests/test-all.js     All tests (single file, zero dependencies)
```

## Design Principles

**One dependency.** TRACE depends only on `yaml` for parsing. Everything else uses Node.js core. Do not add dependencies. If you need functionality, implement it.

**No network calls.** TRACE runs entirely offline. No telemetry, no analytics, no API calls. Do not add any network functionality.

**Zero config to start.** `trace scan` should get a project 80-90% configured with no manual input. `trace init` should produce a working trace.yaml with sensible defaults.

**Orchestrate, don't rebuild.** TRACE runs your lint, your tests, your type checker. It doesn't implement its own versions of these. The `quality.checks` and `dependencies.audit` patterns should always shell out to existing tools.

**Minimize token overhead.** AI tools read TRACE context every session. Keep output concise. Use brief mode for passing checks. Support scoped context. Every unnecessary line costs tokens across every session for every user.

**Gate everything.** Every verification should be reachable through `trace gate end` or `trace check`. Standalone commands (like `trace deps audit`) should also be callable independently, but they must integrate into the gate flow.

**Fail loud, fail early.** If something is wrong, print it clearly with file names and line numbers. Don't swallow errors. Don't print "something went wrong" without details.

## How to Contribute

### Setup

```bash
git clone https://github.com/anurajsl/trace.git
cd trace
npm install
npm test    # 69 tests should pass
```

### Making Changes

1. Create a branch: `git checkout -b feature/your-feature`
2. Make your changes in `src/`
3. Add tests in `tests/test-all.js`
4. Run `npm test` and verify all tests pass
5. Update help text in `bin/trace.js` if adding commands
  bin/trace-mcp.js       MCP server entry point
6. Submit a PR with a clear description of what and why

### Testing

Tests are in a single file (`tests/test-all.js`) with zero test framework dependencies. Each test creates a temp directory, runs TRACE commands, asserts output, and cleans up.

```bash
npm test                     # Run all 69 tests
node tests/test-all.js       # Same thing
```

To add a test:

```javascript
test('trace yourcommand does something', () => {
  const dir = setupTempProject('your-test-name');
  try {
    run(`echo "Test" | node ${CLI} init`, { cwd: dir });
    // ... setup ...
    const out = run(`node ${CLI} yourcommand 2>&1`, { cwd: dir });
    assert(out.includes('expected'), 'Description of what should happen');
  } finally { cleanup(dir); }
});
```

### Code Style

No formatter enforced. Just be consistent with what's there:
- 2-space indentation
- Single quotes for strings
- ES modules (import/export)
- JSDoc comments on exported functions
- Use `printPass`, `printFail`, `printWarn`, `printInfo` from utils.js for output

### What Makes a Good PR

- Solves a real problem someone has reported or experienced
- Includes tests
- Doesn't add dependencies
- Doesn't add network calls
- Updates help text if adding/changing commands
- Doesn't break existing tests

### What Will Get Rejected

- PRs that add npm dependencies (propose an alternative using Node.js core)
- PRs that add telemetry, analytics, or network calls
- PRs that change the output format of existing commands without backwards compatibility
- PRs without tests
- PRs that "improve" things nobody asked to improve (open an issue first)

## Reporting Issues

Open a GitHub issue with:
1. What you expected to happen
2. What actually happened
3. Your Node.js version (`node --version`)
4. Your OS
5. The output of `trace --version`
6. Relevant trace.yaml sections (redact sensitive file paths)

## Questions

Open a GitHub Discussion or issue. There's no Discord, Slack, or mailing list. Everything happens on GitHub.
