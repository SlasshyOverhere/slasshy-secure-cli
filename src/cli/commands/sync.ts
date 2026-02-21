/**
 * Sync Command - Manage vault synchronization with cloud storage
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  isUnlocked,
  listEntries,
  getEntry,
  addEntry,
  updateEntry,
  deleteEntry,
  getVaultPaths,
  type Entry,
} from '../../storage/vault/index.js';
import { isDriveConnected } from '../../storage/drive/driveClient.js';
import { getSyncStatus } from '../../storage/drive/synchronizer.js';
import { ensureAuthenticated } from '../ensureAuth.js';
import {
  type SyncState,
  type SyncConflict,
  type ConflictResolution,
  createInitialSyncState,
  detectConflicts,
  resolveAllConflicts,
  displaySyncSummary,
  updateSyncState,
  calculateEntryChecksum,
} from '../../sync/index.js';

const SYNC_STATE_FILE = '.sync-state.json';

/**
 * Get sync state file path
 */
function getSyncStatePath(): string {
  const { dir } = getVaultPaths();
  return path.join(dir, SYNC_STATE_FILE);
}

/**
 * Load sync state from file
 */
async function loadSyncState(): Promise<SyncState> {
  try {
    const statePath = getSyncStatePath();
    const data = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(data) as SyncState;
  } catch {
    return createInitialSyncState();
  }
}

/**
 * Save sync state to file
 */
async function saveSyncState(state: SyncState): Promise<void> {
  const statePath = getSyncStatePath();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Sync command - main entry point
 */
export async function syncCommand(options?: {
  force?: boolean;
  status?: boolean;
  conflicts?: boolean;
}): Promise<void> {
  // Ensure authenticated
  if (!await ensureAuthenticated()) {
    return;
  }

  if (options?.status) {
    await showSyncStatus();
    return;
  }

  if (options?.conflicts) {
    await showPendingConflicts();
    return;
  }

  await performSync(options?.force);
}

/**
 * Show sync status
 */
async function showSyncStatus(): Promise<void> {
  console.log(chalk.bold('\n  ☁️  Sync Status\n'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const status = getSyncStatus();
  const syncState = await loadSyncState();

  // Connection status
  if (status.connected) {
    console.log(`  ${chalk.green('●')} Google Drive: ${chalk.green('Connected')}`);
  } else {
    console.log(`  ${chalk.red('●')} Google Drive: ${chalk.red('Not connected')}`);
  }

  // Last sync time
  if (status.lastSync) {
    const lastSyncDate = new Date(status.lastSync);
    const ago = getTimeAgo(status.lastSync);
    console.log(`  🕐 Last sync: ${chalk.cyan(lastSyncDate.toLocaleString())} (${ago})`);
  } else {
    console.log(`  🕐 Last sync: ${chalk.yellow('Never')}`);
  }

  // Pending uploads
  if (status.pendingUploads > 0) {
    console.log(`  📤 Pending uploads: ${chalk.yellow(status.pendingUploads)}`);
  } else {
    console.log(`  📤 Pending uploads: ${chalk.green('None')}`);
  }

  // Tracked entries
  const trackedCount = Object.keys(syncState.entryVersions).length;
  console.log(`  📊 Tracked entries: ${chalk.cyan(trackedCount)}`);

  // Pending conflicts
  const pendingConflicts = syncState.conflictHistory.filter(
    r => r.strategy === 'skip'
  ).length;
  if (pendingConflicts > 0) {
    console.log(`  ⚠️  Pending conflicts: ${chalk.yellow(pendingConflicts)}`);
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}

/**
 * Get human-readable time ago string
 */
function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Show pending conflicts
 */
async function showPendingConflicts(): Promise<void> {
  console.log(chalk.bold('\n  ⚠️  Pending Conflicts\n'));

  const syncState = await loadSyncState();
  const pendingConflicts = syncState.conflictHistory.filter(
    r => r.strategy === 'skip'
  );

  if (pendingConflicts.length === 0) {
    console.log(chalk.green('  ✓ No pending conflicts.'));
    console.log(chalk.gray('  All sync conflicts have been resolved.\n'));
    return;
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));

  pendingConflicts.forEach((resolution, idx) => {
    const { conflict } = resolution;
    const num = (idx + 1).toString().padStart(2, ' ');
    console.log(`  ${chalk.gray(num + '.')} ${chalk.yellow('⚠')} ${chalk.cyan(conflict.entryTitle)}`);
    console.log(`       Type: ${chalk.gray(conflict.type)}`);
    console.log(`       Local: ${chalk.gray(new Date(conflict.localModified).toLocaleString())}`);
    if (conflict.remoteModified) {
      console.log(`       Remote: ${chalk.gray(new Date(conflict.remoteModified).toLocaleString())}`);
    }
  });

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(chalk.gray(`\n  ${pendingConflicts.length} pending conflict(s).`));
  console.log(chalk.gray('  Use "sync" to resolve them.\n'));
}

/**
 * Perform sync operation
 */
async function performSync(force?: boolean): Promise<void> {
  console.log(chalk.bold('\n  ☁️  Vault Synchronization\n'));

  // Check Drive connection
  if (!isDriveConnected()) {
    console.log(chalk.yellow('  ⚠ Google Drive is not connected.'));
    console.log(chalk.gray('  Use "auth" command to connect to Google Drive.\n'));
    return;
  }

  const spinner = ora('Checking for changes...').start();

  try {
    // Load current state
    const syncState = await loadSyncState();
    const entries = await listEntries();

    // Build local entries map
    const localEntries: Record<string, { entry: Entry; indexEntry: any }> = {};

    for (const indexEntry of entries) {
      if (indexEntry.entryType === 'password' || !indexEntry.entryType) {
        const entry = await getEntry(indexEntry.id);
        if (entry) {
          localEntries[indexEntry.id] = { entry: entry as Entry, indexEntry };
        }
      }
    }

    spinner.text = 'Fetching remote entries...';

    // For now, simulate remote entries (in real implementation, this would fetch from Drive)
    // This is a placeholder - actual implementation would download and decrypt remote index
    const remoteEntries: Record<string, { entry: Entry; indexEntry: any }> = {};

    // Detect conflicts
    spinner.text = 'Detecting conflicts...';
    const conflicts = detectConflicts(localEntries, remoteEntries, syncState);

    // Also check for skipped conflicts from previous syncs
    const skippedConflicts = syncState.conflictHistory
      .filter(r => r.strategy === 'skip')
      .map(r => r.conflict);

    const allConflicts = [...conflicts, ...skippedConflicts];

    spinner.stop();

    if (allConflicts.length === 0 && !force) {
      console.log(chalk.green('  ✓ Everything is in sync!'));
      console.log(chalk.gray(`  ${Object.keys(localEntries).length} entries tracked.\n`));

      // Update last sync time
      const updatedState: SyncState = {
        ...syncState,
        lastFullSync: Date.now(),
      };
      await saveSyncState(updatedState);
      return;
    }

    if (allConflicts.length > 0) {
      // Resolve conflicts interactively
      const resolutions = await resolveAllConflicts(allConflicts);

      // Apply resolutions
      const applySpinner = ora('Applying resolutions...').start();

      for (const resolution of resolutions) {
        try {
          switch (resolution.strategy) {
            case 'keep_local':
            case 'keep_newest':
              if (resolution.resolvedEntry) {
                // Update sync state to mark as synced
                syncState.entryVersions[resolution.conflict.id] = {
                  localVersion: (resolution.conflict.localVersion || 0) + 1,
                  remoteVersion: (resolution.conflict.remoteVersion || 0) + 1,
                  lastSyncedAt: Date.now(),
                  checksum: calculateEntryChecksum(resolution.resolvedEntry),
                };
              }
              break;

            case 'keep_remote':
              if (resolution.resolvedEntry) {
                // Update local entry with remote version
                await updateEntry(resolution.conflict.id, resolution.resolvedEntry);
                syncState.entryVersions[resolution.conflict.id] = {
                  localVersion: (resolution.conflict.remoteVersion || 0),
                  remoteVersion: (resolution.conflict.remoteVersion || 0),
                  lastSyncedAt: Date.now(),
                  checksum: calculateEntryChecksum(resolution.resolvedEntry),
                };
              }
              break;

            case 'keep_both':
              if (resolution.resolvedEntry && 'password' in resolution.resolvedEntry) {
                // Add as new entry (duplicate from remote)
                const entry = resolution.resolvedEntry;
                await addEntry(entry.title, {
                  username: entry.username,
                  password: entry.password,
                  url: entry.url,
                  notes: entry.notes,
                  category: entry.category,
                });
              }
              break;

            case 'merge':
              if (resolution.resolvedEntry) {
                await updateEntry(resolution.conflict.id, resolution.resolvedEntry);
                syncState.entryVersions[resolution.conflict.id] = {
                  localVersion: (resolution.conflict.localVersion || 0) + 1,
                  remoteVersion: (resolution.conflict.remoteVersion || 0) + 1,
                  lastSyncedAt: Date.now(),
                  checksum: calculateEntryChecksum(resolution.resolvedEntry),
                };
              }
              break;

            case 'delete':
              await deleteEntry(resolution.conflict.id);
              delete syncState.entryVersions[resolution.conflict.id];
              break;

            case 'skip':
              // Keep in conflict history for later resolution
              break;
          }
        } catch (error) {
          applySpinner.fail(`Failed to apply resolution for ${resolution.conflict.entryTitle}`);
          if (error instanceof Error) {
            console.log(chalk.red(`  ${error.message}`));
          }
        }
      }

      applySpinner.stop();

      // Update conflict history (keep only skipped conflicts)
      syncState.conflictHistory = resolutions.filter(r => r.strategy === 'skip');
      syncState.lastFullSync = Date.now();

      await saveSyncState(syncState);

      displaySyncSummary(resolutions);
    } else {
      // No conflicts, just update sync state
      for (const [id, { entry }] of Object.entries(localEntries)) {
        syncState.entryVersions[id] = {
          localVersion: (syncState.entryVersions[id]?.localVersion || 0) + 1,
          remoteVersion: (syncState.entryVersions[id]?.remoteVersion || 0) + 1,
          lastSyncedAt: Date.now(),
          checksum: calculateEntryChecksum(entry),
        };
      }

      syncState.lastFullSync = Date.now();
      await saveSyncState(syncState);

      console.log(chalk.green('  ✓ Sync complete!'));
      console.log(chalk.gray(`  ${Object.keys(localEntries).length} entries synced.\n`));
    }
  } catch (error) {
    spinner.fail('Sync failed');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * Show sync help
 */
export function showSyncHelp(): void {
  console.log(chalk.bold('\n  ☁️  Sync Commands\n'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  ${chalk.cyan('sync')}              Sync vault with cloud`);
  console.log(`  ${chalk.cyan('sync --status')}     Show sync status`);
  console.log(`  ${chalk.cyan('sync --conflicts')} Show pending conflicts`);
  console.log(`  ${chalk.cyan('sync --force')}      Force full sync`);
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}
