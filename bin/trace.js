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
  ${c.cyan}trace deps audit${c.reset}                Dependency governance (policy, security, audit)
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
  ${c.cyan}trace watch${c.reset}                     Monitor files + auto-session when AI skips gates
  ${c.cyan}trace watch --no-auto-session${c.reset}   Watch mode without auto-session (warnings only)
  ${c.cyan}trace license${c.reset}                   Scan dependencies for license compliance
  ${c.cyan}trace hook install${c.reset}              Install pre-commit hook (blocks incoherent commits)
  ${c.cyan}trace hook uninstall${c.reset}            Remove pre-commit hook
  ${c.cyan}trace hook status${c.reset}               Check if hook is installed

${c.bold}MCP Server (AI Integration):${c.reset}

  ${c.cyan}trace mcp${c.reset}                       Start MCP server (AI tools call TRACE automatically)
  ${c.cyan}trace mcp setup${c.reset}                 Show configuration for Claude Code, Cursor, Kiro

${c.bold}Workflow:${c.reset}

  1. ${c.dim}Start session:${c.reset}    trace gate start
  2. ${c.dim}Work on code${c.reset}
  3. ${c.dim}Save progress:${c.reset}    trace checkpoint "file.ts" "next step"
  4. ${c.dim}End session:${c.reset}      trace gate end

${c.dim}https://github.com/anurajsl/trace${c.reset}
`;

function printMcpSetup() {
  console.log(`
${c.cyan}${c.bold}TRACE MCP Server — Setup${c.reset}

The MCP server lets AI tools (Claude Code, Cursor, Kiro) call TRACE
automatically during conversations. The AI checks impact before modifying
files, validates coherence after changes, and checks dependency policy
before adding packages — without you running any commands.

${c.bold}Claude Code${c.reset} — add to ${c.dim}~/.claude.json${c.reset} or project ${c.dim}.claude.json${c.reset}:

  ${c.green}{
    "mcpServers": {
      "trace": {
        "command": "trace-mcp"
      }
    }
  }${c.reset}

${c.bold}Cursor${c.reset} — add to ${c.dim}.cursor/mcp.json${c.reset} in your project:

  ${c.green}{
    "mcpServers": {
      "trace": {
        "command": "trace-mcp"
      }
    }
  }${c.reset}

${c.bold}Kiro${c.reset} — add trace-mcp as an MCP server in Kiro's MCP settings.

${c.bold}Tools exposed:${c.reset}
  ${c.cyan}trace_context${c.reset}     Project state, anchors, consumers (call at session start)
  ${c.cyan}trace_impact${c.reset}      Blast radius analysis (call before modifying files)
  ${c.cyan}trace_check${c.reset}       Coherence validation (call after changes)
  ${c.cyan}trace_status${c.reset}      Quick health overview
  ${c.cyan}trace_deps_check${c.reset}  Dependency policy check (call before adding packages)
  ${c.cyan}trace_log${c.reset}         Record session activity to PROJECT_LOG

${c.dim}After setup, restart your AI tool. TRACE tools appear automatically.${c.reset}
`);
}

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
      if (args[0] === 'audit') {
        const { runDepsAudit } = await import('../src/deps-audit.js');
        runDepsAudit(args.slice(1));
      } else {
        const { runDeps } = await import('../src/deps.js');
        runDeps(args[0]);
      }
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
        runGateStart(args.slice(1));
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
      runWatch(args);
      break;
    }
    case 'hook': {
      const { runHook } = await import('../src/hook.js');
      runHook(args);
      break;
    }
    case 'mcp': {
      if (args[0] === 'setup') {
        printMcpSetup();
      } else {
        const { startServer } = await import('../src/mcp-server.js');
        startServer();
      }
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
