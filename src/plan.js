import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig, loadYaml, saveYaml,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, getDateStamp
} from './utils.js';

const PLAN_FILE = '.trace/PLAN.yaml';
const RELEASE_DIR = '.trace/releases';

/**
 * Load PLAN.yaml
 */
function loadPlan(root) {
  const planPath = path.join(root, PLAN_FILE);
  if (!fileExists(planPath)) return null;
  return loadYaml(planPath) || { items: [] };
}

/**
 * Get items by status
 */
function getItemsByStatus(plan, status) {
  if (!plan?.items) return [];
  return plan.items.filter(i => i.status === status);
}

/**
 * trace plan — Show current backlog overview
 */
export function runPlan(args) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset} Run ${c.cyan}trace init${c.reset} first.`);
    return;
  }

  const subcommand = args[0];

  if (subcommand === 'add') {
    return addPlanItem(root, args.slice(1));
  }
  if (subcommand === 'move') {
    return movePlanItem(root, args[1], args[2]);
  }
  if (subcommand === 'release') {
    return generateReleaseNote(root, args[1]);
  }

  // Default: show board
  showBoard(root);
}

/**
 * Show Kanban-style board view
 */
function showBoard(root) {
  const plan = loadPlan(root);
  if (!plan) {
    printHeader('TRACE Plan');
    printWarn('No PLAN.yaml found. Run trace init or create .trace/PLAN.yaml');
    return;
  }

  printHeader(`TRACE Plan — Sprint: ${plan.current_sprint || '(none)'}`);

  const todo = getItemsByStatus(plan, 'todo');
  const inProgress = getItemsByStatus(plan, 'in_progress');
  const done = getItemsByStatus(plan, 'done');
  const deferred = getItemsByStatus(plan, 'deferred');

  // To Do
  console.log(`\n  ${c.bold}${c.cyan}TO DO${c.reset} ${c.dim}(${todo.length})${c.reset}`);
  if (todo.length === 0) console.log(`  ${c.dim}  (empty)${c.reset}`);
  for (const item of todo) {
    const pri = formatPriority(item.priority);
    const sprint = item.sprint ? ` ${c.dim}[${item.sprint}]${c.reset}` : '';
    console.log(`  ${c.dim}□${c.reset}  ${pri} ${item.id}: ${item.title}${sprint}`);
  }

  // In Progress
  console.log(`\n  ${c.bold}${c.yellow}IN PROGRESS${c.reset} ${c.dim}(${inProgress.length})${c.reset}`);
  if (inProgress.length === 0) console.log(`  ${c.dim}  (empty)${c.reset}`);
  for (const item of inProgress) {
    const pri = formatPriority(item.priority);
    const sprint = item.sprint ? ` ${c.dim}[${item.sprint}]${c.reset}` : '';
    console.log(`  ${c.yellow}◐${c.reset}  ${pri} ${item.id}: ${item.title}${sprint}`);
  }

  // Done
  console.log(`\n  ${c.bold}${c.green}DONE${c.reset} ${c.dim}(${done.length})${c.reset}`);
  if (done.length === 0) console.log(`  ${c.dim}  (empty)${c.reset}`);
  for (const item of done.slice(-10)) { // Show last 10
    const sprint = item.sprint ? ` ${c.dim}[${item.sprint}]${c.reset}` : '';
    console.log(`  ${c.green}✓${c.reset}  ${item.id}: ${item.title}${sprint}`);
  }
  if (done.length > 10) console.log(`  ${c.dim}  ... and ${done.length - 10} more${c.reset}`);

  // Deferred
  if (deferred.length > 0) {
    console.log(`\n  ${c.bold}${c.red}DEFERRED${c.reset} ${c.dim}(${deferred.length})${c.reset}`);
    for (const item of deferred) {
      console.log(`  ${c.red}⊘${c.reset}  ${item.id}: ${item.title} ${c.dim}— ${item.notes || ''}${c.reset}`);
    }
  }

  // Summary
  const total = (plan.items || []).length;
  console.log(`\n  ${c.dim}Total: ${total} items | Updated: ${plan.updated || 'unknown'}${c.reset}\n`);
}

function formatPriority(pri) {
  switch (pri) {
    case 'critical': return `${c.bgRed}${c.bold} CRIT ${c.reset}`;
    case 'high': return `${c.red}HIGH${c.reset}`;
    case 'medium': return `${c.yellow}MED ${c.reset}`;
    case 'low': return `${c.dim}LOW ${c.reset}`;
    default: return `${c.dim}--- ${c.reset}`;
  }
}

/**
 * trace plan add "title" --priority high --sprint S77
 */
function addPlanItem(root, args) {
  const plan = loadPlan(root) || { current_sprint: '', updated: getDateStamp(), items: [] };
  
  const title = args.filter(a => !a.startsWith('--')).join(' ');
  if (!title) {
    console.log(`Usage: ${c.cyan}trace plan add "title" --priority high --sprint S01${c.reset}`);
    return;
  }

  const priority = getFlag(args, '--priority') || 'medium';
  const sprint = getFlag(args, '--sprint') || plan.current_sprint || '';

  const id = `ITEM-${String((plan.items || []).length + 1).padStart(3, '0')}`;
  const item = {
    id,
    title,
    status: 'todo',
    priority,
    sprint,
    discovered_in: plan.current_sprint || '',
    assigned_to: '',
    notes: '',
  };

  plan.items = plan.items || [];
  plan.items.push(item);
  plan.updated = getDateStamp();

  const planPath = path.join(root, PLAN_FILE);
  saveYaml(planPath, plan);
  printPass(`Added ${id}: "${title}" (${priority}, sprint: ${sprint || 'unscheduled'})`);
}

/**
 * trace plan move ITEM-001 done
 */
function movePlanItem(root, itemId, newStatus) {
  if (!itemId || !newStatus) {
    console.log(`Usage: ${c.cyan}trace plan move ITEM-001 done${c.reset}`);
    console.log(`Status options: todo, in_progress, done, deferred`);
    return;
  }

  const plan = loadPlan(root);
  if (!plan) { printWarn('No PLAN.yaml found.'); return; }

  const item = (plan.items || []).find(i => i.id === itemId.toUpperCase());
  if (!item) {
    printFail(`Item ${itemId} not found.`);
    return;
  }

  const oldStatus = item.status;
  item.status = newStatus;
  plan.updated = getDateStamp();

  const planPath = path.join(root, PLAN_FILE);
  saveYaml(planPath, plan);
  printPass(`${item.id}: ${oldStatus} → ${newStatus}`);
}

/**
 * trace plan release v1.0.0
 * Auto-generates release note from completed PLAN items in current sprint
 */
function generateReleaseNote(root, version) {
  if (!version) {
    console.log(`Usage: ${c.cyan}trace plan release v1.0.0${c.reset}`);
    return;
  }

  const config = loadConfig(root);
  const plan = loadPlan(root);
  const projectName = config.project?.name || 'Project';

  // Get done items for current sprint
  const doneItems = plan?.items?.filter(i => i.status === 'done') || [];
  const sprintDone = plan?.current_sprint
    ? doneItems.filter(i => i.sprint === plan.current_sprint)
    : doneItems;

  // Create release notes directory
  const relDir = path.join(root, RELEASE_DIR);
  if (!fs.existsSync(relDir)) fs.mkdirSync(relDir, { recursive: true });

  // Generate content
  const date = getDateStamp();
  let content = `# ${projectName} ${version} — Release Notes\n\n`;
  content += `**Release Date:** ${date}\n\n`;
  content += `**Session:** ${plan?.current_sprint || '(not set)'}\n\n`;
  content += `## Summary\n\n`;
  content += `${sprintDone.length} item(s) completed in this release.\n\n`;
  content += `## Changes\n\n`;

  // Group by priority
  const byPriority = { critical: [], high: [], medium: [], low: [] };
  for (const item of sprintDone) {
    const p = item.priority || 'medium';
    if (byPriority[p]) byPriority[p].push(item);
  }

  for (const [pri, items] of Object.entries(byPriority)) {
    if (items.length === 0) continue;
    content += `### ${pri.charAt(0).toUpperCase() + pri.slice(1)} Priority\n\n`;
    for (const item of items) {
      content += `- **${item.id}**: ${item.title}`;
      if (item.notes) content += ` — ${item.notes}`;
      content += `\n`;
    }
    content += `\n`;
  }

  // Deferred items
  const deferred = plan?.items?.filter(i => i.status === 'deferred') || [];
  if (deferred.length > 0) {
    content += `## Deferred\n\n`;
    for (const item of deferred) {
      content += `- ${item.id}: ${item.title}`;
      if (item.notes) content += ` — ${item.notes}`;
      content += `\n`;
    }
    content += `\n`;
  }

  const filename = `${version.replace(/\./g, '_')}.md`;
  const relPath = path.join(relDir, filename);
  fs.writeFileSync(relPath, content);

  printHeader('Release Note Generated');
  printPass(`${relPath}`);
  printInfo(`${sprintDone.length} completed items documented`);
  if (deferred.length > 0) printWarn(`${deferred.length} deferred items noted`);
  console.log(`\n  ${c.dim}Edit the release note to add details, then commit.${c.reset}\n`);
}

/**
 * Planning reconciliation check for gate end
 * Returns { passed, warnings }
 */
export function checkPlanReconciliation(root) {
  const plan = loadPlan(root);
  const warnings = [];

  if (!plan) {
    return { passed: true, warnings: ['No PLAN.yaml found — consider creating one for backlog tracking'] };
  }

  // Check: any in_progress items?
  const inProgress = getItemsByStatus(plan, 'in_progress');
  if (inProgress.length > 0) {
    warnings.push(`${inProgress.length} item(s) still in_progress: ${inProgress.map(i => i.id).join(', ')}`);
  }

  // Check: was PLAN updated this session?
  const today = getDateStamp();
  if (plan.updated !== today) {
    warnings.push('PLAN.yaml not updated today — did you discover new items or change priorities?');
  }

  return { passed: true, warnings };
}

/**
 * Release note check for gate end
 * If version changed, check that release note exists
 */
export function checkReleaseNote(root, config) {
  // Try to read package.json for version
  const pkgPath = path.join(root, 'package.json');
  if (!fileExists(pkgPath)) return { needed: false };

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = pkg.version;
    if (!version) return { needed: false };

    // Check if release note exists for this version
    const relDir = path.join(root, RELEASE_DIR);
    if (!fs.existsSync(relDir)) return { needed: true, version, exists: false };

    const files = fs.readdirSync(relDir);
    const versionNorm = version.replace(/\./g, '_');
    const found = files.some(f => f.includes(versionNorm) || f.includes(version));

    return { needed: true, version, exists: found };
  } catch (e) {
    return { needed: false };
  }
}

function getFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx >= args.length - 1) return null;
  return args[idx + 1];
}
