import chalk from 'chalk';
import ora from 'ora';
import {
  vaultExists,
  unlock,
  listEntries,
  isUnlocked,
  getVaultIndex,
} from '../../storage/vault/index.js';
import { promptPassword } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function listCommand(options?: { filter?: string; type?: string }): Promise<void> {
  // Check vault exists
  if (!await vaultExists()) {
    console.log(chalk.red('\n  No vault found. Run "slasshy init" first.\n'));
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

  // Get entries
  const spinner = ora('Loading entries...').start();

  try {
    let entries = await listEntries();
    const vaultIndex = getVaultIndex();
    spinner.stop();

    // Filter by type if specified
    if (options?.type && vaultIndex) {
      const typeFilter = options.type.toLowerCase();
      if (typeFilter === 'files' || typeFilter === 'file') {
        entries = entries.filter(e => vaultIndex.entries[e.id]?.entryType === 'file');
      } else if (typeFilter === 'passwords' || typeFilter === 'password') {
        entries = entries.filter(e => vaultIndex.entries[e.id]?.entryType !== 'file');
      }
    }

    // Filter by title if specified
    if (options?.filter) {
      const filterLower = options.filter.toLowerCase();
      entries = entries.filter(e => e.title.toLowerCase().includes(filterLower));
    }

    if (entries.length === 0) {
      console.log(chalk.yellow('\n  No entries found.\n'));
      console.log(chalk.gray('  Use "slasshy add" for passwords or "slasshy upload" for files.\n'));
      return;
    }

    // Separate files and passwords
    const fileEntries = entries.filter(e => vaultIndex?.entries[e.id]?.entryType === 'file');
    const passwordEntries = entries.filter(e => vaultIndex?.entries[e.id]?.entryType !== 'file');

    // Display password entries
    if (passwordEntries.length > 0) {
      console.log('');
      console.log(chalk.bold(`  Passwords (${passwordEntries.length})`));
      console.log(chalk.gray('  ' + '─'.repeat(50)));

      const maxTitleLen = Math.min(30, Math.max(...passwordEntries.map(e => e.title.length)));

      for (const entry of passwordEntries) {
        const title = entry.title.length > 30
          ? entry.title.substring(0, 27) + '...'
          : entry.title.padEnd(maxTitleLen);
        const date = new Date(entry.modified).toLocaleDateString();

        console.log(`  ${chalk.cyan('🔐')} ${chalk.cyan(title)}  ${chalk.gray(date)}`);
      }
    }

    // Display file entries
    if (fileEntries.length > 0) {
      console.log('');
      console.log(chalk.bold(`  Files (${fileEntries.length})`));
      console.log(chalk.gray('  ' + '─'.repeat(50)));

      const maxTitleLen = Math.min(25, Math.max(...fileEntries.map(e => e.title.length)));

      for (const entry of fileEntries) {
        const indexEntry = vaultIndex?.entries[entry.id];
        const title = entry.title.length > 25
          ? entry.title.substring(0, 22) + '...'
          : entry.title.padEnd(maxTitleLen);
        const size = indexEntry?.fileSize ? formatFileSize(indexEntry.fileSize) : '';
        const date = new Date(entry.modified).toLocaleDateString();

        // Get file type icon
        const mimeType = indexEntry?.mimeType || '';
        let icon = '📄';
        if (mimeType.startsWith('image/')) icon = '🖼️';
        else if (mimeType.startsWith('video/')) icon = '🎬';
        else if (mimeType.startsWith('audio/')) icon = '🎵';
        else if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) icon = '📦';
        else if (mimeType.includes('pdf')) icon = '📕';

        console.log(`  ${chalk.magenta(icon)} ${chalk.magenta(title)}  ${chalk.gray(size.padEnd(10))} ${chalk.gray(date)}`);
      }
    }

    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(chalk.gray(`  Total: ${entries.length} entries (${passwordEntries.length} passwords, ${fileEntries.length} files)\n`));
  } catch (error) {
    spinner.fail('Failed to list entries');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
