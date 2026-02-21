import chalk from 'chalk';
import {
  vaultExists,
  isUnlocked,
  getStats,
  getVaultPaths,
} from '../../storage/vault/index.js';
import { isDriveConnected, getSyncStatus, getCloudStorageMode, getPublicContentFolderName } from '../../storage/drive/index.js';
import { isInDuressMode, getDecoyEntries } from '../duress.js';

export async function statusCommand(): Promise<void> {
  console.log(chalk.bold('\n  BlankDrive Vault Status\n'));

  // Duress mode - show fake status
  if (isInDuressMode()) {
    const decoyEntries = getDecoyEntries();
    const paths = getVaultPaths();

    console.log(`  ${chalk.gray('Vault:')}      ${chalk.green('Initialized')}`);
    console.log(`  ${chalk.gray('Location:')}   ${paths.dir}`);
    console.log(`  ${chalk.gray('Status:')}     ${chalk.green('Unlocked')}`);
    console.log(`  ${chalk.gray('Entries:')}    ${decoyEntries.length}`);
    console.log(`  ${chalk.gray('Created:')}    ${new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toLocaleString()}`);
    console.log(`  ${chalk.gray('Last sync:')}  ${new Date(Date.now() - 2 * 60 * 60 * 1000).toLocaleString()}`);

    console.log('');
    console.log(chalk.bold('  Google Drive'));
    console.log(chalk.gray('  ' + '─'.repeat(30)));
    console.log(`  ${chalk.gray('Connected:')}  ${chalk.green('Yes')}`);
    console.log(`  ${chalk.gray('Pending:')}    ${chalk.green('All synced')}`);
    console.log('');
    return;
  }

  const paths = getVaultPaths();

  // Check if vault exists
  const exists = await vaultExists();
  console.log(`  ${chalk.gray('Vault:')}      ${exists ? chalk.green('Initialized') : chalk.red('Not initialized')}`);

  if (!exists) {
    console.log(chalk.gray('\n  Run "BLANK init" to create a vault.\n'));
    return;
  }

  // Vault location
  console.log(`  ${chalk.gray('Location:')}   ${paths.dir}`);

  // Lock status
  const unlocked = isUnlocked();
  console.log(`  ${chalk.gray('Status:')}     ${unlocked ? chalk.green('Unlocked') : chalk.yellow('Locked')}`);

  // Entry count (if unlocked)
  if (unlocked) {
    const stats = getStats();
    if (stats) {
      console.log(`  ${chalk.gray('Entries:')}    ${stats.entryCount}`);
      console.log(`  ${chalk.gray('Created:')}    ${new Date(stats.created).toLocaleString()}`);

      if (stats.lastSync) {
        console.log(`  ${chalk.gray('Last sync:')}  ${new Date(stats.lastSync).toLocaleString()}`);
      } else {
        console.log(`  ${chalk.gray('Last sync:')}  ${chalk.yellow('Never')}`);
      }
    }
  }

  // Drive status
  console.log('');
  console.log(chalk.bold('  Google Drive'));
  console.log(chalk.gray('  ' + '─'.repeat(30)));

  const connected = isDriveConnected();
  console.log(`  ${chalk.gray('Connected:')}  ${connected ? chalk.green('Yes') : chalk.yellow('No')}`);
  try {
    const mode = await getCloudStorageMode();
    const modeLabel = mode === 'hidden' ? 'Hidden (appDataFolder)' : 'Public (BlankDrive folder)';
    console.log(`  ${chalk.gray('Mode:')}       ${chalk.cyan(modeLabel)}`);
    if (mode === 'public') {
      const folderName = await getPublicContentFolderName();
      console.log(`  ${chalk.gray('Folder:')}     ${chalk.cyan(`BlankDrive/${folderName || '<not configured>'}`)}`);
    }
  } catch {
    // Ignore mode display errors
  }

  if (unlocked && connected) {
    const syncStatus = getSyncStatus();
    if (syncStatus.pendingUploads > 0) {
      console.log(`  ${chalk.gray('Pending:')}    ${chalk.yellow(syncStatus.pendingUploads + ' entries need sync')}`);
    } else {
      console.log(`  ${chalk.gray('Pending:')}    ${chalk.green('All synced')}`);
    }
  }

  console.log('');
}
