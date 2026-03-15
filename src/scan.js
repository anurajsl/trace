import fs from 'fs';
import path from 'path';
import readline from 'readline';
import YAML from 'yaml';
import {
  c, printHeader, printPass, printWarn, printInfo,
  walkDir, countLines, getDateStamp
} from './utils.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

/**
 * trace scan — Analyzes an EXISTING codebase and generates trace.yaml
 * 
 * Strategy: "Clean as You Code" (borrowed from SonarQube's approach)
 * 1. Scan the project to understand its structure
 * 2. Auto-detect likely anchors (models, schemas, configs, types)
 * 3. Auto-detect consumers (files that import/reference anchors)
 * 4. Set a baseline date — TRACE only enforces on changes AFTER this date
 * 5. Generate trace.yaml with discovered structure
 * 6. Don't demand instant compliance; improve as you go
 */
export async function runScan() {
  printHeader('TRACE Scan — Existing Project Analysis');

  const projectDir = process.cwd();
  console.log(`  Scanning ${c.bold}${projectDir}${c.reset}\n`);

  // Check if trace.yaml already exists
  if (fs.existsSync(path.join(projectDir, 'trace.yaml'))) {
    console.log(`  ${c.yellow}trace.yaml already exists.${c.reset} Use ${c.cyan}trace check${c.reset} instead.`);
    console.log(`  ${c.dim}To re-scan, delete trace.yaml first.${c.reset}\n`);
    rl.close();
    return;
  }

  const projectName = await ask(`  Project name: `);

  // Phase 1: Scan file structure
  console.log(`\n  ${c.dim}Scanning file structure...${c.reset}`);
  const allFiles = walkDir(projectDir);
  const codeFiles = allFiles.filter(f => isCodeFile(f));
  const docFiles = allFiles.filter(f => isDocFile(f));
  const configFiles = allFiles.filter(f => isConfigFile(f));
  const testFiles = allFiles.filter(f => isTestFile(f));

  console.log(`  Found: ${c.bold}${codeFiles.length}${c.reset} code files, ${c.bold}${docFiles.length}${c.reset} doc files, ${c.bold}${testFiles.length}${c.reset} test files, ${c.bold}${configFiles.length}${c.reset} config files\n`);

  // Phase 2: Detect likely anchors
  console.log(`  ${c.dim}Detecting likely anchors...${c.reset}`);
  const anchorCandidates = detectAnchors(projectDir, codeFiles, configFiles);

  if (anchorCandidates.length > 0) {
    console.log(`\n  ${c.bold}Detected ${anchorCandidates.length} likely anchor(s):${c.reset}\n`);
    for (const a of anchorCandidates) {
      console.log(`    ${c.cyan}●${c.reset} ${c.bold}${a.id}${c.reset} → ${a.file}`);
      printInfo(`      Reason: ${a.reason}`);
      if (a.consumers.length > 0) {
        printInfo(`      Consumers: ${a.consumers.length} file(s) reference this`);
        for (const con of a.consumers.slice(0, 3)) {
          printInfo(`        → ${con}`);
        }
        if (a.consumers.length > 3) printInfo(`        ... and ${a.consumers.length - 3} more`);
      }
    }
  } else {
    console.log(`\n  ${c.yellow}No obvious anchors detected.${c.reset} You'll need to identify them manually.`);
    printInfo('  Look for: model definitions, schema files, shared types, config files');
  }

  // Phase 3: Analyze complexity
  console.log(`\n  ${c.dim}Analyzing complexity...${c.reset}`);
  const complexityReport = analyzeComplexity(projectDir, codeFiles);

  if (complexityReport.overThreshold.length > 0) {
    console.log(`\n  ${c.bold}Complexity warnings:${c.reset}`);
    for (const f of complexityReport.overThreshold.slice(0, 10)) {
      printWarn(`${f.file}: ${f.lines} lines`);
    }
    if (complexityReport.overThreshold.length > 10) {
      printInfo(`  ... and ${complexityReport.overThreshold.length - 10} more files over threshold`);
    }
  }

  // Phase 4: Detect test setup
  console.log(`\n  ${c.dim}Detecting test infrastructure...${c.reset}`);
  const testInfo = detectTestSetup(projectDir, allFiles);

  if (testInfo.framework) {
    printPass(`Test framework detected: ${testInfo.framework}`);
    if (testInfo.command) printInfo(`  Run command: ${testInfo.command}`);
    printInfo(`  Test files found: ${testFiles.length}`);
  } else {
    printWarn('No test framework detected');
  }

  // Phase 5: Detect documentation
  console.log(`\n  ${c.dim}Checking documentation...${c.reset}`);
  const docsDir = docFiles.length > 0 ? path.dirname(docFiles[0]) : null;
  if (docFiles.length > 0) {
    printPass(`${docFiles.length} documentation file(s) found`);
  } else {
    printWarn('No documentation files found');
  }

  // Phase 6: Generate trace.yaml
  console.log(`\n  ${c.dim}Generating trace.yaml...${c.reset}\n`);
  const config = generateConfig(projectName, anchorCandidates, testInfo, complexityReport, docsDir, docFiles);
  fs.writeFileSync(path.join(projectDir, 'trace.yaml'), config);
  printPass('Created trace.yaml');

  // Phase 7: Create .trace directory with baseline
  fs.mkdirSync(path.join(projectDir, '.trace'), { recursive: true });

  // Create baseline snapshot
  const baseline = {
    project: projectName,
    baseline_date: getDateStamp(),
    baseline_note: 'TRACE enforces on changes after this date. Pre-existing issues are tracked but not blocking.',
    scan_results: {
      total_files: allFiles.length,
      code_files: codeFiles.length,
      test_files: testFiles.length,
      doc_files: docFiles.length,
      anchors_detected: anchorCandidates.length,
      files_over_threshold: complexityReport.overThreshold.length,
      avg_file_lines: complexityReport.avgLines,
    },
    pre_existing_issues: complexityReport.overThreshold.map(f => ({
      file: f.file,
      issue: 'over_threshold',
      lines: f.lines,
      status: 'acknowledged',  // not blocking until touched
    })),
  };
  fs.writeFileSync(
    path.join(projectDir, '.trace', 'BASELINE.yaml'),
    YAML.stringify(baseline, { lineWidth: 120 })
  );
  printPass('Created .trace/BASELINE.yaml (pre-existing issues acknowledged)');

  // Copy standard templates
  const templateDir = path.join(import.meta.dirname, '..', 'templates');
  const templates = ['TRACE_STATE.yaml', 'PROJECT_LOG.md', 'HANDOFF.md', 'DEBT.yaml', 'LIVE_CHECKPOINT.yaml', 'AI_INSTRUCTIONS.md'];
  for (const t of templates) {
    let content = fs.readFileSync(path.join(templateDir, t), 'utf8');
    content = content.replace(/{PROJECT_NAME}/g, projectName).replace(/{DATE}/g, getDateStamp());
    fs.writeFileSync(path.join(projectDir, '.trace', t), content);
  }
  printPass('Created .trace/ resumability artifacts');

  // Summary
  console.log(`
${c.green}${c.bold}Scan complete.${c.reset}

${c.bold}The "Clean as You Code" approach:${c.reset}
  TRACE has set ${c.cyan}${getDateStamp()}${c.reset} as your baseline date.
  Pre-existing issues are ${c.yellow}acknowledged but not blocking${c.reset}.
  TRACE enforces coherence on ${c.bold}new and modified code only${c.reset}.
  As you touch old files, they gradually come into compliance.

${c.bold}What to do next:${c.reset}
  1. Review ${c.cyan}trace.yaml${c.reset} — verify the detected anchors, add any that were missed
  2. Review ${c.cyan}.trace/BASELINE.yaml${c.reset} — see pre-existing issues
  3. Run ${c.cyan}trace check${c.reset} to see current coherence status
  4. Commit ${c.cyan}trace.yaml${c.reset} and ${c.cyan}.trace/${c.reset} to version control
  5. Start using ${c.cyan}trace gate start${c.reset} / ${c.cyan}trace gate end${c.reset} for each session

${c.dim}Tip: Don't try to fix everything at once. TRACE improves your codebase incrementally.${c.reset}
`);

  rl.close();
}

// ─── Detection Helpers ───

function isCodeFile(f) {
  return /\.(js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|cs|swift|kt|dart|vue|svelte|php)$/.test(f)
    && !isTestFile(f) && !f.includes('node_modules') && !f.includes('.min.');
}

function isDocFile(f) {
  return /\.(md|mdx|rst|txt|adoc)$/.test(f)
    && !f.includes('node_modules') && !f.includes('CHANGELOG')
    && !f.includes('LICENSE');
}

function isConfigFile(f) {
  return /\.(yaml|yml|json|toml|ini|env|config)$/.test(f)
    && !f.includes('node_modules') && !f.includes('package-lock')
    && !f.includes('.trace');
}

function isTestFile(f) {
  return /\.(test|spec|_test|_spec)\.(js|ts|jsx|tsx|py|rb|go|rs)$/.test(f)
    || f.includes('__tests__') || f.includes('test/') || f.includes('tests/')
    || f.includes('spec/');
}

/**
 * Detect files likely to be anchors based on naming patterns and structure.
 * Anchors are typically: models, schemas, types, interfaces, configs, contracts.
 */
function detectAnchors(root, codeFiles, configFiles) {
  const candidates = [];
  const anchorPatterns = [
    { pattern: /models?\//i, reason: 'Model directory — likely defines data structures' },
    { pattern: /schemas?\//i, reason: 'Schema directory — likely defines data contracts' },
    { pattern: /types?\.(ts|js|d\.ts)$/i, reason: 'Type definition file — shared interface' },
    { pattern: /interfaces?\.(ts|js)$/i, reason: 'Interface definition — shared contract' },
    { pattern: /(schema|model)\.(ts|js|py|rb|go)$/i, reason: 'Schema/model file — data structure definition' },
    { pattern: /openapi\.(yaml|yml|json)$/i, reason: 'OpenAPI spec — API contract' },
    { pattern: /swagger\.(yaml|yml|json)$/i, reason: 'Swagger spec — API contract' },
    { pattern: /prisma\/schema\.prisma$/i, reason: 'Prisma schema — database contract' },
    { pattern: /migrations?\//i, reason: 'Migration directory — database evolution' },
    { pattern: /config\/(.*)\.(ts|js|py|yaml|yml)$/i, reason: 'Config file — shared configuration' },
    { pattern: /constants?\.(ts|js|py)$/i, reason: 'Constants file — shared values' },
    { pattern: /routes?\.(ts|js|py)$/i, reason: 'Route definitions — API structure' },
  ];

  const allCandidateFiles = [...codeFiles, ...configFiles];

  for (const file of allCandidateFiles) {
    for (const { pattern, reason } of anchorPatterns) {
      if (pattern.test(file)) {
        const id = generateAnchorId(file);
        // Find consumers by scanning for imports/references
        const consumers = findConsumers(root, file, codeFiles);
        candidates.push({ id, file, reason, consumers });
        break; // only match first pattern per file
      }
    }
  }

  // Deduplicate and limit
  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.file)) return false;
    seen.add(c.file);
    return true;
  }).slice(0, 15); // max 15 candidates
}

function generateAnchorId(file) {
  return path.basename(file, path.extname(file))
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toLowerCase();
}

/**
 * Find files that import or reference the anchor file.
 * Simple heuristic: scan for the filename in import statements.
 */
function findConsumers(root, anchorFile, codeFiles) {
  const consumers = [];
  const anchorName = path.basename(anchorFile, path.extname(anchorFile));
  const anchorRelDir = path.dirname(anchorFile);

  for (const file of codeFiles) {
    if (file === anchorFile) continue;
    try {
      const content = fs.readFileSync(path.join(root, file), 'utf8');
      // Check for import/require/from references to this file
      if (
        content.includes(`from '`) && content.includes(anchorName) ||
        content.includes(`from "`) && content.includes(anchorName) ||
        content.includes(`require('`) && content.includes(anchorName) ||
        content.includes(`import `) && content.includes(anchorName)
      ) {
        consumers.push(file);
      }
    } catch { /* skip unreadable files */ }
  }

  return consumers.slice(0, 20); // cap at 20
}

function analyzeComplexity(root, codeFiles) {
  const threshold = 400;
  const overThreshold = [];
  let totalLines = 0;
  let fileCount = 0;

  for (const file of codeFiles) {
    const lines = countLines(path.join(root, file));
    totalLines += lines;
    fileCount++;
    if (lines > threshold) {
      overThreshold.push({ file, lines });
    }
  }

  overThreshold.sort((a, b) => b.lines - a.lines);

  return {
    overThreshold,
    avgLines: fileCount > 0 ? Math.round(totalLines / fileCount) : 0,
    totalLines,
    fileCount,
  };
}

function detectTestSetup(root, allFiles) {
  // Check package.json for test scripts
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const testCmd = pkg.scripts?.test;
      if (testCmd && testCmd !== 'echo "Error: no test specified" && exit 1') {
        // Detect framework from devDependencies
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        let framework = 'unknown';
        if (deps.jest || deps['@jest/core']) framework = 'Jest';
        else if (deps.vitest) framework = 'Vitest';
        else if (deps.mocha) framework = 'Mocha';
        else if (deps['@playwright/test']) framework = 'Playwright';
        else if (deps.cypress) framework = 'Cypress';
        return { framework, command: 'npm test' };
      }
    } catch { /* ignore parse errors */ }
  }

  // Check for pytest
  if (allFiles.some(f => f === 'pytest.ini' || f === 'pyproject.toml' || f === 'setup.cfg')) {
    if (allFiles.some(f => f.includes('test_') || f.includes('_test.py'))) {
      return { framework: 'pytest', command: 'pytest' };
    }
  }

  // Check for Go tests
  if (allFiles.some(f => f.endsWith('_test.go'))) {
    return { framework: 'Go test', command: 'go test ./...' };
  }

  return { framework: null, command: null };
}

/**
 * Auto-detect quality tools (lint, typecheck, format) from project config.
 * Returns array of {name, command, on_fail}
 */
function detectQualityTools(root) {
  const checks = [];

  // Node.js projects — check package.json scripts
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Lint detection
      if (scripts.lint) {
        checks.push({ name: 'Lint', command: 'npm run lint', on_fail: 'warn' });
      } else if (deps.eslint) {
        checks.push({ name: 'Lint (ESLint)', command: 'npx eslint .', on_fail: 'warn' });
      } else if (deps.biome || deps['@biomejs/biome']) {
        checks.push({ name: 'Lint (Biome)', command: 'npx biome check .', on_fail: 'warn' });
      }

      // Type check detection
      if (scripts['typecheck'] || scripts['type-check']) {
        const cmd = scripts['typecheck'] ? 'npm run typecheck' : 'npm run type-check';
        checks.push({ name: 'Type check', command: cmd, on_fail: 'block' });
      } else if (deps.typescript) {
        checks.push({ name: 'Type check (tsc)', command: 'npx tsc --noEmit', on_fail: 'block' });
      }

      // Format detection
      if (scripts['format:check'] || scripts['format-check']) {
        const cmd = scripts['format:check'] ? 'npm run format:check' : 'npm run format-check';
        checks.push({ name: 'Format', command: cmd, on_fail: 'warn' });
      } else if (deps.prettier) {
        checks.push({ name: 'Format (Prettier)', command: 'npx prettier --check .', on_fail: 'warn' });
      }
    } catch { /* ignore */ }
  }

  // Python projects — check for common tools
  const pyprojectPath = path.join(root, 'pyproject.toml');
  const setupCfgPath = path.join(root, 'setup.cfg');
  if (fs.existsSync(pyprojectPath) || fs.existsSync(setupCfgPath)) {
    const pyContent = fs.existsSync(pyprojectPath) ? fs.readFileSync(pyprojectPath, 'utf8') : '';

    if (pyContent.includes('ruff') || fs.existsSync(path.join(root, 'ruff.toml'))) {
      checks.push({ name: 'Lint (Ruff)', command: 'ruff check .', on_fail: 'warn' });
    } else if (pyContent.includes('flake8') || fs.existsSync(path.join(root, '.flake8'))) {
      checks.push({ name: 'Lint (Flake8)', command: 'flake8 .', on_fail: 'warn' });
    }

    if (pyContent.includes('mypy')) {
      checks.push({ name: 'Type check (mypy)', command: 'mypy .', on_fail: 'warn' });
    }

    if (pyContent.includes('black')) {
      checks.push({ name: 'Format (Black)', command: 'black --check .', on_fail: 'warn' });
    }
  }

  // Go projects
  if (fs.existsSync(path.join(root, 'go.mod'))) {
    checks.push({ name: 'Vet (Go)', command: 'go vet ./...', on_fail: 'block' });
  }

  // Makefile targets
  const makefilePath = path.join(root, 'Makefile');
  if (fs.existsSync(makefilePath)) {
    const makefile = fs.readFileSync(makefilePath, 'utf8');
    if (makefile.includes('lint:') && checks.length === 0) {
      checks.push({ name: 'Lint', command: 'make lint', on_fail: 'warn' });
    }
    if (makefile.includes('typecheck:') && !checks.find(c => c.name.includes('Type'))) {
      checks.push({ name: 'Type check', command: 'make typecheck', on_fail: 'block' });
    }
  }

  return checks;
}

function generateConfig(projectName, anchors, testInfo, complexity, docsDir, docFiles) {
  const lines = [];
  lines.push('# ============================================================');
  lines.push('# TRACE — Trusted Registry for Artifact Consistency and Evolution');
  lines.push(`# Generated by: trace scan (${getDateStamp()})`);
  lines.push('# ============================================================');
  lines.push('# This config was auto-generated from scanning your existing codebase.');
  lines.push('# Review and adjust the detected anchors and settings below.');
  lines.push('# ============================================================');
  lines.push('');
  lines.push('project:');
  lines.push(`  name: "${projectName}"`);
  lines.push('  version: "1.0.0"');
  lines.push(`  created: "${getDateStamp()}"`);
  lines.push('');
  lines.push('# Baseline: TRACE enforces on changes AFTER this date.');
  lines.push('# Pre-existing issues are in .trace/BASELINE.yaml (acknowledged, not blocking).');
  lines.push('baseline:');
  lines.push(`  date: "${getDateStamp()}"`);
  lines.push('  mode: "clean_as_you_code"  # enforce on new/modified code only');
  lines.push('');

  // Anchors
  lines.push('# PILLAR T: Truth Anchoring (auto-detected, please review)');
  lines.push('anchors:');
  if (anchors.length === 0) {
    lines.push('  # No anchors auto-detected. Add your own:');
    lines.push('  # - id: user_schema');
    lines.push('  #   description: "Canonical User model"');
    lines.push('  #   file: "src/models/user.ts"');
    lines.push('  #   consumers:');
    lines.push('  #     - "src/api/users.ts"');
    lines.push('  #     - "docs/data-model.md"');
  } else {
    for (const a of anchors) {
      lines.push(`  - id: ${a.id}`);
      lines.push(`    description: "${a.reason}"`);
      lines.push(`    file: "${a.file}"`);
      if (a.consumers.length > 0) {
        lines.push('    consumers:');
        for (const con of a.consumers) {
          lines.push(`      - "${con}"`);
        }
      }
    }
  }
  lines.push('');

  // Registry
  lines.push('# PILLAR R: Registry Enforcement');
  lines.push('registry:');
  lines.push(`  docs_root: "${docsDir || 'docs/'}"`);
  lines.push('  tracked_docs: []');
  lines.push('  review_cycle: "quarterly"');
  lines.push('');

  // Verification
  lines.push('# PILLAR A: Automated Verification');
  lines.push('verification:');
  lines.push('  tiers:');
  lines.push('    tier1:');
  lines.push('      description: "Unit-level. Fast. Runs on every change."');
  lines.push(`      command: "${testInfo.command || ''}"  # ${testInfo.framework ? 'detected: ' + testInfo.framework : 'configure your test command'}`);
  lines.push('      min_count: 0');
  lines.push('    tier2:');
  lines.push('      description: "Behavioral. Validates user-facing outcomes."');
  lines.push('      command: ""');
  lines.push('      min_count: 0');
  lines.push('    tier3:');
  lines.push('      description: "Systemic. Cross-platform, cross-artifact."');
  lines.push('      command: ""');
  lines.push('      min_count: 0');
  lines.push('');

  // Thresholds (calibrated to project)
  const suggestedMax = Math.max(400, Math.round(complexity.avgLines * 3));
  lines.push('# PILLAR C: Controlled Evolution');
  lines.push('thresholds:');
  lines.push(`  max_file_lines: ${suggestedMax}  # calibrated: avg is ${complexity.avgLines} lines`);
  lines.push('  max_function_lines: 50');
  lines.push('  max_cyclomatic: 15');
  lines.push('  max_anchor_consumers: 10');
  lines.push('');

  // Contracts
  lines.push('# PILLAR E: Execution Contracts');
  lines.push('contracts:');
  lines.push('  feature:');
  lines.push('    description: "Adding new functionality"');
  lines.push('    requires_scope_declaration: true');
  lines.push('    verification_tier: "tier2"');
  lines.push('    steps:');
  lines.push('      - "Declare scope (what will change, what anchors are affected)"');
  lines.push('      - "Verify baseline (all existing tests pass)"');
  lines.push('      - "Check complexity thresholds"');
  lines.push('      - "Implement with verification at each step"');
  lines.push('      - "Update all consumer files for affected anchors"');
  lines.push('      - "Update documentation registry"');
  lines.push('      - "Run full verification suite"');
  lines.push('      - "Record attestation in project log"');
  lines.push('');
  lines.push('  bugfix:');
  lines.push('    description: "Fixing a known defect"');
  lines.push('    requires_scope_declaration: false');
  lines.push('    verification_tier: "tier1"');
  lines.push('    root_cause_required: true');
  lines.push('    steps:');
  lines.push('      - "Identify root cause (which anchor or consumer drifted?)"');
  lines.push('      - "Verify baseline"');
  lines.push('      - "Fix at the source, not the symptom"');
  lines.push('      - "Add regression test (tier1 minimum)"');
  lines.push('      - "Verify no other consumers affected"');
  lines.push('      - "Update project log with root cause"');
  lines.push('');
  lines.push('  hotfix:');
  lines.push('    description: "Emergency production fix"');
  lines.push('    requires_scope_declaration: false');
  lines.push('    verification_tier: "tier1"');
  lines.push('    creates_debt: true');
  lines.push('    debt_resolution: "next_cycle"');
  lines.push('    steps:');
  lines.push('      - "Log emergency override reason"');
  lines.push('      - "Fix issue with minimal change"');
  lines.push('      - "Run tier1 verification"');
  lines.push('      - "Deploy"');
  lines.push('      - "Create deferred compliance entry"');
  lines.push('');

  // File classification
  lines.push('# Change Sensitivity Classification');
  lines.push('file_classification:');
  lines.push('  core:');
  lines.push('    description: "Anchor files. Change here = high impact."');
  lines.push('    patterns:');
  if (anchors.length > 0) {
    const anchorDirs = [...new Set(anchors.map(a => path.dirname(a.file)))];
    for (const d of anchorDirs) {
      lines.push(`      - "${d}/**"`);
    }
  } else {
    lines.push('      # Add patterns for your core files');
  }
  lines.push('    min_verification: "tier2"');
  lines.push('    requires_review: true');
  lines.push('  supporting:');
  lines.push('    description: "Consumer files. Moderate impact."');
  lines.push('    patterns: []');
  lines.push('    min_verification: "tier1"');
  lines.push('    requires_review: true');
  lines.push('  peripheral:');
  lines.push('    description: "Low coupling. Minimal impact."');
  lines.push('    patterns: []');
  lines.push('    min_verification: "tier1"');
  lines.push('    requires_review: false');
  lines.push('');

  // Code review
  lines.push('# Code Review Checklist');
  lines.push('code_review:');
  lines.push('  checklist:');
  lines.push('    - "All affected anchors identified and updated?"');
  lines.push('    - "All consumer files for changed anchors verified?"');
  lines.push('    - "Documentation reflects the change?"');
  lines.push('    - "Tests added or updated? (never removed without replacement)"');
  lines.push('    - "Complexity thresholds respected?"');
  lines.push('    - "Root cause addressed (not just symptom)?"');
  lines.push('  custom_checks: []');
  lines.push('');

  // Gates
  lines.push('# Session Gates');
  lines.push('gates:');
  lines.push('  start:');
  lines.push('    checks:');
  lines.push('      - "trace_state_exists"');
  lines.push('      - "baseline_tests_pass"');
  lines.push('      - "no_unresolved_debt"');
  lines.push('      - "live_checkpoint_recovery"');
  lines.push('    on_fail: "warn"  # start with warn for existing projects, switch to block when ready');
  lines.push('  end:');
  lines.push('    checks:');
  lines.push('      - "all_tests_pass"');
  lines.push('      - "anchors_coherent"');
  lines.push('      - "docs_updated"');
  lines.push('      - "scope_complete"');
  lines.push('      - "project_log_updated"');
  lines.push('      - "handoff_ready"');
  lines.push('    on_fail: "warn"  # start with warn, switch to block when team is comfortable');
  lines.push('');

  // Artifacts
  lines.push('# Resumability Artifacts');
  lines.push('artifacts:');
  lines.push('  trace_state: ".trace/TRACE_STATE.yaml"');
  lines.push('  project_log: ".trace/PROJECT_LOG.md"');
  lines.push('  live_checkpoint: ".trace/LIVE_CHECKPOINT.yaml"');
  lines.push('  debt_log: ".trace/DEBT.yaml"');
  lines.push('  handoff: ".trace/HANDOFF.md"');
  lines.push('  baseline: ".trace/BASELINE.yaml"');
  lines.push('');

  // Debt
  lines.push('# Debt Tracking');
  lines.push('debt:');
  lines.push('  max_accumulated: 5');
  lines.push('  severity:');
  lines.push('    minor:');
  lines.push('      resolution_window: 3');
  lines.push('    major:');
  lines.push('      resolution_window: 1');
  lines.push('');

  // Quality checks - auto-detected from project tooling
  const qualityChecks = detectQualityTools(root);
  lines.push('# Quality Checks (auto-detected, runs at gate end)');
  lines.push('quality:');
  lines.push('  checks:');
  if (qualityChecks.length > 0) {
    for (const qc of qualityChecks) {
      lines.push(`    - name: "${qc.name}"`);
      lines.push(`      command: "${qc.command}"`);
      lines.push(`      on_fail: "${qc.on_fail}"`);
    }
  } else {
    lines.push('    []  # No quality tools detected. Add lint/typecheck/format commands here.');
  }

  return lines.join('\n');
}
