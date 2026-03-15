import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig, loadYaml, saveYaml,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, countLines, getTimestamp, getDateStamp
} from './utils.js';

/**
 * trace watch — File watcher with auto-session mode.
 *
 * Monitors the project for file changes. If no gate is open, automatically
 * opens a lightweight session, logs all changes, and closes after inactivity.
 *
 * This solves the "AI skips ceremony" problem: even if the AI never runs
 * trace gate start, the watcher captures what happened and maintains
 * project history.
 *
 * Flags:
 *   --auto-session    Enable auto-session mode (default: on)
 *   --no-auto-session Disable auto-session, just print warnings
 *   --timeout <min>   Inactivity timeout in minutes (default: 5)
 */
export function runWatch(args = []) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    process.exit(1);
  }

  const config = loadConfig(root);
  const anchors = config.anchors || [];

  if (anchors.length === 0) {
    printWarn('No anchors defined — nothing to watch.');
    printInfo('Define anchors in trace.yaml first.\n');
    return;
  }

  const autoSession = !args.includes('--no-auto-session');
  const timeoutIdx = args.indexOf('--timeout');
  const timeoutMin = timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1], 10) || 5 : 5;
  const INACTIVITY_MS = timeoutMin * 60 * 1000;

  const anchorFiles = new Set(anchors.map(a => a.file));
  const consumerToAnchor = {};
  for (const anchor of anchors) {
    for (const consumer of (anchor.consumers || [])) {
      if (!consumerToAnchor[consumer]) consumerToAnchor[consumer] = [];
      consumerToAnchor[consumer].push(anchor);
    }
  }
  const watchedFiles = new Set([...anchorFiles, ...Object.keys(consumerToAnchor)]);

  printHeader('TRACE Watch Mode');
  console.log(`  Monitoring ${c.bold}${watchedFiles.size}${c.reset} files (${anchors.length} anchors + consumers)`);
  if (autoSession) {
    console.log(`  ${c.green}Auto-session:${c.reset} ON (closes after ${timeoutMin}min inactivity)`);
  } else {
    console.log(`  ${c.dim}Auto-session: OFF (warnings only)${c.reset}`);
  }
  console.log(`  ${c.dim}Press Ctrl+C to stop.${c.reset}\n`);

  const session = {
    active: false,
    startTime: null,
    changes: [],
    anchorsModified: [],
    consumersModified: [],
    timer: null,
  };

  const checkpointPath = path.join(root, '.trace/LIVE_CHECKPOINT.yaml');
  if (fileExists(checkpointPath)) {
    const cp = loadYaml(checkpointPath);
    if (cp && cp.type !== 'auto-session') {
      printInfo(`Manual gate session detected. Auto-session will defer.\n`);
    }
  }

  const lastCheck = {};
  const DEBOUNCE_MS = 1500;

  for (const file of watchedFiles) {
    const fullPath = path.join(root, file);
    if (!fileExists(fullPath)) continue;
    try {
      fs.watch(fullPath, { persistent: true }, (eventType) => {
        if (eventType !== 'change') return;
        const now = Date.now();
        if (lastCheck[file] && (now - lastCheck[file]) < DEBOUNCE_MS) return;
        lastCheck[file] = now;
        setTimeout(() => {
          handleChange(root, config, file, anchorFiles, consumerToAnchor, session, autoSession, INACTIVITY_MS);
        }, 200);
      });
    } catch (e) {
      printWarn(`Cannot watch ${file}: ${e.message}`);
    }
  }

  try {
    fs.watch(path.join(root, 'trace.yaml'), { persistent: true }, (eventType) => {
      if (eventType !== 'change') return;
      const now = Date.now();
      if (lastCheck['trace.yaml'] && (now - lastCheck['trace.yaml']) < DEBOUNCE_MS) return;
      lastCheck['trace.yaml'] = now;
      setTimeout(() => printInfo(`${stamp()} trace.yaml modified — restart watch to pick up changes`), 200);
    });
  } catch (e) {}

  process.on('SIGINT', () => {
    if (session.active) closeAutoSession(root, session, config);
    console.log(`\n  ${c.dim}Watch stopped.${c.reset}\n`);
    process.exit(0);
  });
}

function handleChange(root, config, file, anchorFiles, consumerToAnchor, session, autoSession, inactivityMs) {
  const fullPath = path.join(root, file);
  const threshold = config.thresholds?.max_file_lines || 400;

  const cpPath = path.join(root, '.trace/LIVE_CHECKPOINT.yaml');
  const cp = fileExists(cpPath) ? loadYaml(cpPath) : null;
  const manualGateOpen = cp && cp.type !== 'auto-session';

  if (!fileExists(fullPath)) {
    printFail(`${stamp()} ${file} — DELETED`);
    return;
  }

  const lines = countLines(fullPath);
  let changeType = 'other';

  if (anchorFiles.has(file)) {
    changeType = 'anchor';
    const anchor = (config.anchors || []).find(a => a.file === file);
    const consumerCount = anchor?.consumers?.length || 0;

    if (lines > threshold) {
      printWarn(`${stamp()} ${c.bold}${file}${c.reset} (anchor: ${anchor.id}) — ${lines} lines ${c.red}exceeds ${threshold}${c.reset}`);
    } else {
      printPass(`${stamp()} ${c.bold}${file}${c.reset} (anchor: ${anchor.id}) — ${lines} lines`);
    }

    if (consumerCount > 0) {
      printWarn(`  Anchor modified — ${consumerCount} consumer(s) may need updating`);
    }

    if (!session.anchorsModified.includes(anchor.id)) {
      session.anchorsModified.push(anchor.id);
    }
  } else if (consumerToAnchor[file]) {
    changeType = 'consumer';
    const parents = consumerToAnchor[file];

    if (lines > threshold) {
      printWarn(`${stamp()} ${file} — ${lines} lines ${c.red}exceeds ${threshold}${c.reset}`);
    } else {
      printPass(`${stamp()} ${file} — ${lines} lines`);
    }

    for (const anchor of parents) {
      printInfo(`  Consumer of ${anchor.id} (${anchor.file})`);
    }

    if (!session.consumersModified.includes(file)) {
      session.consumersModified.push(file);
    }
  }

  if (!autoSession) {
    if (!manualGateOpen) {
      printWarn(`  ${c.yellow}No gate open.${c.reset} Run: trace gate start`);
    }
    return;
  }

  if (manualGateOpen) return;

  if (!session.active) openAutoSession(root, session);

  session.changes.push({ file, type: changeType, timestamp: getTimestamp(), lines });
  writeCheckpoint(root, session);

  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => closeAutoSession(root, session, config), inactivityMs);
}

function openAutoSession(root, session) {
  session.active = true;
  session.startTime = getTimestamp();
  session.changes = [];
  session.anchorsModified = [];
  session.consumersModified = [];
  console.log();
  console.log(`  ${c.cyan}${c.bold}AUTO-SESSION OPENED${c.reset} ${c.dim}${session.startTime}${c.reset}`);
  console.log(`  ${c.dim}Changes detected without a manual gate. Recording automatically.${c.reset}`);
  console.log();
}

function closeAutoSession(root, session, config) {
  if (!session.active) return;

  const endTime = getTimestamp();
  const changeCount = session.changes.length;

  console.log();
  console.log(`  ${c.cyan}${c.bold}AUTO-SESSION CLOSING${c.reset} ${c.dim}${endTime}${c.reset}`);
  console.log(`  ${c.dim}${changeCount} file change(s) recorded.${c.reset}`);

  // Check for unsynced consumers
  const unsyncedConsumers = [];
  for (const anchorId of session.anchorsModified) {
    const anchor = (config.anchors || []).find(a => a.id === anchorId);
    if (!anchor) continue;
    for (const consumer of (anchor.consumers || [])) {
      if (!session.consumersModified.includes(consumer)) {
        unsyncedConsumers.push({ anchor: anchorId, consumer });
      }
    }
  }

  if (unsyncedConsumers.length > 0) {
    console.log();
    printFail('Consumer drift detected:');
    for (const u of unsyncedConsumers) {
      printFail(`  ${u.anchor} changed but ${u.consumer} was not updated`);
    }
    printInfo('  Run: trace check — or fix before committing');
  }

  // Write to PROJECT_LOG
  const logPath = path.join(root, '.trace/PROJECT_LOG.md');
  if (fileExists(logPath)) {
    const uniqueFiles = [...new Set(session.changes.map(ch => ch.file))];
    const lines = [
      '', `## Auto-Session | ${session.startTime} — ${endTime}`, '',
      '_Recorded by trace watch (no manual gate was opened)._', '',
      `**Files modified (${uniqueFiles.length}):** ${uniqueFiles.join(', ')}`,
    ];
    if (session.anchorsModified.length > 0) {
      lines.push(`**Anchors modified:** ${session.anchorsModified.join(', ')}`);
    }
    if (unsyncedConsumers.length > 0) {
      lines.push(`**WARNING — Unsynced consumers:** ${unsyncedConsumers.map(u => u.consumer).join(', ')}`);
    }
    lines.push('');
    try {
      fs.appendFileSync(logPath, lines.join('\n') + '\n');
      printPass('Summary written to PROJECT_LOG.md');
    } catch (e) {
      printWarn(`Could not write to PROJECT_LOG: ${e.message}`);
    }
  }

  // Update HANDOFF
  const handoffPath = path.join(root, '.trace/HANDOFF.md');
  if (fileExists(handoffPath)) {
    try {
      const note = [
        '', '## Last Activity (auto-recorded)', '',
        `**When:** ${endTime}`,
        `**What:** ${changeCount} file change(s) via trace watch auto-session`,
        `**Files:** ${[...new Set(session.changes.map(ch => ch.file))].join(', ')}`,
      ];
      if (unsyncedConsumers.length > 0) {
        note.push(`**ACTION NEEDED:** Consumer drift detected — run trace check`);
      }
      note.push('');
      fs.appendFileSync(handoffPath, note.join('\n') + '\n');
      printPass('HANDOFF.md updated');
    } catch (e) {}
  }

  // Clean up checkpoint
  const cpPath = path.join(root, '.trace/LIVE_CHECKPOINT.yaml');
  try { if (fileExists(cpPath)) fs.unlinkSync(cpPath); } catch {}

  if (unsyncedConsumers.length > 0) {
    console.log();
    printWarn(`${c.bold}Pre-commit hook will block until drift is resolved.${c.reset}`);
    printInfo('Run: trace hook status — to check if the hook is installed.');
  } else {
    printPass('No drift detected. Safe to commit.');
  }
  console.log();

  session.active = false;
  session.startTime = null;
  session.changes = [];
  session.anchorsModified = [];
  session.consumersModified = [];
  session.timer = null;
}

function writeCheckpoint(root, session) {
  const cpPath = path.join(root, '.trace/LIVE_CHECKPOINT.yaml');
  try {
    saveYaml(cpPath, {
      type: 'auto-session',
      started: session.startTime,
      last_activity: getTimestamp(),
      changes_count: session.changes.length,
      anchors_modified: session.anchorsModified,
      files: [...new Set(session.changes.map(ch => ch.file))],
    });
  } catch (e) {}
}

function stamp() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${c.dim}[${h}:${m}:${s}]${c.reset}`;
}
