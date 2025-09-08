import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { 
  setupIntegrationTest, 
  runTfqCommand
} from '../integration/test-utils.js';
import { runTfqCommandWithEnv } from './e2e-test-utils.js';
import {
  setupJavaScriptExample,
  createRealJavaScriptConfig,
  runJestTests,
  verifyBugsPresent,
  verifyBugsFixed
} from './javascript-example-setup.js';
import { countRetryAttempts } from './retry-test-utils.js';

describe('Claude Retry with Real JavaScript Project', () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let exampleCleanup: () => Promise<void>;
  const mockClaudeRealPath = path.join(__dirname, '..', 'fixtures', 'mock-claude-real.cjs');

  beforeEach(async () => {
    const setup = await setupIntegrationTest('claude-real-project');
    testDir = setup.testDir;
    cleanup = setup.cleanup;
    
    // Setup JavaScript example
    const exampleSetup = await setupJavaScriptExample(testDir);
    exampleCleanup = exampleSetup.cleanup;
  });

  afterEach(async () => {
    if (exampleCleanup) {
      await exampleCleanup();
    }
    if (cleanup) {
      await cleanup();
    }
  });

  describe('Real Jest Test Execution', () => {
    it('should run real Jest tests and identify failures', async () => {
      // Verify bugs are present
      expect(verifyBugsPresent(testDir)).toBe(true);

      // Run Jest to see failures
      const testResult = await runJestTests(testDir);
      expect(testResult.success).toBe(false);
      expect(testResult.failedTests.length).toBeGreaterThan(0);
      expect(testResult.output).toContain('FAIL');
      expect(testResult.output).toContain('Expected: 999998000001'); // multiply bug
    }, 20000);

    it('should fix real Jest test failures with mock Claude', async () => {
      // Create config with real Jest command
      createRealJavaScriptConfig(testDir, {
        maxRetries: 0 // No retries for this test
      }, mockClaudeRealPath);

      // Find failed test files
      const testResult = await runJestTests(testDir);
      const failedTest = testResult.failedTests[0];
      expect(failedTest).toBeDefined();

      // Add failed test to queue
      await runTfqCommand(['add', failedTest], testDir);

      // Run fix-next with mock Claude that fixes real files
      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: {
          MOCK_CLAUDE_BEHAVIOR: 'success',
          MOCK_CLAUDE_FIX_REAL_FILES: 'true',
          MOCK_CLAUDE_TARGET_FILE: path.join(testDir, 'src/calculator.js')
        },
        timeout: 20000
      });

      console.log('Result success:', result.success);
      console.log('Result output preview:', result.output.substring(0, 200));
      console.log('Result error:', result.error);
      
      expect(result.success).toBe(true);
      expect(result.output).toContain('Fixed');

      // Verify bugs have been fixed
      expect(verifyBugsFixed(testDir)).toBe(true);

      // Run Jest again to verify tests pass
      const finalResult = await runJestTests(testDir);
      console.log('Final Jest result:', finalResult.success);
      console.log('Final Jest output preview:', finalResult.output.substring(0, 500));
      
      expect(finalResult.success).toBe(true);
      expect(finalResult.output).toContain('PASS');
    }, 30000);
  });

  describe('Retry Scenarios with Real Project', () => {
    it('should retry and eventually fix with flaky behavior', async () => {
      // Configure with retries
      createRealJavaScriptConfig(testDir, {
        maxRetries: 3,
        retryDelay: 200,
        retryBackoffMultiplier: 2
      }, mockClaudeRealPath);

      // Get failing test
      const testResult = await runJestTests(testDir);
      const failedTest = testResult.failedTests[0];

      // Add to queue
      await runTfqCommand(['add', failedTest], testDir);

      // Run with flaky mock (fails first 2 attempts, succeeds on 3rd)
      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: {
          MOCK_CLAUDE_BEHAVIOR: 'flaky',
          MOCK_CLAUDE_FIX_REAL_FILES: 'true',
          MOCK_CLAUDE_TARGET_FILE: path.join(testDir, 'src/calculator.js')
        },
        timeout: 30000
      });

      // Should show retry attempts
      const retryCount = countRetryAttempts(result.output);
      expect(retryCount).toBeGreaterThan(0);
      expect(result.output).toContain('Retry attempt');
      expect(result.output).toContain('Success after retries');

      // Verify fixes were applied
      expect(verifyBugsFixed(testDir)).toBe(true);
    }, 40000);

    it('should incrementally fix bugs across retries', async () => {
      createRealJavaScriptConfig(testDir, {
        maxRetries: 3,
        retryDelay: 100
      }, mockClaudeRealPath);

      const testResult = await runJestTests(testDir);
      const failedTest = testResult.failedTests[0];

      await runTfqCommand(['add', failedTest], testDir);

      // Run with incremental behavior (fixes one bug per attempt)
      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: {
          MOCK_CLAUDE_BEHAVIOR: 'incremental',
          MOCK_CLAUDE_FIX_REAL_FILES: 'true',
          MOCK_CLAUDE_TARGET_FILE: path.join(testDir, 'src/calculator.js')
        },
        timeout: 25000
      });

      // Should show multiple attempts
      expect(result.output).toContain('Fixing attempt');
      expect(result.output).toContain('Fixed multiply bug');
      
      // At least partial fixes should be applied
      const calculatorContent = fs.readFileSync(
        path.join(testDir, 'src/calculator.js'),
        'utf8'
      );
      expect(calculatorContent).toContain('return a * b'); // multiply fixed
    }, 35000);
  });

  describe('Integration with fix-all command', () => {
    it('should handle multiple test files with real fixes', async () => {
      createRealJavaScriptConfig(testDir, {
        maxRetries: 2,
        retryDelay: 100
      }, mockClaudeRealPath);

      // Get all failing tests
      const testResult = await runJestTests(testDir);
      expect(testResult.failedTests.length).toBeGreaterThan(0);

      // Add all failed tests to queue
      for (const test of testResult.failedTests) {
        await runTfqCommand(['add', test], testDir);
      }

      // Run fix-all
      const result = await runTfqCommandWithEnv(
        ['fix-all', '--max-iterations', '5'],
        testDir,
        {
          env: {
            MOCK_CLAUDE_BEHAVIOR: 'success',
            MOCK_CLAUDE_FIX_REAL_FILES: 'true',
            MOCK_CLAUDE_TARGET_FILE: path.join(testDir, 'src/calculator.js')
          },
          timeout: 60000
        }
      );

      expect(result.output).toContain('Starting automated test fixing');
      
      // Verify all bugs fixed
      expect(verifyBugsFixed(testDir)).toBe(true);

      // Final test run should pass
      const finalResult = await runJestTests(testDir);
      expect(finalResult.success).toBe(true);
    }, 70000);
  });

  describe('Validation and Error Handling', () => {
    it('should preserve file changes between retry attempts', async () => {
      createRealJavaScriptConfig(testDir, {
        maxRetries: 2,
        retryDelay: 100
      }, mockClaudeRealPath);

      const testResult = await runJestTests(testDir);
      const failedTest = testResult.failedTests[0];

      await runTfqCommand(['add', failedTest], testDir);

      // Before fix
      const originalContent = fs.readFileSync(
        path.join(testDir, 'src/calculator.js'),
        'utf8'
      );
      expect(originalContent).toContain('return 17'); // bug present

      // Run with partial fix
      await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: {
          MOCK_CLAUDE_BEHAVIOR: 'partial',
          MOCK_CLAUDE_FIX_REAL_FILES: 'true',
          MOCK_CLAUDE_TARGET_FILE: path.join(testDir, 'src/calculator.js')
        },
        timeout: 15000
      });

      // After fix
      const modifiedContent = fs.readFileSync(
        path.join(testDir, 'src/calculator.js'),
        'utf8'
      );
      expect(modifiedContent).toContain('return a * b'); // bug fixed
      expect(modifiedContent).not.toContain('return 17');
    }, 20000);

    it('should handle timeout gracefully without corrupting files', async () => {
      createRealJavaScriptConfig(testDir, {
        maxRetries: 1,
        retryDelay: 100,
        testTimeout: 2000 // Very short timeout
      }, mockClaudeRealPath);

      const testResult = await runJestTests(testDir);
      const failedTest = testResult.failedTests[0];

      await runTfqCommand(['add', failedTest], testDir);

      const originalContent = fs.readFileSync(
        path.join(testDir, 'src/calculator.js'),
        'utf8'
      );

      // Run with timeout behavior
      const result = await runTfqCommandWithEnv(['fix-next'], testDir, {
        env: {
          MOCK_CLAUDE_BEHAVIOR: 'timeout',
          MOCK_CLAUDE_FIX_REAL_FILES: 'true'
        },
        timeout: 10000
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');

      // File should remain unchanged
      const afterContent = fs.readFileSync(
        path.join(testDir, 'src/calculator.js'),
        'utf8'
      );
      expect(afterContent).toBe(originalContent);
    }, 15000);
  });
});