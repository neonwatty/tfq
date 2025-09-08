import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execa } from 'execa';

describe('Claude Retry E2E Tests (Simple)', () => {
  let testDir: string;
  const mockClaudePath = path.join(__dirname, '..', 'fixtures', 'mock-claude.js');

  beforeEach(() => {
    // Create test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfq-retry-e2e-'));
    
    // Create .tfq database directory
    fs.mkdirSync(path.join(testDir, '.tfq'), { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should retry on exit code 1 and show retry messages', async () => {
    // Create config with retry settings
    const config = {
      database: { path: '.tfq/test.db' },
      language: 'javascript', 
      framework: 'custom',
      testCommand: 'echo "test passed"',
      claude: {
        enabled: true,
        claudePath: mockClaudePath,
        maxRetries: 2,
        retryDelay: 100,
        retryBackoffMultiplier: 2,
        maxRetryDelay: 500,
        verbose: true,
        testTimeout: 5000,
        dangerouslySkipPermissions: true
      }
    };
    
    fs.writeFileSync(
      path.join(testDir, '.tfqrc'),
      JSON.stringify(config, null, 2)
    );

    // Create a test file
    fs.writeFileSync(
      path.join(testDir, 'test.js'),
      'test("fails", () => { expect(1).toBe(2); });'
    );

    // Skip init - config file is already created

    // Add test to queue
    await execa('npx', ['tsx', path.join(process.cwd(), 'src/cli.ts'), 'add', 'test.js'], {
      cwd: testDir
    });

    // Run fix-next with flaky mock (fails twice, succeeds third time)
    const result = await execa(
      'npx', 
      ['tsx', path.join(process.cwd(), 'src/cli.ts'), 'fix-next'],
      {
        cwd: testDir,
        env: {
          ...process.env,
          MOCK_CLAUDE_BEHAVIOR: 'flaky',
          MOCK_CLAUDE_FIX_FILES: 'true'
        },
        reject: false,
        timeout: 20000
      }
    );

    // Check output for retry indicators
    const output = result.stdout + '\n' + result.stderr;
    
    // Should see retry attempts in verbose mode
    expect(output).toContain('Retry');
    
    // Should see multiple attempts
    expect(output).toContain('Attempt');
    
    // Check exit code (should succeed eventually)
    expect(result.exitCode).toBe(0);
  }, 30000);

  it('should NOT retry on exit code 127', async () => {
    // Create config
    const config = {
      database: { path: '.tfq/test.db' },
      language: 'javascript',
      framework: 'custom', 
      testCommand: 'echo "test"',
      claude: {
        enabled: true,
        claudePath: mockClaudePath,
        maxRetries: 3,
        retryDelay: 100,
        verbose: true,
        dangerouslySkipPermissions: true
      }
    };
    
    fs.writeFileSync(
      path.join(testDir, '.tfqrc'),
      JSON.stringify(config, null, 2)
    );

    // Create test file
    fs.writeFileSync(
      path.join(testDir, 'test.js'),
      'test("fails", () => { expect(1).toBe(2); });'
    );

    // Add to queue
    await execa('npx', ['tsx', path.join(process.cwd(), 'src/cli.ts'), 'add', 'test.js'], {
      cwd: testDir
    });

    // Run with exit_127 behavior
    const result = await execa(
      'npx',
      ['tsx', path.join(process.cwd(), 'src/cli.ts'), 'fix-next'],
      {
        cwd: testDir,
        env: {
          ...process.env,
          MOCK_CLAUDE_BEHAVIOR: 'exit_127'
        },
        reject: false,
        timeout: 10000
      }
    );

    const output = result.stdout + '\n' + result.stderr;
    
    // Should fail immediately without retries
    expect(output).toContain('command not found');
    expect(output).not.toContain('Retry attempt');
    expect(result.exitCode).toBe(1);
  }, 15000);

  it('should show proper backoff delays', async () => {
    const config = {
      database: { path: '.tfq/test.db' },
      language: 'javascript',
      framework: 'custom',
      testCommand: 'echo "test"',
      claude: {
        enabled: true,
        claudePath: mockClaudePath,
        maxRetries: 3,
        retryDelay: 200,
        retryBackoffMultiplier: 2,
        maxRetryDelay: 1000,
        verbose: true,
        dangerouslySkipPermissions: true
      }
    };
    
    fs.writeFileSync(
      path.join(testDir, '.tfqrc'),
      JSON.stringify(config, null, 2)
    );

    fs.writeFileSync(
      path.join(testDir, 'test.js'),
      'test("fails", () => { expect(1).toBe(2); });'
    );

    await execa('npx', ['tsx', path.join(process.cwd(), 'src/cli.ts'), 'add', 'test.js'], {
      cwd: testDir
    });

    const startTime = Date.now();
    const result = await execa(
      'npx',
      ['tsx', path.join(process.cwd(), 'src/cli.ts'), 'fix-next'],
      {
        cwd: testDir,
        env: {
          ...process.env,
          MOCK_CLAUDE_BEHAVIOR: 'exit_1' // Always fail to test all retries
        },
        reject: false,
        timeout: 15000
      }
    );
    const duration = Date.now() - startTime;

    const output = result.stdout;
    
    // Parse delays from output
    const delayMatches = output.match(/after (\d+)ms delay/g) || [];
    
    if (delayMatches.length > 0) {
      const delays = delayMatches.map(m => parseInt(m.match(/(\d+)/)![1]));
      
      // First retry: ~200ms
      if (delays[0]) {
        expect(delays[0]).toBeGreaterThanOrEqual(200);
        expect(delays[0]).toBeLessThanOrEqual(220); // With jitter
      }
      
      // Second retry: ~400ms  
      if (delays[1]) {
        expect(delays[1]).toBeGreaterThanOrEqual(400);
        expect(delays[1]).toBeLessThanOrEqual(440);
      }
      
      // Third retry: ~800ms
      if (delays[2]) {
        expect(delays[2]).toBeGreaterThanOrEqual(800);
        expect(delays[2]).toBeLessThanOrEqual(880);
      }
    }
    
    // Total time should reflect the delays
    expect(duration).toBeGreaterThan(1000); // At least sum of delays
  }, 20000);

  it('should work with maxRetries = 0 (no retries)', async () => {
    const config = {
      database: { path: '.tfq/test.db' },
      language: 'javascript',
      framework: 'custom',
      testCommand: 'echo "test"',
      claude: {
        enabled: true,
        claudePath: mockClaudePath,
        maxRetries: 0, // No retries
        verbose: true,
        dangerouslySkipPermissions: true
      }
    };
    
    fs.writeFileSync(
      path.join(testDir, '.tfqrc'),
      JSON.stringify(config, null, 2)
    );

    fs.writeFileSync(
      path.join(testDir, 'test.js'),
      'test("fails", () => { expect(1).toBe(2); });'
    );

    await execa('npx', ['tsx', path.join(process.cwd(), 'src/cli.ts'), 'add', 'test.js'], {
      cwd: testDir
    });

    const result = await execa(
      'npx',
      ['tsx', path.join(process.cwd(), 'src/cli.ts'), 'fix-next'],
      {
        cwd: testDir,
        env: {
          ...process.env,
          MOCK_CLAUDE_BEHAVIOR: 'exit_1'
        },
        reject: false,
        timeout: 10000
      }
    );

    const output = result.stdout;
    
    // Should NOT show retry attempts
    expect(output).not.toContain('Retry attempt');
    
    // Should NOT show "after retries" suffix
    expect(output).not.toContain('(after retries)');
    
    expect(result.exitCode).toBe(1);
  }, 15000);
});