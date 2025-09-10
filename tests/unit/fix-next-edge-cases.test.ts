import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestFailureQueue } from '../../src/core/queue.js';
import { TestRunner } from '../../src/core/test-runner.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

vi.mock('child_process');

describe('Fix-Next Verification Edge Cases', () => {
  let queue: TestFailureQueue;
  const testDbPath = path.join(__dirname, '../test-edge-cases.db');

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    queue = new TestFailureQueue({
      databasePath: testDbPath,
      maxRetries: 3
    });
  });

  afterEach(() => {
    queue.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Error Context Management', () => {
    it('should preserve original error context when re-enqueueing', () => {
      const originalError = 'Original test failure: AssertionError';
      const verificationError = 'Verification failed: still failing after fix';
      const testPath = '/path/to/test.js';
      
      // Add test with original error
      queue.enqueue(testPath, 1, originalError);
      
      // Simulate dequeue and re-enqueue with verification error
      const item = queue.dequeueWithContext();
      expect(item?.error).toBe(originalError);
      expect(item?.failureCount).toBe(1);
      
      // Re-enqueue with combined error context (simulating fix-next behavior)
      const combinedError = `Previous attempt: ${originalError}\nVerification failed: ${verificationError}`;
      queue.enqueue(testPath, item!.priority, combinedError);
      
      // Check that error context is properly combined
      const readdedItem = queue.dequeueWithContext();
      expect(readdedItem?.error).toContain(originalError);
      expect(readdedItem?.error).toContain(verificationError);
      // After dequeue-requeue, it starts fresh at failure count 1
      expect(readdedItem?.failureCount).toBe(1);
    });

    it('should handle empty or undefined error contexts gracefully', () => {
      // Add test without error context
      queue.enqueue('/path/to/test.js', 0);
      
      const item = queue.dequeueWithContext();
      expect(item?.error).toBeUndefined();
      
      // Re-enqueue with new error context
      queue.enqueue(item!.filePath, 0, 'New verification error');
      
      const readdedItem = queue.dequeueWithContext();
      expect(readdedItem?.error).toBe('New verification error');
    });

    it('should track failure count progression correctly', () => {
      const testPath = '/path/to/failing/test.js';
      
      // Add same test multiple times to simulate retries (without dequeuing)
      queue.enqueue(testPath, 1, 'Initial failure');
      queue.enqueue(testPath, 1, 'First retry failed'); // Should increment failure count
      queue.enqueue(testPath, 1, 'Second retry failed'); // Should increment again
      
      // Now dequeue and check the accumulated failure count
      const item = queue.dequeueWithContext();
      expect(item?.failureCount).toBe(3);
      expect(item?.error).toBe('Second retry failed'); // Should have latest error
    });
  });

  describe('Framework Detection Edge Cases', () => {
    it('should handle test files outside of typical test directories', () => {
      const runner = new TestRunner({
        testPath: '/random/path/some.test.js',
        language: 'javascript',
        framework: 'jest'
      });
      
      // Should work with absolute paths regardless of location
      expect(runner['command']).toBe('npx jest --watchAll=false /random/path/some.test.js');
    });
  });

  describe('Retry Logic Edge Cases', () => {
    it('should stop retrying when max retries reached', () => {
      const testPath = '/path/to/persistent/failure.js';
      const maxRetries = 2;
      
      // Configure queue with low max retries
      const limitedQueue = new TestFailureQueue({
        databasePath: testDbPath,
        maxRetries
      });
      
      // Add test with initial failure
      limitedQueue.enqueue(testPath, 1, 'Initial failure');
      
      // Add again to simulate first retry (failure count becomes 2)
      limitedQueue.enqueue(testPath, 1, 'First retry failed');
      
      // Check that failure count is 2
      const item = limitedQueue.dequeueWithContext();
      expect(item?.failureCount).toBe(2);
      
      // Queue should be empty now
      expect(limitedQueue.size()).toBe(0);
      
      limitedQueue.close();
    });

    it('should handle priority changes during retry cycles', () => {
      const testPath = '/path/to/test.js';
      
      // Add with low priority
      queue.enqueue(testPath, 1, 'Initial low priority failure');
      
      // Add again with higher priority (should keep higher priority and increment count)
      queue.enqueue(testPath, 10, 'High priority retry');
      
      const item = queue.dequeueWithContext();
      expect(item?.priority).toBe(10); // Should use higher priority
      expect(item?.failureCount).toBe(2); // Should track failure count
    });
  });

  describe('Concurrent Access Edge Cases', () => {
    it('should handle concurrent dequeue operations safely', () => {
      // Add multiple tests
      queue.enqueue('/path/to/test1.js', 1);
      queue.enqueue('/path/to/test2.js', 2);
      queue.enqueue('/path/to/test3.js', 3);
      
      expect(queue.size()).toBe(3);
      
      // Simulate concurrent dequeues (this tests database transaction safety)
      const item1 = queue.dequeueWithContext();
      const item2 = queue.dequeueWithContext();
      const item3 = queue.dequeueWithContext();
      const item4 = queue.dequeueWithContext(); // Should be null
      
      expect(item1?.filePath).toBe('/path/to/test3.js'); // Highest priority
      expect(item2?.filePath).toBe('/path/to/test2.js');
      expect(item3?.filePath).toBe('/path/to/test1.js');
      expect(item4).toBeNull();
      expect(queue.size()).toBe(0);
    });
  });
});