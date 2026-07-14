// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — CLI Runner / Orchestrator
//
//  Usage:
//    npx tsx scripts/agent.ts PROJ-123 [--detailed] [--playwright] [--format csv]
//    npx tsx scripts/agent.ts PROJ-123 PROJ-124 --detailed
//    npx tsx scripts/agent.ts --mcp ./mcp-response.json --detailed
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { analyseIssue } from './test-case-agent/ai-analyzer';
import { formatAsCSV, formatAsJSON, formatAsMarkdown, formatAsPlaywright } from './test-case-agent/exporters';
import { fetchFromRestApi, normaliseFromMcp } from './test-case-agent/jira-fetcher';
import { generateTestCases } from './test-case-agent/generator';
import { IssueAnalysis, JiraIssue, OutputFormat, TestCase } from './test-case-agent/types';

interface CliArgs { issueKeys: string[]; format: OutputFormat; detailed: boolean; withPlaywright: boolean; outputDir: string; mcpFile?: string; }

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const issueKeys: string[] = [];
  let format: OutputFormat = 'markdown', detailed = false, withPlaywright = false, outputDir = 'test-cases';
  let mcpFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--format' && args[i+1]) { format = args[++i] as OutputFormat; }
    else if (a === '--output' && args[i+1]) { outputDir = args[++i]; }
    else if (a === '--mcp' && args[i+1]) { mcpFile = args[++i]; }
    else if (a === '--detailed') detailed = true;
    else if (a === '--playwright') withPlaywright = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (!a.startsWith('--') && /^[A-Z][A-Z0-9_]+-\d+$/i.test(a)) issueKeys.push(a.toUpperCase());
  }
  return { issueKeys, format, detailed, withPlaywright, outputDir, mcpFile };
}

function printHelp(): void {
  console.log(`
JIRA Test Case AI Agent

USAGE: npx tsx scripts/agent.ts <ISSUE_KEY...> [options]

OPTIONS:
  --format      markdown | csv | json | playwright  (default: markdown)
  --detailed    Include edge-case, security, performance, regression tests
  --playwright  Also emit a Playwright .spec.ts skeleton
  --output      Output directory  (default: test-cases/)
  --mcp <file>  Path to a JSON file with a raw MCP JIRA response
  --help        Show this message

ENV VARS: JIRA_BASE_URL  JIRA_USERNAME  JIRA_API_TOKEN

EXAMPLES:
  npx tsx scripts/agent.ts PROJ-123
  npx tsx scripts/agent.ts PROJ-123 --detailed --playwright
  npx tsx scripts/agent.ts PROJ-123 PROJ-124 --format csv
  npx tsx scripts/agent.ts --mcp ./mcp-response.json
`);
}

function writeOut(content: string, dir: string, key: string, suffix: string, ext: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${key}${suffix}.${ext}`);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

function printSummary(issue: JiraIssue, tcs: TestCase[], analysis: IssueAnalysis): void {
  const byType: Record<string, number> = {};
  for (const t of tcs) byType[t.type] = (byType[t.type] ?? 0) + 1;
  console.log(`\n${'-'.repeat(60)}`);
  console.log(`✅  ${issue.key}: ${issue.summary}`);
  console.log(`    Priority: ${issue.priority} | Complexity: ${analysis.complexity} | Total: ${tcs.length}`);
  for (const [type, n] of Object.entries(byType)) console.log(`       ${type.padEnd(15)} ${n}`);
}

async function processIssue(issueKey: string, opts: CliArgs, mcpRaw?: unknown): Promise<void> {
  console.log(`\n🔍  Fetching ${issueKey}...`);
  const issue = mcpRaw ? normaliseFromMcp(mcpRaw) : await fetchFromRestApi(issueKey);
  console.log(`📋  ${issue.key}: ${issue.summary}`);
  const analysis = analyseIssue(issue);
  console.log(`🤖  ${analysis.scenarioGroups.length} groups | ${analysis.suggestedTypes.join(', ')}`);
  const tcs = generateTestCases(issue, analysis, opts.detailed);
  const fmt = opts.format === 'playwright' ? 'markdown' : opts.format;
  let fp: string;
  switch (fmt) {
    case 'csv': fp = writeOut(formatAsCSV(tcs), opts.outputDir, issue.key, '-test-cases', 'csv'); break;
    case 'json': fp = writeOut(formatAsJSON(tcs, issue, analysis), opts.outputDir, issue.key, '-test-cases', 'json'); break;
    default: fp = writeOut(formatAsMarkdown(tcs, issue, analysis), opts.outputDir, issue.key, '-test-cases', 'md');
  }
  console.log(`💾  Saved → ${fp}`);
  if (opts.withPlaywright || opts.format === 'playwright') {
    const sp = writeOut(formatAsPlaywright(tcs, issue), opts.outputDir, issue.key, '-test-cases.generated', 'spec.ts');
    console.log(`🎭  Playwright skeleton → ${sp}`);
  }
  printSummary(issue, tcs, analysis);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (opts.issueKeys.length === 0 && !opts.mcpFile) { printHelp(); process.exit(1); }
  console.log(`\n${'='.repeat(54)}\n    JIRA Test Case AI Agent\n${'='.repeat(54)}`);
  if (opts.mcpFile) {
    const raw = JSON.parse(fs.readFileSync(opts.mcpFile, 'utf-8'));
    await processIssue(opts.issueKeys[0] ?? (raw as Record<string, unknown>).key as string ?? 'UNKNOWN', opts, raw);
    return;
  }
  let failed = 0;
  for (const key of opts.issueKeys) {
    try { await processIssue(key, opts); }
    catch (e) { console.error(`\n❌  ${key}: ${(e as Error).message}`); failed++; }
  }
  console.log(`\n${'='.repeat(54)}\n🏁  Done. ${opts.issueKeys.length - failed}/${opts.issueKeys.length} processed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });

// Made with Bob
