import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('fix-all Exit Code Scenarios', () => {
  let testDir: string;
  const tfqBin = path.join(__dirname, '../../dist/cli.js');

  beforeEach(() => {
    // Create a unique test directory
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    testDir = path.join('/tmp', `tfq-exit-test-${timestamp}-${random}`);
    fs.mkdirSync(testDir, { recursive: true });
    
    // Don't initialize tfq here - let each test do it as needed
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Exit Code 0 - Normal Scenarios', () => {
    it('should exit with code 0 when no test files exist', () => {
      // Initialize tfq
      execSync(`node ${tfqBin} init --skip-claude`, { cwd: testDir });
      
      // Setup package.json with test script but no test files
      const packageJson = {
        name: 'test-project',
        type: 'module',
        scripts: {
          test: 'vitest run'
        }
      };
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Run fix-all and capture exit code
      let exitCode = 0;
      try {
        execSync(`node ${tfqBin} fix-all --max-iterations 1`, { 
          cwd: testDir,
          stdio: 'pipe' 
        });
      } catch (error: any) {
        exitCode = error.status || 1;
      }

      // Should exit with code 0 (success)
      expect(exitCode).toBe(0);
    });

    it('should exit with code 0 when all tests are passing', () => {
      // Setup .tfqrc with database and custom test command that always passes
      const tfqConfig = {
        database: {
          path: path.join(testDir, '.tfq/tfq.db')
        },
        testCommands: {
          'javascript:vitest': 'echo "All tests passed" && exit 0'
        }
      };
      fs.mkdirSync(path.join(testDir, '.tfq'), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, '.tfqrc'),
        JSON.stringify(tfqConfig, null, 2)
      );

      // Setup package.json 
      const packageJson = {
        name: 'test-project',
        scripts: {
          test: 'echo "Tests running"'
        }
      };
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a dummy test file so tfq detects it as a test project
      const testFile = path.join(testDir, 'dummy.test.js');
      fs.writeFileSync(testFile, '// dummy test file');

      // Run fix-all and capture exit code
      let exitCode = 0;
      let stdout = '';
      try {
        stdout = execSync(`node ${tfqBin} fix-all --max-iterations 1`, { 
          cwd: testDir,
          encoding: 'utf8'
        });
      } catch (error: any) {
        exitCode = error.status || 1;
        stdout = error.stdout || '';
      }

      // Should exit with code 0 when all tests pass
      expect(exitCode).toBe(0);
      // Should contain the "all tests passing" message
      expect(stdout).toContain('All tests are already passing');
    });

    it('should exit with code 0 when no failed tests found', () => {
      // Setup .tfqrc with database and custom test command that passes with no failures
      const tfqConfig = {
        database: {
          path: path.join(testDir, '.tfq/tfq.db')
        },
        testCommands: {
          'javascript:vitest': 'echo "Tests completed successfully" && exit 0'
        }
      };
      fs.mkdirSync(path.join(testDir, '.tfq'), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, '.tfqrc'),
        JSON.stringify(tfqConfig, null, 2)
      );

      // Setup package.json
      const packageJson = {
        name: 'test-project',
        scripts: {
          test: 'echo "Tests running"'
        }
      };
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a dummy test file so it passes the "no test files" check
      fs.writeFileSync(
        path.join(testDir, 'dummy.test.js'),
        '// dummy test file'
      );

      // Run fix-all and capture exit code
      let exitCode = 0;
      let stdout = '';
      try {
        stdout = execSync(`node ${tfqBin} fix-all --max-iterations 1`, { 
          cwd: testDir,
          encoding: 'utf8'
        });
      } catch (error: any) {
        exitCode = error.status || 1;
        stdout = error.stdout || '';
      }

      // Should exit with code 0
      expect(exitCode).toBe(0);
    });

    it('should exit with code 0 and return proper JSON for no test files', () => {
      // Initialize tfq
      execSync(`node ${tfqBin} init --skip-claude`, { cwd: testDir });
      
      // Setup package.json with test script but no test files
      const packageJson = {
        name: 'test-project',
        scripts: {
          test: 'echo "No tests found"'
        }
      };
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Run fix-all with JSON output
      let exitCode = 0;
      let stdout = '';
      try {
        stdout = execSync(`node ${tfqBin} fix-all --max-iterations 1 --json`, { 
          cwd: testDir,
          encoding: 'utf8'
        });
      } catch (error: any) {
        exitCode = error.status || 1;
        stdout = error.stdout || '';
      }

      // Should exit with code 0
      expect(exitCode).toBe(0);
      
      // Parse and validate JSON output
      const jsonOutput = JSON.parse(stdout);
      expect(jsonOutput.success).toBe(true);
      expect(jsonOutput.message).toContain('No test files found');
      expect(jsonOutput.language).toBeDefined();
      expect(jsonOutput.framework).toBeDefined();
    });
  });

  describe('Exit Code 1 - Error Scenarios', () => {
    it('should exit with code 1 for invalid max-iterations', () => {
      // Initialize tfq
      execSync(`node ${tfqBin} init --skip-claude`, { cwd: testDir });
      
      let exitCode = 0;
      try {
        execSync(`node ${tfqBin} fix-all --max-iterations 0`, { 
          cwd: testDir,
          stdio: 'pipe' 
        });
      } catch (error: any) {
        exitCode = error.status || 1;
      }

      // Should exit with code 1 for invalid parameter
      expect(exitCode).toBe(1);
    });

    it('should exit with code 1 for invalid test-timeout', () => {
      // Initialize tfq
      execSync(`node ${tfqBin} init --skip-claude`, { cwd: testDir });
      
      let exitCode = 0;
      try {
        execSync(`node ${tfqBin} fix-all --test-timeout 1000`, { 
          cwd: testDir,
          stdio: 'pipe' 
        });
      } catch (error: any) {
        exitCode = error.status || 1;
      }

      // Should exit with code 1 for invalid timeout
      expect(exitCode).toBe(1);
    });

    it('should exit with code 1 when test discovery fails', () => {
      // Initialize tfq
      execSync(`node ${tfqBin} init --skip-claude`, { cwd: testDir });
      
      // Setup package.json with non-existent test command
      const packageJson = {
        name: 'test-project',
        scripts: {
          test: 'nonexistent-test-runner'
        }
      };
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a test file so we pass the pre-flight check
      fs.writeFileSync(path.join(testDir, 'example.test.js'), '// test');

      let exitCode = 0;
      let stderr = '';
      try {
        execSync(`node ${tfqBin} fix-all --max-iterations 1`, { 
          cwd: testDir,
          stdio: 'pipe' 
        });
      } catch (error: any) {
        exitCode = error.status || 1;
        stderr = error.stderr?.toString() || '';
      }

      // Should exit with code 1 for test discovery failure
      expect(exitCode).toBe(1);
    });
  });

  describe('Exit Code Context - Final Status', () => {
    it('should exit with code 1 when tests remain unfixed after iterations', () => {
      // Initialize tfq
      execSync(`node ${tfqBin} init --skip-claude`, { cwd: testDir });
      
      // Create a failing test
      const testFile = path.join(testDir, 'failing.test.js');
      const content = `
        describe('Failing test', () => {
          it('should fail', () => {
            expect(1).toBe(2);
          });
        });
      `;
      fs.writeFileSync(testFile, content);

      // Add to queue
      execSync(`node ${tfqBin} add ${testFile}`, { cwd: testDir });

      // Run fix-all without Claude (will fail to fix)
      let exitCode = 0;
      try {
        execSync(`node ${tfqBin} fix-all --max-iterations 1`, { 
          cwd: testDir,
          stdio: 'pipe',
          env: { ...process.env, CLAUDE_DISABLED: 'true' }
        });
      } catch (error: any) {
        exitCode = error.status || 1;
      }

      // Should exit with code 1 when tests remain
      expect(exitCode).toBe(1);
    });
  });
});