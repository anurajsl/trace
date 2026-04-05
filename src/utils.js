import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

// Colors for terminal output (no dependencies)
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

export function findProjectRoot(startDir = process.cwd()) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'trace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

export function loadConfig(root) {
  const configPath = path.join(root, 'trace.yaml');
  const raw = fs.readFileSync(configPath, 'utf8');
  const projectConfig = YAML.parse(raw);

  // Load org config if it exists (inheritance)
  const orgConfig = loadOrgConfig(root);
  if (orgConfig) {
    return mergeOrgConfig(orgConfig, projectConfig);
  }

  return projectConfig;
}

export function loadOrgConfig(root) {
  // Check project-level org config first, then user home
  const locations = [
    path.join(root, '.trace/org-config.yaml'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.trace/org-config.yaml'),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      try {
        return YAML.parse(fs.readFileSync(loc, 'utf8'));
      } catch { /* skip invalid */ }
    }
  }
  return null;
}

function mergeOrgConfig(org, project) {
  const merged = { ...project };

  // Policies: org provides defaults, project can add more
  if (org.policies) {
    merged.policies = merged.policies || {};
    for (const [category, rules] of Object.entries(org.policies)) {
      const projectRules = merged.policies[category] || [];
      const orgRules = rules || [];
      // Deduplicate: project rules take precedence
      const combined = [...new Set([...orgRules, ...projectRules])];
      merged.policies[category] = combined;
    }
  }

  // Dependencies: org provides defaults, project overrides
  if (org.dependencies && !merged.dependencies) {
    merged.dependencies = org.dependencies;
  } else if (org.dependencies && merged.dependencies) {
    // Merge blocked lists
    const orgBlocked = org.dependencies.blocked || [];
    const projBlocked = merged.dependencies.blocked || [];
    merged.dependencies.blocked = [...new Set([...orgBlocked, ...projBlocked])];
    // Org rules as defaults, project overrides
    if (org.dependencies.rules && !merged.dependencies.rules) {
      merged.dependencies.rules = org.dependencies.rules;
    }
  }

  // Thresholds: project overrides org
  if (org.thresholds && !merged.thresholds) {
    merged.thresholds = org.thresholds;
  }

  // Quality checks: merge (org + project, deduplicated by name)
  if (org.quality?.checks) {
    merged.quality = merged.quality || {};
    merged.quality.checks = merged.quality.checks || [];
    const projNames = new Set(merged.quality.checks.map(c => c.name));
    for (const check of org.quality.checks) {
      if (!projNames.has(check.name)) {
        merged.quality.checks.push(check);
      }
    }
  }

  // Debt: project overrides org
  if (org.debt && !merged.debt) {
    merged.debt = org.debt;
  }

  // Store org name for display
  if (org.organization?.name) {
    merged._orgName = org.organization.name;
  }

  return merged;
}

export function loadYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

export function saveYaml(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(data, { lineWidth: 120 }));
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

export function getDateStamp() {
  return new Date().toISOString().split('T')[0];
}

export function printHeader(text) {
  console.log(`\n${c.cyan}${c.bold}━━━ ${text} ━━━${c.reset}\n`);
}

export function printPass(text) {
  console.log(`  ${c.green}✓${c.reset} ${text}`);
}

export function printFail(text) {
  console.log(`  ${c.red}✗${c.reset} ${text}`);
}

export function printWarn(text) {
  console.log(`  ${c.yellow}⚠${c.reset} ${text}`);
}

export function printInfo(text) {
  console.log(`  ${c.dim}${text}${c.reset}`);
}

/** Count lines in a file */
export function countLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').length;
  } catch { return 0; }
}

/** Glob-like pattern matching (simple) */
export function matchesPattern(filePath, pattern) {
  // Support ** (any depth) and * (single level)
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regex}$`).test(filePath);
}

/** Get all files in a directory recursively */
export function walkDir(dir, base = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      results = results.concat(walkDir(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }
  return results;
}
