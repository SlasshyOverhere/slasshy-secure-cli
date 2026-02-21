/**
 * Audit Log Tests
 *
 * Tests for the security audit logging system.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Audit event types
type AuditEventType =
  | 'vault_unlock'
  | 'vault_lock'
  | 'entry_access'
  | 'entry_create'
  | 'entry_update'
  | 'entry_delete'
  | 'auth_success'
  | 'auth_failure'
  | 'sync_start'
  | 'sync_complete'
  | 'export'
  | 'import';

interface AuditEntry {
  timestamp: number;
  event: AuditEventType;
  entryId?: string;
  entryTitle?: string;
  details?: string;
  success: boolean;
  ipAddress?: string;
}

// Audit log implementation for testing
class AuditLog {
  private entries: AuditEntry[] = [];
  private maxEntries: number = 10000;

  log(event: AuditEventType, options: Partial<Omit<AuditEntry, 'timestamp' | 'event'>> = {}): void {
    const entry: AuditEntry = {
      timestamp: Date.now(),
      event,
      success: options.success ?? true,
      ...options,
    };

    this.entries.push(entry);

    // Trim to max size
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  getEntries(count?: number): AuditEntry[] {
    if (count) {
      return this.entries.slice(-count);
    }
    return [...this.entries];
  }

  getEntriesByEvent(event: AuditEventType): AuditEntry[] {
    return this.entries.filter(e => e.event === event);
  }

  getEntriesByEntryId(entryId: string): AuditEntry[] {
    return this.entries.filter(e => e.entryId === entryId);
  }

  getEntriesInRange(start: number, end: number): AuditEntry[] {
    return this.entries.filter(e => e.timestamp >= start && e.timestamp <= end);
  }

  getFailedEvents(): AuditEntry[] {
    return this.entries.filter(e => !e.success);
  }

  clear(): void {
    this.entries = [];
  }

  getStats(): {
    total: number;
    byEvent: Record<AuditEventType, number>;
    failures: number;
  } {
    const byEvent: Partial<Record<AuditEventType, number>> = {};
    let failures = 0;

    for (const entry of this.entries) {
      byEvent[entry.event] = (byEvent[entry.event] || 0) + 1;
      if (!entry.success) failures++;
    }

    return {
      total: this.entries.length,
      byEvent: byEvent as Record<AuditEventType, number>,
      failures,
    };
  }

  setMaxEntries(max: number): void {
    this.maxEntries = max;
    if (this.entries.length > max) {
      this.entries = this.entries.slice(-max);
    }
  }
}

describe('Audit Log', () => {
  let auditLog: AuditLog;

  beforeEach(() => {
    auditLog = new AuditLog();
  });

  describe('log', () => {
    it('should log events with timestamp', () => {
      const before = Date.now();
      auditLog.log('vault_unlock');
      const after = Date.now();

      const entries = auditLog.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.timestamp).toBeGreaterThanOrEqual(before);
      expect(entries[0]!.timestamp).toBeLessThanOrEqual(after);
    });

    it('should log event type correctly', () => {
      auditLog.log('entry_create');
      const entries = auditLog.getEntries();
      expect(entries[0]!.event).toBe('entry_create');
    });

    it('should default success to true', () => {
      auditLog.log('vault_unlock');
      const entries = auditLog.getEntries();
      expect(entries[0]!.success).toBe(true);
    });

    it('should log failed events', () => {
      auditLog.log('auth_failure', { success: false });
      const entries = auditLog.getEntries();
      expect(entries[0]!.success).toBe(false);
    });

    it('should log entry details', () => {
      auditLog.log('entry_access', {
        entryId: '123',
        entryTitle: 'Test Entry',
        details: 'Viewed password',
      });

      const entries = auditLog.getEntries();
      expect(entries[0]!.entryId).toBe('123');
      expect(entries[0]!.entryTitle).toBe('Test Entry');
      expect(entries[0]!.details).toBe('Viewed password');
    });

    it('should respect max entries limit', () => {
      auditLog.setMaxEntries(5);

      for (let i = 0; i < 10; i++) {
        auditLog.log('entry_access', { details: `Event ${i}` });
      }

      const entries = auditLog.getEntries();
      expect(entries).toHaveLength(5);
      expect(entries[0]!.details).toBe('Event 5');
      expect(entries[4]!.details).toBe('Event 9');
    });
  });

  describe('getEntries', () => {
    beforeEach(() => {
      auditLog.log('vault_unlock');
      auditLog.log('entry_access');
      auditLog.log('entry_create');
      auditLog.log('vault_lock');
    });

    it('should return all entries', () => {
      const entries = auditLog.getEntries();
      expect(entries).toHaveLength(4);
    });

    it('should return limited entries', () => {
      const entries = auditLog.getEntries(2);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.event).toBe('entry_create');
      expect(entries[1]!.event).toBe('vault_lock');
    });

    it('should return copy of entries', () => {
      const entries = auditLog.getEntries();
      entries.push({ timestamp: 0, event: 'vault_unlock', success: true });
      expect(auditLog.getEntries()).toHaveLength(4);
    });
  });

  describe('getEntriesByEvent', () => {
    beforeEach(() => {
      auditLog.log('vault_unlock');
      auditLog.log('entry_access');
      auditLog.log('entry_access');
      auditLog.log('vault_lock');
    });

    it('should filter by event type', () => {
      const entries = auditLog.getEntriesByEvent('entry_access');
      expect(entries).toHaveLength(2);
    });

    it('should return empty for no matches', () => {
      const entries = auditLog.getEntriesByEvent('auth_failure');
      expect(entries).toHaveLength(0);
    });
  });

  describe('getEntriesByEntryId', () => {
    beforeEach(() => {
      auditLog.log('entry_access', { entryId: '123' });
      auditLog.log('entry_update', { entryId: '123' });
      auditLog.log('entry_access', { entryId: '456' });
    });

    it('should filter by entry ID', () => {
      const entries = auditLog.getEntriesByEntryId('123');
      expect(entries).toHaveLength(2);
    });

    it('should return empty for non-existent ID', () => {
      const entries = auditLog.getEntriesByEntryId('999');
      expect(entries).toHaveLength(0);
    });
  });

  describe('getEntriesInRange', () => {
    it('should filter by time range', () => {
      const now = Date.now();
      auditLog.log('vault_unlock');

      const entries = auditLog.getEntriesInRange(now - 1000, now + 1000);
      expect(entries).toHaveLength(1);
    });

    it('should exclude entries outside range', () => {
      auditLog.log('vault_unlock');

      const futureStart = Date.now() + 10000;
      const entries = auditLog.getEntriesInRange(futureStart, futureStart + 1000);
      expect(entries).toHaveLength(0);
    });
  });

  describe('getFailedEvents', () => {
    beforeEach(() => {
      auditLog.log('vault_unlock', { success: true });
      auditLog.log('auth_failure', { success: false });
      auditLog.log('sync_complete', { success: false, details: 'Network error' });
    });

    it('should return only failed events', () => {
      const failed = auditLog.getFailedEvents();
      expect(failed).toHaveLength(2);
    });

    it('should include failure details', () => {
      const failed = auditLog.getFailedEvents();
      const syncFailure = failed.find(e => e.event === 'sync_complete');
      expect(syncFailure?.details).toBe('Network error');
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      auditLog.log('vault_unlock');
      auditLog.log('entry_access');
      auditLog.log('entry_access');
      auditLog.log('auth_failure', { success: false });
    });

    it('should return total count', () => {
      const stats = auditLog.getStats();
      expect(stats.total).toBe(4);
    });

    it('should count by event type', () => {
      const stats = auditLog.getStats();
      expect(stats.byEvent.entry_access).toBe(2);
      expect(stats.byEvent.vault_unlock).toBe(1);
    });

    it('should count failures', () => {
      const stats = auditLog.getStats();
      expect(stats.failures).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      auditLog.log('vault_unlock');
      auditLog.log('entry_access');
      auditLog.clear();
      expect(auditLog.getEntries()).toHaveLength(0);
    });
  });

  describe('Event Type Coverage', () => {
    const allEvents: AuditEventType[] = [
      'vault_unlock',
      'vault_lock',
      'entry_access',
      'entry_create',
      'entry_update',
      'entry_delete',
      'auth_success',
      'auth_failure',
      'sync_start',
      'sync_complete',
      'export',
      'import',
    ];

    it('should handle all event types', () => {
      for (const event of allEvents) {
        auditLog.log(event);
      }

      const entries = auditLog.getEntries();
      expect(entries).toHaveLength(allEvents.length);

      for (const event of allEvents) {
        expect(entries.some(e => e.event === event)).toBe(true);
      }
    });
  });
});

describe('Favorites System', () => {
  interface Entry {
    id: string;
    title: string;
    favorite: boolean;
  }

  let entries: Entry[] = [];

  function toggleFavorite(entryId: string): boolean | null {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return null;

    entry.favorite = !entry.favorite;
    return entry.favorite;
  }

  function getFavorites(): Entry[] {
    return entries.filter(e => e.favorite);
  }

  function sortByFavorite(list: Entry[]): Entry[] {
    return [...list].sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return 0;
    });
  }

  beforeEach(() => {
    entries = [
      { id: '1', title: 'Entry 1', favorite: false },
      { id: '2', title: 'Entry 2', favorite: true },
      { id: '3', title: 'Entry 3', favorite: false },
      { id: '4', title: 'Entry 4', favorite: true },
    ];
  });

  describe('toggleFavorite', () => {
    it('should toggle favorite on', () => {
      const result = toggleFavorite('1');
      expect(result).toBe(true);
      expect(entries.find(e => e.id === '1')?.favorite).toBe(true);
    });

    it('should toggle favorite off', () => {
      const result = toggleFavorite('2');
      expect(result).toBe(false);
      expect(entries.find(e => e.id === '2')?.favorite).toBe(false);
    });

    it('should return null for non-existent entry', () => {
      const result = toggleFavorite('999');
      expect(result).toBeNull();
    });
  });

  describe('getFavorites', () => {
    it('should return only favorites', () => {
      const favorites = getFavorites();
      expect(favorites).toHaveLength(2);
      expect(favorites.every(e => e.favorite)).toBe(true);
    });

    it('should return empty array when no favorites', () => {
      entries.forEach(e => e.favorite = false);
      const favorites = getFavorites();
      expect(favorites).toHaveLength(0);
    });
  });

  describe('sortByFavorite', () => {
    it('should put favorites first', () => {
      const sorted = sortByFavorite(entries);
      expect(sorted[0]!.favorite).toBe(true);
      expect(sorted[1]!.favorite).toBe(true);
      expect(sorted[2]!.favorite).toBe(false);
      expect(sorted[3]!.favorite).toBe(false);
    });

    it('should not modify original array', () => {
      const original = [...entries];
      sortByFavorite(entries);
      expect(entries).toEqual(original);
    });

    it('should handle all favorites', () => {
      entries.forEach(e => e.favorite = true);
      const sorted = sortByFavorite(entries);
      expect(sorted).toHaveLength(4);
    });

    it('should handle no favorites', () => {
      entries.forEach(e => e.favorite = false);
      const sorted = sortByFavorite(entries);
      expect(sorted).toHaveLength(4);
    });
  });
});

describe('Categories System', () => {
  interface Entry {
    id: string;
    title: string;
    category?: string;
  }

  let entries: Entry[] = [];

  function setCategory(entryId: string, category: string | undefined): boolean {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return false;

    entry.category = category;
    return true;
  }

  function getByCategory(category: string): Entry[] {
    return entries.filter(e => e.category === category);
  }

  function getCategories(): string[] {
    const categories = new Set<string>();
    for (const entry of entries) {
      if (entry.category) {
        categories.add(entry.category);
      }
    }
    return Array.from(categories).sort();
  }

  function getUncategorized(): Entry[] {
    return entries.filter(e => !e.category);
  }

  beforeEach(() => {
    entries = [
      { id: '1', title: 'Work Email', category: 'work' },
      { id: '2', title: 'Personal Email', category: 'personal' },
      { id: '3', title: 'GitHub', category: 'work' },
      { id: '4', title: 'Random Site' },
    ];
  });

  describe('setCategory', () => {
    it('should set category', () => {
      const result = setCategory('4', 'misc');
      expect(result).toBe(true);
      expect(entries.find(e => e.id === '4')?.category).toBe('misc');
    });

    it('should clear category', () => {
      const result = setCategory('1', undefined);
      expect(result).toBe(true);
      expect(entries.find(e => e.id === '1')?.category).toBeUndefined();
    });

    it('should return false for non-existent entry', () => {
      const result = setCategory('999', 'test');
      expect(result).toBe(false);
    });
  });

  describe('getByCategory', () => {
    it('should filter by category', () => {
      const work = getByCategory('work');
      expect(work).toHaveLength(2);
    });

    it('should return empty for non-existent category', () => {
      const result = getByCategory('nonexistent');
      expect(result).toHaveLength(0);
    });
  });

  describe('getCategories', () => {
    it('should return unique categories', () => {
      const categories = getCategories();
      expect(categories).toEqual(['personal', 'work']);
    });

    it('should return empty for no categories', () => {
      entries.forEach(e => delete e.category);
      const categories = getCategories();
      expect(categories).toHaveLength(0);
    });
  });

  describe('getUncategorized', () => {
    it('should return entries without category', () => {
      const uncategorized = getUncategorized();
      expect(uncategorized).toHaveLength(1);
      expect(uncategorized[0]!.title).toBe('Random Site');
    });
  });
});
