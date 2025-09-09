# Stream-JSON Output Prettification for Claude Integration

## Overview

The `--verbose` flag has been enhanced to provide real-time, human-readable output when using Claude Code CLI with TFQ. When enabled, it automatically uses the `stream-json` output format and prettifies the JSON stream for better visibility into Claude's test-fixing process.

## Usage

### Enable verbose output for fix-next

```bash
tfq fix-next --verbose
```

### Enable verbose output for fix-all

```bash
tfq fix-all --verbose --max-iterations 5
```

### Configure in .tfqrc

You can also enable verbose mode in your configuration file:

```json
{
  "claude": {
    "enabled": true,
    "verbose": true,
    "outputFormat": "stream-json"
  }
}
```

## Output Examples

When verbose mode is enabled, you'll see formatted output like:

```
🤖 Claude: I'll analyze your test file now.
🔧 Using Read:
  📁 File: /src/test.js
✅ Tool result: File contents successfully read
🔧 Using Bash:
  💻 Command: npm test
  📝 Running test suite
✅ Tool result: All tests passed
🎉 Final result: Task completed successfully
⏱️  Duration: 15234ms
💰 Cost: $0.0234
```

## Tool-Specific Formatting

The verbose output provides specialized formatting for each Claude tool:

- **TodoWrite**: Shows task management with status icons (✅ completed, 🔄 in_progress, ⏳ pending)
- **Read**: Displays file path, line limits, and offsets
- **Bash**: Shows commands, descriptions, and execution flags
- **Edit/MultiEdit**: Highlights old/new text changes
- **Write**: Shows file paths and content preview
- **Grep**: Displays search patterns and flags
- **Glob**: Shows file patterns being matched
- **Web tools**: Formats URLs and queries

## Features

1. **Real-time streaming**: Output appears as Claude processes, not after completion
2. **Smart truncation**: Long outputs are truncated with ellipsis to maintain readability
3. **Colored output**: Uses chalk for colored terminal output
4. **JSON parsing**: Gracefully handles malformed JSON lines
5. **Backward compatible**: Original text streaming still works when verbose is off

## Implementation Details

The implementation consists of:

1. **JSON Formatter** (`src/cli/utils/json-formatter.ts`): Tool-specific formatters for pretty output
2. **Stream Processing** (`src/services/claude/claude-service.ts`): Real-time JSON stream parsing
3. **Configuration** (`src/services/claude/config.ts`): Helper methods for streaming/verbose detection
4. **CLI Options** (`src/cli.ts`): Added `--verbose` flag to fix commands

## Notes

- Verbose mode automatically enables `stream-json` output format
- When using `--json` output, verbose mode is disabled to avoid mixing formats
- The feature maintains backward compatibility with existing configurations
- All existing tests pass with the new implementation