import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import cliProgress from 'cli-progress';
import {
  vaultExists,
  unlock,
  isUnlocked,
  getEntry,
  getVaultPaths,
  getVaultIndex,
  updateVaultIndex,
} from '../../storage/vault/index.js';
import {
  isAuthenticated,
  authenticateDrive,
  isDriveConnected,
  getSlasshyFolder,
  uploadFile,
  hasAppDataAccess,
  uploadFileToCloud,
} from '../../storage/drive/index.js';
import {
  embedInPNG,
  generateCarrierImage,
} from '../../steganography/index.js';
import {
  fragmentData,
  serializeFragment,
  generateFilename,
} from '../../obfuscation/index.js';
import { promptPassword, promptConfirm } from '../prompts.js';
import { initializeKeyManager, encryptObject, getEntryKey } from '../../crypto/index.js';
import { randomInt } from '../../crypto/random.js';
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

  // Check for appDataFolder access (needed for file uploads)
  let hasHiddenStorageAccess = false;
  try {
    hasHiddenStorageAccess = await hasAppDataAccess();
  } catch {
    // No access, will skip file sync
  }

  // Get entries that need syncing
  const vaultIndex = getVaultIndex();
  if (!vaultIndex) {
    console.log(chalk.red('  Vault not loaded.'));
    return;
  }

  // Separate password entries (steganography) from file entries (direct upload)
  const pendingPasswordEntries: string[] = [];
  const pendingFileEntries: string[] = [];

  for (const [id, indexEntry] of Object.entries(vaultIndex.entries)) {
    if (indexEntry.entryType === 'file') {
      // File entries: check cloudChunks for sync status
      if (!indexEntry.cloudChunks || indexEntry.cloudChunks.length === 0) {
        pendingFileEntries.push(id);
      }
    } else {
      // Password entries: check fragments for sync status
      if (indexEntry.fragments.length === 0) {
        pendingPasswordEntries.push(id);
      }
    }
  }

  const totalPending = pendingPasswordEntries.length + pendingFileEntries.length;

  if (totalPending === 0) {
    console.log(chalk.green('\n  All entries are synced!\n'));
    return;
  }

  // Show what needs syncing
  console.log(chalk.yellow(`\n  ${totalPending} entries need to be synced:`));
  if (pendingPasswordEntries.length > 0) {
    console.log(chalk.gray(`    • ${pendingPasswordEntries.length} password entries (steganography)`));
  }
  if (pendingFileEntries.length > 0) {
    console.log(chalk.gray(`    • ${pendingFileEntries.length} file entries (hidden storage)`));
    if (!hasHiddenStorageAccess) {
      console.log(chalk.yellow('\n  ⚠ Hidden storage not available. Re-authenticate to enable.'));
      console.log(chalk.gray('    Run "slasshy auth --logout" then "slasshy auth" to get new permissions.\n'));
    }
  }
  console.log('');

  // Confirm sync
  const confirmed = await promptConfirm('Proceed with sync?');
  if (!confirmed) {
    console.log(chalk.gray('\n  Sync cancelled.\n'));
    return;
  }

  let totalUploaded = 0;

  // ========== SYNC PASSWORD ENTRIES (Steganography) ==========
  if (pendingPasswordEntries.length > 0) {
    console.log(chalk.gray('\n  Syncing password entries (steganography)...\n'));

    const { carriers: carriersDir } = getVaultPaths();
    await fs.mkdir(carriersDir, { recursive: true });

    const folderId = await getSlasshyFolder();

    const progressBar = new cliProgress.SingleBar({
      format: `  Passwords |${chalk.cyan('{bar}')}| {percentage}% | {value}/{total} | {currentEntry}`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
    }, cliProgress.Presets.shades_classic);

    progressBar.start(pendingPasswordEntries.length, 0, { currentEntry: 'Starting...' });

    let uploaded = 0;
    for (const entryId of pendingPasswordEntries) {
      const entry = await getEntry(entryId);
      if (!entry) {
        progressBar.increment({ currentEntry: 'Skipped' });
        continue;
      }

      progressBar.update(uploaded, { currentEntry: `"${entry.title.substring(0, 25)}..."` });

      try {
        const entryKey = getEntryKey();
        const encryptedEntry = encryptObject(entry, entryKey, entryId);
        const entryBuffer = Buffer.from(encryptedEntry, 'utf-8');

        const fragments = fragmentData(entryBuffer);
        const driveFileIds: string[] = [];

        for (const fragment of fragments) {
          const serialized = serializeFragment(fragment);
          const carrierFilename = `carrier_${Date.now()}_${randomInt(1000, 9999)}.png`;
          const carrierPath = path.join(carriersDir, carrierFilename);

          await generateCarrierImage(carrierPath, serialized.length + 1000);

          const outputFilename = generateFilename('png');
          const outputPath = path.join(carriersDir, outputFilename);

          await embedInPNG(carrierPath, serialized, outputPath);
          await fs.unlink(carrierPath).catch(() => {});

          await new Promise(r => setTimeout(r, randomInt(500, 2000)));

          const fileId = await uploadFile(outputPath, outputFilename, 'image/png', folderId);
          driveFileIds.push(fileId);

          await fs.unlink(outputPath).catch(() => {});
        }

        vaultIndex.entries[entryId]!.fragments = driveFileIds;
        uploaded++;
        totalUploaded++;
        progressBar.update(uploaded, { currentEntry: `✓ "${entry.title.substring(0, 20)}..."` });
      } catch {
        progressBar.update(uploaded, { currentEntry: `✗ Failed` });
      }
    }

    progressBar.stop();
  }

  // ========== SYNC FILE ENTRIES (Hidden appDataFolder) ==========
  if (pendingFileEntries.length > 0 && hasHiddenStorageAccess) {
    console.log(chalk.gray('\n  Syncing files to hidden storage...\n'));

    // Calculate total bytes to upload
    let totalBytes = 0;
    const fileInfos: Array<{ id: string; title: string; size: number; chunkCount: number }> = [];

    for (const entryId of pendingFileEntries) {
      const indexEntry = vaultIndex.entries[entryId];
      if (indexEntry) {
        const title = await getEntryTitle(entryId);
        fileInfos.push({
          id: entryId,
          title: title || 'Unknown',
          size: indexEntry.fileSize || 0,
          chunkCount: indexEntry.chunkCount || 1,
        });
        totalBytes += indexEntry.fileSize || 0;
      }
    }

    console.log(chalk.gray(`  Total: ${formatBytes(totalBytes)} in ${pendingFileEntries.length} files\n`));

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
        // Upload all chunks for this file to hidden appDataFolder
        const cloudChunks = await uploadFileToCloud(
          fileInfo.id,
          fileInfo.chunkCount,
          (chunksUploaded, totalChunks, chunkBytesUploaded, chunkTotalBytes) => {
            const currentProgress = bytesUploaded + chunkBytesUploaded;
            progressBar.update(Math.round((currentProgress / totalBytes) * 100), {
              transferred: formatBytes(currentProgress),
              total: formatBytes(totalBytes),
              currentFile: `"${fileInfo.title.substring(0, 20)}..." (${chunksUploaded}/${totalChunks})`,
            });
          }
        );

        // Update vault index with cloud chunk info
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
      } catch (error) {
        vaultIndex.entries[fileInfo.id]!.cloudSyncStatus = 'error';
        progressBar.update(Math.round((bytesUploaded / totalBytes) * 100), {
          transferred: formatBytes(bytesUploaded),
          total: formatBytes(totalBytes),
          currentFile: `✗ Failed: "${fileInfo.title.substring(0, 15)}..."`,
        });
      }
    }

    progressBar.stop();
  }

  // Save updated index
  await updateVaultIndex({ lastSync: Date.now() });

  console.log(chalk.green(`\n  ✓ Sync complete! ${totalUploaded} entries uploaded.`));
  if (pendingPasswordEntries.length > 0) {
    console.log(chalk.gray('    • Password entries hidden in images (visible in Drive)'));
  }
  if (pendingFileEntries.length > 0 && hasHiddenStorageAccess) {
    console.log(chalk.gray('    • Files stored in hidden appDataFolder (INVISIBLE in Drive)'));
  }
  console.log('');
}

/**
 * Helper to get entry title from encrypted index
 */
async function getEntryTitle(entryId: string): Promise<string | null> {
  try {
    const entry = await getEntry(entryId);
    return entry?.title || null;
  } catch {
    return null;
  }
}
