# JIRA Test Case AI Agent

> Reads a JIRA issue via MCP (or REST API) and generates comprehensive manual + Playwright test cases automatically.

## Architecture

```
scripts/
├── agent.ts                        ← CLI entry point / orchestrator
└── test-case-agent/
    ├── types.ts                    ← All TypeScript interfaces
    ├── jira-fetcher.ts             ← JIRA data fetching + ADF normalisation
    ├── ai-analyzer.ts              ← Scenario extraction + issue analysis
    ├── generator.ts                ← TestCase builder (one case per scenario)
    └── exporters.ts                ← Markdown | CSV | JSON | Playwright .spec.ts
```

## How it Works

```
JIRA Issue (MCP / REST API)
        ↓
  jira-fetcher.ts    ← normalises ADF, extracts AC, roles, linked issues
        ↓
  ai-analyzer.ts     ← groups scenarios by category, detects complexity
        ↓
  generator.ts       ← builds rich test cases with typed steps per scenario
        ↓
  exporters.ts       ← writes markdown / CSV / JSON / Playwright skeleton
```

## Quick Start

```bash
# Install
npm install

# Set credentials (REST API mode)
export JIRA_BASE_URL=https://your-org.atlassian.net
export JIRA_USERNAME=you@example.com
export JIRA_API_TOKEN=your_token_here

# Generate for a single issue
npx tsx scripts/agent.ts PROJ-123

# Detailed mode (edge cases, security, performance, regression)
npx tsx scripts/agent.ts PROJ-123 --detailed

# With Playwright skeleton
npx tsx scripts/agent.ts PROJ-123 --detailed --playwright

# Multiple issues
npx tsx scripts/agent.ts PROJ-123 PROJ-124 PROJ-125 --detailed

# CSV export
npx tsx scripts/agent.ts PROJ-123 --format csv
```

## With Bob (MCP Mode)

When using Bob (Roo-Cline) with the Atlassian MCP server:

1. **Ask Bob to fetch the issue:**
   > "Fetch JIRA issue PROJ-123 and generate detailed test cases"

2. **Bob will:**
   - Use `mcp__atlassian__jira_get_issue` to fetch live JIRA data
   - Pass the response through `normaliseFromMcp()` in `jira-fetcher.ts`
   - Run the full analysis + generation pipeline
   - Save outputs to `test-cases/`

3. **Or save the MCP response to a file and run:**
   ```bash
   npx tsx scripts/agent.ts --mcp ./mcp-response.json --detailed
   ```

## Output Formats

| Format | Flag | File | Best For |
|---|---|---|---|
| Markdown | *(default)* | `PROJ-123-test-cases.md` | Documentation |
| CSV | `--format csv` | `PROJ-123-test-cases.csv` | JIRA / Xray import |
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
npm run agent -- PROJ-123             # markdown
npm run agent:detailed -- PROJ-123   # all types
npm run agent:playwright -- PROJ-123  # + .spec.ts
npm run agent:csv -- PROJ-123        # CSV
npm run agent:json -- PROJ-123       # JSON
```

---

*Made with Bob — IBM AI Engineering Toolkit*
