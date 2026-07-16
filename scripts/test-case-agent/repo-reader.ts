// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Repo Reader
//  Collects ALL signals from GitHub repos relevant to the Jira issue key:
//
//  1. Closed PRs  — merged code changes (title/body mentions issue key)
//  2. Open PRs    — work in progress / pending review
//  3. Commits     — individual commits whose message mentions the issue key
//  4. Changed files from all matched PRs — file snippets for scenario targeting
//
//  Requires: GITHUB_TOKEN env var for authenticated GitHub API calls.
// ─────────────────────────────────────────────────────────────────────────────

import { RepoPRSignal, RepoContext, RepoFile } from './types';

const MAX_PRS_PER_REPO = 5;     // max PRs (open or closed) to inspect per repo
const MAX_FILES        = 10;    // max changed files across all matched PRs
const MAX_COMMITS      = 20;    // max commits to scan per repo
const SNIPPET_LEN      = 2000;  // chars to capture from each file

interface GithubPR {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  state: string;       // "open" | "closed"
  pull_request?: { merged_at?: string | null };
}

interface GithubPRFile {
  filename: string;
  status: string;   // added | modified | removed | renamed
  blob_url: string;
}

interface GithubCommit {
  sha: string;
  commit: { message: string };
  html_url: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Parse "owner/repo" from a GitHub URL */
function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

// ─── GitHub API fetchers ──────────────────────────────────────────────────────

/**
 * Search GitHub Issues API for PRs (open OR closed) whose title/body/branch
 * mentions the Jira issue key.
 */
async function findPRs(
  token: string,
  owner: string,
  repo: string,
  issueKey: string,
  state: 'open' | 'closed',
): Promise<GithubPR[]> {
  const q = encodeURIComponent(`${issueKey} repo:${owner}/${repo} is:pr is:${state}`);
  const url = `https://api.github.com/search/issues?q=${q}&per_page=${MAX_PRS_PER_REPO}&sort=updated&order=desc`;
  try {
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) return [];
    const data = await res.json() as { items?: GithubPR[] };
    return data.items ?? [];
  } catch { return []; }
}

/** Get the list of files changed in a PR */
async function getPRFiles(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GithubPRFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=30`;
  try {
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) return [];
    return res.json() as Promise<GithubPRFile[]>;
  } catch { return []; }
}

/**
 * Search recent commits in the default branch whose message mentions issueKey.
 * Uses the commits search API (requires push access or public repo).
 */
async function findCommits(
  token: string,
  owner: string,
  repo: string,
  issueKey: string,
): Promise<GithubCommit[]> {
  // GitHub's search/commits API (preview header required)
  const q = encodeURIComponent(`${issueKey} repo:${owner}/${repo}`);
  const url = `https://api.github.com/search/commits?q=${q}&per_page=${MAX_COMMITS}&sort=committer-date&order=desc`;
  try {
    const res = await fetch(url, {
      headers: {
        ...authHeaders(token),
        Accept: 'application/vnd.github.cloak-preview+json',  // commits search preview
      },
    });
    if (!res.ok) return [];
    const data = await res.json() as { items?: GithubCommit[] };
    return data.items ?? [];
  } catch { return []; }
}

/** Fetch raw file content snippet from the blob URL's ref */
async function fetchFileSnippet(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`;
  try {
    const res = await fetch(url, {
      headers: { ...authHeaders(token), Accept: 'application/vnd.github.v3.raw' },
    });
    if (!res.ok) return '';
    return (await res.text()).slice(0, SNIPPET_LEN);
  } catch { return ''; }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Collect all repo signals relevant to the Jira issue key:
 *   - Closed + merged PRs (what was already shipped)
 *   - Open PRs            (work in progress)
 *   - Recent commits      (individual commit messages)
 *   - Changed file snippets from all matched PRs
 *
 * Falls back gracefully if GITHUB_TOKEN is not set or any API call fails.
 */
export async function readRepoContext(
  repoUrls: string[],
  issueKey: string,
  _keywords: string[],
): Promise<RepoContext> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? '';

  if (!token) {
    return {
      repos: [],
      files: [],
      prs: [],
      commits: [],
      summary: 'GITHUB_TOKEN not set — repo signal collection skipped.',
    };
  }

  const allFiles: RepoFile[]      = [];
  const allPRs: RepoPRSignal[]    = [];
  const allCommits: string[]      = [];
  const checkedRepos: string[]    = [];
  const prLogLines: string[]      = [];

  for (const repoUrl of repoUrls) {
    const parsed = parseOwnerRepo(repoUrl);
    if (!parsed) continue;
    const { owner, repo } = parsed;
    checkedRepos.push(repo);

    // Run closed PRs, open PRs, and commits searches in parallel
    const [closedPRs, openPRs, commits] = await Promise.all([
      findPRs(token, owner, repo, issueKey, 'closed'),
      findPRs(token, owner, repo, issueKey, 'open'),
      findCommits(token, owner, repo, issueKey),
    ]);

    // --- Closed / merged PRs ---
    for (const pr of closedPRs) {
      const state = pr.pull_request?.merged_at ? 'merged' : 'closed';
      allPRs.push({
        repo, number: pr.number, title: pr.title,
        state, url: pr.html_url,
        body: (pr.body ?? '').slice(0, 1000),
      });
      prLogLines.push(`  [${repo}] PR #${pr.number} (${state}) — ${pr.title}`);
      prLogLines.push(`    ${pr.html_url}`);

      // Collect changed files
      if (allFiles.length < MAX_FILES) {
        const prFiles = await getPRFiles(token, owner, repo, pr.number);
        for (const f of prFiles) {
          if (allFiles.length >= MAX_FILES) break;
          if (f.status === 'removed') continue;
          const snippet = await fetchFileSnippet(token, owner, repo, f.filename);
          allFiles.push({ repo, path: f.filename, url: f.blob_url, snippet });
        }
      }
    }

    // --- Open PRs ---
    for (const pr of openPRs) {
      allPRs.push({
        repo, number: pr.number, title: pr.title,
        state: 'open', url: pr.html_url,
        body: (pr.body ?? '').slice(0, 1000),
      });
      prLogLines.push(`  [${repo}] PR #${pr.number} (open) — ${pr.title}`);
      prLogLines.push(`    ${pr.html_url}`);
    }

    // --- Commits ---
    for (const c of commits) {
      const firstLine = c.commit.message.split('\n')[0].trim();
      allCommits.push(`[${repo}] ${firstLine} (${c.html_url})`);
    }
  }

  // Build human-readable summary
  const closedCount  = allPRs.filter(p => p.state !== 'open').length;
  const openCount    = allPRs.filter(p => p.state === 'open').length;
  const commitCount  = allCommits.length;

  let summary: string;
  if (allPRs.length === 0 && allCommits.length === 0) {
    summary = `No PRs or commits found mentioning ${issueKey} in [${checkedRepos.join(', ')}]`;
  } else {
    const parts: string[] = [];
    if (closedCount)  parts.push(`${closedCount} closed/merged PR(s)`);
    if (openCount)    parts.push(`${openCount} open PR(s)`);
    if (commitCount)  parts.push(`${commitCount} commit(s)`);
    if (allFiles.length) parts.push(`${allFiles.length} changed file(s)`);
    summary = `[${checkedRepos.join(', ')}] — ${parts.join(', ')}:\n` + prLogLines.join('\n');
  }

  return {
    repos: checkedRepos,
    files: allFiles,
    prs: allPRs,
    commits: allCommits,
    summary,
  };
}

// Made with Bob
