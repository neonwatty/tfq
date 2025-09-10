import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * Enhanced runTfqCommand specifically for E2E tests with retry logic
 * Supports environment variables and better output capture
 */
export async function runTfqCommandWithEnv(
  args: string[], 
  cwd: string,
  options: {
    env?: Record<string, string>;
    timeout?: number;
    captureStreaming?: boolean;
  } = {}
): Promise<{ 
  success: boolean; 
  output: string; 
  error: string;
  exitCode: number;
  duration: number;
}> {
  const startTime = Date.now();
  const timeout = options.timeout || 10000;
  
  return new Promise((resolve) => {
    // Ensure the working directory exists
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true });
    }
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // Try to use built CLI first, fall back to tsx if not built
    let tfqPath = path.resolve(__dirname, '../../dist/cli.js');
    let nodeCommand = 'node';
    
    if (!fs.existsSync(tfqPath)) {
      // Use tsx to run TypeScript directly
      tfqPath = path.resolve(__dirname, '../../src/cli.ts');
      nodeCommand = 'npx';
      args = ['tsx', tfqPath, ...args];
    } else {
      args = [tfqPath, ...args];
    }
    
    // Use absolute config path to avoid cwd resolution issues
    const configPath = path.join(cwd, '.tfqrc');
    if (fs.existsSync(configPath) && !args.includes('--config')) {
      args = [args[0], '--config', configPath, ...args.slice(1)];
    }
    
    // Merge environment variables
    const childEnv = {
      ...process.env,
      NODE_ENV: 'test',
      ...options.env // Custom env vars for the test
    };
    
    const child = spawn(nodeCommand, args, {
      cwd,
      stdio: 'pipe',
      env: childEnv
    });
    
    let output = '';
    let error = '';
    let timeoutId: NodeJS.Timeout;
    
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    
    // Set timeout
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        success: false,
        output,
        error: error + '\n[TIMEOUT] Command timed out',
        exitCode: -1,
        duration: Date.now() - startTime
      });
    }, timeout);
    
    // Capture stdout with optional streaming info
    child.stdout?.on('data', (data) => {
      const text = data.toString();
      if (options.captureStreaming) {
        const elapsed = Date.now() - startTime;
        output += `[${elapsed}ms] ${text}`;
      } else {
        output += text;
      }
    });
    
    // Capture stderr
    child.stderr?.on('data', (data) => {
      error += data.toString();
    });
    
    // Handle process exit
    child.on('exit', (code, signal) => {
      cleanup();
      
      resolve({
        success: code === 0,
        output,
        error,
        exitCode: code ?? -1,
        duration: Date.now() - startTime
      });
    });
    
    // Handle errors
    child.on('error', (err) => {
      cleanup();
      resolve({
        success: false,
        output,
        error: error + '\n' + err.message,
        exitCode: -1,
        duration: Date.now() - startTime
      });
    });
  });
}

/**
 * Create a mock test runner script that always passes
 * This avoids needing real Jest/Vitest in E2E tests
 */
export function createMockTestRunner(testDir: string): string {
  const runnerPath = path.join(testDir, 'mock-test-runner.js');
  const content = `#!/usr/bin/env node
// Mock test runner for E2E tests
const testFile = process.argv[2];
console.log('Running test:', testFile);

// Check if test file has been "fixed" by mock Claude
const fs = require('fs');
if (fs.existsSync(testFile)) {
  const content = fs.readFileSync(testFile, 'utf8');
  if (content.includes('toBe(4)')) {
    console.log('✓ Test passed (was fixed)');
    process.exit(0);
  }
}

console.error('✗ Test failed');
process.exit(1);
`;
  
  fs.writeFileSync(runnerPath, content);
  fs.chmodSync(runnerPath, '755');
  
  return runnerPath;
}

/**
 * Create a complete E2E test environment with proper configuration
 */
export function createE2ETestEnvironment(
  testDir: string,
  retryConfig: any = {},
  mockClaudePath?: string
): void {
  // Create mock test runner
  const testRunner = createMockTestRunner(testDir);
  
  // Create .tfqrc with complete configuration
  const configPath = path.join(testDir, '.tfqrc');
  const dbPath = path.join(testDir, '.tfq', 'test.db');
  
  const config = {
    database: {
      path: dbPath
    },
    language: 'javascript',
    framework: 'custom',
    testCommand: `node ${testRunner}`, // Use our mock runner
    claude: {
      enabled: true,
      claudePath: mockClaudePath || path.join(__dirname, '..', 'fixtures', 'mock-claude.js'),
      maxIterations: 10,
      testTimeout: 5000,
      verbose: true, // Enable verbose for better test output
      dangerouslySkipPermissions: true,
      ...retryConfig
    }
  };
  
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  // Create a sample test file
  const testFile = path.join(testDir, 'test.spec.js');
  fs.writeFileSync(testFile, `
describe('Math operations', () => {
  it('should add numbers correctly', () => {
    expect(2 + 2).toBe(5); // This will fail until "fixed"
  });
});`);
}