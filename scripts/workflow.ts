// ─────────────────────────────────────────────────────────────────────────────
//  JIRA Test Case Workflow — End-to-End Orchestrator
// Load .env before anything else
import 'dotenv/config';
//
//  Automates the full 8-step test preparation process:
//
//  1. Fetch the JIRA issue (description, subtasks, comments, acceptance criteria)
//  2. Show issue summary + linked repos for review
//  3. Analyse requirements, changes, expected behaviour, and AC
//  4. List configurable repos for code review reference
//  5. Generate test cases in CSV format
//  6. Create a sub-task "Test Case Generation/Preparation" under the issue
//  7. Attach the CSV to the new sub-task and mark it Done
//  8. Add a comment on the parent issue linking to the CSV attachment
//
//  Usage:
//    npx tsx scripts/workflow.ts <ISSUE_KEY> [--config ./workflow-config.json] [--dry-run]
//    npx tsx scripts/workflow.ts SCI-17066
//    npx tsx scripts/workflow.ts SCI-17066 SCI-17067 --dry-run
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { analyseIssue } from './test-case-agent/ai-analyzer';
import { formatAsCSV } from './test-case-agent/exporters';
import { fetchFromRestApi } from './test-case-agent/jira-fetcher';
import { generateTestCases } from './test-case-agent/generator';
import {
  addComment,
  attachFile,
  browseUrl,
  createChildIssue,
  createSubtask,
  findChildIssue,
  JiraCredentials,
  transitionIssue,
} from './test-case-agent/jira-actions';
import { readRepoContext } from './test-case-agent/repo-reader';
import { IssueAnalysis, JiraIssue, RepoContext, WorkflowConfig, WorkflowResult } from './test-case-agent/types';

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface CliArgs {
  issueKeys: string[];
  configFile: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const issueKeys: string[] = [];
  let configFile = path.join(process.cwd(), 'workflow-config.json');
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--config' || a === '-c') && args[i + 1]) {
      configFile = args[++i];
    } else if (a === '--dry-run' || a === '--dryRun') {
      dryRun = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith('--') && /^[A-Z][A-Z0-9_]+-\d+$/i.test(a)) {
      issueKeys.push(a.toUpperCase());
    }
  }
  return { issueKeys, configFile, dryRun };
}

function printHelp(): void {
  console.log(`
JIRA Test Case Workflow — End-to-End Orchestrator

USAGE: npx tsx scripts/workflow.ts <ISSUE_KEY...> [options]

OPTIONS:
  --config <file>   Path to workflow-config.json  (default: ./workflow-config.json)
  --dry-run         Generate CSV and print steps but do NOT write to JIRA
  --help            Show this message

ENV VARS (override config file):
  JIRA_BASE_URL   JIRA_USERNAME   JIRA_API_TOKEN

EXAMPLES:
  npx tsx scripts/workflow.ts SCI-17066
  npx tsx scripts/workflow.ts SCI-17066 SCI-17067
  npx tsx scripts/workflow.ts SCI-17066 --dry-run
  npx tsx scripts/workflow.ts SCI-17066 --config ./my-config.json
`);
}

// ─── Config loading ───────────────────────────────────────────────────────────

function loadConfig(configFile: string): WorkflowConfig {
  if (!fs.existsSync(configFile)) {
    throw new Error(`Config file not found: ${configFile}\nRun from project root or pass --config <path>`);
  }
  const config = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as WorkflowConfig;

  // Merge REPO_URL_1..N from .env into config.repos (env takes precedence for new entries)
  const envRepos: WorkflowConfig['repos'] = [];
  for (let i = 1; ; i++) {
    const url = process.env[`REPO_URL_${i}`];
    if (!url) break;
    const name = process.env[`REPO_NAME_${i}`] ?? `Repo ${i}`;
    const desc = process.env[`REPO_DESC_${i}`];
    const id   = `env-repo-${i}`;
    // Only add if not already present by URL in the config file
    if (!config.repos.some((r) => r.url === url)) {
      envRepos.push({ id, name, url, ...(desc ? { description: desc } : {}) });
    }
  }
  config.repos = [...config.repos, ...envRepos];
  return config;
}

function buildCredentials(config: WorkflowConfig): JiraCredentials {
  return {
    baseUrl: config.jira.baseUrl || process.env.JIRA_BASE_URL || 'https://ibm-middleware.atlassian.net',
    username: config.jira.username || process.env.JIRA_USERNAME || process.env.JIRA_EMAIL || '',
    apiToken: config.jira.apiToken || process.env.JIRA_API_TOKEN || '',
  };
}

// ─── Step helpers ──────────────────────────────────────────────────────────────

function step(n: number, label: string): void {
  console.log(`\n${'─'.repeat(60)}\n  Step ${n}: ${label}\n${'─'.repeat(60)}`);
}

function writeCsv(content: string, dir: string, issueKey: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${issueKey}-test-cases.csv`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

// ─── Main workflow for a single issue ─────────────────────────────────────────

async function runWorkflow(
  issueKey: string,
  creds: JiraCredentials,
  config: WorkflowConfig,
  dryRun: boolean,
): Promise<WorkflowResult> {
  const wf = config.workflow;

  // Inject credentials into env so fetchFromRestApi picks them up
  process.env.JIRA_BASE_URL = creds.baseUrl;
  process.env.JIRA_USERNAME = creds.username;
  process.env.JIRA_API_TOKEN = creds.apiToken;

  // ── Step 1: Fetch JIRA issue ───────────────────────────────────────────────
  step(1, `Fetch JIRA issue ${issueKey}`);
  const issue: JiraIssue = await fetchFromRestApi(issueKey);
  console.log(`  📋  ${issue.key}: ${issue.summary}`);
  console.log(`  Type     : ${issue.issueType}`);
  console.log(`  Priority : ${issue.priority}`);
  console.log(`  Status   : ${issue.status}`);
  if (issue.assignee) console.log(`  Assignee : ${issue.assignee}`);
  if (issue.sprint)   console.log(`  Sprint   : ${issue.sprint}`);
  if (issue.epicKey)  console.log(`  Epic     : ${issue.epicKey}`);
  if (issue.subtasks.length) {
    console.log(`  Subtasks (${issue.subtasks.length}):`);
    for (const s of issue.subtasks) console.log(`    ↳ ${s.key}: ${s.summary}`);
  }
  if (issue.linkedIssues.length) {
    console.log(`  Linked issues (${issue.linkedIssues.length}):`);
    for (const l of issue.linkedIssues) console.log(`    ↳ [${l.linkType}] ${l.key}: ${l.summary}`);
  }

  // ── Step 2: Show repo references ──────────────────────────────────────────
  step(2, 'Code repository references');
  if (config.repos.length === 0) {
    console.log('  ℹ️  No repos configured. Add them in workflow-config.json → "repos" or set REPO_URL_1, REPO_URL_2 … in .env.');
  } else {
    for (const repo of config.repos) {
      const src = repo.id.startsWith('env-repo-') ? '(.env)' : '(config)';
      console.log(`  📁  [${repo.id}] ${repo.name} ${src}`);
      console.log(`        ${repo.url}`);
      if (repo.description) console.log(`        ${repo.description}`);
    }
  }

  // ── Step 2b: Read relevant files from repos ───────────────────────────────
  step(3, 'Read relevant files from code repositories');
  const repoUrls = config.repos.map((r) => r.url);
  const repoContext: RepoContext = await readRepoContext(
    repoUrls,
    issueKey,
    [...issue.components, ...issue.labels],
  );
  console.log(`  🔍  ${repoContext.summary}`);
  if (repoContext.files.length > 0) {
    for (const f of repoContext.files) {
      console.log(`    📄  [${f.repo}] ${f.path}`);
      console.log(`          ${f.url}`);
    }
  }

  // ── Step 3: Analyse issue ─────────────────────────────────────────────────
  step(4, 'Analyse requirements, AC, and expected behaviour');
  const analysis: IssueAnalysis = analyseIssue(issue, repoContext);
  console.log(`  Complexity  : ${analysis.complexity}`);
  console.log(`  Test types  : ${analysis.suggestedTypes.join(', ')}`);
  console.log(`  Keywords    : ${analysis.keywords.slice(0, 10).join(', ') || '(none)'}`);
  console.log(`  Roles       : ${analysis.roles.join(', ') || '(none detected)'}`);
  if (issue.acceptanceCriteria) {
    console.log(`  AC preview  : ${issue.acceptanceCriteria.slice(0, 200).replace(/\n/g, ' ')}…`);
  }

  // ── Step 4: Scenario groups ────────────────────────────────────────────────
  step(4, 'Scenario groups extracted');
  for (const g of analysis.scenarioGroups) {
    console.log(`  [${g.category}] ${g.scenarios.length} scenario(s)`);
    for (const s of g.scenarios.slice(0, 3)) console.log(`    • ${s}`);
    if (g.scenarios.length > 3) console.log(`    … and ${g.scenarios.length - 3} more`);
  }

  // ── Step 5: Generate CSV ───────────────────────────────────────────────────
  step(5, 'Generate test cases → CSV');
  const testCases = generateTestCases(issue, analysis, wf.detailed ?? true);
  const csv = formatAsCSV(testCases);
  const csvPath = writeCsv(csv, wf.outputDir, issueKey);
  console.log(`  ✅  ${testCases.length} test cases generated`);
  console.log(`  💾  Saved → ${csvPath}`);

  if (dryRun) {
    console.log('\n  ⚠️  --dry-run: skipping JIRA writes (steps 6–8)');
    return { issueKey, csvPath, testCaseCount: testCases.length, subtaskKey: '(dry-run)', complexity: analysis.complexity, types: analysis.suggestedTypes };
  }

  // ── Step 6: Resolve (or create) the Testing task ──────────────────────────
  step(6, `Resolve Testing task under ${issueKey}`);
  let testingTaskKey: string;
  const existingTesting = await findChildIssue(creds, issueKey, 'testing');
  if (existingTesting) {
    testingTaskKey = existingTesting.key;
    console.log(`  🔍  Found existing Testing task: ${testingTaskKey} — "${existingTesting.summary}" [${existingTesting.status}]`);
    console.log(`  🔗  ${browseUrl(creds.baseUrl, testingTaskKey)}`);
  } else {
    console.log(`  ℹ️  No Testing task found under ${issueKey}. Creating one…`);
    testingTaskKey = await createChildIssue(
      creds,
      issueKey,
      `Testing — ${issue.summary}`,
      'Testing task for this feature. Test cases are attached as a sub-task.',
      'Story',
    );
    console.log(`  ✅  Testing task created: ${testingTaskKey}`);
    console.log(`  🔗  ${browseUrl(creds.baseUrl, testingTaskKey)}`);
  }

  // ── Step 6b: Find or skip "Test Case Generation/Preparation" sub-task ─────
  step(6, `Check for existing "Test Case Generation/Preparation" sub-task under ${testingTaskKey}`);
  const existingSubtask = await findChildIssue(creds, testingTaskKey, 'test case generation');
  if (existingSubtask) {
    console.log(`\n  ✅  Test cases already added.`);
    console.log(`  🔍  Existing sub-task: ${existingSubtask.key} — "${existingSubtask.summary}" [${existingSubtask.status}]`);
    console.log(`  🔗  ${browseUrl(creds.baseUrl, existingSubtask.key)}`);
    console.log('\n  ⏭️  Skipping steps 7–8. No changes made to Jira.');
    return {
      issueKey,
      csvPath,
      testCaseCount: testCases.length,
      subtaskKey: existingSubtask.key,
      complexity: analysis.complexity,
      types: analysis.suggestedTypes,
    };
  }

  const subtaskSummary = interpolate(wf.subtaskSummaryTemplate, { issueKey });
  const subtaskKey = await createSubtask(creds, testingTaskKey, subtaskSummary, wf.subtaskDescription);
  console.log(`  ✅  Sub-task created: ${subtaskKey}`);
  console.log(`  🔗  ${browseUrl(creds.baseUrl, subtaskKey)}`);

  // ── Step 7: Attach CSV to sub-task, then complete it ──────────────────────
  step(7, `Attach CSV to ${subtaskKey} and mark Done`);
  const attachment = await attachFile(creds, subtaskKey, csvPath);
  console.log(`  📎  Attached: ${attachment.filename} (${attachment.size} bytes, id=${attachment.id})`);

  try {
    const transitionName = wf.doneTransitionName ?? 'Done';
    await transitionIssue(creds, subtaskKey, transitionName);
    console.log(`  ✅  ${subtaskKey} transitioned to ${transitionName}`);
  } catch (err) {
    // Non-fatal — transition names vary by project. Print warning and continue.
    console.warn(`  ⚠️  Could not auto-transition ${subtaskKey}: ${(err as Error).message}`);
    console.warn('     Please close the sub-task manually.');
  }

  // ── Step 8: Comment on the Testing task (not the Epic) ────────────────────
  step(8, `Add comment on Testing task ${testingTaskKey}`);
  const commentText = interpolate(wf.commentTemplate, {
    filename: attachment.filename,
    count: String(testCases.length),
    complexity: analysis.complexity,
    types: analysis.suggestedTypes.join(', '),
    subtaskKey,
    subtaskUrl: browseUrl(creds.baseUrl, subtaskKey),
  });
  await addComment(creds, testingTaskKey, commentText);
  console.log(`  ✅  Comment added to ${testingTaskKey}`);

  return {
    issueKey,
    csvPath,
    testCaseCount: testCases.length,
    subtaskKey,
    complexity: analysis.complexity,
    types: analysis.suggestedTypes,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.issueKeys.length === 0) {
    printHelp();
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('    JIRA Test Case Workflow — End-to-End Orchestrator');
  console.log(`${'═'.repeat(60)}`);
  if (opts.dryRun) console.log('\n  ⚠️  DRY RUN — JIRA will not be modified\n');

  const config = loadConfig(opts.configFile);
  const creds = buildCredentials(config);

  if (!creds.username || !creds.apiToken) {
    console.error('\n❌  Missing credentials. Set JIRA_USERNAME and JIRA_API_TOKEN env vars,');
    console.error('    or fill in jira.username / jira.apiToken in workflow-config.json.\n');
    process.exit(1);
  }

  const results: WorkflowResult[] = [];
  let failed = 0;

  for (const key of opts.issueKeys) {
    try {
      const result = await runWorkflow(key, creds, config, opts.dryRun);
      results.push(result);
    } catch (err) {
      console.error(`\n❌  ${key}: ${(err as Error).message}`);
      failed++;
    }
  }

  // ─── Final summary ─────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  for (const r of results) {
    console.log(`\n  ${r.issueKey}`);
    console.log(`    Test cases : ${r.testCaseCount}`);
    console.log(`    Complexity : ${r.complexity}`);
    console.log(`    Types      : ${r.types.join(', ')}`);
    console.log(`    CSV        : ${r.csvPath}`);
    if (r.subtaskKey !== '(dry-run)') console.log(`    Sub-task   : ${r.subtaskKey}`);
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${results.length}/${opts.issueKeys.length} processed${opts.dryRun ? ' (dry-run)' : ''}.`);
  if (failed > 0) {
    console.log(`  ${failed} failed.`);
    process.exit(1);
  }
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });

// Made with Bob
