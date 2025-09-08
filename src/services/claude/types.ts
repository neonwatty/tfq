export interface ClaudeConfig {
  enabled: boolean;
  claudePath?: string;
  maxIterations?: number;
  testTimeout?: number;  // Per-test timeout in ms
  prompt?: string;
  _comment?: string;  // Helper comment for users (not used by code)
  
  // Retry configuration for headless mode resilience
  maxRetries?: number;                  // Max retry attempts (0-10, default: 0)
  retryDelay?: number;                  // Initial delay in ms (default: 1000)
  retryBackoffMultiplier?: number;      // Exponential backoff factor (default: 2)
  maxRetryDelay?: number;               // Max delay cap in ms (default: 30000)
  
  // All documented CLI options
  addDir?: string[];                    // --add-dir: Additional working directories
  allowedTools?: string[];              // --allowedTools: Tools allowed without prompting  
  disallowedTools?: string[];           // --disallowedTools: Tools denied without prompting
  appendSystemPrompt?: string;          // --append-system-prompt: Append to system prompt
  outputFormat?: 'text' | 'json' | 'stream-json';  // --output-format
  inputFormat?: 'text' | 'stream-json';             // --input-format  
  verbose?: boolean;                    // --verbose: Enable verbose logging
  maxTurns?: number;                    // --max-turns: Limit agentic turns
  model?: string;                       // --model: Set model (sonnet, opus, full name)
  permissionMode?: string;              // --permission-mode: Begin in permission mode
  permissionPromptTool?: string;        // --permission-prompt-tool: MCP tool for prompts
  resumeSession?: string;               // --resume: Resume session by ID
  continueSession?: boolean;            // --continue: Load most recent conversation  
  dangerouslySkipPermissions?: boolean; // --dangerously-skip-permissions: Skip prompts
  customArgs?: string[];                // Escape hatch for future options
}

export interface ClaudeFixResult {
  success: boolean;
  error?: string;
  duration: number;
  iterations?: number;
  retryAttempts?: number;  // Number of retry attempts made
}

export interface ClaudeValidationResult {
  isValid: boolean;
  error?: string;
  claudePath?: string;
}

export interface ClaudeFixNextResult {
  success: boolean;
  testFound: boolean;
  testPath?: string;
  claudeProcessing?: {
    success: boolean;
    duration: number;
    error?: string;
  };
  verification?: {
    success: boolean;
    exitCode: number;
    duration: number;
    error?: string;
  };
  finalError?: string;
  requeued?: boolean;
  maxRetriesExceeded?: boolean;
}