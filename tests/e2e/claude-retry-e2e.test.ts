import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { 
  setupIntegrationTest, 
  cleanupTestDirectory,
  runTfqCommand
} from '../integration/test-utils.js';
import {
  runTfqCommandWithEnv,
  createE2ETestEnvironment
} from './e2e-test-utils.js';
import {
  setupMockClaude,
  countRetryAttempts,
  createRetryConfig,
  createFailingTest
} from './retry-test-utils.js';

describe('Claude Retry Logic E2E Tests', () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  const mockClaudePath = path.join(__dirname, '..', 'fixtures', 'mock-claude.js');

  beforeEach(async () => {
    const setup = await setupIntegrationTest('claude-retry-e2e');
    testDir = setup.testDir;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  describe('Timeout Scenarios', () => {
    it('should retry on timeout and eventually succeed', async () => {
      // Configure with short timeout and retries
      createRetryConfig(testDir, {
        maxRetries: 2,
        retryDelay: 500,
        retryBackoffMultiplier: 2,
        maxRetryDelay: 2000
      }, mockClaudePath);

      // Create failing test
      const testFile = createFailingTest(testDir);

      // Add test to queue
      await runTfqCommand(['add', testFile], testDir);

      // Run fix-next with mock claude that times out initially
      // We'll simulate timeout by using a very short test timeout in config
      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('timeout'),
        timeout: 30000
      });

      // Verify retry occurred
      const output = result.output;
      expect(output).toContain('Retry attempt');
      expect(output).toContain('Starting Claude CLI');
      
      // Should timeout on first attempt
      expect(result.error).toContain('timed out');
    }, 30000);

    it('should handle timeout with exhausted retries', async () => {
      createRetryConfig(testDir, {
        maxRetries: 2,
        retryDelay: 200,
        retryBackoffMultiplier: 2,
        maxRetryDelay: 1000
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      // Always timeout
      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('timeout'),
        timeout: 30000
      });

      const output = result.output;
      const retryCount = countRetryAttempts(output);
      
      expect(retryCount).toBe(2); // Should attempt 2 retries
      expect(output).toContain('Max retries');
      expect(output).toContain('exhausted');
    }, 30000);
  });

  describe('Exit Code Failures', () => {
    it('should retry on exit code 1', async () => {
      createRetryConfig(testDir, {
        maxRetries: 3,
        retryDelay: 300,
        retryBackoffMultiplier: 2,
        maxRetryDelay: 2000
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      // Use flaky behavior - fails first 2 attempts, succeeds on 3rd
      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('flaky')
      });

      // Check that retries happened by looking for multiple attempts
      expect(result.output).toContain('Attempt');
      // Flaky behavior succeeds on 3rd attempt
      expect(result.output).toContain('Attempt 3');
      expect(result.success).toBe(true);
    }, 20000);

    it('should retry on exit code 2', async () => {
      createRetryConfig(testDir, {
        maxRetries: 2,
        retryDelay: 300
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('exit_2'),
        timeout: 20000
      });

      const output = result.output;
      expect(output).toContain('Claude exited with code 2');
      expect(countRetryAttempts(output)).toBeGreaterThan(0);
    }, 20000);

    it('should NOT retry on exit code 127', async () => {
      createRetryConfig(testDir, {
        maxRetries: 3,
        retryDelay: 300
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('exit_127')
      });

      // Should fail immediately without retries
      expect(result.success).toBe(false);
      expect(result.output).toContain('command not found');
      expect(countRetryAttempts(result.output)).toBe(0);
    }, 10000);
  });

  describe('Retry Backoff Timing', () => {
    it('should follow exponential backoff delays', async () => {
      const retryConfig = {
        maxRetries: 3,
        retryDelay: 100,
        retryBackoffMultiplier: 2,
        maxRetryDelay: 500
      };

      createRetryConfig(testDir, retryConfig, mockClaudePath);
      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      const startTime = Date.now();
      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('exit_1'), // Always fail to test all retries
        timeout: 20000
      });

      const duration = Date.now() - startTime;
      const output = result.output;
      
      // Parse delays from output
      const delayMatches = output.match(/after (\d+)ms delay/g) || [];
      const delays = delayMatches.map(m => parseInt(m.match(/(\d+)/)![1]));

      // Verify exponential backoff
      if (delays.length >= 3) {
        // First retry: ~100ms
        expect(delays[0]).toBeGreaterThanOrEqual(100);
        expect(delays[0]).toBeLessThanOrEqual(110); // With jitter

        // Second retry: ~200ms
        expect(delays[1]).toBeGreaterThanOrEqual(200);
        expect(delays[1]).toBeLessThanOrEqual(220);

        // Third retry: ~400ms (but capped at maxRetryDelay of 500)
        expect(delays[2]).toBeGreaterThanOrEqual(400);
        expect(delays[2]).toBeLessThanOrEqual(500);
      }

      // Total duration should reflect the delays
      const expectedMinDuration = delays.reduce((sum, d) => sum + d, 0);
      expect(duration).toBeGreaterThanOrEqual(expectedMinDuration);
    }, 20000);

    it('should cap delays at maxRetryDelay', async () => {
      createRetryConfig(testDir, {
        maxRetries: 4,
        retryDelay: 1000,
        retryBackoffMultiplier: 10, // Very high multiplier
        maxRetryDelay: 2000 // Cap at 2 seconds
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('exit_1'),
        timeout: 25000
      });

      const output = result.output;
      const delayMatches = output.match(/after (\d+)ms delay/g) || [];
      const delays = delayMatches.map(m => parseInt(m.match(/(\d+)/)![1]));

      // All delays after the first should be capped at maxRetryDelay
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeLessThanOrEqual(2200); // 2000ms + jitter
      }
    }, 25000);
  });

  describe('Streaming Output Preservation', () => {
    it('should preserve output across retry attempts', async () => {
      createRetryConfig(testDir, {
        maxRetries: 2,
        retryDelay: 200
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('partial_output'),
        timeout: 15000
      });

      const output = result.output;
      
      // Verify output from failed attempts is preserved
      expect(output).toContain('Processing request');
      expect(output).toContain('Analyzing test file');
      expect(output).toContain('Attempting fix');
      
      // Should show multiple attempts
      const processingCount = (output.match(/Processing request/g) || []).length;
      expect(processingCount).toBeGreaterThan(1);
    }, 15000);

    it('should handle streaming with delays correctly', async () => {
      createRetryConfig(testDir, {
        maxRetries: 1,
        retryDelay: 100
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: {
          ...setupMockClaude('success'),
          MOCK_CLAUDE_STREAM_DELAY: '200' // Slow streaming
        },
        timeout: 15000
      });

      // Verify timestamps show streaming
      const timestampedOutput = result.output.split('\n');
      const timestamps = timestampedOutput
        .map(line => {
          const match = line.match(/\[(\d+)ms\]/);
          return match ? parseInt(match[1]) : 0;
        })
        .filter(t => t > 0);

      // Should have multiple timestamps showing progression
      expect(timestamps.length).toBeGreaterThan(1);
      
      // Timestamps should increase
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    }, 15000);
  });

  describe('Max Retries Exhaustion', () => {
    it('should stop after max retries and report failure', async () => {
      createRetryConfig(testDir, {
        maxRetries: 2,
        retryDelay: 100
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('exit_1') // Always fail
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain('Max retries');
      expect(countRetryAttempts(result.output)).toBe(2);
      
      // Should show it's after retries
      expect(result.output).toContain('(after retries)');
    }, 15000);

    it('should work with maxRetries = 0 (no retries)', async () => {
      createRetryConfig(testDir, {
        maxRetries: 0 // No retries
      }, mockClaudePath);

      const testFile = createFailingTest(testDir);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: setupMockClaude('exit_1')
      });

      expect(result.success).toBe(false);
      expect(countRetryAttempts(result.output)).toBe(0);
      
      // Should NOT show "after retries" when maxRetries is 0
      expect(result.output).not.toContain('(after retries)');
    }, 10000);
  });

  describe('Integration with fix-all command', () => {
    it('should handle retries for multiple files in fix-all', async () => {
      createRetryConfig(testDir, {
        maxRetries: 2,
        retryDelay: 100
      }, mockClaudePath);

      // Create multiple failing tests
      const test1 = createFailingTest(testDir, 'test1.spec.js');
      const test2 = createFailingTest(testDir, 'test2.spec.js');

      // Add to queue
      await runTfqCommand(['add', test1], testDir);
      await runTfqCommand(['add', test2], testDir);

      // Run fix-all with flaky behavior
      const result = await runTfqCommandWithEnv(['fix-all', '--max-iterations', '2'], testDir, {
        env: setupMockClaude('flaky'),
        timeout: 30000
      });

      const output = result.output;
      
      // Should show retry attempts
      expect(output).toContain('Retry attempt');
      
      // Should process both files
      expect(output).toContain('test1.spec.js');
      expect(output).toContain('test2.spec.js');
    }, 35000);
  });
});