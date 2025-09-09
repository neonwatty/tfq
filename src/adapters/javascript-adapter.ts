import fs from 'fs';
import path from 'path';
import { BaseAdapter, TestPattern, ParsedTestOutput } from './base.js';

export class JavaScriptAdapter extends BaseAdapter {
  readonly language = 'javascript';
  readonly supportedFrameworks = ['jest', 'mocha', 'vitest', 'jasmine', 'ava'];
  readonly defaultFramework = 'vitest';
  
  detectFramework(projectPath?: string): string | null {
    const basePath = projectPath || process.cwd();
    const packageJsonPath = path.join(basePath, 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }
    
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = {
        ...packageJson.dependencies || {},
        ...packageJson.devDependencies || {}
      };
      
      const scripts = packageJson.scripts || {};
      const testScript = scripts.test || '';
      
      if (deps.jest || testScript.includes('jest')) {
        return 'jest';
      }
      if (deps.vitest || testScript.includes('vitest')) {
        return 'vitest';
      }
      if (deps.mocha || testScript.includes('mocha')) {
        return 'mocha';
      }
      if (deps.jasmine || testScript.includes('jasmine')) {
        return 'jasmine';
      }
      if (deps.ava || testScript.includes('ava')) {
        return 'ava';
      }
      
      if (testScript) {
        return 'vitest';
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  getTestCommand(framework: string, testPath?: string): string {
    const basePath = testPath || '';
    
    switch (framework.toLowerCase()) {
      case 'jest':
        return testPath ? `npx jest ${basePath}` : 'npm test';
      case 'mocha':
        return testPath ? `npx mocha ${basePath}` : 'npm test';
      case 'vitest':
        return testPath ? `npx vitest run ${basePath}` : 'npm test';
      case 'jasmine':
        return testPath ? `npx jasmine ${basePath}` : 'npm test';
      case 'ava':
        return testPath ? `npx ava ${basePath}` : 'npm test';
      default:
        return 'npm test';
    }
  }
  
  getFailurePatterns(framework: string): TestPattern[] {
    switch (framework.toLowerCase()) {
      case 'jest':
        return [
          {
            pattern: /FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)(?::(\d+))?/,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: match[2] ? parseInt(match[2], 10) : undefined
            })
          },
          {
            pattern: /✕\s+(.+)\s+\((\d+)\s+ms\)/,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: undefined
            })
          }
        ];
        
      case 'mocha':
        return [
          {
            pattern: /^\s+(\S+\.(?:test|spec)\.[jt]sx?):(\d+)/gm,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: match[2] ? parseInt(match[2], 10) : undefined
            })
          },
          {
            pattern: /at Context\.<anonymous>\s+\(([^:]+\.(?:test|spec)\.[jt]sx?):(\d+):\d+\)/g,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: match[2] ? parseInt(match[2], 10) : undefined
            })
          },
          {
            pattern: /at\s+(?:Context\.|Test\.|Suite\.)?<anonymous>\s+\(([^:]+\.(?:test|spec)\.[jt]sx?):(\d+):\d+\)/g,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: match[2] ? parseInt(match[2], 10) : undefined
            })
          },
          {
            pattern: /Error:\s+(.+)\n\s+at\s+.+\((.+\.(?:test|spec)\.[jt]sx?):(\d+):\d+\)/,
            type: 'error',
            extractLocation: (match) => ({
              file: match[2],
              line: parseInt(match[3], 10)
            })
          }
        ];
        
      case 'vitest':
        return [
          {
            pattern: /❯\s+(\S+\.(?:test|spec)\.[jt]sx?)(?::(\d+):(\d+))?/,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: match[2] ? parseInt(match[2], 10) : undefined
            })
          },
          {
            pattern: /FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)/,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: undefined
            })
          }
        ];
        
      case 'jasmine':
        return [
          {
            pattern: /at\s+.+\s+\((.+\.(?:test|spec)\.[jt]sx?):(\d+):\d+\)/,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: parseInt(match[2], 10)
            })
          },
          {
            pattern: /\s+✗\s+(.+)/,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: undefined
            })
          }
        ];
        
      case 'ava':
        return [
          {
            pattern: /(\S+\.(?:test|spec)\.[jt]sx?):\d+/,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: undefined
            })
          },
          {
            pattern: /✖\s+(.+)\s+(.+\.(?:test|spec)\.[jt]sx?)/,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[2],
              line: undefined
            })
          }
        ];
        
      default:
        return [];
    }
  }
  
  parseTestOutput(output: string, framework: string): ParsedTestOutput {
    const patterns = this.getFailurePatterns(framework);
    const failures = this.extractFailures(output, patterns);
    const errors = this.extractErrors(output, patterns);
    const summary = this.extractSummary(output);
    
    const passed = failures.length === 0 && errors.length === 0;
    
    // Check if a file is a test file
    const isTestFile = (filePath: string): boolean => {
      const normalized = filePath.toLowerCase();
      // JavaScript/TypeScript test files typically:
      // - Are in test/, tests/, spec/, specs/, or __tests__/ directories
      // - End with .test.js, .spec.js, .test.ts, .spec.ts, etc.
      // - Or end with .e2e.js, .e2e.ts for end-to-end tests
      return (
        normalized.includes('/test/') ||
        normalized.includes('/tests/') ||
        normalized.includes('/spec/') ||
        normalized.includes('/specs/') ||
        normalized.includes('/__tests__/') ||
        normalized.includes('.test.') ||
        normalized.includes('.spec.') ||
        normalized.includes('.e2e.')
      );
    };
    
    // Collect unique file paths (without line numbers)
    const failingFiles = new Set<string>();
    
    // Helper to normalize paths - convert absolute to relative
    const normalizePath = (filePath: string): string => {
      // If path is absolute and contains the current working directory, make it relative
      const cwd = process.cwd();
      if (filePath.startsWith(cwd)) {
        return filePath.slice(cwd.length + 1); // +1 to remove the leading slash
      }
      // If path starts with /, it might be absolute from another context
      if (filePath.startsWith('/')) {
        const parts = filePath.split('/');
        const testIndex = parts.findIndex(p => 
          p === 'test' || p === 'tests' || p === 'spec' || p === '__tests__'
        );
        if (testIndex !== -1) {
          return parts.slice(testIndex).join('/');
        }
      }
      return filePath;
    };
    
    // Add failures - only if they're test files
    failures.forEach(f => {
      if (isTestFile(f.file)) {
        failingFiles.add(normalizePath(f.file));
      }
    });
    
    // Add errors - only if they're test files
    errors.forEach(e => {
      if (isTestFile(e.file)) {
        failingFiles.add(normalizePath(e.file));
      }
    });
    
    const failingTests = Array.from(failingFiles);
    
    return {
      passed,
      failingTests,
      failures,
      errors,
      summary
    };
  }
  
  protected extractSummary(output: string): ParsedTestOutput['summary'] {
    const summary = super.extractSummary(output);
    
    const jestMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
    if (jestMatch) {
      summary.failed = parseInt(jestMatch[1], 10);
      summary.passed = parseInt(jestMatch[2], 10);
      summary.total = parseInt(jestMatch[3], 10);
    }
    
    const mochaMatch = output.match(/(\d+)\s+passing.*\n.*(\d+)\s+failing/);
    if (mochaMatch) {
      summary.passed = parseInt(mochaMatch[1], 10);
      summary.failed = parseInt(mochaMatch[2], 10);
      summary.total = summary.passed + summary.failed;
    }
    
    const vitestMatch = output.match(/Tests\s+(\d+)\s+passed\s+\|\s+(\d+)\s+failed/);
    if (vitestMatch) {
      summary.passed = parseInt(vitestMatch[1], 10);
      summary.failed = parseInt(vitestMatch[2], 10);
      summary.total = summary.passed + summary.failed;
    }
    
    return summary;
  }

  getTestFilePatterns(framework: string): string[] {
    const basePatterns = [
      '**/*.test.js',
      '**/*.test.jsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.js',
      '**/*.spec.jsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test.mjs',
      '**/*.spec.mjs',
      '**/*.test.cjs',
      '**/*.spec.cjs'
    ];

    // Note: We don't include broad patterns like **/tests/**/*.js because they
    // would match non-test files like helpers. Test files should follow naming
    // conventions with .test. or .spec. in the name.
    const directoryPatterns: string[] = [];

    switch (framework.toLowerCase()) {
      case 'jest':
        return [...basePatterns, ...directoryPatterns];
      case 'vitest':
        return [
          ...basePatterns,
          ...directoryPatterns,
          '**/*.test.e2e.js',
          '**/*.test.e2e.ts'
        ];
      case 'mocha':
        return [
          ...basePatterns,
          ...directoryPatterns,
          '**/spec/**/*.js',
          '**/spec/**/*.ts'
        ];
      case 'jasmine':
        return [
          '**/*.spec.js',
          '**/*.spec.ts',
          '**/spec/**/*.js',
          '**/spec/**/*.ts'
        ];
      case 'ava':
        return [
          ...basePatterns,
          ...directoryPatterns
        ];
      default:
        return [...basePatterns, ...directoryPatterns];
    }
  }
}