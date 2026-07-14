// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Repo Reader
//  Finds relevant files from GitHub repos by searching CLOSED Pull Requests
//  whose title or body mentions the Jira issue key.
//
//  Strategy:
//    1. Search closed PRs in each repo for the issue key in title/body.
//    2. For each matched PR, fetch the list of changed files.
//    3. Fetch a snippet of each changed file (first 2000 chars).
//    4. Return a RepoContext that ai-analyzer.ts uses to add targeted scenarios.
//
//  Requires: GITHUB_TOKEN env var for authenticated GitHub API calls.
// ─────────────────────────────────────────────────────────────────────────────

import { RepoContext, RepoFile } from './types';

const MAX_PRS    = 5;     // max closed PRs to inspect per repo
const MAX_FILES  = 8;     // max changed files to read across all matched PRs
const SNIPPET_LEN = 2000; // chars to capture from each file

interface GithubPR {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
}

interface GithubPRFile {
  filename: string;
  status: string;  // added | modified | removed
  blob_url: string;
}

/** Parse "owner/repo" from a GitHub URL */
function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Search closed PRs in a repo whose title or body contains the issue key */
async function findClosedPRs(
  token: string,
  owner: string,
  repo: string,
  issueKey: string,
): Promise<GithubPR[]> {
  // GitHub search: PRs (is:pr) that are closed, in this repo, mentioning the issue key
  const q = encodeURIComponent(`${issueKey} repo:${owner}/${repo} is:pr is:closed`);
  const url = `https://api.github.com/search/issues?q=${q}&per_page=${MAX_PRS}&sort=updated&order=desc`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) return [];
  const data = await res.json() as { items?: GithubPR[] };
  return data.items ?? [];
}

/** Get the list of files changed in a PR */
async function getPRFiles(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GithubPRFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=30`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) return [];
  return res.json() as Promise<GithubPRFile[]>;
}

/** Fetch raw file content from the default branch */
async function fetchFileSnippet(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`;
  const res = await fetch(url, {
    headers: { ...authHeaders(token), Accept: 'application/vnd.github.v3.raw' },
  });
  if (!res.ok) return '';
  const text = await res.text();
  return text.slice(0, SNIPPET_LEN);
}

/**
 * Read changed files from closed PRs that mention the issue key.
 * Falls back gracefully if GITHUB_TOKEN is not set or API calls fail.
 *
 * @param repoUrls  List of GitHub repo URLs from .env / workflow-config.json
 * @param issueKey  Jira issue key (e.g. "SCI-17283")
 * @param _keywords Unused — kept for API compatibility
 */
export async function readRepoContext(
  repoUrls: string[],
  issueKey: string,
  _keywords: string[],
): Promise<RepoContext> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? '';
  const files: RepoFile[] = [];
  const checkedRepos: string[] = [];
  const prLinks: string[] = [];

  if (!token) {
    return {
      repos: [],
      files: [],
      summary: 'GITHUB_TOKEN not set — repo PR check skipped.',
    };
  }

  for (const repoUrl of repoUrls) {
    const parsed = parseOwnerRepo(repoUrl);
    if (!parsed) continue;
    const { owner, repo } = parsed;
    checkedRepos.push(repo);

    try {
      const prs = await findClosedPRs(token, owner, repo, issueKey);
      if (prs.length === 0) continue;

      for (const pr of prs) {
        prLinks.push(`[${repo}] PR #${pr.number} — ${pr.title} (${pr.html_url})`);
        const prFiles = await getPRFiles(token, owner, repo, pr.number);

        for (const f of prFiles) {
          if (files.length >= MAX_FILES) break;
          if (f.status === 'removed') continue; // skip deleted files
          const snippet = await fetchFileSnippet(token, owner, repo, f.filename);
          files.push({
            repo,
            path: f.filename,
            url: f.blob_url,
            snippet,
          });
        }
        if (files.length >= MAX_FILES) break;
      }
    } catch {
      // Non-fatal — repo may be private or rate-limited
    }
  }

  const summary = files.length > 0
    ? `Found ${prLinks.length} closed PR(s) in [${checkedRepos.join(', ')}] with ${files.length} changed file(s):\n    ${prLinks.join('\n    ')}`
    : `No closed PRs found mentioning ${issueKey} in [${checkedRepos.join(', ')}]`;

  return { repos: checkedRepos, files, summary };
}

// Made with Bob
