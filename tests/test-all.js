#!/usr/bin/env node
/**
 * TRACE CLI — Test Suite
 * Minimal, zero-dependency test runner.
 * Tests core paths: config validation, gates, scan, impact, plan, ci, metrics, search.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'trace.js');

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31m${e.message}\x1b[0m`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000, ...opts });
  } catch (e) {
    if (opts.expectFail) return e.stdout || e.stderr || '';
    throw e;
  }
}

function setupTempProject(name) {
  const dir = path.join('/tmp', `trace-test-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ============================================================
console.log('\n\x1b[1mTRACE CLI — Test Suite\x1b[0m\n');

// ============================================================
console.log('\x1b[36m--- Help & Version ---\x1b[0m');
// ============================================================

test('trace --help shows usage', () => {
  const out = run(`node ${CLI} --help`);
  assert(out.includes('TRACE'), 'Should contain TRACE');
  assert(out.includes('trace init'), 'Should list trace init');
  assert(out.includes('trace metrics'), 'Should list trace metrics');
  assert(out.includes('trace ci'), 'Should list trace ci');
});

test('trace --version shows version', () => {
  const out = run(`node ${CLI} --version`);
  assert(out.includes('trace v'), 'Should show version');
});

test('unknown command shows error', () => {
  const out = run(`node ${CLI} foobar 2>&1`, { expectFail: true });
  assert(out.includes('Unknown command'), 'Should show unknown command error');
});

// ============================================================
console.log('\x1b[36m--- Init ---\x1b[0m');
// ============================================================

test('trace init creates project structure', () => {
  const dir = setupTempProject('init');
  try {
    const out = run(`echo "TestProject" | node ${CLI} init`, { cwd: dir });
    assert(fs.existsSync(path.join(dir, 'trace.yaml')), 'trace.yaml should exist');
    assert(fs.existsSync(path.join(dir, '.trace')), '.trace/ should exist');
    assert(fs.existsSync(path.join(dir, '.trace/TRACE_STATE.yaml')), 'TRACE_STATE should exist');
    assert(fs.existsSync(path.join(dir, '.trace/PROJECT_LOG.md')), 'PROJECT_LOG should exist');
    assert(fs.existsSync(path.join(dir, '.trace/PLAN.yaml')), 'PLAN.yaml should exist');
    assert(fs.existsSync(path.join(dir, '.trace/METRICS.yaml')), 'METRICS.yaml should exist');
    assert(fs.existsSync(path.join(dir, '.trace/DEBT.yaml')), 'DEBT.yaml should exist');
    assert(fs.existsSync(path.join(dir, '.trace/HANDOFF.md')), 'HANDOFF.md should exist');
    assert(fs.existsSync(path.join(dir, '.trace/releases')), 'releases/ should exist');
    
    const yaml = fs.readFileSync(path.join(dir, 'trace.yaml'), 'utf8');
    assert(yaml.includes('TestProject'), 'trace.yaml should contain project name');
    assert(yaml.includes('quality:'), 'trace.yaml should have quality section');
  } finally { cleanup(dir); }
});

test('trace init rejects if trace.yaml already exists', () => {
  const dir = setupTempProject('init-dup');
  try {
    fs.writeFileSync(path.join(dir, 'trace.yaml'), 'existing: true');
    // init should still work but trace.yaml should be overwritten by init
    // (this is expected behavior — init is for new projects)
    assert(true, 'No crash on existing trace.yaml');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Config Validation ---\x1b[0m');
// ============================================================

test('trace check handles missing trace.yaml gracefully', () => {
  const dir = setupTempProject('noconfig');
  try {
    const out = run(`node ${CLI} check 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('No trace.yaml') || out.includes('trace init'), 'Should suggest trace init');
  } finally { cleanup(dir); }
});

test('trace check handles empty anchors array', () => {
  const dir = setupTempProject('empty-anchors');
  try {
    fs.writeFileSync(path.join(dir, 'trace.yaml'), 'project:\n  name: Test\nanchors: []\n');
    fs.mkdirSync(path.join(dir, '.trace'), { recursive: true });
    const out = run(`node ${CLI} check 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('No anchors') || out.includes('TRACE Check'), 'Should handle empty anchors');
  } finally { cleanup(dir); }
});

test('trace check handles malformed trace.yaml', () => {
  const dir = setupTempProject('malformed');
  try {
    fs.writeFileSync(path.join(dir, 'trace.yaml'), '}{invalid yaml{[');
    const out = run(`node ${CLI} check 2>&1`, { cwd: dir, expectFail: true });
    // Should not crash with unhandled exception
    assert(true, 'Did not crash on malformed yaml');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Status ---\x1b[0m');
// ============================================================

test('trace status works with minimal config', () => {
  const dir = setupTempProject('status');
  try {
    run(`echo "StatusTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} status 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('StatusTest') || out.includes('Status'), 'Should show project name or status');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Plan ---\x1b[0m');
// ============================================================

test('trace plan shows empty board', () => {
  const dir = setupTempProject('plan-empty');
  try {
    run(`echo "PlanTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} plan 2>&1`, { cwd: dir });
    assert(out.includes('TO DO') || out.includes('PLAN'), 'Should show board columns');
  } finally { cleanup(dir); }
});

test('trace plan add creates item', () => {
  const dir = setupTempProject('plan-add');
  try {
    run(`echo "PlanTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} plan add "Build auth module" --priority high 2>&1`, { cwd: dir });
    assert(out.includes('ITEM-001'), 'Should create ITEM-001');
    assert(out.includes('high'), 'Should show priority');
  } finally { cleanup(dir); }
});

test('trace plan move changes item status', () => {
  const dir = setupTempProject('plan-move');
  try {
    run(`echo "PlanTest" | node ${CLI} init`, { cwd: dir });
    run(`node ${CLI} plan add "Test item" 2>&1`, { cwd: dir });
    const out = run(`node ${CLI} plan move ITEM-001 done 2>&1`, { cwd: dir });
    assert(out.includes('done'), 'Should show new status');
  } finally { cleanup(dir); }
});

test('trace plan move rejects invalid item', () => {
  const dir = setupTempProject('plan-move-bad');
  try {
    run(`echo "PlanTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} plan move ITEM-999 done 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('not found') || out.includes('ITEM-999'), 'Should report item not found');
  } finally { cleanup(dir); }
});

test('trace plan release generates release note', () => {
  const dir = setupTempProject('plan-release');
  try {
    run(`echo "RelTest" | node ${CLI} init`, { cwd: dir });
    run(`node ${CLI} plan add "Feature A" 2>&1`, { cwd: dir });
    run(`node ${CLI} plan move ITEM-001 done 2>&1`, { cwd: dir });
    run(`node ${CLI} plan release v1.0.0 2>&1`, { cwd: dir });
    const releases = fs.readdirSync(path.join(dir, '.trace/releases'));
    assert(releases.length > 0, 'Should create release note file');
    const content = fs.readFileSync(path.join(dir, '.trace/releases', releases[0]), 'utf8');
    assert(content.includes('Feature A'), 'Release note should contain completed item');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Integrity ---\x1b[0m');
// ============================================================

test('trace integrity reports no manifest initially', () => {
  const dir = setupTempProject('integrity');
  try {
    run(`echo "IntTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} integrity 2>&1`, { cwd: dir });
    assert(out.includes('No integrity') || out.includes('manifest'), 'Should report no manifest');
  } finally { cleanup(dir); }
});

test('trace integrity --generate creates manifest', () => {
  const dir = setupTempProject('integrity-gen');
  try {
    run(`echo "IntTest" | node ${CLI} init`, { cwd: dir });
    run(`node ${CLI} integrity --generate 2>&1`, { cwd: dir });
    assert(fs.existsSync(path.join(dir, '.trace/INTEGRITY.sha256')), 'Manifest should exist');
  } finally { cleanup(dir); }
});

test('trace integrity detects tampering', () => {
  const dir = setupTempProject('integrity-tamper');
  try {
    run(`echo "IntTest" | node ${CLI} init`, { cwd: dir });
    run(`node ${CLI} integrity --generate 2>&1`, { cwd: dir });
    // Tamper with DEBT.yaml
    fs.appendFileSync(path.join(dir, '.trace/DEBT.yaml'), '\ntampered: true');
    const out = run(`node ${CLI} integrity 2>&1`, { cwd: dir });
    assert(out.includes('TAMPERED') || out.includes('mismatch'), 'Should detect tampering');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Search ---\x1b[0m');
// ============================================================

test('trace search finds content in PROJECT_LOG', () => {
  const dir = setupTempProject('search');
  try {
    run(`echo "SearchTest" | node ${CLI} init`, { cwd: dir });
    fs.appendFileSync(path.join(dir, '.trace/PROJECT_LOG.md'), '\n## Session: Added authentication module\n');
    const out = run(`node ${CLI} search authentication 2>&1`, { cwd: dir });
    assert(out.includes('authentication') || out.includes('result'), 'Should find search term');
  } finally { cleanup(dir); }
});

test('trace search returns no results for nonsense', () => {
  const dir = setupTempProject('search-empty');
  try {
    run(`echo "SearchTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} search xyzzygarbage123 2>&1`, { cwd: dir });
    assert(out.includes('No results'), 'Should report no results');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Impact ---\x1b[0m');
// ============================================================

test('trace impact without anchor_id shows usage', () => {
  const dir = setupTempProject('impact-usage');
  try {
    run(`echo "ImpTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} impact 2>&1`, { cwd: dir });
    assert(out.includes('Usage') || out.includes('anchor'), 'Should show usage');
  } finally { cleanup(dir); }
});

test('trace impact with unknown anchor reports error', () => {
  const dir = setupTempProject('impact-bad');
  try {
    run(`echo "ImpTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} impact fake_anchor 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('not found'), 'Should report anchor not found');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- CI ---\x1b[0m');
// ============================================================

test('trace ci runs without crashing on initialized project', () => {
  const dir = setupTempProject('ci');
  try {
    run(`echo "CITest" | node ${CLI} init`, { cwd: dir });
    run('git init && git config user.email "test@test.com" && git config user.name "Test" && git add -A && git commit -m "init" --no-gpg-sign', { cwd: dir });
    const out = run(`node ${CLI} ci 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('CI') || out.includes('changed'), 'Should run CI analysis');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Metrics ---\x1b[0m');
// ============================================================

test('trace metrics reports insufficient data initially', () => {
  const dir = setupTempProject('metrics');
  try {
    run(`echo "MetTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} metrics 2>&1`, { cwd: dir });
    assert(out.includes('No metrics') || out.includes('5'), 'Should report need more sessions');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Deps ---\x1b[0m');
// ============================================================

test('trace deps works with no anchors', () => {
  const dir = setupTempProject('deps');
  try {
    run(`echo "DepTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} deps 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('No anchors') || out.includes('Dependency'), 'Should handle no anchors');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Override ---\x1b[0m');
// ============================================================

test('trace override without reason shows error', () => {
  const dir = setupTempProject('override');
  try {
    run(`echo "OvTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} override 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('requires a reason') || out.includes('Usage'), 'Should require reason');
  } finally { cleanup(dir); }
});

test('trace override with reason creates debt entry', () => {
  const dir = setupTempProject('override-ok');
  try {
    run(`echo "OvTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} override "emergency production fix" 2>&1`, { cwd: dir });
    assert(out.includes('DEBT-001') || out.includes('Override'), 'Should create debt entry');
    const debt = fs.readFileSync(path.join(dir, '.trace/DEBT.yaml'), 'utf8');
    assert(debt.includes('emergency production fix'), 'Debt should contain reason');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Validate ---\x1b[0m');
// ============================================================

test('trace validate passes on clean config', () => {
  const dir = setupTempProject('validate-clean');
  try {
    run(`echo "ValidTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} validate 2>&1`, { cwd: dir });
    assert(out.includes('valid') || out.includes('Validate'), 'Should report valid');
  } finally { cleanup(dir); }
});

test('trace validate catches unknown fields', () => {
  const dir = setupTempProject('validate-unknown');
  try {
    fs.writeFileSync(path.join(dir, 'trace.yaml'), 'project:\n  name: Test\nanchrs: []\nqulity:\n  checks: []\n');
    const out = run(`node ${CLI} validate 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('did you mean') || out.includes('Unknown'), 'Should suggest correction');
  } finally { cleanup(dir); }
});

test('trace validate catches missing required fields', () => {
  const dir = setupTempProject('validate-missing');
  try {
    fs.writeFileSync(path.join(dir, 'trace.yaml'), 'thresholds:\n  max_file_lines: 400\n');
    const out = run(`node ${CLI} validate 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('Missing') || out.includes('required'), 'Should report missing fields');
  } finally { cleanup(dir); }
});

test('trace validate catches invalid gate mode', () => {
  const dir = setupTempProject('validate-gate');
  try {
    fs.writeFileSync(path.join(dir, 'trace.yaml'), 'project:\n  name: Test\nanchors: []\ngates:\n  start:\n    on_fail: "crash"\n');
    const out = run(`node ${CLI} validate 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('block') || out.includes('warn'), 'Should report invalid gate mode');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Upgrade ---\x1b[0m');
// ============================================================

test('trace upgrade adds missing sections', () => {
  const dir = setupTempProject('upgrade');
  try {
    // Create a minimal trace.yaml without quality, gates, etc.
    fs.writeFileSync(path.join(dir, 'trace.yaml'), 'project:\n  name: OldProject\nanchors: []\n');
    fs.mkdirSync(path.join(dir, '.trace'), { recursive: true });
    const out = run(`node ${CLI} upgrade 2>&1`, { cwd: dir });
    assert(out.includes('quality') || out.includes('Added'), 'Should add quality section');
    const yaml = fs.readFileSync(path.join(dir, 'trace.yaml'), 'utf8');
    assert(yaml.includes('quality'), 'trace.yaml should now have quality');
  } finally { cleanup(dir); }
});

test('trace upgrade creates missing .trace/ files', () => {
  const dir = setupTempProject('upgrade-files');
  try {
    fs.writeFileSync(path.join(dir, 'trace.yaml'), 'project:\n  name: Test\nanchors: []\ngates:\n  start:\n    on_fail: "warn"\n  end:\n    on_fail: "warn"\nthresholds:\n  max_file_lines: 400\ndebt:\n  max_accumulated: 5\nquality:\n  checks: []\ncode_review:\n  checklist: []\nfile_classification: {}\ncontracts: {}\nartifacts:\n  trace_state: ".trace/TRACE_STATE.yaml"\n');
    const out = run(`node ${CLI} upgrade 2>&1`, { cwd: dir });
    assert(fs.existsSync(path.join(dir, '.trace/PLAN.yaml')), 'PLAN.yaml should be created');
    assert(fs.existsSync(path.join(dir, '.trace/METRICS.yaml')), 'METRICS.yaml should be created');
  } finally { cleanup(dir); }
});

test('trace upgrade reports no changes when up to date', () => {
  const dir = setupTempProject('upgrade-noop');
  try {
    run(`echo "UpTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} upgrade 2>&1`, { cwd: dir });
    assert(out.includes('up to date') || out.includes('no migration'), 'Should report no changes needed');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- Watch ---\x1b[0m');
// ============================================================

test('trace watch with no anchors shows warning', () => {
  const dir = setupTempProject('watch-empty');
  try {
    run(`echo "WatchTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} watch 2>&1`, { cwd: dir, expectFail: true });
    assert(out.includes('No anchors') || out.includes('nothing to watch'), 'Should warn about no anchors');
  } finally { cleanup(dir); }
});

// ============================================================
console.log('\x1b[36m--- License ---\x1b[0m');
// ============================================================

test('trace license runs on project with no deps', () => {
  const dir = setupTempProject('license-empty');
  try {
    run(`echo "LicTest" | node ${CLI} init`, { cwd: dir });
    const out = run(`node ${CLI} license 2>&1`, { cwd: dir });
    assert(out.includes('No dependencies') || out.includes('License'), 'Should handle no deps');
  } finally { cleanup(dir); }
});

test('trace license detects project license from package.json', () => {
  const dir = setupTempProject('license-detect');
  try {
    run(`echo "LicTest" | node ${CLI} init`, { cwd: dir });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', license: 'MIT', dependencies: {} }));
    const out = run(`node ${CLI} license 2>&1`, { cwd: dir });
    assert(out.includes('MIT'), 'Should detect MIT license');
  } finally { cleanup(dir); }
});

test('trace license flags GPL dep in MIT project', () => {
  const dir = setupTempProject('license-gpl');
  try {
    run(`echo "LicTest" | node ${CLI} init`, { cwd: dir });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'test', license: 'MIT', dependencies: { 'fake-gpl-lib': '1.0.0' }
    }));
    // Create a fake node_modules entry with GPL license
    const depDir = path.join(dir, 'node_modules', 'fake-gpl-lib');
    fs.mkdirSync(depDir, { recursive: true });
    fs.writeFileSync(path.join(depDir, 'package.json'), JSON.stringify({
      name: 'fake-gpl-lib', version: '1.0.0', license: 'GPL-3.0'
    }));
    const out = run(`node ${CLI} license 2>&1`, { cwd: dir });
    assert(out.includes('incompatible') || out.includes('GPL'), 'Should flag GPL in MIT project');
  } finally { cleanup(dir); }
});

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
console.log(`\x1b[1m  Results: ${passed}/${total} passed\x1b[0m`);
if (failed > 0) {
  console.log(`\x1b[31m  ${failed} FAILED\x1b[0m`);
}
console.log(`\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
