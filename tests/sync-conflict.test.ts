/**
 * Sync Conflict Resolution Tests
 *
 * Tests for detecting and resolving sync conflicts between local and remote data.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// Conflict types
type ConflictType =
  | 'modified_both'
  | 'deleted_local'
  | 'deleted_remote'
  | 'created_both'
  | 'schema_mismatch';

type ResolutionStrategy =
  | 'keep_local'
  | 'keep_remote'
  | 'keep_newest'
  | 'keep_both'
  | 'merge'
  | 'skip'
  | 'delete';

interface Entry {
  id: string;
  title: string;
  username?: string;
  password?: string;
  modified: number;
}

interface SyncConflict {
  id: string;
  entryTitle: string;
  type: ConflictType;
  localEntry?: Entry;
  remoteEntry?: Entry;
  localModified: number;
  remoteModified: number;
}

interface SyncState {
  entryVersions: Record<string, {
    localVersion: number;
    remoteVersion: number;
    lastSyncedAt: number;
    checksum: string;
  }>;
  lastFullSync: number;
}

interface ConflictResolution {
  conflict: SyncConflict;
  strategy: ResolutionStrategy;
  resolvedEntry?: Entry;
  timestamp: number;
}

// Calculate checksum for change detection
function calculateChecksum(entry: Entry): string {
  const content = JSON.stringify({
    title: entry.title,
    username: entry.username,
    password: entry.password,
    modified: entry.modified,
  });
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// Detect conflicts between local and remote entries
function detectConflicts(
  localEntries: Record<string, Entry>,
  remoteEntries: Record<string, Entry>,
  syncState: SyncState
): SyncConflict[] {
  const conflicts: SyncConflict[] = [];
  const processedIds = new Set<string>();

  // Check local entries against remote
  for (const [id, local] of Object.entries(localEntries)) {
    processedIds.add(id);
    const remote = remoteEntries[id];
    const versionInfo = syncState.entryVersions[id];

    if (!remote) {
      // Check if deleted remotely after last sync
      if (versionInfo && versionInfo.remoteVersion > 0) {
        if (local.modified > versionInfo.lastSyncedAt) {
          conflicts.push({
            id,
            entryTitle: local.title,
            type: 'deleted_remote',
            localEntry: local,
            localModified: local.modified,
            remoteModified: versionInfo.lastSyncedAt,
          });
        }
      }
      continue;
    }

    // Both exist - check for modifications
    const localChecksum = calculateChecksum(local);
    const remoteChecksum = calculateChecksum(remote);

    if (localChecksum === remoteChecksum) {
      continue; // No conflict
    }

    const lastSyncedAt = versionInfo?.lastSyncedAt || 0;

    if (local.modified > lastSyncedAt && remote.modified > lastSyncedAt) {
      conflicts.push({
        id,
        entryTitle: local.title,
        type: 'modified_both',
        localEntry: local,
        remoteEntry: remote,
        localModified: local.modified,
        remoteModified: remote.modified,
      });
    }
  }

  // Check for remotely deleted entries
  for (const [id, remote] of Object.entries(remoteEntries)) {
    if (processedIds.has(id)) continue;

    const versionInfo = syncState.entryVersions[id];

    if (versionInfo && versionInfo.localVersion > 0) {
      if (remote.modified > versionInfo.lastSyncedAt) {
        conflicts.push({
          id,
          entryTitle: remote.title,
          type: 'deleted_local',
          remoteEntry: remote,
          localModified: versionInfo.lastSyncedAt,
          remoteModified: remote.modified,
        });
      }
    }
  }

  return conflicts;
}

// Resolve conflict based on strategy
function resolveConflict(
  conflict: SyncConflict,
  strategy: ResolutionStrategy
): ConflictResolution {
  let resolvedEntry: Entry | undefined;

  switch (strategy) {
    case 'keep_local':
      resolvedEntry = conflict.localEntry;
      break;
    case 'keep_remote':
      resolvedEntry = conflict.remoteEntry;
      break;
    case 'keep_newest':
      resolvedEntry = conflict.localModified >= conflict.remoteModified
        ? conflict.localEntry
        : conflict.remoteEntry;
      break;
    case 'keep_both':
      if (conflict.remoteEntry) {
        resolvedEntry = {
          ...conflict.remoteEntry,
          id: crypto.randomUUID(),
          title: `${conflict.remoteEntry.title} (from cloud)`,
          modified: Date.now(),
        };
      }
      break;
    case 'merge':
    case 'delete':
    case 'skip':
      // No resolved entry for these strategies
      break;
  }

  return {
    conflict,
    strategy,
    resolvedEntry,
    timestamp: Date.now(),
  };
}

// Merge two entries field by field
function mergeEntries(
  local: Entry,
  remote: Entry,
  preferences: Record<string, 'local' | 'remote'>
): Entry {
  return {
    id: local.id,
    title: preferences.title === 'remote' ? remote.title : local.title,
    username: preferences.username === 'remote' ? remote.username : local.username,
    password: preferences.password === 'remote' ? remote.password : local.password,
    modified: Date.now(),
  };
}

describe('Sync Conflict Detection', () => {
  const createEntry = (id: string, title: string, modified: number): Entry => ({
    id,
    title,
    username: 'user@example.com',
    password: 'password123',
    modified,
  });

  const createSyncState = (entries: Record<string, { lastSyncedAt: number }>): SyncState => ({
    entryVersions: Object.fromEntries(
      Object.entries(entries).map(([id, { lastSyncedAt }]) => [
        id,
        { localVersion: 1, remoteVersion: 1, lastSyncedAt, checksum: '' },
      ])
    ),
    lastFullSync: Date.now() - 3600000,
  });

  describe('detectConflicts', () => {
    it('should detect no conflicts when entries are identical', () => {
      const now = Date.now();
      const entry = createEntry('1', 'Test', now);

      const local = { '1': entry };
      const remote = { '1': { ...entry } };
      const syncState = createSyncState({ '1': { lastSyncedAt: now } });

      const conflicts = detectConflicts(local, remote, syncState);
      expect(conflicts.length).toBe(0);
    });

    it('should detect modified_both conflict', () => {
      const lastSync = Date.now() - 3600000; // 1 hour ago
      const localEntry = createEntry('1', 'Test Local', Date.now() - 1800000);
      const remoteEntry = createEntry('1', 'Test Remote', Date.now() - 900000);

      const local = { '1': localEntry };
      const remote = { '1': remoteEntry };
      const syncState = createSyncState({ '1': { lastSyncedAt: lastSync } });

      const conflicts = detectConflicts(local, remote, syncState);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.type).toBe('modified_both');
    });

    it('should detect deleted_remote conflict', () => {
      const lastSync = Date.now() - 3600000;
      const localEntry = createEntry('1', 'Test', Date.now() - 1800000);

      const local = { '1': localEntry };
      const remote = {};
      const syncState = createSyncState({ '1': { lastSyncedAt: lastSync } });

      const conflicts = detectConflicts(local, remote, syncState);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.type).toBe('deleted_remote');
    });

    it('should detect deleted_local conflict', () => {
      const lastSync = Date.now() - 3600000;
      const remoteEntry = createEntry('1', 'Test', Date.now() - 1800000);

      const local = {};
      const remote = { '1': remoteEntry };
      const syncState = createSyncState({ '1': { lastSyncedAt: lastSync } });

      const conflicts = detectConflicts(local, remote, syncState);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.type).toBe('deleted_local');
    });

    it('should not conflict on new local entry', () => {
      const localEntry = createEntry('new', 'New Entry', Date.now());

      const local = { 'new': localEntry };
      const remote = {};
      const syncState: SyncState = { entryVersions: {}, lastFullSync: Date.now() };

      const conflicts = detectConflicts(local, remote, syncState);
      expect(conflicts.length).toBe(0);
    });

    it('should not conflict on new remote entry', () => {
      const remoteEntry = createEntry('new', 'New Entry', Date.now());

      const local = {};
      const remote = { 'new': remoteEntry };
      const syncState: SyncState = { entryVersions: {}, lastFullSync: Date.now() };

      const conflicts = detectConflicts(local, remote, syncState);
      expect(conflicts.length).toBe(0);
    });

    it('should handle multiple conflicts', () => {
      const lastSync = Date.now() - 3600000;

      const local = {
        '1': createEntry('1', 'Entry 1 Local', Date.now() - 1000),
        '2': createEntry('2', 'Entry 2 Local', Date.now() - 2000),
      };

      const remote = {
        '1': createEntry('1', 'Entry 1 Remote', Date.now() - 500),
        '2': createEntry('2', 'Entry 2 Remote', Date.now() - 1500),
      };

      const syncState = createSyncState({
        '1': { lastSyncedAt: lastSync },
        '2': { lastSyncedAt: lastSync },
      });

      const conflicts = detectConflicts(local, remote, syncState);
      expect(conflicts.length).toBe(2);
    });
  });

  describe('resolveConflict', () => {
    const localEntry = createEntry('1', 'Local Entry', Date.now() - 1000);
    const remoteEntry = createEntry('1', 'Remote Entry', Date.now() - 500);

    const conflict: SyncConflict = {
      id: '1',
      entryTitle: 'Test Entry',
      type: 'modified_both',
      localEntry,
      remoteEntry,
      localModified: localEntry.modified,
      remoteModified: remoteEntry.modified,
    };

    it('should resolve with keep_local strategy', () => {
      const resolution = resolveConflict(conflict, 'keep_local');
      expect(resolution.strategy).toBe('keep_local');
      expect(resolution.resolvedEntry).toBe(localEntry);
    });

    it('should resolve with keep_remote strategy', () => {
      const resolution = resolveConflict(conflict, 'keep_remote');
      expect(resolution.strategy).toBe('keep_remote');
      expect(resolution.resolvedEntry).toBe(remoteEntry);
    });

    it('should resolve with keep_newest strategy (remote newer)', () => {
      const resolution = resolveConflict(conflict, 'keep_newest');
      expect(resolution.strategy).toBe('keep_newest');
      expect(resolution.resolvedEntry).toBe(remoteEntry);
    });

    it('should resolve with keep_newest strategy (local newer)', () => {
      const newerLocalConflict: SyncConflict = {
        ...conflict,
        localModified: Date.now(),
        remoteModified: Date.now() - 1000,
      };
      const resolution = resolveConflict(newerLocalConflict, 'keep_newest');
      expect(resolution.resolvedEntry).toBe(newerLocalConflict.localEntry);
    });

    it('should resolve with keep_both strategy', () => {
      const resolution = resolveConflict(conflict, 'keep_both');
      expect(resolution.strategy).toBe('keep_both');
      expect(resolution.resolvedEntry).toBeDefined();
      expect(resolution.resolvedEntry!.id).not.toBe(remoteEntry.id);
      expect(resolution.resolvedEntry!.title).toContain('(from cloud)');
    });

    it('should resolve with skip strategy', () => {
      const resolution = resolveConflict(conflict, 'skip');
      expect(resolution.strategy).toBe('skip');
      expect(resolution.resolvedEntry).toBeUndefined();
    });

    it('should resolve with delete strategy', () => {
      const resolution = resolveConflict(conflict, 'delete');
      expect(resolution.strategy).toBe('delete');
      expect(resolution.resolvedEntry).toBeUndefined();
    });

    it('should include timestamp in resolution', () => {
      const before = Date.now();
      const resolution = resolveConflict(conflict, 'keep_local');
      const after = Date.now();

      expect(resolution.timestamp).toBeGreaterThanOrEqual(before);
      expect(resolution.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('mergeEntries', () => {
    const local: Entry = {
      id: '1',
      title: 'Local Title',
      username: 'local@example.com',
      password: 'localpass',
      modified: Date.now() - 1000,
    };

    const remote: Entry = {
      id: '1',
      title: 'Remote Title',
      username: 'remote@example.com',
      password: 'remotepass',
      modified: Date.now(),
    };

    it('should merge all fields from local', () => {
      const merged = mergeEntries(local, remote, {
        title: 'local',
        username: 'local',
        password: 'local',
      });

      expect(merged.title).toBe('Local Title');
      expect(merged.username).toBe('local@example.com');
      expect(merged.password).toBe('localpass');
    });

    it('should merge all fields from remote', () => {
      const merged = mergeEntries(local, remote, {
        title: 'remote',
        username: 'remote',
        password: 'remote',
      });

      expect(merged.title).toBe('Remote Title');
      expect(merged.username).toBe('remote@example.com');
      expect(merged.password).toBe('remotepass');
    });

    it('should merge mixed fields', () => {
      const merged = mergeEntries(local, remote, {
        title: 'local',
        username: 'remote',
        password: 'local',
      });

      expect(merged.title).toBe('Local Title');
      expect(merged.username).toBe('remote@example.com');
      expect(merged.password).toBe('localpass');
    });

    it('should preserve original ID', () => {
      const merged = mergeEntries(local, remote, {
        title: 'remote',
        username: 'remote',
        password: 'remote',
      });

      expect(merged.id).toBe(local.id);
    });

    it('should update modified timestamp', () => {
      const before = Date.now();
      const merged = mergeEntries(local, remote, { title: 'local', username: 'local', password: 'local' });
      const after = Date.now();

      expect(merged.modified).toBeGreaterThanOrEqual(before);
      expect(merged.modified).toBeLessThanOrEqual(after);
    });
  });

  describe('calculateChecksum', () => {
    it('should generate consistent checksums', () => {
      const entry = createEntry('1', 'Test', 1234567890);
      const checksum1 = calculateChecksum(entry);
      const checksum2 = calculateChecksum(entry);
      expect(checksum1).toBe(checksum2);
    });

    it('should generate different checksums for different entries', () => {
      const entry1 = createEntry('1', 'Test 1', Date.now());
      const entry2 = createEntry('2', 'Test 2', Date.now());
      expect(calculateChecksum(entry1)).not.toBe(calculateChecksum(entry2));
    });

    it('should detect title changes', () => {
      const entry1 = createEntry('1', 'Original', Date.now());
      const entry2 = { ...entry1, title: 'Modified' };
      expect(calculateChecksum(entry1)).not.toBe(calculateChecksum(entry2));
    });

    it('should detect password changes', () => {
      const entry1 = createEntry('1', 'Test', Date.now());
      const entry2 = { ...entry1, password: 'newpassword' };
      expect(calculateChecksum(entry1)).not.toBe(calculateChecksum(entry2));
    });

    it('should return 16-character checksum', () => {
      const entry = createEntry('1', 'Test', Date.now());
      const checksum = calculateChecksum(entry);
      expect(checksum.length).toBe(16);
    });
  });
});
