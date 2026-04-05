import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig, loadYaml, saveYaml,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, getDateStamp, getTimestamp
} from './utils.js';

const METRICS_FILE = '.trace/METRICS.yaml';

/**
 * Record a gate outcome — called automatically at gate end.
 * Tracks: what passed, what failed, which thresholds were involved.
 */
export function recordGateOutcome(root, config, outcome) {
  const metricsPath = path.join(root, METRICS_FILE);
  const metrics = fileExists(metricsPath) ? (loadYaml(metricsPath) || { outcomes: [] }) : { outcomes: [] };

  const entry = {
    timestamp: getTimestamp(),
    gate: outcome.gate,             // 'start' or 'end'
    result: outcome.result,         // 'pass', 'block', 'warn'
    failures: outcome.failures,     // array of {type, detail}
    thresholds: {
      max_file_lines: config.thresholds?.max_file_lines || 400,
      max_function_lines: config.thresholds?.max_function_lines || 50,
      max_debt: config.debt?.max_accumulated || 5,
    },
    quality_results: outcome.qualityResults || [],
    consumer_sync: outcome.consumerSync || null,
  };

  metrics.outcomes.push(entry);

  // Keep last 100 outcomes to avoid unbounded growth
  if (metrics.outcomes.length > 100) {
    metrics.outcomes = metrics.outcomes.slice(-100);
  }

  saveYaml(metricsPath, metrics);
}

/**
 * trace metrics — Analyze gate outcomes and suggest threshold tightening.
 * Only ever suggests tightening (one-way ratchet). Never loosens.
 * Shows suggestions for human review — never auto-adjusts.
 */
export async function runMetrics(args = []) {
  const jsonMode = args.includes('--json');
  const root = findProjectRoot();
  if (!root) {
    if (jsonMode) { console.log(JSON.stringify({ error: 'No trace.yaml found' })); return; }
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  const config = loadConfig(root);
  const metricsPath = path.join(root, METRICS_FILE);

  if (!fileExists(metricsPath)) {
    if (jsonMode) { console.log(JSON.stringify({ project: config.project?.name, sessions: 0, message: 'No metrics data yet' })); return; }
    printHeader('TRACE Metrics');
    printWarn('No metrics data yet. Metrics are recorded automatically at each gate end.');
    printInfo('Run at least 5 sessions to see calibration suggestions.\n');
    return;
  }

  const metrics = loadYaml(metricsPath);
  const outcomes = metrics?.outcomes || [];

  // JSON output for dashboards and org reporting
  if (jsonMode) {
    const endGates = outcomes.filter(o => o.gate === 'end');
    const passes = endGates.filter(o => o.result === 'pass');
    const blocks = endGates.filter(o => o.result === 'block');
    const warns = endGates.filter(o => o.result === 'warn');

    const failureTypes = {};
    for (const o of [...blocks, ...warns]) {
      for (const f of (o.failures || [])) {
        failureTypes[f.type] = (failureTypes[f.type] || 0) + 1;
      }
    }

    const state = loadYaml(path.join(root, '.trace/TRACE_STATE.yaml')) || {};
    const anchors = config.anchors || [];

    const report = {
      project: config.project?.name || 'Unknown',
      organization: config._orgName || null,
      generated_at: new Date().toISOString(),
      sessions: {
        total: endGates.length,
        pass: passes.length,
        block: blocks.length,
        warn: warns.length,
        pass_rate: endGates.length > 0 ? +(passes.length / endGates.length * 100).toFixed(1) : 0,
      },
      structure: {
        anchors: anchors.length,
        consumers: anchors.reduce((sum, a) => sum + (a.consumers || []).length, 0),
        debt: (state.debt || []).length,
        max_debt: config.debt?.max_accumulated || 5,
      },
      policies: config.policies || {},
      dependencies: {
        policy: config.dependencies?.policy || 'none',
        blocked: (config.dependencies?.blocked || []).length,
      },
      failure_patterns: failureTypes,
      gate_mode: config.gates?.end?.mode || 'warn',
    };

    // Add coherence score
    try {
      const { calcCoherenceScore } = await import('./status.js');
      report.coherence_score = calcCoherenceScore(root, config).score;
    } catch { report.coherence_score = null; }

    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (outcomes.length < 5) {
    printHeader('TRACE Metrics');
    printInfo(`${outcomes.length}/5 sessions recorded. Need at least 5 for analysis.\n`);
    return;
  }

  printHeader('TRACE Metrics — Outcome Analysis');
  printInfo(`Analyzing ${outcomes.length} gate outcomes\n`);

  // === Session Stats ===
  const endGates = outcomes.filter(o => o.gate === 'end');
  const passes = endGates.filter(o => o.result === 'pass');
  const blocks = endGates.filter(o => o.result === 'block');
  const warns = endGates.filter(o => o.result === 'warn');

  console.log(`  ${c.bold}Gate outcomes:${c.reset}`);
  console.log(`    Pass: ${c.green}${passes.length}${c.reset}  Block: ${c.red}${blocks.length}${c.reset}  Warn: ${c.yellow}${warns.length}${c.reset}`);

  const passRate = endGates.length > 0 ? (passes.length / endGates.length * 100).toFixed(0) : 0;
  console.log(`    Pass rate: ${passRate}%\n`);

  // === Failure Pattern Analysis ===
  const failureTypes = {};
  for (const o of [...blocks, ...warns]) {
    for (const f of (o.failures || [])) {
      failureTypes[f.type] = (failureTypes[f.type] || 0) + 1;
    }
  }

  if (Object.keys(failureTypes).length > 0) {
    console.log(`  ${c.bold}Failure patterns:${c.reset}`);
    const sorted = Object.entries(failureTypes).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sorted) {
      const pct = (count / endGates.length * 100).toFixed(0);
      console.log(`    ${type}: ${count} occurrences (${pct}% of sessions)`);
    }
    console.log();
  }

  // === Quality Check Analysis ===
  const qualityFailures = {};
  for (const o of endGates) {
    for (const qr of (o.quality_results || [])) {
      if (!qr.passed) {
        qualityFailures[qr.name] = (qualityFailures[qr.name] || 0) + 1;
      }
    }
  }

  if (Object.keys(qualityFailures).length > 0) {
    console.log(`  ${c.bold}Quality check failures:${c.reset}`);
    for (const [name, count] of Object.entries(qualityFailures)) {
      const pct = (count / endGates.length * 100).toFixed(0);
      const severity = pct > 50 ? c.red : pct > 25 ? c.yellow : c.dim;
      console.log(`    ${severity}${name}: failed in ${count}/${endGates.length} sessions (${pct}%)${c.reset}`);
    }
    console.log();
  }

  // === Consumer Sync Analysis ===
  const syncViolations = endGates.filter(o => o.consumer_sync?.violations > 0);
  if (syncViolations.length > 0) {
    console.log(`  ${c.bold}Consumer sync violations:${c.reset} ${syncViolations.length}/${endGates.length} sessions`);
    console.log(`    ${c.dim}Anchors were modified without all consumers being updated.${c.reset}\n`);
  }

  // === Threshold Calibration Suggestions ===
  console.log(`  ${c.bold}${c.cyan}Calibration Suggestions:${c.reset}`);
  console.log(`  ${c.dim}(One-way ratchet: only tightening, never loosening)${c.reset}\n`);

  const suggestions = [];
  const currentThresholds = config.thresholds || {};

  // If pass rate is very high (>90%), thresholds might be too loose
  if (passRate > 90 && endGates.length >= 10) {
    const currentMax = currentThresholds.max_file_lines || 400;
    const suggested = Math.max(200, Math.round(currentMax * 0.85));
    if (suggested < currentMax) {
      suggestions.push({
        field: 'thresholds.max_file_lines',
        current: currentMax,
        suggested,
        reason: `${passRate}% pass rate over ${endGates.length} sessions — threshold can be tightened`,
      });
    }
  }

  // If lint/typecheck fails frequently, suggest upgrading to block
  for (const [name, count] of Object.entries(qualityFailures)) {
    const pct = count / endGates.length * 100;
    if (pct > 30) {
      const check = (config.quality?.checks || []).find(c => c.name === name);
      if (check && check.on_fail === 'warn') {
        suggestions.push({
          field: `quality.checks[${name}].on_fail`,
          current: 'warn',
          suggested: 'block',
          reason: `${name} fails in ${pct.toFixed(0)}% of sessions — consider blocking to enforce`,
        });
      }
    }
  }

  // If consumer sync violations are frequent, suggest running trace impact more
  if (syncViolations.length >= 3) {
    suggestions.push({
      field: 'workflow',
      current: 'optional impact assessment',
      suggested: 'mandatory trace impact before anchor modifications',
      reason: `${syncViolations.length} consumer sync violations — anchor changes are not being propagated`,
    });
  }

  // If gates are on warn mode and pass rate is high, suggest switching to block
  if (config.gates?.end?.on_fail === 'warn' && passRate > 80 && endGates.length >= 10) {
    suggestions.push({
      field: 'gates.end.on_fail',
      current: 'warn',
      suggested: 'block',
      reason: `${passRate}% pass rate — team is ready for full enforcement`,
    });
  }

  if (suggestions.length === 0) {
    printPass('No calibration changes suggested at this time.');
    printInfo('Current thresholds are well-calibrated for your project.\n');
  } else {
    for (const s of suggestions) {
      console.log(`  ${c.yellow}▸${c.reset} ${c.bold}${s.field}${c.reset}`);
      console.log(`    Current: ${s.current} → Suggested: ${c.cyan}${s.suggested}${c.reset}`);
      console.log(`    ${c.dim}${s.reason}${c.reset}\n`);
    }
    printWarn('These are suggestions only. Review and apply manually in trace.yaml.');
    printInfo('TRACE never auto-adjusts thresholds.\n');
  }

  // Complexity trends — track anchor file sizes across sessions
  const anchors = config.anchors || [];
  const maxLines = config.thresholds?.max_file_lines || 400;
  const trending = [];
  for (const a of anchors) {
    const fp = path.join(root, a.file);
    if (!fileExists(fp)) continue;
    const lines = fs.readFileSync(fp, 'utf8').split('\n').length;
    const pct = Math.round(lines / maxLines * 100);
    if (pct >= 70) {
      const icon = pct >= 100 ? `${c.red}▲` : pct >= 85 ? `${c.yellow}▲` : `${c.dim}→`;
      trending.push({ id: a.id, lines, pct, icon });
    }
  }
  if (trending.length > 0) {
    console.log(`  ${c.bold}Complexity Watch:${c.reset}`);
    for (const t of trending.sort((a, b) => b.pct - a.pct)) {
      console.log(`    ${t.icon}${c.reset} ${t.id}: ${t.lines} lines (${t.pct}% of ${maxLines} threshold)`);
    }
    console.log();
  }

  // Coherence score
  try {
    const { calcCoherenceScore } = await import('./status.js');
    const { score } = calcCoherenceScore(root, config);
    const sc = score >= 80 ? c.green : score >= 60 ? c.yellow : c.red;
    console.log(`  ${c.bold}Coherence Score:${c.reset} ${sc}${c.bold}${score}/100${c.reset}\n`);
  } catch {}
}
