import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  vaultExists,
  initVault,
  getVaultPaths,
  unlock,
} from '../../storage/vault/index.js';
import { promptPasswordConfirm, promptPassword } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import {
  isAuthenticated,
  authenticateDrive,
  isDriveConnected,
  findAppDataFile,
  downloadAppDataToBuffer,
  hasAppDataAccess,
} from '../../storage/drive/index.js';

// Cloud backup filename for vault index
const VAULT_INDEX_CLOUD_NAME = 'slasshy_vault_index_backup.enc';

export async function initCommand(options: { drive?: boolean; restore?: boolean }): Promise<void> {
  // Handle restore mode
  if (options.restore) {
    await restoreFromCloud();
    return;
  }

  console.log(chalk.bold('\n  Slasshy Vault Initialization\n'));

  // Check if vault already exists
  if (await vaultExists()) {
    console.log(chalk.red('  Vault already exists!'));
    console.log(chalk.gray('  Use "slasshy unlock" to access your vault.'));
    console.log(chalk.gray('  Or use "slasshy init --restore" to restore from cloud.\n'));
    return;
  }

  // Initialize key manager
  initializeKeyManager();

  // Get master password
  console.log(chalk.gray('  Choose a strong master password. This is the only password you need to remember.'));
  console.log(chalk.gray('  IMPORTANT: If you lose this password, your data cannot be recovered!\n'));

  let password: string;
  try {
    password = await promptPasswordConfirm();
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`\n  ${error.message}`));
    }
    return;
  }

  // Create vault
  const spinner = ora('Creating encrypted vault...').start();

  try {
    await initVault(password);
    spinner.succeed('Encrypted vault created');
  } catch (error) {
    spinner.fail('Failed to create vault');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // Success message
  console.log(chalk.green('\n  Vault initialized successfully!\n'));
  console.log(chalk.gray('  Quick start:'));
  console.log(chalk.white('    slasshy add      ') + chalk.gray('Add a new entry'));
  console.log(chalk.white('    slasshy list     ') + chalk.gray('List all entries'));
  console.log(chalk.white('    slasshy get      ') + chalk.gray('Retrieve an entry'));
  console.log(chalk.white('    slasshy auth     ') + chalk.gray('Connect to Google Drive'));
  console.log(chalk.white('    slasshy sync     ') + chalk.gray('Sync with Google Drive'));
  console.log('');

  if (options.drive) {
    console.log(chalk.yellow('  To connect Google Drive, run: slasshy auth\n'));
  }
}

/**
 * Restore vault from cloud backup
 */
async function restoreFromCloud(): Promise<void> {
  console.log(chalk.bold('\n  Restore Vault from Cloud\n'));

  // Check if vault already exists
  if (await vaultExists()) {
    console.log(chalk.yellow('  ⚠ A vault already exists locally.'));
    console.log(chalk.gray('  Delete ~/.slasshy folder first if you want to restore from cloud.\n'));
    return;
  }

  // Check if authenticated
  if (!await isAuthenticated()) {
    console.log(chalk.yellow('  Not connected to Google Drive.'));
    console.log(chalk.gray('  Run "slasshy auth" first to connect, then try restore again.\n'));
    return;
  }

  // Connect to Drive
  const connectSpinner = ora('Connecting to Google Drive...').start();
  try {
    initializeKeyManager();
    await authenticateDrive();
    connectSpinner.succeed('Connected to Google Drive');
  } catch (error) {
    connectSpinner.fail('Failed to connect to Google Drive');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // Check for appDataFolder access
  const accessSpinner = ora('Checking hidden storage access...').start();
  try {
    const hasAccess = await hasAppDataAccess();
    if (!hasAccess) {
      accessSpinner.fail('Hidden storage not available');
      console.log(chalk.yellow('\n  ⚠ You need to re-authenticate to enable hidden storage.'));
      console.log(chalk.gray('    Run "slasshy auth --logout" then "slasshy auth"\n'));
      return;
    }
    accessSpinner.succeed('Hidden storage available');
  } catch (error) {
    accessSpinner.fail('Failed to check hidden storage');
    return;
  }

  // Look for vault backup in cloud
  const searchSpinner = ora('Searching for vault backup in cloud...').start();
  try {
    const backupFileId = await findAppDataFile(VAULT_INDEX_CLOUD_NAME);

    if (!backupFileId) {
      searchSpinner.fail('No vault backup found in cloud');
      console.log(chalk.yellow('\n  No backup found. You may need to:'));
      console.log(chalk.gray('    1. Make sure you synced your vault before (slasshy sync)'));
      console.log(chalk.gray('    2. Use the same Google account you used before\n'));
      return;
    }

    searchSpinner.succeed('Vault backup found in cloud');
  } catch (error) {
    searchSpinner.fail('Failed to search for backup');
    return;
  }

  // Download the backup
  const downloadSpinner = ora('Downloading vault backup...').start();
  let vaultData: Buffer;
  try {
    const backupFileId = await findAppDataFile(VAULT_INDEX_CLOUD_NAME);
    vaultData = await downloadAppDataToBuffer(backupFileId!);
    downloadSpinner.succeed('Vault backup downloaded');
  } catch (error) {
    downloadSpinner.fail('Failed to download vault backup');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // Create local vault directory and save the backup
  const saveSpinner = ora('Restoring vault locally...').start();
  try {
    const { dir, index } = getVaultPaths();
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(dir, 'entries'), { recursive: true });
    await fs.mkdir(path.join(dir, 'files'), { recursive: true });
    await fs.writeFile(index, vaultData.toString('utf-8'), 'utf-8');
    saveSpinner.succeed('Vault restored locally');
  } catch (error) {
    saveSpinner.fail('Failed to restore vault');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // Verify by unlocking
  console.log(chalk.gray('\n  Enter your master password to verify the restore:\n'));

  const password = await promptPassword();
  const verifySpinner = ora('Verifying vault...').start();

  try {
    await unlock(password);
    verifySpinner.succeed('Vault verified and unlocked');
  } catch (error) {
    verifySpinner.fail('Failed to unlock vault - wrong password?');
    console.log(chalk.yellow('\n  The vault was restored but could not be unlocked.'));
    console.log(chalk.gray('  Make sure you\'re using the correct master password.\n'));
    return;
  }

  console.log(chalk.green('\n  ✓ Vault restored successfully!\n'));
  console.log(chalk.gray('  Your vault has been restored from the cloud backup.'));
  console.log(chalk.gray('  Run "slasshy sync" to download your encrypted files.\n'));
}
