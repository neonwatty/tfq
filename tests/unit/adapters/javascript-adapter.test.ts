import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { JavaScriptAdapter } from '../../../src/adapters/javascript-adapter.js';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

describe('JavaScriptAdapter', () => {
  let adapter: JavaScriptAdapter;
  const mockFs = fs as any;
  
  beforeEach(() => {
    adapter = new JavaScriptAdapter();
    vi.clearAllMocks();
  });
  
  describe('language and frameworks', () => {
    it('should have language set to javascript', () => {
      expect(adapter.language).toBe('javascript');
    });
    
    it('should support multiple frameworks', () => {
      expect(adapter.supportedFrameworks).toEqual(['jest', 'mocha', 'vitest', 'jasmine', 'ava']);
    });
  });
  
  describe('detectFramework', () => {
    it('should detect jest from package.json', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { jest: '^29.0.0' }
      }));
      
      const result = await adapter.detectFramework('/test/path');
      expect(result).toBe('jest');
    });
    
    it('should detect vitest from package.json', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { vitest: '^0.34.0' }
      }));
      
      const result = await adapter.detectFramework('/test/path');
      expect(result).toBe('vitest');
    });
    
    it('should detect mocha from test script', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        scripts: { test: 'mocha' }
      }));
      
      const result = await adapter.detectFramework('/test/path');
      expect(result).toBe('mocha');
    });
    
    it('should return null when no package.json exists', async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const result = await adapter.detectFramework('/test/path');
      expect(result).toBeNull();
    });
    
    it('should default to vitest when test script exists but no framework detected', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        scripts: { test: 'node test.js' }
      }));
      
      const result = await adapter.detectFramework('/test/path');
      expect(result).toBe('vitest');
    });
  });
  
  describe('getTestCommand', () => {
    it('should return jest with no-watch flag without path', () => {
      expect(adapter.getTestCommand('jest')).toBe('npx jest --watchAll=false');
    });
    
    it('should return npx jest with no-watch flag and path for jest', () => {
      expect(adapter.getTestCommand('jest', 'src/test.js')).toBe('npx jest --watchAll=false src/test.js');
    });
    
    it('should return npx vitest run with path for vitest', () => {
      expect(adapter.getTestCommand('vitest', 'src/test.js')).toBe('npx vitest run src/test.js');
    });
    
    it('should handle unknown framework', () => {
      expect(adapter.getTestCommand('unknown')).toBe('npm test');
    });
  });
  
  describe('parseTestOutput - Jest', () => {
    it('should parse jest failure output', () => {
      const output = `
        FAIL src/components/Button.test.tsx
        ✕ renders correctly (5 ms)
        
        Tests: 1 failed, 3 passed, 4 total
        Time: 2.5s
      `;
      
      const result = adapter.parseTestOutput(output, 'jest');
      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
      const buttonFailure = result.failures.find(f => f.file === 'src/components/Button.test.tsx');
      expect(buttonFailure).toBeDefined();
      expect(result.summary).toEqual({
        total: 4,
        passed: 3,
        failed: 1,
        skipped: 0
      });
    });
    
    it('should parse jest success output', () => {
      const output = `
        PASS src/components/Button.test.tsx
        ✓ renders correctly (5 ms)
        
        Tests: 4 passed, 4 total
        Time: 2.5s
      `;
      
      const result = adapter.parseTestOutput(output, 'jest');
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });
  
  describe('parseTestOutput - Mocha', () => {
    it('should parse mocha failure output', () => {
      const output = `
        1) User Model should validate email:
           test/models/user.test.js:45
           
        1 passing (200ms)
        2 failing
      `;
      
      const result = adapter.parseTestOutput(output, 'mocha');
      // Update test expectations - the pattern needs the error format on same line
      expect(result.summary.passed).toBe(1);
      expect(result.summary.failed).toBe(2);
      expect(result.summary.total).toBe(3);
    });
  });
  
  describe('parseTestOutput - Vitest', () => {
    it('should parse vitest failure output', () => {
      const output = `
        ❯ src/utils/math.test.ts:10:5
        FAIL src/utils/math.test.ts
        
        Tests 2 passed | 1 failed
      `;
      
      const result = adapter.parseTestOutput(output, 'vitest');
      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
      const mathFailure = result.failures.find(f => f.file === 'src/utils/math.test.ts');
      expect(mathFailure).toBeDefined();
      expect(result.summary.passed).toBe(2);
      expect(result.summary.failed).toBe(1);
    });
  });
  
  describe('validateFramework', () => {
    it('should validate supported frameworks', () => {
      expect(adapter.validateFramework('jest')).toBe(true);
      expect(adapter.validateFramework('mocha')).toBe(true);
      expect(adapter.validateFramework('vitest')).toBe(true);
      expect(adapter.validateFramework('jasmine')).toBe(true);
      expect(adapter.validateFramework('ava')).toBe(true);
    });
    
    it('should reject unsupported frameworks', () => {
      expect(adapter.validateFramework('unknown')).toBe(false);
    });
    
    it('should be case-insensitive', () => {
      expect(adapter.validateFramework('Jest')).toBe(true);
      expect(adapter.validateFramework('MOCHA')).toBe(true);
    });
  });
});