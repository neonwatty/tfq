import path from 'path';
import fs from 'fs';
import { execa } from 'execa';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Sets up the JavaScript example project in a test directory
 * Copies the example and resets it to a buggy state
 */
export async function setupJavaScriptExample(testDir: string): Promise<{
  projectDir: string;
  cleanup: () => Promise<void>;
}> {
  // Use __dirname to find the examples directory relative to this file
  const exampleDir = path.join(__dirname, '..', '..', 'examples', 'javascript');
  
  if (!fs.existsSync(exampleDir)) {
    throw new Error(`JavaScript example not found at ${exampleDir}`);
  }

  // Copy the entire example to test directory
  await execa('cp', ['-r', exampleDir + '/.', testDir], { 
    timeout: 10000,
    reject: true 
  });

  // Run the reset script to introduce bugs
  const resetScript = path.join(testDir, 'reset.sh');
  if (fs.existsSync(resetScript)) {
    await execa('bash', [resetScript], {
      cwd: testDir,
      timeout: 10000,
      reject: false // Don't fail if reset script has issues
    });
  }

  // Cleanup function
  const cleanup = async () => {
    // Remove any generated files/folders
    const tfqDir = path.join(testDir, '.tfq');
    if (fs.existsSync(tfqDir)) {
      fs.rmSync(tfqDir, { recursive: true, force: true });
    }
  };

  return {
    projectDir: testDir,
    cleanup
  };
}

/**
 * Creates a .tfqrc config for the JavaScript example with real Jest execution
 */
export function createRealJavaScriptConfig(
  testDir: string,
  retryConfig: any = {},
  mockClaudePath?: string
): string {
  const configPath = path.join(testDir, '.tfqrc');
  const dbPath = path.join(testDir, '.tfq', 'test.db');
  
  const config = {
    database: {
      path: dbPath
    },
    language: 'javascript',
    framework: 'jest',
    testCommand: 'npm test', // Real Jest command
    claude: {
      enabled: true,
      claudePath: mockClaudePath || path.join(__dirname, '..', 'fixtures', 'mock-claude.cjs'),
      maxIterations: 10,
      testTimeout: 10000, // Longer timeout for real Jest
      ...retryConfig,
      dangerouslySkipPermissions: true
    }
  };
  
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  return configPath;
}

/**
 * Runs Jest tests in the example project and returns results
 */
export async function runJestTests(projectDir: string): Promise<{
  success: boolean;
  output: string;
  failedTests: string[];
}> {
  try {
    const result = await execa('npm', ['test'], {
      cwd: projectDir,
      reject: false,
      timeout: 15000
    });

    const output = result.stdout + '\n' + result.stderr;
    const failedTests: string[] = [];

    // Parse Jest output for failed tests
    const failureMatches = output.match(/FAIL\s+([^\n]+)/g) || [];
    failureMatches.forEach(match => {
      const testFile = match.replace('FAIL', '').trim();
      failedTests.push(testFile);
    });

    return {
      success: result.exitCode === 0,
      output,
      failedTests
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.message || 'Test execution failed',
      failedTests: []
    };
  }
}

/**
 * Verifies that specific bugs are present in the calculator
 */
export function verifyBugsPresent(projectDir: string): boolean {
  const calculatorPath = path.join(projectDir, 'src', 'calculator.js');
  if (!fs.existsSync(calculatorPath)) {
    return false;
  }

  const content = fs.readFileSync(calculatorPath, 'utf8');
  
  // Check for the multiply bug (returns 17)
  const hasMultiplyBug = content.includes('return 17;');
  
  // Check for the average bug (no empty array check)
  const hasAverageBug = !content.includes('if (numbers.length === 0)');

  return hasMultiplyBug || hasAverageBug;
}

/**
 * Verifies that bugs have been fixed in the calculator
 */
export function verifyBugsFixed(projectDir: string): boolean {
  const calculatorPath = path.join(projectDir, 'src', 'calculator.js');
  if (!fs.existsSync(calculatorPath)) {
    return false;
  }

  const content = fs.readFileSync(calculatorPath, 'utf8');
  
  // Check that multiply bug is fixed
  const multiplyFixed = content.includes('return a * b;') && !content.includes('return 17;');
  
  // Check that average has some error handling
  const averageFixed = content.includes('if (numbers.length === 0)') || 
                       content.includes('!numbers.length');

  return multiplyFixed || averageFixed;
}