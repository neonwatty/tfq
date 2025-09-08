# TFQ (Test Failure Queue)

TFQ (Test Failure Queue) is a command-line tool designed to help developers efficiently manage and retry failed tests across Javascript / Typscript, Python, and Ruby test frameworks.  It maintains a persistent queue of test failures, allowing you to track, prioritize, and systematically work through test failures across multiple test runs.

TFQ optionally integates with Claude Code for precise context-engineered agentic assistance for test fixing.

## Table of Contents
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Essential Commands](#essential-commands)
- [Supported Languages](#supported-languages)
- [Usage](#usage)
  - [CLI Commands](#cli-commands)
  - [Test Grouping](#test-grouping)
  - [Programmatic API](#programmatic-api)
- [Claude Code Integration](#claude-code-integration)
- [Configuration](#configuration)
- [Use Cases](#use-cases)
- [Development](#development)
- [Contributing](#contributing)


## How It Works

### Complete Workflow Example

Let's walk through using TFQ on a JavaScript project to discover and fix failing tests:

#### Step 0: Initialize TFQ for Your Project
```bash
$ tfq init
Analyzing project at: /path/to/your/project

✓ Detected language: javascript
✓ Detected framework: vitest
✓ Found Claude at: /Users/username/.claude/local/claude

✓ TFQ initialized successfully!

Configuration saved to: .tfqrc

Detected:
  Language: javascript
  Framework: vitest
  Database: ./.tfq/tfq.db
  Claude Code: Enabled (auto-detected)

Next steps:
  1. Run your tests: tfq run-tests --auto-detect --auto-add
  2. View queued failures: tfq list
  3. Get next test to fix: tfq next
  4. Fix tests with Claude Code: tfq fix-next or tfq fix-all
```

#### Step 1: Run Tests to Discover Failures
```bash
$ tfq run-tests --auto-detect
Auto-detected: JavaScript project using Jest
Running: npm test
=============================================
  PASS  src/utils/validator.test.js
  PASS  src/services/user.test.js
  FAIL  src/utils/calculator.test.js
  FAIL  src/api/auth.test.js
  FAIL  src/components/Button.test.js
=============================================
Test Suites: 3 failed, 2 passed, 5 total
Tests:       8 failed, 15 passed, 23 total

✗ 3 tests failed
- src/utils/calculator.test.js
- src/api/auth.test.js
- src/components/Button.test.js
```

#### Step 2: Run tests, Discover Failures, Add Failures to Queue
```bash
$ tfq run-tests --auto-detect --auto-add --priority 5
Running tests and adding failures to queue...
Added 3 failing tests to queue with priority 5
```

#### Step 3: Check Queue Status
```bash
$ tfq list
Queue contains 3 file(s):
1. src/utils/calculator.test.js [P5] (1 failure)
2. src/api/auth.test.js [P5] (1 failure)
3. src/components/Button.test.js [P5] (1 failure)
```

#### Step 4: Work Through Test Failures

After adding failures to the queue, you can work through them systematically:

```bash
# View the next test to work on
$ tfq next
src/utils/calculator.test.js [P5]

# Work on fixing the test manually
# Then mark it as resolved when fixed
$ tfq resolve src/utils/calculator.test.js
✓ Resolved: src/utils/calculator.test.js

# Continue with the next test
$ tfq next
src/api/auth.test.js [P5]
```

## Installation

```bash
npm install tfq
```

Or install globally:

```bash
npm install -g tfq
```

### Getting Started

After installation, initialize TFQ in your project:

```bash
tfq init
```

This command will:
- Auto-detect your project's language and test framework
- Create a `.tfqrc` configuration file
- Set up a project-local database (`./.tfq/tfq.db`)
- Add `.tfq/` to your `.gitignore` (if in a git repository)

**Note:** If you install TFQ globally, each project should run `tfq init` to create its own database. Without initialization, all projects would share the same global database at `~/.tfq/tfq.db`.

## Essential Commands

| Command | What it does |
|---------|--------------|
| `tfq init` | Initialize TFQ for your project |
| `tfq run-tests --auto-add` | Run tests and queue failures |
| `tfq list` | View queued test failures |
| `tfq count` | Get the number of items in queue |
| `tfq stats` | Show queue statistics |
| `tfq clear` | Clear the queue |
| `tfq --help` | Show all commands |

## Supported Languages

### JavaScript/TypeScript
- **Frameworks**: Jest, Mocha, Vitest, Jasmine, AVA
- **Auto-detection**: via package.json dependencies
- **Default command**: `npm test`

### Python
- **Frameworks**: pytest, unittest
- **Auto-detection**: via requirements.txt, setup.py, or pyproject.toml
- **Default command**: `pytest` or `python -m unittest`

### Ruby
- **Frameworks**: Minitest
- **Auto-detection**: via Gemfile or directory structure
- **Default command**: `rails test`


## Usage

### CLI Commands

#### Initialize TFQ for your project
```bash
# Basic initialization with auto-detection (includes Claude integration if available)
tfq init

# Interactive setup mode (asks about Claude integration)
tfq init --interactive

# Initialize with custom database path
tfq init --db-path ./custom/path.db

# Force Claude Code integration setup
tfq init --with-claude

# Skip Claude Code integration setup
tfq init --skip-claude

# Custom Claude executable path
tfq init --claude-path /path/to/claude

# Initialize for CI environment
tfq init --ci

# Initialize for monorepo with workspaces
tfq init --workspace-mode

# Initialize specific sub-project in monorepo
tfq init --scope packages/my-app

# Skip gitignore modification
tfq init --no-gitignore

# JSON output for programmatic use
tfq init --json
```

The `init` command creates a `.tfqrc` configuration file with:
- Project-specific database location (default: `./.tfq/tfq.db`)
- Auto-detected language and test framework
- Default settings for test execution
- **Claude Code integration** (auto-detected if available)

**Options:**
- `--db-path <path>`: Custom database location
- `--interactive`: Step-by-step configuration wizard (includes Claude setup prompts)
- `--with-claude`: Force Claude Code integration setup
- `--skip-claude`: Skip Claude Code integration entirely
- `--claude-path <path>`: Custom Claude executable path
- `--ci`: Use CI-friendly settings (temp database)
- `--shared`: Create team-shared configuration
- `--workspace-mode`: Configure for monorepo
- `--scope <path>`: Target specific directory
- `--no-gitignore`: Don't modify .gitignore
- `--json`: Output configuration as JSON

#### List supported languages and frameworks
```bash
tfq languages
tfq languages --json
```

#### Run tests with language support
```bash
# Auto-detect language and framework
tfq run-tests --auto-detect

# Specify language
tfq run-tests --language javascript --framework jest
tfq run-tests --language python --framework pytest
tfq run-tests --language ruby --framework minitest

# List available frameworks for a language
tfq run-tests --list-frameworks --language python

# Run tests and auto-add failures to queue
tfq run-tests --auto-detect --auto-add --priority 5
```

#### Add a failed test to the queue
```bash
tfq add path/to/test.spec.ts
tfq add path/to/test.spec.ts --priority 5
```

#### View the next test to work on
```bash
tfq next
tfq next --json
```

#### List all queued tests
```bash
tfq list
tfq list --limit 5
tfq list --json
```

#### Get queue count
```bash
tfq count         # Returns just the integer count
tfq count --json  # Returns {success: true, count: N}
```

#### Mark a test as resolved
```bash
tfq resolve path/to/test.spec.ts
```

#### Clear the entire queue
```bash
tfq clear
tfq clear --force  # Skip confirmation
```

#### View queue statistics
```bash
tfq stats
tfq stats --json
```

### Test Grouping

TFQ supports test grouping for optimized execution, enabling parallel processing of independent tests and sequential execution of dependent tests.

#### Set execution groups
```bash
# Simple array format - auto-determines parallel vs sequential
tfq set-groups --json '[["test1.js", "test2.js"], ["test3.js"]]'

# From a file
tfq set-groups --file grouping-plan.json

# Advanced format with explicit types
tfq set-groups --json '{
  "groups": [
    {"groupId": 1, "type": "parallel", "tests": ["auth.test.js", "api.test.js"]},
    {"groupId": 2, "type": "sequential", "tests": ["database.test.js"]}
  ]
}'
```

#### View current groups
```bash
tfq get-groups        # Human-readable format
tfq get-groups --json # JSON format
```

#### Execute groups
```bash
# Dequeue next group of tests
tfq next --group      # Returns all tests in the group
tfq next --group --json

# Preview next group without removing
tfq peek --group
tfq peek --group --json
```

#### Manage groups
```bash
# View grouping statistics
tfq group-stats
tfq group-stats --json

# Clear all grouping data
tfq clear-groups --confirm
```

#### Example: Optimized Test Execution
```bash
# 1. Run tests and add failures to queue
tfq run-tests --auto-detect --auto-add

# 2. Set up intelligent grouping
tfq set-groups --json '[
  ["unit/auth.test.js", "unit/api.test.js", "unit/utils.test.js"],
  ["integration/database.test.js"],
  ["ui/button.test.js", "ui/form.test.js"]
]'

# 3. Execute groups optimally
# Group 1: 3 unit tests (parallel execution possible)
tfq next --group  # Returns all 3 tests

# Group 2: 1 database test (sequential, isolated)
tfq next --group  # Returns 1 test

# Group 3: 2 UI tests (parallel execution possible)
tfq next --group  # Returns both tests
```

### Programmatic API

```typescript
import { TestFailureQueue } from 'tfq';

const queue = new TestFailureQueue();

// Add a failed test
queue.enqueue('/path/to/test.spec.ts', 5);

// Get the next test to work on
const next = queue.dequeue();
if (next) {
  console.log(`Work on: ${next.filePath}`);
}

// List all tests
const allTests = queue.list();

// Resolve a test
queue.resolve('/path/to/test.spec.ts');

// Get statistics
const stats = queue.getStats();
console.log(`Total failures: ${stats.totalItems}`);

// Test Grouping
// Set execution groups (array format)
queue.setExecutionGroups([
  ['test1.js', 'test2.js', 'test3.js'],  // Parallel group
  ['test4.js'],                           // Sequential group
  ['test5.js', 'test6.js']                // Parallel group
]);

// Or use advanced format
queue.setExecutionGroupsAdvanced({
  groups: [
    { groupId: 1, type: 'parallel', tests: ['test1.js', 'test2.js'] },
    { groupId: 2, type: 'sequential', tests: ['test3.js'] }
  ]
});

// Dequeue entire group
const group = queue.dequeueGroup();  // Returns ['test1.js', 'test2.js', 'test3.js']

// Preview next group
const nextGroup = queue.peekGroup();

// Get grouping plan
const plan = queue.getGroupingPlan();

// Check if groups exist
if (queue.hasGroups()) {
  const groupStats = queue.getGroupStats();
  console.log(`Parallel groups: ${groupStats.parallelGroups}`);
}
```

### Core API Usage

The core TFQ functionality is available from the main export, but you can also import directly from the core modules:

```typescript
import { TestFailureQueue } from 'tfq/core/queue';
import { TestDatabase } from 'tfq/core/database';
import { TestRunner } from 'tfq/core/test-runner';
import { ConfigManager } from 'tfq/core/config';

// Use core components directly
const db = new TestDatabase('./custom-tfq.db');
const runner = new TestRunner();
const config = new ConfigManager();
```

## Claude Code Integration

TFQ integrates seamlessly with Claude Code for AI-powered test fixing.

### Automatic Setup
When you run `tfq init`, TFQ automatically detects if Claude Code is installed and configures the integration:

```bash
$ tfq init
✓ Found Claude at: /Users/username/.claude/local/claude
✓ Claude Code integration enabled automatically
```

### Manual Control
```bash
# Force Claude integration setup
tfq init --with-claude

# Skip Claude integration
tfq init --skip-claude

# Use custom Claude path
tfq init --claude-path /custom/path/to/claude

# Interactive setup with Claude prompts
tfq init --interactive
```

### Agentic Test Fixing Commands
Once configured, you can use these commands for automated test fixing:

```bash
# Fix the next test in queue with AI
tfq fix-next

# Fix all tests iteratively with AI  
tfq fix-all --max-iterations 10

# Fix with custom timeout (1-10 minutes allowed)
tfq fix-next --test-timeout 600000
```

### Example Claude Code Slash Commands
Examples of custom slash commands are also provided in the `commands/` directory for agentic use of the `tfq` cli:

- **`/tfq-run`** - Discovers and queues failing tests
- **`/tfq-fix-next`** - Fixes the next test in queue using a Task agent
- **`/tfq-fix-all`** - Complete workflow that runs tests and iteratively fixes all failures
- **`/tfq-reset`** - Clears the queue for a fresh start

These commands leverage Claude Code's Task agents and tools (Bash, Read, Edit) to automatically understand and fix test failures. See `CLAUDE.md` for detailed integration documentation and `plans/slash-commands/` for implementation details.

### Claude CLI Configuration

TFQ supports all Claude Code CLI options through `.tfqrc` configuration. These options directly correspond to the [Claude Code CLI flags](https://docs.anthropic.com/en/docs/claude-code/cli-reference). Add any of these options to the `claude` section:

```json
{
  "claude": {
    "enabled": true,
    "claudePath": "/path/to/claude",
    "maxIterations": 10,
    "testTimeout": 300000,  // 1-10 minutes (60000-600000ms)
    
    // Security & Permissions
    "dangerouslySkipPermissions": true,     // Skip permission prompts (dev mode)
    "allowedTools": ["Edit", "Read", "Write"], // Allowed tools without prompts
    "disallowedTools": ["Bash"],            // Explicitly denied tools
    "permissionMode": "plan",               // Permission handling mode
    
    // Output & Behavior  
    "outputFormat": "text",                 // text|json|stream-json
    "verbose": true,                        // Enable detailed logging
    "maxTurns": 5,                         // Limit conversation turns
    "model": "sonnet",                     // sonnet|opus|full-model-name
    
    // Advanced Options
    "addDir": ["/extra/working/dir"],      // Additional working directories
    "appendSystemPrompt": "Be concise.",   // Append to system prompt
    "continueSession": true,               // Resume most recent conversation
    "customArgs": ["--future-flag"]        // Any additional CLI arguments
  }
}
```

**Common configurations:**

**Safe (default):** Prompts for permissions, limited tools
```json
"claude": {
  "enabled": true,
  "allowedTools": ["Read", "Edit"],
  "verbose": true
}
```

**Development:** Skip permissions for faster iteration
```json
"claude": {
  "enabled": true, 
  "dangerouslySkipPermissions": true,
  "verbose": true
}
```

**Production:** Restricted tools, structured output
```json
"claude": {
  "enabled": true,
  "allowedTools": ["Read"],
  "disallowedTools": ["Bash"],
  "outputFormat": "json"
}
```

## Configuration

The queue database is stored in your home directory by default:
- Location: `~/.tfq/tfq.db`

You can also use a project-specific database by setting the `TFQ_DB_PATH` environment variable:

```bash
export TFQ_DB_PATH=./my-project-tfq.db
```

## Use Cases

### Integration with Test Runners

You can integrate TFQ with your test runner to automatically track failures:

```bash
# Auto-detect and run tests for any language
tfq run-tests --auto-detect --auto-add

# Language-specific examples
tfq run-tests --language javascript --framework jest --auto-add
tfq run-tests --language python --framework pytest --auto-add
tfq run-tests --language ruby --framework minitest --auto-add

# Work through failures one by one
while tfq next; do
  FILE=$(tfq next --json | jq -r '.filePath')
  npm test "$FILE"  # or pytest, minitest, etc.
  if [ $? -eq 0 ]; then
    tfq resolve "$FILE"
  fi
done
```

### Prioritizing Critical Tests

```bash
# Add critical tests with high priority
tfq add src/auth/*.test.ts --priority 10
tfq add src/payments/*.test.ts --priority 9

# Work on high priority tests first
tfq next  # Returns highest priority test
```


## Development

### Building

```bash
npm run build
```

### Testing

```bash
# Run unit and integration tests (default)
npm test

# Run specific test suites
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only

# Other test options
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

### Project Structure

```
tfq/
├── src/
│   ├── index.ts              # Main exports
│   ├── cli.ts                # CLI implementation
│   ├── core/                 # Core TFQ functionality
│   │   ├── queue.ts          # Queue implementation
│   │   ├── database.ts       # Database management
│   │   ├── types.ts          # TypeScript types
│   │   ├── test-runner.ts    # Multi-language test execution
│   │   └── config.ts         # Configuration management
│   └── adapters/             # Language-specific adapters
│       ├── base.ts           # Base adapter interface
│       ├── registry.ts       # Adapter registry
│       ├── javascript-adapter.ts # JavaScript/TypeScript adapter
│       ├── python-adapter.ts     # Python adapter
│       └── ruby-adapter.ts       # Ruby adapter
├── tests/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── dist/                     # Compiled JavaScript
├── bin/
│   └── tfq                   # CLI executable
└── package.json
```

## Testing

TFQ has comprehensive test coverage including unit, integration, and end-to-end tests.

### Running Tests

```bash
# Quick test suite (recommended for development)
npm test                     # Unit, integration, and example tests

# Full test coverage
npm run test:all+e2e         # Includes E2E tests with Claude CLI

# Individual test suites
npm run test:unit            # Unit tests only
npm run test:integration     # Integration tests only
npm run test:examples        # Example tests only
```

### End-to-End Testing with Claude CLI

E2E tests verify complete workflows including real Claude CLI integration:

```bash
# Check if Claude CLI is available
npm run test:e2e:check       # ✅ Claude CLI available

# Run E2E tests (requires Claude CLI installed)
npm run test:e2e             # ~10 minutes, tests real Claude workflows
```

**E2E test coverage includes:**
- TFQ initialization with auto-detection
- Test failure queue management
- Real Claude CLI integration for test fixing
- `fix-next` and `fix-all` workflows
- Error handling and timeout management
- Configuration and progress reporting

**Prerequisites for E2E tests:**
- Claude CLI must be installed (get it from [claude.ai/code](https://claude.ai/code))
- Tests automatically set `TFQ_TEST_CLAUDE=true` environment variable
- Tests run in isolated temporary directories with real test failures

## Contributing

Contributions are welcome!  Please feel free to submit a Pull Request.
