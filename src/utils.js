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
  return YAML.parse(raw);
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
