/**
 * Ensure user is authenticated with Google Drive
 * Auto-triggers auth flow if not authenticated
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  isAuthenticated,
  authenticateDrive,
  performOAuthFlow,
  setOAuthServerUrl,
  getOAuthServerUrl,
  isOAuthServerConfigured,
} from '../storage/drive/index.js';
import {
  vaultExists,
  unlock,
  isUnlocked,
} from '../storage/vault/index.js';
import { initializeKeyManager } from '../crypto/index.js';
import { promptPassword } from './prompts.js';

const execAsync = promisify(exec);

/**
 * Open URL in default browser
 */
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;

  let command: string;
  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  try {
    await execAsync(command);
  } catch {
    console.log(chalk.yellow(`\n  Please open this URL in your browser:`));
    console.log(chalk.cyan(`  ${url}\n`));
  }
}

/**
 * Validate backend URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Prompt for backend URL
 */
async function promptBackendUrl(): Promise<string> {
  console.log(chalk.yellow('\n  Backend OAuth Server Setup'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.gray('  You need to provide your OAuth backend server URL.'));
  console.log(chalk.gray('  This server handles Google OAuth authentication.'));
  console.log(chalk.gray('  Example: https://your-oauth-server.onrender.com\n'));

  const { backendUrl } = await inquirer.prompt<{ backendUrl: string }>([
    {
      type: 'input',
      name: 'backendUrl',
      message: 'Backend OAuth server URL:',
      validate: (input: string) => {
        const trimmed = input.trim();
        if (!trimmed) {
          return 'Backend URL is required';
        }
        if (!isValidUrl(trimmed)) {
          return 'Please enter a valid URL (e.g., https://your-server.com)';
        }
        return true;
      },
    },
  ]);

  // Remove trailing slash if present
  return backendUrl.trim().replace(/\/+$/, '');
}

/**
 * Ensure user is authenticated with Google Drive
 * Handles vault unlock and auth flow automatically
 * Returns true if authenticated, false if auth failed/cancelled
 */
export async function ensureAuthenticated(): Promise<boolean> {
  // Step 1: Check vault exists
  if (!await vaultExists()) {
    console.log(chalk.red('  No vault found. Run "slasshy init" first.\n'));
    return false;
  }

  // Step 2: Unlock vault if needed (required for token encryption)
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
      return false;
    }
  }

  // Step 3: If already authenticated, just initialize the client
  if (await isAuthenticated()) {
    try {
      await authenticateDrive();
      return true;
    } catch {
      // Token might be expired/invalid, continue to re-auth
      console.log(chalk.yellow('  Session expired. Re-authenticating...\n'));
    }
  }

  // Step 4: Need to authenticate
  console.log(chalk.yellow('  Google Drive authentication required.\n'));

  // Check if backend URL is configured
  if (!await isOAuthServerConfigured()) {
    const backendUrl = await promptBackendUrl();
    await setOAuthServerUrl(backendUrl);
    console.log(chalk.green(`\n  Backend URL saved: ${backendUrl}\n`));
  } else {
    const currentUrl = await getOAuthServerUrl();
    console.log(chalk.gray(`  Using OAuth server: ${currentUrl}\n`));
  }

  // Perform OAuth flow
  console.log(chalk.gray('  Opening browser for Google authentication...\n'));

  const spinner = ora('Waiting for authorization...').start();

  try {
    await performOAuthFlow(openBrowser);
    spinner.succeed('Google Drive connected');
    console.log(chalk.green('\n  Successfully connected to Google Drive!\n'));
    return true;
  } catch (error) {
    spinner.fail('Authentication failed');
    if (error instanceof Error) {
      console.log(chalk.red(`\n  ${error.message}\n`));
    }
    return false;
  }
}
