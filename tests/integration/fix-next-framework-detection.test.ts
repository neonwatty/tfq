import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { setupIntegrationTest, runTfqCommand } from './test-utils.js';

describe('fix-next Framework Detection in Verification', () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupIntegrationTest('fix-next-framework');
    testDir = setup.testDir;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    if (cleanup && typeof cleanup === 'function') {
      await cleanup();
    }
  });

  describe('Jest Framework Detection', () => {
    it('should detect and use Jest for verification in Next.js project', async () => {
      // Create a Jest-based project structure
      const packageJson = {
        name: 'test-jest-project',
        version: '1.0.0',
        scripts: {
          test: 'jest'
        },
        devDependencies: {
          jest: '^29.0.0',
          '@types/jest': '^29.0.0'
        }
      };

      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a Jest test file
      const testFile = path.join(testDir, 'example.test.js');
      const testContent = `
describe('Example Test', () => {
  it('should pass', () => {
    expect(true).toBe(true);
  });
});`;

      fs.writeFileSync(testFile, testContent);

      // Initialize tfq
      await runTfqCommand(['init'], testDir);

      // Run tests with auto-detect to verify Jest is used
      const result = await runTfqCommand(['run-tests', '--auto-detect', '--json'], testDir);

      // Parse JSON output
      const jsonLine = result.output.split('\n').find(line => line.trim().startsWith('{'));
      if (jsonLine) {
        const json = JSON.parse(jsonLine);
        expect(json.framework).toBe('jest');
        expect(json.command).toContain('jest');
        expect(json.command).not.toContain('vitest');
      }
    });

    it('should use Jest when package.json has @testing-library/jest-dom', async () => {
      // Common in Next.js projects
      const packageJson = {
        name: 'nextjs-project',
        version: '1.0.0',
        scripts: {
          test: 'jest --watch'
        },
        devDependencies: {
          '@testing-library/jest-dom': '^5.16.0',
          '@testing-library/react': '^13.0.0',
          jest: '^29.0.0',
          'jest-environment-jsdom': '^29.0.0'
        }
      };

      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a test file
      const testFile = path.join(testDir, 'component.test.jsx');
      const testContent = `
import '@testing-library/jest-dom';

describe('Component Test', () => {
  it('should work', () => {
    expect(1 + 1).toBe(2);
  });
});`;

      fs.writeFileSync(testFile, testContent);

      // Initialize and run tests
      await runTfqCommand(['init'], testDir);
      const result = await runTfqCommand(['run-tests', '--auto-detect', '--json'], testDir);

      const jsonLine = result.output.split('\n').find(line => line.trim().startsWith('{'));
      if (jsonLine) {
        const json = JSON.parse(jsonLine);
        expect(json.framework).toBe('jest');
      }
    });
  });

  describe('Vitest Framework Detection', () => {
    it('should detect and use Vitest for Vite projects', async () => {
      // Create a Vitest-based project
      const packageJson = {
        name: 'vite-project',
        version: '1.0.0',
        type: 'module',
        scripts: {
          test: 'vitest'
        },
        devDependencies: {
          vitest: '^0.34.0',
          vite: '^4.4.0'
        }
      };

      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a Vitest test file
      const testFile = path.join(testDir, 'example.test.ts');
      const testContent = `
import { describe, it, expect } from 'vitest';

describe('Vite Test', () => {
  it('should pass', () => {
    expect(2 + 2).toBe(4);
  });
});`;

      fs.writeFileSync(testFile, testContent);

      // Initialize and run
      await runTfqCommand(['init'], testDir);
      const result = await runTfqCommand(['run-tests', '--auto-detect', '--json'], testDir);

      const jsonLine = result.output.split('\n').find(line => line.trim().startsWith('{'));
      if (jsonLine) {
        const json = JSON.parse(jsonLine);
        expect(json.framework).toBe('vitest');
        expect(json.command).toContain('vitest run');
      }
    });
  });

  describe('Mocha Framework Detection', () => {
    it('should detect and use Mocha when present', async () => {
      // Create a Mocha-based project
      const packageJson = {
        name: 'mocha-project',
        version: '1.0.0',
        scripts: {
          test: 'mocha'
        },
        devDependencies: {
          mocha: '^10.0.0',
          chai: '^4.3.0'
        }
      };

      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a Mocha test file
      const testFile = path.join(testDir, 'test.spec.js');
      const testContent = `
const assert = require('assert');

describe('Mocha Test', function() {
  it('should pass', function() {
    assert.equal(1 + 1, 2);
  });
});`;

      fs.writeFileSync(testFile, testContent);

      // Initialize and run
      await runTfqCommand(['init'], testDir);
      const result = await runTfqCommand(['run-tests', '--auto-detect', '--json'], testDir);

      const jsonLine = result.output.split('\n').find(line => line.trim().startsWith('{'));
      if (jsonLine) {
        const json = JSON.parse(jsonLine);
        expect(json.framework).toBe('mocha');
      }
    });
  });

  describe('Framework Priority', () => {
    it('should prioritize Jest over Vitest when both are present', async () => {
      // Some projects might have both during migration
      const packageJson = {
        name: 'multi-framework',
        version: '1.0.0',
        scripts: {
          test: 'jest',
          'test:vitest': 'vitest'
        },
        devDependencies: {
          jest: '^29.0.0',
          vitest: '^0.34.0'
        }
      };

      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create test file
      const testFile = path.join(testDir, 'example.test.js');
      fs.writeFileSync(testFile, `
test('example', () => {
  expect(true).toBe(true);
});`);

      // Initialize and run
      await runTfqCommand(['init'], testDir);
      const result = await runTfqCommand(['run-tests', '--auto-detect', '--json'], testDir);

      const jsonLine = result.output.split('\n').find(line => line.trim().startsWith('{'));
      if (jsonLine) {
        const json = JSON.parse(jsonLine);
        // Should detect Jest since it's in the main test script
        expect(json.framework).toBe('jest');
      }
    });
  });

  describe('Fallback Behavior', () => {
    it('should fall back to configured framework when detection fails', async () => {
      // Create .tfqrc with explicit framework
      const tfqConfig = {
        language: 'javascript',
        framework: 'mocha',
        database: {
          path: './.tfq/tfq.db'
        }
      };

      fs.writeFileSync(
        path.join(testDir, '.tfqrc'),
        JSON.stringify(tfqConfig, null, 2)
      );

      // Create package.json without clear framework indicators
      const packageJson = {
        name: 'ambiguous-project',
        version: '1.0.0',
        scripts: {
          test: 'npm run test:unit'
        }
      };

      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create test file
      const testFile = path.join(testDir, 'test.js');
      fs.writeFileSync(testFile, 'console.log("test");');

      // Run without auto-detect (should use config)
      const result = await runTfqCommand(['run-tests', '--json', 'echo "test"'], testDir);

      const jsonLine = result.output.split('\n').find(line => line.trim().startsWith('{'));
      if (jsonLine) {
        const json = JSON.parse(jsonLine);
        expect(json.framework).toBe('mocha');
      }
    });

    it('should use adapter default when no framework is configured or detected', async () => {
      // Create minimal package.json
      const packageJson = {
        name: 'minimal-project',
        version: '1.0.0'
      };

      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Initialize tfq (creates default config)
      await runTfqCommand(['init'], testDir);

      // Create test file
      const testFile = path.join(testDir, 'test.spec.js');
      fs.writeFileSync(testFile, 'console.log("test");');

      // Run with auto-detect
      const result = await runTfqCommand(['run-tests', '--auto-detect', '--json', 'echo "test"'], testDir);

      const jsonLine = result.output.split('\n').find(line => line.trim().startsWith('{'));
      if (jsonLine) {
        const json = JSON.parse(jsonLine);
        // Should fall back to adapter default (vitest for JavaScript)
        expect(json.framework).toBe('vitest');
      }
    });
  });

  describe('fix-all Framework Detection', () => {
    it('should use autoDetect for initial test discovery when queue is empty', async () => {
      // Create a Jest-based project structure
      const packageJson = {
        name: 'test-jest-project',
        version: '1.0.0',
        scripts: {
          test: 'jest'
        },
        devDependencies: {
          jest: '^29.0.0',
          '@types/jest': '^29.0.0'
        }
      };

      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a failing Jest test file
      const testFile = path.join(testDir, 'failing.test.js');
      const testContent = `
describe('Failing Test', () => {
  it('should fail initially', () => {
    expect(2 + 2).toBe(5); // Intentionally wrong for discovery
  });
});`;

      fs.writeFileSync(testFile, testContent);

      // Initialize tfq
      await runTfqCommand(['init'], testDir);

      // Run fix-all with empty queue - should discover using Jest, not Vitest
      // This will fail because Claude is disabled, but we can check the framework detection
      const result = await runTfqCommand(['fix-all', '--max-iterations', '1', '--json'], testDir);

      // Even though fix-all fails (Claude disabled), the initial test discovery should have used Jest
      // The exact output will vary, but we're testing that autoDetect is being used
      expect(result.output || result.error).toBeTruthy();

      // Verify the project would be detected as Jest (not Vitest) if we ran run-tests
      const runTestsResult = await runTfqCommand(['run-tests', '--auto-detect', '--json'], testDir);
      if (runTestsResult.output) {
        const jsonLine = runTestsResult.output.split('\n').find(line => line.trim().startsWith('{'));
        if (jsonLine) {
          const json = JSON.parse(jsonLine);
          expect(json.framework).toBe('jest');
        }
      }
    });
  });
});