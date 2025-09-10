import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeConfigManager } from '../../../src/services/claude/config.js';

describe('Claude Config Retry Validation', () => {
  let consoleWarnSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('Retry Parameter Validation', () => {
    it('should accept valid retry configuration', () => {
      const config = {
        enabled: true,
        maxRetries: 5,
        retryDelay: 2000,
        retryBackoffMultiplier: 2.5,
        maxRetryDelay: 60000
      };

      const manager = new ClaudeConfigManager(config);
      const result = manager.getClaudeConfig();

      expect(result.maxRetries).toBe(5);
      expect(result.retryDelay).toBe(2000);
      expect(result.retryBackoffMultiplier).toBe(2.5);
      expect(result.maxRetryDelay).toBe(60000);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should validate maxRetries range (0-10)', () => {
      const configTooLow = {
        enabled: true,
        maxRetries: -1
      };

      new ClaudeConfigManager(configTooLow);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Warning: Claude maxRetries must be a number between 0 and 10'
      );

      consoleWarnSpy.mockClear();

      const configTooHigh = {
        enabled: true,
        maxRetries: 15
      };

      new ClaudeConfigManager(configTooHigh);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Warning: Claude maxRetries must be a number between 0 and 10'
      );
    });

    it('should validate retryDelay is positive', () => {
      const config = {
        enabled: true,
        retryDelay: -100
      };

      const manager = new ClaudeConfigManager(config);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Warning: Claude retryDelay must be a positive number'
      );
      
      // Should use default
      expect(manager.getClaudeConfig().retryDelay).toBe(1000);
    });

    it('should validate retryBackoffMultiplier >= 1', () => {
      const config = {
        enabled: true,
        retryBackoffMultiplier: 0.5
      };

      const manager = new ClaudeConfigManager(config);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Warning: Claude retryBackoffMultiplier must be a number >= 1'
      );
      
      // Should use default
      expect(manager.getClaudeConfig().retryBackoffMultiplier).toBe(2);
    });

    it('should validate maxRetryDelay >= retryDelay', () => {
      const config = {
        enabled: true,
        retryDelay: 5000,
        maxRetryDelay: 2000
      };

      const manager = new ClaudeConfigManager(config);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Warning: Claude maxRetryDelay must be >= retryDelay'
      );
      
      // Should use default
      expect(manager.getClaudeConfig().maxRetryDelay).toBe(30000);
    });

    it('should handle invalid type for maxRetries', () => {
      const config = {
        enabled: true,
        maxRetries: 'five' as any
      };

      const manager = new ClaudeConfigManager(config);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Warning: Claude maxRetries must be a number between 0 and 10'
      );
      
      expect(manager.getClaudeConfig().maxRetries).toBe(0);
    });
  });

  describe('Default Values', () => {
    it('should use correct defaults when retry config not provided', () => {
      const config = {
        enabled: true
      };

      const manager = new ClaudeConfigManager(config);
      const result = manager.getClaudeConfig();

      expect(result.maxRetries).toBe(0); // Backwards compatible
      expect(result.retryDelay).toBe(1000);
      expect(result.retryBackoffMultiplier).toBe(2);
      expect(result.maxRetryDelay).toBe(30000);
    });

    it('should include retry defaults in getDefaultClaudeConfig', () => {
      const defaults = ClaudeConfigManager.getDefaultClaudeConfig();

      expect(defaults.maxRetries).toBe(0);
      expect(defaults.retryDelay).toBe(1000);
      expect(defaults.retryBackoffMultiplier).toBe(2);
      expect(defaults.maxRetryDelay).toBe(30000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle maxRetries = 0 correctly', () => {
      const config = {
        enabled: true,
        maxRetries: 0
      };

      const manager = new ClaudeConfigManager(config);
      const result = manager.getClaudeConfig();

      expect(result.maxRetries).toBe(0);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle maxRetries = 10 correctly', () => {
      const config = {
        enabled: true,
        maxRetries: 10
      };

      const manager = new ClaudeConfigManager(config);
      const result = manager.getClaudeConfig();

      expect(result.maxRetries).toBe(10);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle partial retry configuration', () => {
      const config = {
        enabled: true,
        maxRetries: 3
        // Other retry params should use defaults
      };

      const manager = new ClaudeConfigManager(config);
      const result = manager.getClaudeConfig();

      expect(result.maxRetries).toBe(3);
      expect(result.retryDelay).toBe(1000); // Default
      expect(result.retryBackoffMultiplier).toBe(2); // Default
      expect(result.maxRetryDelay).toBe(30000); // Default
    });

    it('should skip validation when disabled', () => {
      const config = {
        enabled: false,
        maxRetries: 20 // Invalid but won't be validated
      };

      const manager = new ClaudeConfigManager(config);
      
      // Validation is skipped when disabled
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      
      // But the value is still stored
      expect(manager.getClaudeConfig().maxRetries).toBe(20);
    });
  });
});