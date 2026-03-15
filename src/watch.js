import fs from 'fs';
import path from 'path';
import {
  c, findProjectRoot, loadConfig,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, countLines
} from './utils.js';

/**
 * trace watch — File watcher mode.
 * Monitors the project for file changes and runs targeted coherence checks.
 * Only checks anchors and consumers that are affected by the changed file.
 * Ctrl+C to stop.
 */
export function runWatch() {
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

  // Build lookup maps
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
  console.log(`  ${c.dim}Press Ctrl+C to stop.${c.reset}\n`);

  // Track file modification times to debounce
  const lastCheck = {};
  const DEBOUNCE_MS = 1500;

  // Watch each file
  for (const file of watchedFiles) {
    const fullPath = path.join(root, file);
    if (!fileExists(fullPath)) continue;

    try {
      fs.watch(fullPath, { persistent: true }, (eventType) => {
        if (eventType !== 'change') return;

        const now = Date.now();
        if (lastCheck[file] && (now - lastCheck[file]) < DEBOUNCE_MS) return;
        lastCheck[file] = now;

        // Small delay to let the write finish
        setTimeout(() => checkFile(root, config, file, anchorFiles, consumerToAnchor), 200);
      });
    } catch (e) {
      printWarn(`Cannot watch ${file}: ${e.message}`);
    }
  }

  // Also watch trace.yaml itself
  try {
    fs.watch(path.join(root, 'trace.yaml'), { persistent: true }, (eventType) => {
      if (eventType !== 'change') return;
      const now = Date.now();
      if (lastCheck['trace.yaml'] && (now - lastCheck['trace.yaml']) < DEBOUNCE_MS) return;
      lastCheck['trace.yaml'] = now;
      setTimeout(() => {
        printInfo(`${timestamp()} trace.yaml modified — reload with Ctrl+C and restart`);
      }, 200);
    });
  } catch (e) {}

  // Keep process alive
  process.on('SIGINT', () => {
    console.log(`\n  ${c.dim}Watch stopped.${c.reset}\n`);
    process.exit(0);
  });
}

/**
 * Check a single file that changed.
 */
function checkFile(root, config, file, anchorFiles, consumerToAnchor) {
  const ts = timestamp();
  const fullPath = path.join(root, file);

  if (!fileExists(fullPath)) {
    printFail(`${ts} ${file} — DELETED (was a tracked file)`);
    return;
  }

  // Complexity check
  const lines = countLines(fullPath);
  const threshold = config.thresholds?.max_file_lines || 400;

  if (anchorFiles.has(file)) {
    // Anchor file changed
    const anchor = (config.anchors || []).find(a => a.file === file);
    const consumerCount = anchor?.consumers?.length || 0;

    if (lines > threshold) {
      printWarn(`${ts} ${c.bold}${file}${c.reset} (anchor: ${anchor.id}) — ${lines} lines ${c.red}exceeds ${threshold}${c.reset}`);
    } else {
      printPass(`${ts} ${c.bold}${file}${c.reset} (anchor: ${anchor.id}) — ${lines} lines OK`);
    }

    if (consumerCount > 0) {
      printInfo(`  ${c.yellow}⚠${c.reset}  Anchor modified — ${consumerCount} consumer(s) may need updating`);
      printInfo(`  ${c.dim}Run: trace impact ${anchor.id}${c.reset}`);
    }
  } else if (consumerToAnchor[file]) {
    // Consumer file changed
    const parentAnchors = consumerToAnchor[file];

    if (lines > threshold) {
      printWarn(`${ts} ${file} — ${lines} lines ${c.red}exceeds ${threshold}${c.reset}`);
    } else {
      printPass(`${ts} ${file} — ${lines} lines OK`);
    }

    for (const anchor of parentAnchors) {
      printInfo(`  ${c.dim}Consumer of ${anchor.id} (${anchor.file})${c.reset}`);
    }
  }
}

function timestamp() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${c.dim}[${h}:${m}:${s}]${c.reset}`;
}
