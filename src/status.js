import fs from 'fs';
import path from 'path';
import {
  c, findProjectRoot, loadConfig, loadYaml,
  printHeader, fileExists
} from './utils.js';

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
  const healthColor = state.status?.health === 'red' ? c.red
    : state.status?.health === 'yellow' ? c.yellow : c.green;

  printHeader(`${config.project?.name || 'Project'}`);

  // Health bar
  const health = state.status?.health || 'unknown';
  console.log(`  ${c.bold}Health:${c.reset}  ${healthColor}${c.bold}${health.toUpperCase()}${c.reset}`);
  console.log(`  ${c.bold}Sprint:${c.reset}  ${state.current_sprint || 'not set'}`);
  console.log(`  ${c.bold}Updated:${c.reset} ${state.last_updated || 'never'}`);
  if (state.last_session_by) {
    console.log(`  ${c.bold}Last by:${c.reset} ${state.last_session_by}`);
  }

  // Anchors
  console.log(`\n  ${c.bold}Anchors:${c.reset} ${anchors.length} defined`);
  for (const a of anchors) {
    const consumers = a.consumers?.length || 0;
    const exists = fileExists(path.join(root, a.file));
    const icon = exists ? `${c.green}●${c.reset}` : `${c.red}●${c.reset}`;
    console.log(`    ${icon} ${a.id} → ${consumers} consumer(s)`);
  }

  // Verification
  const tiers = config.verification?.tiers || {};
  const configuredTiers = Object.entries(tiers).filter(([, t]) => t.command);
  if (configuredTiers.length > 0) {
    console.log(`\n  ${c.bold}Verification:${c.reset} ${configuredTiers.length} tier(s) configured`);
    for (const [name, tier] of configuredTiers) {
      const min = tier.min_count || 0;
      console.log(`    ${c.dim}${name}:${c.reset} ${tier.command} ${min > 0 ? `(min: ${min})` : ''}`);
    }
  }

  // Debt
  if (unresolved.length > 0) {
    const maxDebt = config.debt?.max_accumulated || 5;
    const debtColor = unresolved.length >= maxDebt ? c.red : c.yellow;
    console.log(`\n  ${c.bold}Debt:${c.reset} ${debtColor}${unresolved.length} unresolved${c.reset} (limit: ${maxDebt})`);
    for (const entry of unresolved) {
      console.log(`    ${c.dim}[${entry.severity}]${c.reset} ${entry.description}`);
    }
  } else {
    console.log(`\n  ${c.bold}Debt:${c.reset} ${c.green}clean${c.reset}`);
  }

  // Crash recovery
  if (hasCheckpoint) {
    const cp = loadYaml(cpPath);
    const checks = cp?.checkpoints || [];
    if (checks.length > 0) {
      console.log(`\n  ${c.yellow}${c.bold}⚠ Live checkpoint detected${c.reset} — previous session may have crashed`);
      const last = checks[checks.length - 1];
      console.log(`    ${c.dim}Last: ${last.next_step}${c.reset}`);
    }
  }

  // Next priorities
  if (state.next_priorities?.length > 0) {
    console.log(`\n  ${c.bold}Next:${c.reset}`);
    for (let i = 0; i < state.next_priorities.length; i++) {
      console.log(`    ${c.cyan}${i + 1}.${c.reset} ${state.next_priorities[i]}`);
    }
  }

  console.log();
}
