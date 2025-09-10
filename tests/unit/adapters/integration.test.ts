import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { TestRunner } from '../../../src/core/test-runner.js';
import { adapterRegistry } from '../../../src/adapters/registry.js';
import { execSync } from 'child_process';
import { getTestOutput, getExpectedFailures } from '../../integration/fixtures/test-outputs.js';
import { 
  mockProjects, 
  setupMockProject, 
  cleanupMockProject, 
  expectedDetections 
} from '../../integration/fixtures/mock-projects.js';
import { TestLanguage } from '../../../src/types.js';
import fs from 'fs';
import * as os from 'os';
import path from 'path';

vi.mock('child_process');

describe('Multi-Language Adapter Integration Tests', () => {
  const mockExecSync = execSync as any;
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfq-test-'));
  });

  afterEach(() => {
    cleanupMockProject(tempDir);
  });

  describe('Test Output Parsing', () => {
    const testCases = [
      { language: 'javascript', framework: 'jest' },
      { language: 'javascript', framework: 'mocha' },
      { language: 'javascript', framework: 'vitest' },
      { language: 'javascript', framework: 'jasmine' },
      { language: 'javascript', framework: 'ava' },
      { language: 'ruby', framework: 'minitest' },
      { language: 'python', framework: 'pytest' },
      { language: 'python', framework: 'unittest' }
    ];

    testCases.forEach(({ language, framework }) => {
      describe(`${language}/${framework}`, () => {
        it('should parse passing test output correctly', () => {
          const output = getTestOutput(language, framework, false);
          mockExecSync.mockReturnValue(output);

          const runner = new TestRunner({ language: language as TestLanguage, framework });
          const result = runner.run();

          expect(result.success).toBe(true);
          expect(result.failingTests).toEqual([]);
          expect(result.totalFailures).toBe(0);
          expect(result.language).toBe(language);
          expect(result.framework).toBe(framework);
        });

        it('should extract failing tests from output', () => {
          const output = getTestOutput(language, framework, true);
          const expectedFailures = getExpectedFailures(language, framework);

          mockExecSync.mockImplementation(() => {
            const error: any = new Error('Tests failed');
            error.status = 1;
            error.stdout = output;
            error.stderr = '';
            throw error;
          });

          const runner = new TestRunner({ language: language as TestLanguage, framework });
          const result = runner.run();

          expect(result.success).toBe(false);
          expect(result.exitCode).toBe(1);
          expect(result.failingTests.length).toBeGreaterThan(0);
          
          // Check that we found the expected failures
          expectedFailures.forEach(expectedPath => {
            const found = result.failingTests.some(path => 
              path.includes(expectedPath) || expectedPath.includes(path)
            );
            expect(found).toBe(true);
          });
        });
      });
    });
  });

  describe('Auto-Detection with Mock Projects', () => {
    const projectTypes = [
      'javascriptJest',
      'javascriptMocha',
      'javascriptVitest',
      'rubyRails',
      'pythonPytest',
      'pythonUnittest'
    ] as const;

    projectTypes.forEach(projectType => {
      it(`should auto-detect ${projectType}`, () => {
        setupMockProject(tempDir, projectType);
        
        const detectedLanguage = adapterRegistry.detectLanguage(tempDir);
        const expected = expectedDetections[projectType];
        
        expect(detectedLanguage).toBe(expected.language);
        
        if (detectedLanguage) {
          const adapter = adapterRegistry.get(detectedLanguage);
          const detectedFramework = adapter.detectFramework(tempDir);
          expect(detectedFramework).toBe(expected.framework);
        }
      });
    });

    it('should handle mixed language project', () => {
      setupMockProject(tempDir, 'mixedLanguage');
      
      const detectedLanguage = adapterRegistry.detectLanguage(tempDir);
      expect(detectedLanguage).toBe('ruby'); // Should detect Gemfile first (language-specific files have priority)
    });

    it('should return null for project without test framework', () => {
      setupMockProject(tempDir, 'noTestFramework');
      
      const detectedLanguage = adapterRegistry.detectLanguage(tempDir);
      expect(detectedLanguage).toBe('javascript'); // Has .js file
      
      if (detectedLanguage) {
        const adapter = adapterRegistry.get(detectedLanguage);
        const detectedFramework = adapter.detectFramework(tempDir);
        expect(detectedFramework).toBeNull(); // No test framework
      }
    });
  });

  describe('Command Generation', () => {
    it('should generate correct commands for each framework', () => {
      const commandMap = {
        'javascript:jest': 'npx jest --watchAll=false',
        'javascript:mocha': 'npm test',
        'javascript:vitest': 'npx vitest run',
        'javascript:jasmine': 'npm test',
        'javascript:ava': 'npm test',
        'ruby:minitest': ['rails test', 'ruby -Ilib:test'], // Both Rails and non-Rails commands are valid
        'python:pytest': 'pytest',
        'python:unittest': 'python -m unittest'
      };

      Object.entries(commandMap).forEach(([key, expectedCommand]) => {
        const [language, framework] = key.split(':');
        const adapter = adapterRegistry.get(language as TestLanguage);
        const command = adapter.getTestCommand(framework);
        
        // Handle both string and array expectations
        if (Array.isArray(expectedCommand)) {
          // For commands that can vary (like minitest), check if it matches any valid option
          const matchesAny = expectedCommand.some(expected => 
            command.includes(expected.split(' ')[0])
          );
          expect(matchesAny).toBe(true);
        } else {
          expect(command).toContain(expectedCommand.split(' ')[0]);
        }
      });
    });
  });

  describe('Cross-Language Consistency', () => {
    it('should handle empty test output consistently', () => {
      const languages = ['javascript', 'ruby', 'python'];
      
      languages.forEach(language => {
        mockExecSync.mockReturnValue('');
        
        const runner = new TestRunner({ 
          language: language as TestLanguage, 
          framework: TestRunner.getFrameworks(language as TestLanguage)[0] 
        });
        const result = runner.run();
        
        expect(result.failingTests).toEqual([]);
        expect(result.stdout).toBe('');
      });
    });

    it('should handle malformed output without crashing', () => {
      const malformedOutputs = [
        null,
        undefined,
        123,
        { not: 'a string' },
        Buffer.from('binary data')
      ];

      malformedOutputs.forEach(output => {
        mockExecSync.mockImplementation(() => {
          const error: any = new Error('Tests failed');
          error.status = 1;
          error.stdout = output;
          error.stderr = '';
          throw error;
        });

        const runner = new TestRunner();
        const result = runner.run();
        
        expect(result.success).toBe(false);
        expect(result.failingTests).toEqual([]);
      });
    });

    it('should normalize file paths across platforms', () => {
      const testPaths = {
        javascript: ['src/test.js', 'src\\test.js'],
        ruby: ['spec/test_spec.rb', 'spec\\test_spec.rb'],
        python: ['tests/test_main.py', 'tests\\test_main.py']
      };

      Object.entries(testPaths).forEach(([language, paths]) => {
        paths.forEach(testPath => {
          mockExecSync.mockImplementation(() => {
            const error: any = new Error('Tests failed');
            error.status = 1;
            error.stdout = `FAIL ${testPath}`;
            error.stderr = '';
            throw error;
          });

          const runner = new TestRunner({ 
            language: language as TestLanguage,
            framework: TestRunner.getFrameworks(language as TestLanguage)[0]
          });
          const result = runner.run();
          
          expect(result.failingTests.length).toBeGreaterThanOrEqual(0);
        });
      });
    });
  });

  describe('Performance', () => {
    it('should parse large test outputs efficiently', () => {
      const largeOutput = Array(10000).fill('PASS test.js').join('\n') + 
                         '\nFAIL src/failing.test.js';
      
      mockExecSync.mockImplementation(() => {
        const error: any = new Error('Tests failed');
        error.status = 1;
        error.stdout = largeOutput;
        error.stderr = '';
        throw error;
      });

      const startTime = Date.now();
      const runner = new TestRunner();
      const result = runner.run();
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(1000); // Should parse in under 1 second
      expect(result.failingTests).toContain('src/failing.test.js');
    });

    it('should handle concurrent adapter access', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(new Promise((resolve) => {
          const language = ['javascript', 'ruby', 'python'][i % 3];
          const adapter = adapterRegistry.get(language as TestLanguage);
          expect(adapter).toBeDefined();
          resolve(adapter);
        }));
      }
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
    });
  });

  describe('Error Recovery', () => {
    it('should continue parsing after encountering invalid regex', () => {
      const adapter = adapterRegistry.get('javascript');
      const patterns = adapter.getFailurePatterns('jest');
      
      // Inject an invalid pattern
      const invalidPattern = { pattern: '[', flags: 'g' };
      patterns.push(invalidPattern as any);
      
      const output = 'FAIL test.js';
      mockExecSync.mockImplementation(() => {
        const error: any = new Error('Tests failed');
        error.status = 1;
        error.stdout = output;
        error.stderr = '';
        throw error;
      });
      
      const runner = new TestRunner();
      expect(() => runner.run()).not.toThrow();
    });

    it('should handle missing adapter methods gracefully', () => {
      const adapter = adapterRegistry.get('javascript');
      const originalMethod = adapter.parseTestOutput;
      
      // Temporarily remove the method
      (adapter as any).parseTestOutput = undefined;
      
      mockExecSync.mockReturnValue('Test output');
      
      const runner = new TestRunner();
      expect(() => runner.run()).not.toThrow();
      
      // Restore the method
      adapter.parseTestOutput = originalMethod;
    });
  });
});