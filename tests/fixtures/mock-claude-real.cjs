#!/usr/bin/env node

/**
 * Enhanced Mock Claude CLI for Real E2E Testing
 * 
 * This version can actually parse and fix real JavaScript code
 * when MOCK_CLAUDE_FIX_REAL_FILES=true
 * 
 * Environment variables:
 * - MOCK_CLAUDE_BEHAVIOR: 'success' | 'flaky' | 'incremental' | 'timeout' | 'error'
 * - MOCK_CLAUDE_ATTEMPT: Current attempt number (for flaky/incremental behavior)
 * - MOCK_CLAUDE_FIX_REAL_FILES: 'true' to actually modify files
 * - MOCK_CLAUDE_TARGET_FILE: Path to the file to fix
 */

const fs = require('fs');
const path = require('path');

const behavior = process.env.MOCK_CLAUDE_BEHAVIOR || 'success';
const attempt = parseInt(process.env.MOCK_CLAUDE_ATTEMPT || '1');
const shouldFixFiles = process.env.MOCK_CLAUDE_FIX_REAL_FILES === 'true';
const targetFile = process.env.MOCK_CLAUDE_TARGET_FILE;

// Helper to write output
async function writeOutput(text) {
  process.stdout.write(text);
  await new Promise(resolve => setTimeout(resolve, 50));
}

// Fix the multiply bug in calculator.js
function fixMultiplyBug(content) {
  // Replace "return 17;" with "return a * b;" in multiply function
  return content.replace(
    /multiply\(a, b\) {\s*\/\/[^\n]*\s*return 17;/,
    'multiply(a, b) {\n    return a * b;'
  );
}

// Fix the average bug in calculator.js
function fixAverageBug(content) {
  // Add empty array check to average function
  const averagePattern = /average\(numbers\) {\s*\/\/[^\n]*\s*const sum = numbers\.reduce/;
  
  if (averagePattern.test(content)) {
    return content.replace(
      averagePattern,
      'average(numbers) {\n    if (numbers.length === 0) {\n      throw new Error("Cannot calculate average of empty array");\n    }\n    const sum = numbers.reduce'
    );
  }
  
  return content;
}

// Apply fixes based on behavior and attempt
function applyFixes(filePath, behavior, attempt) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  switch (behavior) {
    case 'success':
      // Only fix the multiply bug - average test expects NaN
      content = fixMultiplyBug(content);
      // Don't fix average - test expects NaN for empty array
      modified = true;
      break;

    case 'flaky':
      // Only succeed on attempt 3
      if (attempt >= 3) {
        content = fixMultiplyBug(content);
        // Don't fix average - test expects NaN
        modified = true;
      }
      break;

    case 'incremental':
      // Only fix multiply bug incrementally
      if (attempt >= 1) {
        content = fixMultiplyBug(content);
        modified = true;
      }
      break;

    case 'partial':
      // Only fix multiply bug
      content = fixMultiplyBug(content);
      modified = true;
      break;
  }

  if (modified) {
    fs.writeFileSync(filePath, content);
    return true;
  }

  return false;
}

// Main mock behavior
async function main() {
  // Handle --version flag
  if (process.argv.includes('--version')) {
    console.log('Mock Claude CLI (Real Fixes) v1.0.0');
    process.exit(0);
  }

  // Read stdin (the prompt) - with timeout to prevent hanging
  let prompt = '';
  if (!process.stdin.isTTY) {
    const chunks = [];
    const readPromise = new Promise((resolve) => {
      process.stdin.on('data', chunk => chunks.push(chunk));
      process.stdin.on('end', () => {
        prompt = Buffer.concat(chunks).toString();
        resolve(prompt);
      });
    });
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve(''), 5000);
    });
    
    prompt = await Promise.race([readPromise, timeoutPromise]);
  }

  // Find target file from prompt or environment
  let fileToFix = targetFile;
  
  if (!fileToFix && prompt) {
    // Try to extract file path from prompt
    const calculatorMatch = prompt.match(/calculator\.js/);
    if (calculatorMatch) {
      // Look for calculator.js in current directory tree
      const possiblePaths = [
        'src/calculator.js',
        './src/calculator.js',
        'calculator.js'
      ];
      
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          fileToFix = p;
          break;
        }
      }
    }
    
    // Also check if full path is in prompt
    const pathMatch = prompt.match(/(?:test file at |fixing |file: )([^\s]+\.js)/i);
    if (pathMatch && fs.existsSync(pathMatch[1])) {
      fileToFix = pathMatch[1];
    }
  }

  // Execute behavior
  switch (behavior) {
    case 'success':
      await writeOutput('🔄 Analyzing test failures...\n');
      await writeOutput('📝 Identifying required fixes...\n');
      
      if (shouldFixFiles && fileToFix) {
        const fixed = applyFixes(fileToFix, behavior, attempt);
        if (fixed) {
          await writeOutput(`✅ Fixed ${path.basename(fileToFix)} successfully\n`);
        }
      } else {
        await writeOutput('✅ Test analysis complete\n');
      }
      
      process.exit(0);
      break;

    case 'flaky':
      await writeOutput(`🔄 Attempt ${attempt}: Processing...\n`);
      
      if (attempt < 3) {
        await writeOutput('❌ Transient error occurred\n');
        process.stderr.write(`Network timeout on attempt ${attempt}\n`);
        process.exit(1);
      } else {
        if (shouldFixFiles && fileToFix) {
          const fixed = applyFixes(fileToFix, behavior, attempt);
          if (fixed) {
            await writeOutput(`✅ Fixed on attempt ${attempt}\n`);
          }
        }
        await writeOutput('✅ Success after retries\n');
        process.exit(0);
      }
      break;

    case 'incremental':
      await writeOutput(`🔄 Fixing attempt ${attempt}...\n`);
      
      if (shouldFixFiles && fileToFix) {
        const fixed = applyFixes(fileToFix, behavior, attempt);
        if (fixed) {
          if (attempt === 1) {
            await writeOutput('✅ Fixed multiply bug\n');
            await writeOutput('⚠️ Some tests still failing\n');
            process.exit(1); // Still have failures
          } else if (attempt === 2) {
            await writeOutput('✅ Fixed average bug\n');
            await writeOutput('⚠️ Checking remaining tests...\n');
            process.exit(1); // Might still have issues
          } else {
            await writeOutput('✅ All bugs fixed\n');
            process.exit(0);
          }
        }
      }
      
      await writeOutput('⚠️ Partial fix applied\n');
      process.exit(1);
      break;

    case 'timeout':
      await writeOutput('🔄 Processing...\n');
      // Never complete, let parent timeout
      await new Promise(resolve => setTimeout(resolve, 60000));
      break;

    case 'error':
      await writeOutput('🔄 Starting analysis...\n');
      await new Promise(resolve => setTimeout(resolve, 200));
      process.stderr.write('Error: Compilation failed\n');
      process.exit(1);
      break;

    default:
      console.error(`Unknown behavior: ${behavior}`);
      process.exit(1);
  }
}

// Handle signals
process.on('SIGTERM', () => {
  process.exit(143);
});

process.on('SIGINT', () => {
  process.exit(130);
});

// Run main
main().catch(err => {
  console.error('Mock Claude error:', err);
  process.exit(1);
});