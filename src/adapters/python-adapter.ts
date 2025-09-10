import fs from 'fs';
import path from 'path';
import { BaseAdapter, TestPattern, ParsedTestOutput } from './base.js';

export class PythonAdapter extends BaseAdapter {
  readonly language = 'python';
  readonly supportedFrameworks = ['pytest', 'unittest'];
  readonly defaultFramework = 'pytest';
  
  detectFramework(projectPath?: string): string | null {
    const basePath = projectPath || process.cwd();
    const requirementsPath = path.join(basePath, 'requirements.txt');
    const requirementsDevPath = path.join(basePath, 'requirements-dev.txt');
    const setupPyPath = path.join(basePath, 'setup.py');
    const pyprojectPath = path.join(basePath, 'pyproject.toml');
    const managePyPath = path.join(basePath, 'manage.py');
    const pipfilePath = path.join(basePath, 'Pipfile');
    
    let dependencies = '';
    
    if (fs.existsSync(requirementsPath)) {
      dependencies += fs.readFileSync(requirementsPath, 'utf-8');
    }
    if (fs.existsSync(requirementsDevPath)) {
      dependencies += '\n' + fs.readFileSync(requirementsDevPath, 'utf-8');
    }
    if (fs.existsSync(pipfilePath)) {
      dependencies += '\n' + fs.readFileSync(pipfilePath, 'utf-8');
    }
    if (fs.existsSync(pyprojectPath)) {
      dependencies += '\n' + fs.readFileSync(pyprojectPath, 'utf-8');
    }
    if (fs.existsSync(setupPyPath)) {
      dependencies += '\n' + fs.readFileSync(setupPyPath, 'utf-8');
    }
    
    // Check for pytest in dependencies
    if (dependencies.includes('pytest')) {
      return 'pytest';
    }
    
    const testsDir = path.join(basePath, 'tests');
    const testDir = path.join(basePath, 'test');
    if (fs.existsSync(testsDir) || fs.existsSync(testDir)) {
      const testFiles = fs.readdirSync(fs.existsSync(testsDir) ? testsDir : testDir);
      if (testFiles.some(file => file.startsWith('test_') || file.endsWith('_test.py'))) {
        // Check if unittest is explicitly used
        const hasUnittestFiles = testFiles.some(file => {
          if (file.endsWith('.py')) {
            const filePath = path.join(fs.existsSync(testsDir) ? testsDir : testDir, file);
            try {
              const stats = fs.statSync(filePath);
              if (stats.isFile()) {
                const content = fs.readFileSync(filePath, 'utf-8');
                return content.includes('import unittest') || content.includes('from unittest');
              }
            } catch (error) {
              // File doesn't exist or not accessible
              return false;
            }
          }
          return false;
        });
        if (hasUnittestFiles && !dependencies.includes('pytest')) {
          return 'unittest';
        }
        return 'pytest';
      }
    }
    
    // Default to unittest if no specific framework is detected
    return 'unittest';
  }
  
  private findVenvPython(): string | null {
    // Check for venv in current directory
    const venvPaths = [
      '.venv/bin/python',
      'venv/bin/python',
      '.venv/Scripts/python.exe',
      'venv/Scripts/python.exe'
    ];
    
    for (const venvPath of venvPaths) {
      if (fs.existsSync(venvPath)) {
        return venvPath;
      }
    }
    return null;
  }
  
  getTestCommand(framework: string, testPath?: string): string {
    const basePath = testPath || '';
    
    // Check for Python executable in venv
    const venvPython = this.findVenvPython();
    const pythonCmd = venvPython || 'python';
    
    switch (framework.toLowerCase()) {
      case 'pytest':
        if (testPath) {
          return venvPython ? `${pythonCmd} -m pytest ${basePath}` : `pytest ${basePath}`;
        }
        return venvPython ? `${pythonCmd} -m pytest` : 'pytest';
        
      case 'unittest':
        if (testPath) {
          return `${pythonCmd} -m unittest ${basePath}`;
        }
        return `${pythonCmd} -m unittest discover`;
        
      default:
        return `${pythonCmd} -m pytest`;
    }
  }
  
  getFailurePatterns(framework: string): TestPattern[] {
    switch (framework.toLowerCase()) {
      case 'pytest':
        return [
          {
            pattern: /FAILED\s+([^\s]+::[^\s]+)(?:\[.+?\])?/g,
            type: 'failure',
            extractLocation: (match) => {
              // Store full pytest identifier for later use
              return {
                file: match[1], // Keep full format for now
                line: undefined
              };
            }
          },
          {
            pattern: /ERROR\s+([^\s]+::[^\s]+)(?:\[.+?\])?/g,
            type: 'error',
            extractLocation: (match) => {
              // Store full pytest identifier for later use
              return {
                file: match[1], // Keep full format for now
                line: undefined
              };
            }
          }
        ];
        
      case 'unittest':
        return [
          {
            // Match FAIL: followed by test name, then extract file from traceback
            // This captures both the test name and finds the file in the traceback
            pattern: /FAIL:\s+([^\n]+)[\s\S]*?File\s+"([^"]+)"/g,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[2],  // Use the file path from traceback
              line: undefined,
              testName: match[1].trim()  // Keep test name for reference
            })
          },
          {
            // Match ERROR: followed by test name, then extract file from traceback
            pattern: /ERROR:\s+([^\n]+)[\s\S]*?File\s+"([^"]+)"/g,
            type: 'error',
            extractLocation: (match) => ({
              file: match[2],  // Use the file path from traceback
              line: undefined,
              testName: match[1].trim()  // Keep test name for reference
            })
          }
        ];
        
      default:
        return [];
    }
  }
  
  parseTestOutput(output: string, framework: string): ParsedTestOutput {
    const patterns = this.getFailurePatterns(framework);
    const rawFailures = this.extractFailures(output, patterns);
    const rawErrors = this.extractErrors(output, patterns);
    const summary = this.extractPythonSummary(output, framework);
    
    const passed = rawFailures.length === 0 && rawErrors.length === 0;
    
    // For pytest, extract just the file path from the file::test format for failures/errors
    let failures: ParsedTestOutput['failures'];
    let errors: ParsedTestOutput['errors'];
    
    if (framework === 'pytest') {
      // For pytest, extract just the file path from the file::test format
      failures = rawFailures.map(f => ({
        ...f,
        file: f.file.includes('::') ? f.file.split('::')[0] : f.file
      }));
      errors = rawErrors.map(e => ({
        ...e,
        file: e.file.includes('::') ? e.file.split('::')[0] : e.file
      }));
    } else {
      failures = rawFailures;
      errors = rawErrors;
    }
    
    // Check if a file is a test file
    const isTestFile = (filePath: string): boolean => {
      const normalized = filePath.toLowerCase();
      // Python test files typically:
      // - Are in test/, tests/, or test_* directories
      // - Start with test_ or end with _test.py
      // - Or are in features/ directory for BDD tests
      return (
        normalized.includes('/test/') ||
        normalized.includes('/tests/') ||
        normalized.includes('/test_') ||
        normalized.includes('/features/') ||
        normalized.includes('test_') ||
        normalized.endsWith('_test.py') ||
        normalized.endsWith('_tests.py')
      );
    };
    
    // Collect unique file paths
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
        const testIndex = parts.findIndex(p => p === 'test' || p === 'tests' || p.startsWith('test_'));
        if (testIndex !== -1) {
          return parts.slice(testIndex).join('/');
        }
      }
      return filePath;
    };
    
    // Add failures - only if they're test files
    // For pytest, extract just the file path (not the full test identifier)
    // For other frameworks, extract just the file path (not line numbers)
    if (framework === 'pytest') {
      // Extract just the file path from pytest's file::test format
      rawFailures.forEach(f => {
        const filePath = f.file.split('::')[0];
        if (isTestFile(filePath)) {
          failingFiles.add(normalizePath(filePath));
        }
      });
      rawErrors.forEach(e => {
        const filePath = e.file.split('::')[0];
        if (isTestFile(filePath)) {
          failingFiles.add(normalizePath(filePath));
        }
      });
    } else {
      // For other frameworks, use the processed failures/errors
      failures.forEach(f => {
        const filePath = f.file.split(':')[0]; // Get base file path without line numbers
        if (isTestFile(filePath)) {
          failingFiles.add(normalizePath(filePath));
        }
      });
      errors.forEach(e => {
        const filePath = e.file.split(':')[0]; // Get base file path without line numbers
        if (isTestFile(filePath)) {
          failingFiles.add(normalizePath(filePath));
        }
      });
    }
    
    const failingTests = Array.from(failingFiles);
    
    return {
      passed,
      failingTests,
      failures,
      errors,
      summary
    };
  }
  
  private extractPythonSummary(output: string, framework: string): ParsedTestOutput['summary'] {
    const summary = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    };
    
    switch (framework.toLowerCase()) {
      case 'pytest':
        const pytestMatch = output.match(/(\d+)\s+passed(?:,\s+(\d+)\s+skipped)?(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+error)?/);
        if (pytestMatch) {
          summary.passed = parseInt(pytestMatch[1], 10);
          summary.skipped = pytestMatch[2] ? parseInt(pytestMatch[2], 10) : 0;
          summary.failed = pytestMatch[3] ? parseInt(pytestMatch[3], 10) : 0;
          if (pytestMatch[4]) {
            summary.failed += parseInt(pytestMatch[4], 10);
          }
          summary.total = summary.passed + summary.failed + summary.skipped;
        }
        
        const pytestShortMatch = output.match(/=+\s+(\d+)\s+failed,\s+(\d+)\s+passed/);
        if (pytestShortMatch) {
          summary.failed = parseInt(pytestShortMatch[1], 10);
          summary.passed = parseInt(pytestShortMatch[2], 10);
          summary.total = summary.passed + summary.failed;
        }
        break;
        
      case 'unittest':
        const unittestMatch = output.match(/Ran\s+(\d+)\s+tests?/);
        if (unittestMatch) {
          summary.total = parseInt(unittestMatch[1], 10);
        }
        
        const failMatch = output.match(/FAILED\s+\((?:failures=(\d+))?(?:,?\s*)?(?:errors=(\d+))?(?:,?\s*)?(?:skipped=(\d+))?\)/);
        if (failMatch) {
          summary.failed = (failMatch[1] ? parseInt(failMatch[1], 10) : 0) + 
                          (failMatch[2] ? parseInt(failMatch[2], 10) : 0);
          summary.skipped = failMatch[3] ? parseInt(failMatch[3], 10) : 0;
          summary.passed = summary.total - summary.failed - summary.skipped;
        } else if (output.includes('OK')) {
          summary.passed = summary.total;
        }
        break;
    }
    
    return summary;
  }

  getTestFilePatterns(framework: string): string[] {
    switch (framework.toLowerCase()) {
      case 'pytest':
        return [
          '**/test_*.py',
          '**/*_test.py',
          '**/tests/test_*.py',
          '**/tests/*_test.py',
          '**/tests/**/test_*.py',
          '**/tests/**/*_test.py'
        ];
      case 'unittest':
        return [
          '**/test_*.py',
          '**/*_test.py',
          '**/tests/test_*.py',
          '**/tests/*_test.py',
          '**/tests/**/test_*.py',
          '**/tests/**/*_test.py'
        ];
      default:
        return [
          '**/test_*.py',
          '**/*_test.py',
          '**/tests/test_*.py',
          '**/tests/*_test.py',
          '**/tests/**/test_*.py',
          '**/tests/**/*_test.py'
        ];
    }
  }
}