import fs from 'fs';
import path from 'path';
import {
  c, findProjectRoot, loadConfig, fileExists,
  printHeader, printPass, printFail, printWarn, printInfo
} from './utils.js';

/**
 * trace activate — Zero-config full automation.
 *
 * Installs three git hooks in one command:
 *   1. pre-commit:    Runs trace check, blocks incoherent commits
 *   2. post-commit:   Regenerates AI context + logs to PROJECT_LOG
 *   3. post-checkout: Regenerates AI context when switching branches
 *
 * After running trace activate, TRACE is fully autonomous.
 * No manual commands needed ever again.
 *
 * trace deactivate — Removes all three hooks.
 */

const TRACE_MARKER = '# TRACE automated hook';

const HOOK_PRECOMMIT = `#!/bin/sh
${TRACE_MARKER} — pre-commit
# Blocks commits if coherence check fails.

if command -v trace >/dev/null 2>&1; then
  echo "TRACE: Running pre-commit coherence check..."
  trace check
  if [ $? -ne 0 ]; then
    echo ""
    echo "TRACE: Coherence check failed. Commit blocked."
    echo "  Fix the issues above, or run: trace override \\"reason\\""
    exit 1
  fi
fi
`;

const HOOK_POSTCOMMIT = `#!/bin/sh
${TRACE_MARKER} — post-commit
# Regenerates AI context and logs commit to PROJECT_LOG.

if command -v trace >/dev/null 2>&1; then
  # Regenerate AI context so next session is fresh
  trace gate start --quiet 2>/dev/null || true

  # Log commit to PROJECT_LOG
  COMMIT_MSG=$(git log -1 --pretty=%s 2>/dev/null)
  COMMIT_HASH=$(git log -1 --pretty=%h 2>/dev/null)
  FILES_CHANGED=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null | head -10 | tr '\\n' ', ')

  if [ -f .trace/PROJECT_LOG.md ]; then
    echo "" >> .trace/PROJECT_LOG.md
    echo "## Commit $COMMIT_HASH | $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .trace/PROJECT_LOG.md
    echo "" >> .trace/PROJECT_LOG.md
    echo "**Message:** $COMMIT_MSG" >> .trace/PROJECT_LOG.md
    echo "**Files:** $FILES_CHANGED" >> .trace/PROJECT_LOG.md
  fi
fi
`;

const HOOK_POSTCHECKOUT = `#!/bin/sh
${TRACE_MARKER} — post-checkout
# Regenerates AI context when switching branches.

# Only run on branch checkout, not file checkout
if [ "$3" = "1" ]; then
  if command -v trace >/dev/null 2>&1; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    # Regenerate context for the new branch
    trace gate start --quiet 2>/dev/null || true

    if [ -f .trace/HANDOFF.md ]; then
      echo "" >> .trace/HANDOFF.md
      echo "## Branch Switch | $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .trace/HANDOFF.md
      echo "" >> .trace/HANDOFF.md
      echo "Switched to branch: $BRANCH" >> .trace/HANDOFF.md
    fi
  fi
fi
`;

export function runActivate(args) {
  const subcommand = args[0];

  if (subcommand === 'deactivate' || subcommand === 'off') {
    return deactivate();
  }

  if (subcommand === 'status') {
    return activateStatus();
  }

  return activate();
}

function activate() {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset} Run ${c.cyan}trace init${c.reset} or ${c.cyan}trace scan${c.reset} first.`);
    return;
  }

  const config = loadConfig(root);
  printHeader(`TRACE Activate — ${config.project?.name || 'Project'}`);

  const gitDir = path.join(root, '.git');
  if (!fs.existsSync(gitDir)) {
    printFail('No .git directory found. Initialize git first: git init');
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hooks = [
    { name: 'pre-commit', content: HOOK_PRECOMMIT },
    { name: 'post-commit', content: HOOK_POSTCOMMIT },
    { name: 'post-checkout', content: HOOK_POSTCHECKOUT },
  ];

  let installed = 0;

  for (const hook of hooks) {
    const hookPath = path.join(hooksDir, hook.name);

    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf8');

      if (existing.includes(TRACE_MARKER)) {
        // Already installed — update
        fs.writeFileSync(hookPath, hook.content, { mode: 0o755 });
        printPass(`${hook.name}: Updated`);
        installed++;
        continue;
      }

      // Append to existing hook
      const combined = existing + '\n\n' + hook.content;
      fs.writeFileSync(hookPath, combined, { mode: 0o755 });
      printWarn(`${hook.name}: Appended to existing hook`);
      installed++;
      continue;
    }

    // Fresh install
    fs.writeFileSync(hookPath, hook.content, { mode: 0o755 });
    printPass(`${hook.name}: Installed`);
    installed++;
  }

  console.log();
  if (installed === 3) {
    console.log(`  ${c.bgGreen}${c.bold} TRACE ACTIVATED ${c.reset}\n`);
    console.log(`  ${c.dim}What happens now:${c.reset}`);
    console.log(`  ${c.cyan}Every commit${c.reset}      → coherence checked, blocked if failing`);
    console.log(`  ${c.cyan}After commit${c.reset}      → AI context regenerated, commit logged`);
    console.log(`  ${c.cyan}Branch switch${c.reset}     → AI context regenerated for new branch`);
    console.log();
    console.log(`  ${c.dim}You never need to run trace gate start/end again.${c.reset}`);
    console.log(`  ${c.dim}To remove: ${c.reset}${c.cyan}trace deactivate${c.reset}\n`);
  }
}

function deactivate() {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  printHeader('TRACE Deactivate');

  const gitDir = path.join(root, '.git');
  if (!fs.existsSync(gitDir)) {
    printFail('No .git directory found.');
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  const hookNames = ['pre-commit', 'post-commit', 'post-checkout'];
  let removed = 0;

  for (const name of hookNames) {
    const hookPath = path.join(hooksDir, name);
    if (!fs.existsSync(hookPath)) continue;

    const content = fs.readFileSync(hookPath, 'utf8');
    if (!content.includes(TRACE_MARKER)) continue;

    // Check if there's non-TRACE content
    const parts = content.split(TRACE_MARKER);
    const nonTrace = parts[0].trim();

    if (nonTrace.length > 0 && nonTrace !== '#!/bin/sh') {
      // Preserve non-TRACE content
      fs.writeFileSync(hookPath, nonTrace + '\n', { mode: 0o755 });
      printPass(`${name}: TRACE hook removed, original hook preserved`);
    } else {
      fs.unlinkSync(hookPath);
      printPass(`${name}: Removed`);
    }
    removed++;
  }

  if (removed === 0) {
    printInfo('No TRACE hooks found. Nothing to remove.\n');
  } else {
    console.log(`\n  ${c.dim}Removed ${removed} hook(s). TRACE is now manual-only.${c.reset}\n`);
  }
}

function activateStatus() {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  printHeader('TRACE Activation Status');

  const gitDir = path.join(root, '.git');
  if (!fs.existsSync(gitDir)) {
    printFail('No .git directory found.');
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  const hookNames = ['pre-commit', 'post-commit', 'post-checkout'];
  let active = 0;

  for (const name of hookNames) {
    const hookPath = path.join(hooksDir, name);
    if (fs.existsSync(hookPath) && fs.readFileSync(hookPath, 'utf8').includes(TRACE_MARKER)) {
      printPass(`${name}: Active`);
      active++;
    } else {
      printWarn(`${name}: Not installed`);
    }
  }

  console.log();
  if (active === 3) {
    console.log(`  ${c.green}Fully activated.${c.reset} TRACE runs autonomously.\n`);
  } else if (active > 0) {
    console.log(`  ${c.yellow}Partially activated.${c.reset} Run ${c.cyan}trace activate${c.reset} to install missing hooks.\n`);
  } else {
    console.log(`  ${c.red}Not activated.${c.reset} Run ${c.cyan}trace activate${c.reset} to enable autonomous mode.\n`);
  }
}
