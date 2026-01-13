import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import inquirer from 'inquirer';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  vaultExists,
  unlock,
  isUnlocked,
  addFileEntry,
  getVaultIndex,
  updateVaultIndex,
  cleanupTempFiles,
} from '../../storage/vault/index.js';
import { initializeKeyManager } from '../../crypto/index.js';
import { promptPassword } from '../prompts.js';
import { createProgressTracker } from '../progress.js';
import { ensureAuthenticated } from '../ensureAuth.js';
import {
  uploadFileToCloud,
  isCloudSyncAvailable,
} from '../../storage/drive/index.js';

const execAsync = promisify(exec);

/**
 * Open file picker dialog (Windows)
 */
async function openFilePicker(): Promise<string | null> {
  if (process.platform !== 'win32') {
    console.log(chalk.yellow('  File picker is only available on Windows.'));
    return null;
  }

  try {
    console.log(chalk.gray('  Opening file picker...'));

    // Use a temp file to avoid encoding issues with stdout
    const tempFile = path.join(process.env.TEMP || '.', `slasshy_picker_${Date.now()}.txt`);

    const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Title = 'Select file to upload'
$f.Filter = 'All Files (*.*)|*.*'
$f.Multiselect = $false
$result = $f.ShowDialog()
if ($result -eq 'OK') {
  [System.IO.File]::WriteAllText('${tempFile.replace(/\\/g, '\\\\')}', $f.FileName, [System.Text.Encoding]::UTF8)
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
    console.log(chalk.yellow('  Could not open file picker.'));
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

  // Auto-authenticate with Google Drive (also handles vault unlock)
  if (!await ensureAuthenticated()) {
    return;
  }

  // Get file path
  let filePath = filePathArg;

  if (!filePath) {
    console.log(chalk.gray('  Tip: Type "browse" to open file picker, or drag & drop a file\n'));

    const { inputPath } = await inquirer.prompt<{ inputPath: string }>([
      {
        type: 'input',
        name: 'inputPath',
        message: 'File path:',
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

  // Check if user wants to browse for file
  if (filePath.toLowerCase() === 'browse' || filePath.toLowerCase() === 'select') {
    const selectedFile = await openFilePicker();
    if (selectedFile) {
      filePath = selectedFile;
      console.log(chalk.green(`  Selected: ${filePath}`));
    } else {
      console.log(chalk.gray('\n  Upload cancelled.\n'));
      return;
    }
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
        progressTracker.setProgress(bytesProcessed, totalBytes);
      }
    );

    // Finish encryption progress
    progressTracker.finish();

    console.log('');
    console.log(chalk.green('  ✓ File encrypted successfully!'));

    // Upload to cloud (auth is already verified at start)
    console.log('');
    console.log(chalk.gray('  Uploading to cloud...\n'));

    try {
      const vaultIndex = getVaultIndex();
      const indexEntry = vaultIndex?.entries[entry.id];
      const chunkCount = indexEntry?.chunkCount || 1;

      // Create cloud upload progress bar
      const cloudProgressTracker = createProgressTracker('Uploading', fileSize);

      // Upload and get cloud chunks info
      const cloudChunks = await uploadFileToCloud(entry.id, chunkCount, (uploaded, total, bytesUploaded, totalBytes) => {
        cloudProgressTracker.setProgress(bytesUploaded, totalBytes);
      });

      cloudProgressTracker.finish();

      // Update index entry with cloud sync status AND cloud chunks
      if (vaultIndex && indexEntry) {
        indexEntry.cloudChunks = cloudChunks;
        indexEntry.cloudSyncStatus = 'synced';
        indexEntry.cloudSyncedAt = Date.now();
        await updateVaultIndex({ lastSync: Date.now() });
      }

      console.log('');
      console.log(chalk.green('  ✓ Uploaded to cloud!'));

      // Clean up temp files after successful cloud upload
      await cleanupTempFiles(entry.id, chunkCount);
    } catch (error) {
      console.log('');
      console.log(chalk.red('  ✗ Cloud upload failed'));
      if (error instanceof Error) {
        console.log(chalk.yellow(`  ${error.message}`));
      }
    }

    console.log('');
    console.log(chalk.green('  File Details:'));
    console.log(chalk.gray(`  Title: ${entry.title}`));
    console.log(chalk.gray(`  Original name: ${entry.originalName}`));
    console.log(chalk.gray(`  Size: ${formatFileSize(entry.size)}`));
    console.log(chalk.gray(`  Type: ${entry.mimeType}`));
    console.log('');
  } catch (error) {
    progressTracker.bar.stop();
    console.log('');
    console.log(chalk.red('  ✗ Failed to upload file'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
