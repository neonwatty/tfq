import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { setupIntegrationTest, runTfqCommand } from './test-utils.js';

describe('fix-next Command Integration (Refactored)', () => {
  let testDir: string;
  let testFile: string;
  let cleanup: () => Promise<void>;
  
  beforeEach(async () => {
    const setup = await setupIntegrationTest('fix-next-refactored');
    testDir = setup.testDir;
    testFile = path.join(testDir, 'refactored-test.test.ts');
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Basic Functionality', () => {
    it('should use shared fixNextTest workflow', async () => {
      // Create a test file
      const testContent = `
import { describe, it, expect } from 'vitest';

describe('Refactored workflow test', () => {
  it('should work with shared logic', () => {
    expect(2 + 2).toBe(4);
  });
});`;
      
      fs.writeFileSync(testFile, testContent);

      // Add test to queue
      const addResult = await runTfqCommand(['add', testFile], testDir);
      expect(addResult.success).toBe(true);

      // Verify test is in queue
      const listResult = await runTfqCommand(['list'], testDir);
      expect(listResult.output).toContain('refactored-test.test.ts');

      // Try fix-next command (should fail gracefully with Claude disabled)
      const fixNextResult = await runTfqCommand(['fix-next'], testDir);
      expect(fixNextResult.success).toBe(false);
      expect(fixNextResult.error || fixNextResult.output).toContain('Claude integration is disabled');
    });

    it('should handle empty queue gracefully', async () => {
      // Run fix-next on empty queue
      const result = await runTfqCommand(['fix-next'], testDir);
      
      expect(result.success).toBe(false);
      // Should get either queue empty message or Claude disabled message
      const output = result.output + result.error;
      expect(output.includes('Queue is empty') || output.includes('Claude integration is disabled')).toBe(true);
    });

    it('should support JSON output format', async () => {
      // Add a test to queue
      const testContent = `
import { describe, it, expect } from 'vitest';
describe('JSON output test', () => {
  it('should support JSON format', () => {
    expect(true).toBe(true);
  });
});`;
      
      fs.writeFileSync(testFile, testContent);
      await runTfqCommand(['add', testFile], testDir);

      // Run fix-next with JSON flag
      const result = await runTfqCommand(['fix-next', '--json'], testDir);
      
      expect(result.success).toBe(false); // Claude disabled
      
      // Should output valid JSON
      const allOutput = result.output + result.error;
      try {
        const jsonOutput = JSON.parse(result.output || result.error);
        expect(jsonOutput).toHaveProperty('success', false);
        expect(jsonOutput).toHaveProperty('error');
        expect(jsonOutput.error).toContain('Claude integration is disabled');
      } catch (e) {
        // If not valid JSON, check that error message indicates Claude disabled
        expect(allOutput).toContain('Claude integration is disabled');
      }
    });
  });

  describe('Error Handling', () => {
    it('should validate test timeout parameter', async () => {
      const result = await runTfqCommand(['fix-next', '--test-timeout', '500'], testDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Test timeout must be a number between 300000ms (5 min) and 900000ms (15 min)');
    });

    it('should accept valid test timeout parameter', async () => {
      // Add test to queue first
      const testContent = `describe('timeout test', () => { it('works', () => expect(true).toBe(true)); });`;
      fs.writeFileSync(testFile, testContent);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommand(['fix-next', '--test-timeout', '420000'], testDir);
      
      // Should fail because Claude is disabled, but timeout validation should pass
      expect(result.success).toBe(false);
      const allOutput = result.output + result.error;
      expect(allOutput).toContain('Claude integration is disabled');
      expect(allOutput).not.toContain('Test timeout must be');
    });

    it('should handle invalid Claude path gracefully', async () => {
      // Create config with enabled Claude but invalid path
      const configFile = path.join(testDir, '.tfqrc');
      const dbPath = path.join(testDir, '.tfq/test.db');
      const configWithInvalidClaude = {
        database: { path: dbPath },
        language: 'javascript',
        framework: 'vitest',
        claude: {
          enabled: true,
          claudePath: '/nonexistent/path/to/claude'
        }
      };
      fs.writeFileSync(configFile, JSON.stringify(configWithInvalidClaude, null, 2));

      // Add test to queue
      const testContent = `describe('invalid claude test', () => { it('fails', () => expect(true).toBe(false)); });`;
      fs.writeFileSync(testFile, testContent);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommand(['fix-next'], testDir);
      
      expect(result.success).toBe(false);
      const allOutput = result.error + result.output;
      expect(allOutput).toContain('Claude path');
    });
  });

  describe('Queue Integration', () => {
    it('should properly dequeue tests using shared method', async () => {
      // Add multiple tests to queue
      const testContent1 = `describe('test1', () => { it('test1', () => expect(1).toBe(2)); });`;
      const testContent2 = `describe('test2', () => { it('test2', () => expect(2).toBe(3)); });`;
      
      const testFile1 = path.join(testDir, 'test1.test.js');
      const testFile2 = path.join(testDir, 'test2.test.js');
      
      fs.writeFileSync(testFile1, testContent1);
      fs.writeFileSync(testFile2, testContent2);

      await runTfqCommand(['add', testFile1, '--priority', '1'], testDir);
      await runTfqCommand(['add', testFile2, '--priority', '2'], testDir);

      // Check queue has 2 items
      const listResult = await runTfqCommand(['list'], testDir);
      expect(listResult.output).toContain('2 file');

      // Try fix-next (will fail due to disabled Claude, but should attempt to dequeue)
      const fixResult = await runTfqCommand(['fix-next'], testDir);
      expect(fixResult.success).toBe(false);
      expect(fixResult.error || fixResult.output).toContain('Claude integration is disabled');

      // Queue should still have both items (since fix failed)
      const listAfterFix = await runTfqCommand(['list'], testDir);
      expect(listAfterFix.output).toContain('2 file');
    });

    it('should handle queue statistics correctly', async () => {
      // Add test with error context
      const failingTest = `describe('failing', () => { it('fails', () => expect(true).toBe(false)); });`;
      fs.writeFileSync(testFile, failingTest);
      
      await runTfqCommand(['add', testFile, '--priority', '3'], testDir);

      // Get stats before fix attempt
      const statsBefore = await runTfqCommand(['stats'], testDir);
      expect(statsBefore.output).toContain('1');

      // Attempt fix (will fail)
      await runTfqCommand(['fix-next'], testDir);

      // Stats should be unchanged since fix failed
      const statsAfter = await runTfqCommand(['stats'], testDir);
      expect(statsAfter.output).toContain('1');
    });
  });

  describe('Output Formatting', () => {
    it('should show proper error messages for different scenarios', async () => {
      // Test 1: Empty queue
      const emptyQueueResult = await runTfqCommand(['fix-next'], testDir);
      expect(emptyQueueResult.success).toBe(false);

      // Test 2: Claude disabled with items in queue
      const testContent = `describe('test', () => { it('fails', () => expect(1).toBe(2)); });`;
      fs.writeFileSync(testFile, testContent);
      await runTfqCommand(['add', testFile], testDir);

      const claudeDisabledResult = await runTfqCommand(['fix-next'], testDir);
      expect(claudeDisabledResult.success).toBe(false);
      expect(claudeDisabledResult.error || claudeDisabledResult.output).toContain('Claude integration is disabled');
    });

    it('should maintain consistent behavior with old fix-next', async () => {
      // This test ensures our refactoring maintains the same external behavior
      const testContent = `describe('consistency test', () => { it('should fail', () => expect(true).toBe(false)); });`;
      fs.writeFileSync(testFile, testContent);
      await runTfqCommand(['add', testFile], testDir);

      const result = await runTfqCommand(['fix-next'], testDir);
      
      // Should have same error format as before refactoring
      expect(result.success).toBe(false);
      const allOutput = result.error + result.output;
      expect(allOutput).toContain('Claude integration is disabled');
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle concurrent queue operations', async () => {
      // Add multiple tests rapidly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        const content = `describe('test${i}', () => { it('test${i}', () => expect(${i}).toBe(${i+1})); });`;
        const file = path.join(testDir, `test${i}.test.js`);
        fs.writeFileSync(file, content);
        promises.push(runTfqCommand(['add', file], testDir));
      }

      // Wait for all adds to complete
      await Promise.all(promises);

      // Check all tests were added
      const listResult = await runTfqCommand(['list'], testDir);
      expect(listResult.output).toContain('file');

      // Try fix-next
      const fixResult = await runTfqCommand(['fix-next'], testDir);
      expect(fixResult.success).toBe(false); // Claude disabled
    });

    it('should handle filesystem edge cases', async () => {
      // Test with file that doesn't exist in queue
      await runTfqCommand(['add', '/nonexistent/path/test.js'], testDir);
      
      const result = await runTfqCommand(['fix-next'], testDir);
      expect(result.success).toBe(false);
      // Should still fail gracefully even with invalid file path
    });
  });
});

// Helper function now imported from test-utils.js