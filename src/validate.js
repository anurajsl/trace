import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  c, findProjectRoot, loadConfig,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists
} from './utils.js';

/**
 * Known trace.yaml top-level fields and their expected types.
 */
const SCHEMA = {
  project: { type: 'object', required: true, fields: {
    name: { type: 'string', required: true },
    version: { type: 'string' },
    created: { type: 'string' },
  }},
  anchors: { type: 'array', required: true },
  registry: { type: 'object' },
  verification: { type: 'object', fields: {
    tiers: { type: 'object' },
  }},
  thresholds: { type: 'object', fields: {
    max_file_lines: { type: 'number' },
    max_function_lines: { type: 'number' },
    max_cyclomatic: { type: 'number' },
    max_anchor_consumers: { type: 'number' },
  }},
  contracts: { type: 'object' },
  file_classification: { type: 'object' },
  code_review: { type: 'object' },
  gates: { type: 'object', fields: {
    start: { type: 'object', fields: { checks: { type: 'array' }, on_fail: { type: 'string' } }},
    end: { type: 'object', fields: { checks: { type: 'array' }, on_fail: { type: 'string' } }},
  }},
  artifacts: { type: 'object' },
  debt: { type: 'object', fields: {
    max_accumulated: { type: 'number' },
  }},
  quality: { type: 'object', fields: {
    checks: { type: 'array' },
  }},
};

const KNOWN_FIELDS = Object.keys(SCHEMA);

/**
 * Levenshtein distance for "did you mean?" suggestions.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return d[m][n];
}

function suggest(field, known) {
  let best = null, bestDist = Infinity;
  for (const k of known) {
    const dist = levenshtein(field, k);
    if (dist < bestDist && dist <= 3) { best = k; bestDist = dist; }
  }
  return best;
}

/**
 * trace validate — Validate trace.yaml for correctness.
 * Reports unknown fields, missing required fields, type mismatches,
 * and suggests corrections for typos.
 */
export function runValidate() {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  const configPath = path.join(root, 'trace.yaml');
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    printFail(`Cannot read trace.yaml: ${e.message}`);
    return;
  }

  let config;
  try {
    config = YAML.parse(raw);
  } catch (e) {
    printFail(`trace.yaml has invalid YAML syntax`);
    printFail(`  ${e.message}`);
    printInfo('Fix the YAML syntax and try again.\n');
    return;
  }

  if (!config || typeof config !== 'object') {
    printFail('trace.yaml is empty or not an object');
    return;
  }

  printHeader('TRACE Validate — Config Check');

  let errors = 0;
  let warnings = 0;

  // 1. Check for unknown top-level fields
  for (const field of Object.keys(config)) {
    if (!KNOWN_FIELDS.includes(field)) {
      const suggestion = suggest(field, KNOWN_FIELDS);
      if (suggestion) {
        printFail(`Unknown field "${field}" — did you mean "${suggestion}"?`);
      } else {
        printWarn(`Unknown field "${field}" — not part of TRACE schema`);
      }
      errors++;
    }
  }

  // 2. Check required fields
  for (const [field, spec] of Object.entries(SCHEMA)) {
    if (spec.required && !(field in config)) {
      printFail(`Missing required field: "${field}"`);
      errors++;
    }
  }

  // 3. Type checks on present fields
  for (const [field, spec] of Object.entries(SCHEMA)) {
    if (!(field in config)) continue;
    const val = config[field];
    if (spec.type === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
      printFail(`"${field}" should be an object, got ${Array.isArray(val) ? 'array' : typeof val}`);
      errors++;
    }
    if (spec.type === 'array' && !Array.isArray(val)) {
      printFail(`"${field}" should be an array, got ${typeof val}`);
      errors++;
    }

    // Check nested fields
    if (spec.fields && typeof val === 'object' && !Array.isArray(val) && val !== null) {
      for (const subField of Object.keys(val)) {
        if (!spec.fields[subField] && !['description', 'patterns', 'steps', 'requires_scope_declaration',
            'verification_tier', 'root_cause_required', 'creates_debt', 'debt_resolution',
            'docs_root', 'tracked_docs', 'review_cycle', 'checklist', 'custom_checks',
            'min_verification', 'requires_review', 'tier1', 'tier2', 'tier3',
            'feature', 'bugfix', 'hotfix', 'refactor', 'core', 'supporting', 'peripheral',
            'trace_state', 'project_log', 'live_checkpoint', 'debt_log', 'handoff', 'baseline',
            'severity', 'minor', 'major'].includes(subField)) {
          const subSuggestion = suggest(subField, Object.keys(spec.fields));
          if (subSuggestion) {
            printWarn(`"${field}.${subField}" — did you mean "${subSuggestion}"?`);
          }
          warnings++;
        }
      }
    }
  }

  // 4. Anchor validation
  if (Array.isArray(config.anchors)) {
    for (let i = 0; i < config.anchors.length; i++) {
      const anchor = config.anchors[i];
      if (!anchor.id) {
        printFail(`anchors[${i}]: missing "id" field`);
        errors++;
      }
      if (!anchor.file) {
        printFail(`anchors[${i}]: missing "file" field`);
        errors++;
      } else if (!fileExists(path.join(root, anchor.file))) {
        printWarn(`anchors[${i}] (${anchor.id || '?'}): file "${anchor.file}" does not exist`);
        warnings++;
      }
      if (anchor.consumers && !Array.isArray(anchor.consumers)) {
        printFail(`anchors[${i}] (${anchor.id || '?'}): "consumers" should be an array`);
        errors++;
      }
    }
  }

  // 5. Gate mode validation
  for (const gate of ['start', 'end']) {
    const mode = config.gates?.[gate]?.on_fail;
    if (mode && !['block', 'warn'].includes(mode)) {
      printFail(`gates.${gate}.on_fail must be "block" or "warn", got "${mode}"`);
      errors++;
    }
  }

  // 6. Quality checks validation
  if (Array.isArray(config.quality?.checks)) {
    for (let i = 0; i < config.quality.checks.length; i++) {
      const qc = config.quality.checks[i];
      if (!qc.name) {
        printFail(`quality.checks[${i}]: missing "name"`);
        errors++;
      }
      if (!qc.command) {
        printFail(`quality.checks[${i}]: missing "command"`);
        errors++;
      }
      if (qc.on_fail && !['block', 'warn'].includes(qc.on_fail)) {
        printFail(`quality.checks[${i}] (${qc.name || '?'}): on_fail must be "block" or "warn"`);
        errors++;
      }
    }
  }

  // 7. Threshold range validation
  const t = config.thresholds || {};
  if (t.max_file_lines !== undefined && (t.max_file_lines < 50 || t.max_file_lines > 5000)) {
    printWarn(`thresholds.max_file_lines = ${t.max_file_lines} — unusual range (typical: 200-800)`);
    warnings++;
  }
  if (t.max_function_lines !== undefined && (t.max_function_lines < 10 || t.max_function_lines > 500)) {
    printWarn(`thresholds.max_function_lines = ${t.max_function_lines} — unusual range (typical: 30-100)`);
    warnings++;
  }

  // Summary
  console.log();
  if (errors === 0 && warnings === 0) {
    printPass('trace.yaml is valid — no issues found.\n');
  } else if (errors === 0) {
    printPass(`trace.yaml is valid with ${warnings} warning(s).\n`);
  } else {
    printFail(`${errors} error(s) and ${warnings} warning(s) found.`);
    printInfo('Fix the errors above and run trace validate again.\n');
  }

  return { errors, warnings };
}
