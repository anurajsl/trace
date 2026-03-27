import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  c, findProjectRoot, loadConfig,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists, matchesPattern
} from './utils.js';

/**
 * trace deps audit — Dependency governance.
 * Checks dependencies against policy rules in trace.yaml.
 *
 * Policy modes:
 *   strict     — Only allowed-list packages permitted
 *   moderate   — Must pass rules (license, age, downloads)
 *   permissive — Flag issues but don't block
 */
export function runDepsAudit(args = []) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    process.exit(1);
  }

  const config = loadConfig(root);
  const depConfig = config.dependencies || {};
  const policy = depConfig.policy || 'moderate';

  printHeader('TRACE Dependency Audit');
  console.log(`  Policy: ${c.bold}${policy}${c.reset}\n`);

  // Detect package manager
  const pm = detectPM(root);
  if (!pm) {
    printWarn('No package.json, requirements.txt, or Cargo.toml found.');
    printInfo('Dependency audit needs a recognized package manifest.\n');
    return { pass: true, issues: [] };
  }

  printInfo(`Package manager: ${pm.name}`);
  const deps = pm.getDeps(root);

  if (deps.length === 0) {
    printPass('No dependencies found.\n');
    return { pass: true, issues: [] };
  }

  console.log(`  Dependencies: ${c.bold}${deps.length}${c.reset} total`);

  const maxDeps = depConfig.max_dependencies;
  if (maxDeps && deps.length > maxDeps) {
    printWarn(`Count (${deps.length}) exceeds threshold (${maxDeps})`);
  }
  console.log();

  // Run checks
  const issues = [];
  const allowed = depConfig.allowed || [];
  const blocked = depConfig.blocked || [];
  const rules = depConfig.rules || {};
  const allowedLicenses = rules.allowed_licenses || [];
  const blockedLicenses = rules.blocked_licenses || [];

  for (const dep of deps) {
    const depIssues = checkDep(root, dep, {
      policy, allowed, blocked, rules, allowedLicenses, blockedLicenses, pm
    });
    if (depIssues.length > 0) {
      issues.push({ name: dep.name, version: dep.version, issues: depIssues });
    }
  }

  // Security audit
  if (depConfig.audit !== false) {
    const vulns = securityAudit(root, pm);
    for (const v of vulns) {
      const existing = issues.find(i => i.name === v.pkg);
      const entry = { type: 'vulnerability', severity: v.severity, detail: v.detail };
      if (existing) { existing.issues.push(entry); }
      else { issues.push({ name: v.pkg, version: v.version, issues: [entry] }); }
    }
  }

  // Print results
  console.log();
  if (issues.length === 0) {
    printPass(`All ${deps.length} dependencies pass ${policy} policy.\n`);
  } else {
    printFail(`${issues.length} dependency issue(s):\n`);
    for (const dep of issues) {
      console.log(`  ${c.bold}${dep.name}${c.reset}@${dep.version || '?'}`);
      for (const iss of dep.issues) {
        const icon = iss.type === 'blocked' || iss.type === 'not_allowed' || iss.type === 'vulnerability'
          ? `${c.red}✗` : `${c.yellow}⚠`;
        console.log(`    ${icon}${c.reset} ${fmtIssue(iss)}`);
      }
      console.log();
    }
  }

  const hasBlocking = issues.some(d => d.issues.some(i =>
    i.type === 'blocked' || i.type === 'not_allowed' ||
    (i.type === 'vulnerability' && (i.severity === 'critical' || i.severity === 'high'))
  ));

  const pass = policy === 'permissive' ? true : !hasBlocking;

  if (!pass) {
    printFail(`Dependency audit FAILED under ${policy} policy.`);
    printInfo('Fix issues or adjust policy in trace.yaml under dependencies:.\n');
  }

  return { pass, issues, total: deps.length };
}

function checkDep(root, dep, opts) {
  const { policy, allowed, blocked, rules, allowedLicenses, blockedLicenses, pm } = opts;
  const issues = [];

  // Blocked list
  for (const pattern of blocked) {
    if (dep.name === pattern || matchesPattern(dep.name, pattern)) {
      issues.push({ type: 'blocked', detail: `Matches blocked pattern: ${pattern}` });
      return issues;
    }
  }

  // Strict mode allowlist
  if (policy === 'strict' && allowed.length > 0) {
    if (!allowed.some(a => a === dep.name || matchesPattern(dep.name, a))) {
      issues.push({ type: 'not_allowed', detail: 'Not on allowed list (strict policy)' });
      return issues;
    }
  }

  // Get metadata
  const meta = pm.getMeta(root, dep.name);

  // License checks
  if (meta.license) {
    if (blockedLicenses.length > 0 && blockedLicenses.includes(meta.license)) {
      issues.push({ type: 'license_blocked', detail: `License ${meta.license} is blocked` });
    }
    if (allowedLicenses.length > 0 && !allowedLicenses.includes(meta.license)) {
      issues.push({ type: 'license_warning', detail: `License ${meta.license} not in allowed list` });
    }
  } else if (rules.require_license) {
    issues.push({ type: 'no_license', detail: 'No license declared' });
  }

  // Staleness
  if (rules.max_age_without_update && meta.lastModified) {
    const days = Math.floor((Date.now() - new Date(meta.lastModified).getTime()) / 86400000);
    if (days > rules.max_age_without_update) {
      issues.push({ type: 'stale', detail: `No update in ${days} days (threshold: ${rules.max_age_without_update})` });
    }
  }

  // Pre-1.0 warning
  if (rules.warn_prerelease !== false && dep.version) {
    const major = parseInt(dep.version.replace(/[^0-9.]/, '').split('.')[0], 10);
    if (major === 0) {
      issues.push({ type: 'prerelease', detail: `Pre-1.0 version (${dep.version}) — API may be unstable` });
    }
  }

  return issues;
}

function detectPM(root) {
  if (fileExists(path.join(root, 'package.json'))) {
    return { name: 'npm', getDeps: getNpmDeps, getMeta: getNpmMeta };
  }
  if (fileExists(path.join(root, 'requirements.txt'))) {
    return { name: 'pip', getDeps: getPipDeps, getMeta: () => ({ license: null, lastModified: null }) };
  }
  if (fileExists(path.join(root, 'Cargo.toml'))) {
    return { name: 'cargo', getDeps: getCargoDeps, getMeta: () => ({ license: null, lastModified: null }) };
  }
  return null;
}

function getNpmDeps(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = [];
    for (const [name, ver] of Object.entries(pkg.dependencies || {})) deps.push({ name, version: ver, type: 'production' });
    for (const [name, ver] of Object.entries(pkg.devDependencies || {})) deps.push({ name, version: ver, type: 'dev' });
    return deps;
  } catch { return []; }
}

function getNpmMeta(root, name) {
  const p = path.join(root, 'node_modules', name, 'package.json');
  try {
    if (!fileExists(p)) return { license: null, lastModified: null };
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const stat = fs.statSync(p);
    return { license: pkg.license || null, lastModified: stat.mtime.toISOString(), version: pkg.version };
  } catch { return { license: null, lastModified: null }; }
}

function getPipDeps(root) {
  try {
    return fs.readFileSync(path.join(root, 'requirements.txt'), 'utf8')
      .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => { const [n, v] = l.split(/[=<>!]+/); return { name: n.trim(), version: v?.trim() || '*', type: 'production' }; });
  } catch { return []; }
}

function getCargoDeps(root) {
  try {
    const content = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
    const deps = []; let inDeps = false;
    for (const line of content.split('\n')) {
      if (/^\[dependencies\]/.test(line)) { inDeps = true; continue; }
      if (/^\[/.test(line)) { inDeps = false; continue; }
      if (inDeps && line.includes('=')) {
        const [n, r] = line.split('=').map(s => s.trim());
        deps.push({ name: n, version: r.replace(/"/g, ''), type: 'production' });
      }
    }
    return deps;
  } catch { return []; }
}

function securityAudit(root, pm) {
  if (pm.name !== 'npm') return [];
  if (!fileExists(path.join(root, 'node_modules'))) return [];
  try {
    execSync('npm audit --json 2>/dev/null', { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    return []; // exit 0 means no vulns
  } catch (e) {
    try {
      const data = JSON.parse(e.stdout || '{}');
      const vulns = [];
      if (data.vulnerabilities) {
        for (const [name, info] of Object.entries(data.vulnerabilities)) {
          vulns.push({ pkg: name, version: info.range || '?', severity: info.severity || 'unknown', detail: info.title || `${info.severity} vulnerability` });
        }
      }
      return vulns;
    } catch { return []; }
  }
}

function fmtIssue(i) {
  switch (i.type) {
    case 'blocked': return `BLOCKED: ${i.detail}`;
    case 'not_allowed': return `NOT ALLOWED: ${i.detail}`;
    case 'license_blocked': return `LICENSE BLOCKED: ${i.detail}`;
    case 'license_warning': return `LICENSE: ${i.detail}`;
    case 'no_license': return `NO LICENSE: ${i.detail}`;
    case 'stale': return `STALE: ${i.detail}`;
    case 'prerelease': return `PRE-RELEASE: ${i.detail}`;
    case 'vulnerability': return `VULN [${i.severity}]: ${i.detail}`;
    default: return i.detail;
  }
}
