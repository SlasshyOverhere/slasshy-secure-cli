/**
 * Sync Conflict Resolution System
 *
 * Detects and resolves conflicts between local and remote vault entries
 * during synchronization with cloud storage providers.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import crypto from 'crypto';
import { type Entry, type FileEntry, type NoteEntry, type IndexEntry } from '../storage/vault/schema.js';

/**
 * Conflict types
 */
export type ConflictType =
  | 'modified_both' // Both local and remote modified since last sync
  | 'deleted_local' // Entry deleted locally but modified remotely
  | 'deleted_remote' // Entry deleted remotely but modified locally
  | 'created_both' // Same ID created on both (rare, UUID collision)
  | 'schema_mismatch'; // Entry type changed

/**
 * Resolution strategies
 */
export type ResolutionStrategy =
  | 'keep_local' // Keep local version
  | 'keep_remote' // Keep remote version
  | 'keep_newest' // Keep version with latest modified timestamp
  | 'keep_both' // Create duplicate with different ID
  | 'merge' // Merge fields (for password entries)
  | 'skip' // Skip this entry, resolve later
  | 'delete'; // Delete from both

/**
 * A detected conflict
 */
export interface SyncConflict {
  id: string;
  entryTitle: string;
  type: ConflictType;
  localEntry?: Entry | FileEntry | NoteEntry;
  remoteEntry?: Entry | FileEntry | NoteEntry;
  localModified: number;
  remoteModified: number;
  localVersion?: number;
  remoteVersion?: number;
}

/**
 * Conflict resolution result
 */
export interface ConflictResolution {
  conflict: SyncConflict;
  strategy: ResolutionStrategy;
  resolvedEntry?: Entry | FileEntry | NoteEntry;
  timestamp: number;
}

/**
 * Sync state for tracking versions
 */
export interface SyncState {
  entryVersions: Record<string, {
    localVersion: number;
    remoteVersion: number;
    lastSyncedAt: number;
    checksum: string; // Content hash for change detection
  }>;
  lastFullSync: number;
  conflictHistory: ConflictResolution[];
}

/**
 * Calculate content checksum for an entry
 */
export function calculateEntryChecksum(entry: Entry | FileEntry | NoteEntry): string {
  const content = JSON.stringify({
    title: entry.title,
    modified: entry.modified,
    // Include type-specific fields
    ...(('password' in entry && entry.password) ? { password: entry.password } : {}),
    ...(('username' in entry && entry.username) ? { username: entry.username } : {}),
    ...(('url' in entry && entry.url) ? { url: entry.url } : {}),
    ...(('notes' in entry && entry.notes) ? { notes: entry.notes } : {}),
    ...(('content' in entry && entry.content) ? { content: entry.content } : {}),
    ...(('checksum' in entry && entry.checksum) ? { fileChecksum: entry.checksum } : {}),
  });

  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Detect conflicts between local and remote entries
 */
export function detectConflicts(
  localEntries: Record<string, { entry: Entry | FileEntry | NoteEntry; indexEntry: IndexEntry }>,
  remoteEntries: Record<string, { entry: Entry | FileEntry | NoteEntry; indexEntry: IndexEntry }>,
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
      // Check if this was deleted remotely after last sync
      if (versionInfo && versionInfo.remoteVersion > 0) {
        // Entry existed remotely before, now gone - deleted remotely
        if (local.entry.modified > versionInfo.lastSyncedAt) {
          // But local was modified after last sync - conflict!
          conflicts.push({
            id,
            entryTitle: local.entry.title,
            type: 'deleted_remote',
            localEntry: local.entry,
            localModified: local.entry.modified,
            remoteModified: versionInfo.lastSyncedAt,
            localVersion: versionInfo.localVersion + 1,
            remoteVersion: 0,
          });
        }
      }
      // If no versionInfo, it's a new local entry - no conflict
      continue;
    }

    // Both exist - check for modifications
    const localChecksum = calculateEntryChecksum(local.entry);
    const remoteChecksum = calculateEntryChecksum(remote.entry);

    if (localChecksum === remoteChecksum) {
      // Identical content - no conflict
      continue;
    }

    // Content differs - check timestamps
    const lastSyncedAt = versionInfo?.lastSyncedAt || 0;

    if (local.entry.modified > lastSyncedAt && remote.entry.modified > lastSyncedAt) {
      // Both modified since last sync - conflict!
      conflicts.push({
        id,
        entryTitle: local.entry.title,
        type: 'modified_both',
        localEntry: local.entry,
        remoteEntry: remote.entry,
        localModified: local.entry.modified,
        remoteModified: remote.entry.modified,
        localVersion: (versionInfo?.localVersion || 0) + 1,
        remoteVersion: (versionInfo?.remoteVersion || 0) + 1,
      });
    }
  }

  // Check for remotely created entries that were deleted locally
  for (const [id, remote] of Object.entries(remoteEntries)) {
    if (processedIds.has(id)) continue;

    const versionInfo = syncState.entryVersions[id];

    if (versionInfo && versionInfo.localVersion > 0) {
      // Entry existed locally before, now gone - deleted locally
      if (remote.entry.modified > versionInfo.lastSyncedAt) {
        // But remote was modified after last sync - conflict!
        conflicts.push({
          id,
          entryTitle: remote.entry.title,
          type: 'deleted_local',
          remoteEntry: remote.entry,
          localModified: versionInfo.lastSyncedAt,
          remoteModified: remote.entry.modified,
          localVersion: 0,
          remoteVersion: versionInfo.remoteVersion + 1,
        });
      }
    }
    // If no versionInfo or never existed locally, it's a new remote entry - no conflict
  }

  return conflicts;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleString();
}

/**
 * Get human-readable conflict type
 */
function getConflictTypeLabel(type: ConflictType): string {
  switch (type) {
    case 'modified_both':
      return 'Modified on both devices';
    case 'deleted_local':
      return 'Deleted locally, modified remotely';
    case 'deleted_remote':
      return 'Modified locally, deleted remotely';
    case 'created_both':
      return 'Created on both devices';
    case 'schema_mismatch':
      return 'Entry type mismatch';
    default:
      return 'Unknown conflict';
  }
}

/**
 * Display conflict details
 */
function displayConflict(conflict: SyncConflict, index: number, total: number): void {
  console.log('');
  console.log(chalk.yellow('  ━'.repeat(30)));
  console.log(chalk.yellow.bold(`  ⚠ Sync Conflict ${index + 1}/${total}`));
  console.log(chalk.yellow('  ━'.repeat(30)));
  console.log('');
  console.log(`  ${chalk.bold('Entry:')} ${chalk.cyan(conflict.entryTitle)}`);
  console.log(`  ${chalk.bold('ID:')} ${chalk.gray(conflict.id)}`);
  console.log(`  ${chalk.bold('Type:')} ${chalk.yellow(getConflictTypeLabel(conflict.type))}`);
  console.log('');

  if (conflict.localEntry) {
    console.log(chalk.bold('  📱 Local Version:'));
    console.log(`     Modified: ${chalk.cyan(formatTimestamp(conflict.localModified))}`);
    if ('username' in conflict.localEntry && conflict.localEntry.username) {
      console.log(`     Username: ${chalk.white(conflict.localEntry.username)}`);
    }
    if ('password' in conflict.localEntry && conflict.localEntry.password) {
      console.log(`     Password: ${chalk.gray('••••••••')} (${conflict.localEntry.password.length} chars)`);
    }
    if ('content' in conflict.localEntry) {
      const preview = conflict.localEntry.content.substring(0, 50);
      console.log(`     Content: ${chalk.gray(preview)}${conflict.localEntry.content.length > 50 ? '...' : ''}`);
    }
  }

  if (conflict.remoteEntry) {
    console.log('');
    console.log(chalk.bold('  ☁️  Remote Version:'));
    console.log(`     Modified: ${chalk.cyan(formatTimestamp(conflict.remoteModified))}`);
    if ('username' in conflict.remoteEntry && conflict.remoteEntry.username) {
      console.log(`     Username: ${chalk.white(conflict.remoteEntry.username)}`);
    }
    if ('password' in conflict.remoteEntry && conflict.remoteEntry.password) {
      console.log(`     Password: ${chalk.gray('••••••••')} (${conflict.remoteEntry.password.length} chars)`);
    }
    if ('content' in conflict.remoteEntry) {
      const preview = conflict.remoteEntry.content.substring(0, 50);
      console.log(`     Content: ${chalk.gray(preview)}${conflict.remoteEntry.content.length > 50 ? '...' : ''}`);
    }
  }

  console.log('');
}

/**
 * Get available resolution strategies for a conflict
 */
function getAvailableStrategies(conflict: SyncConflict): Array<{ name: string; value: ResolutionStrategy }> {
  const strategies: Array<{ name: string; value: ResolutionStrategy }> = [];

  switch (conflict.type) {
    case 'modified_both':
      strategies.push(
        { name: '📱 Keep local version', value: 'keep_local' },
        { name: '☁️  Keep remote version', value: 'keep_remote' },
        { name: '🕐 Keep newest (by timestamp)', value: 'keep_newest' },
        { name: '📑 Keep both (create duplicate)', value: 'keep_both' }
      );
      // Merge only available for password entries
      if (conflict.localEntry && 'password' in conflict.localEntry) {
        strategies.push({ name: '🔀 Merge fields interactively', value: 'merge' });
      }
      break;

    case 'deleted_local':
      strategies.push(
        { name: '🗑️  Delete (confirm local deletion)', value: 'delete' },
        { name: '☁️  Restore from remote', value: 'keep_remote' }
      );
      break;

    case 'deleted_remote':
      strategies.push(
        { name: '📱 Keep local (re-upload)', value: 'keep_local' },
        { name: '🗑️  Delete (confirm remote deletion)', value: 'delete' }
      );
      break;

    case 'created_both':
    case 'schema_mismatch':
      strategies.push(
        { name: '📱 Keep local version', value: 'keep_local' },
        { name: '☁️  Keep remote version', value: 'keep_remote' },
        { name: '📑 Keep both (rename one)', value: 'keep_both' }
      );
      break;
  }

  strategies.push({ name: '⏭️  Skip (resolve later)', value: 'skip' });

  return strategies;
}

/**
 * Merge two password entries interactively
 */
async function mergeEntries(
  local: Entry,
  remote: Entry
): Promise<Entry> {
  console.log(chalk.bold('\n  🔀 Merge Fields\n'));
  console.log(chalk.gray('  Select which version to keep for each field:\n'));

  const mergedEntry: Entry = { ...local };

  // Username
  if (local.username !== remote.username) {
    const { username } = await inquirer.prompt<{ username: string }>([
      {
        type: 'list',
        name: 'username',
        message: chalk.cyan('Username:'),
        choices: [
          { name: `Local: ${local.username || '(empty)'}`, value: local.username },
          { name: `Remote: ${remote.username || '(empty)'}`, value: remote.username },
        ],
      },
    ]);
    mergedEntry.username = username;
  }

  // Password
  if (local.password !== remote.password) {
    const localLen = local.password?.length || 0;
    const remoteLen = remote.password?.length || 0;
    const { password } = await inquirer.prompt<{ password: string }>([
      {
        type: 'list',
        name: 'password',
        message: chalk.cyan('Password:'),
        choices: [
          { name: `Local: ${'•'.repeat(Math.min(localLen, 12))} (${localLen} chars)`, value: local.password },
          { name: `Remote: ${'•'.repeat(Math.min(remoteLen, 12))} (${remoteLen} chars)`, value: remote.password },
        ],
      },
    ]);
    mergedEntry.password = password;
  }

  // URL
  if (local.url !== remote.url) {
    const { url } = await inquirer.prompt<{ url: string }>([
      {
        type: 'list',
        name: 'url',
        message: chalk.cyan('URL:'),
        choices: [
          { name: `Local: ${local.url || '(empty)'}`, value: local.url },
          { name: `Remote: ${remote.url || '(empty)'}`, value: remote.url },
        ],
      },
    ]);
    mergedEntry.url = url;
  }

  // Notes
  if (local.notes !== remote.notes) {
    const localPreview = local.notes?.substring(0, 40) || '(empty)';
    const remotePreview = remote.notes?.substring(0, 40) || '(empty)';
    const { notes } = await inquirer.prompt<{ notes: string }>([
      {
        type: 'list',
        name: 'notes',
        message: chalk.cyan('Notes:'),
        choices: [
          { name: `Local: ${localPreview}${(local.notes?.length || 0) > 40 ? '...' : ''}`, value: local.notes },
          { name: `Remote: ${remotePreview}${(remote.notes?.length || 0) > 40 ? '...' : ''}`, value: remote.notes },
          { name: 'Combine both notes', value: '__combine__' },
        ],
      },
    ]);

    if (notes === '__combine__') {
      const separator = '\n\n--- Merged from other device ---\n\n';
      mergedEntry.notes = `${local.notes || ''}${separator}${remote.notes || ''}`;
    } else {
      mergedEntry.notes = notes;
    }
  }

  // TOTP - keep local by default (don't prompt for secrets)
  if (local.totp || remote.totp) {
    if (!local.totp && remote.totp) {
      mergedEntry.totp = remote.totp;
    }
    // Otherwise keep local TOTP
  }

  // Update modified timestamp
  mergedEntry.modified = Date.now();

  console.log(chalk.green('\n  ✓ Fields merged successfully.\n'));

  return mergedEntry;
}

/**
 * Resolve a single conflict interactively
 */
export async function resolveConflict(
  conflict: SyncConflict,
  index: number,
  total: number
): Promise<ConflictResolution> {
  displayConflict(conflict, index, total);

  const strategies = getAvailableStrategies(conflict);

  const { strategy } = await inquirer.prompt<{ strategy: ResolutionStrategy }>([
    {
      type: 'list',
      name: 'strategy',
      message: chalk.cyan('How do you want to resolve this conflict?'),
      choices: strategies,
    },
  ]);

  let resolvedEntry: Entry | FileEntry | NoteEntry | undefined;

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
      // Create a duplicate with modified title
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
      if (conflict.localEntry && conflict.remoteEntry &&
          'password' in conflict.localEntry && 'password' in conflict.remoteEntry) {
        resolvedEntry = await mergeEntries(
          conflict.localEntry as Entry,
          conflict.remoteEntry as Entry
        );
      }
      break;

    case 'delete':
    case 'skip':
      // No resolved entry needed
      break;
  }

  return {
    conflict,
    strategy,
    resolvedEntry,
    timestamp: Date.now(),
  };
}

/**
 * Resolve all conflicts interactively
 */
export async function resolveAllConflicts(
  conflicts: SyncConflict[]
): Promise<ConflictResolution[]> {
  if (conflicts.length === 0) {
    return [];
  }

  console.log(chalk.yellow.bold(`\n  ⚠ ${conflicts.length} sync conflict${conflicts.length > 1 ? 's' : ''} detected\n`));

  // Ask if user wants to resolve all with same strategy or individually
  if (conflicts.length > 1) {
    const { resolveMode } = await inquirer.prompt<{ resolveMode: 'individual' | 'all_local' | 'all_remote' | 'all_newest' }>([
      {
        type: 'list',
        name: 'resolveMode',
        message: chalk.cyan('How would you like to resolve conflicts?'),
        choices: [
          { name: 'Resolve each conflict individually', value: 'individual' },
          { name: 'Keep all local versions', value: 'all_local' },
          { name: 'Keep all remote versions', value: 'all_remote' },
          { name: 'Keep newest for all (by timestamp)', value: 'all_newest' },
        ],
      },
    ]);

    if (resolveMode !== 'individual') {
      const strategy: ResolutionStrategy =
        resolveMode === 'all_local' ? 'keep_local' :
        resolveMode === 'all_remote' ? 'keep_remote' : 'keep_newest';

      return conflicts.map(conflict => {
        let resolvedEntry: Entry | FileEntry | NoteEntry | undefined;

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
        }

        return {
          conflict,
          strategy,
          resolvedEntry,
          timestamp: Date.now(),
        };
      });
    }
  }

  // Resolve individually
  const resolutions: ConflictResolution[] = [];

  for (let i = 0; i < conflicts.length; i++) {
    const resolution = await resolveConflict(conflicts[i]!, i, conflicts.length);
    resolutions.push(resolution);
  }

  return resolutions;
}

/**
 * Create initial sync state
 */
export function createInitialSyncState(): SyncState {
  return {
    entryVersions: {},
    lastFullSync: 0,
    conflictHistory: [],
  };
}

/**
 * Update sync state after successful sync
 */
export function updateSyncState(
  state: SyncState,
  entryId: string,
  entry: Entry | FileEntry | NoteEntry,
  isLocal: boolean
): SyncState {
  const checksum = calculateEntryChecksum(entry);
  const existing = state.entryVersions[entryId] || {
    localVersion: 0,
    remoteVersion: 0,
    lastSyncedAt: 0,
    checksum: '',
  };

  return {
    ...state,
    entryVersions: {
      ...state.entryVersions,
      [entryId]: {
        localVersion: isLocal ? existing.localVersion + 1 : existing.localVersion,
        remoteVersion: isLocal ? existing.remoteVersion : existing.remoteVersion + 1,
        lastSyncedAt: Date.now(),
        checksum,
      },
    },
  };
}

/**
 * Display sync summary
 */
export function displaySyncSummary(resolutions: ConflictResolution[]): void {
  console.log(chalk.bold('\n  📊 Conflict Resolution Summary\n'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const byStrategy: Record<ResolutionStrategy, number> = {
    keep_local: 0,
    keep_remote: 0,
    keep_newest: 0,
    keep_both: 0,
    merge: 0,
    skip: 0,
    delete: 0,
  };

  for (const resolution of resolutions) {
    byStrategy[resolution.strategy]++;
  }

  if (byStrategy.keep_local > 0) {
    console.log(`  📱 Kept local:    ${chalk.cyan(byStrategy.keep_local)}`);
  }
  if (byStrategy.keep_remote > 0) {
    console.log(`  ☁️  Kept remote:   ${chalk.cyan(byStrategy.keep_remote)}`);
  }
  if (byStrategy.keep_newest > 0) {
    console.log(`  🕐 Kept newest:   ${chalk.cyan(byStrategy.keep_newest)}`);
  }
  if (byStrategy.keep_both > 0) {
    console.log(`  📑 Kept both:     ${chalk.cyan(byStrategy.keep_both)}`);
  }
  if (byStrategy.merge > 0) {
    console.log(`  🔀 Merged:        ${chalk.cyan(byStrategy.merge)}`);
  }
  if (byStrategy.delete > 0) {
    console.log(`  🗑️  Deleted:       ${chalk.cyan(byStrategy.delete)}`);
  }
  if (byStrategy.skip > 0) {
    console.log(`  ⏭️  Skipped:       ${chalk.yellow(byStrategy.skip)}`);
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  ${chalk.bold('Total:')} ${resolutions.length} conflicts processed`);
  console.log('');
}
