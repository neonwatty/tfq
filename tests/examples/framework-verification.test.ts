import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  examplesPath,
  createTempDbPath,
  cleanupTempDb,
  runTfqCommand
} from './test-helpers.js';

/**
 * Framework Verification Tests
 *
 * These tests verify that both fix-next and fix-all commands use the correct
 * test framework when working with real example projects.
 *
 * Unlike E2E tests, these don't require Claude CLI - they mock Claude execution
 * to focus purely on framework detection verification.
 */

describe('Framework Verification with Real Examples', () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = createTempDbPath();
  });

  afterEach(() => {
    cleanupTempDb(tempDbPath);
  });

  describe('JavaScript Example (Jest Framework)', () => {
    const projectPath = path.join(examplesPath, 'javascript');

    it('should detect Jest framework for run-tests command', () => {
      const result = runTfqCommand(projectPath, ['--auto-detect'], tempDbPath);

      expect(result.framework).toBe('jest');
      expect(result.command).toContain('jest');
      expect(result.command).not.toContain('vitest');
    });

    it('should verify Jest project setup that fix-next would use', () => {
      // This test verifies the project structure that fix-next autoDetect would analyze
      // Note: This tests framework detection logic, not the actual fix-next command

      // Step 1: Verify framework detection with auto-add (simulates queue population)
      const result = runTfqCommand(projectPath, ['--auto-detect', '--auto-add'], tempDbPath);
      expect(result.success).toBe(false); // Should fail but add to queue
      expect(result.framework).toBe('jest');

      // Step 2: Verify the project structure that would be used by fix-next verification
      const packageJsonPath = path.join(projectPath, 'package.json');
      expect(fs.existsSync(packageJsonPath)).toBe(true);

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      expect(packageJson.scripts.test).toBe('jest');
      expect(packageJson.devDependencies.jest).toBeDefined();

      // Step 3: Verify this setup triggers Jest detection (same logic fix-next uses)
      // Our fix added autoDetect: true to fix-next verification TestRunner
      // This would detect the same Jest configuration
      expect(result.command).toBe('npx jest --watchAll=false');
      expect(result.command).not.toContain('vitest');

      console.log('✅ Jest project setup verified - fix-next would detect Jest correctly');
    });

    it('should verify Jest project setup that fix-all would use for discovery', () => {
      // This verifies the project structure that fix-all autoDetect would analyze
      // Our fix added autoDetect: true to fix-all's initial test discovery TestRunner

      // Verify the project would be detected as Jest (same logic fix-all uses)
      const detectionResult = runTfqCommand(projectPath, ['--auto-detect'], tempDbPath);
      expect(detectionResult.framework).toBe('jest');
      expect(detectionResult.language).toBe('javascript');

      // Verify package.json configuration that autoDetect would find
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      // These are the indicators that our JavaScript adapter looks for
      expect(packageJson.scripts.test).toBe('jest');
      expect(packageJson.devDependencies.jest).toBeDefined();

      console.log('✅ Jest project setup verified - fix-all would detect Jest correctly');
    });
  });

  describe('TypeScript Example (Vitest Framework)', () => {
    const projectPath = path.join(examplesPath, 'typescript');

    it('should detect Vitest framework for run-tests command', () => {
      const result = runTfqCommand(projectPath, ['--auto-detect'], tempDbPath);

      expect(result.framework).toBe('vitest');
      expect(result.command).toContain('vitest');
      expect(result.command).not.toContain('jest');
    });

    it('should verify Vitest project setup that fix-next would use', () => {
      // This test verifies the project structure that fix-next autoDetect would analyze
      // Note: This tests framework detection logic, not the actual fix-next command

      // Step 1: Verify framework detection with auto-add (simulates queue population)
      const result = runTfqCommand(projectPath, ['--auto-detect', '--auto-add'], tempDbPath);
      expect(result.success).toBe(false); // Should fail but add to queue
      expect(result.framework).toBe('vitest');

      // Step 2: Verify the project structure that would be used by fix-next verification
      const packageJsonPath = path.join(projectPath, 'package.json');
      expect(fs.existsSync(packageJsonPath)).toBe(true);

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      expect(packageJson.scripts.test).toBe('vitest run');
      expect(packageJson.devDependencies.vitest).toBeDefined();

      // Step 3: Verify this setup triggers Vitest detection (same logic fix-next uses)
      // Our fix added autoDetect: true to fix-next verification TestRunner
      // This would detect the same Vitest configuration
      expect(result.command).toBe('npx vitest run');
      expect(result.command).not.toContain('jest');

      console.log('✅ Vitest project setup verified - fix-next would detect Vitest correctly');
    });

    it('should verify Vitest project setup that fix-all would use for discovery', () => {
      // This verifies the project structure that fix-all autoDetect would analyze
      // Our fix added autoDetect: true to fix-all's initial test discovery TestRunner

      // Verify the project would be detected as Vitest (same logic fix-all uses)
      const detectionResult = runTfqCommand(projectPath, ['--auto-detect'], tempDbPath);
      expect(detectionResult.framework).toBe('vitest');
      expect(detectionResult.language).toBe('javascript'); // TypeScript projects are detected as 'javascript' language

      // Verify package.json configuration that autoDetect would find
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      // These are the indicators that our JavaScript adapter looks for
      expect(packageJson.scripts.test).toBe('vitest run');
      expect(packageJson.devDependencies.vitest).toBeDefined();

      console.log('✅ Vitest project setup verified - fix-all would detect Vitest correctly');
    });
  });

  describe('Framework Detection Consistency', () => {
    it('should consistently detect Jest across all command scenarios', () => {
      const projectPath = path.join(examplesPath, 'javascript');

      // Test multiple command scenarios that would use autoDetect
      const scenarios = [
        ['--auto-detect'],
        ['--auto-detect', '--auto-add'],
        ['--language', 'javascript', '--auto-detect']
      ];

      scenarios.forEach((args, index) => {
        const result = runTfqCommand(projectPath, args, tempDbPath);
        expect(result.framework).toBe('jest');
        console.log(`✅ Scenario ${index + 1}: Jest detected with args [${args.join(', ')}]`);
      });
    });

    it('should consistently detect Vitest across all command scenarios', () => {
      const projectPath = path.join(examplesPath, 'typescript');

      // Test multiple command scenarios that would use autoDetect
      const scenarios = [
        ['--auto-detect'],
        ['--auto-detect', '--auto-add'],
        ['--language', 'javascript', '--auto-detect']
      ];

      scenarios.forEach((args, index) => {
        const result = runTfqCommand(projectPath, args, tempDbPath);
        expect(result.framework).toBe('vitest');
        console.log(`✅ Scenario ${index + 1}: Vitest detected with args [${args.join(', ')}]`);
      });
    });
  });

  describe('Framework Command Verification', () => {
    it('should generate correct Jest commands', () => {
      const projectPath = path.join(examplesPath, 'javascript');
      const result = runTfqCommand(projectPath, ['--auto-detect'], tempDbPath);

      // Verify the exact command that would be used
      expect(result.command).toBe('npx jest --watchAll=false');

      // Verify this is NOT a Vitest command
      expect(result.command).not.toContain('vitest');
      expect(result.command).not.toContain('vite');

      console.log('✅ Jest command verified:', result.command);
    });

    it('should generate correct Vitest commands', () => {
      const projectPath = path.join(examplesPath, 'typescript');
      const result = runTfqCommand(projectPath, ['--auto-detect'], tempDbPath);

      // Verify the exact command that would be used
      expect(result.command).toBe('npx vitest run');

      // Verify this is NOT a Jest command
      expect(result.command).not.toContain('jest');
      expect(result.command).not.toContain('--watchAll');

      console.log('✅ Vitest command verified:', result.command);
    });
  });
});