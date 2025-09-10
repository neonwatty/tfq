import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeService } from '../../../src/services/claude/claude-service.js';
import { TestFailureQueue } from '../../../src/core/queue.js';
import { TestRunner } from '../../../src/core/test-runner.js';
import { ClaudeFixNextResult } from '../../../src/services/claude/types.js';
import { ConfigManager, loadConfig } from '../../../src/core/config.js';
import fs from 'fs';
import path from 'path';

// Mock dependencies
vi.mock('fs');
vi.mock('execa');
vi.mock('../../../src/core/test-runner.js');
vi.mock('../../../src/core/config.js', () => ({
  ConfigManager: {
    getInstance: vi.fn()
  },
  loadConfig: vi.fn()
}));

const mockFs = vi.mocked(fs);
const mockExeca = vi.hoisted(() => vi.fn());

vi.mock('execa', () => ({
  execa: mockExeca
}));

describe('ClaudeService.fixNextTest() Method', () => {
  let claudeService: ClaudeService;
  let mockQueue: TestFailureQueue;
  let testDbPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDbPath = '/tmp/test-claude.db';
    
    // Mock fs calls for Claude path validation
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isFile: () => true } as any);
    mockFs.accessSync.mockReturnValue(undefined);
    
    // Mock loadConfig to return default config
    vi.mocked(loadConfig).mockReturnValue({
      databasePath: testDbPath,
      autoCleanup: false,
      maxRetries: 3,
      verbose: false,
      claude: {
        enabled: true,
        claudePath: '/valid/claude/path',
        maxIterations: 3,
        testTimeout: 720000
      }
    });
    
    // Mock ConfigManager to return enabled Claude config
    const mockConfigManager = {
      getConfig: () => ({
        claude: {
          enabled: true,
          claudePath: '/valid/claude/path',
          maxIterations: 3,
          testTimeout: 720000
        }
      })
    };
    vi.mocked(ConfigManager.getInstance).mockReturnValue(mockConfigManager as any);
    
    // Create Claude service instance
    claudeService = new ClaudeService();
    
    // Create mock queue
    mockQueue = new TestFailureQueue({ databasePath: testDbPath });
    
    // Mock successful Claude execution by default
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: 'Claude processing completed',
      stderr: ''
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockQueue?.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Core Workflow Tests', () => {
    it('should successfully complete happy path: dequeue → fix → verify → success', async () => {
      // Setup: Add test to queue
      const testPath = '/path/to/test.js';
      const errorContext = 'Original error: assertion failed';
      mockQueue.enqueue(testPath, 1, errorContext);
      
      // Mock successful test verification
      const mockTestRunner = {
        run: vi.fn().mockReturnValue({
          success: true,
          exitCode: 0,
          duration: 1000,
          error: null
        })
      };
      vi.mocked(TestRunner).mockImplementation(() => mockTestRunner as any);
      
      // Execute
      const result = await claudeService.fixNextTest(mockQueue, {
        useJsonOutput: true
      });
      
      // Verify result
      expect(result.success).toBe(true);
      expect(result.testFound).toBe(true);
      expect(result.testPath).toBe(testPath);
      expect(result.claudeProcessing?.success).toBe(true);
      expect(result.verification?.success).toBe(true);
      expect(result.requeued).toBe(false);
      expect(result.maxRetriesExceeded).toBe(false);
      
      // Verify Claude was called with correct parameters
      expect(mockExeca).toHaveBeenCalledWith(
        '/valid/claude/path',
        expect.any(Array),
        expect.objectContaining({
          timeout: 720000,
          input: expect.stringContaining(testPath)
        })
      );
      
      // Verify TestRunner was called
      expect(mockTestRunner.run).toHaveBeenCalled();
      
      // Verify queue is now empty (test was not re-added)
      expect(mockQueue.size()).toBe(0);
    });

    it('should handle verification failure by re-queuing with context', async () => {
      // Setup
      const testPath = '/path/to/failing-test.js';
      const originalError = 'TypeError: cannot read property';
      mockQueue.enqueue(testPath, 2, originalError);
      
      // Mock Claude success but verification failure
      const mockTestRunner = {
        run: vi.fn().mockReturnValue({
          success: false,
          exitCode: 1,
          duration: 500,
          error: 'Test still fails after fix',
          stderr: 'AssertionError: expected 4 to equal 5'
        })
      };
      vi.mocked(TestRunner).mockImplementation(() => mockTestRunner as any);
      
      // Execute
      const result = await claudeService.fixNextTest(mockQueue, {
        useJsonOutput: true
      });
      
      // Verify result
      expect(result.success).toBe(false);
      expect(result.testFound).toBe(true);
      expect(result.testPath).toBe(testPath);
      expect(result.claudeProcessing?.success).toBe(true);
      expect(result.verification?.success).toBe(false);
      expect(result.requeued).toBe(true);
      expect(result.maxRetriesExceeded).toBe(false);
      expect(result.finalError).toContain('Fix verification failed');
      
      // Verify test was re-added to queue with updated error context
      expect(mockQueue.size()).toBe(1);
      const requeuedItem = mockQueue.dequeueWithContext();
      expect(requeuedItem?.filePath).toBe(testPath);
      expect(requeuedItem?.priority).toBe(2);
      expect(requeuedItem?.error).toContain(originalError);
      expect(requeuedItem?.error).toContain('Verification failed');
      expect(requeuedItem?.error).toContain('AssertionError');
    });

    it('should handle max retries exceeded', async () => {
      // Setup with maxIterations = 3
      const testPath = '/path/to/persistent-failure.js';
      
      // Create item that has already failed 3 times (at max retries)
      mockQueue.enqueue(testPath, 1, 'First failure');
      mockQueue.enqueue(testPath, 1, 'Second failure');
      mockQueue.enqueue(testPath, 1, 'Third failure');
      
      // Mock verification failure
      const mockTestRunner = {
        run: vi.fn().mockReturnValue({
          success: false,
          exitCode: 1,
          duration: 500,
          error: 'Test still fails'
        })
      };
      vi.mocked(TestRunner).mockImplementation(() => mockTestRunner as any);
      
      // Execute
      const result = await claudeService.fixNextTest(mockQueue, {});
      
      // Verify max retries behavior - failureCount=3, maxRetries=3, so should NOT re-queue
      expect(result.success).toBe(false);
      expect(result.testFound).toBe(true);
      expect(result.requeued).toBe(false); // Should not re-queue
      expect(result.maxRetriesExceeded).toBe(true);
      
      // Verify queue is empty (test was not re-added due to max retries)
      expect(mockQueue.size()).toBe(0);
    });

    it('should handle empty queue gracefully', async () => {
      // Ensure queue is actually empty
      mockQueue.clear();
      expect(mockQueue.size()).toBe(0);
      
      // Execute with empty queue
      const result = await claudeService.fixNextTest(mockQueue, {});
      
      // Verify result
      expect(result.success).toBe(false);
      expect(result.testFound).toBe(false);
      expect(result.finalError).toBe('Queue is empty');
      expect(result.testPath).toBeUndefined();
      expect(result.claudeProcessing).toBeUndefined();
      expect(result.verification).toBeUndefined();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle Claude integration disabled', async () => {
      // Mock disabled Claude config
      const mockConfigManager = {
        getConfig: () => ({
          claude: {
            enabled: false
          }
        })
      };
      vi.mocked(ConfigManager.getInstance).mockReturnValue(mockConfigManager as any);
      
      const disabledService = new ClaudeService();
      
      // Execute
      const result = await disabledService.fixNextTest(mockQueue, {});
      
      // Verify error
      expect(result.success).toBe(false);
      expect(result.testFound).toBe(false);
      expect(result.finalError).toContain('Claude integration is disabled');
    });

    it('should handle invalid Claude configuration', async () => {
      // Mock invalid config (no Claude path)
      const mockConfigManager = {
        getConfig: () => ({
          claude: {
            enabled: true,
            claudePath: null
          }
        })
      };
      vi.mocked(ConfigManager.getInstance).mockReturnValue(mockConfigManager as any);
      
      mockFs.existsSync.mockReturnValue(false); // Claude path doesn't exist
      
      const invalidService = new ClaudeService();
      
      // Execute
      const result = await invalidService.fixNextTest(mockQueue, {});
      
      // Verify error
      expect(result.success).toBe(false);
      expect(result.testFound).toBe(false);
      expect(result.finalError).toContain('Claude path not found');
    });

    it('should handle Claude execution timeout', async () => {
      // Setup
      const testPath = '/path/to/slow-test.js';
      mockQueue.enqueue(testPath, 1);
      
      // Mock Claude timeout
      const timeoutError = new Error('Timeout');
      (timeoutError as any).timedOut = true;
      (timeoutError as any).durationMs = 30000;
      mockExeca.mockRejectedValue(timeoutError);
      
      // Execute
      const result = await claudeService.fixNextTest(mockQueue, {
        testTimeout: 720000
      });
      
      // Verify timeout handling
      expect(result.success).toBe(false);
      expect(result.testFound).toBe(true);
      expect(result.claudeProcessing?.success).toBe(false);
      expect(result.claudeProcessing?.error).toContain('timed out after');
      expect(result.verification).toBeUndefined();
    });

    it('should handle Claude execution failure', async () => {
      // Setup
      const testPath = '/path/to/test.js';
      mockQueue.enqueue(testPath, 1);
      
      // Mock Claude failure
      mockExeca.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Claude encountered an error'
      });
      
      // Execute
      const result = await claudeService.fixNextTest(mockQueue, {});
      
      // Verify failure handling
      expect(result.success).toBe(false);
      expect(result.testFound).toBe(true);
      expect(result.claudeProcessing?.success).toBe(false);
      expect(result.verification).toBeUndefined();
    });

    it('should handle verification runner errors', async () => {
      // Setup
      const testPath = '/path/to/test.js';
      mockQueue.enqueue(testPath, 1);
      
      // Mock TestRunner throwing an error
      const mockTestRunner = {
        run: vi.fn().mockImplementation(() => {
          throw new Error('TestRunner crashed');
        })
      };
      vi.mocked(TestRunner).mockImplementation(() => mockTestRunner as any);
      
      // Execute
      const result = await claudeService.fixNextTest(mockQueue, {});
      
      // Verify error handling
      expect(result.success).toBe(false);
      expect(result.testFound).toBe(true);
      expect(result.claudeProcessing?.success).toBe(true);
      expect(result.requeued).toBe(true); // Should re-queue with verification error
      expect(result.finalError).toContain('Verification error: TestRunner crashed');
    });
  });

  describe('Context Management Tests', () => {
    it('should preserve error context through workflow', async () => {
      // Setup with detailed error context
      const testPath = '/path/to/test.js';
      const originalError = `AssertionError: expected true to be false
        at Object.<anonymous> (/path/to/test.js:10:5)
        at process.processImmediate (internal/timers.js:461:26)`;
      
      mockQueue.enqueue(testPath, 1, originalError);
      
      // Mock Claude success but verification failure
      const mockTestRunner = {
        run: vi.fn().mockReturnValue({
          success: false,
          exitCode: 1,
          duration: 500,
          error: 'Fix did not resolve the issue',
          stderr: 'Still failing with same assertion'
        })
      };
      vi.mocked(TestRunner).mockImplementation(() => mockTestRunner as any);
      
      // Execute
      const result = await claudeService.fixNextTest(mockQueue, {});
      
      // Verify error context preservation
      expect(result.requeued).toBe(true);
      
      const requeuedItem = mockQueue.dequeueWithContext();
      expect(requeuedItem?.error).toContain('Previous attempt:');
      expect(requeuedItem?.error).toContain(originalError);
      expect(requeuedItem?.error).toContain('Verification failed:');
      expect(requeuedItem?.error).toContain('Still failing with same assertion');
    });

    it('should handle timeout override parameter', async () => {
      // Setup
      const testPath = '/path/to/test.js';
      mockQueue.enqueue(testPath, 1);
      
      const customTimeout = 720000; // 12 minutes - within valid range
      
      // Execute with timeout override  
      await claudeService.fixNextTest(mockQueue, {
        testTimeout: customTimeout,
        useJsonOutput: true
      });
      
      // Verify execa was called with the custom timeout value
      expect(mockExeca).toHaveBeenCalledWith(
        '/valid/claude/path',
        ['-p', '--output-format', 'stream-json', '--verbose'],
        expect.objectContaining({
          timeout: customTimeout, // Should use the override timeout
          env: expect.any(Object),
          buffer: false,
          input: expect.stringContaining(testPath)
        })
      );
    });

    it('should use default timeout when no override provided', async () => {
      // Setup
      const testPath = '/path/to/test.js';
      mockQueue.enqueue(testPath, 1);
      
      // Execute without timeout override
      await claudeService.fixNextTest(mockQueue, {
        useJsonOutput: true
      });
      
      // Verify execa was called with default timeout
      expect(mockExeca).toHaveBeenCalledWith(
        '/valid/claude/path',
        ['-p', '--output-format', 'stream-json', '--verbose'],
        expect.objectContaining({
          timeout: 720000, // Should use the service's default timeout
          env: expect.any(Object),
          buffer: false,
          input: expect.stringContaining(testPath)
        })
      );
    });

    it('should validate timeout override range', async () => {
      // Setup
      const testPath = '/path/to/test.js';
      mockQueue.enqueue(testPath, 1);
      
      // Test with invalid timeout (too low)
      await claudeService.fixNextTest(mockQueue, {
        testTimeout: 500000, // 8.3 minutes - below minimum
        useJsonOutput: true
      });
      
      // Should still use service's default timeout when override is invalid
      expect(mockExeca).toHaveBeenCalledWith(
        '/valid/claude/path',
        ['-p', '--output-format', 'stream-json', '--verbose'],
        expect.objectContaining({
          timeout: 720000, // Service default, not the invalid override
          env: expect.any(Object)
        })
      );
      
      mockExeca.mockClear();
      mockQueue.enqueue(testPath, 1); // Re-enqueue for next test
      
      // Test with invalid timeout (too high)
      await claudeService.fixNextTest(mockQueue, {
        testTimeout: 2000000, // 33+ minutes - above maximum
        useJsonOutput: true
      });
      
      // Should still use service's default timeout when override is invalid
      expect(mockExeca).toHaveBeenCalledWith(
        '/valid/claude/path',
        ['-p', '--output-format', 'stream-json', '--verbose'],
        expect.objectContaining({
          timeout: 720000, // Service default, not the invalid override
          env: expect.any(Object)
        })
      );
    });

    it('should pass config path to TestRunner', async () => {
      // Setup
      const testPath = '/path/to/test.js';
      const configPath = '/custom/config/.tfqrc';
      mockQueue.enqueue(testPath, 1);
      
      const mockTestRunner = {
        run: vi.fn().mockReturnValue({
          success: true,
          exitCode: 0,
          duration: 1000,
          error: null
        })
      };
      vi.mocked(TestRunner).mockImplementation(() => mockTestRunner as any);
      
      // Execute
      await claudeService.fixNextTest(mockQueue, {
        configPath: configPath
      });
      
      // Verify TestRunner was created with config path
      expect(TestRunner).toHaveBeenCalledWith({
        testPath: testPath,
        verbose: false,
        configPath: configPath
      });
    });
  });

  describe('Console Output Management', () => {
    it('should suppress fixNextTest console output in JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // Setup
      const testPath = '/path/to/test.js';
      mockQueue.enqueue(testPath, 1);
      
      // Execute in JSON mode
      await claudeService.fixNextTest(mockQueue, {
        useJsonOutput: true
      });
      
      // Verify that fixNextTest-specific console output is suppressed 
      // (but fixTest method will still output to console)
      expect(consoleSpy).toHaveBeenCalled(); // fixTest method still logs
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('🤖 Fixing test with Claude:')
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('🔍 Verifying fix')
      );
      
      consoleSpy.mockRestore();
    });

    it('should show progress output in non-JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // Setup
      const testPath = '/path/to/test.js';
      mockQueue.enqueue(testPath, 1);
      
      // Execute in non-JSON mode
      await claudeService.fixNextTest(mockQueue, {
        useJsonOutput: false
      });
      
      // Verify console output was shown
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('🤖 Fixing test with Claude:')
      );
      
      consoleSpy.mockRestore();
    });
  });
});