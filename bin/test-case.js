#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  test-case CLI — natural language entry point
//
//  Accepts any of these forms:
//    test-case SCI-17066
//    test-case test case SCI-17066
//    test-case generate test cases for SCI-17066
//    test-case SCI-17066 SCI-17067
//    test-case SCI-17066 --dry-run
//    test-case SCI-17066 --config ./my-config.json
// ─────────────────────────────────────────────────────────────────────────────

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);

// Extract JIRA issue keys (pattern: PROJ-1234) from anywhere in the args
const issueKeys = args
  .filter(a => /^[A-Za-z][A-Za-z0-9_]+-\d+$/i.test(a))
  .map(a => a.toUpperCase());

// Pass through flags like --dry-run, --config
const flags = args.filter(a => a.startsWith('--'));

if (issueKeys.length === 0) {
  console.log(`
  JIRA Test Case AI Agent

  USAGE:
    test-case <ISSUE_KEY> [options]
    test-case test case <ISSUE_KEY>
    test-case generate test cases for <ISSUE_KEY>

  EXAMPLES:
    test-case SCI-17066
    test-case SCI-17066 SCI-17067
    test-case SCI-17066 --dry-run
    test-case test case SCI-17066
    test-case generate test cases for SCI-17066

  OPTIONS:
    --dry-run           Generate CSV but do NOT write to JIRA
    --config <file>     Path to workflow-config.json
  `);
  process.exit(0);
}

// Resolve path to workflow.ts relative to this file
const workflowScript = path.resolve(__dirname, '..', 'scripts', 'workflow.ts');
const cwd = path.resolve(__dirname, '..');

console.log(`\n🤖  Test Case Agent — ${issueKeys.join(', ')}\n`);

const result = spawnSync(
  'npx',
  ['tsx', workflowScript, ...issueKeys, ...flags],
  {
    stdio: 'inherit',
    cwd,
    env: process.env,
    shell: true,   // needed on Windows so npx is resolved via PATH
  }
);

process.exit(result.status ?? 1);
