// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — AI Analyzer
//  Derives test scenarios from JIRA issues following the guiderails in
//  .bob/rules/TEST_CASE_GENERATION_GUIDE.md:
//
//  Categories: Functional | Negative | Integration | Performance |
//              Security | Accessibility | Documentation | Regression
//
//  Scenario sources:
//    a) "What?" requirements → Functional
//    b) "Why?" side-effects  → Functional + cross-browser / incognito
//    c) Fallback chain       → Negative + error-handling
//    d) Feature flags        → dual-mode (on/off)
//    e) Migration paths      → pre/during/post/cleanup
//    f) Linked issues        → Regression
//    g) Performance hints    → Performance
//    h) Security hints       → Security
//    i) Accessibility hints  → Accessibility
//    j) TODO / comments      → Documentation
//    k) Repo file content    → targeted code-aware scenarios
// ─────────────────────────────────────────────────────────────────────────────

import { IssueAnalysis, JiraIssue, RepoContext, ScenarioGroup, TestType } from './types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Keyword banks ────────────────────────────────────────────────────────────

const API_KW    = ['api','rest','graphql','endpoint','payload','request','response','webhook','service','integration','sync','async','socket','grpc','fetch','http'];
const SEC_KW    = ['security','auth','authentication','authorization','permission','role','rbac','token','jwt','oauth','sso','saml','mfa','encrypt','decrypt','xss','csrf','injection','privilege','https','privacy','pii'];
const PERF_KW   = ['performance','load','stress','spike','latency','throughput','response time','concurrent','scalab','benchmark','timeout','p95','p99','ms','millisecond'];
const A11Y_KW   = ['accessibility','aria','wcag','keyboard','screen reader','nvda','jaws','voiceover','tab order','focus','contrast','alt text','a11y'];
const DOC_KW    = ['todo','fixme','comment','readme','documentation','doc','changelog','deprecat','note:','// '];
const FLAG_KW   = ['feature flag','feature toggle','flag','toggle','enabled','disabled','config flag','featureflag'];
const MIGRATE_KW= ['migration','migrate','migrat','localStorage','local storage','legacy','old format','new format','backward compat','data cleanup','cleanup'];
const NEG_KW    = ['invalid','error','fail','exception','reject','unauthori','missing','empty','boundary','null','undefined','overflow','timeout','400','401','403','404','500','network error'];

// ─── Complexity ───────────────────────────────────────────────────────────────

const C_HIGH = ['migration','complex','multiple systems','third-party','legacy',...SEC_KW,...PERF_KW,...API_KW];
const C_MED  = ['workflow','process','validation','database','db','crud','localStorage','preference','store','setting'];

// ─── Role / env extractors ────────────────────────────────────────────────────

const ROLE_RE = [/\b(admin(?:istrator)?)\b/gi,/\b(user)\b/gi,/\b(viewer)\b/gi,/\b(owner)\b/gi,/\b(manager)\b/gi,/\b(operator)\b/gi,/\b(editor)\b/gi,/\b(guest)\b/gi];
const ENV_RE  = [/\b(dev(?:elop(?:ment)?)?)\b/gi,/\b(test(?:ing)?)\b/gi,/\b(staging)\b/gi,/\b(prod(?:uction)?)\b/gi,/\b(qa)\b/gi,/\b(uat)\b/gi,/\b(pre-?prod)\b/gi];

function extractRoles(text: string): string[] {
  const found = new Set<string>();
  for (const p of ROLE_RE) { const re = new RegExp(p.source, p.flags); let m; while ((m = re.exec(text)) !== null) found.add(m[1] ?? m[0]); }
  return [...found].slice(0, 10);
}

function extractEnvironments(text: string): string[] {
  const found = new Set<string>();
  for (const p of ENV_RE) { const re = new RegExp(p.source, p.flags); let m; while ((m = re.exec(text)) !== null) found.add(m[0].toLowerCase()); }
  return [...found];
}

// ─── Scenario extraction ──────────────────────────────────────────────────────

/**
 * Extract clean "Verify <subject> — <condition>" scenario titles from issue text.
 *
 * Rules (from TEST_CASE_GENERATION_GUIDE.md §4 Naming + §6 Test Step Quality):
 *   - Never use raw Jira bullet text as a title — always synthesise a scenario name.
 *   - BDD Given/When/Then clauses are converted to "Verify …" form.
 *   - "verify / ensure / validate / check" assertions are kept as-is (they already
 *     start with an action verb).
 *   - Raw bullets that contain NOTE / see / refer / http links are discarded —
 *     they are implementation notes, not test scenarios.
 *   - Short fragments (<15 chars) are discarded.
 *   - Max 50 scenarios returned (deduped).
 */
function extractFromText(text: string): string[] {
  if (!text) return [];
  const NOTE_RE = /^(note|see|refer|http|fyi|e\.g|i\.e)/i;
  const JUNK_RE = /[<>{}[\]\\|`]/;  // raw code / HTML fragments — not useful as titles

  const s: string[] = [];

  // BDD clauses → convert to "Verify …" form
  for (const bdd of text.match(/(?:When|Then)\s+[^\n.]{15,}[.\n]/gi) ?? []) {
    const clean = bdd.replace(/^(When|Then)\s+/i, 'Verify ').replace(/[.\n]+$/, '').trim();
    if (!NOTE_RE.test(clean) && !JUNK_RE.test(clean)) s.push(clean);
  }

  // Existing "verify/validate/ensure/check/confirm" assertions — keep as-is
  for (const a of text.match(/(?:verify|ensure|validate|check|confirm|assert)\s+[^.;\n]{15,}/gi) ?? []) {
    const clean = a.trim().replace(/[.\n]+$/, '');
    if (!NOTE_RE.test(clean) && !JUNK_RE.test(clean)) s.push(clean);
  }

  // Bullet / numbered list items — synthesise into "Verify <subject>" titles
  for (const item of text.match(/^[\s]*[-•*\d.]+\s+(.+)/gm) ?? []) {
    const raw = item.replace(/^[\s\-•*\d.]+/, '').trim();
    // Discard: too short, looks like a note/link, or contains junk chars
    if (raw.length < 15 || NOTE_RE.test(raw) || JUNK_RE.test(raw)) continue;
    // If it already starts with a verb, keep it; otherwise prefix "Verify "
    const startsWithVerb = /^(verify|validate|ensure|check|confirm|test|assert|should|the system|user can|user should)/i.test(raw);
    const title = startsWithVerb ? raw : `Verify ${raw}`;
    s.push(title);
  }

  return [...new Set(s)].slice(0, 50);
}

/** Derive standard preconditions from the issue */
export function derivePreconditions(issue: JiraIssue, repoContext?: RepoContext): string[] {
  const pre = ['User is logged into the application'];
  const t = `${issue.description} ${issue.acceptanceCriteria}`.toLowerCase();
  if (t.match(/role|permission|admin/)) pre.push('User has the required role/permission assigned');
  if (t.match(/api|endpoint|service/)) pre.push('All dependent APIs and services are available');
  if (issue.components.length) pre.push(`${issue.components.join(', ')} component(s) are deployed`);
  if (issue.linkedIssues.length) pre.push('Related dependent issues are resolved');
  pre.push('Test environment is configured and accessible');
  // Guiderail: list repos and any specific files found so testers can trace the implementation
  if (repoContext) {
    for (const repo of repoContext.repos) pre.push(`Code repository reviewed: ${repo}`);
    for (const f of repoContext.files) pre.push(`Relevant file: ${f.repo}/${f.path} (${f.url})`);
  }
  return pre;
}

// ─── Category assignment ──────────────────────────────────────────────────────

function assignCategory(scenario: string, type: TestType): string {
  const l = scenario.toLowerCase();
  if (type === 'Security')       return 'Security';
  if (type === 'Performance')    return 'Performance';
  if (type === 'Accessibility')  return 'Accessibility';
  if (type === 'Documentation')  return 'Documentation';
  if (type === 'Regression')     return 'Regression';
  if (type === 'Integration')    return 'API / Integration';
  if (type === 'Negative')       return 'Negative / Error Handling';
  if (l.match(/login|logout|sign.?in|session/)) return 'Authentication';
  if (l.match(/permission|role|access|rbac/))   return 'Permissions & Roles';
  if (l.match(/flag|toggle|feature/))           return 'Feature Flags';
  if (l.match(/migrat|localStorage|cleanup/))   return 'Migration';
  if (l.match(/browser|incognito|private|safari|chrome|firefox/)) return 'Cross-Browser';
  if (l.match(/concurrent|session|isolat/))     return 'Concurrency & Isolation';
  return 'Functional';
}

// ─── Scenario group builder ───────────────────────────────────────────────────

function buildScenarioGroups(issue: JiraIssue, repoContext?: RepoContext): ScenarioGroup[] {
  const groups = new Map<string, { type: TestType; scenarios: string[] }>();

  const add = (cat: string, type: TestType, scenario: string) => {
    if (!groups.has(cat)) groups.set(cat, { type, scenarios: [] });
    groups.get(cat)!.scenarios.push(scenario);
  };

  const fullText = `${issue.summary}\n${issue.description}\n${issue.acceptanceCriteria}`;
  const low = fullText.toLowerCase();
  const raw = extractFromText(fullText);

  // Detect roles so we can fan out per-role Functional tests (guiderail §3e)
  const roles = extractRoles(fullText);

  // ── a) What? requirements → Functional ──────────────────────────────────
  add('Functional', 'Functional', `Verify ${issue.summary} — Happy Path`);
  add('Functional', 'Functional', `Verify ${issue.summary} with valid inputs and expected state`);

  // Role fan-out: one Functional TC per detected role for visibility/access tests
  if (roles.length > 0) {
    for (const role of roles) {
      add('Functional', 'Functional', `Verify ${issue.summary} — ${cap(role)} role`);
    }
  }

  for (const s of raw) {
    if (!NEG_KW.some(k => s.toLowerCase().includes(k))) {
      const cat = assignCategory(s, 'Functional');
      add(cat, 'Functional', s);
    }
  }

  // ── b) Cross-browser / incognito (from "Why?" section) ───────────────────
  if (low.match(/browser|preference|storage|session|localStorage/)) {
    add('Cross-Browser', 'Functional', `Verify ${issue.summary} works correctly in Chrome`);
    add('Cross-Browser', 'Functional', `Verify ${issue.summary} works correctly in Firefox`);
    add('Cross-Browser', 'Functional', `Verify ${issue.summary} works correctly in Safari`);
    add('Cross-Browser', 'Functional', `Verify ${issue.summary} behaves correctly in incognito/private-browsing mode`);
  }

  // ── c) Fallback chain → Negative + Error Handling ────────────────────────
  add('Negative / Error Handling', 'Negative', `Verify ${issue.summary} with invalid/empty input — error message is displayed`);
  add('Negative / Error Handling', 'Negative', `Verify ${issue.summary} handles API 500 error gracefully`);
  add('Negative / Error Handling', 'Negative', `Verify ${issue.summary} handles network timeout gracefully`);
  add('Negative / Error Handling', 'Negative', `Verify ${issue.summary} handles HTTP 401 (unauthorised) correctly`);
  if (low.match(/localStorage|store|storage/)) {
    add('Negative / Error Handling', 'Negative', `Verify fallback to defaults when personalization store returns empty response`);
    add('Negative / Error Handling', 'Negative', `Verify fallback to localStorage when personalization store API is unavailable`);
  }
  for (const s of raw) {
    if (NEG_KW.some(k => s.toLowerCase().includes(k))) {
      add('Negative / Error Handling', 'Negative', s);
    }
  }

  // ── d) Feature flags → dual-mode ─────────────────────────────────────────
  if (FLAG_KW.some(k => low.includes(k))) {
    add('Feature Flags', 'Functional', `Verify feature behaves correctly when feature flag is ENABLED`);
    add('Feature Flags', 'Functional', `Verify feature behaves correctly when feature flag is DISABLED`);
    add('Feature Flags', 'Functional', `Verify rollback: disable feature flag reverts to previous behaviour`);
  }

  // ── e) Migration paths ───────────────────────────────────────────────────
  if (MIGRATE_KW.some(k => low.includes(k))) {
    add('Migration', 'Integration', `Verify user preference migration from localStorage to personalization store — happy path`);
    add('Migration', 'Integration', `Verify migration when only localStorage data exists (no store data)`);
    add('Migration', 'Integration', `Verify migration when only store data exists (no localStorage data)`);
    add('Migration', 'Integration', `Verify migration when both localStorage and store data exist — store takes precedence`);
    add('Migration', 'Integration', `Verify migration when neither localStorage nor store data exists — defaults applied`);
    add('Migration', 'Integration', `Verify localStorage data is cleaned up after successful migration to store`);
    add('Migration', 'Integration', `Verify partial migration scenario — some preferences migrated, some not`);
  }

  // ── f) Linked issues → Regression ────────────────────────────────────────
  for (const li of issue.linkedIssues) {
    add('Regression', 'Regression', `Verify existing functionality for ${li.key} (${li.summary}) is not broken`);
  }
  for (const sub of issue.subtasks) {
    add('Regression', 'Regression', `Verify: ${sub.summary}`);
  }
  add('Regression', 'Regression', `Verify ${issue.summary} does not break existing user flows`);
  add('Regression', 'Regression', `Verify smoke test suite passes after ${issue.key} changes are deployed`);

  // ── g) Performance ───────────────────────────────────────────────────────
  if (PERF_KW.some(k => low.includes(k)) || low.match(/api|store|fetch|load/)) {
    add('Performance', 'Performance', `Verify ${issue.summary} API response time is under 2 seconds under normal load`);
    add('Performance', 'Performance', `Verify ${issue.summary} with 50 concurrent users — P95 response time < 5s`);
    add('Performance', 'Performance', `Verify personalization store API response time < 500ms`);
  }

  // ── h) Security ──────────────────────────────────────────────────────────
  if (SEC_KW.some(k => low.includes(k)) || low.match(/auth|token|https|data|user/)) {
    add('Security', 'Security', `Verify unauthenticated user cannot access ${issue.summary} — HTTP 401 returned`);
    add('Security', 'Security', `Verify user with insufficient permissions is denied — HTTP 403 returned`);
    add('Security', 'Security', `Verify expired token is rejected and user is prompted to re-authenticate`);
    add('Security', 'Security', `Verify User A's preferences are not visible to User B (data isolation)`);
    add('Security', 'Security', `Verify all API calls use HTTPS — no plain HTTP traffic`);
    add('Security', 'Security', `Verify sensitive user preference data is not logged in plain text`);
  }

  // ── i) Accessibility ─────────────────────────────────────────────────────
  if (A11Y_KW.some(k => low.includes(k)) || low.match(/ui|page|form|button|input|display/)) {
    add('Accessibility', 'Accessibility', `Verify ${issue.summary} UI is fully navigable by keyboard only`);
    add('Accessibility', 'Accessibility', `Verify screen reader (NVDA/VoiceOver) correctly announces state changes`);
    add('Accessibility', 'Accessibility', `Verify all interactive elements have correct ARIA labels`);
    add('Accessibility', 'Accessibility', `Verify colour contrast meets WCAG 2.1 AA (4.5:1 ratio)`);
  }

  // ── j) Documentation / code quality ─────────────────────────────────────
  if (DOC_KW.some(k => low.includes(k)) || low.match(/todo|comment|deprecated|readme/)) {
    add('Documentation', 'Documentation', `Verify TODO comments related to ${issue.key} are resolved in the codebase`);
    add('Documentation', 'Documentation', `Verify deprecated API / localStorage references are removed from code`);
    add('Documentation', 'Documentation', `Verify README / inline documentation reflects the new personalization store approach`);
  }

  // ── k) Repo file content → targeted code-aware scenarios ─────────────────
  if (repoContext && repoContext.files.length > 0) {
    for (const f of repoContext.files) {
      const fileLow = f.snippet.toLowerCase();
      // Any file that changed → regression scenario
      add('Regression', 'Regression', `Verify [${f.repo}] ${f.path} — no regression after ${issue.key} changes`);
      // Files with route/component/controller names → functional scenario
      if (fileLow.match(/route|controller|component|handler|endpoint/)) {
        add('Functional', 'Functional', `Verify ${f.path} behaviour after ${issue.key} changes — Happy Path`);
      }
      // Files with auth/permission → security scenario
      if (fileLow.match(/auth|permission|role|token|jwt/)) {
        add('Security', 'Security', `Verify ${f.path} enforces correct auth/permission checks after ${issue.key} changes`);
      }
      // Files with test patterns → documentation check
      if (fileLow.match(/todo|fixme|deprecated/)) {
        add('Documentation', 'Documentation', `Verify TODO/FIXME in ${f.repo}/${f.path} are resolved for ${issue.key}`);
      }
    }
  }

  // Convert to ScenarioGroup[]
  return [...groups.entries()].map(([category, { scenarios }]) => ({
    category,
    scenarios: [...new Set(scenarios)],  // deduplicate
  }));
}

// ─── Main analyser ────────────────────────────────────────────────────────────

export function analyseIssue(issue: JiraIssue, repoContext?: RepoContext): IssueAnalysis {
  const fullText = `${issue.summary}\n${issue.description}\n${issue.acceptanceCriteria}`;
  const low = fullText.toLowerCase();

  const complexity: 'Low' | 'Medium' | 'High' =
    C_HIGH.some(k => low.includes(k)) ? 'High' :
    C_MED.some(k => low.includes(k))  ? 'Medium' : 'Low';

  const suggestedTypes: TestType[] = ['Functional', 'Negative', 'Regression'];
  if (API_KW.some(k => low.includes(k)) || low.match(/store|fetch|sync/)) suggestedTypes.push('Integration');
  if (SEC_KW.some(k => low.includes(k)) || low.match(/auth|token|user/))  suggestedTypes.push('Security');
  if (PERF_KW.some(k => low.includes(k)) || low.match(/api|load|response/)) suggestedTypes.push('Performance');
  if (A11Y_KW.some(k => low.includes(k)) || low.match(/ui|page|form|button/)) suggestedTypes.push('Accessibility');
  if (DOC_KW.some(k => low.includes(k)) || low.match(/todo|deprecated/))   suggestedTypes.push('Documentation');

  // Enrich scenario groups with repo file content if available
  const scenarioGroups = buildScenarioGroups(issue, repoContext);

  return {
    scenarioGroups,
    complexity,
    suggestedTypes: [...new Set(suggestedTypes)],
    keywords: [...API_KW, ...SEC_KW, ...PERF_KW, ...A11Y_KW].filter(k => low.includes(k)),
    derivedPreconditions: derivePreconditions(issue, repoContext),
    roles: extractRoles(fullText),
    environments: extractEnvironments(fullText),
  };
}

export { extractFromText as extractScenariosFromText };

// Made with Bob
