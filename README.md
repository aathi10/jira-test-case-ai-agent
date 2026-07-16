# JIRA Test Case AI Agent

> An AI-powered end-to-end workflow that reads a JIRA Epic, fetches the related GitHub PRs and changed files, generates comprehensive manual test cases, and fully automates the test preparation cycle in JIRA — creating the sub-task, attaching the CSV/XLSX, and posting the summary comment.

---

## How It Works

```
JIRA Issue (Epic)
       ↓
  Fetch issue + comments + linked issues  (MCP Atlassian)
       ↓
  Find merged PRs + commits + changed files  (GitHub API)
       ↓
  Read key source files from the repo  (GitHub API)
       ↓
  Bob (AI) reasons over all context → writes test cases CSV
       ↓
  Convert CSV → XLSX
       ↓
  Find Testing story under the Epic
  Create "Test Case Generation/Preparation" sub-task
  Attach CSV + XLSX to sub-task
  Post summary comment on Testing story
  Mark sub-task → Completed
```

All reasoning (scenario titles, preconditions, step content, priorities) is driven by the prompt in [`prompts/test-case-generation.md`](prompts/test-case-generation.md) and executed by Bob. The scripts handle orchestration, file I/O, and JIRA REST calls.

---

## Quick Start

### 1. Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Bob (Roo-Cline)](https://github.com/RooVetGit/Roo-Code) IDE extension
- A JIRA Cloud account with API token
- A GitHub Personal Access Token (PAT) with `repo` read scope

### 2. Install

```bash
git clone https://github.com/your-org/jira-test-case-ai-agent
cd jira-test-case-ai-agent
npm install
```

### 3. Configure credentials

**JIRA + GitHub credentials go in `workflow-config.json`** (gitignored — never committed):

```json
{
  "jira": {
    "baseUrl": "https://your-org.atlassian.net",
    "username": "you@example.com",
    "apiToken": "your_jira_api_token"
  },
  "repos": [
    {
      "id": "repo1",
      "name": "Frontend Repo",
      "url": "https://github.com/your-org/your-frontend-repo",
      "description": "UI product repository"
    },
    {
      "id": "repo2",
      "name": "Backend Repo",
      "url": "https://github.com/your-org/your-backend-repo",
      "description": "Backend/TMS repository"
    }
  ],
  "workflow": {
    "outputDir": "test-cases",
    "subtaskSummaryTemplate": "Test Case Generation/Preparation — {issueKey}",
    "subtaskDescription": "Auto-generated test cases for this release feature. See attached CSV and XLSX files for all test cases.",
    "assigneeEmail": "you@example.com",
    "defaultFormat": "csv",
    "detailed": true,
    "doneTransitionName": "Completed"
  }
}
```

**GitHub PAT goes in `.bob/mcp.json`** (gitignored — never committed):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

A template is provided at [`.bob/mcp.json.example`](.bob/mcp.json.example) — copy it, fill in your tokens, and save as `.bob/mcp.json`.

### 4. Run

```bash
# Single issue — full end-to-end workflow
npx tsx scripts/workflow.ts PROJ-123

# Multiple issues at once
npx tsx scripts/workflow.ts PROJ-123 PROJ-124 PROJ-125

# Dry run — generates CSV/XLSX locally but does NOT write to JIRA
npx tsx scripts/workflow.ts PROJ-123 --dry-run

# Via npm scripts
npm run workflow -- PROJ-123
npm run workflow:dry -- PROJ-123
```

> **What if the workflow produces 0 test cases?**  
> The workflow writes a Bob instruction file to `test-cases/.bob-instructions/`.  
> Bob (the AI) must write the CSV — open Bob, let it read the instruction file, and then re-run the workflow to pick up the CSV and complete the JIRA steps.  
> This is the intended flow when running from the terminal outside of Bob's context.

---

## Using Bob (Recommended)

When you have this repo open in Bob (Roo-Cline), switch to the **JIRA Test Case Agent** mode and just say:

```
Test case PROJ-123
```

Bob will:
1. Run `npx tsx scripts/workflow.ts PROJ-123` to collect all context
2. Read the JIRA issue, GitHub PRs, and changed source files
3. Reason over the full context using `prompts/test-case-generation.md`
4. Write the CSV directly to `test-cases/PROJ-123-test-cases.csv`
5. Re-run the workflow to convert to XLSX and complete the JIRA steps

You can also run multiple issues in one message:

```
Test case PROJ-123, PROJ-124, PROJ-125
```

---

## Project Structure

```
jira-test-case-ai-agent/
├── scripts/
│   ├── workflow.ts                  ← End-to-end orchestrator (run this)
│   ├── agent.ts                     ← Standalone CLI generator (no JIRA writes)
│   └── test-case-agent/
│       ├── context-builder.ts       ← Assembles full JIRA + GitHub context for Bob
│       ├── ai-analyzer.ts           ← Complexity scoring and test-type detection
│       ├── generator.ts             ← Writes Bob instruction file; parses CSV back
│       ├── repo-reader.ts           ← Fetches PRs, commits, changed files from GitHub
│       ├── jira-fetcher.ts          ← JIRA REST data fetching + ADF normalisation
│       ├── jira-actions.ts          ← JIRA REST: create subtask, attach, comment
│       ├── exporters.ts             ← CSV → XLSX conversion
│       └── types.ts                 ← TypeScript interfaces
├── prompts/
│   └── test-case-generation.md     ← Master AI prompt (categories, rules, output format)
├── .bob/
│   ├── AGENT.md                     ← Bob mode system prompt
│   ├── mcp.json                     ← MCP server config (gitignored — add your tokens)
│   ├── mcp.json.example             ← Template for mcp.json
│   └── rules/
│       └── TEST_CASE_GENERATION_GUIDE.md  ← AI generation guiderails (loaded by Bob)
├── test-cases/                      ← Generated CSV + XLSX output (gitignored)
├── workflow-config.json             ← JIRA + repo config (gitignored — add your creds)
├── workflow-config.json.example     ← Template for workflow-config.json
└── package.json
```

---

## Test Coverage Categories

Every issue is analysed for all 8 categories. A category is skipped only if it is genuinely not applicable.

| Category | What is tested |
|---|---|
| **Functional** | Happy-path scenarios, core behaviour, CRUD flows |
| **Negative** | Invalid input, missing fields, boundary failures, HTTP 4xx/5xx |
| **Integration** | API calls, service-to-service data flow, TMS/metering APIs |
| **Performance** | Response time, load, concurrency, SLA targets |
| **Security** | Auth, RBAC, HTTPS, token expiry, data isolation, XSS/CSRF |
| **Accessibility** | Keyboard navigation, screen readers, ARIA, WCAG 2.1 AA |
| **Documentation** | TODO/FIXME in changed files, README accuracy, doc link correctness |
| **Regression** | One scenario per linked issue; one per changed file |

---

## Generated CSV Format

```
Test Case ID, Title, Priority, Type, Preconditions, Test Steps, Expected Result, Test Data, Notes
```

- **Test Case ID** — `PROJ-123-TC-001` (flat sequential numbering)
- **Priority** — `Critical | High | Medium | Low`
- **Type** — one of the 8 categories above
- **Test Steps** — `1. Action -> Expected Result | 2. Action -> Expected Result …`
- **Notes** — related JIRA keys, performance targets, repo file paths

---

## Configuration Reference

### `workflow-config.json`

| Field | Description |
|---|---|
| `jira.baseUrl` | Your JIRA Cloud URL, e.g. `https://your-org.atlassian.net` |
| `jira.username` | Your JIRA email address |
| `jira.apiToken` | JIRA API token from https://id.atlassian.com/manage-profile/security/api-tokens |
| `repos[].url` | GitHub repo URL — PRs and changed files are searched here |
| `workflow.assigneeEmail` | Email of the user to assign the generated sub-task to |
| `workflow.doneTransitionName` | Name of the JIRA transition to mark sub-task done (e.g. `Completed`) |

### `.bob/mcp.json`

Configures the MCP servers Bob uses. Requires:

| Server | Purpose |
|---|---|
| `atlassian` | Fetches JIRA issues, creates sub-tasks, attaches files, posts comments |
| `github` | Reads PRs, commits, and source file contents from GitHub |

See [`.bob/mcp.json.example`](.bob/mcp.json.example) for the full schema.

---

## `prompts/test-case-generation.md`

This file is the **single source of truth for all test case quality rules**. It defines:

- The 8 coverage categories and when each applies
- Scenario extraction rules (from description, comments, PRs, changed files, linked issues)
- Naming convention (`TC-NNN` flat sequence)
- Priority assignment rules
- Test step quality rules — minimum 4 steps, concrete actions, banned boilerplate patterns
- Precondition rules — scenario-specific, no generic boilerplate
- Notes field requirements
- Output CSV format

Edit this file to change how test cases are generated across all future runs.

---

## `.bob/rules/TEST_CASE_GENERATION_GUIDE.md`

Reference document explaining the full generation pipeline — loaded automatically by Bob when in the **JIRA Test Case Agent** mode. Describes:

- The pipeline (JIRA → GitHub → AI reasoning → CSV → JIRA)
- Required environment variables
- Example prompt for generating test cases manually
- Category-specific prompt additions

---

## npm Scripts

```bash
npm run workflow -- PROJ-123          # Full end-to-end workflow
npm run workflow:dry -- PROJ-123      # Dry run (no JIRA writes)
npm run agent -- PROJ-123             # Standalone generator (markdown)
npm run agent:csv -- PROJ-123         # CSV output
npm run agent:detailed -- PROJ-123    # All test types
```

---

## JIRA Test Case Agent Mode

This repository is designed to be used with the **JIRA Test Case Agent** custom Bob mode.

When active, Bob acts as a senior QA engineer and JIRA automation specialist. It:

- Accepts one or more JIRA issue keys (e.g. `SCI-16907`)
- Runs the full end-to-end workflow: fetches the issue + GitHub context, generates test cases, creates the Testing sub-task in JIRA, attaches the CSV + XLSX, and posts the completion comment
- Reads source files from the linked GitHub repos to generate code-aware, targeted test cases grounded in actual implementation details
- Applies the guiderails in `prompts/test-case-generation.md` and `.bob/rules/TEST_CASE_GENERATION_GUIDE.md` for every generation
- Supports `--dry-run` to generate files locally without modifying JIRA

To activate: switch to **JIRA Test Case Agent** mode in Bob and say `Test case PROJ-123`.

---

*Made with Bob — IBM AI Engineering Toolkit*
