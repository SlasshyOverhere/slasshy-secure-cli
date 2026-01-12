import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
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

  // Get entries that need syncing
  const vaultIndex = getVaultIndex();
  if (!vaultIndex) {
    console.log(chalk.red('  Vault not loaded.'));
    return;
  }

  const pendingEntries: string[] = [];
  for (const [id, indexEntry] of Object.entries(vaultIndex.entries)) {
    if (indexEntry.fragments.length === 0) {
      pendingEntries.push(id);
    }
  }

  if (pendingEntries.length === 0) {
    console.log(chalk.green('\n  All entries are synced!\n'));
    return;
  }

  console.log(chalk.yellow(`\n  ${pendingEntries.length} entries need to be synced.\n`));

  // Confirm sync
  const confirmed = await promptConfirm(
    `Upload ${pendingEntries.length} entries with auto-generated carrier images?`
  );
  if (!confirmed) {
    console.log(chalk.gray('\n  Sync cancelled.\n'));
    return;
  }

  // Sync entries
  const { carriers: carriersDir } = getVaultPaths();
  await fs.mkdir(carriersDir, { recursive: true });

  const folderId = await getSlasshyFolder();
  let uploaded = 0;

  for (const entryId of pendingEntries) {
    const entry = await getEntry(entryId);
    if (!entry) continue;

    const syncSpinner = ora(`Syncing "${entry.title}"...`).start();

    try {
      // Encrypt entry
      const entryKey = getEntryKey();
      const encryptedEntry = encryptObject(entry, entryKey, entryId);
      const entryBuffer = Buffer.from(encryptedEntry, 'utf-8');

      // Fragment data
      const fragments = fragmentData(entryBuffer);
      const driveFileIds: string[] = [];

      for (const fragment of fragments) {
        // Serialize fragment
        const serialized = serializeFragment(fragment);

        // Generate carrier image with enough capacity
        const carrierFilename = `carrier_${Date.now()}_${randomInt(1000, 9999)}.png`;
        const carrierPath = path.join(carriersDir, carrierFilename);

        await generateCarrierImage(carrierPath, serialized.length + 1000);

        // Embed data in carrier
        const outputFilename = generateFilename('png');
        const outputPath = path.join(carriersDir, outputFilename);

        await embedInPNG(carrierPath, serialized, outputPath);

        // Clean up carrier
        await fs.unlink(carrierPath).catch(() => {});

        // Random delay (anti-pattern detection)
        await new Promise(r => setTimeout(r, randomInt(500, 2000)));

        // Upload
        const fileId = await uploadFile(outputPath, outputFilename, 'image/png', folderId);
        driveFileIds.push(fileId);

        // Cleanup output
        await fs.unlink(outputPath).catch(() => {});
      }

      // Update index
      vaultIndex.entries[entryId]!.fragments = driveFileIds;

      syncSpinner.succeed(`Synced "${entry.title}"`);
      uploaded++;
    } catch (error) {
      syncSpinner.fail(`Failed to sync "${entry.title}"`);
      if (error instanceof Error) {
        console.log(chalk.red(`    ${error.message}`));
      }
    }
  }

  // Save updated index
  await updateVaultIndex({ lastSync: Date.now() });

  console.log(chalk.green(`\n  Sync complete! ${uploaded} entries uploaded.`));
  console.log(chalk.gray('  Your data is hidden in auto-generated images on Google Drive.\n'));
}
