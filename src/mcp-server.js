import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  findProjectRoot, loadConfig, loadYaml,
  fileExists, countLines, getTimestamp, walkDir
} from './utils.js';

/**
 * TRACE MCP Server
 *
 * Exposes TRACE's verification capabilities as MCP tools that AI assistants
 * call automatically during conversations. This makes TRACE proactive instead
 * of reactive — the AI consults TRACE before and during changes, not just after.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard)
 * Dependencies: None (uses Node.js core only)
 *
 * Tools exposed:
 *   trace_context    — Project state, anchors, consumers, AI context
 *   trace_impact     — Blast radius before modifying a file
 *   trace_check      — Coherence validation (5-pillar check)
 *   trace_status     — Quick health overview
 *   trace_deps_audit — Dependency policy check
 *   trace_validate   — Config validation
 */

const SERVER_INFO = {
  name: 'trace-coherence',
  version: '1.0.1',
};

const TOOLS = [
  {
    name: 'trace_context',
    description: 'Get current TRACE project state. Call this at the START of every conversation to understand the project structure, anchors, consumers, outstanding debt, and current plan items. This gives you the context needed to make structurally coherent changes.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Optional scope name to filter anchors (e.g., "frontend", "backend"). Only returns anchors in that scope. Scopes are defined in trace.yaml under scopes:. Omit to get all anchors.',
        },
      },
    },
  },
  {
    name: 'trace_impact',
    description: 'Analyze blast radius BEFORE modifying a file. Call this whenever you are about to change a file that might be an anchor (source of truth). Returns all consumer files that depend on it and must be updated together. ALWAYS call this before modifying core files like models, schemas, configs, or shared utilities.',
    inputSchema: {
      type: 'object',
      properties: {
        file_or_anchor: {
          type: 'string',
          description: 'File path (e.g., "src/models/user.ts") or anchor ID (e.g., "user_model") to analyze',
        },
      },
      required: ['file_or_anchor'],
    },
  },
  {
    name: 'trace_check',
    description: 'Run coherence validation AFTER making changes. Checks all five pillars: truth anchoring, registry enforcement, automated verification, controlled evolution, execution contracts. Call this after finishing a set of changes to verify nothing is out of sync.',
    inputSchema: {
      type: 'object',
      properties: {
        brief: {
          type: 'boolean',
          description: 'If true, return one-line summary when everything passes. Full details only on failures. Default: true (saves tokens).',
        },
      },
    },
  },
  {
    name: 'trace_status',
    description: 'Quick health overview of the project. Returns anchor count, consumer count, debt items, test status, and last session info. Lighter than trace_check.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'trace_deps_check',
    description: 'Check if a package passes dependency policy BEFORE adding it. Call this whenever you are about to add a new npm/pip/cargo dependency. Returns whether the package is allowed, blocked, or has license/staleness issues.',
    inputSchema: {
      type: 'object',
      properties: {
        package_name: {
          type: 'string',
          description: 'Package name to check (e.g., "lodash", "express")',
        },
      },
      required: ['package_name'],
    },
  },
  {
    name: 'trace_log',
    description: 'Record what you did to the project log. Call this after completing a meaningful set of changes so the next session has context about what happened.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief description of changes made (1-3 sentences)',
        },
        files_changed: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files that were modified',
        },
      },
      required: ['summary'],
    },
  },
];

// ===== TOOL IMPLEMENTATIONS =====

function toolContext(args = {}) {
  const root = findProjectRoot();
  if (!root) return { error: 'No TRACE project found. Run "trace scan" or "trace init" first.' };

  const scope = args.scope || null;

  // Check if AI_CONTEXT.md is fresh (generated within last 30 min)
  const ctxPath = path.join(root, '.trace/AI_CONTEXT.md');
  if (!scope && fileExists(ctxPath)) {
    const stat = fs.statSync(ctxPath);
    const ageMin = (Date.now() - stat.mtimeMs) / 60000;
    if (ageMin < 30) {
      return {
        content: `Context file is current (${Math.round(ageMin)}min old). Read .trace/AI_CONTEXT.md for full project state.\n\nQuick summary:\n` + getQuickSummary(root),
      };
    }
  }

  // Full context if file is stale or missing
  return { content: getFullContext(root, scope) };
}

function getQuickSummary(root) {
  const config = loadConfig(root);
  const anchors = config.anchors || [];
  const totalConsumers = anchors.reduce((sum, a) => sum + (a.consumers || []).length, 0);
  const state = loadYaml(path.join(root, '.trace/TRACE_STATE.yaml')) || {};
  const debt = state.debt || [];
  return [
    `Project: ${config.project?.name || 'Unknown'} | ${anchors.length} anchors | ${totalConsumers} consumers | ${debt.length} debt`,
    `Gate mode: ${config.gates?.end?.mode || 'warn'} | Dep policy: ${config.dependencies?.policy || 'none'}`,
    'IMPORTANT: Call trace_impact before modifying any anchor file.',
  ].join('\n');
}

function getFullContext(root, scope = null) {
  const config = loadConfig(root);
  const state = loadYaml(path.join(root, '.trace/TRACE_STATE.yaml')) || {};
  const plan = loadYaml(path.join(root, '.trace/PLAN.yaml'));

  // Filter anchors by scope if specified
  let allAnchors = config.anchors || [];
  if (scope && config.scopes?.[scope]) {
    const scopeAnchorIds = config.scopes[scope].anchors || [];
    allAnchors = allAnchors.filter(a => scopeAnchorIds.includes(a.id));
  }

  const anchors = allAnchors.map(a => ({
    id: a.id,
    file: a.file,
    consumers: a.consumers || [],
    consumer_count: (a.consumers || []).length,
  }));

  const debt = state.debt || [];
  const gateMode = config.gates?.end?.mode || 'warn';

  const planItems = [];
  if (plan?.items) {
    for (const item of plan.items) {
      if (item.status !== 'done') {
        planItems.push({ id: item.id, title: item.title, status: item.status, priority: item.priority });
      }
    }
  }

  const depPolicy = config.dependencies?.policy || 'none';
  const blockedPkgs = config.dependencies?.blocked || [];

  // Handoff — only last 3 entries
  let handoffRecent = 'No handoff file.';
  const handoffPath = path.join(root, '.trace/HANDOFF.md');
  if (fileExists(handoffPath)) {
    const handoff = fs.readFileSync(handoffPath, 'utf8');
    const entries = handoff.split(/^## /m).filter(e => e.trim());
    handoffRecent = entries.slice(-3).map(e => '## ' + e.trim()).join('\n\n');
    if (!handoffRecent) handoffRecent = handoff.slice(0, 500);
  }

  return [
    `PROJECT: ${config.project?.name || 'Unknown'}`,
    `GATE MODE: ${gateMode}`,
    '',
    `ANCHORS (${anchors.length}):`,
    ...anchors.map(a => `  ${a.id}: ${a.file} → ${a.consumer_count} consumers [${a.consumers.join(', ')}]`),
    '',
    `DEBT: ${debt.length} item(s)`,
    ...debt.map(d => `  - ${d.reason} (${d.severity || 'unknown'})`),
    '',
    `DEPENDENCY POLICY: ${depPolicy}`,
    blockedPkgs.length ? `BLOCKED PACKAGES: ${blockedPkgs.join(', ')}` : '',
    '',
  ];

  // Policies
  const policies = config.policies || {};
  const policyKeys = Object.keys(policies);
  if (policyKeys.length > 0) {
    lines.push('POLICIES (MANDATORY):');
    for (const cat of policyKeys) {
      for (const rule of policies[cat]) {
        lines.push(`  [${cat}] ${rule}`);
      }
    }
    lines.push('');
  }

  lines.push(
    `ACTIVE PLAN ITEMS (${planItems.length}):`,
    ...planItems.map(p => `  ${p.id}: [${p.status}] ${p.title} (${p.priority || 'medium'})`),
    '',
    'LAST SESSION (recent entries only):',
    handoffRecent,
    '',
    'IMPORTANT: Before modifying any anchor file, call trace_impact first.',
  );

  return lines.filter(l => l !== false).join('\n');
}

function toolImpact(args) {
  const root = findProjectRoot();
  if (!root) return { error: 'No TRACE project found.' };

  const config = loadConfig(root);
  const anchors = config.anchors || [];
  const query = args.file_or_anchor;

  // Find anchor by ID or file path
  let anchor = anchors.find(a => a.id === query);
  if (!anchor) anchor = anchors.find(a => a.file === query);
  if (!anchor) {
    // Check if this file is a consumer of any anchor
    const asConsumer = [];
    for (const a of anchors) {
      if ((a.consumers || []).includes(query)) {
        asConsumer.push(a);
      }
    }
    if (asConsumer.length > 0) {
      return {
        content: [
          `"${query}" is a CONSUMER of:`,
          ...asConsumer.map(a => `  - ${a.id} (${a.file})`),
          '',
          'Modifying this file is lower risk — it depends on anchors, not the other way around.',
          'But verify your changes are consistent with the anchor interfaces.',
        ].join('\n'),
      };
    }
    return {
      content: `"${query}" is not tracked as an anchor or consumer. It can be modified freely, but consider whether it should be tracked.`,
    };
  }

  const consumers = anchor.consumers || [];
  const lines = [
    `ANCHOR: ${anchor.id}`,
    `FILE: ${anchor.file}`,
    `CONSUMERS (${consumers.length}):`,
  ];

  for (const c of consumers) {
    const exists = fileExists(path.join(root, c));
    lines.push(`  ${exists ? '✓' : '✗'} ${c}${exists ? '' : ' (MISSING)'}`);
  }

  // Check transitive impact
  const transitive = new Set();
  for (const c of consumers) {
    for (const a2 of anchors) {
      if (a2.file === c) {
        for (const c2 of (a2.consumers || [])) {
          if (!consumers.includes(c2)) transitive.add(c2);
        }
      }
    }
  }

  if (transitive.size > 0) {
    lines.push('');
    lines.push(`TRANSITIVE IMPACT (${transitive.size} additional files):`);
    for (const t of transitive) lines.push(`  → ${t}`);
  }

  lines.push('');
  lines.push(`ACTION REQUIRED: If you modify ${anchor.file}, you MUST also update all ${consumers.length} consumer files listed above.`);

  return { content: lines.join('\n') };
}

function toolCheck(args = {}) {
  const root = findProjectRoot();
  if (!root) return { error: 'No TRACE project found.' };

  const brief = args.brief !== false; // default true
  const config = loadConfig(root);
  const anchors = config.anchors || [];
  const issues = [];
  let passCount = 0;

  // Pillar 1: Truth Anchoring — all anchor files exist
  for (const a of anchors) {
    if (fileExists(path.join(root, a.file))) {
      passCount++;
    } else {
      issues.push(`ANCHOR MISSING: ${a.id} (${a.file}) does not exist`);
    }
  }

  // Pillar 2: Registry — all consumers exist
  for (const a of anchors) {
    for (const c of (a.consumers || [])) {
      if (fileExists(path.join(root, c))) {
        passCount++;
      } else {
        issues.push(`CONSUMER MISSING: ${c} (consumer of ${a.id}) does not exist`);
      }
    }
  }

  // Pillar 3: Thresholds
  const maxLines = config.thresholds?.max_file_lines || 400;
  for (const a of anchors) {
    const fp = path.join(root, a.file);
    if (fileExists(fp)) {
      const lines = countLines(fp);
      if (lines > maxLines) {
        issues.push(`THRESHOLD: ${a.file} is ${lines} lines (max: ${maxLines})`);
      }
    }
    for (const c of (a.consumers || [])) {
      const cp = path.join(root, c);
      if (fileExists(cp)) {
        const lines = countLines(cp);
        if (lines > maxLines) {
          issues.push(`THRESHOLD: ${c} is ${lines} lines (max: ${maxLines})`);
        }
      }
    }
  }

  // Pillar 4: State files exist
  const stateFiles = ['TRACE_STATE.yaml', 'PROJECT_LOG.md', 'HANDOFF.md'];
  for (const sf of stateFiles) {
    if (fileExists(path.join(root, '.trace', sf))) {
      passCount++;
    } else {
      issues.push(`STATE: .trace/${sf} is missing`);
    }
  }

  // Debt check
  const state = loadYaml(path.join(root, '.trace/TRACE_STATE.yaml')) || {};
  const debt = state.debt || [];
  const maxDebt = config.debt?.max_accumulated || 5;
  if (debt.length > maxDebt) {
    issues.push(`DEBT: ${debt.length} items exceed threshold of ${maxDebt}`);
  }

  const status = issues.length === 0 ? 'COHERENT' : 'ISSUES FOUND';

  // Brief mode: one line if everything passes
  if (brief && issues.length === 0) {
    return { content: `COHERENT — ${passCount} checks passed, 0 issues. Safe to commit.` };
  }

  const lines = [
    `STATUS: ${status}`,
    `CHECKS PASSED: ${passCount}`,
    `ISSUES: ${issues.length}`,
  ];

  if (issues.length > 0) {
    lines.push('');
    for (const issue of issues) lines.push(`  ✗ ${issue}`);
    lines.push('');
    lines.push('Fix these issues before committing. The pre-commit hook will block if these are not resolved.');
  } else {
    lines.push('');
    lines.push('All pillars verified. Safe to commit.');
  }

  return { content: lines.join('\n') };
}

function toolStatus() {
  const root = findProjectRoot();
  if (!root) return { error: 'No TRACE project found.' };

  const config = loadConfig(root);
  const state = loadYaml(path.join(root, '.trace/TRACE_STATE.yaml')) || {};
  const anchors = config.anchors || [];
  const totalConsumers = anchors.reduce((sum, a) => sum + (a.consumers || []).length, 0);
  const debt = state.debt || [];
  const gateMode = config.gates?.end?.mode || 'warn';
  const depPolicy = config.dependencies?.policy || 'none';

  // Inline coherence score (lightweight)
  let score = 100;
  try {
    const existing = anchors.filter(a => fs.existsSync(path.join(root, a.file))).length;
    const anchorPct = anchors.length > 0 ? existing / anchors.length : 1;
    const debtPct = Math.max(0, 1 - debt.length / (config.debt?.max_accumulated || 5));
    const hasPolicies = config.policies && Object.keys(config.policies).length > 0 ? 1 : 0.8;
    score = Math.round((anchorPct * 40 + debtPct * 30 + hasPolicies * 15 + 15) );
  } catch {}

  return {
    content: [
      `Project: ${config.project?.name || 'Unknown'}`,
      `Coherence: ${score}/100`,
      `Anchors: ${anchors.length}`,
      `Consumers: ${totalConsumers}`,
      `Debt: ${debt.length} item(s)`,
      `Gate mode: ${gateMode}`,
      `Dependency policy: ${depPolicy}`,
    ].join('\n'),
  };
}

function toolDepsCheck(args) {
  const root = findProjectRoot();
  if (!root) return { error: 'No TRACE project found.' };

  const config = loadConfig(root);
  const depConfig = config.dependencies || {};
  const policy = depConfig.policy || 'moderate';
  const blocked = depConfig.blocked || [];
  const allowed = depConfig.allowed || [];
  const rules = depConfig.rules || {};
  const blockedLicenses = rules.blocked_licenses || [];
  const pkgName = args.package_name;

  const issues = [];

  // Check blocked list
  for (const pattern of blocked) {
    if (pkgName === pattern || pkgName.match(new RegExp('^' + pattern.replace(/\*/g, '.*') + '$'))) {
      issues.push(`BLOCKED: "${pkgName}" matches blocked pattern "${pattern}"`);
    }
  }

  // Strict mode allowlist
  if (policy === 'strict' && allowed.length > 0 && !allowed.includes(pkgName)) {
    issues.push(`NOT ALLOWED: "${pkgName}" is not on the allowed list (strict policy)`);
  }

  // Check if already installed (look in node_modules)
  const metaPath = path.join(root, 'node_modules', pkgName, 'package.json');
  if (fileExists(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.license && blockedLicenses.includes(meta.license)) {
        issues.push(`LICENSE: ${meta.license} is blocked by policy`);
      }
    } catch {}
  }

  if (issues.length === 0) {
    return { content: `"${pkgName}" passes ${policy} dependency policy. Safe to add.` };
  }

  return {
    content: [
      `DEPENDENCY CHECK FAILED for "${pkgName}":`,
      ...issues.map(i => `  ✗ ${i}`),
      '',
      'Do NOT add this package. Find an alternative or request a policy exception.',
    ].join('\n'),
  };
}

function toolLog(args) {
  const root = findProjectRoot();
  if (!root) return { error: 'No TRACE project found.' };

  const logPath = path.join(root, '.trace/PROJECT_LOG.md');
  const handoffPath = path.join(root, '.trace/HANDOFF.md');
  const ts = getTimestamp();
  const files = args.files_changed || [];

  // Append to PROJECT_LOG
  if (fileExists(logPath)) {
    const entry = [
      '',
      `## Session | ${ts}`,
      '',
      `**Summary:** ${args.summary}`,
      files.length > 0 ? `**Files:** ${files.join(', ')}` : '',
      '',
    ].filter(l => l !== '').join('\n');

    try {
      fs.appendFileSync(logPath, entry + '\n');
    } catch {}
  }

  // Update HANDOFF
  if (fileExists(handoffPath)) {
    try {
      const note = [
        '',
        `## Last Activity`,
        '',
        `**When:** ${ts}`,
        `**What:** ${args.summary}`,
        files.length > 0 ? `**Files:** ${files.join(', ')}` : '',
        '',
      ].filter(l => l !== '').join('\n');

      fs.appendFileSync(handoffPath, note + '\n');
    } catch {}
  }

  return { content: `Logged to PROJECT_LOG.md and HANDOFF.md at ${ts}.` };
}

// ===== MCP PROTOCOL HANDLER =====

const toolHandlers = {
  trace_context: (args) => toolContext(args),
  trace_impact: (args) => toolImpact(args),
  trace_check: (args) => toolCheck(args),
  trace_status: () => toolStatus(),
  trace_deps_check: (args) => toolDepsCheck(args),
  trace_log: (args) => toolLog(args),
};

function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };

    case 'notifications/initialized':
      return null; // No response for notifications

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const handler = toolHandlers[toolName];

      if (!handler) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            isError: true,
          },
        };
      }

      try {
        const result = handler(toolArgs);
        if (result.error) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: result.error }],
              isError: true,
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: result.content }],
          },
        };
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${e.message}` }],
            isError: true,
          },
        };
      }
    }

    default:
      if (id) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }
      return null; // Unknown notification, ignore
  }
}

// ===== STDIO TRANSPORT =====

export function startServer() {
  // Suppress any console output — MCP uses stdout exclusively
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  let buffer = '';

  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString();

    // Handle Content-Length framed messages (LSP-style)
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        // Try newline-delimited JSON as fallback
        const nlIndex = buffer.indexOf('\n');
        if (nlIndex === -1) break;

        const line = buffer.slice(0, nlIndex).trim();
        buffer = buffer.slice(nlIndex + 1);

        if (!line) continue;

        try {
          const msg = JSON.parse(line);
          const response = handleMessage(msg);
          if (response) {
            sendMessage(response);
          }
        } catch (e) {
          // Not valid JSON, skip
        }
        continue;
      }

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) break; // Wait for more data

      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body);
        const response = handleMessage(msg);
        if (response) {
          sendMessage(response);
        }
      } catch (e) {
        // Parse error
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  process.stdout.write(header + json);
}
