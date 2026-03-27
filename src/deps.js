import path from 'path';
import {
  c, findProjectRoot, loadConfig,
  printHeader, fileExists
} from './utils.js';

/**
 * trace deps [anchor_id] — Show dependency graph
 * Without args: show all anchors and their relationships
 * With anchor_id: show impact analysis for that anchor
 */
export function runDeps(anchorId) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset} Run ${c.cyan}trace init${c.reset} first.`);
    process.exit(1);
  }

  const config = loadConfig(root);
  const anchors = config.anchors || [];

  if (anchors.length === 0) {
    console.log(`  ${c.yellow}No anchors defined.${c.reset} Add anchors to trace.yaml first.\n`);
    return;
  }

  if (anchorId) {
    showImpactAnalysis(root, config, anchors, anchorId);
  } else {
    showFullGraph(root, config, anchors);
  }
}

function showFullGraph(root, config, anchors) {
  printHeader('Anchor Dependency Graph');

  // Build reverse map: file → which anchors it belongs to
  const fileToAnchor = new Map();
  for (const a of anchors) {
    fileToAnchor.set(a.file, a.id);
  }

  // Build consumer-to-anchor map
  const consumerToAnchors = new Map();
  for (const a of anchors) {
    for (const consumer of (a.consumers || [])) {
      if (!consumerToAnchors.has(consumer)) consumerToAnchors.set(consumer, []);
      consumerToAnchors.get(consumer).push(a.id);
    }
  }

  // Detect cross-anchor dependencies (anchor A's file is a consumer of anchor B)
  const crossDeps = new Map(); // anchor_id → [anchor_ids it depends on]
  for (const a of anchors) {
    const deps = [];
    // Check if this anchor's file is a consumer of another anchor
    for (const other of anchors) {
      if (other.id === a.id) continue;
      if ((other.consumers || []).includes(a.file)) {
        deps.push(other.id);
      }
    }
    // Check if any consumer of this anchor is also an anchor
    for (const consumer of (a.consumers || [])) {
      if (fileToAnchor.has(consumer) && fileToAnchor.get(consumer) !== a.id) {
        // This anchor has a consumer that is itself an anchor
      }
    }
    if (deps.length > 0) crossDeps.set(a.id, deps);
  }

  for (const a of anchors) {
    const exists = fileExists(path.join(root, a.file));
    const icon = exists ? `${c.green}●${c.reset}` : `${c.red}●${c.reset}`;
    const consumers = a.consumers || [];

    console.log(`  ${icon} ${c.bold}${a.id}${c.reset}  ${c.dim}(${a.file})${c.reset}`);

    // Show cross-anchor dependencies
    if (crossDeps.has(a.id)) {
      console.log(`    ${c.cyan}depends on:${c.reset} ${crossDeps.get(a.id).join(', ')}`);
    }

    // Show consumers
    if (consumers.length > 0) {
      console.log(`    ${c.dim}consumers (${consumers.length}):${c.reset}`);
      for (const consumer of consumers) {
        const isAlsoAnchor = fileToAnchor.has(consumer);
        const marker = isAlsoAnchor ? ` ${c.cyan}(also anchor: ${fileToAnchor.get(consumer)})${c.reset}` : '';
        const consumerExists = fileExists(path.join(root, consumer));
        const cIcon = consumerExists ? `${c.dim}→${c.reset}` : `${c.red}✗${c.reset}`;
        console.log(`      ${cIcon} ${consumer}${marker}`);
      }
    } else {
      console.log(`    ${c.dim}no consumers defined${c.reset}`);
    }
    console.log();
  }

  // Summary stats
  const totalConsumers = anchors.reduce((sum, a) => sum + (a.consumers?.length || 0), 0);
  console.log(`  ${c.bold}Summary:${c.reset} ${anchors.length} anchors, ${totalConsumers} consumer relationships`);
  if (crossDeps.size > 0) {
    console.log(`  ${c.yellow}${crossDeps.size} cross-anchor dependencies detected${c.reset} — changes cascade`);
  }
  console.log();
}

function showImpactAnalysis(root, config, anchors, anchorId) {
  const anchor = anchors.find(a => a.id === anchorId);
  if (!anchor) {
    console.log(`  ${c.red}Anchor "${anchorId}" not found.${c.reset}`);
    console.log(`  Available anchors: ${anchors.map(a => a.id).join(', ')}\n`);
    return;
  }

  printHeader(`Impact Analysis — ${anchorId}`);

  const consumers = anchor.consumers || [];

  console.log(`  ${c.bold}Anchor:${c.reset} ${anchor.file}`);
  if (anchor.description) console.log(`  ${c.dim}${anchor.description}${c.reset}`);
  console.log();

  // Direct impact
  console.log(`  ${c.bold}Direct impact${c.reset} (${consumers.length} files):\n`);
  for (const consumer of consumers) {
    const exists = fileExists(path.join(root, consumer));
    const icon = exists ? `${c.green}→${c.reset}` : `${c.red}✗${c.reset}`;
    console.log(`    ${icon} ${consumer}`);
  }

  // Transitive impact: check if any consumer is itself an anchor
  const fileToAnchor = new Map();
  for (const a of anchors) {
    fileToAnchor.set(a.file, a);
  }

  const transitiveFiles = new Set();
  for (const consumer of consumers) {
    if (fileToAnchor.has(consumer)) {
      const transitiveAnchor = fileToAnchor.get(consumer);
      for (const tc of (transitiveAnchor.consumers || [])) {
        if (tc !== anchor.file && !consumers.includes(tc)) {
          transitiveFiles.add({ file: tc, via: transitiveAnchor.id });
        }
      }
    }
  }

  if (transitiveFiles.size > 0) {
    console.log(`\n  ${c.bold}Transitive impact${c.reset} (${transitiveFiles.size} additional files):\n`);
    for (const { file, via } of transitiveFiles) {
      console.log(`    ${c.yellow}→${c.reset} ${file} ${c.dim}(via ${via})${c.reset}`);
    }
  }

  // Risk assessment
  const totalImpact = consumers.length + transitiveFiles.size;
  const risk = totalImpact >= 10 ? 'HIGH' : totalImpact >= 5 ? 'MEDIUM' : 'LOW';
  const riskColor = risk === 'HIGH' ? c.red : risk === 'MEDIUM' ? c.yellow : c.green;

  console.log(`\n  ${c.bold}Risk:${c.reset} ${riskColor}${c.bold}${risk}${c.reset}`);
  console.log(`  ${c.bold}Total files affected:${c.reset} ${totalImpact} (${consumers.length} direct + ${transitiveFiles.size} transitive)`);

  // Recommendation
  const classification = config.file_classification?.core?.patterns || [];
  const isCore = classification.some(p => anchor.file.includes(p.replace('/**', '')));
  const minTier = isCore ? 'tier2' : 'tier1';
  console.log(`  ${c.bold}Min verification:${c.reset} ${minTier}`);

  if (totalImpact >= 5) {
    console.log(`\n  ${c.yellow}Recommendation:${c.reset} This anchor has significant downstream impact.`);
    console.log(`  Consider running tier2+ verification after any modifications.`);
  }
  console.log();
}
