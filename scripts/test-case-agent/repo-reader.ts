// ─────────────────────────────────────────────────────────────────────────────
//  Test Case Agent — Repo Reader
//  Reads changed/relevant files from GitHub repos before test case generation.
//
//  Strategy:
//    1. For each configured repo, call the GitHub search API to find files
//       that mention the issue key or its component keywords.
//    2. Fetch up to MAX_FILES of those files and capture a snippet.
//    3. Return a RepoContext that ai-analyzer.ts uses to add targeted scenarios.
//
//  Requires: GITHUB_TOKEN env var for authenticated GitHub API calls.
// ─────────────────────────────────────────────────────────────────────────────

import { RepoContext, RepoFile } from './types';

const MAX_FILES = 5;      // max files to read per repo
const SNIPPET_LEN = 2000; // chars to capture from each file

interface GithubSearchItem {
  name: string;
  path: string;
  html_url: string;
  repository: { full_name: string };
  url: string;  // API url for raw content
}

/** Parse "owner/repo" from a GitHub URL */
function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

/** Fetch raw file content via GitHub REST API */
async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3.raw',
    },
  });
  if (!res.ok) return '';
  const text = await res.text();
  return text.slice(0, SNIPPET_LEN);
}

/** Search for files in a repo that match a query string */
async function searchRepoFiles(
  token: string,
  owner: string,
  repo: string,
  query: string,
): Promise<GithubSearchItem[]> {
  const q = encodeURIComponent(`${query} repo:${owner}/${repo}`);
  const url = `https://api.github.com/search/code?q=${q}&per_page=${MAX_FILES}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) return [];
  const data = await res.json() as { items?: GithubSearchItem[] };
  return data.items ?? [];
}

/**
 * Read relevant files from all configured repos and return a RepoContext.
 * Falls back gracefully if GITHUB_TOKEN is not set or API calls fail.
 *
 * @param repoUrls  List of GitHub repo URLs from .env / workflow-config.json
 * @param issueKey  Jira issue key used as the search query (e.g. "SCI-16907")
 * @param keywords  Additional search terms derived from the issue (components, labels)
 */
export async function readRepoContext(
  repoUrls: string[],
  issueKey: string,
  keywords: string[],
): Promise<RepoContext> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? '';
  const files: RepoFile[] = [];
  const checkedRepos: string[] = [];

  if (!token) {
    return {
      repos: [],
      files: [],
      summary: 'GITHUB_TOKEN not set — repo code check skipped.',
    };
  }

  // Build a focused search query: issue key + first 2 keywords
  const searchTerms = [issueKey, ...keywords.slice(0, 2)].join(' OR ');

  for (const url of repoUrls) {
    const parsed = parseOwnerRepo(url);
    if (!parsed) continue;
    const { owner, repo } = parsed;
    checkedRepos.push(repo);

    try {
      const items = await searchRepoFiles(token, owner, repo, searchTerms);
      for (const item of items.slice(0, MAX_FILES)) {
        const snippet = await fetchFileContent(token, owner, repo, item.path);
        files.push({
          repo,
          path: item.path,
          url: item.html_url,
          snippet,
        });
      }
    } catch {
      // Non-fatal — repo may be private or rate-limited
    }
  }

  const summary = files.length > 0
    ? `Found ${files.length} relevant file(s) across [${checkedRepos.join(', ')}]: ${files.map(f => f.path).join(', ')}`
    : `No relevant files found in [${checkedRepos.join(', ')}] for query: ${searchTerms}`;

  return { repos: checkedRepos, files, summary };
}

// Made with Bob
