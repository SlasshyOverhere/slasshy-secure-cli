import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import inquirer from 'inquirer';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  addFileEntry,
  getVaultIndex,
  updateVaultIndex,
  cleanupTempFiles,
} from '../../storage/vault/index.js';
import { createProgressTracker } from '../progress.js';
import { ensureAuthenticated } from '../ensureAuth.js';
import {
  uploadFileToCloud,
  getCloudStorageMode,
  setCloudStorageMode,
  getPublicContentFolderName,
  isPublicContentFolderNameConfigured,
  setPublicContentFolderName,
} from '../../storage/drive/index.js';
import { logAuditEvent } from '../auditLog.js';
import { isInDuressMode } from '../duress.js';
import { promptPublicContentFolderName } from '../cloudStorageSetup.js';

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

async function ensureUploadStorageTarget(): Promise<{ mode: 'hidden' | 'public'; folderName: string | null }> {
  let mode = await getCloudStorageMode();

  if (mode === 'hidden') {
    console.log(chalk.yellow('  Current cloud storage mode is hidden (appDataFolder).'));
    console.log(chalk.gray('  Files uploaded in hidden mode are encrypted but not visible in Google Drive UI.\n'));

    const { switchToPublic } = await inquirer.prompt<{ switchToPublic: boolean }>([
      {
        type: 'confirm',
        name: 'switchToPublic',
        message: 'Switch to visible mode for future uploads (BlankDrive/<folder>)?',
        default: true,
      },
    ]);

    if (switchToPublic) {
      await setCloudStorageMode('public');
      mode = 'public';
      console.log(chalk.green('  Cloud storage mode updated: public'));
    } else {
      console.log(chalk.gray('  Keeping hidden mode for this upload.'));
    }
  }

  let folderName = await getPublicContentFolderName();
  if (mode === 'public') {
    const hasSavedFolder = await isPublicContentFolderNameConfigured();
    const nextFolderName = await promptPublicContentFolderName(
      hasSavedFolder ? (folderName || undefined) : undefined
    );
    folderName = nextFolderName;
    await setPublicContentFolderName(nextFolderName);
    console.log(chalk.green(`  Upload folder set: BlankDrive/${nextFolderName}`));
  }

  if (mode === 'public') {
    const resolvedFolderName = folderName || 'vault-data';
    console.log(chalk.gray(`  Upload target: BlankDrive/${resolvedFolderName}/\n`));
  } else {
    console.log(chalk.gray('  Upload target: Hidden appDataFolder (not visible in Drive UI)\n'));
  }

  return { mode, folderName };
}

export async function uploadCommand(filePathArg?: string): Promise<void> {
  console.log(chalk.bold('\n  Upload File to Vault\n'));

  // Duress mode - pretend to upload
  if (isInDuressMode()) {
    let filePath = filePathArg;

    if (!filePath) {
      console.log(chalk.gray('  Tip: Type "browse" to open file picker, or drag & drop a file\n'));

      const { inputPath } = await inquirer.prompt<{ inputPath: string }>([
        {
          type: 'input',
          name: 'inputPath',
          message: 'File path:',
          validate: (input: string) => input.trim() ? true : 'File path is required',
        },
      ]);
      filePath = inputPath;
    }

    // Clean path
    filePath = filePath.trim().replace(/^["']|["']$/g, '');

    // Check if file exists (for realism)
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        console.log(chalk.red('  Error: Path is not a file.'));
        return;
      }

      console.log(chalk.gray(`\n  File: ${path.basename(filePath)}`));
      console.log(chalk.gray(`  Size: ${formatFileSize(stats.size)}`));
      console.log('');

      const defaultTitle = path.basename(filePath);
      const { title } = await inquirer.prompt<{ title: string }>([
        {
          type: 'input',
          name: 'title',
          message: 'Title (optional):',
          default: defaultTitle,
        },
      ]);

      console.log(chalk.gray('  Encrypting and storing file...\n'));

      const spinner = ora('Encrypting...').start();
      await new Promise(resolve => setTimeout(resolve, 1200));
      spinner.succeed('File encrypted successfully!');

      console.log('');
      console.log(chalk.gray('  Uploading to cloud...\n'));

      const uploadSpinner = ora('Uploading...').start();
      await new Promise(resolve => setTimeout(resolve, 800));
      uploadSpinner.succeed('Uploaded to cloud!');

      console.log('');
      console.log(chalk.green('  File Details:'));
      console.log(chalk.gray(`  Title: ${title || defaultTitle}`));
      console.log(chalk.gray(`  Original name: ${path.basename(filePath)}`));
      console.log(chalk.gray(`  Size: ${formatFileSize(stats.size)}`));
      console.log('');
    } catch {
      console.log(chalk.red(`  Error: File not found: ${filePath}`));
    }
    return;
  }

  // Auto-authenticate with Google Drive (also handles vault unlock)
  if (!await ensureAuthenticated()) {
    return;
  }

  const uploadTarget = await ensureUploadStorageTarget();

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
      if (uploadTarget.mode === 'public') {
        const resolvedFolderName = uploadTarget.folderName || 'vault-data';
        console.log(chalk.gray(`  Cloud location: Google Drive > BlankDrive/${resolvedFolderName}/`));
      } else {
        console.log(chalk.gray('  Cloud location: Hidden appDataFolder (not shown in Drive UI)'));
      }

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

    // Log audit event
    await logAuditEvent('file_uploaded', { entryId: entry.id, entryTitle: entry.title });
  } catch (error) {
    progressTracker.bar.stop();
    console.log('');
    console.log(chalk.red('  ✗ Failed to upload file'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
