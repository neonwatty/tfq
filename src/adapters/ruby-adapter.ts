import fs from 'fs';
import path from 'path';
import { BaseAdapter, TestPattern, ParsedTestOutput } from './base.js';

export class RubyAdapter extends BaseAdapter {
  readonly language = 'ruby';
  readonly supportedFrameworks = ['minitest', 'rspec'];
  readonly defaultFramework = 'minitest';
  
  detectFramework(projectPath?: string): string | null {
    const basePath = projectPath || process.cwd();
    const gemfilePath = path.join(basePath, 'Gemfile');
    const gemfileLockPath = path.join(basePath, 'Gemfile.lock');
    const specDir = path.join(basePath, 'spec');
    const testDir = path.join(basePath, 'test');
    const featuresDir = path.join(basePath, 'features');
    
    let gemfileContent = '';
    if (fs.existsSync(gemfilePath)) {
      gemfileContent = fs.readFileSync(gemfilePath, 'utf-8');
    } else if (fs.existsSync(gemfileLockPath)) {
      gemfileContent = fs.readFileSync(gemfileLockPath, 'utf-8');
    }
    
    // Check for RSpec
    if (gemfileContent.includes('rspec') || 
        fs.existsSync(specDir) ||
        fs.existsSync(path.join(basePath, '.rspec'))) {
      return 'rspec';
    }
    
    // Check for minitest or Rails (which uses minitest by default)
    if (gemfileContent.includes('minitest') || 
        gemfileContent.includes('rails') ||
        fs.existsSync(testDir) ||
        fs.existsSync(path.join(basePath, 'config/application.rb'))) {
      return 'minitest';
    }
    
    return null;
  }
  
  getTestCommand(framework: string, testPath?: string): string {
    const basePath = testPath || '';
    
    switch (framework.toLowerCase()) {
      case 'rspec':
        if (testPath) {
          return `rspec ${basePath}`;
        }
        return 'rspec';
        
      case 'minitest':
        // Check if this is a Rails project
        const isRails = fs.existsSync(path.join(process.cwd(), 'config/application.rb')) ||
                       fs.existsSync(path.join(process.cwd(), 'bin/rails'));
        
        if (isRails) {
          if (testPath) {
            return `rails test ${basePath}`;
          }
          return 'rails test';
        } else {
          // For non-Rails Minitest projects, use ruby directly
          if (testPath) {
            return `ruby -Ilib:test ${basePath}`;
          }
          return `ruby -Ilib:test -e "Dir.glob('test/**/*_test.rb').each { |file| require File.expand_path(file) }"`;
        }
        
      default:
        return 'rake test';
    }
  }
  
  getFailurePatterns(framework: string): TestPattern[] {
    switch (framework.toLowerCase()) {
      case 'rspec':
        return [
          {
            // RSpec failure format: file.rb:line
            pattern: /^\s+#\s+(.+\.rb):(\d+)/gm,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: parseInt(match[2], 10)
            })
          },
          {
            // Alternative RSpec format in stack traces
            pattern: /^\s+(.+\.rb):(\d+):in\s/gm,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: parseInt(match[2], 10)
            })
          }
        ];
        
      case 'minitest':
        return [
          {
            // Minitest failure format with square brackets: [file.rb:line]:
            pattern: /\[(.+?\.rb):(\d+)\]/g,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: parseInt(match[2], 10)
            })
          },
          {
            // Simple failure format for single line: "Failure: path/file.rb:line"
            // Must be at start of string or after newline, and followed by end or newline
            pattern: /(?:^|[\n\r])Failure:\s+([^\[\s]+\.rb):(\d+)(?:$|[\n\r])/gm,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: parseInt(match[2], 10)
            })
          },
          {
            // Standard Minitest failure format with file path in error message
            pattern: /^\s+(.+?\.rb):(\d+):in\s+[`'](.+?)['']$/gm,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: parseInt(match[2], 10)
            })
          },
          {
            // Alternative format: /path/to/file.rb:line:in 'method'
            pattern: /^\s+\/(.+?\.rb):(\d+):in\s+[`'](.+?)['']$/gm,
            type: 'failure',
            extractLocation: (match) => ({
              file: '/' + match[1],
              line: parseInt(match[2], 10)
            })
          },
          {
            // Rails 8 format: bin/rails test file:line (preferred over the Class#test format)
            pattern: /bin\/rails test (.+?):(\d+)/g,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: parseInt(match[2], 10)
            })
          },
          {
            // Rails 7 and earlier format: rails test file:line
            pattern: /rails test (.+?):(\d+)/gm,
            type: 'failure',
            extractLocation: (match) => ({
              file: match[1],
              line: parseInt(match[2], 10)
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
    const summary = this.extractRubySummary(output, framework);
    
    const passed = failures.length === 0 && errors.length === 0;
    
    // Check if a file is a test file
    const isTestFile = (filePath: string): boolean => {
      const normalized = filePath.toLowerCase();
      // Ruby test files typically:
      // - Are in test/ directory
      // - End with _test.rb
      return (
        normalized.includes('/test/') ||
        normalized.endsWith('_test.rb') ||
        normalized.endsWith('.feature')
      );
    };
    
    // Collect unique file paths (without line numbers for consistency)
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
        const testIndex = parts.findIndex(p => p === 'test' || p === 'spec');
        if (testIndex !== -1) {
          return parts.slice(testIndex).join('/');
        }
      }
      return filePath;
    };
    
    // Add failures - only if they're test files (just file paths, no line numbers)
    failures.forEach(f => {
      if (isTestFile(f.file)) {
        failingFiles.add(normalizePath(f.file));
      }
    });
    
    // Add errors - only if they're test files (just file paths, no line numbers)
    errors.forEach(e => {
      if (isTestFile(e.file)) {
        failingFiles.add(normalizePath(e.file));
      }
    });
    
    // Convert Set to array
    const failingTests = Array.from(failingFiles);
    
    return {
      passed,
      failingTests,
      failures,
      errors,
      summary
    };
  }
  
  private extractRubySummary(output: string, framework: string): ParsedTestOutput['summary'] {
    const summary = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    };
    
    switch (framework.toLowerCase()) {
      case 'minitest':
        // Try standard Minitest format first
        const minitestMatch = output.match(/(\d+)\s+runs?,\s+(\d+)\s+assertions?,\s+(\d+)\s+failures?,\s+(\d+)\s+errors?,\s+(\d+)\s+skips?/);
        if (minitestMatch) {
          summary.total = parseInt(minitestMatch[1], 10);
          summary.failed = parseInt(minitestMatch[3], 10) + parseInt(minitestMatch[4], 10);
          summary.skipped = parseInt(minitestMatch[5], 10);
          summary.passed = summary.total - summary.failed - summary.skipped;
        } else {
          // Try alternate format: "56 tests, 60 assertions, 4 failures, 1 errors, 0 skips"
          const altMatch = output.match(/(\d+)\s+tests?,\s+(\d+)\s+assertions?,\s+(\d+)\s+failures?,\s+(\d+)\s+errors?,\s+(\d+)\s+skips?/);
          if (altMatch) {
            summary.total = parseInt(altMatch[1], 10);
            summary.failed = parseInt(altMatch[3], 10) + parseInt(altMatch[4], 10);
            summary.skipped = parseInt(altMatch[5], 10);
            summary.passed = summary.total - summary.failed - summary.skipped;
          }
        }
        break;
    }
    
    return summary;
  }

  getTestFilePatterns(framework: string): string[] {
    switch (framework.toLowerCase()) {
      case 'minitest':
        return [
          '**/*_test.rb',
          '**/test/**/*_test.rb',
          '**/test_*.rb'
        ];
      case 'rspec':
        return [
          '**/*_spec.rb',
          '**/spec/**/*_spec.rb',
          '**/spec_*.rb'
        ];
      default:
        // Return both Minitest and RSpec patterns for maximum coverage
        return [
          '**/*_test.rb',
          '**/test/**/*_test.rb',
          '**/test_*.rb',
          '**/*_spec.rb',
          '**/spec/**/*_spec.rb'
        ];
    }
  }
}