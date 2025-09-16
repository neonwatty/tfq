import fs from 'fs';
import path from 'path';
import os from 'os';
import { ClaudeConfig } from './types.js';

export class ClaudeConfigManager {
  private config: ClaudeConfig;

  constructor(claudeConfig?: ClaudeConfig) {
    // Start with defaults and merge with provided config
    const defaults: ClaudeConfig = {
      enabled: false,
      maxIterations: 20,
      testTimeout: 900000,
      prompt: 'First, detect the testing framework by checking for jest.config.* or vitest.config.* files and examining package.json scripts. Then run the test file at {testFilePath} using the appropriate test runner (npm run test if available, otherwise npx vitest run for Vitest or npx jest --watchAll=false for Jest). Debug any errors you encounter one at a time. After fixing errors, run the test again with the same test runner to verify that your changes have fixed any errors. Finally, run npm run lint to ensure code quality.',
      // Enable verbose output by default to show Claude's real-time progress
      verbose: true,
      outputFormat: 'stream-json',
      // Retry configuration defaults
      maxRetries: 0,  // Default to 0 for backwards compatibility
      retryDelay: 1000,
      retryBackoffMultiplier: 2,
      maxRetryDelay: 30000
    };
    
    // Deep merge the provided config with defaults
    this.config = { ...defaults, ...claudeConfig };
    
    // Validate and set defaults
    if (this.config.enabled) {
      this.validateClaudeConfig(this.config);
    }
  }

  private expandPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    // If path is relative, resolve it relative to current working directory
    if (!path.isAbsolute(filePath)) {
      return path.resolve(process.cwd(), filePath);
    }
    return filePath;
  }

  private validateClaudeConfig(claude: ClaudeConfig): void {
    // Validate testTimeout
    if (claude.testTimeout !== undefined) {
      if (typeof claude.testTimeout !== 'number' || claude.testTimeout < 600000 || claude.testTimeout > 1800000) {
        console.warn('Warning: Claude testTimeout must be a number between 600000ms (10 min) and 1800000ms (30 min)');
        claude.testTimeout = 900000; // Default to 15 minutes
      }
    }
    
    // Validate maxIterations
    if (claude.maxIterations !== undefined) {
      if (typeof claude.maxIterations !== 'number' || claude.maxIterations < 1) {
        console.warn('Warning: Claude maxIterations must be a positive number');
        claude.maxIterations = 20; // Default
      }
    }
    
    // Validate retry configuration
    if (claude.maxRetries !== undefined) {
      if (typeof claude.maxRetries !== 'number' || claude.maxRetries < 0 || claude.maxRetries > 10) {
        console.warn('Warning: Claude maxRetries must be a number between 0 and 10');
        claude.maxRetries = 0; // Default to no retries
      }
    }
    
    if (claude.retryDelay !== undefined) {
      if (typeof claude.retryDelay !== 'number' || claude.retryDelay < 0) {
        console.warn('Warning: Claude retryDelay must be a positive number');
        claude.retryDelay = 1000; // Default to 1 second
      }
    }
    
    if (claude.retryBackoffMultiplier !== undefined) {
      if (typeof claude.retryBackoffMultiplier !== 'number' || claude.retryBackoffMultiplier < 1) {
        console.warn('Warning: Claude retryBackoffMultiplier must be a number >= 1');
        claude.retryBackoffMultiplier = 2; // Default
      }
    }
    
    if (claude.maxRetryDelay !== undefined) {
      if (typeof claude.maxRetryDelay !== 'number' || claude.maxRetryDelay < (claude.retryDelay || 1000)) {
        console.warn('Warning: Claude maxRetryDelay must be >= retryDelay');
        claude.maxRetryDelay = 30000; // Default to 30 seconds
      }
    }
    
    // Validate Claude path if provided
    if (claude.claudePath) {
      const expandedPath = this.expandPath(claude.claudePath);
      try {
        if (!fs.existsSync(expandedPath)) {
          console.warn(`Warning: Claude path '${expandedPath}' does not exist`);
        } else {
          const stat = fs.statSync(expandedPath);
          if (!stat.isFile()) {
            console.warn(`Warning: Claude path '${expandedPath}' is not a file`);
          }
          // Check if file is executable (basic check)
          try {
            fs.accessSync(expandedPath, fs.constants.F_OK | fs.constants.X_OK);
          } catch {
            console.warn(`Warning: Claude path '${expandedPath}' may not be executable`);
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not validate Claude path '${expandedPath}':`, error);
      }
    }
    
    // Validate CLI options
    this.validateCliOptions(claude);
    
    // Set defaults if not provided
    if (claude.enabled && !claude.claudePath) {
      const detectedPath = this.detectClaudePath();
      if (detectedPath) {
        claude.claudePath = detectedPath;
      }
    }
  }

  private validateCliOptions(claude: ClaudeConfig): void {
    // Validate outputFormat
    if (claude.outputFormat && !['text', 'json', 'stream-json'].includes(claude.outputFormat)) {
      console.warn(`Warning: Invalid outputFormat '${claude.outputFormat}', must be 'text', 'json', or 'stream-json'`);
      claude.outputFormat = 'text';
    }

    // Validate inputFormat
    if (claude.inputFormat && !['text', 'stream-json'].includes(claude.inputFormat)) {
      console.warn(`Warning: Invalid inputFormat '${claude.inputFormat}', must be 'text' or 'stream-json'`);
      claude.inputFormat = 'text';
    }

    // Validate maxTurns
    if (claude.maxTurns !== undefined) {
      if (typeof claude.maxTurns !== 'number' || claude.maxTurns < 1) {
        console.warn('Warning: Claude maxTurns must be a positive number');
        claude.maxTurns = undefined;
      }
    }

    // Validate addDir paths
    if (claude.addDir?.length) {
      claude.addDir = claude.addDir.filter(dir => {
        const expandedPath = this.expandPath(dir);
        try {
          if (!fs.existsSync(expandedPath)) {
            console.warn(`Warning: addDir path '${expandedPath}' does not exist`);
            return false;
          }
          const stat = fs.statSync(expandedPath);
          if (!stat.isDirectory()) {
            console.warn(`Warning: addDir path '${expandedPath}' is not a directory`);
            return false;
          }
          return true;
        } catch (error) {
          console.warn(`Warning: Could not validate addDir path '${expandedPath}':`, error);
          return false;
        }
      });
    }

    // Validate tool arrays
    if (claude.allowedTools?.length) {
      claude.allowedTools = claude.allowedTools.filter(tool => {
        if (typeof tool !== 'string' || tool.trim().length === 0) {
          console.warn('Warning: allowedTools must be non-empty strings');
          return false;
        }
        return true;
      });
    }

    if (claude.disallowedTools?.length) {
      claude.disallowedTools = claude.disallowedTools.filter(tool => {
        if (typeof tool !== 'string' || tool.trim().length === 0) {
          console.warn('Warning: disallowedTools must be non-empty strings');
          return false;
        }
        return true;
      });
    }

    // Validate MCP config file path
    if (claude.permissionPromptTool && typeof claude.permissionPromptTool !== 'string') {
      console.warn('Warning: permissionPromptTool must be a string');
      claude.permissionPromptTool = undefined;
    }

    // Warn about conflicting options
    if (claude.dangerouslySkipPermissions && (claude.allowedTools?.length || claude.disallowedTools?.length)) {
      console.warn('Warning: dangerouslySkipPermissions is set with allowedTools/disallowedTools - the tool restrictions may be ignored');
    }

    if (claude.continueSession && claude.resumeSession) {
      console.warn('Warning: Both continueSession and resumeSession are set - resumeSession will take precedence');
    }

    // Warn about verbose/output-format dependency (matches tfq CLI behavior)
    // Note: verbose is now allowed with stream-json for prettified output
    if (claude.verbose && claude.outputFormat === 'json') {
      console.warn('Warning: verbose is disabled when outputFormat is "json" - verbose output conflicts with structured JSON output');
    }
  }

  detectClaudePath(): string | null {
    // Enable debug logging via environment variable for troubleshooting
    const debug = process.env.CLAUDE_DEBUG === 'true';
    
    if (debug) console.log('🔍 Starting Claude path detection...');
    
    // Priority order for Claude path detection
    const candidatePaths = [
      process.env.CLAUDE_PATH,
      path.join(os.homedir(), '.claude', 'local', 'claude'),
      '/usr/local/bin/claude',
      'claude' // Check PATH
    ];
    
    if (debug) console.log(`   Candidate paths to check: ${JSON.stringify(candidatePaths)}`);
    
    for (let i = 0; i < candidatePaths.length; i++) {
      const candidatePath = candidatePaths[i];
      if (debug) console.log(`   [${i + 1}/${candidatePaths.length}] Checking: ${candidatePath || '(empty)'}`);
      
      if (!candidatePath) {
        if (debug) console.log(`     ❌ Empty path, skipping`);
        continue;
      }
      
      try {
        let fullPath = candidatePath;
        
        // For 'claude' command, try to resolve via which/where
        if (candidatePath === 'claude') {
          try {
            const { execSync } = require('child_process');
            const command = process.platform === 'win32' ? 'where claude' : 'which claude';
            if (debug) console.log(`     🔍 Running: ${command}`);
            fullPath = execSync(command, { encoding: 'utf8' }).trim();
            if (debug) console.log(`     ✓ which/where returned: ${fullPath}`);
          } catch (error: any) {
            if (debug) console.log(`     ❌ which/where failed: ${error.message}`);
            continue; // Not found in PATH
          }
        } else {
          fullPath = this.expandPath(candidatePath);
          if (debug) console.log(`     📁 Expanded path: ${fullPath}`);
        }
        
        if (debug) console.log(`     🔍 Checking if path exists: ${fullPath}`);
        if (fs.existsSync(fullPath)) {
          if (debug) console.log(`     ✓ Path exists`);
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            if (debug) console.log(`     ✓ Is a file`);
            try {
              fs.accessSync(fullPath, fs.constants.F_OK | fs.constants.X_OK);
              if (debug) console.log(`     ✅ File is executable! Found Claude at: ${fullPath}`);
              return fullPath;
            } catch (error: any) {
              if (debug) console.log(`     ❌ File not executable: ${error.message}`);
              continue;
            }
          } else {
            if (debug) console.log(`     ❌ Path exists but is not a file`);
          }
        } else {
          if (debug) console.log(`     ❌ Path does not exist`);
        }
      } catch (error: any) {
        if (debug) console.log(`     ❌ Error checking path: ${error.message}`);
        continue;
      }
    }
    
    if (debug) console.log('❌ No valid Claude path found');
    return null;
  }

  getClaudeConfig(): ClaudeConfig {
    return { ...this.config };
  }

  /**
   * Update runtime configuration for verbose mode
   */
  setVerboseMode(outputFormat?: 'text' | 'json' | 'stream-json'): void {
    this.config.verbose = true;
    if (outputFormat) {
      this.config.outputFormat = outputFormat;
    } else if (!this.config.outputFormat) {
      this.config.outputFormat = 'stream-json';
    }
  }

  getClaudePath(overridePath?: string): string | null {
    // Priority: override > env var > config > auto-detect
    if (overridePath) {
      return this.expandPath(overridePath);
    }
    
    if (process.env.CLAUDE_PATH) {
      return this.expandPath(process.env.CLAUDE_PATH);
    }
    
    if (this.config.claudePath) {
      return this.expandPath(this.config.claudePath);
    }
    
    return this.detectClaudePath();
  }

  isEnabled(): boolean {
    return this.config.enabled === true;
  }

  getMaxIterations(): number {
    return this.config.maxIterations || 20;
  }

  getTestTimeout(): number {
    return this.config.testTimeout || 900000;
  }

  /**
   * Check if streaming mode is enabled (when outputFormat is stream-json)
   */
  isStreaming(): boolean {
    return this.config.outputFormat === 'stream-json';
  }

  /**
   * Check if verbose mode is enabled and compatible with output format
   */
  isVerbose(): boolean {
    // Verbose is disabled when using JSON or stream-json output formats
    // to avoid mixing structured and unstructured output
    if (this.config.outputFormat === 'json' || this.config.outputFormat === 'stream-json') {
      return this.config.verbose === true && this.config.outputFormat === 'stream-json';
    }
    return this.config.verbose === true;
  }

  buildCliArguments(): string[] {
    const args = ['-p']; // Always print mode for tfq usage
    
    if (this.config.addDir?.length) {
      args.push('--add-dir', ...this.config.addDir);
    }
    if (this.config.allowedTools?.length) {
      args.push('--allowedTools', ...this.config.allowedTools);
    }
    if (this.config.disallowedTools?.length) {
      args.push('--disallowedTools', ...this.config.disallowedTools);
    }
    if (this.config.appendSystemPrompt) {
      args.push('--append-system-prompt', this.config.appendSystemPrompt);
    }
    if (this.config.outputFormat) {
      args.push('--output-format', this.config.outputFormat);
    }
    if (this.config.inputFormat) {
      args.push('--input-format', this.config.inputFormat);
    }
    // Only add verbose flag if output format is not JSON (matches tfq CLI behavior)
    // But allow verbose with stream-json for prettified output
    if (this.config.verbose && this.config.outputFormat !== 'json') {
      args.push('--verbose');
    }
    if (this.config.maxTurns) {
      args.push('--max-turns', this.config.maxTurns.toString());
    }
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.permissionMode) {
      args.push('--permission-mode', this.config.permissionMode);
    }
    if (this.config.permissionPromptTool) {
      args.push('--permission-prompt-tool', this.config.permissionPromptTool);
    }
    if (this.config.resumeSession) {
      args.push('--resume', this.config.resumeSession);
    }
    if (this.config.continueSession) {
      args.push('--continue');
    }
    if (this.config.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }
    
    // Add any custom arguments
    if (this.config.customArgs?.length) {
      args.push(...this.config.customArgs);
    }
    
    return args;
  }

  static getDefaultClaudeConfig(): ClaudeConfig {
    return {
      enabled: false,
      maxIterations: 20,
      testTimeout: 900000,
      prompt: 'First, detect the testing framework by checking for jest.config.* or vitest.config.* files and examining package.json scripts. Then run the test file at {testFilePath} using the appropriate test runner (npm run test if available, otherwise npx vitest run for Vitest or npx jest --watchAll=false for Jest). Debug any errors you encounter one at a time. After fixing errors, run the test again with the same test runner to verify that your changes have fixed any errors. Finally, run npm run lint to ensure code quality.',
      // Enable verbose output by default to show Claude's real-time progress
      verbose: true,
      outputFormat: 'stream-json',
      model: 'opusplan',
      // Retry configuration defaults
      maxRetries: 0,  // Default to 0 for backwards compatibility
      retryDelay: 1000,
      retryBackoffMultiplier: 2,
      maxRetryDelay: 30000
    };
  }
}