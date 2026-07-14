// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Type definitions
// ─────────────────────────────────────────────────────────────────────────────

export type OutputFormat = 'markdown' | 'csv' | 'json' | 'playwright';
export type TestPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type TestType =
  | 'Functional'
  | 'UI'
  | 'Integration'
  | 'Regression'
  | 'Smoke'
  | 'Negative'
  | 'Security'
  | 'Performance';

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

// Made with Bob
