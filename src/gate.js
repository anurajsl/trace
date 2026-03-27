import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  c, findProjectRoot, loadConfig, loadYaml, saveYaml,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, getTimestamp, getDateStamp
} from './utils.js';
import { runCheck } from './check.js';

export async function runGateStart(args = []) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset} Run ${c.cyan}trace init${c.reset} first.`);
    process.exit(1);
  }

  const config = loadConfig(root);
  const scopeIdx = args.indexOf('--scope');
  const scope = scopeIdx >= 0 ? args[scopeIdx + 1] : null;

  printHeader(`Start Gate — ${config.project?.name || 'Project'}${scope ? ` [scope: ${scope}]` : ''}`);

  let gatePass = true;
  const checks = config.gates?.start?.checks || [];
  const onFail = config.gates?.start?.on_fail || 'block';

  // 0. Quick config validation
  if (!config.project?.name) {
    printWarn('trace.yaml: missing project.name — run trace validate for details');
  }
  if (config.anchors && !Array.isArray(config.anchors)) {
    printFail('trace.yaml: "anchors" must be an array');
    gatePass = false;
  }

  // 1. Check TRACE_STATE exists
  if (checks.includes('trace_state_exists')) {
    const statePath = path.join(root, config.artifacts?.trace_state || '.trace/TRACE_STATE.yaml');
    if (fileExists(statePath)) {
      const state = loadYaml(statePath);
      printPass(`TRACE_STATE found (last updated: ${state?.last_updated || 'unknown'})`);
      if (state?.last_session_by) {
        printInfo(`  Last session by: ${state.last_session_by}`);
      }

      // Show next priorities from state
      if (state?.next_priorities?.length > 0) {
        console.log(`\n  ${c.bold}Priorities from last session:${c.reset}`);
        for (const p of state.next_priorities) {
          printInfo(`  → ${p}`);
        }
      }
    } else {
      printFail('TRACE_STATE missing');
      gatePass = false;
    }
  }

  // 2. Check for live checkpoint (crash recovery)
  if (checks.includes('live_checkpoint_recovery')) {
    const cpPath = path.join(root, config.artifacts?.live_checkpoint || '.trace/LIVE_CHECKPOINT.yaml');
    if (fileExists(cpPath)) {
      const cp = loadYaml(cpPath);
      const checkpoints = cp?.checkpoints || [];
      if (checkpoints.length > 0) {
        const last = checkpoints[checkpoints.length - 1];
        printWarn(`Live checkpoint found — previous session may have crashed`);
        printInfo(`  Last checkpoint: ${last.timestamp}`);
        printInfo(`  Last file modified: ${last.last_file_modified}`);
        printInfo(`  Next step was: ${last.next_step}`);
        console.log(`\n  ${c.yellow}Recovery:${c.reset} Verify file system state matches, then resume from: ${c.bold}${last.next_step}${c.reset}`);
        console.log(`  ${c.dim}If inconsistent, delete .trace/LIVE_CHECKPOINT.yaml and start fresh.${c.reset}`);
      }
    } else {
      printPass('No crash recovery needed');
    }
  }

  // 3. Check unresolved debt
  if (checks.includes('no_unresolved_debt')) {
    const debtPath = path.join(root, config.artifacts?.debt_log || '.trace/DEBT.yaml');
    const debt = loadYaml(debtPath);
    const unresolved = (debt?.entries || []).filter(e => !e.resolved);
    const maxDebt = config.debt?.max_accumulated || 5;

    if (unresolved.length === 0) {
      printPass('No unresolved debt');
    } else if (unresolved.length >= maxDebt) {
      printFail(`Debt limit reached: ${unresolved.length}/${maxDebt} — resolution cycle required`);
      for (const entry of unresolved) {
        printInfo(`  [${entry.severity}] ${entry.description}`);
      }
      gatePass = false;
    } else {
      printWarn(`${unresolved.length} debt item(s) — acknowledge before proceeding`);
      for (const entry of unresolved) {
        printInfo(`  [${entry.severity}] ${entry.description} (resolve by: ${entry.resolve_by})`);
      }
    }
  }

  // 4. Run baseline tests
  if (checks.includes('baseline_tests_pass')) {
    const tier1cmd = config.verification?.tiers?.tier1?.command;
    if (tier1cmd) {
      try {
        execSync(tier1cmd, { cwd: root, stdio: 'pipe', timeout: 120000 });
        printPass('Baseline tests pass');
      } catch {
        printFail('Baseline tests FAILING — fix before starting work');
        gatePass = false;
      }
    } else {
      printInfo('No tier1 test command configured — skipping baseline check');
    }
  }

  // 5. Show handoff context
  const handoffPath = path.join(root, config.artifacts?.handoff || '.trace/HANDOFF.md');
  if (fileExists(handoffPath)) {
    const content = fs.readFileSync(handoffPath, 'utf8');
    if (content.length > 200) { // has real content beyond template
      printPass('Handoff document available');
      printInfo('  Read .trace/HANDOFF.md for context from last session');
    }
  }

  // 6. Verify integrity checksums (tamper detection)
  try {
    const { verifyIntegrity } = await import('./integrity.js');
    const integrity = verifyIntegrity();
    if (integrity.missing) {
      printWarn('No integrity manifest found (will be generated at gate end)');
    } else if (integrity.passed) {
      printPass('Integrity checksums verified \u2014 no tampering detected');
    } else {
      printFail('INTEGRITY VIOLATION \u2014 TRACE files modified outside workflow');
      for (const r of integrity.results) {
        if (r.status === 'tampered') printFail(`  ${r.file}: ${r.detail}`);
      }
      gatePass = false;
    }
  } catch (e) {
    printWarn('Integrity check skipped');
  }

  // Result
  console.log();
  if (gatePass) {
    console.log(`  ${c.bgGreen}${c.bold} START GATE: PASS ${c.reset}\n`);
    console.log(`  ${c.dim}Session started at ${getTimestamp()}. Remember to run ${c.reset}${c.cyan}trace gate end${c.reset}${c.dim} when done.${c.reset}\n`);

    // Initialize live checkpoint
    const cpPath = path.join(root, config.artifacts?.live_checkpoint || '.trace/LIVE_CHECKPOINT.yaml');
    saveYaml(cpPath, {
      session_started: getTimestamp(),
      sprint: '',
      contributor: '',
      checkpoints: [],
    });

    // Generate context-aware AI instructions for this session
    try {
      const { generateSessionContext } = await import('./observe.js');
      const ctxPath = generateSessionContext(root, config, scope);
      printPass(`Session context generated (.trace/AI_CONTEXT.md)${scope ? ` [scope: ${scope}]` : ''}`);
    } catch (e) {
      // Non-critical
    }
  } else {
    if (onFail === 'block') {
      console.log(`  ${c.bgRed}${c.bold} START GATE: BLOCKED ${c.reset}`);
      console.log(`  ${c.dim}Resolve the failures above before starting work.${c.reset}\n`);
      process.exit(1);
    } else {
      console.log(`  ${c.bgYellow}${c.bold} START GATE: WARNING ${c.reset}`);
      console.log(`  ${c.dim}Proceeding with warnings. Issues logged.${c.reset}\n`);
    }
  }
}

export async function runGateEnd() {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    process.exit(1);
  }

  const config = loadConfig(root);
  printHeader(`End Gate — ${config.project?.name || 'Project'}`);

  // Run full coherence check
  console.log(`  ${c.dim}Running coherence check...${c.reset}\n`);
  const results = runCheck({ skipTests: false });

  const checks = config.gates?.end?.checks || [];
  const onFail = config.gates?.end?.on_fail || 'block';
  let gatePass = results.fail === 0;
  const gateFailures = [];
  const qualityResults = [];

  // Check project log was updated
  if (checks.includes('project_log_updated')) {
    const logPath = path.join(root, config.artifacts?.project_log || '.trace/PROJECT_LOG.md');
    if (fileExists(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      const today = getDateStamp();
      if (content.includes(today)) {
        printPass('Project log updated today');
      } else {
        printWarn('Project log not updated this session');
        printInfo(`  Add session entry to .trace/PROJECT_LOG.md before closing`);
      }
    }
  }

  // Check handoff is ready
  if (checks.includes('handoff_ready')) {
    const handoffPath = path.join(root, config.artifacts?.handoff || '.trace/HANDOFF.md');
    if (fileExists(handoffPath)) {
      const stat = fs.statSync(handoffPath);
      const today = new Date();
      const hoursSinceModified = (today.getTime() - stat.mtimeMs) / (1000 * 60 * 60);
      if (hoursSinceModified < 2) {
        printPass('Handoff document recently updated');
      } else {
        printWarn('Handoff document not updated this session');
        printInfo('  Update .trace/HANDOFF.md so the next session can cold-start');
      }
    }
  }

  // Code review checklist reminder
  const checklist = config.code_review?.checklist || [];
  if (checklist.length > 0) {
    console.log(`\n  ${c.bold}Code Review Checklist:${c.reset}`);
    for (const item of checklist) {
      console.log(`  ${c.dim}☐${c.reset} ${item}`);
    }
    const custom = config.code_review?.custom_checks || [];
    for (const item of custom) {
      console.log(`  ${c.dim}☐${c.reset} ${item}`);
    }
  }

  // Planning reconciliation
  try {
    const { checkPlanReconciliation, checkReleaseNote } = await import('./plan.js');
    
    console.log(`\n  ${c.bold}Planning Reconciliation:${c.reset}`);
    const planCheck = checkPlanReconciliation(root);
    if (planCheck.warnings.length > 0) {
      for (const w of planCheck.warnings) {
        printWarn(w);
      }
    } else {
      printPass('PLAN.yaml is up to date');
    }

    // Release note check
    const rnCheck = checkReleaseNote(root, config);
    if (rnCheck.needed) {
      if (rnCheck.exists) {
        printPass(`Release note exists for v${rnCheck.version}`);
      } else {
        printWarn(`No release note for v${rnCheck.version} — run: trace plan release v${rnCheck.version}`);
      }
    }
  } catch (e) {
    // Plan module not critical — skip silently
  }

  // Quality checks — run project's own lint/typecheck/format tools
  const qualityChecks = config.quality?.checks || [];
  if (qualityChecks.length > 0) {
    console.log(`\n  ${c.bold}Quality Checks:${c.reset}`);
    for (const qc of qualityChecks) {
      if (!qc.command) continue;
      try {
        execSync(qc.command, { cwd: root, stdio: 'pipe', timeout: 120000 });
        printPass(`${qc.name}: passed`);
        qualityResults.push({ name: qc.name, passed: true });
      } catch (e) {
        qualityResults.push({ name: qc.name, passed: false });
        if (qc.on_fail === 'block') {
          printFail(`${qc.name}: FAILED (blocking)`);
          printFail(`  Command: ${qc.command}`);
          const stderr = e.stderr?.toString().trim().split('\n').slice(0, 3).join('\n    ');
          if (stderr) printFail(`    ${stderr}`);
          gatePass = false;
          gateFailures.push({ type: `quality_${qc.name}`, detail: 'block' });
        } else {
          printWarn(`${qc.name}: failed (warning only)`);
          printInfo(`  Command: ${qc.command}`);
        }
      }
    }
  }

  // Consumer sync verification (Anchor Impact Protocol)
  // Dependency governance
  if (config.dependencies?.policy && config.dependencies.policy !== 'permissive') {
    console.log(`\n  ${c.bold}Dependency Audit:${c.reset}`);
    try {
      const { runDepsAudit } = await import('./deps-audit.js');
      const auditResult = runDepsAudit([]);
      if (!auditResult.pass) {
        if (gateMode === 'block') {
          gatePass = false;
          gateFailures.push({ type: 'dependency_audit', detail: 'Policy violation' });
        } else {
          printWarn('Dependency issues detected (warning only in warn mode)');
        }
      }
    } catch (e) {
      printWarn(`Dependency audit skipped: ${e.message}`);
    }
  }

  // Consumer sync verification (Anchor Impact Protocol)
  try {
    const { verifyConsumerSync } = await import('./impact.js');
    const syncResult = verifyConsumerSync(root, config);
    if (!syncResult.skipped) {
      console.log(`\n  ${c.bold}Consumer Sync Verification:${c.reset}`);
      if (syncResult.passed) {
        printPass('All modified anchors have updated consumers');
      } else {
        for (const v of syncResult.violations) {
          printFail(`Anchor "${v.anchor}" changed but ${v.staleConsumers.length}/${v.totalConsumers} consumer(s) not updated:`);
          for (const sc of v.staleConsumers) {
            printFail(`  \u2192 ${sc}`);
          }
        }
        gatePass = false;
        gateFailures.push({ type: 'consumer_sync', detail: `${syncResult.violations.length} anchor(s) with stale consumers` });
      }
    }
  } catch (e) {
    // Impact module not critical
  }

  // Dependency audit (if configured)
  const depConfig = config.dependencies || {};
  if (depConfig.policy || depConfig.audit || depConfig.allowed || depConfig.blocked) {
    console.log(`\n  ${c.bold}Dependency Audit:${c.reset}`);
    try {
      const { runDepsAudit, saveDepsBaseline } = await import('./deps-audit.js');
      const depResult = runDepsAudit([], { gateMode: true });
      if (depResult.total > 0) {
        if (depResult.newDeps?.length > 0) {
          printInfo(`${depResult.newDeps.length} new dependency(s) detected this session`);
          for (const nd of depResult.newDeps) {
            printInfo(`  + ${nd.name}@${nd.version || '?'} (${nd.license || 'unknown license'})`);
          }
        }
        if (depResult.issues.length > 0) {
          for (const issue of depResult.issues) { printFail(issue); }
          if (depConfig.policy === 'strict') {
            gatePass = false;
            gateFailures.push({ type: 'dependency_audit', detail: `${depResult.issues.length} issue(s)` });
          }
        }
        if (depResult.warnings?.length > 0) {
          for (const w of depResult.warnings) { printWarn(w); }
        }
        if (depResult.passed && (!depResult.warnings || depResult.warnings.length === 0)) {
          printPass(`${depResult.total} dependencies audited, all clear`);
        }
      }
      saveDepsBaseline(root);
    } catch (e2) {
      printWarn(`Dependency audit skipped: ${e2.message}`);
    }
  }

  // Result
  console.log();
  if (gatePass) {
    console.log(`  ${c.bgGreen}${c.bold} END GATE: PASS ${c.reset}\n`);

    // Clean up live checkpoint
    const cpPath = path.join(root, config.artifacts?.live_checkpoint || '.trace/LIVE_CHECKPOINT.yaml');
    if (fileExists(cpPath)) {
      fs.unlinkSync(cpPath);
      printInfo('Live checkpoint cleaned up');
    }

    // Regenerate integrity checksums
    try {
      const { generateIntegrity } = await import('./integrity.js');
      const { files } = generateIntegrity();
      printPass(`Integrity checksums regenerated (${files} files protected)`);
    } catch (e) {
      printWarn('Integrity generation skipped');
    }

    // Clean up impact assessments
    try {
      const { clearImpactAssessments } = await import('./impact.js');
      clearImpactAssessments(root);
    } catch (e) {}

    console.log(`  ${c.dim}Session closed at ${getTimestamp()}. Good work.${c.reset}\n`);
  } else {
    if (onFail === 'block') {
      console.log(`  ${c.bgRed}${c.bold} END GATE: BLOCKED ${c.reset}`);
      console.log(`  ${c.dim}Fix failures or run ${c.reset}${c.cyan}trace override${c.reset}${c.dim} to proceed (creates debt).${c.reset}\n`);
    } else {
      console.log(`  ${c.bgYellow}${c.bold} END GATE: WARNING ${c.reset}\n`);
    }
  }

  // Record outcome for metrics (threshold calibration)
  try {
    const { recordGateOutcome } = await import('./metrics.js');
    const syncViolationCount = (() => {
      try {
        const { verifyConsumerSync } = require('./impact.js');
        return 0; // already checked above
      } catch { return 0; }
    })();
    recordGateOutcome(root, config, {
      gate: 'end',
      result: gatePass ? 'pass' : (onFail === 'block' ? 'block' : 'warn'),
      failures: gateFailures,
      qualityResults,
      consumerSync: { violations: gateFailures.filter(f => f.type === 'consumer_sync').length },
    });
  } catch (e) {
    // Metrics recording is non-critical
  }
}

export function runOverride(reason) {
  const root = findProjectRoot();
  if (!root) return;
  const config = loadConfig(root);
  const debtPath = path.join(root, config.artifacts?.debt_log || '.trace/DEBT.yaml');
  const debt = loadYaml(debtPath) || { entries: [] };

  if (!reason) {
    console.log(`${c.red}Override requires a reason.${c.reset} Usage: ${c.cyan}trace override "reason for override"${c.reset}`);
    process.exit(1);
  }

  const entry = {
    id: `DEBT-${String(debt.entries.length + 1).padStart(3, '0')}`,
    created: getDateStamp(),
    severity: 'major',
    type: 'gate_override',
    description: reason,
    reason: 'Emergency override',
    resolve_by: 'next_cycle',
    resolved: false,
    resolution: '',
  };

  debt.entries.push(entry);
  saveYaml(debtPath, debt);

  printHeader('Emergency Override');
  printWarn(`Override logged as ${c.bold}${entry.id}${c.reset}`);
  printInfo(`Severity: major (must resolve next cycle)`);
  printInfo(`Reason: ${reason}`);
  console.log(`\n  ${c.dim}Proceeding. This debt MUST be resolved next session.${c.reset}\n`);

  // Clean up checkpoint
  const cpPath = path.join(root, config.artifacts?.live_checkpoint || '.trace/LIVE_CHECKPOINT.yaml');
  if (fileExists(cpPath)) fs.unlinkSync(cpPath);
}
