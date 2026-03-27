import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig, loadYaml,
  printHeader, printPass, printWarn, printInfo,
  fileExists, getTimestamp
} from './utils.js';

/**
 * Auto-capture file changes since last checkpoint using git diff.
 * Appends structured observation to PROJECT_LOG.md.
 * Called automatically by trace checkpoint.
 */
export function captureObservation(root, config, description) {
  const logPath = path.join(root, config.artifacts?.project_log || '.trace/PROJECT_LOG.md');
  if (!fileExists(logPath)) return;

  let changedFiles = [];
  try {
    const diff = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null', {
      cwd: root, encoding: 'utf8', timeout: 5000
    }).trim();
    if (diff) changedFiles = diff.split('\n').filter(f => f.trim());
  } catch (e) {
    // Not a git repo or git not available — silently skip
    return;
  }

  if (changedFiles.length === 0) return;

  // Classify changes against anchors
  const anchors = config.anchors || [];
  const anchorFiles = anchors.map(a => a.file);
  const consumerFiles = anchors.flatMap(a => a.consumers || []);
  
  const anchorChanges = changedFiles.filter(f => anchorFiles.includes(f));
  const consumerChanges = changedFiles.filter(f => consumerFiles.includes(f));
  const otherChanges = changedFiles.filter(f => !anchorFiles.includes(f) && !consumerFiles.includes(f));

  // Build observation entry
  let entry = `\n### Observation — ${getTimestamp()}\n`;
  if (description) entry += `**Context:** ${description}\n`;
  entry += `**Files changed:** ${changedFiles.length}\n`;
  
  if (anchorChanges.length > 0) {
    entry += `**Anchor changes:** ${anchorChanges.join(', ')}\n`;
  }
  if (consumerChanges.length > 0) {
    entry += `**Consumer changes:** ${consumerChanges.join(', ')}\n`;
  }
  if (otherChanges.length > 0) {
    entry += `**Other:** ${otherChanges.length} file(s)\n`;
  }
  entry += '\n';

  fs.appendFileSync(logPath, entry);
}

/**
 * trace search "query" — Full-text search across TRACE artifacts.
 * Searches: PROJECT_LOG.md, PLAN.yaml items, release notes, HANDOFF.md
 */
export function runSearch(args) {
  const query = args.join(' ').trim();
  if (!query) {
    console.log(`  Usage: ${c.cyan}trace search "query"${c.reset}`);
    console.log(`  Searches across project log, plan items, release notes, and handoff.\n`);
    return;
  }

  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  const config = loadConfig(root);
  printHeader(`Search: "${query}"`);

  const queryLower = query.toLowerCase();
  let totalHits = 0;

  // 1. Search PROJECT_LOG.md
  const logPath = path.join(root, config.artifacts?.project_log || '.trace/PROJECT_LOG.md');
  if (fileExists(logPath)) {
    const log = fs.readFileSync(logPath, 'utf8');
    const lines = log.split('\n');
    const hits = [];
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(queryLower)) {
        hits.push({ line: idx + 1, text: line.trim() });
      }
    });
    if (hits.length > 0) {
      console.log(`\n  ${c.bold}PROJECT_LOG.md${c.reset} ${c.dim}(${hits.length} match${hits.length > 1 ? 'es' : ''})${c.reset}`);
      for (const h of hits.slice(0, 8)) {
        const highlighted = h.text.replace(new RegExp(`(${query})`, 'gi'), `${c.cyan}$1${c.reset}`);
        console.log(`    ${c.dim}L${h.line}:${c.reset} ${highlighted}`);
      }
      if (hits.length > 8) console.log(`    ${c.dim}... and ${hits.length - 8} more${c.reset}`);
      totalHits += hits.length;
    }
  }

  // 2. Search PLAN.yaml items
  const planPath = path.join(root, '.trace/PLAN.yaml');
  if (fileExists(planPath)) {
    const plan = loadYaml(planPath);
    if (plan?.items) {
      const hits = plan.items.filter(item => {
        const searchable = `${item.id} ${item.title} ${item.notes || ''} ${item.status}`.toLowerCase();
        return searchable.includes(queryLower);
      });
      if (hits.length > 0) {
        console.log(`\n  ${c.bold}PLAN.yaml${c.reset} ${c.dim}(${hits.length} item${hits.length > 1 ? 's' : ''})${c.reset}`);
        for (const item of hits) {
          const statusColor = item.status === 'done' ? c.green : item.status === 'in_progress' ? c.yellow : c.dim;
          console.log(`    ${statusColor}[${item.status}]${c.reset} ${item.id}: ${item.title}`);
        }
        totalHits += hits.length;
      }
    }
  }

  // 3. Search release notes
  const relDir = path.join(root, '.trace/releases');
  if (fs.existsSync(relDir)) {
    const files = fs.readdirSync(relDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(relDir, file), 'utf8');
      const lines = content.split('\n');
      const hits = lines.filter(l => l.toLowerCase().includes(queryLower));
      if (hits.length > 0) {
        console.log(`\n  ${c.bold}releases/${file}${c.reset} ${c.dim}(${hits.length} match${hits.length > 1 ? 'es' : ''})${c.reset}`);
        for (const h of hits.slice(0, 5)) {
          console.log(`    ${h.trim()}`);
        }
        totalHits += hits.length;
      }
    }
  }

  // 4. Search HANDOFF.md
  const handoffPath = path.join(root, config.artifacts?.handoff || '.trace/HANDOFF.md');
  if (fileExists(handoffPath)) {
    const content = fs.readFileSync(handoffPath, 'utf8');
    const lines = content.split('\n');
    const hits = lines.filter(l => l.toLowerCase().includes(queryLower));
    if (hits.length > 0) {
      console.log(`\n  ${c.bold}HANDOFF.md${c.reset} ${c.dim}(${hits.length} match${hits.length > 1 ? 'es' : ''})${c.reset}`);
      for (const h of hits.slice(0, 5)) {
        console.log(`    ${h.trim()}`);
      }
      totalHits += hits.length;
    }
  }

  // Summary
  console.log();
  if (totalHits > 0) {
    printPass(`${totalHits} result${totalHits > 1 ? 's' : ''} found for "${query}"`);
  } else {
    printWarn(`No results for "${query}"`);
  }
  console.log();
}

/**
 * Generate context-aware AI instructions for the current session.
 * Only includes anchors and consumers relevant to in-progress PLAN items.
 * Called by trace gate start to create .trace/AI_CONTEXT.md
 */
export function generateSessionContext(root, config, scope = null) {
  const planPath = path.join(root, '.trace/PLAN.yaml');
  const plan = fileExists(planPath) ? loadYaml(planPath) : null;
  const contextPath = path.join(root, '.trace/AI_CONTEXT.md');

  let content = `# TRACE Session Context\n`;
  content += `_Auto-generated at ${getTimestamp()}_\n`;
  if (scope) content += `_Scope: ${scope}_\n`;
  content += `\n`;

  // Current sprint
  if (plan?.current_sprint) {
    content += `## Current Sprint: ${plan.current_sprint}\n\n`;
  }

  // In-progress items
  const inProgress = plan?.items?.filter(i => i.status === 'in_progress') || [];
  const todo = plan?.items?.filter(i => i.status === 'todo') || [];

  if (inProgress.length > 0) {
    content += `## Active Work\n\n`;
    for (const item of inProgress) {
      content += `- **${item.id}**: ${item.title}`;
      if (item.priority) content += ` (${item.priority})`;
      if (item.notes) content += ` — ${item.notes}`;
      content += `\n`;
    }
    content += `\n`;
  }

  // Relevant anchors — filtered by scope if specified
  let anchors = config.anchors || [];
  if (scope && config.scopes?.[scope]) {
    const scopeAnchorIds = config.scopes[scope].anchors || [];
    anchors = anchors.filter(a => scopeAnchorIds.includes(a.id));
    content += `## Anchors (${anchors.length} in scope "${scope}")\n\n`;
  } else if (anchors.length > 0) {
    content += `## Anchors (${anchors.length} total)\n\n`;
  }

  if (anchors.length > 0) {
    for (const anchor of anchors) {
      content += `### ${anchor.id}\n`;
      content += `- **File:** ${anchor.file}\n`;
      if (anchor.description) content += `- **Description:** ${anchor.description}\n`;
      if (anchor.consumers?.length > 0) {
        content += `- **Consumers (${anchor.consumers.length}):** ${anchor.consumers.slice(0, 5).join(', ')}`;
        if (anchor.consumers.length > 5) content += `, +${anchor.consumers.length - 5} more`;
        content += `\n`;
      }
      content += `\n`;
    }
  }

  // Unresolved debt
  const debtPath = path.join(root, config.artifacts?.debt_log || '.trace/DEBT.yaml');
  if (fileExists(debtPath)) {
    const debt = loadYaml(debtPath);
    const unresolved = (debt?.entries || []).filter(e => !e.resolved);
    if (unresolved.length > 0) {
      content += `## Unresolved Debt (${unresolved.length})\n\n`;
      for (const d of unresolved) {
        content += `- **${d.id}**: ${d.description} (${d.severity}, resolve by: ${d.resolve_by})\n`;
      }
      content += `\n`;
    }
  }

  // Upcoming priorities
  if (todo.length > 0) {
    const highPri = todo.filter(i => i.priority === 'critical' || i.priority === 'high');
    if (highPri.length > 0) {
      content += `## Up Next (High Priority)\n\n`;
      for (const item of highPri.slice(0, 5)) {
        content += `- ${item.id}: ${item.title}\n`;
      }
      content += `\n`;
    }
  }

  content += `## Rules\n\n`;
  content += `- Run \`trace impact <anchor_id>\` before modifying any anchor\n`;
  content += `- Save checkpoints at meaningful milestones: \`trace checkpoint\`\n`;
  content += `- Update PLAN.yaml when new items are discovered\n`;
  content += `- Run \`trace gate end\` when session is complete\n`;

  // Handoff — include only last 3 entries to save tokens
  const handoffPath = path.join(root, '.trace/HANDOFF.md');
  if (fileExists(handoffPath)) {
    const handoff = fs.readFileSync(handoffPath, 'utf8');
    const entries = handoff.split(/^## /m).filter(e => e.trim());
    const recent = entries.slice(-3).map(e => '## ' + e.trim());
    if (recent.length > 0) {
      content += `\n## Recent Handoff (last ${recent.length})\n\n`;
      content += recent.join('\n\n');
      content += `\n`;
    }
  }

  fs.writeFileSync(contextPath, content);
  return contextPath;
}
