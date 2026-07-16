// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Context Builder
//
//  Assembles a structured FullContext object from:
//    - The JIRA issue (summary, description, AC, comments, child issues, linked issues)
//    - Repo signals (PRs, commits, changed files)
//
//  FullContext is the single input handed to Bob for reasoning.
//  All AI reasoning rules live in prompts/test-case-generation.md.
//  This file contains ONLY deterministic data assembly — no keyword matching,
//  no scenario generation, no AI reasoning.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { JiraIssue, RepoContext } from './types.js';

// ─── FullContext ──────────────────────────────────────────────────────────────

export interface ContextPR {
  repo: string;
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  body: string;
}

export interface ContextCommit {
  repo: string;
  message: string;
  url: string;
}

export interface ContextFile {
  repo: string;
  path: string;
  url: string;
  /** First 2000 chars of file content */
  snippet: string;
}

export interface ContextComment {
  author: string;
  body: string;
  created: string;
}

export interface ContextChildIssue {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  description: string;
  acceptanceCriteria: string;
}

export interface ContextLinkedIssue {
  key: string;
  summary: string;
  linkType: string;
}

/** The single input handed to Bob for test case generation. */
export interface FullContext {
  // ── JIRA ──────────────────────────────────────────────────────────────────
  issueKey: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  issueType: string;
  priority: string;
  status: string;
  labels: string[];
  components: string[];
  epicKey?: string;
  sprint?: string;
  assignee?: string;
  reporter?: string;

  // ── Related issues ────────────────────────────────────────────────────────
  childIssues: ContextChildIssue[];
  linkedIssues: ContextLinkedIssue[];
  subtasks: Array<{ key: string; summary: string }>;

  // ── Discussion ────────────────────────────────────────────────────────────
  comments: ContextComment[];

  // ── Repo signals ──────────────────────────────────────────────────────────
  prs: ContextPR[];
  commits: ContextCommit[];
  changedFiles: ContextFile[];

  // ── Prompt sources ────────────────────────────────────────────────────────
  /** Contents of prompts/test-case-generation.md — loaded at runtime */
  generationPrompt: string;
  /** Contents of prompts/feature-analysis.md — loaded at runtime */
  featureAnalysisPrompt: string;
  /** Contents of prompts/impact-analysis.md — loaded at runtime */
  impactAnalysisPrompt: string;
}

// ─── Prompt loader ────────────────────────────────────────────────────────────

/**
 * Load a prompt file from the prompts/ directory.
 * Falls back to an empty string if the file does not exist so that
 * the workflow can still run without the prompts directory.
 */
function loadPrompt(filename: string): string {
  const filePath = path.resolve(process.cwd(), 'prompts', filename);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Assemble a FullContext from a fetched JiraIssue and RepoContext.
 * No keyword matching or AI reasoning happens here — pure data mapping.
 */
export function buildContext(issue: JiraIssue, repoContext?: RepoContext): FullContext {
  // Map repo commits: "[repo] message (url)" → structured objects
  const commits: ContextCommit[] = (repoContext?.commits ?? []).map((raw) => {
    const repoMatch = raw.match(/^\[([^\]]+)\]\s+/);
    const urlMatch  = raw.match(/\(([^)]+)\)$/);
    const repo      = repoMatch?.[1] ?? 'unknown';
    const url       = urlMatch?.[1]  ?? '';
    const message   = raw.replace(/^\[[^\]]+\]\s+/, '').replace(/\s*\([^)]+\)$/, '').trim();
    return { repo, message, url };
  });

  return {
    // JIRA fields
    issueKey:            issue.key,
    summary:             issue.summary,
    description:         issue.description,
    acceptanceCriteria:  issue.acceptanceCriteria,
    issueType:           issue.issueType,
    priority:            issue.priority,
    status:              issue.status,
    labels:              issue.labels,
    components:          issue.components,
    epicKey:             issue.epicKey,
    sprint:              issue.sprint,
    assignee:            issue.assignee,
    reporter:            issue.reporter,

    // Related issues
    childIssues: (issue.childIssues ?? []).map((c) => ({
      key:                c.key,
      summary:            c.summary,
      issueType:          c.issueType,
      status:             c.status,
      description:        c.description,
      acceptanceCriteria: c.acceptanceCriteria,
    })),
    linkedIssues: (issue.linkedIssues ?? []).map((l) => ({
      key:      l.key,
      summary:  l.summary,
      linkType: l.linkType,
    })),
    subtasks: issue.subtasks ?? [],

    // Discussion
    comments: (issue.comments ?? []).map((c) => ({
      author:  c.author,
      body:    c.body,
      created: c.created,
    })),

    // Repo signals
    prs: (repoContext?.prs ?? []).map((pr) => ({
      repo:   pr.repo,
      number: pr.number,
      title:  pr.title,
      state:  pr.state,
      url:    pr.url,
      body:   pr.body,
    })),
    commits,
    changedFiles: (repoContext?.files ?? []).map((f) => ({
      repo:    f.repo,
      path:    f.path,
      url:     f.url,
      snippet: f.snippet,
    })),

    // Prompts loaded from disk at build time
    generationPrompt:     loadPrompt('test-case-generation.md'),
    featureAnalysisPrompt: loadPrompt('feature-analysis.md'),
    impactAnalysisPrompt:  loadPrompt('impact-analysis.md'),
  };
}

// ─── Short summary (for logs) ─────────────────────────────────────────────────

/**
 * Render a compact one-screen summary for workflow log output.
 */
export function renderContextSummary(ctx: FullContext): string {
  const lines: string[] = [
    `Issue:       ${ctx.issueKey} [${ctx.issueType}] ${ctx.priority} / ${ctx.status}`,
    `Summary:     ${ctx.summary}`,
  ];
  if (ctx.components.length) lines.push(`Components:  ${ctx.components.join(', ')}`);
  if (ctx.labels.length)     lines.push(`Labels:      ${ctx.labels.join(', ')}`);
  if (ctx.epicKey)           lines.push(`Epic:        ${ctx.epicKey}`);
  lines.push('');
  lines.push(`Description (${ctx.description.length} chars)`);
  if (ctx.acceptanceCriteria) lines.push(`AC (${ctx.acceptanceCriteria.length} chars)`);
  lines.push('');
  if (ctx.childIssues.length)  lines.push(`Child issues (${ctx.childIssues.length}): ${ctx.childIssues.map(c => c.key).join(', ')}`);
  if (ctx.linkedIssues.length) lines.push(`Linked (${ctx.linkedIssues.length}): ${ctx.linkedIssues.map(l => `[${l.linkType}] ${l.key}`).join(', ')}`);
  if (ctx.subtasks.length)     lines.push(`Subtasks (${ctx.subtasks.length}): ${ctx.subtasks.map(s => s.key).join(', ')}`);
  if (ctx.comments.length)     lines.push(`Comments (${ctx.comments.length})`);
  lines.push('');
  const openPRs   = ctx.prs.filter(p => p.state === 'open');
  const mergedPRs = ctx.prs.filter(p => p.state !== 'open');
  if (ctx.prs.length)          lines.push(`PRs: ${mergedPRs.length} closed/merged, ${openPRs.length} open`);
  if (ctx.commits.length)      lines.push(`Commits: ${ctx.commits.length}`);
  if (ctx.changedFiles.length) lines.push(`Changed files: ${ctx.changedFiles.length}`);
  if (ctx.generationPrompt)    lines.push(`Prompt loaded: prompts/test-case-generation.md (${ctx.generationPrompt.length} chars)`);
  return lines.join('\n');
}

// ─── Full context dump for Bob ────────────────────────────────────────────────

/**
 * Render the FULL context as a structured text block for Bob to reason over.
 *
 * This is the text Bob reads as the "ISSUE TO PROCESS" section of the master
 * prompt. It includes every signal: description, AC, all comments, all PR
 * bodies, all commit messages, and file snippets.
 *
 * Bob uses prompts/test-case-generation.md as the system instruction and this
 * text as the user message.
 */
export function renderFullContextForBob(ctx: FullContext): string {
  const sep = (label: string) => `\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}\n`;
  const lines: string[] = [];

  lines.push(sep('JIRA ISSUE'));
  lines.push(`Key:        ${ctx.issueKey}`);
  lines.push(`Type:       ${ctx.issueType}`);
  lines.push(`Priority:   ${ctx.priority}`);
  lines.push(`Status:     ${ctx.status}`);
  lines.push(`Summary:    ${ctx.summary}`);
  if (ctx.components.length) lines.push(`Components: ${ctx.components.join(', ')}`);
  if (ctx.labels.length)     lines.push(`Labels:     ${ctx.labels.join(', ')}`);
  if (ctx.epicKey)           lines.push(`Epic:       ${ctx.epicKey}`);
  if (ctx.sprint)            lines.push(`Sprint:     ${ctx.sprint}`);
  if (ctx.assignee)          lines.push(`Assignee:   ${ctx.assignee}`);

  lines.push(sep('DESCRIPTION'));
  lines.push(ctx.description || '(no description)');

  if (ctx.acceptanceCriteria) {
    lines.push(sep('ACCEPTANCE CRITERIA'));
    lines.push(ctx.acceptanceCriteria);
  }

  if (ctx.linkedIssues.length) {
    lines.push(sep('LINKED ISSUES'));
    for (const l of ctx.linkedIssues) lines.push(`[${l.linkType}] ${l.key}: ${l.summary}`);
  }

  if (ctx.subtasks.length) {
    lines.push(sep('SUBTASKS'));
    for (const s of ctx.subtasks) lines.push(`${s.key}: ${s.summary}`);
  }

  if (ctx.childIssues.length) {
    lines.push(sep('CHILD ISSUES'));
    for (const c of ctx.childIssues) {
      lines.push(`\n## ${c.key} [${c.issueType}] ${c.status}: ${c.summary}`);
      if (c.description)        lines.push(c.description.slice(0, 1000));
      if (c.acceptanceCriteria) lines.push(`AC: ${c.acceptanceCriteria.slice(0, 500)}`);
    }
  }

  if (ctx.comments.length) {
    lines.push(sep('COMMENTS & REPLIES'));
    for (const c of ctx.comments) {
      lines.push(`\n[${c.created.slice(0, 10)}] ${c.author}:\n${c.body.slice(0, 800)}`);
    }
  }

  if (ctx.prs.length) {
    const open   = ctx.prs.filter(p => p.state === 'open');
    const merged = ctx.prs.filter(p => p.state !== 'open');
    if (open.length) {
      lines.push(sep('OPEN PULL REQUESTS (in-progress work)'));
      for (const pr of open) {
        lines.push(`\nPR #${pr.number} [${pr.repo}]: ${pr.title} — ${pr.url}`);
        if (pr.body) lines.push(pr.body.slice(0, 600));
      }
    }
    if (merged.length) {
      lines.push(sep('MERGED PULL REQUESTS (shipped changes)'));
      for (const pr of merged) {
        lines.push(`PR #${pr.number} [${pr.repo}]: ${pr.title} — ${pr.url}`);
      }
    }
  }

  if (ctx.commits.length) {
    lines.push(sep('RECENT COMMITS'));
    for (const c of ctx.commits.slice(0, 10)) {
      lines.push(`[${c.repo}] ${c.message}${c.url ? ` — ${c.url}` : ''}`);
    }
  }

  if (ctx.changedFiles.length) {
    lines.push(sep('CHANGED / RELEVANT FILES'));
    for (const f of ctx.changedFiles) {
      lines.push(`\n## ${f.repo}/${f.path} — ${f.url}`);
      if (f.snippet) lines.push(f.snippet.slice(0, 1500));
    }
  }

  return lines.join('\n');
}

// Made with Bob
