# Test Coverage Action

A GitHub Action that compares test coverage between your base branch and pull request, helping maintain code quality by detecting coverage regressions.

## Features

- Compares Jest coverage reports between base branch and PR
- Configurable tolerance thresholds for coverage drops
- Enforces minimum coverage for new/renamed files
- Supports ignoring specific paths and file patterns
- Outputs a formatted markdown report for PR comments
- Non-blocking by default (reports issues without failing the build)

## Usage

### Basic Example

```yaml
name: Coverage Check

on:
  pull_request:
    branches: [main]

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Checkout base branch and generate coverage
      - name: Checkout base branch
        uses: actions/checkout@v4
        with:
          ref: ${{ github.base_ref }}
          path: base

      - name: Install dependencies (base)
        run: npm ci
        working-directory: base

      - name: Run tests with coverage (base)
        run: npm test -- --coverage --coverageReporters=json-summary
        working-directory: base

      - name: Move base coverage
        run: |
          mkdir -p coverage-base
          cp base/coverage/coverage-summary.json coverage-base/

      # Checkout PR branch and generate coverage
      - uses: actions/checkout@v4

      - name: Install dependencies (PR)
        run: npm ci

      - name: Run tests with coverage (PR)
        run: npm test -- --coverage --coverageReporters=json-summary

      - name: Move PR coverage
        run: |
          mkdir -p coverage-pr
          cp coverage/coverage-summary.json coverage-pr/

      # Compare coverage
      - name: Compare Coverage
        id: coverage
        uses: Dimitar-Stoimenov/test-coverage-action@v2
        with:
          generalCoverageTolerance: 0.5
          singleLineCoverageTolerance: 5
          newFileCoverageThreshold: 80

      # Post comment on PR if there are issues
      - name: Comment on PR
        if: steps.coverage.outputs.hasIssues == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `${{ steps.coverage.outputs.coverageReport }}`
            })
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `generalCoverageTolerance` | Maximum allowed drop in overall coverage percentage | Yes | `0.03` |
| `singleLineCoverageTolerance` | Maximum allowed drop in coverage percentage for a single file | Yes | `5` |
| `newFileCoverageThreshold` | Minimum required coverage percentage for new or renamed files | Yes | `40` |
| `ignoredPaths` | Comma-separated list of folder paths to ignore | No | - |
| `excludeFilePatterns` | Comma-separated regex patterns to exclude files by name | No | - |

### Input Details

#### `generalCoverageTolerance`
The maximum allowed decrease in overall project coverage. If coverage drops more than this percentage, the action will report an issue.

#### `singleLineCoverageTolerance`
The maximum allowed decrease in coverage for any single file. This helps catch cases where one file's coverage drops significantly even if overall coverage remains stable.

#### `newFileCoverageThreshold`
New files (or renamed files) must meet this minimum coverage threshold. This ensures new code is properly tested before merging.

#### `ignoredPaths`
Paths to folders that should be excluded from coverage comparison. Useful for generated code, migrations, or third-party code.

```yaml
ignoredPaths: "migrations,scripts,generated"
```

#### `excludeFilePatterns`
Regex patterns to exclude files by their filename (not full path). Multiple patterns can be separated by commas.

```yaml
excludeFilePatterns: ".*\\.mock\\.ts,.*\\.test\\.ts"
```

## Outputs

| Output | Description |
|--------|-------------|
| `hasIssues` | `"true"` if coverage issues were detected, `"false"` otherwise |
| `coverageReport` | Formatted markdown report suitable for PR comments |

## Expected File Structure

The action expects Jest coverage summary files in specific locations:

```
your-repo/
├── coverage-base/
│   └── coverage-summary.json    # Coverage from base branch
└── coverage-pr/
    └── coverage-summary.json    # Coverage from PR branch
```

Generate these files by running Jest with the `json-summary` reporter:

```bash
jest --coverage --coverageReporters=json-summary
```

## How It Works

1. **Reads coverage files**: Loads `coverage-summary.json` from both `coverage-base/` and `coverage-pr/` directories

2. **Compares overall coverage**: Checks if statements or branches coverage dropped more than `generalCoverageTolerance`

3. **Compares per-file coverage**: For each file, checks if coverage dropped more than `singleLineCoverageTolerance`

4. **Validates new files**: Ensures new/renamed files meet the `newFileCoverageThreshold`

5. **Generates report**: Creates a markdown-formatted report with all issues found

## Example Output

When coverage issues are detected, the action generates a report like:

```markdown
## ⚠️ Coverage Report

### Coverage Difference
| Metric | Diff |
|--------|------|
| Statements | -2.50% |
| Branches | -1.30% |

### Files with Coverage Issues

- `src/utils/helper.ts` - Statements Diff: -8.50% | Branches Diff: -12.00%
- `src/newFeature.ts` - new or renamed file that does not meet the test coverage threshold of 80%! >>> Statements: 45.00%, Branches: 30.00%
```

## Development

### Prerequisites

- Node.js 16+
- npm

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

This compiles TypeScript and bundles the action using `@vercel/ncc`.

### Project Structure

```
test-coverage-action/
├── src/
│   └── index.ts          # Main action logic
├── lib/                  # Compiled TypeScript output
├── dist/
│   └── index.js          # Bundled action (committed)
├── action.yml            # Action metadata
├── package.json
└── tsconfig.json
```

## License

ISC

## Author

Dimitar Stoimenov
