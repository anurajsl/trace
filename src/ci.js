import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig, loadYaml,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, countLines
} from './utils.js';

/**
 * trace ci
 * PR-scoped coherence analysis with structured output.
 * Only checks files changed in the current PR diff.
 * Outputs JSON for CI consumption and optional GitHub PR comments.
 */
export async function runCI(args) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    process.exit(1);
  }

  const config = loadConfig(root);
  const jsonOutput = args.includes('--json');
  const commentFile = getFlag(args, '--comment-file');

  printHeader('TRACE CI — PR-Scoped Analysis');

  // 1. Get changed files from git diff
  const changedFiles = getChangedFiles(root);
  if (changedFiles.length === 0) {
    printPass('No files changed — nothing to check');
    if (jsonOutput) writeJSON(commentFile, { findings: [], summary: 'No changes' });
    return;
  }

  printInfo(`${changedFiles.length} file(s) changed in this PR\n`);

  const findings = [];
  const anchors = config.anchors || [];
  const anchorFiles = anchors.map(a => a.file);
  const consumerMap = buildConsumerMap(anchors);

  // 2. Check each changed file against TRACE rules
  for (const file of changedFiles) {
    // Is this file an anchor?
    const anchor = anchors.find(a => a.file === file);
    if (anchor) {
      // Anchor was modified — check if all consumers are also in the diff
      const consumers = anchor.consumers || [];
      const missingConsumers = consumers.filter(cf => !changedFiles.includes(cf));
      
      if (missingConsumers.length > 0) {
        findings.push({
          type: 'anchor_drift',
          severity: 'critical',
          file: file,
          anchor_id: anchor.id,
          message: `Anchor "${anchor.id}" modified but ${missingConsumers.length} consumer(s) not updated in this PR`,
          consumers_missing: missingConsumers,
          consumers_updated: consumers.filter(cf => changedFiles.includes(cf)),
          suggestion: `Run: trace impact ${anchor.id}`,
        });
      } else if (consumers.length > 0) {
        findings.push({
          type: 'anchor_verified',
          severity: 'pass',
          file: file,
          anchor_id: anchor.id,
          message: `Anchor "${anchor.id}" modified — all ${consumers.length} consumer(s) also updated`,
        });
      }
    }

    // Is this file a consumer of an anchor?
    const parentAnchors = consumerMap[file] || [];
    for (const parentAnchor of parentAnchors) {
      if (!changedFiles.includes(parentAnchor.file)) {
        // Consumer changed but its anchor didn't — could be fine, but flag for review
        findings.push({
          type: 'consumer_only',
          severity: 'info',
          file: file,
          anchor_id: parentAnchor.id,
          message: `Consumer of "${parentAnchor.id}" modified without anchor change — verify compatibility`,
        });
      }
    }

    // Complexity check on changed files
    const filePath = path.join(root, file);
    if (fileExists(filePath) && isCodeFile(file)) {
      const lines = countLines(filePath);
      const threshold = config.evolution?.thresholds?.max_file_lines || 400;
      if (lines > threshold) {
        findings.push({
          type: 'complexity',
          severity: 'warning',
          file: file,
          message: `${file} is ${lines} lines (threshold: ${threshold})`,
          suggestion: 'Consider extracting logic into smaller modules',
        });
      }
    }
  }

  // 3. Check if TRACE config files were modified without proper review
  const traceFiles = changedFiles.filter(f => f === 'trace.yaml' || f.startsWith('.trace/'));
  if (traceFiles.length > 0) {
    findings.push({
      type: 'config_change',
      severity: 'warning',
      file: traceFiles.join(', '),
      message: `TRACE configuration modified: ${traceFiles.join(', ')}`,
      suggestion: 'Ensure TRACE config changes are reviewed by a maintainer (CODEOWNERS)',
    });
  }

  // 4. Check integrity if available
  try {
    const { verifyIntegrity } = await import('./integrity.js');
    const integrity = verifyIntegrity();
    if (!integrity.missing && !integrity.passed) {
      for (const r of integrity.results) {
        if (r.status === 'tampered') {
          findings.push({
            type: 'integrity_violation',
            severity: 'critical',
            file: r.file,
            message: `Integrity violation: ${r.file} was modified outside TRACE workflow`,
          });
        }
      }
    }
  } catch (e) {}

  // 5. Display results
  const criticals = findings.filter(f => f.severity === 'critical');
  const warnings = findings.filter(f => f.severity === 'warning');
  const infos = findings.filter(f => f.severity === 'info');
  const passes = findings.filter(f => f.severity === 'pass');

  console.log(`  ${c.bold}Findings:${c.reset}\n`);

  for (const f of findings) {
    if (f.severity === 'critical') {
      printFail(`[CRITICAL] ${f.message}`);
      if (f.consumers_missing) {
        for (const cm of f.consumers_missing) printFail(`  → ${cm}`);
      }
      if (f.suggestion) printInfo(`  Fix: ${f.suggestion}`);
    } else if (f.severity === 'warning') {
      printWarn(`[WARNING] ${f.message}`);
      if (f.suggestion) printInfo(`  ${f.suggestion}`);
    } else if (f.severity === 'info') {
      printInfo(`[INFO] ${f.message}`);
    } else if (f.severity === 'pass') {
      printPass(f.message);
    }
  }

  // Summary
  console.log(`\n  ${c.bold}Summary:${c.reset} ${criticals.length} critical, ${warnings.length} warning, ${infos.length} info, ${passes.length} passed`);

  // 6. Write JSON output for CI
  if (jsonOutput || commentFile) {
    const output = {
      trace_version: '2.5',
      changed_files: changedFiles.length,
      findings: findings.filter(f => f.severity !== 'pass'),
      summary: {
        critical: criticals.length,
        warning: warnings.length,
        info: infos.length,
        passed: passes.length,
      },
    };
    
    const jsonPath = path.join(root, '.trace/ci-results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
    printInfo(`Results written to ${jsonPath}`);
  }

  // 7. Generate PR comment markdown
  if (commentFile) {
    const md = generatePRComment(findings, changedFiles, config);
    fs.writeFileSync(commentFile, md);
    printInfo(`PR comment written to ${commentFile}`);
  }

  // Exit with failure if critical findings
  if (criticals.length > 0) {
    console.log(`\n  ${c.bgRed}${c.bold} CI CHECK: FAILED ${c.reset}\n`);
    process.exit(1);
  } else {
    console.log(`\n  ${c.bgGreen}${c.bold} CI CHECK: PASSED ${c.reset}\n`);
  }
}

/**
 * Get files changed in the current PR (via git diff against base branch)
 */
function getChangedFiles(root) {
  try {
    // Try PR diff first (comparing against origin/main or origin/develop)
    const bases = ['origin/main', 'origin/develop', 'HEAD~1'];
    for (const base of bases) {
      try {
        const diff = execSync(`git diff --name-only ${base}...HEAD 2>/dev/null`, {
          cwd: root, encoding: 'utf8', timeout: 10000
        }).trim();
        if (diff) return diff.split('\n').filter(f => f.trim());
      } catch (e) { continue; }
    }

    // Fallback: unstaged + staged changes
    const diff = execSync('git diff --name-only HEAD 2>/dev/null', {
      cwd: root, encoding: 'utf8', timeout: 5000
    }).trim();
    if (diff) return diff.split('\n').filter(f => f.trim());
  } catch (e) {}
  return [];
}

/**
 * Build reverse map: consumer file → [parent anchors]
 */
function buildConsumerMap(anchors) {
  const map = {};
  for (const anchor of anchors) {
    for (const consumer of (anchor.consumers || [])) {
      if (!map[consumer]) map[consumer] = [];
      map[consumer].push(anchor);
    }
  }
  return map;
}

/**
 * Check if a file is a code file (not binary/image/etc)
 */
function isCodeFile(file) {
  const codeExts = ['.ts','.tsx','.js','.jsx','.py','.go','.java','.rs','.rb','.php','.cs','.swift','.kt','.c','.cpp','.h'];
  return codeExts.some(ext => file.endsWith(ext));
}

/**
 * Generate a GitHub PR comment in markdown
 */
function generatePRComment(findings, changedFiles, config) {
  const criticals = findings.filter(f => f.severity === 'critical');
  const warnings = findings.filter(f => f.severity === 'warning');
  const passes = findings.filter(f => f.severity === 'pass');

  let md = '';

  // Header with status
  if (criticals.length > 0) {
    md += `## :x: TRACE Coherence — ${criticals.length} issue(s) found\n\n`;
  } else {
    md += `## :white_check_mark: TRACE Coherence — All checks passed\n\n`;
  }

  md += `Analyzed **${changedFiles.length}** changed file(s) against **${(config.anchors || []).length}** registered anchor(s).\n\n`;

  // Critical findings
  if (criticals.length > 0) {
    md += `### Critical\n\n`;
    for (const f of criticals) {
      md += `> :rotating_light: **${f.file}**\n>\n`;
      md += `> ${f.message}\n`;
      if (f.consumers_missing) {
        md += `>\n> Stale consumers:\n`;
        for (const cm of f.consumers_missing) {
          md += `> - \`${cm}\`\n`;
        }
      }
      if (f.suggestion) md += `>\n> **Fix:** \`${f.suggestion}\`\n`;
      md += `\n`;
    }
  }

  // Warnings
  if (warnings.length > 0) {
    md += `### Warnings\n\n`;
    for (const f of warnings) {
      md += `- :warning: **${f.file}** — ${f.message}\n`;
    }
    md += `\n`;
  }

  // Passes
  if (passes.length > 0) {
    md += `### Verified\n\n`;
    for (const f of passes) {
      md += `- :white_check_mark: ${f.message}\n`;
    }
    md += `\n`;
  }

  md += `---\n`;
  md += `*TRACE v2.5 — Structural Coherence Engineering*\n`;

  return md;
}

function getFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx >= args.length - 1) return null;
  return args[idx + 1];
}
