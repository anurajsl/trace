import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  c, findProjectRoot,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists
} from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * trace hook install — Install git pre-commit hook that runs trace check.
 * trace hook uninstall — Remove the TRACE pre-commit hook.
 *
 * The hook runs `trace check` before every commit. If coherence fails,
 * the commit is blocked. This is the hard enforcement layer that catches
 * changes made without opening a gate (common with AI-assisted development).
 */
export function runHook(args) {
  const subcommand = args[0];

  if (!subcommand || !['install', 'uninstall', 'status'].includes(subcommand)) {
    console.log(`\n${c.bold}Usage:${c.reset}`);
    console.log(`  ${c.cyan}trace hook install${c.reset}     Install pre-commit hook`);
    console.log(`  ${c.cyan}trace hook uninstall${c.reset}   Remove pre-commit hook`);
    console.log(`  ${c.cyan}trace hook status${c.reset}      Check if hook is installed\n`);
    return;
  }

  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  const gitDir = path.join(root, '.git');
  if (!fs.existsSync(gitDir)) {
    printFail('No .git directory found. Initialize git first: git init');
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  const hookPath = path.join(hooksDir, 'pre-commit');
  const TRACE_MARKER = '# TRACE pre-commit hook';

  switch (subcommand) {
    case 'install': {
      installHook(root, hooksDir, hookPath, TRACE_MARKER);
      break;
    }
    case 'uninstall': {
      uninstallHook(hookPath, TRACE_MARKER);
      break;
    }
    case 'status': {
      checkStatus(hookPath, TRACE_MARKER);
      break;
    }
  }
}

function installHook(root, hooksDir, hookPath, TRACE_MARKER) {
  printHeader('TRACE Hook — Install');

  // Read the template
  const templatePath = path.join(__dirname, '..', 'templates', 'pre-commit');
  if (!fileExists(templatePath)) {
    printFail('Pre-commit template not found. Reinstall trace-coherence.');
    return;
  }
  const template = fs.readFileSync(templatePath, 'utf8');

  // Create hooks directory if needed
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Check if a pre-commit hook already exists
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');

    if (existing.includes(TRACE_MARKER)) {
      // Already installed, update it
      fs.writeFileSync(hookPath, template, { mode: 0o755 });
      printPass('Pre-commit hook updated.');
      printInfo('TRACE coherence check runs before every commit.\n');
      return;
    }

    // Another hook exists — append TRACE to it
    printWarn('Existing pre-commit hook found. Appending TRACE check.');
    const combined = existing + '\n\n' + template;
    fs.writeFileSync(hookPath, combined, { mode: 0o755 });
    printPass('TRACE check appended to existing pre-commit hook.');
    printInfo('Both your existing hook and TRACE will run before commits.\n');
    return;
  }

  // No existing hook — install fresh
  fs.writeFileSync(hookPath, template, { mode: 0o755 });

  printPass('Pre-commit hook installed.');
  printInfo(`Location: ${hookPath}`);
  printInfo('');
  printInfo('What this does:');
  printInfo('  Every git commit now runs trace check first.');
  printInfo('  If coherence fails, the commit is blocked.');
  printInfo('  To bypass: trace override "reason" && git commit');
  printInfo('');
  printInfo('This catches changes made without opening a TRACE gate,');
  printInfo('including changes made by AI assistants that skip ceremony.\n');
}

function uninstallHook(hookPath, TRACE_MARKER) {
  printHeader('TRACE Hook — Uninstall');

  if (!fs.existsSync(hookPath)) {
    printInfo('No pre-commit hook found. Nothing to remove.\n');
    return;
  }

  const content = fs.readFileSync(hookPath, 'utf8');
  if (!content.includes(TRACE_MARKER)) {
    printInfo('Pre-commit hook exists but is not a TRACE hook. Not touching it.\n');
    return;
  }

  // Check if it's a combined hook
  const parts = content.split(TRACE_MARKER);
  const prePart = parts[0].trim();
  // If the content before the TRACE marker is just a shebang or empty, delete the whole file
  const isOnlyTrace = !prePart || /^#!\/bin\/(sh|bash)\s*$/.test(prePart);
  if (!isOnlyTrace) {
    // There's real content before the TRACE marker — restore it
    fs.writeFileSync(hookPath, prePart + '\n', { mode: 0o755 });
    printPass('TRACE hook removed. Your original pre-commit hook is preserved.\n');
  } else {
    // It's purely a TRACE hook — remove the file
    fs.unlinkSync(hookPath);
    printPass('Pre-commit hook removed.\n');
  }
}

function checkStatus(hookPath, TRACE_MARKER) {
  if (!fs.existsSync(hookPath)) {
    printWarn('No pre-commit hook installed.');
    printInfo('Run: trace hook install\n');
    return;
  }

  const content = fs.readFileSync(hookPath, 'utf8');
  if (content.includes(TRACE_MARKER)) {
    printPass('TRACE pre-commit hook is installed and active.\n');
  } else {
    printWarn('A pre-commit hook exists, but it is not a TRACE hook.');
    printInfo('Run: trace hook install (will append TRACE check)\n');
  }
}
