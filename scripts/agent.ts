// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — CLI Runner
//
//  Fetches a JIRA issue, builds the full context, and writes a Bob instruction
//  file. Bob reads the instruction file and writes the CSV. The CLI can then
//  convert the CSV to XLSX / Markdown / JSON.
//
//  Usage:
//    npx tsx scripts/agent.ts PROJ-123
//    npx tsx scripts/agent.ts PROJ-123 PROJ-124 --format xlsx
//    npx tsx scripts/agent.ts PROJ-123 --from-csv   (convert existing CSV only)
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { analyseIssue } from './test-case-agent/ai-analyzer';
import { buildContext } from './test-case-agent/context-builder';
import { formatAsMarkdown, formatAsXLSX, formatAsJSON } from './test-case-agent/exporters';
import { fetchFromRestApi, normaliseFromMcp } from './test-case-agent/jira-fetcher';
import { writeBobInstructionFile, parseCsvToTestCases } from './test-case-agent/generator';
import { OutputFormat } from './test-case-agent/types';

interface CliArgs {
  issueKeys: string[];
  format: OutputFormat;
  outputDir: string;
  fromCsv: boolean;
  mcpFile?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const issueKeys: string[] = [];
  let format: OutputFormat = 'xlsx';
  let outputDir = 'test-cases';
  let fromCsv = false;
  let mcpFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--format' || a === '-f') && args[i + 1]) { format = args[++i] as OutputFormat; }
    else if ((a === '--output' || a === '-o') && args[i + 1]) { outputDir = args[++i]; }
    else if (a === '--mcp' && args[i + 1]) { mcpFile = args[++i]; }
    else if (a === '--from-csv') { fromCsv = true; }
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (!a.startsWith('--') && /^[A-Z][A-Z0-9_]+-\d+$/i.test(a)) issueKeys.push(a.toUpperCase());
  }
  return { issueKeys, format, outputDir, fromCsv, mcpFile };
}

function printHelp(): void {
  console.log(`
JIRA Test Case Agent — Bob-driven CSV generator

USAGE: npx tsx scripts/agent.ts <ISSUE_KEY...> [options]

WORKFLOW:
  1. Run without --from-csv → writes a Bob instruction file
  2. Bob reads the instruction file and writes the CSV
  3. Run with --from-csv → converts the CSV to XLSX / Markdown / JSON

OPTIONS:
  --format <fmt>   Output format after CSV conversion: xlsx | markdown | json  (default: xlsx)
  --output <dir>   Output directory  (default: test-cases/)
  --from-csv       Skip instruction file; convert existing CSV to other formats
  --mcp <file>     Path to a raw MCP JIRA JSON response
  --help           Show this message

ENV VARS: JIRA_BASE_URL  JIRA_USERNAME  JIRA_API_TOKEN

EXAMPLES:
  npx tsx scripts/agent.ts SCI-17066
  npx tsx scripts/agent.ts SCI-17066 --from-csv --format xlsx
  npx tsx scripts/agent.ts SCI-17066 SCI-17067
  npx tsx scripts/agent.ts --mcp ./mcp-response.json
`);
}

async function processIssue(issueKey: string, opts: CliArgs, mcpRaw?: unknown): Promise<void> {
  const outDir = path.resolve(opts.outputDir);
  fs.mkdirSync(outDir, { recursive: true });

  const csvPath = path.join(outDir, `${issueKey}-test-cases.csv`);

  if (opts.fromCsv) {
    // ── Convert existing CSV → other formats ──────────────────────────────
    if (!fs.existsSync(csvPath)) {
      console.error(`  ❌  CSV not found: ${csvPath}`);
      console.error(`  ℹ️   Run without --from-csv first so Bob can generate the CSV.`);
      process.exit(1);
    }
    console.log(`\n📂  Loading ${issueKey} from existing CSV…`);
    const issue = mcpRaw ? normaliseFromMcp(mcpRaw) : await fetchFromRestApi(issueKey);
    const analysis = analyseIssue(issue);
    const testCases = parseCsvToTestCases(csvPath, issueKey);
    console.log(`  ✅  ${testCases.length} test cases loaded`);
    convertCsv(testCases, issue, analysis, opts, outDir, issueKey);
    return;
  }

  // ── Fetch + write Bob instruction file ──────────────────────────────────
  console.log(`\n🔍  Fetching ${issueKey}…`);
  const issue = mcpRaw ? normaliseFromMcp(mcpRaw) : await fetchFromRestApi(issueKey);
  console.log(`  📋  ${issue.key}: ${issue.summary}`);

  const ctx = buildContext(issue);
  const analysis = analyseIssue(issue);

  console.log(`  Complexity : ${analysis.complexity}`);
  console.log(`  Test types : ${analysis.suggestedTypes.join(', ')}`);
  console.log(`  Roles      : ${analysis.roles.join(', ') || '(none detected)'}`);

  const instructionPath = writeBobInstructionFile(ctx, csvPath, outDir);
  console.log(`\n  📝  Bob instruction file → ${instructionPath}`);
  console.log(`\n  ══════════════════════════════════════════════════════`);
  console.log(`  BOB: read the instruction file and write the CSV to:`);
  console.log(`    ${csvPath}`);
  console.log(`  ══════════════════════════════════════════════════════`);
  console.log(`\n  After Bob writes the CSV, run:`);
  console.log(`    npx tsx scripts/agent.ts ${issueKey} --from-csv --format ${opts.format}`);

  // If Bob already wrote the CSV (re-run), auto-convert
  if (fs.existsSync(csvPath)) {
    const testCases = parseCsvToTestCases(csvPath, issueKey);
    if (testCases.length > 0) {
      console.log(`\n  ✅  CSV already exists — ${testCases.length} test cases loaded`);
      convertCsv(testCases, issue, analysis, opts, outDir, issueKey);
    }
  }
}

function convertCsv(
  testCases: ReturnType<typeof parseCsvToTestCases>,
  issue: Awaited<ReturnType<typeof fetchFromRestApi>>,
  analysis: ReturnType<typeof analyseIssue>,
  opts: CliArgs,
  outDir: string,
  issueKey: string,
): void {
  const base = path.join(outDir, `${issueKey}-test-cases`);
  switch (opts.format) {
    case 'xlsx': {
      const xlsxPath = `${base}.xlsx`;
      fs.writeFileSync(xlsxPath, formatAsXLSX(testCases, issue, analysis));
      console.log(`  💾  XLSX → ${xlsxPath}`);
      break;
    }
    case 'markdown': {
      const mdPath = `${base}.md`;
      fs.writeFileSync(mdPath, formatAsMarkdown(testCases, issue, analysis), 'utf-8');
      console.log(`  💾  MD   → ${mdPath}`);
      break;
    }
    case 'json': {
      const jsonPath = `${base}.json`;
      fs.writeFileSync(jsonPath, JSON.stringify(
        { issue: { key: issue.key, summary: issue.summary }, generatedAt: new Date().toISOString(), testCases },
        null, 2,
      ), 'utf-8');
      console.log(`  💾  JSON → ${jsonPath}`);
      break;
    }
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (opts.issueKeys.length === 0 && !opts.mcpFile) { printHelp(); process.exit(1); }

  console.log(`\n${'='.repeat(54)}\n    JIRA Test Case Agent\n${'='.repeat(54)}`);

  if (opts.mcpFile) {
    const raw = JSON.parse(fs.readFileSync(opts.mcpFile, 'utf-8'));
    const key = opts.issueKeys[0] ?? (raw as Record<string, unknown>).key as string ?? 'UNKNOWN';
    await processIssue(key, opts, raw);
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
