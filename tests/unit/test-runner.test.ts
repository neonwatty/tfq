import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { TestRunner } from '../../src/core/test-runner.js';
import { execSync, spawnSync } from 'child_process';
import { adapterRegistry } from '../../src/adapters/registry.js';

vi.mock('child_process');

describe('TestRunner', () => {
  const mockExecSync = execSync as any;
  const mockSpawnSync = spawnSync as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default values when no options provided', () => {
      const runner = new TestRunner();
      expect(runner['language']).toBe('javascript');
      expect(runner['framework']).toBe('vitest');
      expect(runner['command']).toBe('npx vitest run');
    });

    it('should use provided options', () => {
      const runner = new TestRunner({
        language: 'javascript',
        framework: 'mocha',
        command: 'npm run test:integration'
      });
      expect(runner['language']).toBe('javascript');
      expect(runner['framework']).toBe('mocha');
      expect(runner['command']).toBe('npm run test:integration');
    });

    it('should throw error for unsupported framework', () => {
      expect(() => new TestRunner({
        language: 'javascript',
        framework: 'unsupported'
      })).toThrow('Framework "unsupported" is not supported for language "javascript"');
    });

    it('should auto-detect language and framework', () => {
      vi.spyOn(adapterRegistry, 'detectLanguage').mockReturnValue('javascript');
      const adapter = adapterRegistry.get('javascript');
      vi.spyOn(adapter, 'detectFramework').mockReturnValue('vitest');

      const runner = new TestRunner({ autoDetect: true });
      expect(runner['language']).toBe('javascript');
      expect(runner['framework']).toBe('vitest');
    });

    it('should throw error when auto-detect fails', () => {
      vi.spyOn(adapterRegistry, 'detectLanguage').mockReturnValue(null);
      
      expect(() => new TestRunner({ autoDetect: true }))
        .toThrow('Could not auto-detect project language');
    });
  });

  describe('run', () => {
    it('should handle successful test run', () => {
      mockExecSync.mockReturnValue('All tests passed\n');

      const runner = new TestRunner();
      const result = runner.run();

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.failingTests).toEqual([]);
      expect(result.totalFailures).toBe(0);
      expect(result.language).toBe('javascript');
      expect(result.framework).toBe('vitest');
      expect(result.command).toBe('npx vitest run');
      expect(result.stdout).toBe('All tests passed\n');
      expect(result.stderr).toBe('');
      expect(result.error).toBeNull();
    });

    it('should extract failing tests for Jest', () => {
      const jestOutput = `
        PASS src/tests/passing.test.ts
        FAIL src/tests/auth.test.ts
        FAIL src/tests/api.test.ts
        PASS src/tests/utils.test.ts
      `;

      mockExecSync.mockImplementation(() => {
        const error: any = new Error('Tests failed');
        error.status = 1;
        error.stdout = jestOutput;
        error.stderr = '';
        throw error;
      });

      const runner = new TestRunner({ framework: 'jest' });
      const result = runner.run();

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.failingTests).toEqual([
        'src/tests/auth.test.ts',
        'src/tests/api.test.ts'
      ]);
      expect(result.totalFailures).toBe(2);
    });

    it('should extract failing tests for Mocha', () => {
      const mochaOutput = `
        ✓ passing test
        1) First test failure:
           src/tests/auth.test.js:15
           AssertionError: expected true to be false
        2) Second test failure:
           src/tests/api.test.js:23
           Error: Connection refused
        ✓ another passing test
      `;

      mockExecSync.mockImplementation(() => {
        const error: any = new Error('Tests failed');
        error.status = 1;
        error.stdout = mochaOutput;
        error.stderr = '';
        throw error;
      });

      const runner = new TestRunner({ framework: 'mocha' });
      const result = runner.run();

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.failingTests.length).toBeGreaterThan(0);
      expect(result.totalFailures).toBeGreaterThan(0);
    });

    it('should extract failing tests for Vitest', () => {
      const vitestOutput = `
        ✓ src/tests/passing.test.ts
        ❯ src/tests/auth.test.ts
          × should authenticate user
        ❯ src/tests/api.spec.ts
          × should fetch data
        ✓ src/tests/utils.test.ts
      `;

      mockExecSync.mockImplementation(() => {
        const error: any = new Error('Tests failed');
        error.status = 1;
        error.stdout = vitestOutput;
        error.stderr = '';
        throw error;
      });

      const runner = new TestRunner({ framework: 'vitest' });
      const result = runner.run();

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.failingTests).toEqual([
        'src/tests/auth.test.ts',
        'src/tests/api.spec.ts'
      ]);
      expect(result.totalFailures).toBe(2);
    });

    it('should handle duplicate test paths', () => {
      const jestOutput = `
        FAIL src/tests/auth.test.ts
        FAIL src/tests/auth.test.ts
        FAIL src/tests/api.test.ts
      `;

      mockExecSync.mockImplementation(() => {
        const error: any = new Error('Tests failed');
        error.status = 1;
        error.stdout = jestOutput;
        error.stderr = '';
        throw error;
      });

      const runner = new TestRunner({ framework: 'jest' });
      const result = runner.run();

      expect(result.failingTests).toEqual([
        'src/tests/auth.test.ts',
        'src/tests/api.test.ts'
      ]);
      expect(result.totalFailures).toBe(2);
    });

    it('should handle stderr output', () => {
      mockExecSync.mockImplementation(() => {
        const error: any = new Error('Tests failed');
        error.status = 1;
        error.stdout = 'stdout output';
        error.stderr = 'stderr output';
        throw error;
      });

      const runner = new TestRunner();
      const result = runner.run();

      expect(result.success).toBe(false);
      expect(result.stdout).toBe('stdout output');
      expect(result.stderr).toBe('stderr output');
      expect(result.error).toBe('Tests failed');
    });

    it('should calculate test duration', () => {
      mockExecSync.mockReturnValue('All tests passed\n');

      const runner = new TestRunner();
      const result = runner.run();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });
  });

  describe('verbose mode', () => {
    let originalStdoutWrite: any;
    let originalStderrWrite: any;
    let stdoutOutput: string;
    let stderrOutput: string;

    beforeEach(() => {
      // Mock process.stdout.write and process.stderr.write
      originalStdoutWrite = process.stdout.write;
      originalStderrWrite = process.stderr.write;
      stdoutOutput = '';
      stderrOutput = '';
      
      process.stdout.write = vi.fn((chunk: any) => {
        stdoutOutput += chunk;
        return true;
      });
      
      process.stderr.write = vi.fn((chunk: any) => {
        stderrOutput += chunk;
        return true;
      });
    });

    afterEach(() => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    });

    it('should set verbose flag from options', () => {
      const runner = new TestRunner({ verbose: true });
      expect(runner['verbose']).toBe(true);
    });

    it('should default verbose to false when not provided', () => {
      const runner = new TestRunner();
      expect(runner['verbose']).toBe(false);
    });

    it('should use spawnSync when verbose mode is enabled', () => {
      const testOutput = 'Running tests...\nTest 1 passed\nTest 2 failed';
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: testOutput,
        stderr: 'Error output',
        error: null
      });

      const runner = new TestRunner({ verbose: true });
      const result = runner.run();

      expect(mockSpawnSync).toHaveBeenCalled();
      expect(mockExecSync).not.toHaveBeenCalled();
      expect(result.stdout).toBe(testOutput);
      expect(result.stderr).toBe('Error output');
    });

    it('should use execSync when verbose mode is disabled', () => {
      mockExecSync.mockReturnValue('Test output');

      const runner = new TestRunner({ verbose: false });
      runner.run();

      expect(mockExecSync).toHaveBeenCalled();
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });

    it('should output to console in verbose mode', () => {
      const testOutput = 'Test suite running...\nAll tests passed!';
      const errorOutput = 'Warning: deprecated function';
      
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: testOutput,
        stderr: errorOutput,
        error: null
      });

      const runner = new TestRunner({ verbose: true });
      runner.run();

      expect(process.stdout.write).toHaveBeenCalledWith(testOutput);
      expect(process.stderr.write).toHaveBeenCalledWith(errorOutput);
      expect(stdoutOutput).toBe(testOutput);
      expect(stderrOutput).toBe(errorOutput);
    });

    it('should still parse failing tests in verbose mode', () => {
      const jestOutput = `
        FAIL src/tests/auth.test.ts
        FAIL src/tests/api.test.ts
        Test suite failed
      `;

      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: jestOutput,
        stderr: '',
        error: null
      });

      const runner = new TestRunner({ verbose: true, framework: 'jest' });
      const result = runner.run();

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.failingTests).toEqual([
        'src/tests/auth.test.ts',
        'src/tests/api.test.ts'
      ]);
    });

    it('should handle spawnSync errors in verbose mode', () => {
      const error = new Error('Command not found');
      mockSpawnSync.mockReturnValue({
        status: 127,
        stdout: '',
        stderr: '',
        error: error
      });

      const runner = new TestRunner({ verbose: true });
      const result = runner.run();

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(127);
      expect(result.error).toBe('Command not found');
    });
  });

  describe('static methods', () => {
    describe('getLanguages', () => {
      it('should return all supported languages', () => {
        const languages = TestRunner.getLanguages();
        expect(languages).toContain('javascript');
        expect(languages).toContain('ruby');
        expect(languages).toContain('python');
      });
    });

    describe('getFrameworks', () => {
      it('should return all frameworks when no language specified', () => {
        const frameworks = TestRunner.getFrameworks();
        expect(frameworks).toContain('jest');
        expect(frameworks).toContain('mocha');
        expect(frameworks).toContain('minitest');
        expect(frameworks).toContain('pytest');
      });

      it('should return frameworks for specific language', () => {
        const jsFrameworks = TestRunner.getFrameworks('javascript');
        expect(jsFrameworks).toContain('jest');
        expect(jsFrameworks).toContain('mocha');
        expect(jsFrameworks).toContain('vitest');
        expect(jsFrameworks).not.toContain('minitest');
      });
    });

    describe('isValidLanguage', () => {
      it('should return true for valid languages', () => {
        expect(TestRunner.isValidLanguage('javascript')).toBe(true);
        expect(TestRunner.isValidLanguage('ruby')).toBe(true);
        expect(TestRunner.isValidLanguage('python')).toBe(true);
      });

      it('should return false for invalid languages', () => {
        expect(TestRunner.isValidLanguage('invalid')).toBe(false);
      });
    });

    describe('isValidFramework', () => {
      it('should return true for valid frameworks', () => {
        expect(TestRunner.isValidFramework('jest')).toBe(true);
        expect(TestRunner.isValidFramework('jest', 'javascript')).toBe(true);
        expect(TestRunner.isValidFramework('minitest', 'ruby')).toBe(true);
      });

      it('should return false for invalid frameworks', () => {
        expect(TestRunner.isValidFramework('invalid')).toBe(false);
        expect(TestRunner.isValidFramework('jest', 'ruby')).toBe(false);
      });
    });

    describe('detectLanguage', () => {
      it('should detect language from project', () => {
        vi.spyOn(adapterRegistry, 'detectLanguage').mockReturnValue('javascript');
        const language = TestRunner.detectLanguage('/path/to/project');
        expect(language).toBe('javascript');
      });
    });

    describe('detectFramework', () => {
      it('should detect framework for language', () => {
        const adapter = adapterRegistry.get('javascript');
        vi.spyOn(adapter, 'detectFramework').mockReturnValue('jest');
        const framework = TestRunner.detectFramework('javascript', '/path/to/project');
        expect(framework).toBe('jest');
      });
    });
  });

  describe('testPath parameter', () => {
    it('should use testPath when constructing test command', () => {
      const runner = new TestRunner({
        language: 'javascript',
        framework: 'jest',
        testPath: '/path/to/specific/test.js'
      });
      
      // The command should include the testPath with no-watch flag
      expect(runner['command']).toBe('npx jest --watchAll=false /path/to/specific/test.js');
    });

    it('should use default command when no testPath provided', () => {
      const runner = new TestRunner({
        language: 'javascript',
        framework: 'jest'
      });
      
      // Should use default jest command without watch
      expect(runner['command']).toBe('npx jest --watchAll=false');
    });

    it('should handle testPath for different frameworks', () => {
      const vitestRunner = new TestRunner({
        language: 'javascript',
        framework: 'vitest',
        testPath: '/path/to/test.js'
      });
      
      const mochaRunner = new TestRunner({
        language: 'javascript',
        framework: 'mocha',
        testPath: '/path/to/test.js'
      });

      expect(vitestRunner['command']).toBe('npx vitest run /path/to/test.js');
      expect(mochaRunner['command']).toBe('npx mocha /path/to/test.js');
    });

    it('should run single test file successfully with testPath', () => {
      const testOutput = `
        PASS /path/to/specific/test.js
        ✓ should pass test case (5ms)
        
        Test Suites: 1 passed, 1 total
        Tests:       1 passed, 1 total
      `;
      
      mockExecSync.mockReturnValue(testOutput);

      const runner = new TestRunner({
        language: 'javascript',
        framework: 'jest',
        testPath: '/path/to/specific/test.js'
      });
      
      const result = runner.run();
      
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.failingTests).toEqual([]);
      expect(mockExecSync).toHaveBeenCalledWith(
        'npx jest --watchAll=false /path/to/specific/test.js',
        { encoding: 'utf8', stdio: 'pipe' }
      );
    });

    it('should detect failing single test with testPath', () => {
      const testOutput = `
        FAIL /path/to/specific/math.test.js
        × should fail test case (5ms)
        
        Test Suites: 1 failed, 1 total
        Tests:       1 failed, 1 total
      `;
      
      mockExecSync.mockImplementation(() => {
        const error: any = new Error('Tests failed');
        error.status = 1;
        error.stdout = testOutput;
        error.stderr = '';
        throw error;
      });

      const runner = new TestRunner({
        language: 'javascript',
        framework: 'jest',
        testPath: '/path/to/specific/math.test.js'
      });
      
      const result = runner.run();
      
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.failingTests).toEqual(['/path/to/specific/math.test.js']);
      expect(result.totalFailures).toBe(1);
    });

    it('should work with relative testPath', () => {
      const runner = new TestRunner({
        language: 'javascript',
        framework: 'vitest',
        testPath: 'tests/unit/math.test.js'
      });
      
      expect(runner['command']).toBe('npx vitest run tests/unit/math.test.js');
    });

    it('should preserve custom command when testPath is provided', () => {
      const runner = new TestRunner({
        language: 'javascript',
        framework: 'jest',
        command: 'yarn test',
        testPath: '/path/to/test.js'
      });
      
      // Custom command should override default behavior
      expect(runner['command']).toBe('yarn test');
    });
  });
});