import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import inquirer from 'inquirer';
import {
  vaultExists,
  unlock,
  isUnlocked,
  addFileEntry,
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

/**
 * Clean file path from drag-drop (removes quotes and trims)
 */
function cleanFilePath(input: string): string {
  let cleaned = input.trim();
  // Remove surrounding quotes (single or double)
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  // Handle Windows drag-drop which may add & at the start
  if (cleaned.startsWith('& ')) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

export async function uploadCommand(filePathArg?: string): Promise<void> {
  console.log(chalk.bold('\n  Upload File to Vault\n'));

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

  // Get file path
  let filePath = filePathArg;

  if (!filePath) {
    console.log(chalk.gray('  Tip: Drag and drop a file into the terminal to paste its path!\n'));

    const { inputPath } = await inquirer.prompt<{ inputPath: string }>([
      {
        type: 'input',
        name: 'inputPath',
        message: 'File path (drag & drop):',
        validate: (input: string) => {
          if (!input.trim()) {
            return 'File path is required';
          }
          return true;
        },
      },
    ]);
    filePath = inputPath;
  }

  // Clean the file path
  filePath = cleanFilePath(filePath);

  // Validate file exists
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      console.log(chalk.red('  Error: Path is not a file.'));
      return;
    }

    console.log(chalk.gray(`\n  File: ${path.basename(filePath)}`));
    console.log(chalk.gray(`  Size: ${formatFileSize(stats.size)}`));
    console.log('');

    // Warn for large files
    if (stats.size > 100 * 1024 * 1024) { // 100MB
      console.log(chalk.yellow('  Warning: Large files may take longer to encrypt and sync.\n'));
    }
  } catch {
    console.log(chalk.red(`  Error: File not found: ${filePath}`));
    return;
  }

  // Get title (optional, defaults to filename)
  const defaultTitle = path.basename(filePath);
  const { title, notes } = await inquirer.prompt<{ title: string; notes: string }>([
    {
      type: 'input',
      name: 'title',
      message: 'Title (optional):',
      default: defaultTitle,
    },
    {
      type: 'input',
      name: 'notes',
      message: 'Notes (optional):',
    },
  ]);

  // Upload file with progress bar
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;

  console.log(chalk.gray('  Encrypting and storing file...\n'));
  const progressTracker = createProgressTracker('Encrypting', fileSize);

  try {
    const entry = await addFileEntry(
      title || defaultTitle,
      filePath,
      notes || undefined,
      (bytesProcessed, totalBytes) => {
        // Update progress bar based on actual progress
        const currentPercent = Math.round((bytesProcessed / totalBytes) * 100);
        progressTracker.bar.update(currentPercent, {
          transferred: formatFileSize(bytesProcessed),
          total: formatFileSize(totalBytes),
        });
      }
    );

    // Finish progress
    progressTracker.finish();

    console.log('');
    console.log(chalk.green('  ✓ File uploaded successfully!'));
    console.log('');
    console.log(chalk.green('  File Details:'));
    console.log(chalk.gray(`  Title: ${entry.title}`));
    console.log(chalk.gray(`  Original name: ${entry.originalName}`));
    console.log(chalk.gray(`  Size: ${formatFileSize(entry.size)}`));
    console.log(chalk.gray(`  Type: ${entry.mimeType}`));
    console.log(chalk.gray(`  ID: ${entry.id}`));
    console.log('');
    console.log(chalk.yellow('  Note: Run "slasshy sync" to upload to Google Drive.\n'));
  } catch (error) {
    progressTracker.bar.stop();
    console.log('');
    console.log(chalk.red('  ✗ Failed to upload file'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
