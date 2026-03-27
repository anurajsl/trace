import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import YAML from 'yaml';
import { c, printHeader, printPass, printFail, printWarn, printInfo } from './utils.js';

const INTEGRITY_FILE = '.trace/INTEGRITY.sha256';

/**
 * Generate SHA-256 hash of a file's contents
 */
function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get list of TRACE files that should be integrity-protected
 */
function getProtectedFiles() {
  return [
    'trace.yaml',
    '.trace/TRACE_STATE.yaml',
    '.trace/DEBT.yaml',
    '.trace/BASELINE.yaml',
  ].filter(f => fs.existsSync(f));
}

/**
 * Generate integrity manifest with checksums of all protected files
 */
export function generateIntegrity() {
  const files = getProtectedFiles();
  const checksums = {};
  
  for (const file of files) {
    checksums[file] = hashFile(file);
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    generated_by: 'trace-coherence',
    version: '1.0',
    checksums,
  };

  const dir = path.dirname(INTEGRITY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INTEGRITY_FILE, YAML.stringify(manifest));
  
  return { files: files.length, manifest };
}

/**
 * Verify integrity of all protected TRACE files
 * Returns { passed: boolean, results: [{file, status, detail}] }
 */
export function verifyIntegrity() {
  const results = [];
  
  // Check if integrity file exists
  if (!fs.existsSync(INTEGRITY_FILE)) {
    return {
      passed: false,
      missing: true,
      results: [{ file: INTEGRITY_FILE, status: 'missing', detail: 'No integrity manifest found. Run trace gate end to generate.' }]
    };
  }

  const manifest = YAML.parse(fs.readFileSync(INTEGRITY_FILE, 'utf8'));
  
  if (!manifest || !manifest.checksums) {
    return {
      passed: false,
      results: [{ file: INTEGRITY_FILE, status: 'corrupt', detail: 'Integrity manifest is malformed.' }]
    };
  }

  let allPassed = true;

  for (const [file, expectedHash] of Object.entries(manifest.checksums)) {
    if (!fs.existsSync(file)) {
      results.push({ file, status: 'missing', detail: 'File no longer exists but was in manifest.' });
      allPassed = false;
      continue;
    }

    const currentHash = hashFile(file);
    
    if (currentHash === expectedHash) {
      results.push({ file, status: 'ok', detail: 'Checksum matches.' });
    } else {
      results.push({ file, status: 'tampered', detail: `Checksum mismatch. File was modified outside of TRACE workflow.` });
      allPassed = false;
    }
  }

  // Check for new protected files not in manifest
  const protectedFiles = getProtectedFiles();
  for (const file of protectedFiles) {
    if (!manifest.checksums[file]) {
      results.push({ file, status: 'untracked', detail: 'New TRACE file not in integrity manifest.' });
      // Don't fail for untracked — could be a new file added legitimately
    }
  }

  return { passed: allPassed, generated_at: manifest.generated_at, results };
}

/**
 * CLI command: trace integrity
 */
export function runIntegrity(args) {
  const mode = args[0]; // --verify, --generate, or empty (default: verify)

  if (mode === '--generate' || mode === 'generate') {
    printHeader('TRACE Integrity — Generate Checksums');
    const { files } = generateIntegrity();
    printPass(`Generated integrity manifest for ${files} file(s)`);
    printInfo(`Manifest: ${INTEGRITY_FILE}`);
    return;
  }

  // Default: verify
  printHeader('TRACE Integrity — Verification');

  const { passed, missing, results, generated_at } = verifyIntegrity();

  if (missing) {
    printWarn('No integrity manifest found.');
    printInfo('Run trace gate end or trace integrity --generate to create one.');
    console.log();
    return;
  }

  if (generated_at) {
    printInfo(`Last generated: ${generated_at}`);
  }
  console.log();

  for (const r of results) {
    if (r.status === 'ok') {
      printPass(`${r.file}`);
    } else if (r.status === 'tampered') {
      printFail(`${r.file} — TAMPERED`);
      printFail(`  ${r.detail}`);
    } else if (r.status === 'missing') {
      printFail(`${r.file} — MISSING`);
      printFail(`  ${r.detail}`);
    } else if (r.status === 'untracked') {
      printWarn(`${r.file} — Not in manifest (new file)`);
    }
  }

  console.log();
  if (passed) {
    printPass('INTEGRITY CHECK PASSED — No tampering detected.\n');
  } else {
    printFail('INTEGRITY VIOLATION DETECTED');
    printFail('One or more TRACE files were modified outside the TRACE workflow.');
    printFail('This could indicate unauthorized tampering.');
    console.log();
    printInfo('If these changes are legitimate, run: trace integrity --generate');
    printInfo('If unexpected, investigate immediately.\n');
  }
}
