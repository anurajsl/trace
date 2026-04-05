import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  c, findProjectRoot, loadConfig, loadYaml,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, countLines, matchesPattern, walkDir
} from './utils.js';
import { loadAcknowledgedDrift } from './acknowledge.js';
import { calcCoherenceScore } from './status.js';

export function runCheck(flags = {}) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset} Run ${c.cyan}trace init${c.reset} first.`);
    process.exit(1);
  }

  const config = loadConfig(root);
  const results = { pass: 0, fail: 0, warn: 0 };

  printHeader(`TRACE Check — ${config.project?.name || 'Unknown Project'}`);

  // ─── PILLAR T: Truth Anchoring ───
  checkAnchors(root, config, results);

  // ─── PILLAR R: Registry Enforcement ───
  checkRegistry(root, config, results);

  // ─── PILLAR A: Automated Verification ───
  if (!flags.skipTests) {
    checkVerification(root, config, results);
  }

  // ─── PILLAR C: Controlled Evolution ───
  checkThresholds(root, config, results);

  // ─── DEBT ───
  checkDebt(root, config, results);

  // ─── INSIGHTS (non-blocking) ───
  if (!flags.brief) {
    discoverUnregisteredAnchors(root, config);
    detectDeadConsumers(root, config);
  }

  // ─── COHERENCE SCORE ───
  const { score } = calcCoherenceScore(root, config);
  const sc = score >= 80 ? c.green : score >= 60 ? c.yellow : c.red;
  console.log(`  ${c.bold}Coherence Score:${c.reset} ${sc}${c.bold}${score}/100${c.reset}\n`);

  // ─── SUMMARY ───
  printSummary(results);
  return results;
}

function checkAnchors(root, config, results) {
  const anchors = config.anchors || [];
  if (anchors.length === 0) {
    printWarn('No anchors defined in trace.yaml');
    printInfo('Define anchors to enable coherence checking');
    results.warn++;
    return;
  }

  console.log(`${c.bold}  Anchors${c.reset} (${anchors.length} defined)\n`);

  for (const anchor of anchors) {
    const anchorPath = path.join(root, anchor.file);

    // Check anchor file exists
    if (!fileExists(anchorPath)) {
      printFail(`${anchor.id}: anchor file missing → ${anchor.file}`);
      results.fail++;
      continue;
    }

    // Check each consumer exists
    const consumers = anchor.consumers || [];
    let consumerIssues = 0;
    for (const consumer of consumers) {
      const consumerPath = path.join(root, consumer);
      if (!fileExists(consumerPath)) {
        printFail(`${anchor.id}: consumer missing → ${consumer}`);
        results.fail++;
        consumerIssues++;
      }
    }

    // Check anchor freshness (modified more recently than consumers?)
    if (consumerIssues === 0) {
      const anchorMtime = fs.statSync(anchorPath).mtimeMs;
      const staleConsumers = [];
      for (const consumer of consumers) {
        const consumerPath = path.join(root, consumer);
        const consumerMtime = fs.statSync(consumerPath).mtimeMs;
        // If anchor is newer than consumer, consumer may be stale
        if (anchorMtime > consumerMtime + 1000) {
          staleConsumers.push(consumer);
        }
      }

      // Filter out acknowledged drift
      const acknowledged = loadAcknowledgedDrift(root);
      const realDrift = staleConsumers.filter(c => !acknowledged.has(`${anchor.id}:${c}`));
      const ackCount = staleConsumers.length - realDrift.length;

      if (realDrift.length > 0) {
        printWarn(`${anchor.id}: anchor updated after ${realDrift.length} consumer(s) — possible drift`);
        for (const s of realDrift) printInfo(`  → ${s}`);
        if (ackCount > 0) printInfo(`  ${c.dim}(${ackCount} acknowledged drift skipped)${c.reset}`);
        results.warn++;
      } else if (ackCount > 0) {
        printPass(`${anchor.id}: ${consumers.length} consumer(s) coherent ${c.dim}(${ackCount} acknowledged)${c.reset}`);
        results.pass++;
      } else {
        printPass(`${anchor.id}: ${consumers.length} consumer(s) coherent`);
        results.pass++;
      }
    }

    // Run sync check if defined
    if (anchor.sync_check) {
      try {
        execSync(anchor.sync_check, { cwd: root, stdio: 'pipe', timeout: 30000 });
        printPass(`${anchor.id}: sync check passed`);
        results.pass++;
      } catch {
        printFail(`${anchor.id}: sync check failed → ${anchor.sync_check}`);
        results.fail++;
      }
    }
  }
  console.log();
}

function checkRegistry(root, config, results) {
  const registry = config.registry || {};
  const trackedDocs = registry.tracked_docs || [];

  if (trackedDocs.length === 0) return;

  console.log(`${c.bold}  Registry${c.reset} (${trackedDocs.length} tracked doc(s))\n`);

  for (const doc of trackedDocs) {
    if (!fileExists(path.join(root, doc.file))) {
      printFail(`Doc missing: ${doc.file}`);
      results.fail++;
      continue;
    }

    if (doc.verify) {
      try {
        execSync(doc.verify, { cwd: root, stdio: 'pipe', timeout: 30000 });
        printPass(`${doc.file}: verification passed`);
        results.pass++;
      } catch {
        printFail(`${doc.file}: verification failed → ${doc.verify}`);
        results.fail++;
      }
    } else {
      printPass(`${doc.file}: exists`);
      results.pass++;
    }
  }
  console.log();
}

function checkVerification(root, config, results) {
  const tiers = config.verification?.tiers || {};
  const hasAnyCommand = Object.values(tiers).some(t => t.command);
  if (!hasAnyCommand) return;

  console.log(`${c.bold}  Verification${c.reset}\n`);

  for (const [tierName, tier] of Object.entries(tiers)) {
    if (!tier.command) continue;

    try {
      const output = execSync(tier.command, { cwd: root, stdio: 'pipe', timeout: 120000 });
      printPass(`${tierName}: passed`);
      results.pass++;
    } catch (err) {
      printFail(`${tierName}: FAILED`);
      if (err.stderr) printInfo(`  ${err.stderr.toString().split('\n')[0]}`);
      results.fail++;
    }
  }
  console.log();
}

function checkThresholds(root, config, results) {
  const thresholds = config.thresholds || {};
  if (!thresholds.max_file_lines) return;

  console.log(`${c.bold}  Thresholds${c.reset}\n`);

  // Get all anchor files and core files to check
  const filesToCheck = new Set();
  const anchors = config.anchors || [];
  for (const a of anchors) {
    filesToCheck.add(a.file);
    for (const consumer of (a.consumers || [])) {
      filesToCheck.add(consumer);
    }
  }

  // Also check files matching core patterns
  const corePatterns = config.file_classification?.core?.patterns || [];
  if (corePatterns.length > 0) {
    const allFiles = walkDir(root);
    for (const f of allFiles) {
      if (corePatterns.some(p => matchesPattern(f, p))) {
        filesToCheck.add(f);
      }
    }
  }

  let violations = 0;
  for (const file of filesToCheck) {
    const fullPath = path.join(root, file);
    if (!fileExists(fullPath)) continue;
    if (!file.match(/\.(js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|cs)$/)) continue;

    const lines = countLines(fullPath);
    if (thresholds.max_file_lines && lines > thresholds.max_file_lines) {
      printWarn(`${file}: ${lines} lines (threshold: ${thresholds.max_file_lines})`);
      violations++;
    }
  }

  if (violations === 0) {
    printPass(`All checked files within thresholds`);
    results.pass++;
  } else {
    results.warn += violations;
  }
  console.log();
}

function checkDebt(root, config, results) {
  const debtPath = path.join(root, config.artifacts?.debt_log || '.trace/DEBT.yaml');
  const debt = loadYaml(debtPath);
  if (!debt?.entries?.length) return;

  const unresolved = debt.entries.filter(e => !e.resolved);
  if (unresolved.length === 0) return;

  console.log(`${c.bold}  Debt${c.reset} (${unresolved.length} unresolved)\n`);

  const maxDebt = config.debt?.max_accumulated || 5;
  for (const entry of unresolved) {
    const icon = entry.severity === 'major' ? c.red : c.yellow;
    console.log(`  ${icon}●${c.reset} [${entry.severity}] ${entry.description}`);
    printInfo(`    Resolve by: ${entry.resolve_by}`);
  }

  if (unresolved.length >= maxDebt) {
    printFail(`\n  Debt limit reached (${unresolved.length}/${maxDebt}). Resolution cycle required.`);
    results.fail++;
  } else {
    results.warn++;
  }
  console.log();
}

function printSummary(results) {
  const total = results.pass + results.fail + results.warn;
  const status = results.fail > 0 ? 'FAIL' : results.warn > 0 ? 'WARN' : 'PASS';
  const statusColor = results.fail > 0 ? c.bgRed : results.warn > 0 ? c.bgYellow : c.bgGreen;

  console.log(`${c.bold}  ─── Result ───${c.reset}`);
  console.log(`  ${statusColor}${c.bold} ${status} ${c.reset}  ${c.green}${results.pass} passed${c.reset}  ${c.red}${results.fail} failed${c.reset}  ${c.yellow}${results.warn} warnings${c.reset}`);

  if (results.fail > 0) {
    console.log(`\n  ${c.dim}Fix failures before proceeding. Run ${c.reset}${c.cyan}trace check${c.reset}${c.dim} again after fixes.${c.reset}`);
  }
  console.log();
}

/**
 * Discover files with 3+ importers that aren't registered as anchors.
 */
function discoverUnregisteredAnchors(root, config) {
  const anchors = config.anchors || [];
  const anchorFiles = new Set(anchors.map(a => a.file));
  const importCount = {};
  const srcExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go'];

  try {
    const files = walkDir(root).filter(f => srcExts.some(e => f.endsWith(e)));
    for (const file of files) {
      const rel = path.relative(root, file);
      if (rel.includes('node_modules') || rel.includes('.trace')) continue;
      try {
        const content = fs.readFileSync(file, 'utf8');
        const imports = content.match(/(?:import|require|from)\s+['"]([^'"]+)['"]/g) || [];
        for (const imp of imports) {
          const match = imp.match(/['"]([^'"]+)['"]/);
          if (!match) continue;
          const target = match[1];
          if (target.startsWith('.')) {
            const resolved = path.relative(root, path.resolve(path.dirname(file), target));
            // Try with extensions
            for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
              const full = resolved + ext;
              importCount[full] = (importCount[full] || 0) + 1;
            }
          }
        }
      } catch {}
    }

    const suggestions = Object.entries(importCount)
      .filter(([f, count]) => count >= 3 && !anchorFiles.has(f) && fileExists(path.join(root, f)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (suggestions.length > 0) {
      console.log(`  ${c.cyan}${c.bold}Suggested anchors${c.reset} ${c.dim}(files with 3+ importers not in trace.yaml):${c.reset}`);
      for (const [file, count] of suggestions) {
        console.log(`    ${c.cyan}→${c.reset} ${file} ${c.dim}(${count} importers)${c.reset}`);
      }
      console.log();
    }
  } catch {}
}

/**
 * Detect consumer relationships where the consumer no longer imports from the anchor.
 */
function detectDeadConsumers(root, config) {
  const anchors = config.anchors || [];
  const dead = [];

  for (const anchor of anchors) {
    const anchorBase = path.basename(anchor.file, path.extname(anchor.file));
    for (const consumer of (anchor.consumers || [])) {
      const cPath = path.join(root, consumer);
      if (!fileExists(cPath)) continue;
      try {
        const content = fs.readFileSync(cPath, 'utf8');
        // Check if consumer still references the anchor (by filename or path)
        const anchorDir = path.dirname(anchor.file);
        const relPath = path.relative(path.dirname(consumer), anchor.file).replace(/\\/g, '/').replace(/\.[^.]+$/, '');
        if (!content.includes(anchorBase) && !content.includes(relPath) && !content.includes(anchor.file)) {
          dead.push({ anchor: anchor.id, consumer });
        }
      } catch {}
    }
  }

  if (dead.length > 0) {
    console.log(`  ${c.yellow}${c.bold}Stale consumers${c.reset} ${c.dim}(no longer reference their anchor):${c.reset}`);
    for (const d of dead.slice(0, 5)) {
      console.log(`    ${c.yellow}○${c.reset} ${d.anchor} → ${d.consumer}`);
    }
    console.log(`    ${c.dim}Consider removing from trace.yaml consumers list.${c.reset}\n`);
  }
}
