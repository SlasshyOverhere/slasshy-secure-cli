import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  vaultExists,
  unlock,
  isUnlocked,
  listEntries,
  getFileEntry,
  getVaultIndex,
} from '../../storage/vault/index.js';
import { initializeKeyManager, getEntryKey } from '../../crypto/index.js';
import { promptPassword } from '../prompts.js';
import { createProgressTracker } from '../progress.js';
import { ensureAuthenticated } from '../ensureAuth.js';
import {
  isCloudSyncAvailable,
  streamDownloadToFile,
  getParallelismInfo,
} from '../../storage/drive/index.js';

const execAsync = promisify(exec);

/**
 * Open folder picker dialog (Windows)
 */
async function openFolderPicker(): Promise<string | null> {
  if (process.platform !== 'win32') {
    console.log(chalk.yellow('  Folder picker is only available on Windows.'));
    return null;
  }

  try {
    console.log(chalk.gray('  Opening folder picker...'));

    // Use a temp file to avoid encoding issues with stdout
    const tempFile = path.join(process.env.TEMP || '.', `slasshy_folder_${Date.now()}.txt`);

    const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = 'Select download folder'
$f.ShowNewFolderButton = $true
$result = $f.ShowDialog()
if ($result -eq 'OK') {
  [System.IO.File]::WriteAllText('${tempFile.replace(/\\/g, '\\\\')}', $f.SelectedPath, [System.Text.Encoding]::UTF8)
}
`.trim().replace(/\r?\n/g, '; ');

    await execAsync(`powershell -NoProfile -Command "${psScript}"`, {
      windowsHide: false,
      timeout: 120000,
    });

    // Read the path from temp file
    try {
      const selectedPath = (await fs.readFile(tempFile, 'utf-8')).trim();
      await fs.unlink(tempFile).catch(() => {}); // Clean up
      if (selectedPath && selectedPath.length > 0) {
        return selectedPath;
      }
    } catch {
      // Temp file not created = user cancelled
    }

    return null;
  } catch (error) {
    console.log(chalk.yellow('  Could not open folder picker.'));
    if (error instanceof Error) {
      console.log(chalk.gray(`  ${error.message}`));
    }
    return null;
  }
}

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

  // Auto-authenticate with Google Drive (also handles vault unlock)
  if (!await ensureAuthenticated()) {
    return;
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
    const queryLower = query.toLowerCase().trim();

    // Check if query is a number (simple index)
    const numIndex = parseInt(query, 10);
    if (!isNaN(numIndex) && numIndex > 0 && numIndex <= fileEntries.length) {
      // Use 1-based index
      selectedId = fileEntries[numIndex - 1]!.id;
    } else if (!isNaN(numIndex)) {
      // Number but out of range
      console.log(chalk.red(`  Invalid file number: ${numIndex}`));
      console.log(chalk.gray(`  Valid range: 1-${fileEntries.length}. Use "list" to see files.\n`));
      return;
    } else {
      // Search by title
      const matches = fileEntries.filter(e =>
        e.title.toLowerCase().includes(queryLower)
      );

      if (matches.length === 0) {
        console.log(chalk.red(`  No files matching "${query}" found.`));
        console.log(chalk.gray('  Use "list" to see available files.\n'));
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
            choices: matches.map((e, idx) => ({
              name: `${idx + 1}. ${e.title} (${formatFileSize(vaultIndex.entries[e.id]?.fileSize || 0)})`,
              value: e.id,
            })),
          },
        ]);
        selectedId = choice;
      }
    }
  } else {
    // No query, show all files
    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        type: 'list',
        name: 'choice',
        message: 'Select a file to download:',
        choices: fileEntries.map((e, idx) => ({
          name: `${idx + 1}. ${e.title} (${formatFileSize(vaultIndex.entries[e.id]?.fileSize || 0)})`,
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

  console.log(chalk.gray('  Tip: Type "browse" to open folder picker\n'));

  let { outputPath } = await inquirer.prompt<{ outputPath: string }>([
    {
      type: 'input',
      name: 'outputPath',
      message: 'Save to:',
      default: defaultPath,
    },
  ]);

  // Check if user wants to browse for folder
  if (outputPath.toLowerCase() === 'browse' || outputPath.toLowerCase() === 'select') {
    const selectedFolder = await openFolderPicker();
    if (selectedFolder) {
      outputPath = path.join(selectedFolder, fileEntry.originalName);
      console.log(chalk.green(`  Selected: ${outputPath}`));
    } else {
      console.log(chalk.gray('\n  Download cancelled.\n'));
      return;
    }
  }

  // If user entered a directory, append the original filename
  try {
    const pathStats = await fs.stat(outputPath);
    if (pathStats.isDirectory()) {
      outputPath = path.join(outputPath, fileEntry.originalName);
      console.log(chalk.gray(`  Saving as: ${outputPath}`));
    }
  } catch {
    // Path doesn't exist yet - check if it looks like a directory (ends with slash or no extension)
    if (outputPath.endsWith(path.sep) || outputPath.endsWith('/')) {
      outputPath = path.join(outputPath, fileEntry.originalName);
    }
  }

  // Check if file exists (only check files, not directories)
  try {
    const fileStats = await fs.stat(outputPath);
    if (fileStats.isFile()) {
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
    }
  } catch {
    // File doesn't exist, continue
  }

  // Stream download directly from cloud to file
  console.log('');
  const indexEntry = vaultIndex?.entries[selectedId];

  // Check cloud chunks availability
  const cloudChunks = indexEntry?.cloudChunks || [];
  if (cloudChunks.length === 0) {
    console.log(chalk.red('  File not synced to cloud.'));
    console.log(chalk.gray('  The file data is not available.\n'));
    return;
  }

  // Check cloud sync is available
  if (!await isCloudSyncAvailable()) {
    console.log(chalk.red('  Cloud sync not available.'));
    console.log(chalk.gray('  Run "slasshy auth" to connect your Google account.\n'));
    return;
  }

  // Show adaptive parallelism info
  const { level: parallelism, memoryMB } = getParallelismInfo();
  console.log(chalk.gray(`  Available RAM: ${memoryMB} MB → Using ${parallelism} parallel stream${parallelism > 1 ? 's' : ''}`));
  console.log(chalk.gray('  Streaming from cloud & decrypting...'));
  console.log('');

  const progressTracker = createProgressTracker('Downloading', fileEntry.size);

  try {
    // Get the entry key for decryption
    const entryKey = getEntryKey();

    // Stream download: cloud → decrypt in memory → write to file
    await streamDownloadToFile(
      selectedId,
      cloudChunks,
      outputPath,
      entryKey,
      (bytesProcessed, totalBytes) => {
        progressTracker.setProgress(bytesProcessed, totalBytes);
      }
    );

    // Finish progress
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
