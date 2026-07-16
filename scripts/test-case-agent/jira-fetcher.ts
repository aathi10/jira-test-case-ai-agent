// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — JIRA Fetcher
//  Fetches + normalises JIRA issue data including:
//    - Issue description, summary, AC, labels, components, linked issues
//    - All comments + replies (parsed from ADF)
//    - Child issues / subtasks with their own descriptions + AC
// ─────────────────────────────────────────────────────────────────────────────

import { AdfContent, AdfDoc, JiraChildIssue, JiraComment, JiraIssue, LinkedIssue } from './types';

export function adfToText(node: AdfContent | AdfDoc, indent = 0): string {
  if (!node) return '';
  const prefix = '  '.repeat(indent);
  switch (node.type) {
    case 'doc': case 'blockquote':
      return (node.content ?? []).map((c) => adfToText(c, indent)).join('\n');
    case 'paragraph':
      return prefix + (node.content ?? []).map((c) => adfToText(c)).join('') + '\n';
    case 'heading': {
      const level = (node.attrs as { level?: number })?.level ?? 1;
      const text = (node.content ?? []).map((c) => adfToText(c)).join('');
      return '#'.repeat(level) + ' ' + text + '\n';
    }
    case 'bulletList': case 'orderedList':
      return (node.content ?? []).map((li, i) => {
        const bullet = node.type === 'orderedList' ? `${i + 1}.` : '-';
        const inner = (li.content ?? []).map((c) => adfToText(c, 0)).join('').trim();
        return `${prefix}${bullet} ${inner}`;
      }).join('\n') + '\n';
    case 'listItem':
      return (node.content ?? []).map((c) => adfToText(c, indent)).join('');
    case 'codeBlock':
      return '```\n' + (node.content ?? []).map((c) => adfToText(c)).join('') + '```\n';
    case 'text': return node.text ?? '';
    case 'hardBreak': return '\n';
    case 'rule': return '---\n';
    case 'mention': return `@${(node.attrs as { text?: string })?.text ?? 'user'}`;
    default: return (node.content ?? []).map((c) => adfToText(c)).join('');
  }
}

const AC_PATTERNS = [
  /acceptance criteria[:\s]+([\s\S]*?)(?=\n(?:#|\*\*|##|$))/i,
  /\bac\b[:\s]+([\s\S]*?)(?=\n(?:#|\*\*|##|$))/i,
  /given\s+.+?\s+when\s+.+?\s+then\s+[\s\S]*?(?=\n\n|$)/i,
  /criteria[:\s]+([\s\S]*?)(?=\n(?:#|\*\*|##|$))/i,
];

export function extractAcceptanceCriteria(text: string): string {
  if (!text) return '';
  for (const pattern of AC_PATTERNS) {
    const m = text.match(pattern);
    if (m) return (m[1] || m[0]).trim().slice(0, 2000);
  }
  return '';
}

export function normaliseJiraResponse(raw: Record<string, unknown>): JiraIssue {
  const f = (raw.fields as Record<string, unknown>) ?? {};
  let description = '';
  let descriptionAdf: AdfDoc | undefined;
  if (f.description && typeof f.description === 'object') {
    descriptionAdf = f.description as AdfDoc;
    description = adfToText(descriptionAdf).trim();
  } else if (typeof f.description === 'string') {
    description = (f.description as string).trim();
  }
  const priorityRaw = f.priority as { name?: string } | undefined;
  const statusRaw = f.status as { name?: string } | undefined;
  const assigneeRaw = f.assignee as { displayName?: string } | undefined;
  const reporterRaw = f.reporter as { displayName?: string } | undefined;
  const components = ((f.components ?? []) as Array<{ name: string }>).map((c) => c.name);
  const labels = (f.labels as string[]) ?? [];
  const fixVersions = ((f.fixVersions ?? []) as Array<{ name: string }>).map((v) => v.name);
  let sprint: string | undefined;
  for (const key of Object.keys(f)) {
    const val = f[key];
    if (key.startsWith('customfield_') && Array.isArray(val) && val.length > 0) {
      const first = (val as Record<string, unknown>[])[0];
      if (typeof first?.name === 'string' && first.name.toLowerCase().includes('sprint')) { sprint = first.name; break; }
    }
  }
  let epicKey: string | undefined;
  const epLink = f['customfield_10014'] ?? f['customfield_10008'];
  if (typeof epLink === 'string') epicKey = epLink;
  const linkedIssues: LinkedIssue[] = ((f.issuelinks ?? []) as Array<Record<string, unknown>>)
    .map((link) => {
      const linkTypeName = (link.type as { name?: string })?.name ?? 'relates to';
      if (link.outwardIssue) { const oi = link.outwardIssue as Record<string, unknown>; return { key: oi.key as string, summary: ((oi.fields as Record<string, unknown>)?.summary as string) ?? '', type: ((oi.fields as Record<string, unknown>)?.issuetype as { name: string })?.name ?? '', linkType: linkTypeName }; }
      if (link.inwardIssue) { const ii = link.inwardIssue as Record<string, unknown>; return { key: ii.key as string, summary: ((ii.fields as Record<string, unknown>)?.summary as string) ?? '', type: ((ii.fields as Record<string, unknown>)?.issuetype as { name: string })?.name ?? '', linkType: linkTypeName }; }
      return null;
    }).filter(Boolean) as LinkedIssue[];
  const subtasks = ((f.subtasks ?? []) as Array<Record<string, unknown>>).map((s) => ({ key: s.key as string, summary: ((s.fields as Record<string, unknown>)?.summary as string) ?? '' }));
  const attachmentNames = ((f.attachment ?? []) as Array<{ filename: string }>).map((a) => a.filename);
  // Expand Jira template placeholders to readable names so they don't bleed into TC titles
  const rawSummary = (f.summary as string) ?? '';
  const summary = rawSummary
    .replace(/\{envName\}/g, 'environmentName')
    .replace(/\{env\}/g, 'environmentName')
    .replace(/\{product\}/g, 'productName')
    .replace(/\{realm\}/g, 'realmName')
    .replace(/\{tenant\}/g, 'tenantName')
    .replace(/\{region\}/g, 'regionName');

  // Parse inline comments from fields (populated by fetchFromRestApi enrichment)
  const comments: JiraComment[] = ((f._comments ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: c.id as string,
    author: (c.author as { displayName?: string })?.displayName ?? 'Unknown',
    body: typeof c.body === 'object' ? adfToText(c.body as AdfDoc).trim() : (c.body as string) ?? '',
    created: c.created as string,
  }));

  return {
    key: raw.key as string, summary, description, descriptionAdf,
    issueType: ((f.issuetype as { name?: string })?.name) ?? 'Unknown',
    priority: priorityRaw?.name ?? 'Medium', status: statusRaw?.name ?? 'Unknown',
    assignee: assigneeRaw?.displayName, reporter: reporterRaw?.displayName,
    labels, components, fixVersions, sprint, epicKey, epicSummary: undefined,
    acceptanceCriteria: extractAcceptanceCriteria(description),
    linkedIssues, subtasks, attachmentNames, rawFields: f,
    comments,
    childIssues: [],  // populated by fetchFromRestApi after the main issue fetch
  };
}

// ─── REST helpers ─────────────────────────────────────────────────────────────

function makeAuth(username: string, token: string) {
  const auth = Buffer.from(`${username}:${token}`).toString('base64');
  return { Authorization: `Basic ${auth}`, Accept: 'application/json' };
}

/** Fetch all comments on an issue (handles pagination) */
async function fetchComments(
  baseUrl: string,
  headers: Record<string, string>,
  issueKey: string,
): Promise<JiraComment[]> {
  const comments: JiraComment[] = [];
  let startAt = 0;
  const maxResults = 50;
  while (true) {
    const url = `${baseUrl}/rest/api/3/issue/${issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}&orderBy=created`;
    const res = await fetch(url, { headers });
    if (!res.ok) break;
    const data = await res.json() as { comments?: Array<Record<string, unknown>>; total?: number };
    const batch = data.comments ?? [];
    for (const c of batch) {
      const body = typeof c.body === 'object'
        ? adfToText(c.body as AdfDoc).trim()
        : (c.body as string) ?? '';
      comments.push({
        id: c.id as string,
        author: (c.author as { displayName?: string })?.displayName ?? 'Unknown',
        body,
        created: c.created as string,
      });
    }
    startAt += batch.length;
    if (startAt >= (data.total ?? 0) || batch.length < maxResults) break;
  }
  return comments;
}

/** Fetch a single child issue with its description and AC */
async function fetchChildIssue(
  baseUrl: string,
  headers: Record<string, string>,
  issueKey: string,
): Promise<JiraChildIssue | null> {
  try {
    const res = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}?fields=summary,description,issuetype,status`, { headers });
    if (!res.ok) return null;
    const raw = await res.json() as Record<string, unknown>;
    const f = (raw.fields as Record<string, unknown>) ?? {};
    let desc = '';
    if (f.description && typeof f.description === 'object') desc = adfToText(f.description as AdfDoc).trim();
    else if (typeof f.description === 'string') desc = (f.description as string).trim();
    return {
      key: raw.key as string,
      summary: (f.summary as string) ?? '',
      issueType: ((f.issuetype as { name?: string })?.name) ?? 'Unknown',
      status: ((f.status as { name?: string })?.name) ?? 'Unknown',
      description: desc,
      acceptanceCriteria: extractAcceptanceCriteria(desc),
    };
  } catch { return null; }
}

export async function fetchFromRestApi(issueKey: string): Promise<JiraIssue> {
  const baseUrl = process.env.JIRA_BASE_URL ?? 'https://ibm-middleware.atlassian.net';
  const username = process.env.JIRA_USERNAME ?? process.env.JIRA_EMAIL ?? '';
  const token = process.env.JIRA_API_TOKEN ?? '';
  if (!username || !token) throw new Error('JIRA_USERNAME and JIRA_API_TOKEN env vars are required.');
  const headers = makeAuth(username, token);

  // 1. Fetch main issue (all fields)
  const resp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}?fields=*all`, { headers });
  if (!resp.ok) throw new Error(`JIRA REST API error ${resp.status}: ${await resp.text()}`);
  const issue = normaliseJiraResponse((await resp.json()) as Record<string, unknown>);

  // 2. Fetch all comments + replies in parallel with child issues
  const [comments, ...childResults] = await Promise.all([
    fetchComments(baseUrl, headers, issueKey),
    ...issue.subtasks.map((s) => fetchChildIssue(baseUrl, headers, s.key)),
  ]);

  issue.comments = comments;
  issue.childIssues = childResults.filter((c): c is JiraChildIssue => c !== null);

  return issue;
}

export function normaliseFromMcp(rawMcpResponse: unknown): JiraIssue {
  let raw = rawMcpResponse as Record<string, unknown>;
  if (typeof rawMcpResponse === 'string') raw = JSON.parse(rawMcpResponse) as Record<string, unknown>;
  if (!raw.key && Array.isArray(raw.content)) {
    const textNode = (raw.content as Array<{ type: string; text: string }>).find((n) => n.type === 'text');
    if (textNode?.text) raw = JSON.parse(textNode.text) as Record<string, unknown>;
  }
  const issue = normaliseJiraResponse(raw);
  // MCP path does not fetch comments/children — initialise as empty
  issue.comments = issue.comments ?? [];
  issue.childIssues = issue.childIssues ?? [];
  return issue;
}

// Made with Bob
