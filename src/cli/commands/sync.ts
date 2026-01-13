import chalk from 'chalk';
import ora from 'ora';
import cliProgress from 'cli-progress';
import {
  vaultExists,
  unlock,
  isUnlocked,
  getEntry,
  getVaultIndex,
  updateVaultIndex,
} from '../../storage/vault/index.js';
import {
  isAuthenticated,
  authenticateDrive,
  isDriveConnected,
  hasAppDataAccess,
  uploadFileToCloud,
  uploadBufferToAppData,
  findAppDataFile,
} from '../../storage/drive/index.js';
import { promptPassword, promptConfirm } from '../prompts.js';
import { initializeKeyManager, encryptObject, getEntryKey } from '../../crypto/index.js';
import { formatBytes } from '../progress.js';

export async function syncCommand(options?: {
  push?: boolean;
  pull?: boolean;
  auto?: boolean;
}): Promise<void> {
  console.log(chalk.bold('\n  Sync with Google Drive\n'));

  // Check vault exists
  if (!await vaultExists()) {
    console.log(chalk.red('  No vault found. Run "slasshy init" first.'));
    return;
  }

  // Unlock if needed
  if (!isUnlocked()) {
    initializeKeyManager();
    const password = await promptPassword();

    const spinner = ora('Unlocking vault...').start();
    try {
      await unlock(password);
      spinner.succeed('Vault unlocked');
    } catch (error) {
      spinner.fail('Failed to unlock vault');
      if (error instanceof Error) {
        console.log(chalk.red(`  ${error.message}`));
      }
      return;
    }
  }

  // Check if authenticated
  if (!await isAuthenticated()) {
    console.log(chalk.yellow('\n  Not connected to Google Drive.'));
    console.log(chalk.gray('  Run "slasshy auth" to authenticate with Google Drive.\n'));
    return;
  }

  // Connect to Drive
  if (!isDriveConnected()) {
    const spinner = ora('Connecting to Google Drive...').start();
    try {
      await authenticateDrive();
      spinner.succeed('Connected to Google Drive');
    } catch (error) {
      spinner.fail('Failed to connect to Google Drive');
      if (error instanceof Error) {
        console.log(chalk.red(`  ${error.message}`));
      }
      return;
    }
  }

  // Check for appDataFolder access
  const spinner = ora('Checking hidden storage access...').start();
  let hasHiddenAccess = false;
  try {
    hasHiddenAccess = await hasAppDataAccess();
    if (hasHiddenAccess) {
      spinner.succeed('Hidden storage available');
    } else {
      spinner.fail('Hidden storage not available');
      console.log(chalk.yellow('\n  ⚠ You need to re-authenticate to enable hidden storage.'));
      console.log(chalk.gray('    Run "slasshy auth --logout" then "slasshy auth"\n'));
      return;
    }
  } catch (error) {
    spinner.fail('Failed to check hidden storage');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // Get entries that need syncing
  const vaultIndex = getVaultIndex();
  if (!vaultIndex) {
    console.log(chalk.red('  Vault not loaded.'));
    return;
  }

  // Find all entries that need syncing
  const pendingPasswordEntries: string[] = [];
  const pendingFileEntries: string[] = [];

  for (const [id, indexEntry] of Object.entries(vaultIndex.entries)) {
    if (indexEntry.entryType === 'file') {
      // File entries: check cloudChunks
      if (!indexEntry.cloudChunks || indexEntry.cloudChunks.length === 0) {
        pendingFileEntries.push(id);
      }
    } else {
      // Password entries: check cloudSyncStatus
      if (indexEntry.cloudSyncStatus !== 'synced') {
        pendingPasswordEntries.push(id);
      }
    }
  }

  const totalPending = pendingPasswordEntries.length + pendingFileEntries.length;

  if (totalPending === 0) {
    console.log(chalk.green('\n  ✓ All entries are synced!\n'));
    return;
  }

  // Show what needs syncing
  console.log(chalk.yellow(`\n  ${totalPending} entries need to be synced:`));
  if (pendingPasswordEntries.length > 0) {
    console.log(chalk.gray(`    • ${pendingPasswordEntries.length} password entries`));
  }
  if (pendingFileEntries.length > 0) {
    // Calculate total file size
    let totalFileSize = 0;
    for (const id of pendingFileEntries) {
      totalFileSize += vaultIndex.entries[id]?.fileSize || 0;
    }
    console.log(chalk.gray(`    • ${pendingFileEntries.length} files (${formatBytes(totalFileSize)})`));
  }
  console.log('');

  // Confirm sync
  const confirmed = await promptConfirm('Proceed with sync to hidden storage?');
  if (!confirmed) {
    console.log(chalk.gray('\n  Sync cancelled.\n'));
    return;
  }

  let totalUploaded = 0;

  // ========== SYNC PASSWORD ENTRIES ==========
  if (pendingPasswordEntries.length > 0) {
    console.log(chalk.gray('\n  Syncing password entries...\n'));

    const progressBar = new cliProgress.SingleBar({
      format: `  Passwords |${chalk.cyan('{bar}')}| {percentage}% | {value}/{total}`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
    }, cliProgress.Presets.shades_classic);

    progressBar.start(pendingPasswordEntries.length, 0);

    for (const entryId of pendingPasswordEntries) {
      try {
        const entry = await getEntry(entryId);
        if (!entry) {
          progressBar.increment();
          continue;
        }

        // Encrypt entry data
        const entryKey = getEntryKey();
        const encryptedEntry = encryptObject(entry, entryKey, entryId);
        const entryBuffer = Buffer.from(encryptedEntry, 'utf-8');

        // Upload to hidden appDataFolder
        const cloudFileName = `slasshy_pwd_${entryId}.enc`;

        // Check if already exists
        const existingId = await findAppDataFile(cloudFileName);
        if (!existingId) {
          await uploadBufferToAppData(entryBuffer, cloudFileName);
        }

        // Update index
        vaultIndex.entries[entryId]!.cloudSyncStatus = 'synced';
        vaultIndex.entries[entryId]!.cloudSyncedAt = Date.now();

        totalUploaded++;
        progressBar.increment();
      } catch {
        // Mark as error but continue
        vaultIndex.entries[entryId]!.cloudSyncStatus = 'error';
        progressBar.increment();
      }
    }

    progressBar.stop();
  }

  // ========== SYNC FILE ENTRIES ==========
  if (pendingFileEntries.length > 0) {
    console.log(chalk.gray('\n  Syncing files...\n'));

    // Calculate total bytes
    let totalBytes = 0;
    const fileInfos: Array<{ id: string; title: string; size: number; chunkCount: number }> = [];

    for (const entryId of pendingFileEntries) {
      const indexEntry = vaultIndex.entries[entryId];
      if (indexEntry) {
        const entry = await getEntry(entryId);
        fileInfos.push({
          id: entryId,
          title: entry?.title || 'Unknown',
          size: indexEntry.fileSize || 0,
          chunkCount: indexEntry.chunkCount || 1,
        });
        totalBytes += indexEntry.fileSize || 0;
      }
    }

    console.log(chalk.gray(`  Total: ${formatBytes(totalBytes)}\n`));

    const progressBar = new cliProgress.SingleBar({
      format: `  Uploading |${chalk.cyan('{bar}')}| {percentage}% | {transferred}/{total} | {currentFile}`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
    }, cliProgress.Presets.shades_classic);

    progressBar.start(100, 0, {
      transferred: formatBytes(0),
      total: formatBytes(totalBytes),
      currentFile: 'Starting...',
    });

    let bytesUploaded = 0;

    for (const fileInfo of fileInfos) {
      progressBar.update(Math.round((bytesUploaded / totalBytes) * 100), {
        transferred: formatBytes(bytesUploaded),
        total: formatBytes(totalBytes),
        currentFile: `"${fileInfo.title.substring(0, 20)}..."`,
      });

      try {
        // Upload all chunks to hidden appDataFolder
        const cloudChunks = await uploadFileToCloud(
          fileInfo.id,
          fileInfo.chunkCount,
          (chunksUploaded, totalChunks, chunkBytes, chunkTotal) => {
            const current = bytesUploaded + chunkBytes;
            progressBar.update(Math.round((current / totalBytes) * 100), {
              transferred: formatBytes(current),
              total: formatBytes(totalBytes),
              currentFile: `"${fileInfo.title.substring(0, 18)}..." (${chunksUploaded}/${totalChunks})`,
            });
          }
        );

        // Update vault index
        vaultIndex.entries[fileInfo.id]!.cloudChunks = cloudChunks;
        vaultIndex.entries[fileInfo.id]!.cloudSyncStatus = 'synced';
        vaultIndex.entries[fileInfo.id]!.cloudSyncedAt = Date.now();

        bytesUploaded += fileInfo.size;
        totalUploaded++;

        progressBar.update(Math.round((bytesUploaded / totalBytes) * 100), {
          transferred: formatBytes(bytesUploaded),
          total: formatBytes(totalBytes),
          currentFile: `✓ "${fileInfo.title.substring(0, 20)}..."`,
        });
      } catch {
        vaultIndex.entries[fileInfo.id]!.cloudSyncStatus = 'error';
      }
    }

    progressBar.stop();
  }

  // Save updated index
  await updateVaultIndex({ lastSync: Date.now() });

  console.log(chalk.green(`\n  ✓ Sync complete! ${totalUploaded} entries uploaded.`));
  console.log(chalk.gray('    All data stored in hidden appDataFolder (INVISIBLE in Drive)'));
  console.log('');
}
