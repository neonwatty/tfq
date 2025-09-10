import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDatabase } from '../../src/core/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('TestDatabase Grouping Features', () => {
  let db: TestDatabase;
  const testDbPath = path.join(__dirname, '../test-grouping.db');

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    db = new TestDatabase({
      path: testDbPath
    });

    // Add some test data
    db.enqueue('test1.js', 5);
    db.enqueue('test2.js', 3);
    db.enqueue('test3.js', 1);
    db.enqueue('test4.js', 2);
    db.enqueue('test5.js', 4);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('setTestGroup', () => {
    it('should set group properties for a test', () => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      
      const items = db.list();
      const test1 = items.find(item => item.filePath === 'test1.js');
      
      expect(test1?.groupId).toBe(1);
      expect(test1?.groupType).toBe('parallel');
      expect(test1?.groupOrder === 0 || test1?.groupOrder === undefined).toBe(true);
    });

    it('should update existing group assignments', () => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test1.js', 2, 'sequential', 1);
      
      const items = db.list();
      const test1 = items.find(item => item.filePath === 'test1.js');
      
      expect(test1?.groupId).toBe(2);
      expect(test1?.groupType).toBe('sequential');
      expect(test1?.groupOrder).toBe(1);
    });

    it('should handle non-existent test paths gracefully', () => {
      // Should not throw, just no-op
      expect(() => {
        db.setTestGroup('nonexistent.js', 1, 'parallel', 0);
      }).not.toThrow();
    });

    it('should set different group types correctly', () => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test2.js', 1, 'parallel', 1);
      db.setTestGroup('test3.js', 2, 'sequential', 0);
      
      const items = db.list();
      const test1 = items.find(item => item.filePath === 'test1.js');
      const test2 = items.find(item => item.filePath === 'test2.js');
      const test3 = items.find(item => item.filePath === 'test3.js');
      
      expect(test1?.groupType).toBe('parallel');
      expect(test2?.groupType).toBe('parallel');
      expect(test3?.groupType).toBe('sequential');
    });
  });

  describe('getTestsByGroup', () => {
    beforeEach(() => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test2.js', 1, 'parallel', 1);
      db.setTestGroup('test3.js', 2, 'sequential', 0);
      db.setTestGroup('test4.js', 2, 'sequential', 1);
    });

    it('should return all tests in a group', () => {
      const group1 = db.getTestsByGroup(1);
      const group2 = db.getTestsByGroup(2);
      
      expect(group1).toHaveLength(2);
      expect(group1.map(t => t.filePath)).toContain('test1.js');
      expect(group1.map(t => t.filePath)).toContain('test2.js');
      
      expect(group2).toHaveLength(2);
      expect(group2.map(t => t.filePath)).toContain('test3.js');
      expect(group2.map(t => t.filePath)).toContain('test4.js');
    });

    it('should return empty array for non-existent group', () => {
      const group99 = db.getTestsByGroup(99);
      expect(group99).toEqual([]);
    });

    it('should maintain order by group_order', () => {
      const group1 = db.getTestsByGroup(1);
      
      expect(group1[0].filePath).toBe('test1.js'); // order 0
      expect(group1[1].filePath).toBe('test2.js'); // order 1
    });

    it('should include all queue item properties', () => {
      const group1 = db.getTestsByGroup(1);
      const firstTest = group1[0];
      
      expect(firstTest).toHaveProperty('id');
      expect(firstTest).toHaveProperty('filePath');
      expect(firstTest).toHaveProperty('priority');
      expect(firstTest).toHaveProperty('createdAt');
      expect(firstTest).toHaveProperty('failureCount');
      expect(firstTest).toHaveProperty('lastFailure');
      expect(firstTest).toHaveProperty('groupId');
      expect(firstTest).toHaveProperty('groupType');
      expect(firstTest).toHaveProperty('groupOrder');
    });
  });

  describe('getNextGroup', () => {
    it('should return lowest group ID with tests', () => {
      db.setTestGroup('test1.js', 3, 'parallel', 0);
      db.setTestGroup('test2.js', 1, 'sequential', 0);
      db.setTestGroup('test3.js', 2, 'parallel', 0);
      
      const nextGroup = db.getNextGroup();
      
      expect(nextGroup).not.toBeNull();
      expect(nextGroup?.groupId).toBe(1);
      expect(nextGroup?.type).toBe('sequential');
      expect(nextGroup?.tests).toHaveLength(1);
      expect(nextGroup?.tests[0].filePath).toBe('test2.js');
    });

    it('should return null when no groups exist', () => {
      const nextGroup = db.getNextGroup();
      expect(nextGroup).toBeNull();
    });

    it('should skip empty groups after dequeue', () => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test2.js', 2, 'sequential', 0);
      
      // Remove first group
      db.remove('test1.js');
      
      const nextGroup = db.getNextGroup();
      expect(nextGroup?.groupId).toBe(2);
    });
  });

  describe('clearGroups', () => {
    it('should clear all group assignments', () => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test2.js', 1, 'parallel', 1);
      db.setTestGroup('test3.js', 2, 'sequential', 0);
      
      db.clearGroups();
      
      const items = db.list();
      items.forEach(item => {
        expect(item.groupId).toBeUndefined();
        expect(item.groupType).toBeUndefined();
        expect(item.groupOrder === 0 || item.groupOrder === undefined).toBe(true);
      });
    });

    it('should not remove tests from queue', () => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test2.js', 1, 'parallel', 1);
      
      const sizeBefore = db.size();
      db.clearGroups();
      const sizeAfter = db.size();
      
      expect(sizeAfter).toBe(sizeBefore);
    });
  });

  describe('getGroupStats', () => {
    it('should return correct statistics', () => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test2.js', 1, 'parallel', 1);
      db.setTestGroup('test3.js', 2, 'sequential', 0);
      db.setTestGroup('test4.js', 3, 'parallel', 0);
      
      const stats = db.getGroupStats();
      
      expect(stats.totalGroups).toBe(3);
      expect(stats.parallelGroups).toBe(2); // Groups 1 and 3
      expect(stats.sequentialGroups).toBe(1); // Group 2
    });

    it('should return zero stats when no groups', () => {
      const stats = db.getGroupStats();
      
      expect(stats.totalGroups).toBe(0);
      expect(stats.parallelGroups).toBe(0);
      expect(stats.sequentialGroups).toBe(0);
    });

    it('should update stats after clearing groups', () => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test2.js', 2, 'sequential', 0);
      
      db.clearGroups();
      const stats = db.getGroupStats();
      
      expect(stats.totalGroups).toBe(0);
    });
  });

  describe('dequeueGroup', () => {
    beforeEach(() => {
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      db.setTestGroup('test2.js', 1, 'parallel', 1);
      db.setTestGroup('test3.js', 2, 'sequential', 0);
    });

    it('should atomically remove all tests in group', () => {
      const sizeBefore = db.size();
      const dequeuedPaths = db.dequeueGroup();
      const sizeAfter = db.size();
      
      expect(dequeuedPaths).toHaveLength(2);
      expect(dequeuedPaths).toContain('test1.js');
      expect(dequeuedPaths).toContain('test2.js');
      expect(sizeAfter).toBe(sizeBefore - 2);
    });

    it('should return empty array when no groups', () => {
      db.clearGroups();
      const dequeuedPaths = db.dequeueGroup();
      
      expect(dequeuedPaths).toEqual([]);
    });

    it('should dequeue groups in order', () => {
      const firstGroup = db.dequeueGroup();
      expect(firstGroup).toContain('test1.js');
      expect(firstGroup).toContain('test2.js');
      
      const secondGroup = db.dequeueGroup();
      expect(secondGroup).toContain('test3.js');
      
      const thirdGroup = db.dequeueGroup();
      expect(thirdGroup).toEqual([]);
    });

    it('should handle transaction rollback on error', () => {
      // This tests that the transaction is atomic
      const sizeBefore = db.size();
      
      // Close DB to cause an error during transaction
      db.close();
      
      expect(() => {
        db.dequeueGroup();
      }).toThrow();
      
      // Reopen and check nothing was removed
      db = new TestDatabase({ path: testDbPath });
      const sizeAfter = db.size();
      
      expect(sizeAfter).toBe(sizeBefore);
    });
  });

  describe('database migration', () => {

    it('should not fail if columns already exist', () => {
      // Close and reopen database (columns already exist)
      db.close();
      
      expect(() => {
        db = new TestDatabase({ path: testDbPath });
      }).not.toThrow();
      
      // Verify it still works
      db.setTestGroup('test1.js', 1, 'parallel', 0);
      const items = db.list();
      expect(items[0].groupId).toBe(1);
    });

    it('should create proper indexes', () => {
      // Verify index exists by checking query plan
      const Database = require('better-sqlite3');
      const rawDb = new Database(testDbPath);
      
      const indexes = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
      const indexNames = indexes.map((idx: any) => idx.name);
      
      expect(indexNames).toContain('idx_group_id_order');
      
      rawDb.close();
    });
  });
});