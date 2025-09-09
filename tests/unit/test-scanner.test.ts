import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TestScanner } from '../../src/core/test-scanner.js';
import { adapterRegistry } from '../../src/adapters/registry.js';

describe('TestScanner', () => {
  let testScanner: TestScanner;
  let tempDir: string;

  beforeEach(() => {
    testScanner = new TestScanner();
    // Create a temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfq-test-scanner-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('scanForTests', () => {
    it('should find JavaScript test files', async () => {
      // Create a mock JavaScript project structure
      const testDir = path.join(tempDir, 'tests');
      fs.mkdirSync(testDir, { recursive: true });
      
      // Create test files
      fs.writeFileSync(path.join(testDir, 'example.test.js'), '// test file');
      fs.writeFileSync(path.join(testDir, 'another.spec.ts'), '// spec file');
      fs.writeFileSync(path.join(tempDir, 'feature.test.tsx'), '// tsx test');
      
      // Create non-test files that should NOT be picked up
      fs.writeFileSync(path.join(tempDir, 'index.js'), '// not a test');
      fs.writeFileSync(path.join(testDir, 'helper.js'), '// not a test');
      fs.writeFileSync(path.join(testDir, 'utils.ts'), '// not a test');
      
      // Create package.json to indicate JavaScript project
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project', devDependencies: { vitest: '^1.0.0' } })
      );

      const result = await testScanner.scanForTests(tempDir);
      
      expect(result.language).toBe('javascript');
      // Log what files were found to debug
      if (result.count !== 3) {
        console.log('Found files:', result.testFiles);
      }
      expect(result.count).toBe(3);
      expect(result.testFiles).toContain('tests/example.test.js');
      expect(result.testFiles).toContain('tests/another.spec.ts');
      expect(result.testFiles).toContain('feature.test.tsx');
      expect(result.testFiles).not.toContain('index.js');
      expect(result.testFiles).not.toContain('tests/helper.js');
      expect(result.testFiles).not.toContain('tests/utils.ts');
    });

    it('should find Python test files', async () => {
      const testDir = path.join(tempDir, 'tests');
      fs.mkdirSync(testDir, { recursive: true });
      
      // Create test files
      fs.writeFileSync(path.join(tempDir, 'test_example.py'), '# test file');
      fs.writeFileSync(path.join(testDir, 'feature_test.py'), '# test file');
      fs.writeFileSync(path.join(testDir, 'test_integration.py'), '# test file');
      
      // Create non-test files
      fs.writeFileSync(path.join(tempDir, 'main.py'), '# not a test');
      fs.writeFileSync(path.join(testDir, '__init__.py'), '# not a test');
      fs.writeFileSync(path.join(testDir, 'helper.py'), '# not a test');
      
      // Create requirements.txt to indicate Python project
      fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'pytest==7.0.0');

      const result = await testScanner.scanForTests(tempDir, 'python');
      
      expect(result.language).toBe('python');
      expect(result.count).toBe(3);
      expect(result.testFiles).toContain('test_example.py');
      expect(result.testFiles).toContain('tests/feature_test.py');
      expect(result.testFiles).toContain('tests/test_integration.py');
      expect(result.testFiles).not.toContain('main.py');
      expect(result.testFiles).not.toContain('tests/__init__.py');
      expect(result.testFiles).not.toContain('tests/helper.py');
    });

    it('should find Ruby Minitest files', async () => {
      const testDir = path.join(tempDir, 'test');
      fs.mkdirSync(testDir, { recursive: true });
      
      // Create test files
      fs.writeFileSync(path.join(testDir, 'example_test.rb'), '# test file');
      fs.writeFileSync(path.join(testDir, 'feature_test.rb'), '# test file');
      fs.writeFileSync(path.join(tempDir, 'integration_test.rb'), '# test file');
      
      // Create non-test files
      fs.writeFileSync(path.join(tempDir, 'app.rb'), '# not a test');
      fs.writeFileSync(path.join(testDir, 'helper.rb'), '# helper');
      
      // Create Gemfile to indicate Ruby project
      fs.writeFileSync(path.join(tempDir, 'Gemfile'), 'gem "minitest"');

      const result = await testScanner.scanForTests(tempDir, 'ruby');
      
      expect(result.language).toBe('ruby');
      expect(result.count).toBe(3);
      expect(result.testFiles).toContain('test/example_test.rb');
      expect(result.testFiles).toContain('test/feature_test.rb');
      expect(result.testFiles).toContain('integration_test.rb');
      expect(result.testFiles).not.toContain('app.rb');
      expect(result.testFiles).not.toContain('test/helper.rb');
    });

    it('should find Ruby RSpec files', async () => {
      const specDir = path.join(tempDir, 'spec');
      fs.mkdirSync(specDir, { recursive: true });
      
      // Create spec files
      fs.writeFileSync(path.join(specDir, 'example_spec.rb'), '# spec file');
      fs.writeFileSync(path.join(specDir, 'feature_spec.rb'), '# spec file');
      fs.writeFileSync(path.join(tempDir, 'integration_spec.rb'), '# spec file');
      fs.writeFileSync(path.join(tempDir, 'spec_helper.rb'), '# spec file'); // Should match spec_*.rb
      
      // Create non-spec files
      fs.writeFileSync(path.join(tempDir, 'app.rb'), '# not a spec');
      fs.writeFileSync(path.join(specDir, 'helper.rb'), '# helper');
      
      // Create Gemfile to indicate Ruby project with RSpec
      fs.writeFileSync(path.join(tempDir, 'Gemfile'), 'gem "rspec"');

      const result = await testScanner.scanForTests(tempDir, 'ruby');
      
      expect(result.language).toBe('ruby');
      expect(result.count).toBe(4);
      expect(result.testFiles).toContain('spec/example_spec.rb');
      expect(result.testFiles).toContain('spec/feature_spec.rb');
      expect(result.testFiles).toContain('integration_spec.rb');
      expect(result.testFiles).toContain('spec_helper.rb');
      expect(result.testFiles).not.toContain('app.rb');
      expect(result.testFiles).not.toContain('spec/helper.rb');
    });

    it('should return empty array when no test files found', async () => {
      // Create a project with no test files
      fs.writeFileSync(path.join(tempDir, 'index.js'), '// main file');
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      
      const result = await testScanner.scanForTests(tempDir);
      
      expect(result.count).toBe(0);
      expect(result.testFiles).toEqual([]);
    });

    it('should ignore node_modules and other excluded directories', async () => {
      const nodeModules = path.join(tempDir, 'node_modules', 'some-package', 'test');
      fs.mkdirSync(nodeModules, { recursive: true });
      fs.writeFileSync(path.join(nodeModules, 'example.test.js'), '// test in node_modules');
      
      const coverage = path.join(tempDir, 'coverage');
      fs.mkdirSync(coverage, { recursive: true });
      fs.writeFileSync(path.join(coverage, 'example.test.js'), '// test in coverage');
      
      // Create a real test file
      fs.writeFileSync(path.join(tempDir, 'real.test.js'), '// real test');
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      
      const result = await testScanner.scanForTests(tempDir);
      
      expect(result.count).toBe(1);
      expect(result.testFiles).toContain('real.test.js');
      expect(result.testFiles).not.toContain(expect.stringContaining('node_modules'));
      expect(result.testFiles).not.toContain(expect.stringContaining('coverage'));
    });

    it('should handle permission errors gracefully', async () => {
      // Create an accessible test file first
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'accessible.test.js'), '// test');
      
      // Create a restricted directory
      const restrictedDir = path.join(tempDir, 'restricted');
      fs.mkdirSync(restrictedDir);
      fs.writeFileSync(path.join(restrictedDir, 'test.spec.js'), '// test');
      
      // Mock fs.readdirSync to throw an error for restricted directory
      const originalReaddir = fs.readdirSync;
      vi.spyOn(fs, 'readdirSync').mockImplementation((dirPath, options) => {
        if (dirPath.toString().includes('restricted')) {
          throw new Error('Permission denied');
        }
        return originalReaddir(dirPath, options);
      });
      
      const result = await testScanner.scanForTests(tempDir);
      
      // Should still find the accessible test
      expect(result.count).toBe(1);
      expect(result.testFiles).toContain('accessible.test.js');
      
      vi.restoreAllMocks();
    });
  });

  describe('countTestFiles', () => {
    it('should return the count of test files', async () => {
      const testDir = path.join(tempDir, 'tests');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'one.test.js'), '');
      fs.writeFileSync(path.join(testDir, 'two.test.js'), '');
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      
      const count = await testScanner.countTestFiles(tempDir);
      expect(count).toBe(2);
    });

    it('should return 0 when scanForTests fails', async () => {
      // Invalid path that doesn't exist
      const count = await testScanner.countTestFiles('/invalid/path/that/does/not/exist');
      expect(count).toBe(0);
    });
  });

  describe('formatScanResult', () => {
    it('should format scan result in non-verbose mode', () => {
      const result = {
        language: 'javascript' as const,
        framework: 'vitest',
        testFiles: ['test1.js', 'test2.js'],
        count: 2,
        patterns: ['**/*.test.js'],
        searchPath: tempDir
      };
      
      const output = testScanner.formatScanResult(result, false);
      
      expect(output).toContain('Language: javascript');
      expect(output).toContain('Framework: vitest');
      expect(output).toContain('Test files found: 2');
      expect(output).not.toContain('test1.js');
      expect(output).not.toContain('Search patterns:');
    });

    it('should format scan result in verbose mode', () => {
      const result = {
        language: 'python' as const,
        framework: 'pytest',
        testFiles: Array.from({ length: 25 }, (_, i) => `test${i + 1}.py`),
        count: 25,
        patterns: ['**/test_*.py', '**/*_test.py'],
        searchPath: tempDir
      };
      
      const output = testScanner.formatScanResult(result, true);
      
      expect(output).toContain('Language: python');
      expect(output).toContain('Framework: pytest');
      expect(output).toContain('Test files found: 25');
      expect(output).toContain('Search patterns:');
      expect(output).toContain('**/test_*.py');
      expect(output).toContain('Test files:');
      expect(output).toContain('test1.py');
      expect(output).toContain('test20.py');
      expect(output).toContain('... and 5 more');
    });
  });
});