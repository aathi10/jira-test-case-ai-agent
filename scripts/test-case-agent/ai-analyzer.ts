// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — AI Analyzer
//  NLP-heuristic scenario extraction + issue analysis
// ─────────────────────────────────────────────────────────────────────────────

import { IssueAnalysis, JiraIssue, ScenarioGroup, TestType } from './types';

const UI_KW = ['ui','ux','interface','design','layout','button','form','page','modal','dialog','dropdown','menu','nav','sidebar','banner','display','render','visible','tooltip','style','colour','color','responsive','mobile','tablet','screen'];
const API_KW = ['api','rest','graphql','endpoint','payload','request','response','webhook','service','integration','sync','async','socket','grpc'];
const SEC_KW = ['security','auth','authentication','authorization','permission','role','rbac','token','jwt','oauth','sso','saml','mfa','encrypt','decrypt','xss','csrf','injection','privilege'];
const PERF_KW = ['performance','load','stress','spike','latency','throughput','response time','concurrent','scalab','benchmark'];
const C_HIGH = ['migration','complex','multiple systems','third-party','legacy',...SEC_KW,...PERF_KW,...API_KW];
const C_MED = ['workflow','process','validation','database','db','crud',...UI_KW];

const ROLE_RE = [/\b(admin(?:istrator)?)\b/gi,/\b(user)\b/gi,/\b(viewer)\b/gi,/\b(owner)\b/gi,/\b(manager)\b/gi,/\b(operator)\b/gi,/\b(editor)\b/gi,/\b(guest)\b/gi,/\b([A-Z][a-z]+ (?:Admin|User|Viewer|Owner|Manager|Operator))\b/g];
const ENV_RE = [/\b(dev(?:elop(?:ment)?)?)\b/gi,/\b(test(?:ing)?)\b/gi,/\b(staging)\b/gi,/\b(prod(?:uction)?)\b/gi,/\b(qa)\b/gi,/\b(uat)\b/gi,/\b(pre-?prod)\b/gi];

function extractRoles(text: string): string[] {
  const found = new Set<string>();
  for (const p of ROLE_RE) { const re = new RegExp(p.source, p.flags); let m: RegExpExecArray | null; while ((m = re.exec(text)) !== null) found.add(m[1] ?? m[0]); }
  return [...found].slice(0, 10);
}

function extractEnvironments(text: string): string[] {
  const found = new Set<string>();
  for (const p of ENV_RE) { const re = new RegExp(p.source, p.flags); let m: RegExpExecArray | null; while ((m = re.exec(text)) !== null) found.add(m[0].toLowerCase()); }
  return [...found];
}

export function extractScenariosFromText(text: string): string[] {
  if (!text) return [];
  const s: string[] = [];
  for (const item of text.match(/^[\s]*[-•*\d.]+\s+(.+)/gm) ?? []) { const c = item.replace(/^[\s\-•*\d.]+/, '').trim(); if (c.length > 10) s.push(c); }
  for (const bdd of text.match(/(?:Given|When|Then)\s+[^\n.]+[.\n]/gi) ?? []) { if (bdd.trim().length > 10) s.push(bdd.trim()); }
  for (const a of text.match(/(?:verify|ensure|validate|check|confirm|test|assert|should)\s+[^.;\n]{10,}/gi) ?? []) s.push(a.trim());
  return [...new Set(s)].slice(0, 40);
}

function groupScenarios(scenarios: string[], issue: JiraIssue): ScenarioGroup[] {
  const groups = new Map<string, string[]>();
  const cat = (s: string): string => {
    const l = s.toLowerCase();
    if (l.match(/login|logout|sign.?in|session/)) return 'Authentication';
    if (l.match(/permission|role|access|unauthori|rbac/)) return 'Permissions & Roles';
    if (l.match(/api|endpoint|request|response|webhook/)) return 'API / Integration';
    if (l.match(/ui|button|form|display|layout|render|page|navigate/)) return 'UI / UX';
    if (l.match(/security|encrypt|token|xss|csrf/)) return 'Security';
    if (l.match(/performance|load|latency|concurrent/)) return 'Performance';
    if (l.match(/error|fail|invalid|exception|negative|reject/)) return 'Negative / Error Handling';
    if (l.match(/regression|exist|previous|backward/)) return 'Regression';
    if (l.match(/config|setting|setup|install|deploy/)) return 'Configuration & Setup';
    return 'Functional';
  };
  groups.set('Functional', [`Verify ${issue.summary} - Happy Path`, `Verify ${issue.summary} with valid inputs`]);
  for (const s of scenarios) { const c = cat(s); if (!groups.has(c)) groups.set(c, []); groups.get(c)!.push(s); }
  if (!groups.has('Negative / Error Handling')) groups.set('Negative / Error Handling', [`Verify ${issue.summary} with invalid/empty input`, `Verify ${issue.summary} - Error message display`]);
  return [...groups.entries()].map(([category, s]) => ({ category, scenarios: s }));
}

function derivePreconditions(issue: JiraIssue): string[] {
  const pre = ['User is logged into the application'];
  const t = `${issue.description} ${issue.acceptanceCriteria}`.toLowerCase();
  if (t.match(/role|permission|admin/)) pre.push('User has the required role/permission assigned');
  if (t.match(/api|endpoint|service/)) pre.push('All dependent APIs and services are available');
  if (issue.components.length) pre.push(`${issue.components.join(', ')} component(s) are deployed and accessible`);
  if (issue.linkedIssues.length) pre.push('Related dependent issues are resolved');
  pre.push('Test environment is configured and accessible');
  return pre;
}

export function analyseIssue(issue: JiraIssue): IssueAnalysis {
  const fullText = `${issue.summary}\n${issue.description}\n${issue.acceptanceCriteria}`;
  const low = fullText.toLowerCase();
  const complexity: 'Low' | 'Medium' | 'High' = C_HIGH.some((k) => low.includes(k)) ? 'High' : C_MED.some((k) => low.includes(k)) ? 'Medium' : 'Low';
  const suggestedTypes: TestType[] = ['Functional'];
  if (UI_KW.some((k) => low.includes(k))) suggestedTypes.push('UI');
  if (API_KW.some((k) => low.includes(k))) suggestedTypes.push('Integration');
  if (SEC_KW.some((k) => low.includes(k))) suggestedTypes.push('Security');
  if (PERF_KW.some((k) => low.includes(k))) suggestedTypes.push('Performance');
  suggestedTypes.push('Negative', 'Regression');
  const rawScenarios = extractScenariosFromText(fullText);
  for (const sub of issue.subtasks) rawScenarios.push(`Verify: ${sub.summary}`);
  return {
    scenarioGroups: groupScenarios(rawScenarios, issue), complexity,
    suggestedTypes: [...new Set(suggestedTypes)],
    keywords: [...UI_KW, ...API_KW, ...SEC_KW, ...PERF_KW].filter((k) => low.includes(k)),
    derivedPreconditions: derivePreconditions(issue),
    roles: extractRoles(fullText),
    environments: extractEnvironments(fullText),
  };
}

// Made with Bob
