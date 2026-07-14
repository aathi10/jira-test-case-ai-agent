// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Generator
//  Builds TestCase objects following .bob/rules/TEST_CASE_GENERATION_GUIDE.md
//
//  Guiderails applied:
//  - Flat TC-NNN sequence (one counter for all, grouped by category in output)
//  - Priority: Critical = blocker | High = core AC / data-loss risk | Medium = edge cases | Low = docs/audit
//  - 4–8 steps per test case: setup → action → verify → side-effects
//  - Each step: concrete "Action -> Observable expected result"
//  - Notes include related issue keys + performance targets
//  - Types: Functional | Negative | Integration | Performance |
//           Security | Accessibility | Documentation | Regression
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { analyseIssue } from './ai-analyzer';
import { formatAsCSV, formatAsMarkdown, formatAsXLSX } from './exporters';
import { fetchFromRestApi } from './jira-fetcher';
import { IssueAnalysis, JiraIssue, OutputFormat, TestCase, TestPriority, TestStep, TestType } from './types';

const pad = (n: number) => String(n).padStart(3, '0');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Priority assignment (guiderail §5) ───────────────────────────────────────

function assignPriority(scenario: string, type: TestType, issuePriority: string): TestPriority {
  const l = scenario.toLowerCase();
  // High: core AC / happy-path / data-loss risk
  if (type === 'Functional' && l.match(/happy path|valid input|core|migration.*happy/)) return 'High';
  if (l.match(/data loss|corrupt|clean.?up|migration|401|403|unauthori/)) return 'High';
  if (issuePriority.toLowerCase() === 'critical' || issuePriority.toLowerCase() === 'blocker') return 'Critical';
  if (issuePriority.toLowerCase() === 'high' || issuePriority.toLowerCase() === 'major') {
    if (type === 'Functional' || type === 'Integration' || type === 'Negative') return 'High';
  }
  // Medium: edge cases, concurrent, partial
  if (l.match(/edge|boundary|concurrent|partial|incognito|private|cross.browser|feature flag/)) return 'Medium';
  if (type === 'Performance' || type === 'Accessibility') return 'Medium';
  // Low: docs, audit trails, future
  if (type === 'Documentation') return 'Low';
  if (l.match(/audit|log|readme|comment|todo/)) return 'Low';
  return 'Medium';
}

// ─── Step templates (guiderail §6 — min 4 steps, concrete actions) ────────────

function buildSteps(scenario: string, type: TestType, issue: JiraIssue): TestStep[] {
  const comp = issue.components[0] ?? 'application';
  const ac = issue.acceptanceCriteria
    ? issue.acceptanceCriteria.slice(0, 120)
    : 'Feature behaves as described in the issue';

  switch (type) {

    case 'Functional': return [
      { stepNumber: 1, action: `Navigate to the ${comp} section / feature entry point`, expectedResult: 'Page/section loads without errors' },
      { stepNumber: 2, action: `Perform: ${cap(scenario)}`, expectedResult: 'The action is accepted by the system without errors' },
      { stepNumber: 3, action: 'Verify the outcome matches the acceptance criteria', expectedResult: `Outcome satisfies: ${ac}` },
      { stepNumber: 4, action: 'Verify no console errors or unexpected warnings appear', expectedResult: 'Browser console is clean; no JS errors' },
      { stepNumber: 5, action: 'Refresh the page and verify state is persisted', expectedResult: 'State is retained correctly after page reload' },
    ];

    case 'Negative': return [
      { stepNumber: 1, action: `Navigate to the ${comp} section / feature entry point`, expectedResult: 'Page loads successfully' },
      { stepNumber: 2, action: `Attempt: ${cap(scenario)} using invalid/missing/boundary data`, expectedResult: 'System rejects the input or denies the action' },
      { stepNumber: 3, action: 'Observe the error feedback returned to the user', expectedResult: 'A descriptive, user-friendly error message is displayed' },
      { stepNumber: 4, action: 'Verify the system state has not been corrupted', expectedResult: 'Data integrity is maintained; no partial writes occurred' },
      { stepNumber: 5, action: 'Retry with valid data after the failed attempt', expectedResult: 'System accepts the valid input and proceeds normally' },
    ];

    case 'Integration': return [
      { stepNumber: 1, action: 'Confirm all dependent services/APIs are running and health checks pass', expectedResult: 'All downstream services respond with HTTP 200' },
      { stepNumber: 2, action: `Trigger the integration flow: ${cap(scenario)}`, expectedResult: 'Request is dispatched; HTTP 200/201 acknowledged' },
      { stepNumber: 3, action: 'Verify the request payload matches the API contract', expectedResult: 'Payload contains all required fields in the correct format' },
      { stepNumber: 4, action: 'Verify data is correctly propagated to the target system', expectedResult: 'Records in source and target systems are consistent' },
      { stepNumber: 5, action: 'Simulate an integration failure (mock HTTP 500 from downstream)', expectedResult: 'System handles the failure gracefully with retry or fallback logic' },
      { stepNumber: 6, action: 'Verify error is surfaced to the user appropriately', expectedResult: 'User sees a meaningful error; no data is lost or corrupted' },
    ];

    case 'Performance': return [
      { stepNumber: 1, action: `Run baseline performance test for: ${cap(scenario)}`, expectedResult: 'Response time < 2s under normal single-user load' },
      { stepNumber: 2, action: 'Simulate 50 concurrent users performing the same action simultaneously', expectedResult: 'P95 response time < 5s; error rate < 1%' },
      { stepNumber: 3, action: 'Monitor server-side CPU, memory, and DB query metrics during load', expectedResult: 'No resource exhaustion; metrics remain within acceptable thresholds' },
      { stepNumber: 4, action: 'Repeat the test 3 times and compare results for consistency', expectedResult: 'Results are stable; no significant variance between runs' },
    ];

    case 'Security': return [
      { stepNumber: 1, action: `Attempt: ${cap(scenario)} as an unauthenticated user`, expectedResult: 'Request is rejected with HTTP 401 Unauthorised' },
      { stepNumber: 2, action: 'Repeat the attempt with a valid session but insufficient permissions', expectedResult: 'Request is rejected with HTTP 403 Forbidden' },
      { stepNumber: 3, action: 'Attempt the action using a valid but expired token', expectedResult: 'Session is invalidated; user is prompted to re-authenticate' },
      { stepNumber: 4, action: 'Verify the API request uses HTTPS (inspect network traffic)', expectedResult: 'All traffic is encrypted; no plain HTTP calls are made' },
      { stepNumber: 5, action: 'Verify User A cannot access or modify User B\'s data', expectedResult: 'Data isolation is enforced; cross-user access is denied' },
      { stepNumber: 6, action: 'Verify the denied attempt is recorded in the audit log', expectedResult: 'Audit trail captures timestamp, user ID, and action attempted' },
    ];

    case 'Accessibility': return [
      { stepNumber: 1, action: 'Open the feature in Chrome at 1920×1080 with keyboard-only navigation', expectedResult: 'All interactive elements are reachable via Tab key in logical order' },
      { stepNumber: 2, action: `Navigate to and interact with: ${cap(scenario)} using keyboard only`, expectedResult: 'Action can be completed without a mouse; focus indicators are visible' },
      { stepNumber: 3, action: 'Enable NVDA (Windows) or VoiceOver (macOS) and navigate the feature', expectedResult: 'Screen reader correctly announces all labels, states, and role changes' },
      { stepNumber: 4, action: 'Inspect all interactive elements for ARIA attributes using axe DevTools', expectedResult: 'No accessibility violations; all ARIA labels are meaningful and accurate' },
      { stepNumber: 5, action: 'Verify colour contrast ratio using browser DevTools or Colour Contrast Analyser', expectedResult: 'Contrast ratio ≥ 4.5:1 for normal text (WCAG 2.1 AA)' },
    ];

    case 'Documentation': return [
      { stepNumber: 1, action: `Search the codebase for TODO / FIXME comments related to ${issue.key}`, expectedResult: 'No unresolved TODO/FIXME comments remain for this feature' },
      { stepNumber: 2, action: `Search for deprecated references: ${cap(scenario)}`, expectedResult: 'No deprecated APIs, imports, or patterns remain in the affected files' },
      { stepNumber: 3, action: 'Review inline code comments for accuracy against current implementation', expectedResult: 'Comments accurately describe the current behaviour' },
      { stepNumber: 4, action: 'Review README / developer documentation for the affected component', expectedResult: 'Documentation reflects the new implementation and is up to date' },
    ];

    case 'Regression': return [
      { stepNumber: 1, action: 'Execute the baseline smoke test suite for all areas affected by this change', expectedResult: 'All existing smoke tests pass without modification' },
      { stepNumber: 2, action: `Test the previously working behaviour: ${cap(scenario)}`, expectedResult: `Existing functionality is unaffected by changes in ${issue.key}` },
      { stepNumber: 3, action: 'Run the full regression suite for linked issues', expectedResult: 'No regressions detected; all linked-issue flows behave as before' },
      { stepNumber: 4, action: 'Compare test results against the last known-good build', expectedResult: 'Result delta is zero; no new failures introduced' },
    ];
  }
}

// ─── Test data per type ────────────────────────────────────────────────────────

function buildTestData(scenario: string, type: TestType, issue: JiraIssue): string[] {
  switch (type) {
    case 'Negative': return [
      'Empty string / null value',
      'Special characters: <script>alert(1)</script>',
      'String exceeding max length (>255 chars)',
      'Numeric field with letters: "abc"',
      'Boundary value: min−1 and max+1',
    ];
    case 'Security': return [
      'Unauthenticated request (no token)',
      'Expired JWT token',
      'Token belonging to a different user (User B\'s token for User A\'s resource)',
      'Role without required permission',
    ];
    case 'Performance': return [
      '1 concurrent user (baseline)',
      '50 concurrent users (load test)',
      'Response time target: < 500ms (API), < 2s (page load)',
      'P95 target: < 5s under 50 concurrent users',
    ];
    case 'Integration': return [
      'Valid request payload per API contract',
      'Mock HTTP 500 from downstream service',
      'Mock network timeout (30s)',
      'Empty response body from API',
    ];
    case 'Accessibility': return [
      'Keyboard-only navigation (no mouse)',
      'NVDA on Windows / VoiceOver on macOS',
      'axe DevTools accessibility scan',
      'Colour Contrast Analyser — target 4.5:1',
    ];
    default:
      return [`Valid data as defined in ${issue.key} acceptance criteria`];
  }
}

// ─── Notes builder (guiderail §7) ─────────────────────────────────────────────

function buildNotes(type: TestType, issue: JiraIssue): string {
  const related = issue.linkedIssues.slice(0, 3).map(l => l.key).join(', ');
  const base = related ? `Related: ${related}` : `Source: ${issue.key}`;
  switch (type) {
    case 'Performance':   return `${base}. Target: API < 500ms, page load < 2s, P95 < 5s under 50 concurrent users`;
    case 'Security':      return `${base}. Verify HTTPS-only traffic. Check audit log after each denied attempt`;
    case 'Accessibility': return `${base}. Tools: axe DevTools, NVDA, VoiceOver, Colour Contrast Analyser`;
    case 'Documentation': return `${base}. Search codebase for TODO/FIXME tied to ${issue.key}`;
    case 'Regression':    return `${base}. Run after every deployment to verify no regressions`;
    case 'Integration':   return `${base}. Mock downstream failures using WireMock or equivalent`;
    default:              return base;
  }
}

// ─── Main make() ──────────────────────────────────────────────────────────────

function make(
  issue: JiraIssue,
  analysis: IssueAnalysis,
  scenario: string,
  category: string,
  counter: number,
  type: TestType,
): TestCase {
  const priority = assignPriority(scenario, type, issue.priority);
  return {
    id: `${issue.key}-TC-${pad(counter)}`,
    title: cap(scenario),
    priority,
    type,
    category,
    preconditions: analysis.derivedPreconditions,
    testSteps: buildSteps(scenario, type, issue),
    expectedResult: type === 'Negative'
      ? 'System rejects the invalid input and displays an appropriate, user-friendly error message'
      : `${cap(scenario)} completes successfully and all acceptance criteria are satisfied`,
    testData: buildTestData(scenario, type, issue),
    notes: buildNotes(type, issue),
    automatable: type !== 'Performance' && type !== 'Accessibility' && type !== 'Documentation',
  };
}

// ─── Category → TestType mapping ──────────────────────────────────────────────

function inferType(category: string, scenario: string): TestType {
  const l = scenario.toLowerCase();
  if (category === 'Security')               return 'Security';
  if (category === 'Performance')            return 'Performance';
  if (category === 'Accessibility')          return 'Accessibility';
  if (category === 'Documentation')          return 'Documentation';
  if (category === 'Regression')             return 'Regression';
  if (category === 'Migration' || category === 'API / Integration') return 'Integration';
  if (category === 'Negative / Error Handling') return 'Negative';
  if (l.match(/invalid|error|fail|exception|reject|unauthori|missing|empty|boundary|timeout|500|401|403/)) return 'Negative';
  return 'Functional';
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function generateTestCases(issue: JiraIssue, analysis: IssueAnalysis, _detailed: boolean): TestCase[] {
  const testCases: TestCase[] = [];
  let counter = 0;   // flat TC-NNN sequence across all categories

  for (const group of analysis.scenarioGroups) {
    for (const scenario of group.scenarios) {
      counter++;
      const type = inferType(group.category, scenario);
      testCases.push(make(issue, analysis, scenario, group.category, counter, type));
    }
  }

  return testCases;
}

// ─── TestCaseAgentGenerator class ─────────────────────────────────────────────
//  Thin wrapper used by the CLI entry point in .bob/rules/jira-test-case-generator.ts
//  and scripts/jira-test-case-generator.ts.
//
//  Usage:
//    const gen = new TestCaseAgentGenerator('PROJ-123', 'csv', undefined, true);
//    await gen.generate();

export class TestCaseAgentGenerator {
  constructor(
    private readonly issueKey: string,
    private readonly format: OutputFormat = 'csv',
    private readonly outputPath: string | undefined = undefined,
    private readonly detailed: boolean = false,
  ) {}

  async generate(): Promise<void> {
    console.log(`\n🔍  Fetching ${this.issueKey}…`);
    const issue = await fetchFromRestApi(this.issueKey);
    console.log(`  📋  ${issue.key}: ${issue.summary}`);

    const analysis = analyseIssue(issue);
    const testCases = generateTestCases(issue, analysis, this.detailed);

    const outDir = path.join(process.cwd(), 'test-cases');
    fs.mkdirSync(outDir, { recursive: true });

    const base = this.outputPath
      ? path.resolve(this.outputPath).replace(/\.[^.]+$/, '')
      : path.join(outDir, `${this.issueKey}-test-cases`);

    if (this.format === 'csv' || this.format === 'xlsx') {
      const csvPath = `${base}.csv`;
      fs.writeFileSync(csvPath, formatAsCSV(testCases), 'utf-8');
      console.log(`  💾  CSV  → ${csvPath}`);
    }
    if (this.format === 'xlsx') {
      const xlsxPath = `${base}.xlsx`;
      fs.writeFileSync(xlsxPath, formatAsXLSX(testCases, issue, analysis));
      console.log(`  💾  XLSX → ${xlsxPath}`);
    }
    if (this.format === 'markdown') {
      const mdPath = `${base}.md`;
      fs.writeFileSync(mdPath, formatAsMarkdown(testCases, issue, analysis), 'utf-8');
      console.log(`  💾  MD   → ${mdPath}`);
    }
    if (this.format === 'json') {
      const jsonPath = `${base}.json`;
      fs.writeFileSync(jsonPath, JSON.stringify({ issue: { key: issue.key, summary: issue.summary }, generatedAt: new Date().toISOString(), testCases }, null, 2), 'utf-8');
      console.log(`  💾  JSON → ${jsonPath}`);
    }

    console.log(`\n✅  ${testCases.length} test cases generated (complexity: ${analysis.complexity})`);
  }
}

// Made with Bob
