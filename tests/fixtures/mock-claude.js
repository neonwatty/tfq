#!/usr/bin/env node

/**
 * Mock Claude CLI for E2E testing
 * 
 * Simulates various Claude behaviors controlled by environment variables:
 * - MOCK_CLAUDE_BEHAVIOR: 'success' | 'timeout' | 'exit_1' | 'exit_2' | 'exit_127' | 'flaky'
 * - MOCK_CLAUDE_ATTEMPT: Current attempt number (for flaky behavior)
 * - MOCK_CLAUDE_TIMEOUT_MS: How long to wait before timeout
 * - MOCK_CLAUDE_OUTPUT: Custom output to emit
 * - MOCK_CLAUDE_STREAM_DELAY: Delay between output chunks (ms)
 */

const behavior = process.env.MOCK_CLAUDE_BEHAVIOR || 'success';
const attempt = parseInt(process.env.MOCK_CLAUDE_ATTEMPT || '1');
const timeoutMs = parseInt(process.env.MOCK_CLAUDE_TIMEOUT_MS || '5000');
const customOutput = process.env.MOCK_CLAUDE_OUTPUT || '';
const streamDelay = parseInt(process.env.MOCK_CLAUDE_STREAM_DELAY || '100');

// Helper to write output with optional streaming
async function writeOutput(text, stream = false) {
  if (!stream) {
    process.stdout.write(text);
    return;
  }

  // Simulate streaming output
  const lines = text.split('\n');
  for (const line of lines) {
    process.stdout.write(line + '\n');
    if (streamDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, streamDelay));
    }
  }
}

// Helper to simulate work
async function simulateWork(duration) {
  await new Promise(resolve => setTimeout(resolve, duration));
}

// Main mock behavior
async function main() {
  // Handle --version flag
  if (process.argv.includes('--version')) {
    console.log('Mock Claude CLI v1.0.0');
    process.exit(0);
  }

  // Log received input for debugging
  if (process.env.MOCK_CLAUDE_DEBUG === 'true') {
    console.error(`[MOCK] Behavior: ${behavior}, Attempt: ${attempt}`);
    console.error(`[MOCK] Args:`, process.argv.slice(2));
  }

  // Read stdin (the prompt)
  let prompt = '';
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    prompt = Buffer.concat(chunks).toString();
  }

  if (process.env.MOCK_CLAUDE_DEBUG === 'true' && prompt) {
    console.error(`[MOCK] Received prompt (${prompt.length} chars)`);
  }

  // Execute behavior based on environment variable
  switch (behavior) {
    case 'success':
      await writeOutput('🔄 Processing request...\n', true);
      await simulateWork(500);
      await writeOutput('✅ Test fixed successfully\n');
      
      if (customOutput) {
        await writeOutput(customOutput + '\n');
      }
      
      // Simulate fixing the test by modifying a file if path is in prompt
      const testFileMatch = prompt.match(/test file at ([^\s]+)/);
      if (testFileMatch && process.env.MOCK_CLAUDE_FIX_FILES === 'true') {
        const fs = require('fs');
        const testFile = testFileMatch[1];
        if (fs.existsSync(testFile)) {
          const content = fs.readFileSync(testFile, 'utf8');
          // Simple fix: replace toBe(5) with toBe(4)
          const fixed = content.replace('toBe(5)', 'toBe(4)');
          fs.writeFileSync(testFile, fixed);
          await writeOutput(`📝 Fixed test file: ${testFile}\n`);
        }
      }
      
      process.exit(0);
      break;

    case 'timeout':
      await writeOutput('🔄 Processing request...\n', true);
      // Never complete, let parent process timeout
      await simulateWork(timeoutMs * 2);
      break;

    case 'exit_1':
      await writeOutput('🔄 Processing request...\n', true);
      await simulateWork(300);
      process.stderr.write('Error: Test compilation failed\n');
      process.exit(1);
      break;

    case 'exit_2':
      await writeOutput('🔄 Processing request...\n', true);
      await simulateWork(300);
      process.stderr.write('Error: Network connection lost\n');
      process.exit(2);
      break;

    case 'exit_127':
      process.stderr.write('command not found: some-tool\n');
      process.exit(127);
      break;

    case 'permission_error':
      process.stderr.write('Error: EACCES: permission denied\n');
      process.exit(1);
      break;

    case 'flaky':
      // Fail on first attempts, succeed on later attempts
      if (attempt <= 2) {
        await writeOutput(`🔄 Attempt ${attempt} starting...\n`, true);
        await simulateWork(300);
        process.stderr.write(`Transient error on attempt ${attempt}\n`);
        process.exit(1);
      } else {
        await writeOutput(`🔄 Attempt ${attempt} starting...\n`, true);
        await simulateWork(500);
        await writeOutput('✅ Test fixed successfully after retries\n');
        process.exit(0);
      }
      break;

    case 'partial_output':
      // Emit partial output then fail
      await writeOutput('🔄 Processing request...\n', true);
      await writeOutput('📝 Analyzing test file...\n', true);
      await simulateWork(500);
      await writeOutput('🔨 Attempting fix...\n', true);
      process.stderr.write('Error: Unexpected token\n');
      process.exit(1);
      break;

    case 'crash':
      await writeOutput('🔄 Processing request...\n', true);
      await simulateWork(200);
      // Simulate segfault/crash
      process.kill(process.pid, 'SIGSEGV');
      break;

    default:
      console.error(`Unknown behavior: ${behavior}`);
      process.exit(1);
  }
}

// Handle signals
process.on('SIGTERM', () => {
  if (process.env.MOCK_CLAUDE_DEBUG === 'true') {
    console.error('[MOCK] Received SIGTERM');
  }
  process.exit(143);
});

process.on('SIGINT', () => {
  if (process.env.MOCK_CLAUDE_DEBUG === 'true') {
    console.error('[MOCK] Received SIGINT');
  }
  process.exit(130);
});

// Run main
main().catch(err => {
  console.error('Mock Claude error:', err);
  process.exit(1);
});