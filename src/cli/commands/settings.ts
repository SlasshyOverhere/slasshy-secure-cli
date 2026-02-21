import chalk from 'chalk';
import {
  getCloudStorageMode,
  setCloudStorageMode,
  getPublicContentFolderName,
  setPublicContentFolderName,
  type CloudStorageMode
} from '../../storage/drive/index.js';
import { describeCloudStorageMode, promptCloudStorageMode, promptPublicContentFolderName } from '../cloudStorageSetup.js';

function normalizeMode(input?: string): CloudStorageMode | null {
  if (!input) {
    return null;
  }

  const value = input.trim().toLowerCase();
  if (value === 'hidden') {
    return 'hidden';
  }
  if (value === 'public') {
    return 'public';
  }
  return null;
}

function normalizeFolderName(input?: string): string | null {
  if (!input) {
    return null;
  }

  const value = input.trim();
  if (!value || value.includes('/') || value.includes('\\')) {
    return null;
  }

  return value;
}

export async function settingsCommand(options?: { storage?: string; folder?: string }): Promise<void> {
  console.log(chalk.bold('\n  Settings\n'));

  const currentMode = await getCloudStorageMode();
  const currentFolderName = await getPublicContentFolderName();
  console.log(chalk.gray(`  Cloud storage mode: ${describeCloudStorageMode(currentMode)}`));
  if (currentMode === 'public') {
    console.log(chalk.gray(`  Public folder: BlankDrive/${currentFolderName || '<not configured>'}`));
  }

  let nextMode = currentMode;
  let nextFolderName = currentFolderName;

  if (options?.storage) {
    const parsed = normalizeMode(options.storage);
    if (!parsed) {
      console.log(chalk.red('\n  Invalid storage mode. Use "hidden" or "public".\n'));
      return;
    }
    nextMode = parsed;
  } else if (!options?.folder) {
    nextMode = await promptCloudStorageMode(currentMode);
  }

  if (options?.folder) {
    const parsedFolderName = normalizeFolderName(options.folder);
    if (!parsedFolderName) {
      console.log(chalk.red('\n  Invalid folder name. It must be non-empty and cannot include "/" or "\\".\n'));
      return;
    }
    nextFolderName = parsedFolderName;
  } else if (nextMode === 'public') {
    nextFolderName = await promptPublicContentFolderName(currentFolderName || undefined);
  }

  const shouldUpdateFolder = !!nextFolderName && nextFolderName !== currentFolderName;

  if (nextMode === currentMode && !shouldUpdateFolder) {
    console.log(chalk.gray('\n  No changes made.\n'));
    return;
  }

  if (nextMode !== currentMode) {
    await setCloudStorageMode(nextMode);
    console.log(chalk.green(`\n  Updated cloud storage mode to: ${describeCloudStorageMode(nextMode)}`));
  }

  if (shouldUpdateFolder && nextFolderName) {
    await setPublicContentFolderName(nextFolderName);
    if (nextMode === 'public') {
      console.log(chalk.green(`  Updated public folder path to: BlankDrive/${nextFolderName}`));
    } else {
      console.log(chalk.green(`  Saved public folder name for future use: BlankDrive/${nextFolderName}`));
    }
  }

  console.log(chalk.yellow('  Note: Existing cloud files are not migrated automatically.'));
  console.log(chalk.gray('  New uploads will use the updated settings.\n'));
}
