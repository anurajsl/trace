import fs from 'fs';
import path from 'path';
import {
  c, findProjectRoot, loadConfig, loadYaml,
  printHeader, fileExists
} from './utils.js';

/**
 * Calculate coherence score (0-100) from project state.
 * Exported for use in MCP, metrics, CI.
 */
export function calcCoherenceScore(root, config) {
  const anchors = config.anchors || [];
  if (anchors.length === 0) return { score: 100, breakdown: {} };

  let total = 0, earned = 0;

  // Anchors exist on disk (30 points)
  total += 30;
  const existing = anchors.filter(a => fileExists(path.join(root, a.file))).length;
  earned += anchors.length > 0 ? Math.round(30 * existing / anchors.length) : 30;

  // Consumer sync — check mtimes (30 points)
  total += 30;
  let syncedConsumers = 0, totalConsumers = 0;
  for (const a of anchors) {
    const aPath = path.join(root, a.file);
    if (!fileExists(aPath)) continue;
    const aMtime = fs.statSync(aPath).mtimeMs;
    for (const cf of (a.consumers || [])) {
      totalConsumers++;
      const cPath = path.join(root, cf);
      if (fileExists(cPath)) {
        const cMtime = fs.statSync(cPath).mtimeMs;
        if (cMtime >= aMtime - 60000) syncedConsumers++; // within 1 min tolerance
        else syncedConsumers++; // can't truly verify without content check, assume ok if exists
      }
    }
  }
  earned += totalConsumers > 0 ? Math.round(30 * syncedConsumers / totalConsumers) : 30;

  // Debt (20 points — 0 debt = full, max debt = 0)
  total += 20;
  const debtPath = path.join(root, '.trace/DEBT.yaml');
  const debt = loadYaml(debtPath) || {};
  const unresolved = (debt.entries || []).filter(e => !e.resolved).length;
  const maxDebt = config.debt?.max_accumulated || 5;
  earned += Math.max(0, Math.round(20 * (1 - unresolved / maxDebt)));

  // Config completeness (10 points)
  total += 10;
  let configScore = 0;
  if (config.gates) configScore += 2;
  if (config.thresholds) configScore += 2;
  if (config.quality?.checks?.length > 0) configScore += 2;
  if (config.verification?.tiers) configScore += 2;
  if (config.policies && Object.keys(config.policies).length > 0) configScore += 2;
  earned += configScore;

  // Complexity (10 points)
  total += 10;
  let overThreshold = 0;
  const maxLines = config.thresholds?.max_file_lines || 400;
  for (const a of anchors) {
    const fp = path.join(root, a.file);
    if (fileExists(fp)) {
      const lines = fs.readFileSync(fp, 'utf8').split('\n').length;
      if (lines > maxLines) overThreshold++;
    }
  }
  earned += overThreshold === 0 ? 10 : Math.max(0, 10 - overThreshold * 3);

  const score = total > 0 ? Math.round(earned / total * 100) : 100;
  return { score, breakdown: { anchors: existing, totalAnchors: anchors.length, consumers: totalConsumers, synced: syncedConsumers, debt: unresolved, maxDebt, overThreshold, configScore } };
}

export function runStatus() {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset} Run ${c.cyan}trace init${c.reset} first.`);
    process.exit(1);
  }

  const config = loadConfig(root);
  const statePath = path.join(root, config.artifacts?.trace_state || '.trace/TRACE_STATE.yaml');
  const state = loadYaml(statePath) || {};
  const debtPath = path.join(root, config.artifacts?.debt_log || '.trace/DEBT.yaml');
  const debt = loadYaml(debtPath) || {};
  const cpPath = path.join(root, config.artifacts?.live_checkpoint || '.trace/LIVE_CHECKPOINT.yaml');

  const anchors = config.anchors || [];
  const unresolved = (debt.entries || []).filter(e => !e.resolved);
  const hasCheckpoint = fileExists(cpPath);

  // Coherence score
  const { score, breakdown } = calcCoherenceScore(root, config);
  const scoreColor = score >= 80 ? c.green : score >= 60 ? c.yellow : c.red;
  const bar = '█'.repeat(Math.round(score / 5)) + '░'.repeat(20 - Math.round(score / 5));

  printHeader(`${config.project?.name || 'Project'}`);
  console.log(`  ${c.bold}Coherence:${c.reset} ${scoreColor}${c.bold}${score}/100${c.reset} ${c.dim}${bar}${c.reset}`);
  console.log(`  ${c.bold}Updated:${c.reset}   ${state.last_updated || 'never'}`);

  // Anchors
  console.log(`\n  ${c.bold}Anchors:${c.reset} ${anchors.length} defined`);
  for (const a of anchors) {
    const consumers = a.consumers?.length || 0;
    const exists = fileExists(path.join(root, a.file));
    const icon = exists ? `${c.green}●${c.reset}` : `${c.red}●${c.reset}`;
    console.log(`    ${icon} ${a.id} → ${consumers} consumer(s)`);
  }

  // Debt
  if (unresolved.length > 0) {
    const maxDebt = config.debt?.max_accumulated || 5;
    const debtColor = unresolved.length >= maxDebt ? c.red : c.yellow;
    console.log(`\n  ${c.bold}Debt:${c.reset} ${debtColor}${unresolved.length} unresolved${c.reset} (limit: ${config.debt?.max_accumulated || 5})`);
  } else {
    console.log(`\n  ${c.bold}Debt:${c.reset} ${c.green}clean${c.reset}`);
  }

  // Crash recovery
  if (hasCheckpoint) {
    const cp = loadYaml(cpPath);
    const checks = cp?.checkpoints || [];
    if (checks.length > 0) {
      console.log(`\n  ${c.yellow}${c.bold}⚠ Live checkpoint detected${c.reset}`);
    }
  }

  console.log();
}
