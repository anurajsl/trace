import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig, loadYaml, saveYaml,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, getDateStamp
} from './utils.js';

const IMPACT_FILE = '.trace/IMPACT_ASSESSMENT.yaml';

/**
 * Hash a file's content for change detection
 */
function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath, 'utf8')).digest('hex').slice(0, 16);
}

/**
 * trace impact <anchor_id>
 * Runs a full blast radius analysis for an anchor before work begins.
 * Answers: What consumers will be affected? Is this additive or breaking?
 */
export function runImpact(args) {
  const anchorId = args[0];
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  const config = loadConfig(root);

  if (!anchorId) {
    printHeader('TRACE Impact Assessment');
    console.log(`  Usage: ${c.cyan}trace impact <anchor_id>${c.reset}\n`);
    console.log(`  Runs a blast radius analysis before modifying an anchor.`);
    console.log(`  Lists all consumers that must be updated if the anchor changes.\n`);
    console.log(`  ${c.bold}Available anchors:${c.reset}`);
    for (const a of (config.anchors || [])) {
      console.log(`    ${c.cyan}${a.id}${c.reset} \u2192 ${a.file} (${(a.consumers || []).length} consumers)`);
    }
    console.log();
    return;
  }

  const anchor = (config.anchors || []).find(a => a.id === anchorId);
  if (!anchor) {
    printFail(`Anchor "${anchorId}" not found in trace.yaml`);
    return;
  }

  printHeader(`Impact Assessment: ${anchor.id}`);
  console.log(`  ${c.bold}Anchor file:${c.reset} ${anchor.file}`);
  console.log(`  ${c.bold}Description:${c.reset} ${anchor.description || '(none)'}\n`);

  // 1. Check anchor file exists and get current hash
  const anchorPath = path.join(root, anchor.file);
  if (!fileExists(anchorPath)) {
    printFail(`Anchor file not found: ${anchor.file}`);
    return;
  }
  const anchorHash = hashFile(anchorPath);
  console.log(`  ${c.dim}Current hash: ${anchorHash}${c.reset}\n`);

  // 2. Consumer blast radius
  const consumers = anchor.consumers || [];
  console.log(`  ${c.bold}Consumer blast radius: ${consumers.length} file(s)${c.reset}\n`);

  const consumerStatus = [];
  for (const consumerFile of consumers) {
    const consumerPath = path.join(root, consumerFile);
    const exists = fileExists(consumerPath);
    const hash = exists ? hashFile(consumerPath) : null;

    // Check if this consumer is also an anchor (cross-anchor dependency)
    const isAlsoAnchor = (config.anchors || []).some(a => a.file === consumerFile && a.id !== anchorId);

    const status = {
      file: consumerFile,
      exists,
      hash,
      isAnchor: isAlsoAnchor,
      cascadeConsumers: 0,
    };

    if (isAlsoAnchor) {
      const otherAnchor = config.anchors.find(a => a.file === consumerFile);
      status.cascadeConsumers = (otherAnchor.consumers || []).length;
    }

    consumerStatus.push(status);

    if (!exists) {
      printFail(`  ${consumerFile} \u2014 MISSING`);
    } else if (isAlsoAnchor) {
      printWarn(`  ${consumerFile} \u2014 also an anchor (cascade: ${status.cascadeConsumers} more consumers)`);
    } else {
      printInfo(`  ${consumerFile}`);
    }
  }

  // 3. Cascade analysis
  const cascadeAnchors = consumerStatus.filter(s => s.isAnchor);
  if (cascadeAnchors.length > 0) {
    console.log(`\n  ${c.bold}${c.yellow}Cascade warning:${c.reset} ${cascadeAnchors.length} consumer(s) are also anchors.`);
    console.log(`  ${c.dim}Changing ${anchor.id} may trigger changes in:${c.reset}`);
    let totalCascade = 0;
    for (const ca of cascadeAnchors) {
      const otherAnchor = config.anchors.find(a => a.file === ca.file);
      console.log(`    ${c.yellow}\u2192${c.reset} ${otherAnchor.id} (${ca.cascadeConsumers} consumers)`);
      totalCascade += ca.cascadeConsumers;
    }
    console.log(`  ${c.bold}Total blast radius: ${consumers.length} direct + ${totalCascade} transitive = ${consumers.length + totalCascade} files${c.reset}`);
  }

  // 4. Risk assessment
  console.log(`\n  ${c.bold}Pre-work checklist:${c.reset}`);
  console.log(`  ${c.dim}\u2610${c.reset} Is this change additive (new fields with defaults) or breaking (interface mutation)?`);
  console.log(`  ${c.dim}\u2610${c.reset} Do all ${consumers.length} consumers need updating, or only some?`);
  console.log(`  ${c.dim}\u2610${c.reset} Should this anchor be split? (Has its responsibility grown too large?)`);
  if (cascadeAnchors.length > 0) {
    console.log(`  ${c.dim}\u2610${c.reset} Have you assessed the cascade impact on transitive consumers?`);
  }
  console.log();

  // 5. Save snapshot for end-gate verification
  const assessment = {
    anchor_id: anchorId,
    anchor_file: anchor.file,
    anchor_hash_before: anchorHash,
    assessed_at: new Date().toISOString(),
    consumers: consumerStatus.map(s => ({
      file: s.file,
      hash_before: s.hash,
      exists: s.exists,
      is_cascade_anchor: s.isAnchor,
    })),
    total_blast_radius: consumers.length + cascadeAnchors.reduce((sum, ca) => sum + ca.cascadeConsumers, 0),
  };

  const impactPath = path.join(root, IMPACT_FILE);
  const existing = fileExists(impactPath) ? (loadYaml(impactPath) || { assessments: [] }) : { assessments: [] };
  existing.assessments = existing.assessments.filter(a => a.anchor_id !== anchorId);
  existing.assessments.push(assessment);
  saveYaml(impactPath, existing);

  printPass(`Impact snapshot saved to ${IMPACT_FILE}`);
  printInfo('End gate will verify all consumers were updated if anchor changes.\n');
}

/**
 * Verify consumer sync at gate end.
 * Called by gate.js — checks if any anchor changed during the session
 * and whether all its consumers were also updated.
 *
 * Returns { passed, violations: [{anchor, staleConsumers}] }
 */
export function verifyConsumerSync(root, config) {
  const impactPath = path.join(root, IMPACT_FILE);
  if (!fileExists(impactPath)) {
    return { passed: true, violations: [], skipped: true };
  }

  const data = loadYaml(impactPath);
  if (!data?.assessments || data.assessments.length === 0) {
    return { passed: true, violations: [], skipped: true };
  }

  const violations = [];

  for (const assessment of data.assessments) {
    const anchorPath = path.join(root, assessment.anchor_file);
    if (!fileExists(anchorPath)) continue;

    const currentAnchorHash = hashFile(anchorPath);
    const anchorChanged = currentAnchorHash !== assessment.anchor_hash_before;

    if (!anchorChanged) continue;

    // Anchor was modified — check if all consumers were also updated
    const staleConsumers = [];
    for (const consumer of assessment.consumers) {
      if (!consumer.exists) continue;
      const consumerPath = path.join(root, consumer.file);
      if (!fileExists(consumerPath)) continue;

      const currentHash = hashFile(consumerPath);
      if (currentHash === consumer.hash_before) {
        staleConsumers.push(consumer.file);
      }
    }

    if (staleConsumers.length > 0) {
      violations.push({
        anchor: assessment.anchor_id,
        anchorFile: assessment.anchor_file,
        staleConsumers,
        totalConsumers: assessment.consumers.length,
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    skipped: false,
  };
}

/**
 * Clean up impact assessments (called after successful gate end)
 */
export function clearImpactAssessments(root) {
  const impactPath = path.join(root, IMPACT_FILE);
  if (fileExists(impactPath)) {
    fs.unlinkSync(impactPath);
  }
}
