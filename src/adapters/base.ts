export interface TestPattern {
  pattern: RegExp;
  type: 'failure' | 'error' | 'skipped';
  extractLocation?: (match: RegExpMatchArray) => { file: string; line?: number };
}

export interface ParsedTestOutput {
  passed: boolean;
  failingTests: string[];
  failures: TestFailure[];
  errors: TestError[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

export interface TestFailure {
  name: string;
  file: string;
  line?: number;
  message?: string;
}

export interface TestError {
  name: string;
  file: string;
  line?: number;
  message: string;
  stack?: string;
}

export interface LanguageAdapter {
  readonly language: string;
  readonly supportedFrameworks: string[];
  readonly defaultFramework: string;
  
  detectFramework(projectPath?: string): string | null;
  validateFramework(framework: string): boolean;
  getTestCommand(framework: string, testPath?: string): string;
  getFailurePatterns(framework: string): TestPattern[];
  parseTestOutput(output: string, framework: string): ParsedTestOutput;
  getDefaultTimeout(): number;
  getTestFilePatterns?(framework: string): string[];
}

export abstract class BaseAdapter implements LanguageAdapter {
  abstract readonly language: string;
  abstract readonly supportedFrameworks: string[];
  abstract readonly defaultFramework: string;
  
  abstract detectFramework(projectPath?: string): string | null;
  
  validateFramework(framework: string): boolean {
    return this.supportedFrameworks.includes(framework.toLowerCase());
  }
  
  abstract getTestCommand(framework: string, testPath?: string): string;
  abstract getFailurePatterns(framework: string): TestPattern[];
  abstract parseTestOutput(output: string, framework: string): ParsedTestOutput;
  
  getDefaultTimeout(): number {
    return 30000; // 30 seconds default
  }
  
  protected extractFailures(output: string, patterns: TestPattern[]): TestFailure[] {
    const failures: TestFailure[] = [];
    const seen = new Set<string>();
    
    for (const pattern of patterns) {
      if (pattern.type !== 'failure') continue;
      
      if (pattern.pattern.global) {
        // Handle global patterns
        let match: RegExpExecArray | null;
        const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
        while ((match = regex.exec(output)) !== null) {
          if (pattern.extractLocation) {
            const location = pattern.extractLocation(match);
            if (location.file) {
              const key = `${location.file}:${location.line || 'unknown'}`;
              if (!seen.has(key)) {
                seen.add(key);
                failures.push({
                  name: match[0],
                  file: location.file,
                  line: location.line,
                  message: match[0]
                });
              }
            }
          }
        }
      } else {
        // Handle non-global patterns line by line
        const lines = output.split('\n');
        for (const line of lines) {
          const match = line.match(pattern.pattern);
          if (match && pattern.extractLocation) {
            const location = pattern.extractLocation(match);
            if (location.file) {
              const key = `${location.file}:${location.line || 'unknown'}`;
              if (!seen.has(key)) {
                seen.add(key);
                failures.push({
                  name: match[0],
                  file: location.file,
                  line: location.line,
                  message: line
                });
              }
            }
          }
        }
      }
    }
    
    return failures;
  }
  
  protected extractErrors(output: string, patterns: TestPattern[]): TestError[] {
    const errors: TestError[] = [];
    const seen = new Set<string>();
    
    for (const pattern of patterns) {
      if (pattern.type !== 'error') continue;
      
      if (pattern.pattern.global) {
        // Handle global patterns
        let match: RegExpExecArray | null;
        const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
        while ((match = regex.exec(output)) !== null) {
          if (pattern.extractLocation) {
            const location = pattern.extractLocation(match);
            if (location.file) {
              const key = `${location.file}:${location.line || 'unknown'}`;
              if (!seen.has(key)) {
                seen.add(key);
                errors.push({
                  name: match[0],
                  file: location.file,
                  line: location.line,
                  message: match[0]
                });
              }
            }
          }
        }
      } else {
        // Handle non-global patterns line by line
        const lines = output.split('\n');
        for (const line of lines) {
          const match = line.match(pattern.pattern);
          if (match && pattern.extractLocation) {
            const location = pattern.extractLocation(match);
            if (location.file) {
              const key = `${location.file}:${location.line || 'unknown'}`;
              if (!seen.has(key)) {
                seen.add(key);
                errors.push({
                  name: match[0],
                  file: location.file,
                  line: location.line,
                  message: line
                });
              }
            }
          }
        }
      }
    }
    
    return errors;
  }
  
  protected extractSummary(output: string): ParsedTestOutput['summary'] {
    const summary = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    };
    
    const totalMatch = output.match(/(\d+)\s+(?:tests?|specs?|examples?)/i);
    const passedMatch = output.match(/(\d+)\s+(?:passed?|passing|succeeded?)/i);
    const failedMatch = output.match(/(\d+)\s+(?:failed?|failing|failures?)/i);
    const skippedMatch = output.match(/(\d+)\s+(?:skipped?|pending)/i);
    
    if (totalMatch) summary.total = parseInt(totalMatch[1], 10);
    if (passedMatch) summary.passed = parseInt(passedMatch[1], 10);
    if (failedMatch) summary.failed = parseInt(failedMatch[1], 10);
    if (skippedMatch) summary.skipped = parseInt(skippedMatch[1], 10);
    
    if (summary.total === 0 && (summary.passed > 0 || summary.failed > 0)) {
      summary.total = summary.passed + summary.failed + summary.skipped;
    }
    
    return summary;
  }
}