# TRACE Coherence Check — GitHub Action

Run TRACE structural coherence verification on every pull request. Catches anchor-consumer drift, complexity violations, shrinking tests, and dependency policy violations.

## Quick Start

```yaml
# .github/workflows/trace.yml
name: TRACE Coherence Check
on: [pull_request]

jobs:
  coherence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anurajsl/trace@main
```

## With PR Comments

```yaml
      - uses: anurajsl/trace@main
        with:
          comment: 'true'
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `mode` | `ci` | `ci` for PR-scoped, `check` for full project |
| `json` | `true` | Output JSON results |
| `comment` | `false` | Post results as PR comment |
| `node-version` | `18` | Node.js version |

## Outputs

| Output | Description |
|---|---|
| `status` | Check result: `pass` or `block` |
| `report` | Path to generated report file |

## What It Catches

- Anchor-consumer drift (modified source of truth, stale dependents)
- New complexity violations (files exceeding thresholds)
- Shrinking test counts
- Dependency policy violations
- Overdue TRACE debt

## Requirements

Your repo must have a `trace.yaml` file. Run `trace scan` locally first to generate it.
