import path from 'path';
import fs from 'fs';
import { execa } from 'execa';

export interface RetryTestConfig {
  maxRetries: number;
  retryDelay: number;
  retryBackoffMultiplier: number;
  maxRetryDelay: number;
}

export interface TimingMeasurement {
  attempt: number;
  startTime: number;
  endTime: number;
  duration: number;
  delayBefore?: number;
}

/**
 * Creates a .tfqrc config file with retry settings and mock Claude path
 */
export function createRetryConfig(
  testDir: string,
  retryConfig: Partial<RetryTestConfig> = {},
  mockClaudePath?: string
): string {
  const configPath = path.join(testDir, '.tfqrc');
  const dbPath = path.join(testDir, '.tfq', 'test.db');
  
  const config = {
    database: {
      path: dbPath
    },
    language: 'javascript',
    framework: 'jest',
    testCommand: 'echo "mock test"', // Mock test command to avoid Jest requirement
    claude: {
      enabled: true,
      claudePath: mockClaudePath || path.join(__dirname, '..', 'fixtures', 'mock-claude.js'),
      maxIterations: 10,
      testTimeout: 5000, // Short timeout for E2E tests
      ...retryConfig,
      // Ensure -p flag is used (headless mode)
      dangerouslySkipPermissions: true
    }
  };
  
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  return configPath;
}

/**
 * Creates a failing test file
 */
export function createFailingTest(testDir: string, fileName = 'test.spec.js'): string {
  const testPath = path.join(testDir, fileName);
  const content = `
describe('Math operations', () => {
  it('should add numbers correctly', () => {
    expect(2 + 2).toBe(5); // This will fail
  });
});`;
  
  fs.writeFileSync(testPath, content);
  return testPath;
}

/**
 * Measures timing of retry attempts by parsing output
 */
export function parseRetryTimings(output: string): TimingMeasurement[] {
  const timings: TimingMeasurement[] = [];
  const lines = output.split('\n');
  
  let currentAttempt = 0;
  let lastEndTime = Date.now();
  
  for (const line of lines) {
    // Look for retry messages
    if (line.includes('Retry attempt')) {
      const match = line.match(/Retry attempt (\d+)\/\d+ .* after (\d+)ms delay/);
      if (match) {
        currentAttempt = parseInt(match[1]);
        const delay = parseInt(match[2]);
        timings.push({
          attempt: currentAttempt,
          startTime: lastEndTime + delay,
          endTime: 0,
          duration: 0,
          delayBefore: delay
        });
      }
    }
    
    // Look for completion messages
    if (line.includes('succeeded after') && line.includes('retry')) {
      const match = line.match(/succeeded after (\d+) retry/);
      if (match) {
        const retries = parseInt(match[1]);
        // Update last timing
        if (timings.length > 0) {
          timings[timings.length - 1].endTime = Date.now();
        }
      }
    }
  }
  
  return timings;
}

/**
 * Verifies exponential backoff delays are within expected ranges
 */
export function verifyBackoffDelays(
  timings: TimingMeasurement[],
  config: RetryTestConfig,
  tolerance = 0.2 // 20% tolerance for timing
): boolean {
  for (let i = 0; i < timings.length; i++) {
    const timing = timings[i];
    if (!timing.delayBefore) continue;
    
    // Calculate expected delay
    const expectedDelay = Math.min(
      config.retryDelay * Math.pow(config.retryBackoffMultiplier, i),
      config.maxRetryDelay
    );
    
    // Check if within tolerance (accounting for jitter)
    const minDelay = expectedDelay * (1 - tolerance);
    const maxDelay = expectedDelay * (1 + tolerance);
    
    if (timing.delayBefore < minDelay || timing.delayBefore > maxDelay) {
      console.error(`Delay ${timing.delayBefore}ms not in range [${minDelay}, ${maxDelay}]`);
      return false;
    }
  }
  
  return true;
}

/**
 * Captures streaming output in real-time
 */
export async function captureStreamingOutput(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  duration: number;
}> {
  const startTime = Date.now();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  
  try {
    const child = execa(command, args, {
      cwd,
      env: { ...process.env, ...env },
      buffer: false,
      reject: false
    });
    
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutChunks.push(`[${Date.now() - startTime}ms] ${text}`);
    });
    
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrChunks.push(`[${Date.now() - startTime}ms] ${text}`);
    });
    
    const result = await child;
    
    return {
      stdout: stdoutChunks,
      stderr: stderrChunks,
      exitCode: result.exitCode,
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      stdout: stdoutChunks,
      stderr: stderrChunks,
      exitCode: error.exitCode ?? -1,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Sets up environment for mock Claude with specific behavior
 */
export function setupMockClaude(
  behavior: 'success' | 'timeout' | 'exit_1' | 'exit_2' | 'exit_127' | 'flaky' | 'partial_output',
  attempt = 1,
  additionalEnv: Record<string, string> = {}
): Record<string, string> {
  return {
    MOCK_CLAUDE_BEHAVIOR: behavior,
    MOCK_CLAUDE_ATTEMPT: attempt.toString(),
    MOCK_CLAUDE_TIMEOUT_MS: '3000',
    MOCK_CLAUDE_STREAM_DELAY: '50',
    ...additionalEnv
  };
}

/**
 * Counts retry attempts in output
 */
export function countRetryAttempts(output: string): number {
  const retryMatches = output.match(/Retry attempt \d+\/\d+/g) || [];
  return retryMatches.length;
}

/**
 * Verifies output is preserved across retries
 */
export function verifyOutputPreservation(
  output: string,
  expectedChunks: string[]
): boolean {
  for (const chunk of expectedChunks) {
    if (!output.includes(chunk)) {
      console.error(`Missing expected output chunk: "${chunk}"`);
      return false;
    }
  }
  return true;
}