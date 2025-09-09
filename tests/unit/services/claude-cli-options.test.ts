import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ClaudeConfigManager } from '../../../src/services/claude/config.js';

describe('Claude CLI Options Comprehensive Tests', () => {
  let tempDir: string;
  let validTestDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-options-'));
    validTestDir = path.join(tempDir, 'valid-dir');
    fs.mkdirSync(validTestDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('addDir Option Tests', () => {
    it('should handle valid addDir paths', () => {
      const config = {
        enabled: true,
        addDir: [validTestDir, tempDir]
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      expect(args).toContain('--add-dir');
      expect(args).toContain(validTestDir);
      expect(args).toContain(tempDir);
      
      // Check that paths are included after --add-dir flag
      const addDirIndex = args.indexOf('--add-dir');
      expect(args[addDirIndex + 1]).toBe(validTestDir);
      expect(args[addDirIndex + 2]).toBe(tempDir);
    });

    it('should validate and filter out invalid addDir paths', () => {
      // Mock console.warn to capture validation warnings
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      try {
        const nonExistentDir = path.join(tempDir, 'does-not-exist');
        const fileInsteadOfDir = path.join(tempDir, 'file.txt');
        fs.writeFileSync(fileInsteadOfDir, 'test');

        const config = {
          enabled: true,
          addDir: [validTestDir, nonExistentDir, fileInsteadOfDir]
        };

        const manager = new ClaudeConfigManager(config);
        const actualConfig = manager.getClaudeConfig();

        // Should keep valid dir, filter out invalid ones
        expect(actualConfig.addDir).toEqual([validTestDir]);
        
        // Should have warnings
        expect(warnings.some(w => w.includes('does not exist'))).toBe(true);
        expect(warnings.some(w => w.includes('is not a directory'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should handle tilde expansion in addDir paths', () => {
      const config = {
        enabled: true,
        addDir: ['~/test-dir']
      };

      const manager = new ClaudeConfigManager(config);
      const actualConfig = manager.getClaudeConfig();

      // Should expand tilde to home directory
      if (actualConfig.addDir && actualConfig.addDir.length > 0) {
        expect(actualConfig.addDir[0]).toMatch(new RegExp(`^${os.homedir()}`));
      }
    });
  });

  describe('inputFormat Option Tests', () => {
    it('should handle valid inputFormat values', () => {
      const textConfig = {
        enabled: true,
        inputFormat: 'text' as const
      };

      const streamJsonConfig = {
        enabled: true,
        inputFormat: 'stream-json' as const
      };

      const textManager = new ClaudeConfigManager(textConfig);
      const textArgs = textManager.buildCliArguments();
      expect(textArgs).toContain('--input-format');
      expect(textArgs).toContain('text');

      const streamJsonManager = new ClaudeConfigManager(streamJsonConfig);
      const streamJsonArgs = streamJsonManager.buildCliArguments();
      expect(streamJsonArgs).toContain('--input-format');
      expect(streamJsonArgs).toContain('stream-json');
    });

    it('should validate and correct invalid inputFormat values', () => {
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      try {
        const config = {
          enabled: true,
          inputFormat: 'invalid-format' as any
        };

        const manager = new ClaudeConfigManager(config);
        const actualConfig = manager.getClaudeConfig();

        expect(actualConfig.inputFormat).toBe('text'); // Should default to text
        expect(warnings.some(w => w.includes('Invalid inputFormat'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('Permission-related Options Tests', () => {
    it('should handle permissionMode option', () => {
      const config = {
        enabled: true,
        permissionMode: 'acceptEdits'
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      expect(args).toContain('--permission-mode');
      expect(args).toContain('acceptEdits');
    });

    it('should handle permissionPromptTool option', () => {
      const config = {
        enabled: true,
        permissionPromptTool: 'mcp__auth__prompt'
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      expect(args).toContain('--permission-prompt-tool');
      expect(args).toContain('mcp__auth__prompt');
    });

    it('should validate permissionPromptTool type', () => {
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      try {
        const config = {
          enabled: true,
          permissionPromptTool: 123 as any // Invalid type
        };

        const manager = new ClaudeConfigManager(config);
        const actualConfig = manager.getClaudeConfig();

        expect(actualConfig.permissionPromptTool).toBeUndefined();
        expect(warnings.some(w => w.includes('permissionPromptTool must be a string'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('Session Management Options Tests', () => {
    it('should handle resumeSession option', () => {
      const config = {
        enabled: true,
        resumeSession: 'abc123session'
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      expect(args).toContain('--resume');
      expect(args).toContain('abc123session');
    });

    it('should handle continueSession option', () => {
      const config = {
        enabled: true,
        continueSession: true
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      expect(args).toContain('--continue');
    });

    it('should not add continue flag when continueSession is false', () => {
      const config = {
        enabled: true,
        continueSession: false
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      expect(args).not.toContain('--continue');
    });

    it('should warn about conflicting session options', () => {
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      try {
        const config = {
          enabled: true,
          resumeSession: 'session123',
          continueSession: true
        };

        new ClaudeConfigManager(config);

        expect(warnings.some(w => w.includes('Both continueSession and resumeSession are set'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('customArgs Option Tests', () => {
    it('should handle customArgs array', () => {
      const config = {
        enabled: true,
        customArgs: ['--custom-flag', 'value', '--another-flag']
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      expect(args).toContain('--custom-flag');
      expect(args).toContain('value');
      expect(args).toContain('--another-flag');
    });

    it('should append customArgs at the end', () => {
      const config = {
        enabled: true,
        verbose: true,
        customArgs: ['--last-flag']
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      // customArgs should be at the end
      const lastArg = args[args.length - 1];
      expect(lastArg).toBe('--last-flag');
    });

    it('should handle empty customArgs array', () => {
      const config = {
        enabled: true,
        customArgs: []
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      // Should still have base -p flag
      expect(args).toContain('-p');
      expect(args.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Integration and Combination Tests', () => {
    it('should handle multiple options correctly', () => {
      const config = {
        enabled: true,
        outputFormat: 'json' as const,
        verbose: true, // Should be suppressed due to JSON
        allowedTools: ['Read', 'Write'],
        model: 'sonnet',
        maxTurns: 5,
        customArgs: ['--extra-flag']
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).not.toContain('--verbose'); // Suppressed due to JSON
      expect(args).toContain('--allowedTools');
      expect(args).toContain('Read');
      expect(args).toContain('Write');
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
      expect(args).toContain('--max-turns');
      expect(args).toContain('5');
      expect(args).toContain('--extra-flag');
    });

    it('should maintain CLI argument order consistency', () => {
      const config = {
        enabled: true,
        outputFormat: 'text' as const,
        verbose: true,
        model: 'opus'
      };

      const manager1 = new ClaudeConfigManager(config);
      const manager2 = new ClaudeConfigManager(config);
      
      const args1 = manager1.buildCliArguments();
      const args2 = manager2.buildCliArguments();

      // Arguments should be in consistent order
      expect(args1).toEqual(args2);
      
      // -p should always be first
      expect(args1[0]).toBe('-p');
    });
  });

  describe('Validation Edge Cases', () => {
    it('should handle null and undefined values gracefully', () => {
      const config = {
        enabled: true,
        outputFormat: null as any,
        allowedTools: undefined,
        maxTurns: null as any,
        customArgs: null as any
      };

      const manager = new ClaudeConfigManager(config);
      const args = manager.buildCliArguments();

      // Should generate basic arguments. Since outputFormat is explicitly null, 
      // only verbose flag should be added (not output-format)
      expect(args).toContain('-p');
      expect(args).toContain('--verbose');
      expect(args.length).toBe(2); // -p, --verbose (outputFormat null overrides default)
    });

    it('should handle all validation warnings together', () => {
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => warnings.push(msg);

      try {
        const config = {
          enabled: true,
          outputFormat: 'invalid' as any,
          inputFormat: 'bad' as any,
          verbose: true, // Will conflict with outputFormat once corrected
          maxTurns: -5,
          allowedTools: ['', null as any, undefined as any, 'ValidTool'],
          dangerouslySkipPermissions: true, // Will conflict with allowedTools
          resumeSession: 'session1',
          continueSession: true // Will conflict with resumeSession
        };

        new ClaudeConfigManager(config);

        // Should generate multiple warnings
        expect(warnings.length).toBeGreaterThan(3);
        expect(warnings.some(w => w.includes('Invalid outputFormat'))).toBe(true);
        expect(warnings.some(w => w.includes('Invalid inputFormat'))).toBe(true);
        expect(warnings.some(w => w.includes('maxTurns must be a positive number'))).toBe(true);
        expect(warnings.some(w => w.includes('allowedTools must be non-empty strings'))).toBe(true);
        expect(warnings.some(w => w.includes('dangerouslySkipPermissions is set with allowedTools'))).toBe(true);
        expect(warnings.some(w => w.includes('Both continueSession and resumeSession'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });
});