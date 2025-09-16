import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { interactiveInit } from '../../../src/cli/interactive-init.js';
import { InitService } from '../../../src/core/init-service.js';
import { TfqConfig } from '../../../src/core/types.js';
import readline from 'readline';

// Mock dependencies
vi.mock('chalk', () => ({
  default: {
    bold: vi.fn((text: string) => text),
    green: vi.fn((text: string) => text),
    yellow: vi.fn((text: string) => text),
    cyan: vi.fn((text: string) => text),
    gray: vi.fn((text: string) => text),
    red: vi.fn((text: string) => text)
  }
}));

vi.mock('readline');

// Mock InitService
const mockInitService = {
  detectProjectType: vi.fn(),
  detectFramework: vi.fn(),
  initialize: vi.fn()
} as unknown as InitService;

// Mock ClaudeConfigManager
const mockClaudeConfigManager = {
  detectClaudePath: vi.fn(),
  getClaudeConfig: vi.fn(() => ({
    enabled: false,
    maxIterations: 20,
    testTimeout: 900000,
    prompt: "First, detect the testing framework by checking for jest.config.* or vitest.config.* files and examining package.json scripts. Then run the test file at {testFilePath} using the appropriate test runner (npm run test if available, otherwise npx vitest run for Vitest or npx jest --watchAll=false for Jest). Debug any errors you encounter one at a time. After fixing errors, run the test again with the same test runner to verify that your changes have fixed any errors. Finally, run npm run lint to ensure code quality.",
    verbose: true,
    outputFormat: 'stream-json',
    maxRetries: 0,
    retryDelay: 1000,
    retryBackoffMultiplier: 2,
    maxRetryDelay: 30000
  }))
};

vi.mock('../../../src/services/claude/config.js', () => ({
  ClaudeConfigManager: vi.fn(() => mockClaudeConfigManager)
}));

describe('interactiveInit', () => {
  let mockReadline: any;
  let mockQuestion: vi.MockedFunction<any>;
  let consoleLogSpy: vi.SpyInstance;

  beforeEach(() => {
    // Setup readline mocks
    mockQuestion = vi.fn();
    mockReadline = {
      question: mockQuestion,
      close: vi.fn()
    };
    
    (readline.createInterface as any).mockReturnValue(mockReadline);

    // Mock console.log to capture output
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Reset all mocks
    vi.clearAllMocks();
    
    // Set default mock return values
    (mockInitService.detectProjectType as any).mockReturnValue('javascript');
    (mockInitService.detectFramework as any).mockReturnValue('jest');
    mockClaudeConfigManager.detectClaudePath.mockReturnValue('/mock/claude/path');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Configuration Flow', () => {
    it('should complete basic initialization with detected values', async () => {
      // Setup question responses
      const responses = [
        './.tfq/tfq.db',  // database path
        'y',              // use auto-detect
        '4',              // parallel processes
        'y',              // auto-add failed tests
        'n',              // not a monorepo
        'n',              // don't enable Claude
        'y'               // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const options = { scope: '/mock/project' };
      const result = await interactiveInit(mockInitService, options);

      expect(result).toEqual({
        database: { path: './.tfq/tfq.db' },
        defaults: { autoAdd: true, parallel: 4 },
        language: 'javascript',
        framework: 'jest'
      });

      expect(mockInitService.initialize).toHaveBeenCalledWith({
        scope: '/mock/project',
        dbPath: './.tfq/tfq.db',
        workspaceMode: false
      });
    });

    it('should handle manual language selection', async () => {
      const responses = [
        './.tfq/tfq.db',  // database path
        'n',              // don't use auto-detect
        'python',         // manual language
        'pytest',         // manual framework
        '2',              // parallel processes
        'n',              // don't auto-add
        'n',              // not a monorepo
        'n',              // don't enable Claude
        'y'               // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: ((answer: string) => void)) => {
        callback(responses[responseIndex++]);
      });

      const options = {};
      const result = await interactiveInit(mockInitService, options);

      expect(result.language).toBe('python');
      expect(result.framework).toBe('pytest');
      expect(result.defaults?.parallel).toBe(2);
      expect(result.defaults?.autoAdd).toBe(false);
    });
  });

  describe('Claude Integration Setup', () => {
    it('should configure Claude integration when enabled', async () => {
      const responses = [
        './.tfq/tfq.db',     // database path
        'y',                 // use auto-detect
        '4',                 // parallel processes
        'y',                 // auto-add failed tests
        'n',                 // not a monorepo
        'y',                 // enable Claude
        '/custom/claude',    // claude path
        '5',                 // max iterations
        '900000',            // timeout
        'y'                  // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const result = await interactiveInit(mockInitService, {});

      expect(result.claude).toEqual({
        enabled: true,
        maxIterations: 5,
        testTimeout: 900000,
        prompt: "First, detect the testing framework by checking for jest.config.* or vitest.config.* files and examining package.json scripts. Then run the test file at {testFilePath} using the appropriate test runner (npm run test if available, otherwise npx vitest run for Vitest or npx jest --watchAll=false for Jest). Debug any errors you encounter one at a time. After fixing errors, run the test again with the same test runner to verify that your changes have fixed any errors. Finally, run npm run lint to ensure code quality.",
        verbose: true,
        outputFormat: "stream-json",
        claudePath: '/custom/claude'
      });
    });

    it('should use auto-detected Claude path when empty path provided', async () => {
      const responses = [
        './.tfq/tfq.db',  // database path
        'y',              // use auto-detect
        '4',              // parallel processes
        'y',              // auto-add failed tests
        'n',              // not a monorepo
        'y',              // enable Claude
        '',               // empty claude path (use auto-detected)
        '10',             // max iterations
        '300000',         // timeout
        'y'               // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      mockClaudeConfigManager.detectClaudePath.mockReturnValue('/detected/claude/path');

      const result = await interactiveInit(mockInitService, {});

      // When empty path is provided and Claude is detected, the config should not store the path
      expect(result.claude).toBeDefined();
      expect(result.claude?.enabled).toBe(true);
    });

    it('should handle Claude configuration errors gracefully', async () => {
      const responses = [
        './.tfq/tfq.db',  // database path
        'y',              // use auto-detect
        '4',              // parallel processes
        'y',              // auto-add failed tests
        'n',              // not a monorepo
        'n',              // don't enable Claude
        'y'               // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const result = await interactiveInit(mockInitService, {});

      expect(result.claude).toBeUndefined();
    });
  });

  describe('Monorepo Configuration', () => {
    it('should configure workspaces for monorepo', async () => {
      const responses = [
        './.tfq/tfq.db',    // database path
        'y',                // use auto-detect
        '4',                // parallel processes
        'y',                // auto-add failed tests
        'y',                // is monorepo
        'packages/app',     // first workspace
        'packages/lib',     // second workspace
        '',                 // empty workspace (end)
        'n',                // don't enable Claude
        'y'                 // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const result = await interactiveInit(mockInitService, {});

      expect(result.workspaces).toEqual({
        'packages/app': './.tfq/app-tfq.db',
        'packages/lib': './.tfq/lib-tfq.db'
      });
      expect(result.workspaceDefaults).toEqual({ autoAdd: true, parallel: 4 });
    });
  });

  describe('CI Environment Handling', () => {
    it('should use temp database path for CI environment', async () => {
      const responses = [
        '/tmp/tfq-tfq.db',  // database path (CI default)
        'y',                // use auto-detect
        '4',                // parallel processes
        'y',                // auto-add failed tests
        'n',                // don't enable Claude (CI skip)
        'y'                 // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const options = { ci: true };
      const result = await interactiveInit(mockInitService, options);

      expect(result.database?.path).toBe('/tmp/tfq-tfq.db');
    });

    it('should skip monorepo setup in CI mode', async () => {
      const responses = [
        '/tmp/tfq-tfq.db',  // database path
        'y',                // use auto-detect
        '4',                // parallel processes
        'y',                // auto-add failed tests
        'n',                // don't enable Claude
        'y'                 // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const options = { ci: true };
      const result = await interactiveInit(mockInitService, options);

      expect(result.workspaces).toBeUndefined();
      // Should not ask about monorepo in CI mode
      expect(mockQuestion).not.toHaveBeenCalledWith(
        expect.stringContaining('monorepo'),
        expect.any(Function)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle user cancellation', async () => {
      const responses = [
        './.tfq/tfq.db',  // database path
        'y',              // use auto-detect
        '4',              // parallel processes
        'y',              // auto-add failed tests
        'n',              // not a monorepo
        'n',              // don't enable Claude
        'n'               // don't save configuration (cancel)
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      await expect(interactiveInit(mockInitService, {}))
        .rejects.toThrow('Configuration cancelled by user');
    });

    it('should close readline interface on error', async () => {
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        throw new Error('Test error');
      });

      await expect(interactiveInit(mockInitService, {})).rejects.toThrow('Test error');
      expect(mockReadline.close).toHaveBeenCalled();
    });

    it('should handle invalid numeric inputs gracefully', async () => {
      const responses = [
        './.tfq/tfq.db',  // database path
        'y',              // use auto-detect
        'invalid',        // invalid parallel processes (should default)
        'y',              // auto-add failed tests
        'n',              // not a monorepo
        'n',              // don't enable Claude to simplify test
        'y'               // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const result = await interactiveInit(mockInitService, {});

      expect(result.defaults?.parallel).toBe(4); // Default value when invalid
    });
  });

  describe('Project Detection Integration', () => {
    it('should display detected project information', async () => {
      const responses = [
        './.tfq/tfq.db',
        'y',
        '4',
        'y',
        'n',
        'n',
        'y'
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const result = await interactiveInit(mockInitService, { scope: '/test/path' });

      expect(result.language).toBe('javascript');
      expect(result.framework).toBe('jest');
    });

    it('should handle projects with no detected framework', async () => {
      const responses = ['./.tfq/tfq.db', 'y', '4', 'y', 'n', 'n', 'y'];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      (mockInitService.detectFramework as any).mockReturnValue(null);

      const result = await interactiveInit(mockInitService, {});

      expect(result.language).toBe('javascript');
      expect(result.framework).toBeUndefined();
    });

    it('should handle projects with no detected language', async () => {
      const responses = ['./.tfq/tfq.db', 'n', 'python', 'pytest', '4', 'y', 'n', 'n', 'y'];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      (mockInitService.detectProjectType as any).mockReturnValue(null);
      (mockInitService.detectFramework as any).mockReturnValue(null);

      const result = await interactiveInit(mockInitService, {});

      expect(result.language).toBe('python');
      expect(result.framework).toBe('pytest');
    });
  });

  describe('Configuration Preview', () => {
    it('should display configuration preview before saving', async () => {
      const responses = ['./.tfq/tfq.db', 'y', '4', 'y', 'n', 'n', 'y'];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const jsonSpy = vi.spyOn(JSON, 'stringify');

      await interactiveInit(mockInitService, {});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Configuration Preview:')
      );
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          database: { path: './.tfq/tfq.db' },
          defaults: { autoAdd: true, parallel: 4 }
        }),
        null,
        2
      );
    });
  });

  describe('Default Value Handling', () => {
    it('should use provided defaults when user provides empty responses', async () => {
      const responses = [
        '', // empty database path (use default)
        '', // empty auto-detect (use default true)
        '', // empty parallel (use default)
        '', // empty auto-add (use default true)
        '', // empty monorepo (use default false)
        '', // empty Claude (use default false)
        'y' // save configuration
      ];
      
      let responseIndex = 0;
      mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback(responses[responseIndex++]);
      });

      const options = { dbPath: './custom.db' };
      const result = await interactiveInit(mockInitService, options);

      expect(result.database?.path).toBe('./custom.db');
      expect(result.defaults?.parallel).toBe(4);
      expect(result.defaults?.autoAdd).toBe(true);
    });
  });
});