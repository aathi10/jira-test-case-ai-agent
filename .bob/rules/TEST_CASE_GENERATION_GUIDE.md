# JIRA Test Case Generation — AI Prompt Guide

> Reference document for the JIRA Test Case AI Agent — loaded automatically by Bob in **JIRA Test Case Agent** mode.

---

## Generation Pipeline

```
1. Fetch JIRA issue via MCP Atlassian tool
        ↓
2. Read: summary, description, acceptance criteria, comments, linked issues, components, labels
        ↓
3. Find merged PRs + commits + changed files via GitHub API
        ↓
4. Read key source files from the repo (routes, components, handlers, auth, i18n, config)
        ↓
5. Bob reasons over the full context using prompts/test-case-generation.md
        ↓
6. Output structured test cases → CSV (then converted to XLSX by the workflow)
```

**Source files are read from the repos configured in `workflow-config.json`.**  
GitHub access requires `GITHUB_PERSONAL_ACCESS_TOKEN` in `.bob/mcp.json`.

---

## Required Configuration

### `workflow-config.json` (gitignored)

```json
{
  "jira": {
    "baseUrl": "https://your-org.atlassian.net",
    "username": "you@example.com",
    "apiToken": "your_jira_api_token"
  },
  "repos": [
    { "id": "repo1", "name": "UI Repo", "url": "https://github.com/your-org/your-ui-repo" },
    { "id": "repo2", "name": "Backend Repo", "url": "https://github.com/your-org/your-backend-repo" }
  ],
  "workflow": {
    "assigneeEmail": "you@example.com",
    "doneTransitionName": "Completed"
  }
}
```

### `.bob/mcp.json` (gitignored)

```json
{
  "mcpServers": {
    "atlassian": {
      "command": "python",
      "args": ["-m", "uv", "tool", "run", "mcp-atlassian"],
      "env": {
        "JIRA_URL": "https://your-org.atlassian.net",
        "JIRA_USERNAME": "you@example.com",
        "JIRA_API_TOKEN": "your_jira_api_token"
      }
    },
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

---

## Test Coverage Categories

| Category | When to include |
|---|---|
| **Functional** | Always — happy path, CRUD, validation |
| **Negative** | Always — invalid input, missing fields, HTTP 4xx/5xx, boundary failures |
| **Integration** | API calls, service-to-service, data flow across systems |
| **Performance** | Response time, load, concurrency, SLA targets |
| **Security** | Auth, RBAC, HTTPS, token expiry, data isolation, XSS/CSRF |
| **Accessibility** | Keyboard navigation, screen readers, ARIA, WCAG 2.1 AA |
| **Documentation** | TODO/FIXME in changed files, README accuracy, deprecated APIs |
| **Regression** | One scenario per linked issue; one per changed file; one per merged PR |

---

## Scenario Sources

Scenarios are derived from every available signal:

| Source | What to extract |
|---|---|
| Description / AC | One Functional TC per stated requirement |
| Comments | Clarifications, edge cases, approved content (labels, URLs, copy text) |
| Linked issues | One Regression TC per linked issue |
| Changed files | One Regression TC per file; Functional for components; Security for auth files |
| PRs (merged) | One Regression TC per merged PR |
| Source code | Concrete field names, API endpoints, i18n keys, validation rules, state flags |

---

## Test Case Quality Rules

### IDs
`<ISSUE_KEY>-TC-NNN` — flat sequential numbering, all categories share one counter.

### Priorities
- **High** — core acceptance criteria, data-loss risk, auth/RBAC enforcement
- **Medium** — edge cases, concurrent access, partial states, i18n, feature flags
- **Low** — documentation checks, audit trail, cosmetic

### Steps
- Minimum **4 steps** per test case; complex flows may have 7–8
- Step 1 is always navigation or setup — name the **exact URL, menu path, or page**
- Each step: one concrete action + one observable expected result
- Use: `"Click X"`, `"Navigate to Y"`, `"Set Z to value"`, `"API returns HTTP 200"`

### Preconditions
- First precondition names the user role: `"User is logged in as admin"`
- Add only conditions the test actually depends on (feature flag state, API availability, data setup)
- No generic boilerplate: avoid `"Test environment is configured"`, `"User has required permissions"`

### Notes field
Must include:
- Related JIRA keys (e.g. `Related: PROJ-456, PROJ-789`)
- Performance targets where applicable (e.g. `API < 500ms, P95 < 5s`)
- Relevant source file paths (e.g. `Component: src/components/Foo/Bar.jsx`)
- Tool requirements (e.g. `axe DevTools, NVDA, WireMock`)

---

## Output Format

CSV with these exact columns (double-quoted, comma-separated):

```
Test Case ID, Title, Priority, Type, Preconditions, Test Steps, Expected Result, Test Data, Notes
```

- `Preconditions` — pipe-separated list
- `Test Steps` — `1. Action -> Expected Result | 2. Action -> Expected Result …`
- `Expected Result` — one clear observable sentence
- `Test Data` — pipe-separated concrete values or mock configs

---

## Quick Prompt

To generate test cases manually in any Bob chat session:

```
Fetch JIRA issue <ISSUE_KEY> via MCP and generate comprehensive manual test cases.
Cover: Functional, Negative, Integration, Performance, Security, Accessibility,
Documentation, Regression.

For each test case include: ID (TC-NNN), Title, Priority (High/Medium/Low), Type,
Preconditions (scenario-specific, pipe-separated), numbered Test Steps with
concrete Action -> Observable Result per step, Expected Result, Test Data,
Notes (related JIRA keys, performance targets, source file paths).

Save as CSV to test-cases/<ISSUE_KEY>-test-cases.csv
```

---

*Reference: [`prompts/test-case-generation.md`](../../prompts/test-case-generation.md) — the master AI reasoning prompt loaded by the workflow.*
