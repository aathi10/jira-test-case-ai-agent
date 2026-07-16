// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Issue Analyser
//
//  RESPONSIBILITY: complexity scoring and test-type detection only.
//
//  All QA reasoning (scenario titles, preconditions, step content, priorities)
//  now lives entirely in prompts/test-case-generation.md and is executed by Bob.
//
//  What stays here (deterministic heuristics only):
//    - Complexity scoring    → used for workflow log output
//    - Suggested test types  → used for workflow log output
//    - Role extraction       → used for workflow log output
// ─────────────────────────────────────────────────────────────────────────────

import { IssueAnalysis, JiraIssue, RepoContext, TestType } from './types.js';

// ─── Keyword banks (heuristic scoring only) ───────────────────────────────────

const API_KW  = ['api','rest','graphql','endpoint','payload','request','response','webhook','service','integration','sync','async','fetch','http'];
const SEC_KW  = ['security','auth','authentication','authorization','permission','role','rbac','token','jwt','oauth','sso','saml','mfa','encrypt','decrypt','xss','csrf','injection','privilege','https','privacy','pii'];
const PERF_KW = ['performance','load','stress','latency','throughput','response time','concurrent','benchmark','timeout','p95','p99','millisecond'];
const A11Y_KW = ['accessibility','aria','wcag','keyboard','screen reader','nvda','jaws','voiceover','focus','contrast','alt text','a11y'];
const DOC_KW  = ['todo','fixme','readme','documentation','changelog','deprecat'];

const C_HIGH = ['migration','complex','multiple systems','third-party','legacy',...SEC_KW,...PERF_KW,...API_KW];
const C_MED  = ['workflow','process','validation','database','db','crud','localstorage','preference','store','setting'];

// ─── Role extractor (for log output) ─────────────────────────────────────────

const ROLE_RE = [
  /\b(admin(?:istrator)?)\b/gi, /\b(user)\b/gi,   /\b(viewer)\b/gi,
  /\b(owner)\b/gi,              /\b(manager)\b/gi, /\b(operator)\b/gi,
  /\b(editor)\b/gi,             /\b(guest)\b/gi,
];

export function extractRoles(text: string): string[] {
  const found = new Set<string>();
  for (const p of ROLE_RE) {
    const re = new RegExp(p.source, p.flags);
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1] ?? m[0]);
  }
  return [...found].slice(0, 10);
}

// ─── analyseIssue ─────────────────────────────────────────────────────────────
//
// Returns complexity, suggestedTypes, and roles for workflow log output.
// scenarioGroups is always empty — Bob generates scenarios from the prompt file.

export function analyseIssue(issue: JiraIssue, _repoContext?: RepoContext): IssueAnalysis {
  const fullText = `${issue.summary}\n${issue.description}\n${issue.acceptanceCriteria}`;
  const low = fullText.toLowerCase();

  const complexity: 'Low' | 'Medium' | 'High' =
    C_HIGH.some(k => low.includes(k)) ? 'High' :
    C_MED.some(k  => low.includes(k)) ? 'Medium' : 'Low';

  const suggestedTypes: TestType[] = ['Functional', 'Negative', 'Regression'];
  if (API_KW.some(k => low.includes(k))  || low.match(/store|fetch|sync/))   suggestedTypes.push('Integration');
  if (SEC_KW.some(k => low.includes(k))  || low.match(/auth|token|user/))    suggestedTypes.push('Security');
  if (PERF_KW.some(k => low.includes(k)) || low.match(/api|load|response/))  suggestedTypes.push('Performance');
  if (A11Y_KW.some(k => low.includes(k)) || low.match(/ui|page|form|button/)) suggestedTypes.push('Accessibility');
  if (DOC_KW.some(k => low.includes(k))  || low.match(/todo|deprecated/))    suggestedTypes.push('Documentation');

  return {
    scenarioGroups: [],          // Bob generates scenarios — not populated here
    complexity,
    suggestedTypes: [...new Set(suggestedTypes)],
    keywords: [...API_KW, ...SEC_KW, ...PERF_KW, ...A11Y_KW].filter(k => low.includes(k)),
    derivedPreconditions: [],    // Bob generates preconditions — not populated here
    roles: extractRoles(fullText),
    environments: [],
  };
}

// Made with Bob
