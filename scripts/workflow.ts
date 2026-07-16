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
import { buildContext, renderContextSummary } from './test-case-agent/context-builder';
import { formatAsXLSX } from './test-case-agent/exporters';
import { fetchFromRestApi } from './test-case-agent/jira-fetcher';
import { parseCsvToTestCases } from './test-case-agent/generator';
import {
  addComment,
  attachFile,
  browseUrl,
  createSubtask,
  findChildIssue,
  findTestingStory,
  JiraCredentials,
  resolveAccountId,
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
                    Issues with no Testing task child are always skipped.
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

function writeXlsx(buffer: Buffer, dir: string, issueKey: string): string {
  fs.mkdirSync(dir, { recursive: true });
  let filePath = path.join(dir, `${issueKey}-test-cases.xlsx`);
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (err: unknown) {
    // File is locked (e.g. open in Excel) — write to a timestamped copy
    if ((err as NodeJS.ErrnoException).code === 'EBUSY' || (err as NodeJS.ErrnoException).code === 'EPERM') {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      filePath = path.join(dir, `${issueKey}-test-cases-${ts}.xlsx`);
      console.warn(`  ⚠️  Original XLSX locked — writing to ${path.basename(filePath)} instead`);
      fs.writeFileSync(filePath, buffer);
    } else {
      throw err;
    }
  }
  return filePath;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

// ─── CSV quality validator ────────────────────────────────────────────────────
//
// Scans a generated CSV for banned boilerplate patterns documented in
// prompts/test-case-generation.md. Prints a warning for every hit and returns
// the total number of violations found.
//
// This does NOT block the workflow — it surfaces quality issues so the
// operator knows the CSV needs improvement before it is attached to Jira.

// Patterns that are ALWAYS banned — even one occurrence is a violation
const BANNED_PRECONDITIONS_ABSOLUTE: RegExp[] = [
  /User has the required role\/permission assigned/i,
  /All dependent APIs and services are available and healthy/i,
  /SCI-IWHI component\(s\) are deployed/i,
  /Related dependent issues are resolved/i,
  /Test environment is configured and accessible/i,
];

// Patterns that are banned when they appear on more than 30 % of rows
// (i.e. used as boilerplate on every row, not as a scenario-specific precondition)
const BANNED_PRECONDITIONS_THRESHOLD: RegExp[] = [
  /B2B Integration capability is enabled/i,
];

const BANNED_STEPS: RegExp[] = [
  /Navigate to the SCI-IWHI section \/ feature entry point/i,
  /Verify: .+ — Happy Path/i,
  /Verify the outcome matches the acceptance criteria/i,
  /The feature behaves as expected without errors/i,
  /Refresh the page and verify state is persisted/i,
  /Perform the action described as:/i,   // fallback-generator artefact
];

function validateCsvQuality(csvPath: string): number {
  if (!fs.existsSync(csvPath)) return 0;
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rowCount = Math.max(1, (raw.match(/\bTC-\d{3}\b/g) ?? []).length);
  let violations = 0;

  // Absolute bans — one occurrence = violation
  for (const pattern of BANNED_PRECONDITIONS_ABSOLUTE) {
    const matches = (raw.match(new RegExp(pattern.source, 'gi')) ?? []).length;
    if (matches > 0) {
      console.warn(`  ⚠️  [QUALITY] Banned precondition found ${matches}x: "${pattern.source}"`);
      violations += matches;
    }
  }

  // Threshold bans — violation only if the pattern covers > 30% of test cases
  for (const pattern of BANNED_PRECONDITIONS_THRESHOLD) {
    const matches = (raw.match(new RegExp(pattern.source, 'gi')) ?? []).length;
    const pct = matches / rowCount;
    if (pct > 0.3) {
      console.warn(`  ⚠️  [QUALITY] Over-used precondition (${matches}/${rowCount} rows = ${Math.round(pct * 100)}%): "${pattern.source}"`);
      console.warn(`       This precondition should only appear on rows that SPECIFICALLY test this state.`);
      violations += matches;
    }
  }

  // Step bans — any occurrence
  for (const pattern of BANNED_STEPS) {
    const matches = (raw.match(new RegExp(pattern.source, 'gi')) ?? []).length;
    if (matches > 0) {
      console.warn(`  ⚠️  [QUALITY] Banned step pattern found ${matches}x: "${pattern.source}"`);
      violations += matches;
    }
  }

  return violations;
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
  if (issue.comments.length) {
    console.log(`  Comments : ${issue.comments.length} (read for scenario extraction)`);
    for (const c of issue.comments.slice(0, 3)) {
      console.log(`    💬  [${c.author}] ${c.body.slice(0, 120).replace(/\n/g, ' ')}…`);
    }
    if (issue.comments.length > 3) console.log(`    … and ${issue.comments.length - 3} more comment(s)`);
  }
  if (issue.subtasks.length) {
    console.log(`  Subtasks (${issue.subtasks.length}):`);
    for (const s of issue.subtasks) console.log(`    ↳ ${s.key}: ${s.summary}`);
  }
  if (issue.childIssues.length) {
    console.log(`  Child issues fetched (${issue.childIssues.length} with descriptions):`);
    for (const c of issue.childIssues) console.log(`    📄  ${c.key} [${c.status}]: ${c.summary}`);
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

  // ── Step 3: Read relevant files from repos ────────────────────────────────
  step(3, 'Collect context — repos, PRs, commits, changed files');
  const repoUrls = config.repos.map((r) => r.url);
  const repoContext: RepoContext = await readRepoContext(
    repoUrls,
    issueKey,
    [...issue.components, ...issue.labels],
  );
  console.log(`  🔍  ${repoContext.summary}`);
  // Build and log FullContext summary (the input to the test generator)
  const fullCtx = buildContext(issue, repoContext);
  console.log('\n  📦  FullContext assembled:');
  for (const line of renderContextSummary(fullCtx).split('\n')) {
    if (line.trim()) console.log(`       ${line}`);
  }
  if (repoContext.prs.length > 0) {
    const open   = repoContext.prs.filter(p => p.state === 'open');
    const closed = repoContext.prs.filter(p => p.state !== 'open');
    if (closed.length) console.log(`  ✅  ${closed.length} closed/merged PR(s)`);
    if (open.length)   console.log(`  🔓  ${open.length} open PR(s) (in-progress work):`);
    for (const pr of open) console.log(`      PR #${pr.number}: ${pr.title}`);
  }
  if (repoContext.commits.length > 0) {
    console.log(`  📝  ${repoContext.commits.length} commit(s) found:`);
    for (const c of repoContext.commits.slice(0, 5)) console.log(`      ${c}`);
  }
  if (repoContext.files.length > 0) {
    console.log(`  📁  ${repoContext.files.length} changed file(s):`);
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

  // ── Step 5: Find Testing story first — skip everything if none exists ─────
  step(5, `Find Testing story under Epic ${issueKey}`);
  console.log(`  🔍  Searching for Testing/Validation story under ${issueKey}…`);

  if (dryRun) {
    console.log('\n  ⚠️  --dry-run mode: skipping Testing story check and JIRA writes');
  }

  const testingStory = dryRun ? null : await findTestingStory(creds, issueKey);
  if (!dryRun && !testingStory) {
    console.log(`  ⏭️  No Testing/Validation story found under ${issueKey} — skipping this issue entirely.`);
    console.log(`       Create a "Testing for <feature>" User Story as a child of ${issueKey} first, then re-run.`);
    return {
      issueKey,
      csvPath: '(skipped)',
      testCaseCount: 0,
      subtaskKey: '(skipped — no testing story)',
      complexity: analysis.complexity,
      types: analysis.suggestedTypes,
    };
  }

  const testingStoryKey = testingStory?.key ?? '';
  if (testingStory) {
    console.log(`  ✅  Found Testing story: ${testingStoryKey} — "${testingStory.summary}" [${testingStory.status}]`);
    console.log(`  🔗  ${browseUrl(creds.baseUrl, testingStoryKey)}`);
  }

  // ── Step 5b: Generate CSV + XLSX ─────────────────────────────────────────
  step(5, 'Generate test cases → CSV + XLSX');
  const outDir = wf.outputDir;
  const csvPath = path.join(outDir, `${issueKey}-test-cases.csv`);

  // Bob reasons over fullCtx (already assembled above) and writes the CSV directly.
  // After Bob writes the CSV, parse it and produce the XLSX.
  const testCases = parseCsvToTestCases(csvPath, issueKey);
  const xlsxBuffer = formatAsXLSX(testCases, issue, analysis);
  const xlsxPath = writeXlsx(xlsxBuffer, outDir, issueKey);
  console.log(`  ✅  ${testCases.length} test cases loaded from CSV`);
  console.log(`  💾  CSV  → ${csvPath}`);
  console.log(`  💾  XLSX → ${xlsxPath}`);

  // ── Quality gate: scan for banned boilerplate patterns ───────────────────
  const qualityViolations = validateCsvQuality(csvPath);
  if (qualityViolations > 0) {
    console.warn(`\n  ⛔  [QUALITY GATE] ${qualityViolations} banned boilerplate pattern(s) detected in ${path.basename(csvPath)}.`);
    console.warn(`       These patterns are BANNED per prompts/test-case-generation.md.`);
    console.warn(`       Please re-generate the CSV with scenario-specific content before attaching to Jira.`);
    console.warn(`       See the ⚠️  [QUALITY] lines above for exact matches.\n`);
  } else {
    console.log(`  ✅  Quality check: no banned boilerplate patterns detected`);
  }

  if (dryRun) {
    console.log('\n  ⚠️  --dry-run: skipping JIRA writes (steps 6–8)');
    return { issueKey, csvPath, testCaseCount: testCases.length, subtaskKey: '(dry-run)', complexity: analysis.complexity, types: analysis.suggestedTypes };
  }

  // ── Step 6: Check for existing "Test Case Generation/Preparation" sub-task ─
  step(6, `Check for existing "Test Case Generation/Preparation" sub-task under ${testingStoryKey}`);
  console.log(`  🔍  Checking if a Test Case Generation sub-task already exists under ${testingStoryKey}…`);
  const existingSubtask = await findChildIssue(creds, testingStoryKey, 'test case generation');
  if (existingSubtask) {
    console.log(`  ✅  Test cases already added — skipping creation.`);
    console.log(`  📋  Existing sub-task: ${existingSubtask.key} — "${existingSubtask.summary}" [${existingSubtask.status}]`);
    console.log(`  🔗  ${browseUrl(creds.baseUrl, existingSubtask.key)}`);
    console.log('\n  ⏭️  Steps 7–8 skipped. No changes made to Jira.');
    return {
      issueKey,
      csvPath,
      testCaseCount: testCases.length,
      subtaskKey: existingSubtask.key,
      complexity: analysis.complexity,
      types: analysis.suggestedTypes,
    };
  }
  console.log(`  ℹ️  No existing sub-task found — will create one.`);

  // Resolve assignee email → accountId
  const assigneeEmail = (wf as Record<string, unknown>).assigneeEmail as string | undefined ?? creds.username;
  console.log(`  👤  Resolving assignee: ${assigneeEmail}…`);
  const assigneeAccountId = await resolveAccountId(creds, assigneeEmail);
  console.log(`  ✅  Assignee resolved → accountId: ${assigneeAccountId}`);

  // Create the sub-task
  const subtaskSummary = interpolate(wf.subtaskSummaryTemplate, { issueKey });
  console.log(`  ➕  Creating sub-task "${subtaskSummary}" under ${testingStoryKey}…`);
  const subtaskKey = await createSubtask(creds, testingStoryKey, subtaskSummary, wf.subtaskDescription, assigneeAccountId);
  console.log(`  ✅  Sub-task created: ${subtaskKey}`);
  console.log(`       Assigned to: ${assigneeEmail}`);
  console.log(`  🔗  ${browseUrl(creds.baseUrl, subtaskKey)}`);

  // ── Step 7: Attach CSV + XLSX to sub-task, then mark Done ────────────────
  step(7, `Attach CSV + XLSX to ${subtaskKey} and mark Done`);
  console.log(`  📎  Attaching CSV: ${path.basename(csvPath)}…`);
  const attachment = await attachFile(creds, subtaskKey, csvPath);
  console.log(`  ✅  Attached: ${attachment.filename} (${attachment.size} bytes)`);

  console.log(`  📎  Attaching XLSX: ${path.basename(xlsxPath)}…`);
  const xlsxAttachment = await attachFile(creds, subtaskKey, xlsxPath);
  console.log(`  ✅  Attached: ${xlsxAttachment.filename} (${xlsxAttachment.size} bytes)`);

  console.log(`  🔄  Transitioning ${subtaskKey} to "${wf.doneTransitionName ?? 'Completed'}"…`);
  try {
    const transitionName = wf.doneTransitionName ?? 'Completed';
    await transitionIssue(creds, subtaskKey, transitionName);
    console.log(`  ✅  ${subtaskKey} marked as ${transitionName}`);
  } catch (err) {
    // Non-fatal — transition names vary by project. Print warning and continue.
    console.warn(`  ⚠️  Could not auto-transition ${subtaskKey}: ${(err as Error).message}`);
    console.warn('     Please close the sub-task manually.');
  }

  // ── Step 8: Comment on the Testing story ─────────────────────────────────
  step(8, `Add comment on Testing story ${testingStoryKey}`);
  console.log(`  💬  Posting summary comment to ${testingStoryKey}…`);
  const commentText = interpolate(wf.commentTemplate, {
    filename: `${attachment.filename}, ${xlsxAttachment.filename}`,
    count: String(testCases.length),
    complexity: analysis.complexity,
    types: analysis.suggestedTypes.join(', '),
    subtaskKey,
    subtaskUrl: browseUrl(creds.baseUrl, subtaskKey),
  });
  await addComment(creds, testingStoryKey, commentText);
  console.log(`  ✅  Comment posted to ${testingStoryKey}`);
  console.log(`  🔗  ${browseUrl(creds.baseUrl, testingStoryKey)}`);

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
