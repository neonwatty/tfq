import chalk from 'chalk';

/**
 * Format tool input JSON for better readability in verbose output
 */
export function formatToolInput(toolName: string, input: any): string {
  try {
    // Handle null/undefined
    if (input === null) return 'null';
    if (input === undefined) return 'undefined';

    switch (toolName) {
      case 'TodoWrite':
        return formatTodoWrite(input);
      case 'Read':
        return formatRead(input);
      case 'Bash':
        return formatBash(input);
      case 'Edit':
      case 'MultiEdit':
        return formatEdit(input);
      case 'Write':
        return formatWrite(input);
      case 'Grep':
        return formatGrep(input);
      case 'Glob':
        return formatGlob(input);
      case 'WebFetch':
      case 'WebSearch':
        return formatWeb(input);
      case 'NotebookEdit':
        return formatNotebook(input);
      case 'KillBash':
      case 'BashOutput':
        return formatBashControl(input);
      default:
        return formatGeneric(input);
    }
  } catch (error) {
    // Handle circular references and other JSON.stringify errors
    try {
      const seen = new WeakSet();
      return JSON.stringify(input, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        return value;
      }, 2);
    } catch {
      return String(input);
    }
  }
}

/**
 * Truncate string with ellipsis
 */
function truncateString(str: string, maxLength: number): string {
  if (!str) return '';
  const cleaned = str.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.substring(0, maxLength - 3)}...`;
}

/**
 * Format TodoWrite tool input
 */
function formatTodoWrite(input: any): string {
  const lines: string[] = [];
  lines.push('');
  
  if (input.todos && Array.isArray(input.todos)) {
    lines.push(chalk.cyan(`  📝 Managing ${input.todos.length} todos:`));
    input.todos.slice(0, 3).forEach((todo: any, i: number) => {
      const status = todo.status === 'completed' ? '✅' : 
                     todo.status === 'in_progress' ? '🔄' : '⏳';
      lines.push(chalk.gray(`     ${i + 1}. ${status} ${truncateString(todo.content || todo.activeForm, 50)}`));
    });
    if (input.todos.length > 3) {
      lines.push(chalk.gray(`     ... and ${input.todos.length - 3} more`));
    }
  }
  
  return lines.join('\n');
}

/**
 * Format Bash tool input
 */
function formatBash(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.command) {
    const truncatedCommand = truncateString(input.command, 100);
    lines.push(chalk.yellow(`  💻 Command: ${truncatedCommand}`));
  }
  if (input.description) {
    lines.push(chalk.gray(`  📝 ${input.description}`));
  }
  if (input.timeout) {
    lines.push(chalk.gray(`  ⏱️  Timeout: ${input.timeout}ms`));
  }
  if (input.run_in_background) {
    lines.push(chalk.magenta(`  🔄 Running in background`));
  }

  return lines.join('\n');
}

/**
 * Format Read tool input
 */
function formatRead(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.file_path) {
    lines.push(chalk.blue(`  📁 File: ${input.file_path}`));
  }
  if (input.limit) {
    lines.push(chalk.gray(`  📏 Limit: ${input.limit} lines`));
  }
  if (input.offset) {
    lines.push(chalk.gray(`  📍 Offset: line ${input.offset}`));
  }

  return lines.join('\n');
}

/**
 * Format Edit/MultiEdit tool input
 */
function formatEdit(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.file_path) {
    lines.push(chalk.green(`  📝 Editing: ${input.file_path}`));
  }
  
  if (input.edits && Array.isArray(input.edits)) {
    lines.push(chalk.gray(`  🔧 ${input.edits.length} edit operations`));
    input.edits.slice(0, 2).forEach((edit: any, i: number) => {
      const oldStr = truncateString(edit.old_string, 30);
      const newStr = truncateString(edit.new_string, 30);
      lines.push(chalk.gray(`     ${i + 1}. "${oldStr}" → "${newStr}"`));
    });
    if (input.edits.length > 2) {
      lines.push(chalk.gray(`     ... and ${input.edits.length - 2} more edits`));
    }
  } else {
    if (input.old_string) {
      lines.push(chalk.red(`  - Old: ${truncateString(input.old_string, 60)}`));
    }
    if (input.new_string) {
      lines.push(chalk.green(`  + New: ${truncateString(input.new_string, 60)}`));
    }
    if (input.replace_all) {
      lines.push(chalk.yellow(`  🔄 Replace all occurrences`));
    }
  }

  return lines.join('\n');
}

/**
 * Format Write tool input
 */
function formatWrite(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.file_path) {
    lines.push(chalk.green(`  ✍️  Writing: ${input.file_path}`));
  }
  if (input.content) {
    const lineCount = (input.content.match(/\n/g) || []).length + 1;
    const charCount = input.content.length;
    lines.push(chalk.gray(`  📄 Content: ${lineCount} lines, ${charCount} chars`));
    // Show first line of content
    const firstLine = input.content.split('\n')[0];
    if (firstLine) {
      lines.push(chalk.gray(`     Preview: ${truncateString(firstLine, 60)}`));
    }
  }

  return lines.join('\n');
}

/**
 * Format Grep tool input
 */
function formatGrep(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.pattern) {
    lines.push(chalk.magenta(`  🔍 Pattern: ${truncateString(input.pattern, 60)}`));
  }
  if (input.path) {
    lines.push(chalk.gray(`  📂 Path: ${input.path}`));
  }
  if (input.glob) {
    lines.push(chalk.gray(`  🎯 Glob: ${input.glob}`));
  }
  if (input.type) {
    lines.push(chalk.gray(`  📦 Type: ${input.type}`));
  }
  if (input.output_mode) {
    lines.push(chalk.gray(`  📊 Mode: ${input.output_mode}`));
  }
  
  const flags = [];
  if (input['-i']) flags.push('case-insensitive');
  if (input['-n']) flags.push('line-numbers');
  if (input.multiline) flags.push('multiline');
  if (flags.length > 0) {
    lines.push(chalk.gray(`  🚩 Flags: ${flags.join(', ')}`));
  }

  return lines.join('\n');
}

/**
 * Format Glob tool input
 */
function formatGlob(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.pattern) {
    lines.push(chalk.cyan(`  🎯 Pattern: ${input.pattern}`));
  }
  if (input.path) {
    lines.push(chalk.gray(`  📂 Path: ${input.path}`));
  }

  return lines.join('\n');
}

/**
 * Format Web-related tool input (WebFetch, WebSearch)
 */
function formatWeb(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.url) {
    lines.push(chalk.blue(`  🌐 URL: ${truncateString(input.url, 80)}`));
  }
  if (input.query) {
    lines.push(chalk.blue(`  🔎 Query: ${truncateString(input.query, 60)}`));
  }
  if (input.prompt) {
    lines.push(chalk.gray(`  💭 Prompt: ${truncateString(input.prompt, 80)}`));
  }
  if (input.allowed_domains?.length) {
    lines.push(chalk.gray(`  ✅ Allowed domains: ${input.allowed_domains.join(', ')}`));
  }
  if (input.blocked_domains?.length) {
    lines.push(chalk.gray(`  ⛔ Blocked domains: ${input.blocked_domains.join(', ')}`));
  }

  return lines.join('\n');
}

/**
 * Format NotebookEdit tool input
 */
function formatNotebook(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.notebook_path) {
    lines.push(chalk.magenta(`  📓 Notebook: ${input.notebook_path}`));
  }
  if (input.cell_id) {
    lines.push(chalk.gray(`  🔢 Cell ID: ${input.cell_id}`));
  }
  if (input.cell_type) {
    lines.push(chalk.gray(`  📝 Cell type: ${input.cell_type}`));
  }
  if (input.edit_mode) {
    lines.push(chalk.yellow(`  ✏️  Mode: ${input.edit_mode}`));
  }
  if (input.new_source) {
    const lineCount = (input.new_source.match(/\n/g) || []).length + 1;
    lines.push(chalk.gray(`  📄 New content: ${lineCount} lines`));
  }

  return lines.join('\n');
}

/**
 * Format Bash control tools (KillBash, BashOutput)
 */
function formatBashControl(input: any): string {
  const lines: string[] = [];
  lines.push('');

  if (input.shell_id || input.bash_id) {
    lines.push(chalk.yellow(`  🆔 Shell ID: ${input.shell_id || input.bash_id}`));
  }
  if (input.filter) {
    lines.push(chalk.gray(`  🔍 Filter: ${truncateString(input.filter, 60)}`));
  }

  return lines.join('\n');
}

/**
 * Format generic tool input as pretty JSON
 */
function formatGeneric(input: any): string {
  const formatted = JSON.stringify(input, null, 2);
  const lines = formatted.split('\n');
  return `\n${lines.map(line => `  ${line}`).join('\n')}`;
}