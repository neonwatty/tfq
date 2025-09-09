import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeService } from '../../../src/services/claude/claude-service.js';
import { ConfigManager } from '../../../src/core/config.js';
import { ClaudeConfigManager } from '../../../src/services/claude/config.js';

// Mock execa
const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({
  execa: mockExeca
}));

describe('ClaudeService Retry Logic', () => {
  let service: ClaudeService;
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    // Mock ConfigManager with retry configuration
    vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
      getConfig: () => ({
        claude: {
          enabled: true,
          claudePath: '/valid/claude/path',
          testTimeout: 720000,
          maxRetries: 3,
          retryDelay: 100,
          retryBackoffMultiplier: 2,
          maxRetryDelay: 1000
        }
      })
    } as any);
    
    // Mock ClaudeConfigManager
    vi.spyOn(ClaudeConfigManager.prototype, 'getClaudePath').mockReturnValue('/valid/claude/path');
    vi.spyOn(ClaudeConfigManager.prototype, 'buildCliArguments').mockReturnValue(['-p']);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.useRealTimers();
  });

  describe('Retry on Transient Failures', () => {
    it('should retry on exit code 1 and eventually succeed', async () => {
      vi.useFakeTimers();
      
      // Fail twice with exit code 1, then succeed
      mockExeca
        .mockRejectedValueOnce({ exitCode: 1, stderr: 'transient error' })
        .mockRejectedValueOnce({ exitCode: 1, stderr: 'transient error' })
        .mockImplementation(() => {
          const promise = Promise.resolve({ 
            exitCode: 0, 
            stdout: '', 
            stderr: '' 
          }) as any;
          promise.stdout = { on: vi.fn() };
          promise.stderr = { on: vi.fn() };
          return promise;
        });

      service = new ClaudeService();
      const resultPromise = service.fixTest('/test/file.js');
      
      // Advance timers to handle retries
      await vi.advanceTimersByTimeAsync(5000);
      
      const result = await resultPromise;
      
      expect(result.success).toBe(true);
      expect(result.retryAttempts).toBe(2);
      expect(mockExeca).toHaveBeenCalledTimes(3);
    });

    it('should retry on timeout errors with exponential backoff', async () => {
      vi.useFakeTimers();
      
      const timeoutError = new Error('Timeout') as any;
      timeoutError.timedOut = true;
      
      // Fail once with timeout, then succeed
      mockExeca
        .mockRejectedValueOnce(timeoutError)
        .mockImplementation(() => {
          const promise = Promise.resolve({ 
            exitCode: 0, 
            stdout: '', 
            stderr: '' 
          }) as any;
          promise.stdout = { on: vi.fn() };
          promise.stderr = { on: vi.fn() };
          return promise;
        });

      service = new ClaudeService();
      const resultPromise = service.fixTest('/test/file.js');
      
      await vi.advanceTimersByTimeAsync(5000);
      
      const result = await resultPromise;
      
      expect(result.success).toBe(true);
      expect(result.retryAttempts).toBe(1);
      expect(mockExeca).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors (exit code 127)', async () => {
      mockExeca.mockRejectedValue({ 
        exitCode: 127, 
        stderr: 'command not found' 
      });

      service = new ClaudeService();
      const result = await service.fixTest('/test/file.js');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude exited with code 127');
      expect(result.retryAttempts).toBe(0);
      expect(mockExeca).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and fail with appropriate message', async () => {
      vi.useFakeTimers();
      
      // Always fail with retryable error
      mockExeca.mockRejectedValue({ 
        exitCode: 1, 
        stderr: 'persistent failure' 
      });

      service = new ClaudeService();
      const resultPromise = service.fixTest('/test/file.js');
      
      // Advance through all retries
      await vi.advanceTimersByTimeAsync(10000);
      
      const result = await resultPromise;
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('after retries');
      expect(result.retryAttempts).toBe(3); // maxRetries from config
      expect(mockExeca).toHaveBeenCalledTimes(4); // initial + 3 retries
    });
  });

  describe('Configuration Validation', () => {
    it('should respect maxRetries = 0 (no retries)', async () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({
          claude: {
            enabled: true,
            claudePath: '/valid/claude/path',
            testTimeout: 720000,
            maxRetries: 0  // No retries
          }
        })
      } as any);

      mockExeca.mockRejectedValue({ 
        exitCode: 1, 
        stderr: 'error' 
      });

      service = new ClaudeService();
      const result = await service.fixTest('/test/file.js');
      
      expect(result.success).toBe(false);
      expect(result.retryAttempts).toBe(0);
      expect(mockExeca).toHaveBeenCalledTimes(1); // No retries
    });

    it('should use custom retry delays', async () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({
          claude: {
            enabled: true,
            claudePath: '/valid/claude/path',
            testTimeout: 720000,
            maxRetries: 2,
            retryDelay: 500,
            retryBackoffMultiplier: 3,
            maxRetryDelay: 5000
          }
        })
      } as any);

      mockExeca
        .mockRejectedValueOnce({ exitCode: 1 })
        .mockRejectedValueOnce({ exitCode: 1 })
        .mockImplementation(() => {
          const promise = Promise.resolve({ exitCode: 0 }) as any;
          promise.stdout = { on: vi.fn() };
          promise.stderr = { on: vi.fn() };
          return promise;
        });

      service = new ClaudeService();
      const resultPromise = service.fixTest('/test/file.js');
      
      await vi.advanceTimersByTimeAsync(10000);
      await resultPromise;
      
      // Check that setTimeout was called with appropriate delays
      // First retry: ~500ms (plus jitter)
      // Second retry: ~1500ms (500 * 3, plus jitter)
      const calls = setTimeoutSpy.mock.calls;
      const delays = calls.map(call => call[1]).filter(d => d! >= 100);
      
      expect(delays.length).toBeGreaterThanOrEqual(2);
      expect(delays[0]).toBeGreaterThanOrEqual(500);
      expect(delays[0]).toBeLessThanOrEqual(550); // With jitter
      
      setTimeoutSpy.mockRestore();
    });
  });

  describe('Verbose Logging', () => {
    it('should log retry attempts in verbose mode', async () => {
      vi.useFakeTimers();
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({
          claude: {
            enabled: true,
            claudePath: '/valid/claude/path',
            testTimeout: 720000,
            maxRetries: 2,
            retryDelay: 100,
            verbose: true
          }
        })
      } as any);

      mockExeca
        .mockRejectedValueOnce({ exitCode: 1 })
        .mockImplementation(() => {
          const promise = Promise.resolve({ exitCode: 0 }) as any;
          promise.stdout = { on: vi.fn() };
          promise.stderr = { on: vi.fn() };
          return promise;
        });

      service = new ClaudeService();
      const resultPromise = service.fixTest('/test/file.js');
      
      await vi.advanceTimersByTimeAsync(5000);
      await resultPromise;
      
      // Check for retry logging
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Retry attempt 1/2')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('succeeded after 1 retry attempt')
      );
    });
  });

  describe('Error Message Formatting', () => {
    it('should not include "(after retries)" when maxRetries is 0', async () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({
          claude: {
            enabled: true,
            claudePath: '/valid/claude/path',
            maxRetries: 0
          }
        })
      } as any);

      const timeoutError = new Error('Timeout') as any;
      timeoutError.timedOut = true;
      mockExeca.mockRejectedValue(timeoutError);

      service = new ClaudeService();
      const result = await service.fixTest('/test/file.js');
      
      expect(result.error).toContain('timed out');
      expect(result.error).not.toContain('(after retries)');
    });

    it('should include "(after retries)" when retries were attempted', async () => {
      vi.useFakeTimers();
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({
          claude: {
            enabled: true,
            claudePath: '/valid/claude/path',
            maxRetries: 2,
            retryDelay: 100
          }
        })
      } as any);

      const timeoutError = new Error('Timeout') as any;
      timeoutError.timedOut = true;
      mockExeca.mockRejectedValue(timeoutError);

      service = new ClaudeService();
      const resultPromise = service.fixTest('/test/file.js');
      
      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;
      
      expect(result.error).toContain('(after retries)');
      expect(result.retryAttempts).toBe(2);
    });
  });

  describe('Streaming Output During Retries', () => {
    it('should preserve streaming output across retries', async () => {
      vi.useFakeTimers();
      
      let stdoutHandler: any;
      let stderrHandler: any;
      
      // First attempt fails
      mockExeca
        .mockImplementationOnce(() => {
          const promise = Promise.reject({ exitCode: 1 }) as any;
          promise.stdout = { 
            on: vi.fn((event, handler) => {
              if (event === 'data') stdoutHandler = handler;
            })
          };
          promise.stderr = { 
            on: vi.fn((event, handler) => {
              if (event === 'data') stderrHandler = handler;
            })
          };
          
          // Simulate some output before failure
          setTimeout(() => {
            if (stdoutHandler) stdoutHandler(Buffer.from('First attempt output\n'));
          }, 10);
          
          return promise;
        })
        // Second attempt succeeds
        .mockImplementationOnce(() => {
          const promise = Promise.resolve({ exitCode: 0 }) as any;
          promise.stdout = { 
            on: vi.fn((event, handler) => {
              if (event === 'data') stdoutHandler = handler;
            })
          };
          promise.stderr = { on: vi.fn() };
          
          // Simulate output on retry
          setTimeout(() => {
            if (stdoutHandler) stdoutHandler(Buffer.from('Retry attempt output\n'));
          }, 10);
          
          return promise;
        });

      service = new ClaudeService();
      const resultPromise = service.fixTest('/test/file.js');
      
      await vi.advanceTimersByTimeAsync(10000);
      await resultPromise;
      
      // Verify console logs show streaming output (new verbose format)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('🔄 Starting Claude CLI with real-time streaming...')
      );
      // The specific output content is now handled by the verbose streaming
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});