import chalk from 'chalk';
import inquirer from 'inquirer';
import type { CloudStorageMode } from '../storage/drive/index.js';

const DEFAULT_PUBLIC_CONTENT_FOLDER_NAME = 'vault-data';

export async function promptCloudStorageMode(
  currentMode?: CloudStorageMode
): Promise<CloudStorageMode> {
  console.log(chalk.yellow('\n  Cloud Storage Mode'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.gray('  Choose where encrypted cloud files are stored in Google Drive.\n'));

  const { mode } = await inquirer.prompt<{ mode: CloudStorageMode }>([
    {
      type: 'list',
      name: 'mode',
      message: 'Storage mode:',
      default: currentMode || 'public',
      choices: [
        {
          name: 'Public folder (recommended) - store in "BlankDrive/<your-folder-name>/" (visible in Drive UI)',
          value: 'public',
        },
        {
          name: 'Hidden - use appDataFolder (not visible in Drive UI)',
          value: 'hidden',
        },
      ],
    },
  ]);

  return mode;
}

export function describeCloudStorageMode(mode: CloudStorageMode): string {
  return mode === 'hidden'
    ? 'Hidden (appDataFolder)'
    : 'Public (BlankDrive folder)';
}

export async function promptPublicContentFolderName(currentName?: string): Promise<string> {
  console.log(chalk.yellow('\n  Public Folder Name'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.gray('  Files will be stored under: BlankDrive/<folder-name>/\n'));

  const { folderName } = await inquirer.prompt<{ folderName: string }>([
    {
      type: 'input',
      name: 'folderName',
      message: 'Folder name inside BlankDrive:',
      default: currentName || DEFAULT_PUBLIC_CONTENT_FOLDER_NAME,
      validate: (input: string) => {
        const trimmed = input.trim();
        if (!trimmed) {
          return 'Folder name is required.';
        }
        if (trimmed.includes('/') || trimmed.includes('\\')) {
          return 'Folder name cannot include "/" or "\\".';
        }
        return true;
      },
    },
  ]);

  return folderName.trim();
}
