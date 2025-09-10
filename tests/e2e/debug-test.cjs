#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function test() {
  // Create temp dir
  const tmpDir = '/tmp/tfq-debug-' + Date.now();
  fs.mkdirSync(tmpDir, { recursive: true });
  
  // Copy JavaScript example
  const exampleDir = path.join(__dirname, '..', '..', 'examples', 'javascript');
  console.log('Copying from:', exampleDir);
  console.log('To:', tmpDir);
  
  // Use cp to copy
  const cp = spawn('cp', ['-r', exampleDir + '/.', tmpDir]);
  await new Promise(resolve => cp.on('close', resolve));
  
  // Run reset script
  const reset = spawn('bash', ['reset.sh'], { cwd: tmpDir });
  await new Promise(resolve => reset.on('close', resolve));
  
  // Check if calculator has bugs
  const calcPath = path.join(tmpDir, 'src', 'calculator.js');
  const content = fs.readFileSync(calcPath, 'utf8');
  console.log('Has multiply bug:', content.includes('return 17'));
  
  // Run mock Claude to fix it
  const mockClaudePath = path.join(__dirname, '..', 'fixtures', 'mock-claude-real.cjs');
  console.log('Mock Claude:', mockClaudePath);
  
  const env = {
    ...process.env,
    MOCK_CLAUDE_BEHAVIOR: 'success',
    MOCK_CLAUDE_FIX_REAL_FILES: 'true',
    MOCK_CLAUDE_TARGET_FILE: calcPath
  };
  
  const claude = spawn('node', [mockClaudePath], {
    cwd: tmpDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  claude.stdin.write('Fix calculator.js');
  claude.stdin.end();
  
  let output = '';
  claude.stdout.on('data', d => output += d.toString());
  claude.stderr.on('data', d => console.error('Error:', d.toString()));
  
  await new Promise(resolve => claude.on('close', resolve));
  
  console.log('Claude output:', output);
  console.log('Claude exit code:', claude.exitCode);
  
  // Check if fixed
  const fixedContent = fs.readFileSync(calcPath, 'utf8');
  console.log('Has multiply bug after fix:', fixedContent.includes('return 17'));
  console.log('Has correct multiply:', fixedContent.includes('return a * b'));
  
  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

test().catch(console.error);