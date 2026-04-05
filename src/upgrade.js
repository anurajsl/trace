import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig, loadYaml, saveYaml,
  printHeader, printPass, printWarn, printInfo, printFail,
  fileExists, getDateStamp
} from './utils.js';

/**
 * trace upgrade — Detect and apply schema migrations to trace.yaml.
 * Adds missing sections with sensible defaults. Never removes existing config.
 * Shows a diff of what changed before writing.
 */
export function runUpgrade() {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset} Nothing to upgrade.`);
    return;
  }

  const configPath = path.join(root, 'trace.yaml');
  const raw = fs.readFileSync(configPath, 'utf8');
  let config;
  try {
    config = YAML.parse(raw);
  } catch (e) {
    printFail(`trace.yaml has invalid YAML — fix syntax first.`);
    return;
  }

  printHeader('TRACE Upgrade — Schema Migration');

  const additions = [];

  // 1. Quality section (added in v2.5)
  if (!config.quality) {
    config.quality = { checks: [] };
    additions.push('quality — Quality checks section (lint/typecheck/format at gate end)');
  }

  // 2. Code review section
  if (!config.code_review) {
    config.code_review = {
      checklist: [
        'All affected anchors identified and updated?',
        'All consumer files for changed anchors verified?',
        'Documentation reflects the change?',
        'Tests added or updated?',
        'Complexity thresholds respected?',
      ],
      custom_checks: [],
    };
    additions.push('code_review — Code review checklist for gate end');
  }

  // 3. File classification
  if (!config.file_classification) {
    config.file_classification = {
      core: { description: 'Anchor files. High impact.', patterns: [], min_verification: 'tier2', requires_review: true },
      supporting: { description: 'Consumer files. Moderate impact.', patterns: [], min_verification: 'tier1', requires_review: true },
      peripheral: { description: 'Low coupling. Minimal impact.', patterns: [], min_verification: 'tier1', requires_review: false },
    };
    additions.push('file_classification — Change sensitivity classification');
  }

  // 4. Contracts section
  if (!config.contracts) {
    config.contracts = {
      feature: { description: 'Adding new functionality', requires_scope_declaration: true, verification_tier: 'tier2' },
      bugfix: { description: 'Fixing a known defect', requires_scope_declaration: false, verification_tier: 'tier1', root_cause_required: true },
      hotfix: { description: 'Emergency production fix', requires_scope_declaration: false, verification_tier: 'tier1', creates_debt: true },
      refactor: { description: 'Restructuring without behavior change', requires_scope_declaration: true, verification_tier: 'tier2' },
    };
    additions.push('contracts — Execution contracts (feature/bugfix/hotfix/refactor)');
  }

  // 5. Debt section
  if (!config.debt) {
    config.debt = {
      max_accumulated: 5,
      severity: {
        minor: { resolution_window: 3 },
        major: { resolution_window: 1 },
      },
    };
    additions.push('debt — Debt tracking with limits and resolution windows');
  }

  // 6. Gates section
  if (!config.gates) {
    config.gates = {
      start: {
        checks: ['trace_state_exists', 'baseline_tests_pass', 'no_unresolved_debt', 'live_checkpoint_recovery'],
        on_fail: 'warn',
      },
      end: {
        checks: ['all_tests_pass', 'anchors_coherent', 'docs_updated', 'scope_complete', 'project_log_updated', 'handoff_ready'],
        on_fail: 'warn',
      },
    };
    additions.push('gates — Session start/end gate configuration');
  }

  // 7. Artifacts section
  if (!config.artifacts) {
    config.artifacts = {
      trace_state: '.trace/TRACE_STATE.yaml',
      project_log: '.trace/PROJECT_LOG.md',
      live_checkpoint: '.trace/LIVE_CHECKPOINT.yaml',
      debt_log: '.trace/DEBT.yaml',
      handoff: '.trace/HANDOFF.md',
    };
    additions.push('artifacts — Resumability artifact paths');
  }

  // 8. Thresholds section
  if (!config.thresholds) {
    config.thresholds = {
      max_file_lines: 400,
      max_function_lines: 50,
      max_cyclomatic: 15,
      max_anchor_consumers: 10,
    };
    additions.push('thresholds — Complexity thresholds with defaults');
  }

  // 9. Check for missing .trace/ files
  const traceDir = path.join(root, '.trace');
  const missingFiles = [];
  if (!fs.existsSync(traceDir)) {
    fs.mkdirSync(traceDir, { recursive: true });
    missingFiles.push('.trace/ directory');
  }

  const requiredFiles = [
    { path: '.trace/TRACE_STATE.yaml', content: `current_phase: development\nlast_updated: "${getDateStamp()}"\ncycle_count: 0\n` },
    { path: '.trace/PROJECT_LOG.md', content: `# Project Log\n\n_Auto-created by trace upgrade on ${getDateStamp()}_\n` },
    { path: '.trace/DEBT.yaml', content: `entries: []\n` },
    { path: '.trace/HANDOFF.md', content: `# Session Handoff\n\n_Update this at the end of each session._\n` },
    { path: '.trace/PLAN.yaml', content: `current_sprint: ""\nupdated: "${getDateStamp()}"\nitems: []\n` },
    { path: '.trace/METRICS.yaml', content: `outcomes: []\n` },
  ];

  for (const rf of requiredFiles) {
    const fullPath = path.join(root, rf.path);
    if (!fileExists(fullPath)) {
      fs.writeFileSync(fullPath, rf.content);
      missingFiles.push(rf.path);
    }
  }

  // Create releases directory
  const relDir = path.join(root, '.trace/releases');
  if (!fs.existsSync(relDir)) {
    fs.mkdirSync(relDir, { recursive: true });
    missingFiles.push('.trace/releases/');
  }

  // Report
  if (additions.length === 0 && missingFiles.length === 0) {
    printPass('trace.yaml is up to date — no migration needed.');
    printInfo('All .trace/ files present.\n');
    return;
  }

  if (additions.length > 0) {
    console.log(`\n  ${c.bold}Added to trace.yaml:${c.reset}\n`);
    for (const a of additions) {
      printPass(`+ ${a}`);
    }

    // Write updated config
    // Preserve comments by appending new sections to the raw YAML
    let appendix = '\n# ── Added by trace upgrade ──\n\n';
    const tempConfig = {};
    for (const a of additions) {
      const field = a.split(' —')[0].trim();
      if (config[field]) tempConfig[field] = config[field];
    }
    appendix += YAML.stringify(tempConfig);

    fs.writeFileSync(configPath, raw + appendix);
    printInfo(`\nUpdated trace.yaml (original content preserved, new sections appended)`);
  }

  if (missingFiles.length > 0) {
    console.log(`\n  ${c.bold}Created missing files:${c.reset}\n`);
    for (const f of missingFiles) {
      printPass(`+ ${f}`);
    }
  }

  console.log(`\n  ${c.dim}Run ${c.reset}${c.cyan}trace validate${c.reset}${c.dim} to verify the updated configuration.${c.reset}\n`);
}
