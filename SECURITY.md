# Security Policy

## Overview

TRACE (Trusted Registry for Artifact Consistency and Evolution) is a CLI tool that enforces structural coherence in software projects. This document describes TRACE's security posture for enterprise procurement and compliance review.

## Data Processing

### What TRACE processes
- Source code file paths and line counts
- YAML configuration files (trace.yaml, PLAN.yaml, DEBT.yaml, etc.)
- Markdown documentation files
- Git diff output (for auto-observation and CI analysis)

### What TRACE does NOT process
- Personal data (PII) of any kind
- Customer data or user databases
- Authentication credentials or API keys
- Network traffic or external APIs
- Telemetry, analytics, or usage data

### Data storage
- All TRACE files are stored locally in the project repository (`.trace/` directory)
- No data is transmitted externally
- No cloud services, databases, or external storage are used
- No data persists outside the project directory

## Network Activity

**TRACE makes zero network calls.** The CLI runs entirely offline. The only network activity occurs during installation (`npm install`) which downloads the `yaml` package from the npm registry.

## Dependencies

| Dependency | Purpose | License |
|-----------|---------|---------|
| `yaml` (v2.x) | Parse and write YAML files | ISC |

One runtime dependency. No transitive dependencies with known vulnerabilities.

## Supply Chain Security

- The npm package is published with `--provenance` flag for cryptographic attestation
- SHA-256 integrity checksums are generated for TRACE's own configuration files
- The `trace integrity` command verifies file tampering at session boundaries
- Source code is available on GitHub under MIT license

## Compliance Posture

### GDPR
TRACE does not process personal data of any kind. No data subject rights apply because no data subjects are involved. TRACE processes only source code structure metadata.

### SOC 2
- **Confidentiality**: All data remains local. No external transmission.
- **Availability**: CLI tool with no server component. No uptime concerns.
- **Processing integrity**: SHA-256 checksums verify file integrity. 45 automated tests validate correctness.
- **Privacy**: No personal information is collected, stored, or processed.

### ISO 27001
- **Access control**: TRACE respects file system permissions. CODEOWNERS integration recommended for `.trace/` directory.
- **Cryptography**: SHA-256 used for integrity verification (not encryption — TRACE files are plaintext).
- **Operations security**: `trace validate` checks configuration correctness. `trace integrity` detects unauthorized modifications.

### HIPAA
Not applicable. TRACE does not process, store, or transmit protected health information.

### PCI DSS
Not applicable. TRACE does not process, store, or transmit payment card data.

## Threat Model

### Protected against
- **Configuration tampering**: SHA-256 integrity checksums detect unauthorized modification of TRACE files. Start gate blocks sessions when tampering is detected.
- **Consumer drift**: Anchor Impact Protocol verifies all consumers are updated when an anchor changes.
- **Unauthorized gate bypass**: Override creates tracked debt with resolution deadlines. Debt limit (5) prevents accumulation.
- **Silent regressions**: 5-pillar coherence validation catches structural inconsistencies.

### Not in scope
- **Source code vulnerabilities**: TRACE checks structure, not security. Use dedicated SAST tools (Snyk, CodeQL, Semgrep) for vulnerability scanning.
- **Secrets in code**: TRACE does not scan for hardcoded credentials. Use tools like GitLeaks or TruffleHog.
- **Runtime security**: TRACE is a development-time tool. It does not run in production environments.

## Best Practices for Enterprise Use

1. **CODEOWNERS**: Require review for changes to `trace.yaml` and `.trace/` directory
2. **CI enforcement**: Run `trace ci` in your CI pipeline — the CI is the trust boundary
3. **No PII in TRACE files**: Do not put real personal data in PLAN.yaml notes, PROJECT_LOG entries, or test descriptions
4. **Git history**: TRACE files are committed to git. Ensure your git hosting has appropriate access controls
5. **Branch protection**: Protect main/develop branches to prevent direct pushes that bypass TRACE gates

## Vulnerability Reporting

If you discover a security issue, please report it privately:

- **Email**: [security contact]
- **GitHub**: Open a security advisory at https://github.com/anuraj/trace-coherence/security/advisories

Please do not open public issues for security vulnerabilities.

## License

MIT License — see [LICENSE](LICENSE) for full terms.
