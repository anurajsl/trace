import path from 'path';
import {
  c, findProjectRoot, loadConfig, loadYaml, saveYaml,
  printHeader, printPass, printInfo, getTimestamp
} from './utils.js';

export async function runCheckpoint(lastFile, nextStep, verificationResult) {
  const root = findProjectRoot();
  if (!root) {
    console.log(`${c.red}No trace.yaml found.${c.reset}`);
    process.exit(1);
  }

  const config = loadConfig(root);
  const cpPath = path.join(root, config.artifacts?.live_checkpoint || '.trace/LIVE_CHECKPOINT.yaml');
  const cp = loadYaml(cpPath) || { session_started: getTimestamp(), checkpoints: [] };

  if (!lastFile || !nextStep) {
    console.log(`Usage: ${c.cyan}trace checkpoint <last_file_modified> <next_step>${c.reset} [verification_result]`);
    console.log(`Example: ${c.dim}trace checkpoint "src/auth.ts" "Update auth docs" "tier1_pass"${c.reset}`);
    process.exit(1);
  }

  const entry = {
    timestamp: getTimestamp(),
    last_file_modified: lastFile,
    last_verification_result: verificationResult || 'none',
    next_step: nextStep,
  };

  cp.checkpoints.push(entry);
  saveYaml(cpPath, cp);

  // Auto-capture file changes as observation
  try {
    const { captureObservation, generateSessionContext } = await import('./observe.js');
    captureObservation(root, config, nextStep);
    generateSessionContext(root, config);
  } catch (e) {
    // Observation and context refresh are non-critical
  }

  printPass(`Checkpoint saved (${cp.checkpoints.length} total this session)`);
  printInfo(`Next step: ${nextStep}`);
  printInfo('Session context refreshed (.trace/AI_CONTEXT.md)');
}
