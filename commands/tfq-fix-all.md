# tfq fix-all - Complete Automated Test Fixing with Claude

## Description
Runs tests to discover failures, then iteratively fixes each test one by one using Claude until the queue is empty or maximum iterations are reached. Includes comprehensive progress tracking and final verification.

## Usage
```bash
tfq fix-all
```

## Options
- `--claude-path <path>` - Path to Claude executable (overrides config)
- `--max-iterations <number>` - Maximum number of tests to fix (default: 20)
- `--test-timeout <ms>` - Timeout per test in milliseconds (overrides config)
- `--json` - Output in JSON format
- `--config <path>` - Custom config file path

## Configuration
Enable Claude integration in your `.tfqrc` file:
```json
{
  "claude": {
    "enabled": true,
    "claudePath": "/Users/username/.claude/local/claude",
    "maxIterations": 20,
    "testTimeout": 420000,
    "prompt": "run the failed test file {testFilePath} and debug any errors you encounter one at a time"
  }
}
```

## Implementation Flow

### Step 1: Discovery Phase
- Clear existing queue to start fresh
- Run test suite to identify all current failures
- Add failing tests to queue with error context
- Exit early if all tests already pass

### Step 2: Iterative Fixing Phase
- Process up to `maxIterations` tests from the queue
- For each test:
  - Launch Claude with the failing test path
  - Include error context from test output
  - Apply configured timeout per test
  - Track success/failure statistics
- Continue until queue empty or max iterations reached

### Step 3: Final Verification Phase
- Run complete test suite to verify all tests pass
- Clear queue if all tests are now passing
- Report final statistics and status

## Progress Tracking
- Real-time progress updates during execution
- Comprehensive statistics:
  - Total tests processed
  - Successfully fixed tests
  - Failed fix attempts
  - Skipped tests (if max iterations reached)
  - Overall success status

## Error Handling
- Configuration validation with clear error messages
- Graceful handling of Claude process failures
- Continue processing even if individual fixes fail
- Timeout management for long-running fixes
- JSON output support for CI/scripting

## Examples
```bash
# Fix all tests with default settings
tfq fix-all

# Fix up to 10 tests maximum
tfq fix-all --max-iterations 10

# Override Claude path and timeout
tfq fix-all --claude-path /custom/path/to/claude --test-timeout 600000

# JSON output for CI integration
tfq fix-all --json
```

## Exit Codes
- `0` - All tests are now passing
- `1` - Some tests still failing or errors occurred

## Output Format
### Standard Output
```
🚀 TFQ Automated Test Fixer with Claude
==================================================

🔄 Step 1: Clearing queue and discovering test failures...
✅ Queue cleared
✅ Tests run and failures added to queue
📊 Found 5 failed tests

🔧 Step 2: Fixing tests iteratively...

🧪 [1/5] Fixing: /path/to/test1.js
✅ Claude processing completed for /path/to/test1.js

🧪 [2/5] Fixing: /path/to/test2.js
❌ Failed to fix test: timeout after 420000ms

🔍 Step 3: Final verification...
✅ Tests run and verification complete
🎉 All tests pass! Queue cleared.

📊 Final Results:
Total tests processed: 5
Successfully fixed: 4
Failed to fix: 1
Skipped tests: 0
Iterations completed: 5
All tests passing: ✅ YES

🎉 All tests are now passing!
```

### JSON Output
```json
{
  "totalTests": 5,
  "fixedTests": 4,
  "failedFixes": 1,
  "skippedTests": 0,
  "allTestsPass": true,
  "iterations": 5
}
```