// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — JIRA Actions
//  REST API helpers: create subtask, attach file, add comment, get transitions
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';

export interface JiraCredentials {
  baseUrl: string;
  username: string;
  apiToken: string;
}

function authHeader(creds: JiraCredentials): string {
  return 'Basic ' + Buffer.from(`${creds.username}:${creds.apiToken}`).toString('base64');
}

async function jiraRequest<T>(
  creds: JiraCredentials,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<T> {
  const url = `${creds.baseUrl}/rest/api/3${urlPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(creds),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`JIRA ${method} ${urlPath} → HTTP ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

/** Resolve the project key from an issue key (e.g. "SCI-17066" → "SCI") */
function projectKey(issueKey: string): string {
  return issueKey.split('-')[0];
}

/** Get the issue type ID for "Sub-task" in a project */
async function getSubtaskTypeId(creds: JiraCredentials, projKey: string): Promise<string> {
  const data = await jiraRequest<{ issueTypes: Array<{ id: string; name: string; subtask: boolean }> }>(
    creds,
    'GET',
    `/project/${projKey}`,
  );
  const st = data.issueTypes.find((t) => t.subtask);
  if (!st) throw new Error(`No sub-task issue type found in project ${projKey}`);
  return st.id;
}

/** Create a sub-task under parentIssueKey and return the new issue key */
export async function createSubtask(
  creds: JiraCredentials,
  parentIssueKey: string,
  summary: string,
  description: string,
  assigneeEmail?: string,
): Promise<string> {
  const proj = projectKey(parentIssueKey);
  const subtaskTypeId = await getSubtaskTypeId(creds, proj);
  const body = {
    fields: {
      project: { key: proj },
      parent: { key: parentIssueKey },
      issuetype: { id: subtaskTypeId },
      summary,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
      },
      ...(assigneeEmail ? { assignee: { name: assigneeEmail } } : {}),
    },
  };
  const res = await jiraRequest<{ key: string }>(creds, 'POST', '/issue', body);
  return res.key;
}

/** Attach a local file to a JIRA issue. Returns the attachment metadata. */
export async function attachFile(
  creds: JiraCredentials,
  issueKey: string,
  filePath: string,
): Promise<{ id: string; filename: string; size: number }> {
  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  // JIRA attachment upload requires multipart/form-data
  const boundary = `----FormBoundary${Date.now().toString(16)}`;
  const NL = '\r\n';
  const header =
    `--${boundary}${NL}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${NL}` +
    `Content-Type: application/octet-stream${NL}${NL}`;
  const footer = `${NL}--${boundary}--${NL}`;

  const body = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    fileBuffer,
    Buffer.from(footer, 'utf-8'),
  ]);

  const url = `${creds.baseUrl}/rest/api/3/issue/${issueKey}/attachments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(creds),
      Accept: 'application/json',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'X-Atlassian-Token': 'no-check',
    },
    body: body,
  });
  if (!res.ok) throw new Error(`Attach file → HTTP ${res.status}: ${await res.text()}`);
  const attachments = (await res.json()) as Array<{ id: string; filename: string; size: number }>;
  return attachments[0];
}

/** Add a plain-text comment (rendered as ADF paragraph) to an issue */
export async function addComment(
  creds: JiraCredentials,
  issueKey: string,
  text: string,
): Promise<void> {
  const body = {
    body: {
      type: 'doc',
      version: 1,
      content: text.split('\n').map((line) =>
        line.trim() === ''
          ? { type: 'paragraph', content: [] }
          : { type: 'paragraph', content: [{ type: 'text', text: line }] },
      ),
    },
  };
  await jiraRequest<void>(creds, 'POST', `/issue/${issueKey}/comment`, body);
}

/** Get available transitions for an issue */
export async function getTransitions(
  creds: JiraCredentials,
  issueKey: string,
): Promise<Array<{ id: string; name: string }>> {
  const data = await jiraRequest<{ transitions: Array<{ id: string; name: string }> }>(
    creds,
    'GET',
    `/issue/${issueKey}/transitions`,
  );
  return data.transitions;
}

/** Transition an issue to a new status by status name (case-insensitive) */
export async function transitionIssue(
  creds: JiraCredentials,
  issueKey: string,
  targetStatusName: string,
): Promise<void> {
  const transitions = await getTransitions(creds, issueKey);
  const t = transitions.find((x) => x.name.toLowerCase() === targetStatusName.toLowerCase());
  if (!t) {
    const available = transitions.map((x) => x.name).join(', ');
    throw new Error(`Transition "${targetStatusName}" not found. Available: ${available}`);
  }
  await jiraRequest<void>(creds, 'POST', `/issue/${issueKey}/transitions`, { transition: { id: t.id } });
}

/** Build a JIRA browse URL for an issue */
export function browseUrl(baseUrl: string, issueKey: string): string {
  return `${baseUrl}/browse/${issueKey}`;
}

/**
 * Search for a child issue under a parent that matches a summary keyword and
 * optional issue type (case-insensitive substring match on summary).
 * Returns the first matching issue key, or null if none found.
 */
export async function findChildIssue(
  creds: JiraCredentials,
  parentKey: string,
  summaryKeyword: string,
  issueType?: string,
): Promise<{ key: string; summary: string; status: string } | null> {
  const typeClause = issueType ? ` AND issuetype = "${issueType}"` : '';
  const jql = `parent = "${parentKey}"${typeClause} ORDER BY created DESC`;
  const data = await jiraRequest<{
    issues: Array<{ key: string; fields: { summary: string; status: { name: string } } }>;
  }>(creds, 'GET', `/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status&maxResults=50`);

  const keyword = summaryKeyword.toLowerCase();
  const match = data.issues.find((i) => i.fields.summary.toLowerCase().includes(keyword));
  if (!match) return null;
  return { key: match.key, summary: match.fields.summary, status: match.fields.status.name };
}

/**
 * Create a Story (or Task) issue as a child of a parent Epic/Story.
 * Uses the non-subtask issue type that best matches `preferredType` name.
 * Falls back to "Story" → "Task" → first available non-subtask type.
 */
export async function createChildIssue(
  creds: JiraCredentials,
  parentKey: string,
  summary: string,
  description: string,
  preferredType = 'Story',
): Promise<string> {
  const proj = projectKey(parentKey);
  const projData = await jiraRequest<{
    issueTypes: Array<{ id: string; name: string; subtask: boolean }>;
  }>(creds, 'GET', `/project/${proj}`);

  const nonSubtasks = projData.issueTypes.filter((t) => !t.subtask);
  const type =
    nonSubtasks.find((t) => t.name.toLowerCase() === preferredType.toLowerCase()) ??
    nonSubtasks.find((t) => t.name.toLowerCase() === 'story') ??
    nonSubtasks.find((t) => t.name.toLowerCase() === 'task') ??
    nonSubtasks[0];

  if (!type) throw new Error(`No non-subtask issue type found in project ${proj}`);

  const body = {
    fields: {
      project: { key: proj },
      parent: { key: parentKey },
      issuetype: { id: type.id },
      summary,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
      },
    },
  };
  const res = await jiraRequest<{ key: string }>(creds, 'POST', '/issue', body);
  return res.key;
}

// Made with Bob
