import fs from 'fs';
import path from 'path';
import {
  c, findProjectRoot, loadConfig,
  printHeader, printPass, printFail, printWarn, printInfo,
  fileExists
} from './utils.js';

/**
 * License compatibility matrix.
 * Key = project license, Value = set of incompatible dependency licenses.
 * "Incompatible" means: using this dependency in a project with this license
 * creates a legal risk that should be reviewed.
 */
const INCOMPATIBLE = {
  'MIT': ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'GPL-2.0-only', 'GPL-3.0-only', 'AGPL-3.0-only', 'GPL-2.0-or-later', 'GPL-3.0-or-later', 'AGPL-3.0-or-later', 'SSPL-1.0', 'EUPL-1.2'],
  'Apache-2.0': ['GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0'],
  'BSD-2-Clause': ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'GPL-2.0-only', 'GPL-3.0-only', 'AGPL-3.0-only', 'SSPL-1.0'],
  'BSD-3-Clause': ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'GPL-2.0-only', 'GPL-3.0-only', 'AGPL-3.0-only', 'SSPL-1.0'],
  'ISC': ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'GPL-2.0-only', 'GPL-3.0-only', 'AGPL-3.0-only', 'SSPL-1.0'],
  'proprietary': ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'GPL-2.0-only', 'GPL-3.0-only', 'AGPL-3.0-only', 'GPL-2.0-or-later', 'GPL-3.0-or-later', 'AGPL-3.0-or-later', 'LGPL-2.1', 'LGPL-3.0', 'MPL-2.0', 'SSPL-1.0', 'EUPL-1.2', 'CPAL-1.0', 'OSL-3.0'],
};

/**
 * Licenses that always need human review regardless of project license.
 */
const REVIEW_REQUIRED = ['UNLICENSED', 'UNKNOWN', 'SEE LICENSE', 'CUSTOM', 'NONE'];

/**
 * Permissive licenses that are generally safe with everything.
 */
const PERMISSIVE = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'WTFPL', 'Zlib', 'BlueOak-1.0.0'];

/**
 * trace license — Scan dependencies for license compliance.
 */
export function runLicense(args) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    return;
  }

  const config = loadConfig(root);
  const projectLicense = detectProjectLicense(root);

  printHeader('TRACE License Compliance');
  console.log(`  ${c.bold}Project license:${c.reset} ${projectLicense || 'unknown'}\n`);

  // Scan all dependency sources
  const deps = [];
  deps.push(...scanNodeDeps(root));
  deps.push(...scanPythonDeps(root));
  deps.push(...scanGoDeps(root));

  if (deps.length === 0) {
    printInfo('No dependencies found to scan.');
    printInfo('Supports: package.json (Node.js), requirements.txt (Python), go.mod (Go)\n');
    return;
  }

  console.log(`  ${c.bold}Scanning ${deps.length} dependencies...${c.reset}\n`);

  const issues = [];
  const reviewed = [];
  let clean = 0;

  const incompatibleSet = INCOMPATIBLE[projectLicense] || INCOMPATIBLE['proprietary'];

  for (const dep of deps) {
    const licenseNorm = normalizeLicense(dep.license);

    // Check if license needs review
    if (REVIEW_REQUIRED.some(r => licenseNorm.toUpperCase().includes(r))) {
      issues.push({
        name: dep.name,
        license: dep.license,
        severity: 'review',
        reason: 'License requires manual review',
        source: dep.source,
      });
      continue;
    }

    // Check for incompatibility
    if (incompatibleSet.some(incompat => licenseNorm.includes(incompat))) {
      issues.push({
        name: dep.name,
        license: dep.license,
        severity: 'incompatible',
        reason: `${dep.license} is incompatible with project license (${projectLicense})`,
        source: dep.source,
      });
      continue;
    }

    // Check if it's a known permissive license
    if (PERMISSIVE.some(p => licenseNorm.includes(p))) {
      clean++;
    } else {
      // Unknown license — flag for review
      reviewed.push({ name: dep.name, license: dep.license, source: dep.source });
    }
  }

  // Display results
  const incompatible = issues.filter(i => i.severity === 'incompatible');
  const needsReview = issues.filter(i => i.severity === 'review');

  if (incompatible.length > 0) {
    console.log(`  ${c.bold}${c.red}Incompatible Licenses (${incompatible.length}):${c.reset}\n`);
    for (const i of incompatible) {
      printFail(`${i.name} — ${i.license}`);
      printFail(`  ${i.reason}`);
      printInfo(`  Source: ${i.source}`);
    }
    console.log();
  }

  if (needsReview.length > 0) {
    console.log(`  ${c.bold}${c.yellow}Needs Review (${needsReview.length}):${c.reset}\n`);
    for (const i of needsReview) {
      printWarn(`${i.name} — ${i.license}`);
      printInfo(`  Source: ${i.source}`);
    }
    console.log();
  }

  if (reviewed.length > 0) {
    console.log(`  ${c.bold}Unrecognized Licenses (${reviewed.length}):${c.reset}\n`);
    for (const r of reviewed) {
      printWarn(`${r.name} — ${r.license}`);
    }
    console.log();
  }

  // Summary
  console.log(`  ${c.bold}Summary:${c.reset}`);
  console.log(`    ${c.green}${clean}${c.reset} clean (permissive)`);
  if (incompatible.length > 0) console.log(`    ${c.red}${incompatible.length}${c.reset} incompatible`);
  if (needsReview.length > 0) console.log(`    ${c.yellow}${needsReview.length}${c.reset} needs review`);
  if (reviewed.length > 0) console.log(`    ${c.dim}${reviewed.length}${c.reset} unrecognized`);
  console.log(`    ${c.dim}${deps.length} total${c.reset}`);

  console.log();
  if (incompatible.length > 0) {
    printFail('LICENSE COMPLIANCE: ISSUES FOUND');
    printInfo('Review incompatible dependencies before distributing.\n');
  } else if (needsReview.length > 0 || reviewed.length > 0) {
    printWarn('LICENSE COMPLIANCE: REVIEW NEEDED');
    printInfo('Some dependencies have unclear licenses.\n');
  } else {
    printPass('LICENSE COMPLIANCE: ALL CLEAR\n');
  }

  return { incompatible: incompatible.length, review: needsReview.length + reviewed.length, clean };
}

/**
 * Detect the project's license from package.json, LICENSE file, or trace.yaml.
 */
function detectProjectLicense(root) {
  // package.json
  const pkgPath = path.join(root, 'package.json');
  if (fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.license) return pkg.license;
    } catch {}
  }

  // LICENSE file
  const licensePath = path.join(root, 'LICENSE');
  if (fileExists(licensePath)) {
    const content = fs.readFileSync(licensePath, 'utf8').slice(0, 500).toLowerCase();
    if (content.includes('mit license')) return 'MIT';
    if (content.includes('apache license') && content.includes('2.0')) return 'Apache-2.0';
    if (content.includes('gnu general public license') && content.includes('version 3')) return 'GPL-3.0';
    if (content.includes('gnu general public license') && content.includes('version 2')) return 'GPL-2.0';
    if (content.includes('bsd 2-clause')) return 'BSD-2-Clause';
    if (content.includes('bsd 3-clause')) return 'BSD-3-Clause';
    if (content.includes('isc license')) return 'ISC';
  }

  return 'proprietary';
}

/**
 * Scan Node.js deps from installed modules
 */
function scanNodeDeps(root) {
  const deps = [];
  const nmPath = path.join(root, 'node_modules');
  if (!fs.existsSync(nmPath)) return deps;

  // Read package.json for dependency list
  const pkgPath = path.join(root, 'package.json');
  if (!fileExists(pkgPath)) return deps;

  let depNames = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    depNames = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];
  } catch { return deps; }

  for (const name of depNames) {
    const depPkgPath = path.join(nmPath, name, 'package.json');
    if (!fileExists(depPkgPath)) {
      // Try scoped package
      if (name.startsWith('@')) {
        const parts = name.split('/');
        const scopedPath = path.join(nmPath, parts[0], parts[1], 'package.json');
        if (fileExists(scopedPath)) {
          try {
            const dpkg = JSON.parse(fs.readFileSync(scopedPath, 'utf8'));
            deps.push({ name, license: dpkg.license || 'UNKNOWN', source: 'package.json' });
          } catch {}
        }
        continue;
      }
      deps.push({ name, license: 'UNKNOWN', source: 'package.json (not installed)' });
      continue;
    }

    try {
      const dpkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'));
      let license = dpkg.license || 'UNKNOWN';
      if (typeof license === 'object') license = license.type || 'UNKNOWN';
      deps.push({ name, license, source: 'package.json' });
    } catch {
      deps.push({ name, license: 'UNKNOWN', source: 'package.json' });
    }
  }

  return deps;
}

/**
 * Scan Python dependencies from requirements.txt
 * Note: License detection for Python requires installed packages — we flag for review.
 */
function scanPythonDeps(root) {
  const deps = [];
  const reqFiles = ['requirements.txt', 'requirements-dev.txt', 'requirements_dev.txt'];

  for (const reqFile of reqFiles) {
    const reqPath = path.join(root, reqFile);
    if (!fileExists(reqPath)) continue;

    const lines = fs.readFileSync(reqPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      const name = trimmed.split(/[=<>!~\[]/)[0].trim();
      if (name) {
        deps.push({ name, license: 'UNKNOWN (Python — run pip-licenses for details)', source: reqFile });
      }
    }
  }

  return deps;
}

/**
 * Scan Go dependencies from go.mod
 */
function scanGoDeps(root) {
  const deps = [];
  const goModPath = path.join(root, 'go.mod');
  if (!fileExists(goModPath)) return deps;

  const content = fs.readFileSync(goModPath, 'utf8');
  const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
  if (!requireBlock) return deps;

  const lines = requireBlock[1].split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      deps.push({ name: parts[0], license: 'UNKNOWN (Go — check go-licenses)', source: 'go.mod' });
    }
  }

  return deps;
}

function normalizeLicense(license) {
  if (!license) return 'UNKNOWN';
  return license
    .replace(/\s+/g, '-')
    .replace('only', '-only')
    .replace('or-later', '-or-later');
}
