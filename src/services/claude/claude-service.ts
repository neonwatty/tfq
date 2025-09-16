import { execa } from 'execa';
import { ClaudeConfig, ClaudeFixResult, ClaudeValidationResult, ClaudeFixNextResult } from './types.js';
import { ClaudeConfigManager } from './config.js';
import { ConfigManager } from '../../core/config.js';
import { TestFailureQueue } from '../../core/queue.js';
import { TestRunner } from '../../core/test-runner.js';
import { withRetry, RetryConfig, formatRetryStats } from './retry-utils.js';
import { formatToolInput } from '../../cli/utils/json-formatter.js';

export class ClaudeService {
  private config: ClaudeConfig;
  private claudePath: string | null = null;
  private claudeConfigManager: ClaudeConfigManager;
  private configManager: ConfigManager;

  constructor(configPath?: string, overrideClaudePath?: string) {
    // Get base config from ConfigManager
    this.configManager = ConfigManager.getInstance(configPath);
    const baseConfig = this.configManager.getConfig();
    
    // Initialize Claude config manager with config from base
    this.claudeConfigManager = new ClaudeConfigManager(baseConfig.claude);
    this.config = this.claudeConfigManager.getClaudeConfig();
    
    this.claudePath = this.claudeConfigManager.getClaudePath(overrideClaudePath);
  }

  // Getter for accessing the config manager (for runtime config updates)
  getClaudeConfigManager(): ClaudeConfigManager {
    return this.claudeConfigManager;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }
    
    if (!this.claudePath) {
      return false;
    }
    
    try {
      // Quick test to see if Claude responds
      const result = await execa(this.claudePath, ['--version'], {
        timeout: 5000, // 5 second timeout for version check
        reject: false
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  validateConfiguration(): ClaudeValidationResult {
    if (!this.config.enabled) {
      return {
        isValid: false,
        error: 'Claude integration is disabled in configuration'
      };
    }
    
    if (!this.claudePath) {
      return {
        isValid: false,
        error: 'Claude path not found. Please check your configuration or install Claude Code CLI.'
      };
    }
    
    return {
      isValid: true,
      claudePath: this.claudePath
    };
  }

  async fixTest(filePath: string, errorContext?: string, timeoutOverride?: number): Promise<ClaudeFixResult> {
    const startTime = Date.now();
    
    // Validate configuration first
    const validation = this.validateConfiguration();
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
        duration: Date.now() - startTime
      };
    }
    
    // Use the prompt from config (either user's custom or default from ClaudeConfigManager)
    // The prompt is guaranteed to be defined by ClaudeConfigManager defaults
    let prompt = this.config.prompt!;

    // Replace the {testFilePath} placeholder with the actual file path
    prompt = prompt.replace('{testFilePath}', filePath);
    
    if (errorContext) {
      prompt += `\n\nPrevious error context:\n${errorContext}`;
    }
    
    // Set up retry configuration (declare here for access in catch block)
    const retryConfig: RetryConfig = {
      maxRetries: this.config.maxRetries ?? 0,  // Default to 0 for backwards compatibility
      retryDelay: this.config.retryDelay ?? 1000,
      retryBackoffMultiplier: this.config.retryBackoffMultiplier ?? 2,
      maxRetryDelay: this.config.maxRetryDelay ?? 30000,
      verbose: this.config.verbose
    };
    
    try {
      const timeout = timeoutOverride || this.config.testTimeout || 900000; // Use override or default 15 minutes
      
      console.log('🔄 Starting Claude CLI with real-time streaming...');
      console.log('📝 Using prompt:', prompt.substring(0, 200) + '...');
      console.log('⏰ Timeout set to:', timeout, 'ms');
      if (retryConfig.maxRetries > 0) {
        console.log('🔁 Retry enabled: max', retryConfig.maxRetries, 'attempts');
      }
      
      // Wrap the Claude execution in retry logic
      const retryResult = await withRetry(
        async () => this.executeClaudeProcess(prompt, timeout),
        retryConfig,
        `Claude fix for ${filePath}`
      );
      
      const { success, error, outputLength } = retryResult.result;
      const retryStats = formatRetryStats(retryResult.retryAttempts);
      
      if (retryStats) {
        console.log(`✅ Claude CLI process completed${retryStats}`);
      } else {
        console.log('✅ Claude CLI process completed');
      }
      
      return {
        success,
        error,
        duration: Date.now() - startTime,
        retryAttempts: retryResult.retryAttempts
      };
    } catch (error: any) {
      console.log('❌ Claude process failed:', error.message);
      
      const effectiveTimeout = timeoutOverride || this.config.testTimeout || 900000;
      let errorMessage = 'Unknown error';
      let retryAttempts = 0;
      
      if (error.originalError) {
        // This is a RetryableError with the original error
        const origError = error.originalError;
        retryAttempts = retryConfig.maxRetries; // We exhausted all retries
        
        if (origError.timedOut) {
          errorMessage = `Claude timed out after ${effectiveTimeout}ms${retryConfig.maxRetries > 0 ? ' (after retries)' : ''}`;
        } else if (origError.exitCode !== undefined) {
          errorMessage = `Claude exited with code ${origError.exitCode}${retryConfig.maxRetries > 0 ? ' (after retries)' : ''}`;
          if (origError.stderr) {
            errorMessage += `: ${origError.stderr}`;
          }
        } else {
          errorMessage = error.message;
        }
      } else {
        // Non-retryable error or direct error
        if (error.timedOut) {
          errorMessage = `Claude timed out after ${effectiveTimeout}ms`;
        } else if (error.exitCode !== undefined) {
          errorMessage = `Claude exited with code ${error.exitCode}`;
          if (error.stderr) {
            errorMessage += `: ${error.stderr}`;
          }
        } else if (error.message) {
          errorMessage = error.message;
        }
      }
      
      return {
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
        retryAttempts
      };
    }
  }

  private async executeClaudeProcess(prompt: string, timeout: number): Promise<{ success: boolean; error?: string; outputLength: number }> {
    try {
      // Build CLI arguments
      const cliArgs = this.claudeConfigManager.buildCliArguments();
      
      // Debug: Log the arguments being passed
      if (this.claudeConfigManager.isVerbose()) {
        console.log('🔍 Claude CLI args:', cliArgs.join(' '));
      }
      
      // Configure execution options - always use streaming for real-time output
      const execOptions: any = {
        timeout,
        env: process.env,
        buffer: false, // Don't buffer output - always stream for real-time feedback
        input: prompt // Pass prompt via stdin instead of command line argument
      };
      
      // Check if we should use enhanced JSON formatting
      // Only use verbose output if explicitly enabled (not just because stream-json is set)
      const isVerbose = this.claudeConfigManager.isVerbose();
      const shouldPrettifyJson = isVerbose && this.claudeConfigManager.isStreaming();
      
      const childProcess = execa(this.claudePath!, cliArgs, execOptions);

      let outputBuffer = '';
      let errorBuffer = '';
      let allOutput = '';

      // Always stream stdout for real-time feedback
      childProcess.stdout?.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        outputBuffer += data;
        allOutput += data;
        
        // Only prettify JSON when verbose is explicitly enabled with stream-json format
        if (shouldPrettifyJson) {
          // Process accumulated buffer for complete JSON objects
          this.displayVerboseOutput(outputBuffer);
          // Clear successfully processed content from buffer
          const lines = outputBuffer.split('\n');
          outputBuffer = lines[lines.length - 1] || ''; // Keep last incomplete line
        } else {
          // Original text-based streaming
          const lines = outputBuffer.split('\n');
          outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.trim()) {
              console.log('📤 Claude:', line);
            }
          }
        }
      });

      // Stream stderr (errors)
      childProcess.stderr?.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        errorBuffer += data;
        console.log('⚠️  Claude stderr:', data.trim());
      });

      console.log('⏳ Waiting for Claude process to complete...');
      const result = await childProcess;
      console.log('🏁 Claude process finished with exit code:', result.exitCode);
      
      // Process any remaining buffered output
      if (outputBuffer.trim()) {
        if (shouldPrettifyJson) {
          this.displayVerboseOutput(outputBuffer);
        } else {
          console.log('📤 Claude final output:', outputBuffer.trim());
        }
      }
      
      console.log(`📄 Total output length: ${allOutput.length} characters`);
      
      // Determine success/error based on Claude Code exit status
      let errorMessage: string | undefined;
      let success = result.exitCode === 0;
      
      if (!success) {
        if (errorBuffer) {
          errorMessage = errorBuffer.trim();
        } else {
          errorMessage = 'Claude process failed';
        }
      }
      
      return {
        success,
        error: errorMessage,
        outputLength: allOutput.length
      };
    } catch (error: any) {
      console.log('❌ Claude process error:', error.message);
      console.log('🔍 Error details - timedOut:', error.timedOut, 'exitCode:', error.exitCode, 'signal:', error.signal);
      
      // Re-throw the error to be handled by retry logic
      throw error;
    }
  }

  getConfig(): ClaudeConfig {
    return { ...this.config };
  }

  getClaudePath(): string | null {
    return this.claudePath;
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

  async fixNextTest(queue: TestFailureQueue, options: {
    testTimeout?: number;
    configPath?: string;
    useJsonOutput?: boolean;
  } = {}): Promise<ClaudeFixNextResult> {
    // Check if Claude is available and configured
    if (!this.isEnabled()) {
      return {
        success: false,
        testFound: false,
        finalError: 'Claude integration is disabled. Enable it in your .tfqrc config file.'
      };
    }
    
    const validation = this.validateConfiguration();
    if (!validation.isValid) {
      return {
        success: false,
        testFound: false,
        finalError: validation.error
      };
    }
    
    // Get next test from queue
    const nextItem = queue.dequeueWithContext();
    if (!nextItem) {
      return {
        success: false,
        testFound: false,
        finalError: 'Queue is empty'
      };
    }
    
    const testPath = nextItem.filePath;
    const errorContext = nextItem.error;
    
    if (!options.useJsonOutput) {
      console.log(`🤖 Fixing test with Claude: ${testPath}`);
    }
    
    // Apply timeout override if provided
    let timeoutOverride: number | undefined;
    if (options.testTimeout) {
      const timeout = parseInt(options.testTimeout.toString(), 10);
      if (!isNaN(timeout) && timeout >= 600000 && timeout <= 1800000) {
        timeoutOverride = timeout;
      }
    }
    
    // Fix the test
    const fixResult = await this.fixTest(testPath, errorContext, timeoutOverride);
    
    // Verify the fix if Claude processing was successful
    let verificationResult: {
      success: boolean;
      exitCode: number;
      duration: number;
      error?: string;
    } | undefined = undefined;
    let finalSuccess = fixResult.success;
    let finalError = fixResult.error;
    let requeued = false;
    let maxRetriesExceeded = false;
    
    if (fixResult.success) {
      try {
        if (!options.useJsonOutput) {
          console.log('🔍 Verifying fix by running the test...');
        }
        
        // Create TestRunner with the specific test file and auto-detection
        const verificationRunner = new TestRunner({
          testPath: testPath,
          verbose: false,
          configPath: options.configPath,
          autoDetect: true  // Ensure framework is properly detected for verification
        });
        
        const testResult = verificationRunner.run();
        verificationResult = {
          success: testResult.success,
          exitCode: testResult.exitCode,
          duration: testResult.duration,
          error: testResult.error || undefined
        };
        
        if (testResult.success) {
          if (!options.useJsonOutput) {
            console.log('✅ Test verification passed - fix confirmed!');
          }
          finalSuccess = true;
        } else {
          if (!options.useJsonOutput) {
            console.log('⚠️ Test verification failed - re-adding to queue');
            console.log(`Verification error: ${testResult.error || 'Test still fails'}`);
          }
          
          // Re-enqueue with updated error context and incremented failure count
          const maxRetries = this.config.maxIterations || 3; // Use maxIterations from Claude config
          if (nextItem.failureCount < maxRetries) {
            const newErrorContext = `Previous attempt: ${errorContext || 'No context'}\nVerification failed: ${testResult.stderr || testResult.error || 'Test still fails'}`;
            queue.enqueue(testPath, nextItem.priority, newErrorContext);
            requeued = true;
            
            if (!options.useJsonOutput) {
              console.log(`🔄 Re-enqueued test (attempt ${nextItem.failureCount + 1}/${maxRetries})`);
            }
          } else {
            maxRetriesExceeded = true;
            if (!options.useJsonOutput) {
              console.log(`❌ Max retries (${maxRetries}) exceeded - not re-enqueueing`);
            }
          }
          
          finalSuccess = false;
          finalError = `Fix verification failed: ${testResult.error || 'Test still fails'}`;
        }
      } catch (verificationError: any) {
        if (!options.useJsonOutput) {
          console.log('❌ Test verification failed with error:', verificationError.message);
        }
        
        // Re-enqueue with verification error
        const maxRetries = this.config.maxIterations || 3;
        if (nextItem.failureCount < maxRetries) {
          const newErrorContext = `Previous attempt: ${errorContext || 'No context'}\nVerification error: ${verificationError.message}`;
          queue.enqueue(testPath, nextItem.priority, newErrorContext);
          requeued = true;
          
          if (!options.useJsonOutput) {
            console.log(`🔄 Re-enqueued test due to verification error (attempt ${nextItem.failureCount + 1}/${maxRetries})`);
          }
        } else {
          maxRetriesExceeded = true;
        }
        
        finalSuccess = false;
        finalError = `Verification error: ${verificationError.message}`;
      }
    }
    
    return {
      success: finalSuccess,
      testFound: true,
      testPath: testPath,
      claudeProcessing: {
        success: fixResult.success,
        duration: fixResult.duration,
        error: fixResult.error
      },
      verification: verificationResult,
      finalError: finalError,
      requeued,
      maxRetriesExceeded
    };
  }

  /**
   * Display human-readable verbose output from Claude's JSON stream
   */
  private displayVerboseOutput(jsonText: string): void {
    try {
      // Split by newlines and process each potential JSON object
      const lines = jsonText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) continue;

        try {
          const parsed = JSON.parse(trimmed);

          // Display different types of messages
          if (parsed.type === 'assistant' && parsed.message) {
            const content = parsed.message.content;
            if (Array.isArray(content)) {
              for (const item of content) {
                if (item.type === 'text' && item.text) {
                  console.log(`🤖 Claude: ${item.text}`);
                } else if (item.type === 'tool_use') {
                  const formattedInput = formatToolInput(item.name, item.input);
                  console.log(`🔧 Using ${item.name}:${formattedInput}`);
                }
              }
            }
          } else if (parsed.type === 'user' && parsed.message) {
            const content = parsed.message.content;
            if (Array.isArray(content)) {
              for (const item of content) {
                if (item.type === 'tool_result' && !item.is_error) {
                  // Truncate long tool results
                  const resultText = typeof item.content === 'string' 
                    ? item.content 
                    : JSON.stringify(item.content);
                  const truncated = resultText.length > 200 
                    ? resultText.substring(0, 200) + '...'
                    : resultText;
                  console.log(`✅ Tool result: ${truncated}`);
                } else if (item.type === 'tool_result' && item.is_error) {
                  console.log(`❌ Tool error: ${item.content}`);
                }
              }
            }
          } else if (parsed.type === 'result') {
            if (parsed.subtype === 'success') {
              console.log(`🎉 Final result: Task completed successfully`);
              if (parsed.duration_ms) {
                console.log(`⏱️  Duration: ${parsed.duration_ms}ms`);
              }
              if (parsed.total_cost_usd) {
                console.log(`💰 Cost: $${parsed.total_cost_usd}`);
              }
            } else if (parsed.is_error) {
              console.log(`❌ Claude error: ${parsed.error || 'Unknown error'}`);
            }
          } else if (parsed.type === 'system' && parsed.subtype === 'init') {
            console.log('🔧 Claude initialized');
            if (parsed.model) {
              console.log(`🎯 Model: ${parsed.model}`);
            }
          } else if (parsed.type === 'error') {
            console.log(`🚨 Error: ${parsed.error || parsed.message || 'Unknown error'}`);
          }
        } catch (parseError) {
          // Ignore individual JSON parse errors, just skip that line
        }
      }
    } catch (error) {
      // Fallback to raw output if JSON parsing completely fails
      // But don't output the raw JSON since it's meant to be formatted
    }
  }

  private logClaudeStreamingOutput(jsonData: any): void {
    switch (jsonData.type) {
      case 'system':
        if (jsonData.subtype === 'init') {
          console.log('🔧 Claude initialized with tools:', jsonData.tools?.slice(0, 5).join(', ') + (jsonData.tools?.length > 5 ? '...' : ''));
          console.log('🎯 Model:', jsonData.model);
          console.log('🔐 Permission mode:', jsonData.permissionMode);
        }
        break;
        
      case 'assistant':
        if (jsonData.message?.content) {
          const content = Array.isArray(jsonData.message.content) 
            ? jsonData.message.content.map((c: any) => c.text || c.type).join(' ')
            : jsonData.message.content;
          console.log('🤖 Claude response:', content.substring(0, 100) + (content.length > 100 ? '...' : ''));
        }
        break;
        
      case 'tool_use':
        console.log(`🔨 Using tool: ${jsonData.name}${jsonData.input?.command ? ' - ' + jsonData.input.command : ''}`);
        break;
        
      case 'tool_result':
        const resultPreview = typeof jsonData.content === 'string' 
          ? jsonData.content.substring(0, 80) + (jsonData.content.length > 80 ? '...' : '')
          : JSON.stringify(jsonData.content).substring(0, 80);
        console.log(`📋 Tool result: ${resultPreview}`);
        break;
        
      case 'result':
        if (jsonData.subtype === 'success') {
          console.log('✅ Claude completed successfully');
          console.log(`⏱️  Duration: ${jsonData.duration_ms}ms, API: ${jsonData.duration_api_ms}ms`);
          console.log(`💰 Cost: $${jsonData.total_cost_usd}`);
          if (jsonData.permission_denials?.length > 0) {
            console.log('⛔ Permission denials:', jsonData.permission_denials.length);
          }
        } else if (jsonData.is_error) {
          console.log('❌ Claude encountered an error:', jsonData.error);
        }
        break;
        
      case 'error':
        console.log('🚨 Claude error:', jsonData.error || jsonData.message);
        break;
        
      default:
        // Log other message types with limited detail
        console.log(`📡 Claude event: ${jsonData.type}${jsonData.subtype ? ':' + jsonData.subtype : ''}`);
    }
  }
}

// Singleton for easy access
let instance: ClaudeService | null = null;

export function getClaudeService(configPath?: string, overrideClaudePath?: string): ClaudeService {
  if (!instance || configPath || overrideClaudePath) {
    instance = new ClaudeService(configPath, overrideClaudePath);
  }
  return instance;
}