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
import { ensureAuthenticated } from '../ensureAuth.js';

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
  // Auto-authenticate with Google Drive (also handles vault unlock)
  if (!await ensureAuthenticated()) {
    return;
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
      console.log(chalk.gray('  ' + '─'.repeat(60)));

      passwordEntries.forEach((entry, index) => {
        const num = (index + 1).toString().padStart(2, ' ');
        const title = entry.title.length > 30
          ? entry.title.substring(0, 27) + '...'
          : entry.title;
        const date = new Date(entry.modified).toLocaleDateString();

        console.log(`  ${chalk.gray(num + '.')} ${chalk.cyan('🔐')} ${chalk.cyan(title.padEnd(30))}  ${chalk.gray(date)}`);
      });
    }

    // Display file entries
    if (fileEntries.length > 0) {
      console.log('');
      console.log(chalk.bold(`  Files (${fileEntries.length})`));
      console.log(chalk.gray('  ' + '─'.repeat(60)));

      fileEntries.forEach((entry, index) => {
        const indexEntry = vaultIndex?.entries[entry.id];
        const num = (index + 1).toString().padStart(2, ' ');
        const title = entry.title.length > 22
          ? entry.title.substring(0, 19) + '...'
          : entry.title;
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

        console.log(`  ${chalk.yellow(num + '.')} ${chalk.magenta(icon)} ${chalk.magenta(title.padEnd(22))}  ${chalk.gray(size.padEnd(10))} ${chalk.gray(date)}`);
      });
    }

    console.log(chalk.gray('  ' + '─'.repeat(60)));
    console.log(chalk.gray(`  Total: ${entries.length} entries (${passwordEntries.length} passwords, ${fileEntries.length} files)`));
    console.log(chalk.gray(`  Download files: dl <number> or dl <name>\n`));
  } catch (error) {
    spinner.fail('Failed to list entries');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
