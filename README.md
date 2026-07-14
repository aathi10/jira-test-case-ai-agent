# JIRA Test Case AI Agent

> Reads a JIRA issue via MCP (or REST API), generates comprehensive manual + Playwright test cases, and automates the full test preparation workflow end-to-end.

## Architecture

```
scripts/
├── workflow.ts                     ← End-to-end workflow orchestrator (8 steps)
├── agent.ts                        ← CLI entry point / standalone generator
└── test-case-agent/
    ├── types.ts                    ← All TypeScript interfaces
    ├── jira-fetcher.ts             ← JIRA data fetching + ADF normalisation
    ├── ai-analyzer.ts              ← Scenario extraction + issue analysis
    ├── generator.ts                ← TestCase builder (one case per scenario)
    ├── exporters.ts                ← Markdown | CSV | JSON | Playwright .spec.ts
    └── jira-actions.ts             ← JIRA REST: create subtask, attach, comment
workflow-config.json                ← Configurable repos, Jira creds, templates
```

---

## End-to-End Workflow (Recommended)

The workflow script automates all 8 steps of your test preparation process:

| Step | What happens |
|------|-------------|
| 1 | Fetch the JIRA issue — description, subtasks, comments, AC |
| 2 | Show linked code repository references |
| 3 | Analyse requirements, expected behaviour, AC |
| 4 | Extract and group test scenarios |
| 5 | Generate test cases → save CSV to `test-cases/` |
| 6 | Create sub-task **"Test Case Generation/Preparation — {issueKey}"** |
| 7 | Attach CSV to the sub-task and mark it **Done** |
| 8 | Add a comment on the parent issue linking to the attached file |

### Setup

1. **Edit [`workflow-config.json`](./workflow-config.json)** — set your repos, and optionally hard-code credentials (or use env vars):

```json
{
  "jira": {
    "baseUrl": "https://ibm-middleware.atlassian.net",
    "username": "",
    "apiToken": ""
  },
  "repos": [
    { "id": "repo1", "name": "Primary Repo", "url": "https://github.com/ibm-webmethods/repo-one" },
    { "id": "repo2", "name": "Secondary Repo", "url": "https://github.com/ibm-webmethods/repo-two" }
  ]
}
```

2. **Set credentials** (if not in config):

```bash
export JIRA_USERNAME=you@ibm.com
export JIRA_API_TOKEN=your_token
```

3. **Run the workflow:**

```bash
# Single issue — full 8-step automation
npx tsx scripts/workflow.ts SCI-17066

# Multiple issues
npx tsx scripts/workflow.ts SCI-17066 SCI-17067

# Dry-run — generates CSV but does NOT write to JIRA
npx tsx scripts/workflow.ts SCI-17066 --dry-run

# Via npm script
npm run workflow -- SCI-17066
npm run workflow:dry -- SCI-17066
```

### CSV Format

The generated CSV matches the required column layout for JIRA/Xray import:

```
Test Case ID, Title, Priority, Type, Preconditions, Test Steps, Expected Result, Test Data, Notes
```

Steps are formatted as: `1. <Action> -> <Expected Result> | 2. <Action> -> <Expected Result> | …`

---

## Standalone Generator (agent.ts)

For generating test cases only (no JIRA writes):

```bash
# Install
npm install

# Set credentials (REST API mode)
export JIRA_BASE_URL=https://your-org.atlassian.net
export JIRA_USERNAME=you@example.com
export JIRA_API_TOKEN=your_token_here

# Markdown output
npx tsx scripts/agent.ts PROJ-123

# Detailed mode (edge cases, security, performance, regression)
npx tsx scripts/agent.ts PROJ-123 --detailed

# CSV export
npx tsx scripts/agent.ts PROJ-123 --format csv

# With Playwright skeleton
npx tsx scripts/agent.ts PROJ-123 --detailed --playwright

# Multiple issues
npx tsx scripts/agent.ts PROJ-123 PROJ-124 PROJ-125 --detailed
```

---

## With Bob (MCP Mode)

When using Bob (Roo-Cline) with the Atlassian MCP server (configured in `.bob/mcp.json`):

1. **Ask Bob to run the full workflow:**
   > "Run the test case workflow for SCI-17066"

2. **Or generate only:**
   > "Fetch JIRA issue SCI-17066 and generate detailed test cases"

3. **Bob will:**
   - Use `mcp__atlassian__jira_get_issue` to fetch live JIRA data
   - Pass the response through `normaliseFromMcp()` in `jira-fetcher.ts`
   - Run the full analysis + generation pipeline
   - Optionally execute the full workflow (create subtask, attach, comment)

4. **Or save the MCP response to a file and run:**
   ```bash
   npx tsx scripts/agent.ts --mcp ./mcp-response.json --detailed
   ```

---

## Output Formats

| Format | Flag | File | Best For |
|---|---|---|---|
| **CSV** | `--format csv` | `PROJ-123-test-cases.csv` | JIRA / Xray import (workflow default) |
| Markdown | *(default)* | `PROJ-123-test-cases.md` | Documentation |
| JSON | `--format json` | `PROJ-123-test-cases.json` | API / programmatic use |
| Playwright | `--playwright` | `PROJ-123-test-cases.generated.spec.ts` | Automation skeleton |

## Test Case Types Generated

| Type | Description |
|---|---|
| **Functional** | Core happy-path scenarios extracted from the issue |
| **Negative** | Invalid input, error handling, rejection scenarios |
| **UI** | Layout, responsive, accessibility checks |
| **Integration** | API / service / data sync flows |
| **Security** | Auth, RBAC, token expiry, audit trail |
| **Performance** | Load, concurrency, response time |
| **Regression** | Ensures existing flows are not broken |

## npm Scripts

```bash
# End-to-end workflow
npm run workflow -- SCI-17066
npm run workflow:dry -- SCI-17066        # dry-run (no JIRA writes)

# Standalone generator
npm run agent -- PROJ-123               # markdown
npm run agent:detailed -- PROJ-123      # all types
npm run agent:playwright -- PROJ-123    # + .spec.ts
npm run agent:csv -- PROJ-123           # CSV
npm run agent:json -- PROJ-123          # JSON
```

---

*Made with Bob — IBM AI Engineering Toolkit*
