import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
import { TestLanguage } from './types.js';
import { adapterRegistry } from '../adapters/registry.js';

export interface TestScanResult {
  language: TestLanguage;
  framework: string;
  testFiles: string[];
  count: number;
  patterns: string[];
  searchPath: string;
}

export class TestScanner {
  private maxDepth = 5;
  private maxFiles = 10000;
  private ignoreDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.venv',
    'venv',
    '__pycache__',
    '.pytest_cache',
    '.tox',
    'vendor',
    '.bundle',
    'tmp'
  ]);

  async scanForTests(
    projectPath: string = process.cwd(),
    language?: TestLanguage
  ): Promise<TestScanResult> {
    const detectedLanguage = language || adapterRegistry.detectLanguage(projectPath);
    if (!detectedLanguage) {
      throw new Error('Could not detect project language');
    }

    const adapter = adapterRegistry.get(detectedLanguage);
    const framework = adapter.detectFramework(projectPath) || adapter.defaultFramework;
    const patterns = adapter.getTestFilePatterns ? 
      adapter.getTestFilePatterns(framework) : 
      this.getDefaultPatterns(detectedLanguage);

    const testFiles = this.findTestFiles(projectPath, patterns);

    return {
      language: detectedLanguage,
      framework,
      testFiles,
      count: testFiles.length,
      patterns,
      searchPath: projectPath
    };
  }

  private findTestFiles(basePath: string, patterns: string[]): string[] {
    const files: string[] = [];
    const visited = new Set<string>();
    
    this.walkDirectory(basePath, basePath, patterns, files, visited, 0);
    
    return files.sort();
  }

  private walkDirectory(
    basePath: string,
    currentPath: string,
    patterns: string[],
    files: string[],
    visited: Set<string>,
    depth: number
  ): void {
    if (depth > this.maxDepth || files.length > this.maxFiles) {
      return;
    }

    try {
      const realPath = fs.realpathSync(currentPath);
      if (visited.has(realPath)) {
        return;
      }
      visited.add(realPath);

      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.') {
          continue;
        }

        if (this.ignoreDirs.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);

        if (entry.isDirectory()) {
          this.walkDirectory(basePath, fullPath, patterns, files, visited, depth + 1);
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            if (minimatch(relativePath, pattern, { dot: false })) {
              files.push(relativePath);
              break;
            }
          }
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
    }
  }

  private getDefaultPatterns(language: TestLanguage): string[] {
    switch (language) {
      case 'javascript':
        return [
          '**/*.test.js',
          '**/*.test.jsx',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.spec.js',
          '**/*.spec.jsx',
          '**/*.spec.ts',
          '**/*.spec.tsx',
          '**/test/**/*.js',
          '**/test/**/*.jsx',
          '**/test/**/*.ts',
          '**/test/**/*.tsx',
          '**/tests/**/*.js',
          '**/tests/**/*.jsx',
          '**/tests/**/*.ts',
          '**/tests/**/*.tsx',
          '**/__tests__/**/*.js',
          '**/__tests__/**/*.jsx',
          '**/__tests__/**/*.ts',
          '**/__tests__/**/*.tsx'
        ];
      case 'python':
        return [
          '**/test_*.py',
          '**/*_test.py',
          '**/test/*.py',
          '**/tests/*.py',
          '**/tests/**/*.py'
        ];
      case 'ruby':
        return [
          '**/*_test.rb',
          '**/test/**/*_test.rb',
          '**/test_*.rb',
          '**/*_spec.rb',
          '**/spec/**/*_spec.rb',
          '**/spec_*.rb'
        ];
      default:
        return [];
    }
  }

  async countTestFiles(projectPath: string = process.cwd(), language?: TestLanguage): Promise<number> {
    try {
      const result = await this.scanForTests(projectPath, language);
      return result.count;
    } catch {
      return 0;
    }
  }

  formatScanResult(result: TestScanResult, verbose: boolean = false): string {
    const lines: string[] = [];
    
    lines.push(`Language: ${result.language}`);
    lines.push(`Framework: ${result.framework}`);
    lines.push(`Test files found: ${result.count}`);
    
    if (verbose && result.patterns.length > 0) {
      lines.push('\nSearch patterns:');
      result.patterns.forEach(p => lines.push(`  - ${p}`));
    }
    
    if (verbose && result.testFiles.length > 0) {
      lines.push('\nTest files:');
      const maxShow = 20;
      const filesToShow = result.testFiles.slice(0, maxShow);
      filesToShow.forEach(f => lines.push(`  - ${f}`));
      if (result.testFiles.length > maxShow) {
        lines.push(`  ... and ${result.testFiles.length - maxShow} more`);
      }
    }
    
    return lines.join('\n');
  }
}

export const testScanner = new TestScanner();