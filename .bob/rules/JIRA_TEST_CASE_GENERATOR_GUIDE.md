# JIRA Manual Test Case Generator Guide

## Overview

The JIRA Test Case Generator is an AI-powered tool that automatically generates comprehensive manual test cases from JIRA issues. It analyzes the issue description, acceptance criteria, and requirements to create detailed test scenarios with steps, expected results, and test data.

## Features

✅ **Automatic Test Case Generation**
- Fetches JIRA issue details using MCP Atlassian server
- Analyzes requirements and acceptance criteria
- Generates multiple test scenarios automatically

✅ **Comprehensive Test Coverage**
- Positive/Happy path scenarios
- Negative test cases (error handling)
- Edge cases and boundary conditions
- UI/UX test cases
- Integration test cases
- Security and performance tests (when applicable)

✅ **Multiple Output Formats**
- **Markdown** - Best for documentation and readability
- **CSV** - Best for importing into test management tools (TestRail, Zephyr, etc.)
- **JSON** - Best for programmatic processing and integration

✅ **Intelligent Analysis**
- Automatically detects test complexity
- Suggests appropriate test types
- Extracts acceptance criteria
- Identifies key test scenarios

## Prerequisites

1. **Bob (Roo-Cline)** must be running
2. **Atlassian MCP server** configured in `.bob/mcp.json`
3. **JIRA credentials** set in environment variables:
   - `JIRA_URL`
   - `JIRA_EMAIL`
   - `JIRA_API_TOKEN`

## How to Use

### Method 1: Using Bob (Recommended)

Simply ask Bob to generate test cases for your JIRA issue:

```
You: "Generate manual test cases for JIRA issue PROJ-123"
```

Or be more specific:

```
You: "Generate detailed manual test cases for PROJ-123 including:
      - Positive scenarios
      - Negative scenarios
      - Edge cases
      - UI test cases
      Export as markdown"
```

Bob will:
1. Fetch the JIRA issue using MCP
2. Analyze the requirements
3. Generate comprehensive test cases
4. Save them in your preferred format

### Method 2: Using the Script Directly

```bash
# Basic usage
npx tsx scripts/jira-test-case-generator.ts PROJ-123

# With options
npx tsx scripts/jira-test-case-generator.ts PROJ-123 --format csv --detailed

# Custom output path
npx tsx scripts/jira-test-case-generator.ts PROJ-123 --output my-tests.md
```

**Options:**
- `--format <format>` - Output format: markdown, csv, json (default: markdown)
- `--output <path>` - Custom output file path
- `--detailed` - Generate detailed test cases including negative and edge cases

## Example Workflow

### Step 1: Fetch JIRA Issue

Ask Bob:
```
"Fetch JIRA issue PROJ-123 and show me the details"
```

Bob will use the MCP tool to fetch:
- Issue summary
- Description
- Acceptance criteria
- Priority
- Components
- Labels

### Step 2: Generate Test Cases

Ask Bob:
```
"Generate manual test cases for this issue in markdown format"
```

Bob will generate test cases like:

```markdown
## PROJ-123-TC-001: Verify User Login - Happy Path

**Priority:** High | **Type:** Functional

### Preconditions
- User has valid credentials
- Application is accessible
- Database is available

### Test Steps

| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Navigate to login page | Login page loads successfully |
| 2 | Enter valid username and password | Credentials are accepted |
| 3 | Click Login button | User is redirected to dashboard |
| 4 | Verify user session | User session is created and active |

### Expected Result
User successfully logs in and is redirected to the dashboard with an active session

### Test Data
- Valid username: testuser@example.com
- Valid password: Test@123
```

### Step 3: Review and Customize

Review the generated test cases and ask Bob to:
- Add more scenarios
- Modify specific test steps
- Add additional test data
- Export in different format

## Output Formats

### Markdown Format (.md)

Best for:
- Documentation
- Sharing with team
- Version control
- Easy readability

Example structure:
```markdown
# Test Cases for PROJ-123

**Issue:** User Login Feature
**Type:** Story
**Priority:** High

---

## PROJ-123-TC-001: Verify User Login - Happy Path
[Test case details...]

## PROJ-123-TC-002: Verify Login with Invalid Credentials
[Test case details...]
```

### CSV Format (.csv)

Best for:
- Importing into test management tools
- Excel/Google Sheets
- Bulk operations

Columns:
- Test Case ID
- Title
- Priority
- Type
- Preconditions
- Test Steps
- Expected Result
- Test Data
- Notes

### JSON Format (.json)

Best for:
- API integration
- Programmatic processing
- Custom tooling

Structure:
```json
{
  "issue": {
    "key": "PROJ-123",
    "summary": "User Login Feature",
    "type": "Story",
    "priority": "High"
  },
  "generatedAt": "2026-04-07T10:00:00.000Z",
  "testCases": [...]
}
```

## Test Case Types Generated

### 1. Functional Tests
Core functionality testing based on requirements

**Example:**
- Verify user can login with valid credentials
- Verify user can submit a form
- Verify data is saved correctly

### 2. Negative Tests
Error handling and validation testing

**Example:**
- Verify error message for invalid login
- Verify validation for empty fields
- Verify system handles missing data

### 3. UI/UX Tests
User interface and experience testing

**Example:**
- Verify page layout matches design
- Verify responsive behavior
- Verify accessibility features

### 4. Integration Tests
System integration and API testing

**Example:**
- Verify data sync between systems
- Verify API responses
- Verify third-party integrations

### 5. Edge Case Tests
Boundary conditions and special scenarios

**Example:**
- Verify minimum/maximum values
- Verify special characters handling
- Verify concurrent user scenarios

### 6. Regression Tests
Ensure existing functionality still works

**Example:**
- Verify existing features after changes
- Verify no side effects
- Verify backward compatibility

## Advanced Usage

### Generate Test Cases for Multiple Issues

Ask Bob:
```
"Generate test cases for JIRA issues PROJ-123, PROJ-124, and PROJ-125"
```

### Generate Test Cases with Specific Focus

Ask Bob:
```
"Generate security-focused test cases for PROJ-123"
"Generate performance test cases for PROJ-124"
"Generate accessibility test cases for PROJ-125"
```

### Customize Test Case Template

Ask Bob:
```
"Generate test cases for PROJ-123 using this template:
- Include test environment setup
- Add test execution time estimates
- Include screenshots placeholders
- Add tester assignment field"
```

## Integration with Test Management Tools

### TestRail
1. Generate test cases in CSV format
2. Import CSV into TestRail
3. Map columns to TestRail fields

### Zephyr
1. Generate test cases in JSON format
2. Use Zephyr API to import
3. Link to JIRA issues

### Xray
1. Generate test cases in Markdown
2. Use Xray import feature
3. Automatically link to JIRA

### Manual Import
1. Generate in preferred format
2. Copy test cases
3. Paste into your test management tool

## Best Practices

### 1. Write Clear JIRA Issues
- Include detailed description
- Add acceptance criteria
- List all requirements
- Mention edge cases

### 2. Review Generated Test Cases
- Verify test steps are accurate
- Add missing scenarios
- Customize test data
- Update expected results

### 3. Maintain Test Cases
- Update when requirements change
- Add new scenarios as discovered
- Remove obsolete test cases
- Keep test data current

### 4. Use Consistent Naming
- Follow project naming conventions
- Use descriptive test case titles
- Include JIRA issue key
- Add test type prefix

### 5. Organize Test Cases
- Group by feature/module
- Prioritize by risk
- Tag by test type
- Link to requirements

## Troubleshooting

### Issue: MCP Server Not Connected

**Solution:**
1. Check `.bob/mcp.json` configuration
2. Verify JIRA credentials in environment variables
3. Restart Bob (Roo-Cline)

### Issue: No Test Cases Generated

**Solution:**
1. Verify JIRA issue exists and is accessible
2. Check issue has description/acceptance criteria
3. Try with `--detailed` flag for more test cases

### Issue: Test Cases Too Generic

**Solution:**
1. Add more details to JIRA issue description
2. Include specific acceptance criteria
3. Ask Bob to generate more specific scenarios
4. Manually customize generated test cases

### Issue: Wrong Output Format

**Solution:**
1. Specify format explicitly: `--format csv`
2. Check file extension in output path
3. Verify format parameter is correct

## Examples

### Example 1: Login Feature

**JIRA Issue:** PROJ-123 - User Login Feature

**Generated Test Cases:**
1. Verify login with valid credentials
2. Verify login with invalid username
3. Verify login with invalid password
4. Verify login with empty fields
5. Verify password masking
6. Verify remember me functionality
7. Verify forgot password link
8. Verify account lockout after failed attempts

### Example 2: API Integration

**JIRA Issue:** PROJ-456 - Payment Gateway Integration

**Generated Test Cases:**
1. Verify successful payment processing
2. Verify payment failure handling
3. Verify payment timeout handling
4. Verify refund processing
5. Verify webhook notifications
6. Verify transaction logging
7. Verify security compliance
8. Verify error response codes

### Example 3: UI Component

**JIRA Issue:** PROJ-789 - Add Search Filter Component

**Generated Test Cases:**
1. Verify filter displays correctly
2. Verify filter options are selectable
3. Verify multiple filter selection
4. Verify filter clear functionality
5. Verify filter results update
6. Verify filter persistence
7. Verify responsive design
8. Verify accessibility features

## FAQ

**Q: Can I generate test cases for epics?**
A: Yes! The tool will analyze the epic and generate high-level test scenarios. For detailed test cases, generate for individual stories.

**Q: Can I customize the test case template?**
A: Yes! Ask Bob to modify the template or edit the generated files directly.

**Q: Can I export to Excel?**
A: Yes! Generate in CSV format and open in Excel.

**Q: Can I integrate with CI/CD?**
A: Yes! Use the JSON format and integrate with your CI/CD pipeline.

**Q: How accurate are the generated test cases?**
A: The accuracy depends on the quality of the JIRA issue description. Always review and customize the generated test cases.

## Support

For issues or questions:
1. Check this documentation
2. Review the troubleshooting section
3. Ask Bob for help
4. Check JIRA MCP server logs

## Version History

- **v1.0.0** - Initial release with basic test case generation
- Supports Markdown, CSV, and JSON formats
- Integrates with Atlassian MCP server
- AI-powered test scenario analysis

---

**Happy Testing! 🎯**