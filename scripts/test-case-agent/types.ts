// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Type definitions
// ─────────────────────────────────────────────────────────────────────────────

export type OutputFormat = 'markdown' | 'csv' | 'json' | 'playwright' | 'xlsx';
export type TestPriority = 'Critical' | 'High' | 'Medium' | 'Low';

/** A single file read from a code repository */
export interface RepoFile {
  repo: string;       // e.g. "hybrid-ipaas-ui"
  path: string;       // e.g. "src/components/AppSwitcher.tsx"
  url: string;        // GitHub html_url
  snippet: string;    // first 2000 chars of file content
}

/** Aggregated context read from repos before test case generation */
export interface RepoContext {
  repos: string[];          // repo names that were checked
  files: RepoFile[];        // changed/relevant files found
  summary: string;          // human-readable summary for logs
}
export type TestType =
  | 'Functional'
  | 'Negative'
  | 'Integration'
  | 'Performance'
  | 'Security'
  | 'Accessibility'
  | 'Documentation'
  | 'Regression';

export interface TestStep {
  stepNumber: number;
  action: string;
  expectedResult: string;
  testData?: string;
}

export interface TestCase {
  id: string;
  title: string;
  priority: TestPriority;
  type: TestType;
  category?: string;
  preconditions: string[];
  testSteps: TestStep[];
  expectedResult: string;
  testData?: string[];
  notes?: string;
  automatable?: boolean;
  playwrightHint?: string;
}

export interface AdfContent {
  type: string;
  text?: string;
  content?: AdfContent[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface AdfDoc {
  version: number;
  type: 'doc';
  content: AdfContent[];
}

export interface LinkedIssue {
  key: string;
  summary: string;
  type: string;
  linkType: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  descriptionAdf?: AdfDoc;
  issueType: string;
  priority: string;
  status: string;
  assignee?: string;
  reporter?: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  sprint?: string;
  epicKey?: string;
  epicSummary?: string;
  acceptanceCriteria: string;
  linkedIssues: LinkedIssue[];
  subtasks: Array<{ key: string; summary: string }>;
  attachmentNames: string[];
  rawFields: Record<string, unknown>;
}

export interface ScenarioGroup {
  category: string;
  scenarios: string[];
}

export interface IssueAnalysis {
  scenarioGroups: ScenarioGroup[];
  complexity: 'Low' | 'Medium' | 'High';
  suggestedTypes: TestType[];
  keywords: string[];
  derivedPreconditions: string[];
  roles: string[];
  environments: string[];
}

export interface GeneratorOptions {
  issueKey: string;
  format: OutputFormat;
  outputPath?: string;
  detailed: boolean;
  withPlaywright: boolean;
}

export interface RepoConfig {
  id: string;
  name: string;
  url: string;
  description?: string;
}

export interface WorkflowConfig {
  jira: {
    baseUrl: string;
    username: string;
    apiToken: string;
  };
  repos: RepoConfig[];
  workflow: {
    outputDir: string;
    subtaskSummaryTemplate: string;
    subtaskDescription: string;
    commentTemplate: string;
    defaultFormat: OutputFormat;
    detailed: boolean;
    doneTransitionName?: string;
  };
}

export interface WorkflowResult {
  issueKey: string;
  csvPath: string;
  testCaseCount: number;
  subtaskKey: string;
  complexity: string;
  types: string[];
}

// Made with Bob
