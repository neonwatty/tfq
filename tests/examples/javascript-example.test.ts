import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { 
  examplesPath, 
  createTempDbPath, 
  cleanupTempDb, 
  runTfqCommand 
} from './test-helpers';

describe('JavaScript Example (Jest)', () => {
  const projectPath = path.join(examplesPath, 'javascript');
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = createTempDbPath();
  });

  afterEach(() => {
    cleanupTempDb(tempDbPath);
  });

  it('should detect failing test files with explicit parameters', () => {
    const result = runTfqCommand(projectPath, ['--language', 'javascript', '--framework', 'jest'], tempDbPath);
    
    // Debug output
    if (result.totalFailures === 0) {
      console.log('DEBUG: JavaScript test result:', JSON.stringify(result, null, 2));
    }
    
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
    // After reset, both test files fail due to the multiply bug
    expect(result.totalFailures).toBeGreaterThanOrEqual(1);
    expect(result.language).toBe('javascript');
    expect(result.framework).toBe('jest');
    expect(result.failingTests.length).toBeGreaterThanOrEqual(1);
    
    // Check that the calculator.test.js file is failing (advanced.test.js expects the buggy behavior so passes)
    const failingFiles = result.failingTests.map((f: string) => path.basename(f));
    expect(failingFiles).toContain('calculator.test.js');
  });

  it('should auto-detect Jest framework', () => {
    const result = runTfqCommand(projectPath, ['--auto-detect'], tempDbPath);
    
    expect(result.success).toBe(false);
    expect(result.totalFailures).toBeGreaterThanOrEqual(1);
    expect(result.language).toBe('javascript');
    expect(result.framework).toBe('jest');
  });

  it('should use jest with no-watch flag as the command', () => {
    const result = runTfqCommand(projectPath, ['--language', 'javascript', '--framework', 'jest'], tempDbPath);
    
    expect(result.command).toBe('npx jest --watchAll=false');
  });
});