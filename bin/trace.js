#!/usr/bin/env node

import { c } from '../src/utils.js';

const VERSION = '1.0.0';
const [,, command, ...args] = process.argv;

const HELP = `
${c.cyan}${c.bold}TRACE${c.reset} — Trusted Registry for Artifact Consistency and Evolution
${c.dim}Structural coherence engineering for AI-augmented software systems${c.reset}
${c.dim}v${VERSION}${c.reset}

${c.bold}Getting Started:${c.reset}

  ${c.cyan}trace init${c.reset}                      New project — scaffold TRACE from scratch
  ${c.cyan}trace scan${c.reset}                      Existing project — analyze codebase and generate config

${c.bold}Daily Workflow:${c.reset}

  ${c.cyan}trace gate start${c.reset}                Begin session (validates preconditions)
  ${c.cyan}trace gate end${c.reset}                  End session (validates postconditions)
  ${c.cyan}trace checkpoint <file> <next>${c.reset}  Save mid-session recovery point

${c.bold}Coherence:${c.reset}

  ${c.cyan}trace check${c.reset}                     Validate coherence across all pillars
  ${c.cyan}trace status${c.reset}                    Quick health overview
  ${c.cyan}trace deps${c.reset}                      Show anchor dependency graph
  ${c.cyan}trace deps <anchor_id>${c.reset}          Impact analysis for specific anchor
  ${c.cyan}trace impact <anchor_id>${c.reset}        Pre-work blast radius assessment
  ${c.cyan}trace search "query"${c.reset}            Search across all TRACE artifacts

${c.bold}Security:${c.reset}

  ${c.cyan}trace integrity${c.reset}                 Verify TRACE file integrity (tamper detection)
  ${c.cyan}trace integrity --generate${c.reset}      Regenerate integrity checksums

${c.bold}Planning:${c.reset}

  ${c.cyan}trace plan${c.reset}                      Show Kanban-style backlog board
  ${c.cyan}trace plan add "title"${c.reset}          Add item (--priority high --sprint S01)
  ${c.cyan}trace plan move ITEM-001 done${c.reset}   Move item to new status
  ${c.cyan}trace plan release v1.0.0${c.reset}       Generate release note from completed items

${c.bold}Overrides:${c.reset}

  ${c.cyan}trace override "reason"${c.reset}         Emergency override (creates tracked debt)

${c.bold}CI/CD:${c.reset}

  ${c.cyan}trace ci${c.reset}                        PR-scoped analysis (changed files only)
  ${c.cyan}trace ci --json${c.reset}                 Output results as JSON
  ${c.cyan}trace ci --comment-file f.md${c.reset}    Generate GitHub PR comment
  ${c.cyan}trace metrics${c.reset}                   Outcome analysis + threshold calibration

${c.bold}Maintenance:${c.reset}

  ${c.cyan}trace validate${c.reset}                  Check trace.yaml for errors and typos
  ${c.cyan}trace upgrade${c.reset}                   Add missing config sections (schema migration)
  ${c.cyan}trace watch${c.reset}                     Monitor files and check on save (Ctrl+C to stop)
  ${c.cyan}trace license${c.reset}                   Scan dependencies for license compliance

${c.bold}Workflow:${c.reset}

  1. ${c.dim}Start session:${c.reset}    trace gate start
  2. ${c.dim}Work on code${c.reset}
  3. ${c.dim}Save progress:${c.reset}    trace checkpoint "file.ts" "next step"
  4. ${c.dim}End session:${c.reset}      trace gate end

${c.dim}https://github.com/anuraj/trace${c.reset}
`;

async function main() {
  switch (command) {
    case 'init': {
      const { runInit } = await import('../src/init.js');
      await runInit();
      break;
    }
    case 'scan': {
      const { runScan } = await import('../src/scan.js');
      await runScan();
      break;
    }
    case 'deps': {
      const { runDeps } = await import('../src/deps.js');
      runDeps(args[0]);
      break;
    }
    case 'check': {
      const { runCheck } = await import('../src/check.js');
      runCheck();
      break;
    }
    case 'status': {
      const { runStatus } = await import('../src/status.js');
      runStatus();
      break;
    }
    case 'gate': {
      const subcommand = args[0];
      if (subcommand === 'start') {
        const { runGateStart } = await import('../src/gate.js');
        runGateStart();
      } else if (subcommand === 'end') {
        const { runGateEnd } = await import('../src/gate.js');
        runGateEnd();
      } else {
        console.log(`Usage: ${c.cyan}trace gate start${c.reset} or ${c.cyan}trace gate end${c.reset}`);
      }
      break;
    }
    case 'override': {
      const reason = args.join(' ');
      const { runOverride } = await import('../src/gate.js');
      runOverride(reason);
      break;
    }
    case 'checkpoint': {
      const { runCheckpoint } = await import('../src/checkpoint.js');
      runCheckpoint(args[0], args[1], args[2]);
      break;
    }
    case 'integrity': {
      const { runIntegrity } = await import('../src/integrity.js');
      runIntegrity(args);
      break;
    }
    case 'plan': {
      const { runPlan } = await import('../src/plan.js');
      runPlan(args);
      break;
    }
    case 'impact': {
      const { runImpact } = await import('../src/impact.js');
      runImpact(args);
      break;
    }
    case 'search': {
      const { runSearch } = await import('../src/observe.js');
      runSearch(args);
      break;
    }
    case 'ci': {
      const { runCI } = await import('../src/ci.js');
      runCI(args);
      break;
    }
    case 'metrics': {
      const { runMetrics } = await import('../src/metrics.js');
      runMetrics();
      break;
    }
    case 'validate': {
      const { runValidate } = await import('../src/validate.js');
      runValidate();
      break;
    }
    case 'upgrade': {
      const { runUpgrade } = await import('../src/upgrade.js');
      runUpgrade();
      break;
    }
    case 'watch': {
      const { runWatch } = await import('../src/watch.js');
      runWatch();
      break;
    }
    case 'license': {
      const { runLicense } = await import('../src/license.js');
      runLicense(args);
      break;
    }
    case 'version':
    case '--version':
    case '-v':
      console.log(`trace v${VERSION}`);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.log(`${c.red}Unknown command: ${command}${c.reset}`);
      console.log(`Run ${c.cyan}trace --help${c.reset} for usage.`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`${c.red}Error:${c.reset} ${err.message}`);
  process.exit(1);
});
