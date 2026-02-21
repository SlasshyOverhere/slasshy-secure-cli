import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { promptConfirm, promptPassword } from '../prompts.js';
import {
  vaultExists,
  unlock,
  isUnlocked,
  getVaultPaths,
} from '../../storage/vault/index.js';
import { initializeKeyManager } from '../../crypto/index.js';
import {
  isAuthenticated,
  listAppDataFiles,
  deleteFromAppData,
} from '../../storage/drive/index.js';

const VAULT_DIR = path.join(os.homedir(), '.slasshy');

/**
 * Self-destruct command - completely wipes the vault (local + cloud)
 */
export async function destructCommand(): Promise<void> {
  console.log(chalk.red.bold('\n  ⚠️  SELF-DESTRUCT MODE  ⚠️\n'));
  console.log(chalk.red('  This will PERMANENTLY DELETE:'));
  console.log(chalk.red('    • All local vault data'));
  console.log(chalk.red('    • All encrypted files'));
  console.log(chalk.red('    • All cloud backups'));
  console.log(chalk.red('    • Your vault credentials\n'));
  console.log(chalk.yellow('  This action CANNOT be undone!\n'));

  // First confirmation
  const confirm1 = await promptConfirm('Are you absolutely sure you want to destroy everything?');
  if (!confirm1) {
    console.log(chalk.gray('\n  Self-destruct cancelled.\n'));
    return;
  }

  // Second confirmation with typing
  console.log(chalk.yellow('\n  Type "DESTROY" to confirm:'));
  const { confirmation } = await import('inquirer').then(m => m.default.prompt([
    {
      type: 'input',
      name: 'confirmation',
      message: '',
    },
  ]));

  if (confirmation !== 'DESTROY') {
    console.log(chalk.gray('\n  Self-destruct cancelled.\n'));
    return;
  }

  // Verify password if vault exists
  if (await vaultExists()) {
    console.log(chalk.gray('\n  Verify your identity:'));
    try {
      initializeKeyManager();
      const password = await promptPassword();
      await unlock(password);
    } catch {
      console.log(chalk.red('\n  ✗ Invalid password. Self-destruct cancelled.\n'));
      return;
    }
  }

  console.log('');
  const spinner = ora('Initiating self-destruct sequence...').start();

  try {
    // Step 1: Delete cloud data
    if (await isAuthenticated()) {
      spinner.text = 'Deleting cloud data...';
      try {
        const cloudFiles = await listAppDataFiles();
        for (const file of cloudFiles) {
          if (file.id) {
            await deleteFromAppData(file.id);
          }
        }
        spinner.text = `Deleted ${cloudFiles.length} cloud files`;
      } catch (error) {
        // Continue even if cloud deletion fails
        spinner.text = 'Could not delete cloud data (continuing...)';
      }
    }

    // Step 2: Delete local vault directory
    spinner.text = 'Deleting local vault...';
    try {
      await fs.rm(VAULT_DIR, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }

    // Step 3: Delete credentials
    spinner.text = 'Clearing credentials...';
    const credentialsPath = path.join(os.homedir(), '.slasshy-credentials.json');
    try {
      await fs.unlink(credentialsPath);
    } catch {
      // File might not exist
    }

    spinner.succeed(chalk.red('Self-destruct complete'));

    console.log('');
    console.log(chalk.red('  ════════════════════════════════════════'));
    console.log(chalk.red('  ║        VAULT DESTROYED               ║'));
    console.log(chalk.red('  ════════════════════════════════════════'));
    console.log('');
    console.log(chalk.gray('  All data has been permanently deleted.'));
    console.log(chalk.gray('  To create a new vault, run: BLANK init\n'));

  } catch (error) {
    spinner.fail('Self-destruct failed');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
