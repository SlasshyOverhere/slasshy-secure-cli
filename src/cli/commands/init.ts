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
  authenticateDrive,
  performOAuthFlow,
  getCloudStorageMode,
  isCloudStorageModeConfigured,
  getPublicContentFolderName,
  isPublicContentFolderNameConfigured,
  setPublicContentFolderName,
  setCloudStorageMode,
  isGoogleOAuthConfigured,
  setGoogleOAuthCredentials,
  setGoogleOAuthCredentialsForSession,
  persistCurrentGoogleTokens,
  findAppDataFile,
  downloadAppDataToBuffer,
  hasAppDataAccess,
} from '../../storage/drive/index.js';
import { logAuditEvent } from '../auditLog.js';
import { promptGoogleOAuthCredentials } from '../googleOAuthSetup.js';
import { promptCloudStorageMode, promptPublicContentFolderName } from '../cloudStorageSetup.js';
import { openExternalUrl } from '../openExternal.js';

// Cloud backup filename for vault index
const VAULT_INDEX_CLOUD_NAME = 'slasshy_vault_index_backup.enc';

/**
 * Open URL in default browser
 */
async function openBrowser(url: string): Promise<void> {
  try {
    await openExternalUrl(url);
  } catch {
    console.log(chalk.yellow(`\n  Please open this URL in your browser:`));
    console.log(chalk.cyan(`  ${url}\n`));
  }
}

export async function initCommand(options: { drive?: boolean; restore?: boolean }): Promise<void> {
  // Handle restore mode
  if (options.restore) {
    await restoreFromCloud();
    return;
  }

  console.log(chalk.bold('\n  BlankDrive Vault Initialization\n'));

  // Check if vault already exists
  if (await vaultExists()) {
    console.log(chalk.red('  Vault already exists!'));
    console.log(chalk.gray('  Use "BLANK unlock" to access your vault.'));
    console.log(chalk.gray('  Or use "BLANK init --restore" to restore from cloud.\n'));
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

    // Log vault creation
    await logAuditEvent('vault_created');
  } catch (error) {
    spinner.fail('Failed to create vault');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // First onboarding: choose cloud storage mode
  try {
    if (!await isCloudStorageModeConfigured()) {
      const selectedMode = await promptCloudStorageMode();
      await setCloudStorageMode(selectedMode);
      console.log(chalk.green(`\n  Cloud storage mode saved: ${selectedMode}`));
      if (selectedMode === 'public') {
        const folderName = await promptPublicContentFolderName();
        await setPublicContentFolderName(folderName);
        console.log(chalk.green(`  Public folder saved: BlankDrive/${folderName}`));
        console.log(chalk.gray('  Encrypted cloud files will be visible in Google Drive under "BlankDrive".'));
      } else {
        console.log(chalk.gray('  Encrypted cloud files will be hidden in appDataFolder.'));
      }
      console.log('');
    }
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.yellow(`  Could not save cloud storage mode: ${error.message}`));
    }
  }

  // Success message
  console.log(chalk.green('\n  Vault initialized successfully!\n'));
  console.log(chalk.gray('  Quick start:'));
  console.log(chalk.white('    BLANK add      ') + chalk.gray('Add a new entry'));
  console.log(chalk.white('    BLANK list     ') + chalk.gray('List all entries'));
  console.log(chalk.white('    BLANK get      ') + chalk.gray('Retrieve an entry'));
  console.log(chalk.white('    BLANK auth     ') + chalk.gray('Connect to Google Drive'));
  console.log(chalk.white('    BLANK sync     ') + chalk.gray('Sync with Google Drive'));
  console.log('');

  if (options.drive) {
    console.log(chalk.yellow('  To connect Google Drive, run: BLANK auth\n'));
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
    console.log(chalk.gray('  Delete the existing local vault folder first if you want to restore from cloud.\n'));
    return;
  }

  // Ensure key manager is available
  initializeKeyManager();

  // Ensure storage mode is configured for restore flow
  if (!await isCloudStorageModeConfigured()) {
    const selectedMode = await promptCloudStorageMode();
    await setCloudStorageMode(selectedMode);
    if (selectedMode === 'public') {
      const folderName = await promptPublicContentFolderName();
      await setPublicContentFolderName(folderName);
      console.log(chalk.green(`\n  Cloud storage mode saved: ${selectedMode}`));
      console.log(chalk.green(`  Public folder saved: BlankDrive/${folderName}\n`));
    } else {
      console.log(chalk.green(`\n  Cloud storage mode saved: ${selectedMode}\n`));
    }
  } else {
    const mode = await getCloudStorageMode();
    console.log(chalk.gray(`  Cloud storage mode: ${mode}\n`));

    if (mode === 'public' && !await isPublicContentFolderNameConfigured()) {
      const currentFolderName = await getPublicContentFolderName();
      const folderName = await promptPublicContentFolderName(currentFolderName || undefined);
      await setPublicContentFolderName(folderName);
      console.log(chalk.green(`  Public folder saved: BlankDrive/${folderName}\n`));
    }
  }

  // Connect to Drive (auto auth + auto prompt for credentials if needed)
  let promptedCredentials: { clientId: string; clientSecret: string } | null = null;
  const connectSpinner = ora('Connecting to Google Drive...').start();
  try {
    // Try existing encrypted session first
    try {
      await authenticateDrive();
      connectSpinner.succeed('Connected to Google Drive');
    } catch {
      connectSpinner.stop();

      if (!await isGoogleOAuthConfigured()) {
        promptedCredentials = await promptGoogleOAuthCredentials();
        setGoogleOAuthCredentialsForSession(
          promptedCredentials.clientId,
          promptedCredentials.clientSecret
        );
      }

      const authSpinner = ora('Opening browser for Google authentication...').start();
      await performOAuthFlow(openBrowser, { persistTokens: false });
      authSpinner.succeed('Connected to Google Drive');
    }
  } catch (error) {
    connectSpinner.fail('Failed to connect to Google Drive');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // Check for appDataFolder access
  const mode = await getCloudStorageMode();
  const accessSpinner = ora(mode === 'hidden' ? 'Checking hidden storage access...' : 'Checking public storage access...').start();
  try {
    const hasAccess = await hasAppDataAccess();
    if (!hasAccess) {
      accessSpinner.fail(mode === 'hidden' ? 'Hidden storage not available' : 'Public storage not available');
      console.log(chalk.yellow(`\n  ⚠ You need to re-authenticate to enable ${mode} storage.`));
      console.log(chalk.gray('    Run "BLANK auth --logout" then "BLANK auth"\n'));
      return;
    }
    accessSpinner.succeed(mode === 'hidden' ? 'Hidden storage available' : 'Public storage available');
  } catch (error) {
    accessSpinner.fail('Failed to check cloud storage access');
    return;
  }

  // Look for vault backup in cloud
  const searchSpinner = ora('Searching for vault backup in cloud...').start();
  try {
    const backupFileId = await findAppDataFile(VAULT_INDEX_CLOUD_NAME);

    if (!backupFileId) {
      searchSpinner.fail('No vault backup found in cloud');
      console.log(chalk.yellow('\n  No backup found. You may need to:'));
      console.log(chalk.gray('    1. Make sure you synced your vault before (BLANK sync)'));
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

  // Persist credentials/tokens securely now that vault keys are available
  const persistSpinner = ora('Saving Google authentication securely...').start();
  try {
    if (promptedCredentials) {
      await setGoogleOAuthCredentials(
        promptedCredentials.clientId,
        promptedCredentials.clientSecret
      );
    }
    await persistCurrentGoogleTokens();
    persistSpinner.succeed('Google authentication saved securely');
  } catch {
    persistSpinner.warn('Google session will require re-auth next time');
  }

  console.log(chalk.green('\n  ✓ Vault restored successfully!\n'));
  console.log(chalk.gray('  Your vault has been restored from the cloud backup.'));
  console.log(chalk.gray('  Run "BLANK sync" to download your encrypted files.\n'));
}
