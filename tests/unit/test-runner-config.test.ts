import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as os from 'os';
import { TestRunner } from '../../src/core/test-runner.js';
import { ConfigManager } from '../../src/core/config.js';
import { execSync } from 'child_process';

vi.mock('child_process');
const mockExecSync = execSync as any;

describe('TestRunner with Config', () => {
  let tempDir: string;
  let configPath: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfq-test-'));
    configPath = path.join(tempDir, '.tfqrc');
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Mock execSync to prevent actual command execution
    mockExecSync.mockReturnValue(Buffer.from(''));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('Default Language from Config', () => {
    it('should use defaultLanguage from config when not specified', () => {
      const config = {
        defaultLanguage: 'python'
      };
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      // Create a simple requirements.txt to avoid auto-detection issues
      fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'pytest==7.0.0');
      
      const runner = new TestRunner();
      const result = runner.run();
      
      expect(result.language).toBe('python');
    });

    it('should override config defaultLanguage when language is specified', () => {
      const config = {
        defaultLanguage: 'python'
      };
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const runner = new TestRunner({ language: 'ruby' });
      const result = runner.run();
      
      expect(result.language).toBe('ruby');
    });
  });

  describe('Default Framework from Config', () => {
    it('should use defaultFramework from config for the language', () => {
      const config = {
        defaultLanguage: 'javascript',
        defaultFrameworks: {
          javascript: 'mocha'
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const runner = new TestRunner();
      const result = runner.run();
      
      expect(result.framework).toBe('mocha');
    });

    it('should override config defaultFramework when framework is specified', () => {
      const config = {
        defaultFrameworks: {
          javascript: 'mocha'
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const runner = new TestRunner({ framework: 'jest' });
      const result = runner.run();
      
      expect(result.framework).toBe('jest');
    });
  });

  describe('Test Commands from Config', () => {
    it('should use custom test command from config', () => {
      const config = {
        testCommands: {
          'javascript:jest': 'npm run test:custom'
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const runner = new TestRunner({ language: 'javascript', framework: 'jest' });
      const result = runner.run();
      
      expect(result.command).toBe('npm run test:custom');
      expect(mockExecSync).toHaveBeenCalledWith(
        'npm run test:custom',
        expect.any(Object)
      );
    });

    it('should use default adapter command when no custom command in config', () => {
      const config = {};
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const runner = new TestRunner({ language: 'javascript', framework: 'jest' });
      const result = runner.run();
      
      expect(result.command).toBe('npx jest --watchAll=false');
    });

    it('should override config command when command is specified in options', () => {
      const config = {
        testCommands: {
          'javascript:jest': 'npm run test:custom'
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const runner = new TestRunner({ 
        language: 'javascript', 
        framework: 'jest',
        command: 'npm run test:override'
      });
      const result = runner.run();
      
      expect(result.command).toBe('npm run test:override');
    });
  });

  describe('Combined Config Usage', () => {
    it('should use all config values together', () => {
      const config = {
        defaultLanguage: 'ruby',
        defaultFrameworks: {
          ruby: 'minitest'
        },
        testCommands: {
          'ruby:minitest': 'rails test'
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const runner = new TestRunner();
      const result = runner.run();
      
      expect(result.language).toBe('ruby');
      expect(result.framework).toBe('minitest');
      expect(result.command).toBe('rails test');
    });

    it('should work with auto-detect and config defaults', () => {
      const config = {
        defaultFrameworks: {
          javascript: 'vitest'
        },
        testCommands: {
          'javascript:vitest': 'pnpm test'
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      // Create package.json to trigger auto-detect
      const packageJson = {
        name: 'test-project',
        scripts: {
          test: 'vitest'
        }
      };
      fs.writeFileSync(
        path.join(tempDir, 'package.json'), 
        JSON.stringify(packageJson)
      );
      
      const runner = new TestRunner({ autoDetect: true });
      const result = runner.run();
      
      expect(result.language).toBe('javascript');
      // Auto-detect will find vitest in package.json
      expect(result.framework).toBe('vitest');
      expect(result.command).toBe('pnpm test');
    });
  });
});