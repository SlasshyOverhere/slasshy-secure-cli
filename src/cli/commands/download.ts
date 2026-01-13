import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import {
  vaultExists,
  unlock,
  isUnlocked,
  listEntries,
  getFileEntry,
  getFileData,
  getVaultIndex,
} from '../../storage/vault/index.js';
import { initializeKeyManager } from '../../crypto/index.js';
import { promptPassword } from '../prompts.js';
import { createProgressTracker } from '../progress.js';

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function downloadCommand(query?: string): Promise<void> {
  console.log(chalk.bold('\n  Download File from Vault\n'));

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

  // Get vault index to filter file entries
  const vaultIndex = getVaultIndex();
  if (!vaultIndex) {
    console.log(chalk.red('  Vault not loaded.'));
    return;
  }

  // Get all entries and filter for files
  const allEntries = await listEntries();
  const fileEntries = allEntries.filter(entry => {
    const indexEntry = vaultIndex.entries[entry.id];
    return indexEntry?.entryType === 'file';
  });

  if (fileEntries.length === 0) {
    console.log(chalk.yellow('  No files found in vault.'));
    console.log(chalk.gray('  Use "slasshy upload" to add files.\n'));
    return;
  }

  // If query provided, search for matching files
  let selectedId: string;

  if (query) {
    const queryLower = query.toLowerCase();
    const matches = fileEntries.filter(e =>
      e.title.toLowerCase().includes(queryLower)
    );

    if (matches.length === 0) {
      console.log(chalk.red(`  No files matching "${query}" found.`));
      return;
    }

    if (matches.length === 1) {
      selectedId = matches[0]!.id;
    } else {
      // Multiple matches, let user choose
      const { choice } = await inquirer.prompt<{ choice: string }>([
        {
          type: 'list',
          name: 'choice',
          message: 'Multiple files found. Select one:',
          choices: matches.map(e => ({
            name: `${e.title} (${formatFileSize(vaultIndex.entries[e.id]?.fileSize || 0)})`,
            value: e.id,
          })),
        },
      ]);
      selectedId = choice;
    }
  } else {
    // No query, show all files
    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        type: 'list',
        name: 'choice',
        message: 'Select a file to download:',
        choices: fileEntries.map(e => ({
          name: `${e.title} (${formatFileSize(vaultIndex.entries[e.id]?.fileSize || 0)})`,
          value: e.id,
        })),
      },
    ]);
    selectedId = choice;
  }

  // Get file entry
  const fileEntry = await getFileEntry(selectedId);
  if (!fileEntry) {
    console.log(chalk.red('  File entry not found.'));
    return;
  }

  console.log('');
  console.log(chalk.gray(`  File: ${fileEntry.title}`));
  console.log(chalk.gray(`  Original name: ${fileEntry.originalName}`));
  console.log(chalk.gray(`  Size: ${formatFileSize(fileEntry.size)}`));
  console.log(chalk.gray(`  Type: ${fileEntry.mimeType}`));
  console.log('');

  // Get download location
  const defaultDir = path.join(os.homedir(), 'Downloads');
  const defaultPath = path.join(defaultDir, fileEntry.originalName);

  const { outputPath } = await inquirer.prompt<{ outputPath: string }>([
    {
      type: 'input',
      name: 'outputPath',
      message: 'Save to:',
      default: defaultPath,
    },
  ]);

  // Check if file exists
  try {
    await fs.access(outputPath);
    const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'File already exists. Overwrite?',
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.gray('\n  Download cancelled.\n'));
      return;
    }
  } catch {
    // File doesn't exist, continue
  }

  // Download file with progress bar
  console.log(chalk.gray('  Decrypting file...\n'));
  const progressTracker = createProgressTracker('Decrypting', fileEntry.size);

  try {
    // Simulate progress while decryption happens (decryption is memory-bound)
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let simulatedBytes = 0;
    const bytesPerTick = fileEntry.size / 20;

    progressInterval = setInterval(() => {
      if (simulatedBytes < fileEntry.size * 0.85) {
        const increment = Math.min(bytesPerTick, fileEntry.size * 0.85 - simulatedBytes);
        simulatedBytes += increment;
        progressTracker.update(increment);
      }
    }, 100);

    const fileData = await getFileData(selectedId);
    if (!fileData) {
      if (progressInterval) clearInterval(progressInterval);
      progressTracker.bar.stop();
      console.log('');
      console.log(chalk.red('  ✗ Failed to decrypt file data'));
      return;
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Write file
    await fs.writeFile(outputPath, fileData);

    // Clear interval and finish progress
    if (progressInterval) clearInterval(progressInterval);
    progressTracker.finish();

    console.log('');
    console.log(chalk.green('  ✓ File downloaded successfully!'));
    console.log('');
    console.log(chalk.green(`  Saved to: ${outputPath}`));
    console.log('');
  } catch (error) {
    progressTracker.bar.stop();
    console.log('');
    console.log(chalk.red('  ✗ Failed to download file'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
