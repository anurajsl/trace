import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { c, getDateStamp, printHeader, printPass, printInfo } from './utils.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

export async function runInit() {
  printHeader('TRACE Init');
  console.log(`  Initializing TRACE in ${c.bold}${process.cwd()}${c.reset}\n`);

  const projectName = await ask(`  Project name: `);
  const templateDir = path.join(import.meta.dirname, '..', 'templates');

  // 1. Create trace.yaml from template
  let config = fs.readFileSync(path.join(templateDir, 'trace.yaml'), 'utf8');
  config = config.replace(/{PROJECT_NAME}/g, projectName);
  config = config.replace(/{DATE}/g, getDateStamp());
  fs.writeFileSync('trace.yaml', config);
  printPass('Created trace.yaml (project config)');

  // 2. Create .trace/ directory with artifacts
  fs.mkdirSync('.trace', { recursive: true });

  const artifacts = [
    ['TRACE_STATE.yaml', 'TRACE_STATE.yaml'],
    ['PROJECT_LOG.md', 'PROJECT_LOG.md'],
    ['HANDOFF.md', 'HANDOFF.md'],
    ['DEBT.yaml', 'DEBT.yaml'],
    ['LIVE_CHECKPOINT.yaml', 'LIVE_CHECKPOINT.yaml'],
    ['AI_INSTRUCTIONS.md', 'AI_INSTRUCTIONS.md'],
    ['PLAN.yaml', 'PLAN.yaml'],
    ['METRICS.yaml', 'METRICS.yaml'],
  ];

  for (const [template, output] of artifacts) {
    let content = fs.readFileSync(path.join(templateDir, template), 'utf8');
    content = content.replace(/{PROJECT_NAME}/g, projectName);
    content = content.replace(/{DATE}/g, getDateStamp());
    fs.writeFileSync(path.join('.trace', output), content);
    printPass(`Created .trace/${output}`);
  }

  // 3. Create releases directory
  fs.mkdirSync('.trace/releases', { recursive: true });
  printPass('Created .trace/releases/ (release notes)');

  // 4. Add .trace to .gitignore (only the checkpoint — others should be tracked)
  const gitignoreLine = '\n# TRACE volatile checkpoint (auto-deleted after session)\n.trace/LIVE_CHECKPOINT.yaml\n';
  const gitignorePath = '.gitignore';
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    if (!existing.includes('LIVE_CHECKPOINT')) {
      fs.appendFileSync(gitignorePath, gitignoreLine);
      printPass('Updated .gitignore (checkpoint excluded)');
    }
  } else {
    fs.writeFileSync(gitignorePath, gitignoreLine);
    printPass('Created .gitignore');
  }

  console.log(`
${c.green}${c.bold}TRACE initialized.${c.reset}

${c.bold}What to do next:${c.reset}
  1. Edit ${c.cyan}trace.yaml${c.reset} — define your anchors, test commands, and thresholds
  2. Commit ${c.cyan}trace.yaml${c.reset} and ${c.cyan}.trace/${c.reset} to version control
  3. Run ${c.cyan}trace check${c.reset} to validate coherence
  4. Run ${c.cyan}trace gate start${c.reset} at the beginning of each session

${c.dim}Tip: Start with just 3-5 anchors. Add more as you discover hidden dependencies.${c.reset}
`);

  rl.close();
}
