import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ClaudeService, getClaudeService } from '../../../src/services/claude/index.js';
import { ConfigManager } from '../../../src/core/config.js';

// Mock fs and child_process
vi.mock('fs');
vi.mock('child_process');
vi.mock('execa');

const mockFs = vi.mocked(fs);
const mockExeca = vi.hoisted(() => vi.fn());

vi.mock('execa', () => ({
  execa: mockExeca
}));

describe('Claude Service', () => {
  let originalEnv: typeof process.env;
  let tempConfigPath: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempConfigPath = path.join(os.tmpdir(), 'test-config.json');
    vi.clearAllMocks();
    
    // Reset the singleton
    (getClaudeService as any).instance = null;
    
    // Mock fs calls - be selective about which paths exist
    mockFs.existsSync.mockImplementation((path) => {
      const pathStr = String(path);
      // Only make specific test paths exist
      return pathStr === '/valid/claude/path' || 
             pathStr === '/custom/claude/path' ||
             pathStr === '/valid/path/to/claude';
    });
    mockFs.statSync.mockImplementation((path) => {
      const pathStr = String(path);
      if (pathStr === '/valid/claude/path' || 
          pathStr === '/custom/claude/path' ||
          pathStr === '/valid/path/to/claude') {
        return { isFile: () => true } as any;
      }
      throw new Error('Path not found');
    });
    mockFs.accessSync.mockImplementation((path) => {
      const pathStr = String(path);
      if (pathStr === '/valid/claude/path' || 
          pathStr === '/custom/claude/path' ||
          pathStr === '/valid/path/to/claude') {
        return; // No error = accessible
      }
      throw new Error('No access');
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Configuration Validation', () => {
    it('should validate when Claude is disabled', () => {
      const mockConfig = {
        claude: { enabled: false }
      };
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => mockConfig,
        getClaudeConfig: () => mockConfig.claude,
        getClaudePath: () => null
      } as any);

      const service = new ClaudeService();
      const validation = service.validateConfiguration();
      
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('Claude integration is disabled');
    });

    it('should validate when Claude path is missing', () => {
      const mockConfig = {
        claude: { enabled: true }
      };
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => mockConfig,
        getClaudeConfig: () => mockConfig.claude,
        getClaudePath: () => null
      } as any);

      const service = new ClaudeService();
      const validation = service.validateConfiguration();
      
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('Claude path not found');
    });

    it('should validate successfully with valid config', () => {
      const mockConfig = {
        claude: { 
          enabled: true,
          claudePath: '/valid/path/to/claude'
        }
      };
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => mockConfig,
        getClaudeConfig: () => mockConfig.claude,
        getClaudePath: () => '/valid/path/to/claude'
      } as any);

      const service = new ClaudeService();
      const validation = service.validateConfiguration();
      
      expect(validation.isValid).toBe(true);
      expect(validation.claudePath).toBe('/valid/path/to/claude');
    });
  });

  describe('Service Initialization', () => {
    it('should initialize with default config when Claude is disabled', () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({}),
        getClaudeConfig: () => null,
        getClaudePath: () => null
      } as any);

      const service = new ClaudeService();
      
      expect(service.isEnabled()).toBe(false);
      expect(service.getMaxIterations()).toBe(20);
      expect(service.getTestTimeout()).toBe(900000);
    });

    it('should initialize with custom config', () => {
      const customConfig = {
        enabled: true,
        maxIterations: 15,
        testTimeout: 720000,
        claudePath: '/custom/claude/path'
      };

      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: customConfig }),
        getClaudeConfig: () => customConfig,
        getClaudePath: () => '/custom/claude/path'
      } as any);

      const service = new ClaudeService();
      
      expect(service.isEnabled()).toBe(true);
      expect(service.getMaxIterations()).toBe(15);
      expect(service.getTestTimeout()).toBe(720000);
      expect(service.getClaudePath()).toBe('/custom/claude/path');
    });
  });

  describe('Claude Availability Check', () => {
    it('should return false when Claude is disabled', async () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { enabled: false } }),
        getClaudeConfig: () => ({ enabled: false }),
        getClaudePath: () => null
      } as any);

      const service = new ClaudeService();
      const available = await service.isAvailable();
      
      expect(available).toBe(false);
    });

    it('should return false when Claude path is missing', async () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { enabled: true } }),
        getClaudeConfig: () => ({ enabled: true }),
        getClaudePath: () => null
      } as any);

      const service = new ClaudeService();
      const available = await service.isAvailable();
      
      expect(available).toBe(false);
    });

    it('should return true when Claude version check succeeds', async () => {
      mockExeca.mockResolvedValue({ exitCode: 0 });
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { enabled: true, claudePath: '/valid/claude/path' } }),
        getClaudeConfig: () => ({ enabled: true, claudePath: '/valid/claude/path' }),
        getClaudePath: () => '/valid/claude/path'
      } as any);

      const service = new ClaudeService();
      const available = await service.isAvailable();
      
      expect(available).toBe(true);
      expect(mockExeca).toHaveBeenCalledWith('/valid/claude/path', ['--version'], {
        timeout: 5000,
        reject: false
      });
    });

    it('should return false when Claude version check fails', async () => {
      mockExeca.mockResolvedValue({ exitCode: 1 });
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { enabled: true } }),
        getClaudeConfig: () => ({ enabled: true }),
        getClaudePath: () => '/valid/claude/path'
      } as any);

      const service = new ClaudeService();
      const available = await service.isAvailable();
      
      expect(available).toBe(false);
    });
  });

  describe('Test Fixing', () => {
    it('should handle successful test fix', async () => {
      const mockResult = {
        exitCode: 0,
        stderr: '',
        stdout: 'Test fixed successfully'
      };
      // Add delay to mock
      mockExeca.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(mockResult), 10))
      );
      
      // Mock fs.readFileSync to return test content
      mockFs.readFileSync.mockReturnValue('describe("test", () => {});');
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { 
          enabled: true, 
          testTimeout: 720000,
          prompt: 'fix {testFilePath}',
          claudePath: '/valid/claude/path'
        } }),
        getClaudeConfig: () => ({ 
          enabled: true, 
          testTimeout: 720000,
          prompt: 'fix {testFilePath}',
          claudePath: '/valid/claude/path'
        }),
        getClaudePath: () => '/valid/claude/path'
      } as any);

      const service = new ClaudeService();
      const result = await service.fixTest('/path/to/test.js');
      
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.duration).toBeGreaterThan(0);
      
      // Updated expectation to match actual implementation
      expect(mockExeca).toHaveBeenCalledWith('/valid/claude/path', ['-p', '--output-format', 'stream-json', '--verbose'], {
        timeout: 720000,
        env: process.env,
        buffer: false,
        input: 'fix /path/to/test.js'
      });
    });

    it('should handle test fix failure', async () => {
      let stderrCallback: ((chunk: Buffer) => void) | null = null;
      
      // Mock execa to return a child process with event emitters
      const mockChild = {
        stdout: {
          on: vi.fn()
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              stderrCallback = callback;
            }
          })
        }
      };
      
      mockExeca.mockImplementation(() => {
        const promise = new Promise(resolve => {
          // Simulate stderr data being received
          setTimeout(() => {
            if (stderrCallback) {
              stderrCallback(Buffer.from('Claude error message'));
            }
          }, 5);
          
          // Resolve with exit code 1
          setTimeout(() => resolve({
            exitCode: 1,
            stderr: '',
            stdout: ''
          }), 10);
        }) as any;
        
        // Add the event emitters to the promise
        promise.stdout = mockChild.stdout;
        promise.stderr = mockChild.stderr;
        
        return promise;
      });
      
      // Mock fs.readFileSync to return test content  
      mockFs.readFileSync.mockReturnValue('describe("test", () => {});');
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { 
          enabled: true, 
          testTimeout: 720000,
          prompt: 'fix {testFilePath}',
          claudePath: '/valid/claude/path'
        } }),
        getClaudeConfig: () => ({ 
          enabled: true, 
          testTimeout: 720000,
          prompt: 'fix {testFilePath}',
          claudePath: '/valid/claude/path'
        }),
        getClaudePath: () => '/valid/claude/path'
      } as any);

      const service = new ClaudeService();
      const result = await service.fixTest('/path/to/test.js');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude error message');
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Timeout') as any;
      timeoutError.timedOut = true;
      mockExeca.mockRejectedValue(timeoutError);
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { 
          enabled: true, 
          testTimeout: 720000,
          prompt: 'fix {testFilePath}',
          claudePath: '/valid/claude/path'
        } }),
        getClaudeConfig: () => ({ 
          enabled: true, 
          testTimeout: 720000,
          prompt: 'fix {testFilePath}',
          claudePath: '/valid/claude/path'
        }),
        getClaudePath: () => '/valid/claude/path'
      } as any);

      const service = new ClaudeService();
      const result = await service.fixTest('/path/to/test.js');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude timed out after 720000ms');
    });

    it('should include error context in prompt when provided', async () => {
      mockExeca.mockImplementation(() => {
        const promise = Promise.resolve({ exitCode: 0, stderr: '', stdout: '' }) as any;
        promise.stdout = { on: vi.fn() };
        promise.stderr = { on: vi.fn() };
        return promise;
      });
      
      // Mock fs.readFileSync to return test content
      mockFs.readFileSync.mockReturnValue('describe("test", () => {});');
      
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { 
          enabled: true, 
          testTimeout: 720000,
          prompt: 'fix {testFilePath}',
          claudePath: '/valid/claude/path'
        } }),
        getClaudeConfig: () => ({ 
          enabled: true, 
          testTimeout: 720000,
          prompt: 'fix {testFilePath}',
          claudePath: '/valid/claude/path'
        }),
        getClaudePath: () => '/valid/claude/path'
      } as any);

      const service = new ClaudeService();
      await service.fixTest('/path/to/test.js', 'Previous error: timeout');
      
      // Updated expectation to match actual implementation
      expect(mockExeca).toHaveBeenCalledWith('/valid/claude/path', ['-p', '--output-format', 'stream-json', '--verbose'], {
        timeout: 720000,
        env: process.env,
        buffer: false,
        input: expect.stringContaining('Previous error context:\nPrevious error: timeout')
      });
    });

    it('should fail when configuration is invalid', async () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { enabled: false } }),
        getClaudeConfig: () => ({ enabled: false }),
        getClaudePath: () => null
      } as any);

      const service = new ClaudeService();
      const result = await service.fixTest('/path/to/test.js');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude integration is disabled');
      expect(mockExeca).not.toHaveBeenCalled();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance when called multiple times', () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { enabled: false } }),
        getClaudeConfig: () => ({ enabled: false }),
        getClaudePath: () => null
      } as any);

      const service1 = getClaudeService();
      const service2 = getClaudeService();
      
      expect(service1).toBe(service2);
    });

    it('should create new instance when config path changes', () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { enabled: false } }),
        getClaudeConfig: () => ({ enabled: false }),
        getClaudePath: () => null
      } as any);

      const service1 = getClaudeService();
      const service2 = getClaudeService('/different/config/path');
      
      expect(service1).not.toBe(service2);
    });

    it('should create new instance when claude path override changes', () => {
      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: { enabled: false } }),
        getClaudeConfig: () => ({ enabled: false }),
        getClaudePath: () => null
      } as any);

      const service1 = getClaudeService();
      const service2 = getClaudeService(undefined, '/different/claude/path');
      
      expect(service1).not.toBe(service2);
    });
  });

  describe('Config Methods', () => {
    it('should return a copy of the config', () => {
      const originalConfig = {
        enabled: true,
        maxIterations: 15,
        testTimeout: 720000
      };

      vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => ({ claude: originalConfig }),
        getClaudeConfig: () => originalConfig,
        getClaudePath: () => '/claude/path'
      } as any);

      const service = new ClaudeService();
      const config = service.getConfig();
      
      // Modify returned config
      config.maxIterations = 999;
      
      // Original should be unchanged
      expect(service.getMaxIterations()).toBe(15);
    });
  });
});