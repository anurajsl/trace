import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, getDateStamp
} from './utils.js';

/**
 * trace acknowledge <anchor_id> <consumer_file> "reason"
 * 
 * Marks specific consumer drift as intentional. The consumer sync check
 * in gate end and trace check will skip acknowledged drift instead of
 * warning about it every session.
 *
 * trace acknowledge --list          Show all acknowledged drift
 * trace acknowledge --remove <idx>  Remove an acknowledgment by index
 */
export function runAcknowledge(args) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  // List mode
  if (args[0] === '--list' || args[0] === 'list') {
    listAcknowledged(root);
    return;
  }

  // Remove mode
  if (args[0] === '--remove' || args[0] === 'remove') {
    const idx = parseInt(args[1]);
    if (isNaN(idx)) {
      printFail('Usage: trace acknowledge --remove <index>');
      return;
    }
    removeAcknowledged(root, idx);
    return;
  }

  // Add mode: trace acknowledge <anchor_id> <consumer> "reason"
  const anchorId = args[0];
  const consumer = args[1];
  const reason = args.slice(2).join(' ').replace(/^["']|["']$/g, '');

  if (!anchorId || !consumer) {
    console.log(`\n${c.bold}Usage:${c.reset}`);
    console.log(`  ${c.cyan}trace acknowledge <anchor_id> <consumer_file> "reason"${c.reset}`);
    console.log(`  ${c.cyan}trace acknowledge --list${c.reset}              Show all acknowledged drift`);
    console.log(`  ${c.cyan}trace acknowledge --remove <index>${c.reset}    Remove by index\n`);
    console.log(`${c.dim}Example:${c.reset}`);
    console.log(`  ${c.cyan}trace acknowledge user_model docs/old-api.md "Deprecated, removing in v2"${c.reset}\n`);
    return;
  }

  // Validate anchor exists
  const config = loadConfig(root);
  const anchor = (config.anchors || []).find(a => a.id === anchorId);
  if (!anchor) {
    printFail(`Anchor "${anchorId}" not found in trace.yaml.`);
    printInfo(`Available anchors: ${(config.anchors || []).map(a => a.id).join(', ')}\n`);
    return;
  }

  // Validate consumer is listed
  const consumers = anchor.consumers || [];
  if (!consumers.includes(consumer)) {
    printWarn(`"${consumer}" is not listed as a consumer of ${anchorId}.`);
    printInfo('Acknowledging anyway (it may be an unlisted dependency).\n');
  }

  // Load or create acknowledged drift file
  const ackPath = path.join(root, '.trace/ACKNOWLEDGED_DRIFT.yaml');
  let ackData = { entries: [] };
  if (fileExists(ackPath)) {
    ackData = YAML.parse(fs.readFileSync(ackPath, 'utf8')) || { entries: [] };
  }

  // Check for duplicate
  const existing = ackData.entries.find(e => e.anchor === anchorId && e.consumer === consumer);
  if (existing) {
    printWarn(`Drift already acknowledged: ${anchorId} → ${consumer}`);
    printInfo(`Reason: ${existing.reason}\n`);
    return;
  }

  // Add entry
  ackData.entries.push({
    anchor: anchorId,
    consumer,
    reason: reason || 'Intentional drift',
    date: getDateStamp(),
  });

  fs.writeFileSync(ackPath, YAML.stringify(ackData, { lineWidth: 120 }));
  printPass(`Acknowledged drift: ${anchorId} → ${consumer}`);
  if (reason) printInfo(`Reason: ${reason}`);
  printInfo('This consumer will be skipped in future drift checks.\n');
}

function listAcknowledged(root) {
  const ackPath = path.join(root, '.trace/ACKNOWLEDGED_DRIFT.yaml');
  if (!fileExists(ackPath)) {
    printInfo('No acknowledged drift entries.\n');
    return;
  }

  const ackData = YAML.parse(fs.readFileSync(ackPath, 'utf8')) || { entries: [] };
  if (ackData.entries.length === 0) {
    printInfo('No acknowledged drift entries.\n');
    return;
  }

  printHeader('Acknowledged Drift');
  ackData.entries.forEach((e, i) => {
    console.log(`  ${c.dim}${i + 1}.${c.reset} ${c.bold}${e.anchor}${c.reset} → ${e.consumer}`);
    console.log(`     ${c.dim}${e.reason} (${e.date})${c.reset}`);
  });
  console.log();
}

function removeAcknowledged(root, idx) {
  const ackPath = path.join(root, '.trace/ACKNOWLEDGED_DRIFT.yaml');
  if (!fileExists(ackPath)) {
    printFail('No acknowledged drift entries.\n');
    return;
  }

  const ackData = YAML.parse(fs.readFileSync(ackPath, 'utf8')) || { entries: [] };
  if (idx < 1 || idx > ackData.entries.length) {
    printFail(`Invalid index. Use 1-${ackData.entries.length}.\n`);
    return;
  }

  const removed = ackData.entries.splice(idx - 1, 1)[0];
  fs.writeFileSync(ackPath, YAML.stringify(ackData, { lineWidth: 120 }));
  printPass(`Removed: ${removed.anchor} → ${removed.consumer}`);
  printInfo('This consumer will be checked for drift again.\n');
}

/**
 * Load acknowledged drift entries for use in check/gate.
 * Returns a Set of "anchor_id:consumer_file" strings for fast lookup.
 */
export function loadAcknowledgedDrift(root) {
  const ackPath = path.join(root, '.trace/ACKNOWLEDGED_DRIFT.yaml');
  if (!fileExists(ackPath)) return new Set();

  try {
    const data = YAML.parse(fs.readFileSync(ackPath, 'utf8')) || { entries: [] };
    return new Set(data.entries.map(e => `${e.anchor}:${e.consumer}`));
  } catch {
    return new Set();
  }
}
