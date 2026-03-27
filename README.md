# TRACE - Structural Coherence Engineering

[![npm version](https://img.shields.io/npm/v/trace-coherence.svg)](https://www.npmjs.com/package/trace-coherence)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/trace-coherence.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-52%2F52-brightgreen.svg)](https://github.com/anuraj/trace-coherence)

**Your AI writes great code. TRACE keeps it coherent.**

When AI tools help you build software, files drift out of sync across sessions. An anchor changes but its consumers don't. Docs fall behind. Complexity creeps in. Nobody notices until production breaks.

TRACE enforces structural integrity automatically - so you ship with confidence, not crossed fingers.

## Install

```bash
npm install -g trace-coherence
```

## Quick Start

**New project:**
```bash
trace init           # Scaffolds trace.yaml + .trace/ directory
trace gate start     # Begin session
# ... code ...
trace gate end       # Validates everything before you close
```

**Existing project:**
```bash
trace scan           # Auto-detects anchors, consumers, tests, quality tools
# Review trace.yaml, adjust if needed
trace gate start     # Begin session (warn mode — gradual adoption)
```

## Five Pillars

| Pillar | What it checks |
|--------|---------------|
| **T**ruth Anchoring | Every concept has one authoritative source. Change the anchor, all consumers must update. |
| **R**egistry Enforcement | Documentation is a verified artifact, not an afterthought. |
| **A**utomated Verification | Tiered testing that grows. Tests never shrink. |
| **C**ontrolled Evolution | Complexity thresholds, auto-calibrated to your project. |
| **E**xecution Contracts | Every change type has preconditions and postconditions. |

## All Commands (22)

### Onboarding
| Command | What it does |
|---------|-------------|
| `trace init` | New project - full enforcement from day one |
| `trace scan` | Existing project - auto-detection + baseline + quality tool detection |

### Daily Workflow
| Command | What it does |
|---------|-------------|
| `trace gate start` | Session start + integrity check + config validation + AI context |
| `trace gate end` | Session end + quality tools + consumer sync + planning + metrics |
| `trace checkpoint` | Crash recovery + auto-observation (git diff) + context refresh |
| `trace override "reason"` | Emergency bypass with tracked debt |

### Coherence
| Command | What it does |
|---------|-------------|
| `trace check` | Full 5-pillar coherence validation |
| `trace status` | Quick health overview |
| `trace deps <id>` | Dependency graph + transitive impact analysis |
| `trace impact <id>` | Pre-work blast radius + consumer sync snapshot |
| `trace search "query"` | Full-text search across all TRACE artifacts |

### Security
| Command | What it does |
|---------|-------------|
| `trace integrity` | SHA-256 tamper detection for TRACE files |

### Planning
| Command | What it does |
|---------|-------------|
| `trace plan` | Kanban-style backlog board (YAML) |
| `trace plan add "title"` | Add item with `--priority` and `--sprint` |
| `trace plan move ID status` | Move item between columns |
| `trace plan release v1.0.0` | Auto-generate release notes from completed items |

### CI/CD
| Command | What it does |
|---------|-------------|
| `trace ci` | PR-scoped analysis with `--json` and `--comment-file` |
| `trace metrics` | Outcome analysis + threshold calibration (one-way ratchet) |

### Maintenance
| Command | What it does |
|---------|-------------|
| `trace validate` | Check trace.yaml for errors, typos, and "did you mean?" suggestions |
| `trace upgrade` | Add missing config sections - schema migration without data loss |
| `trace watch` | Monitor files + auto-session when AI skips gates |
| `trace hook install` | Install pre-commit hook (blocks incoherent commits) |
| `trace hook uninstall` | Remove pre-commit hook |
| `trace hook status` | Check if hook is installed |

### MCP Server (AI Integration)

| Command | Description |
|---|---|
| `trace mcp` | Start MCP server (AI tools call TRACE automatically) |
| `trace mcp setup` | Show configuration for Claude Code, Cursor, Kiro |
| `trace-mcp` | Binary entry point for MCP server (used in config) |

The MCP server makes TRACE **autonomous**. Instead of running commands manually, your AI tool calls TRACE functions automatically:
- `trace_context` — reads project state before coding
- `trace_impact` — checks blast radius before modifying files
- `trace_check` — validates coherence after changes
- `trace_deps_check` — checks dependency policy before adding packages
- `trace_log` — records session activity to PROJECT_LOG

**Setup (Claude Code):**
```json
// Add to ~/.claude.json or .claude.json
{
  "mcpServers": {
    "trace": {
      "command": "trace-mcp"
    }
  }
}
```
| `trace license` | Scan dependencies for license compliance |

## Key Features

### Anchor Impact Protocol
```bash
trace impact user_model    # See blast radius before coding
# ... make changes ...
trace gate end             # Blocks if any consumer is stale
```

### Quality Integration
```yaml
# trace.yaml — auto-detected by trace scan
quality:
  checks:
    - name: "Lint"
      command: "npm run lint"
      on_fail: "warn"
    - name: "Type check"
      command: "npx tsc --noEmit"
      on_fail: "block"
```

### Config Validation
```bash
trace validate    # Catches typos, missing fields, invalid values
# Unknown field "anchrs" — did you mean "anchors"?
# gates.start.on_fail must be "block" or "warn", got "crash"
```

### Schema Migration
```bash
trace upgrade     # Adds quality, code_review, contracts... whatever is missing
# + quality — Quality checks section
# + code_review — Code review checklist
# Original config preserved, new sections appended
```

### File Watcher
```bash
trace watch       # Monitors anchors + consumers
# [14:23:05] ✓ src/models/user.ts (anchor: user_model) — 142 lines OK
# [14:23:05]   ⚠ Anchor modified — 6 consumer(s) may need updating
```

### CI/CD with PR Comments
```yaml
# .github/workflows/trace.yml
- run: trace ci --json --comment-file /tmp/trace-comment.md
```

### Outcome-Based Calibration
```bash
trace metrics     # After 5+ sessions
# ▸ thresholds.max_file_lines
#   Current: 400 → Suggested: 340
#   93% pass rate over 12 sessions — threshold can be tightened
```

## Two Tracks

**Track 1: New projects** (`trace init`) - Full enforcement. Gates default to "block."

**Track 2: Existing projects** (`trace scan`) - Auto-detects everything. Creates a baseline. Gates default to "warn." New code is enforced; old files come into compliance gradually. No retrofit moment.

## Stats

- **5842 lines** across **21 source files**
- **28 commands** covering the full development lifecycle
- **52 tests** with zero-dependency test runner
- **1 dependency** (`yaml`)
- **Language-agnostic** — TypeScript, JavaScript, Python, Go, Java, and more
- **Tool-agnostic** — Claude, Copilot, Cursor, ChatGPT, or any AI tool
- **CI-agnostic** — GitHub Actions, GitLab CI, or any CI system

## License

MIT 
