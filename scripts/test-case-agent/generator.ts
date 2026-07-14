// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Generator
//  Builds TestCase objects from JiraIssue + IssueAnalysis
// ─────────────────────────────────────────────────────────────────────────────

import { IssueAnalysis, JiraIssue, TestCase, TestPriority, TestStep, TestType } from './types';

const pad = (n: number) => String(n).padStart(3, '0');
const tc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const neg = (s: string) => /invalid|error|fail|exception|reject|unauthori|missing|empty|boundary/i.test(s);

function mapPrio(p: string): TestPriority {
  switch (p.toLowerCase()) {
    case 'critical': case 'blocker': return 'Critical';
    case 'high': case 'major': return 'High';
    case 'low': case 'minor': case 'trivial': return 'Low';
    default: return 'Medium';
  }
}

function steps(scenario: string, type: TestType, issue: JiraIssue): TestStep[] {
  switch (type) {
    case 'Negative': return [
      { stepNumber: 1, action: 'Navigate to the relevant page/feature', expectedResult: 'Page loads successfully' },
      { stepNumber: 2, action: `Attempt: ${tc(scenario)} using invalid/missing data`, expectedResult: 'System rejects the input or denies the action' },
      { stepNumber: 3, action: 'Observe the error feedback', expectedResult: 'A descriptive, user-friendly error message is displayed' },
      { stepNumber: 4, action: 'Verify the system state has not been corrupted', expectedResult: 'Data integrity is maintained; no partial writes occurred' },
    ];
    case 'UI': return [
      { stepNumber: 1, action: 'Open the application in a supported browser at 1920x1080', expectedResult: 'Page renders correctly' },
      { stepNumber: 2, action: `Inspect: ${tc(scenario)}`, expectedResult: 'UI elements match design specifications' },
      { stepNumber: 3, action: 'Resize to 768px (tablet) and 375px (mobile)', expectedResult: 'Layout adapts responsively without overflow' },
      { stepNumber: 4, action: 'Verify keyboard navigation and screen reader labels', expectedResult: 'Feature meets WCAG 2.1 AA accessibility standards' },
    ];
    case 'Integration': return [
      { stepNumber: 1, action: 'Confirm all dependent services/APIs are running', expectedResult: 'Health checks pass for all integrations' },
      { stepNumber: 2, action: `Trigger integration flow: ${tc(scenario)}`, expectedResult: 'Request is dispatched and acknowledged' },
      { stepNumber: 3, action: 'Verify data is correctly propagated across systems', expectedResult: 'Records in source and target systems are consistent' },
      { stepNumber: 4, action: 'Simulate an integration failure (mock 500)', expectedResult: 'System handles failure gracefully with retry/fallback logic' },
    ];
    case 'Security': return [
      { stepNumber: 1, action: 'Attempt the action as an unauthenticated user', expectedResult: 'Request is rejected with HTTP 401' },
      { stepNumber: 2, action: `Attempt: ${tc(scenario)} with insufficient privileges`, expectedResult: 'Request is rejected with HTTP 403' },
      { stepNumber: 3, action: 'Attempt with a valid but expired token', expectedResult: 'Session is invalidated; user prompted to re-authenticate' },
      { stepNumber: 4, action: 'Verify audit log records the denied attempt', expectedResult: 'Audit trail accurately captures timestamp and user ID' },
    ];
    case 'Regression': return [
      { stepNumber: 1, action: 'Execute the baseline smoke test suite for the affected area', expectedResult: 'All existing smoke tests continue to pass' },
      { stepNumber: 2, action: `Test previously working behaviour: ${tc(scenario)}`, expectedResult: `Existing functionality unaffected by changes in ${issue.key}` },
      { stepNumber: 3, action: 'Compare results against the last known-good test run', expectedResult: 'No regressions detected' },
    ];
    case 'Performance': return [
      { stepNumber: 1, action: `Run baseline performance test: ${tc(scenario)}`, expectedResult: 'Response time < 2s under normal load' },
      { stepNumber: 2, action: 'Simulate 50 concurrent users performing the same action', expectedResult: 'P95 response time < 5s; error rate < 1%' },
      { stepNumber: 3, action: 'Monitor server-side metrics during load', expectedResult: 'No resource exhaustion; system remains stable' },
    ];
    default: return [
      { stepNumber: 1, action: `Navigate to the ${issue.components[0] ?? 'relevant'} section`, expectedResult: 'Page/section loads without errors' },
      { stepNumber: 2, action: `Perform: ${tc(scenario)}`, expectedResult: 'The action is accepted by the system' },
      { stepNumber: 3, action: 'Verify the outcome matches the acceptance criteria', expectedResult: issue.acceptanceCriteria ? `Outcome satisfies: ${issue.acceptanceCriteria.slice(0, 120)}` : 'Feature behaves as described in the issue' },
      { stepNumber: 4, action: 'Check for unexpected side-effects or errors', expectedResult: 'No unexpected errors, warnings, or data corruption' },
    ];
  }
}

function make(issue: JiraIssue, analysis: IssueAnalysis, scenario: string, category: string, counter: number, typeHint?: TestType): TestCase {
  const isNeg = neg(scenario);
  const type: TestType = typeHint ?? (isNeg ? 'Negative' : 'Functional');
  const priority: TestPriority = isNeg ? 'Medium' : mapPrio(issue.priority);
  const suffix = { Negative: `NEG-${pad(counter)}`, UI: `UI-${pad(counter)}`, Integration: `INT-${pad(counter)}`, Security: `SEC-${pad(counter)}`, Regression: `REG-${pad(counter)}`, Performance: `PERF-${pad(counter)}` }[type] ?? `TC-${pad(counter)}`;
  return {
    id: `${issue.key}-${suffix}`, title: tc(scenario), priority, type, category,
    preconditions: analysis.derivedPreconditions,
    testSteps: steps(scenario, type, issue),
    expectedResult: isNeg ? 'System rejects the invalid input and displays an appropriate error message' : `${tc(scenario)} completes successfully and the outcome matches the acceptance criteria`,
    testData: isNeg ? ['Empty string', 'Special characters: <script>alert(1)</script>', 'Excessively long strings (>255 chars)', 'Null / undefined values'] : [`Valid data as defined in ${issue.key} acceptance criteria`],
    notes: `Source: ${issue.key} — ${issue.summary}`,
    automatable: type !== 'Performance',
    playwrightHint: type === 'UI' ? `page.locator('[data-testid="..."]')` : undefined,
  };
}

export function generateTestCases(issue: JiraIssue, analysis: IssueAnalysis, detailed: boolean): TestCase[] {
  const testCases: TestCase[] = [];
  const cnt: Record<string, number> = {};
  const next = (p: string) => { cnt[p] = (cnt[p] ?? 0) + 1; return cnt[p]; };
  for (const group of analysis.scenarioGroups) {
    for (const scenario of group.scenarios) {
      const isNeg = neg(scenario);
      const th: TestType = isNeg ? 'Negative' : /ui|button|form|layout|display|render/i.test(scenario) ? 'UI' : /api|endpoint|integration|sync/i.test(scenario) ? 'Integration' : /security|permission|role|access/i.test(scenario) ? 'Security' : /regression|existing|previous/i.test(scenario) ? 'Regression' : 'Functional';
      testCases.push(make(issue, analysis, scenario, group.category, next(th), th));
    }
  }
  if (detailed) {
    testCases.push(make(issue, analysis, `Verify ${issue.summary} with boundary values (min, max, min-1, max+1)`, 'Edge Cases', next('TC'), 'Functional'));
    if (analysis.suggestedTypes.includes('Security')) testCases.push(make(issue, analysis, `Verify unauthorised access is denied for ${issue.summary}`, 'Security', next('SEC'), 'Security'));
    if (analysis.suggestedTypes.includes('Performance')) testCases.push(make(issue, analysis, `Verify ${issue.summary} performance under concurrent load`, 'Performance', next('PERF'), 'Performance'));
    testCases.push(make(issue, analysis, `Verify existing functionality is not broken by ${issue.summary}`, 'Regression', next('REG'), 'Regression'));
  }
  return testCases;
}

// Made with Bob
