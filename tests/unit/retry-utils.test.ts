import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  isRetryableError, 
  calculateBackoffDelay, 
  withRetry, 
  RetryableError,
  formatRetryStats 
} from '../../src/services/claude/retry-utils.js';

describe('retry-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isRetryableError', () => {
    it('should identify exit codes 1-2 as retryable', () => {
      expect(isRetryableError({ exitCode: 1 })).toBe(true);
      expect(isRetryableError({ exitCode: 2 })).toBe(true);
    });

    it('should identify timeout errors as retryable', () => {
      expect(isRetryableError({ timedOut: true })).toBe(true);
      expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
    });

    it('should identify network errors as retryable', () => {
      expect(isRetryableError({ code: 'ECONNREFUSED' })).toBe(true);
      expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
      expect(isRetryableError({ code: 'EPIPE' })).toBe(true);
    });

    it('should identify exit code 127 as non-retryable', () => {
      expect(isRetryableError({ exitCode: 127 })).toBe(false);
    });

    it('should identify permission errors as non-retryable', () => {
      expect(isRetryableError({ code: 'ENOENT' })).toBe(false);
      expect(isRetryableError({ code: 'EACCES' })).toBe(false);
      expect(isRetryableError({ code: 'EPERM' })).toBe(false);
    });

    it('should default unknown errors to non-retryable', () => {
      expect(isRetryableError({ someOtherError: true })).toBe(false);
      expect(isRetryableError({})).toBe(false);
    });
  });

  describe('calculateBackoffDelay', () => {
    const config = {
      maxRetries: 5,
      retryDelay: 1000,
      retryBackoffMultiplier: 2,
      maxRetryDelay: 30000
    };

    it('should calculate exponential backoff correctly', () => {
      // Note: These tests use a range because of jitter
      const delay0 = calculateBackoffDelay(0, config);
      expect(delay0).toBeGreaterThanOrEqual(1000);
      expect(delay0).toBeLessThanOrEqual(1100); // 1000 + 10% jitter

      const delay1 = calculateBackoffDelay(1, config);
      expect(delay1).toBeGreaterThanOrEqual(2000);
      expect(delay1).toBeLessThanOrEqual(2200); // 2000 + 10% jitter

      const delay2 = calculateBackoffDelay(2, config);
      expect(delay2).toBeGreaterThanOrEqual(4000);
      expect(delay2).toBeLessThanOrEqual(4400); // 4000 + 10% jitter
    });

    it('should cap delay at maxRetryDelay', () => {
      const delay10 = calculateBackoffDelay(10, config); // Would be 1024000 without cap
      expect(delay10).toBeGreaterThanOrEqual(30000);
      expect(delay10).toBeLessThanOrEqual(33000); // 30000 + 10% jitter
    });

    it('should add jitter to prevent thundering herd', () => {
      // Run multiple times to ensure jitter is applied
      const delays = Array.from({ length: 10 }, () => calculateBackoffDelay(0, config));
      const uniqueDelays = new Set(delays);
      
      // Should have multiple unique values due to jitter
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });

  describe('withRetry', () => {
    const config = {
      maxRetries: 3,
      retryDelay: 100,
      retryBackoffMultiplier: 2,
      maxRetryDelay: 1000,
      verbose: false
    };

    it('should succeed on first attempt without retries', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await withRetry(operation, config, 'test operation');
      
      expect(result.result).toBe('success');
      expect(result.retryAttempts).toBe(0);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors and eventually succeed', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce({ exitCode: 1, message: 'first failure' })
        .mockRejectedValueOnce({ exitCode: 2, message: 'second failure' })
        .mockResolvedValue('success');
      
      const promise = withRetry(operation, config, 'test operation');
      
      // Fast-forward through delays
      await vi.advanceTimersByTimeAsync(10000);
      
      const result = await promise;
      
      expect(result.result).toBe('success');
      expect(result.retryAttempts).toBe(2);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const operation = vi.fn()
        .mockRejectedValue({ exitCode: 127, message: 'command not found' });
      
      await expect(withRetry(operation, config, 'test operation'))
        .rejects.toMatchObject({ exitCode: 127 });
      
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw RetryableError after max retries exhausted', async () => {
      const operation = vi.fn()
        .mockRejectedValue({ exitCode: 1, message: 'persistent failure' });
      
      const promise = withRetry(operation, config, 'test operation');
      
      // Handle the promise rejection and advance timers concurrently
      const [error] = await Promise.allSettled([
        promise,
        vi.advanceTimersByTimeAsync(10000)
      ]);
      
      if (error.status !== 'rejected') {
        expect.fail('Should have thrown RetryableError');
      }
      
      expect(error.reason).toBeInstanceOf(RetryableError);
      expect(error.reason.message).toBe('test operation failed after 3 retry attempts: persistent failure');
      expect(error.reason.originalError).toEqual({ exitCode: 1, message: 'persistent failure' });
      
      expect(operation).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should log verbose output when enabled', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const verboseConfig = { ...config, verbose: true };
      
      const operation = vi.fn()
        .mockRejectedValueOnce({ exitCode: 1 })
        .mockResolvedValue('success');
      
      const promise = withRetry(operation, verboseConfig, 'test operation');
      await vi.advanceTimersByTimeAsync(10000);
      await promise;
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Retry attempt 1/3')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('succeeded after 1 retry attempt')
      );
      
      consoleLogSpy.mockRestore();
    });

    it('should respect maxRetries of 0 (no retries)', async () => {
      const noRetryConfig = { ...config, maxRetries: 0 };
      const operation = vi.fn()
        .mockRejectedValue({ exitCode: 1, message: 'failure' });
      
      const promise = withRetry(operation, noRetryConfig, 'test operation');
      
      // Handle the promise rejection properly
      const [error] = await Promise.allSettled([promise]);
      
      if (error.status !== 'rejected') {
        expect.fail('Should have thrown RetryableError');
      }
      
      expect(error.reason).toBeInstanceOf(RetryableError);
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('formatRetryStats', () => {
    it('should return empty string for 0 retries', () => {
      expect(formatRetryStats(0)).toBe('');
    });

    it('should format single retry correctly', () => {
      expect(formatRetryStats(1)).toBe(' (after 1 retry)');
    });

    it('should format multiple retries correctly', () => {
      expect(formatRetryStats(3)).toBe(' (after 3 retries)');
    });
  });
});