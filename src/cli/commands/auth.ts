import chalk from 'chalk';
import ora from 'ora';
import {
  performOAuthFlow,
  isAuthenticated,
  setGoogleOAuthCredentials,
  getGoogleOAuthCredentials,
  isGoogleOAuthConfigured,
  getCloudStorageMode,
  isCloudStorageModeConfigured,
  getPublicContentFolderName,
  isPublicContentFolderNameConfigured,
  setPublicContentFolderName,
  setCloudStorageMode,
  logout,
} from '../../storage/drive/index.js';
import {
  vaultExists,
  unlock,
  isUnlocked,
} from '../../storage/vault/index.js';
import { promptPassword, promptConfirm } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import { maskGoogleClientId, promptGoogleOAuthCredentials } from '../googleOAuthSetup.js';
import { promptCloudStorageMode, promptPublicContentFolderName } from '../cloudStorageSetup.js';
import { openExternalUrl } from '../openExternal.js';

/**
 * Detect OAuth client credential issues that require re-entering Client ID/Secret.
 */
function isGoogleCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const msg = error.message.toLowerCase();
  return msg.includes('invalid_client')
    || msg.includes('unauthorized_client')
    || msg.includes('deleted_client')
    || msg.includes('client secret')
    || msg.includes('oauth credentials not configured');
}

/**
 * Detect common redirect URI mismatch signal from OAuth flow timeout context.
 */
function isLikelyRedirectMismatch(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return msg.includes('timed out') || msg.includes('redirect_uri_mismatch');
}

/**
 * Open URL in default browser
 */
async function openBrowser(url: string): Promise<void> {
  try {
    await openExternalUrl(url);
  } catch {
    console.log(chalk.yellow(`\n  Please open this URL in your browser:`));
    console.log(chalk.cyan(`  ${url}\n`));
  }
}

export async function authCommand(options?: {
  setup?: boolean;
  logout?: boolean;
}): Promise<void> {
  console.log(chalk.bold('\n  Google Drive Authentication\n'));

  if (options?.logout) {
    const spinner = ora('Logging out...').start();
    try {
      await logout();
      spinner.succeed('Logged out from Google Drive');
      console.log(chalk.gray('\n  Your Google Drive tokens have been removed.\n'));
    } catch (error) {
      spinner.fail('Logout failed');
      if (error instanceof Error) {
        console.log(chalk.red(`  ${error.message}`));
      }
    }
    return;
  }

  // Check if vault exists (needed for token encryption)
  if (!await vaultExists()) {
    console.log(chalk.red('  No vault found. Run "BLANK init" first.'));
    console.log(chalk.gray('  The vault is needed to securely store your Google Drive tokens.\n'));
    return;
  }

  // Unlock vault if needed
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

  await authenticateGoogleDrive(options?.setup === true);
}

/**
 * Authenticate with Google Drive
 */
async function authenticateGoogleDrive(forceSetup: boolean = false): Promise<void> {
  if (!await isCloudStorageModeConfigured()) {
    const selectedMode = await promptCloudStorageMode();
    await setCloudStorageMode(selectedMode);
    console.log(chalk.green(`\n  Cloud storage mode saved: ${selectedMode}\n`));

    if (selectedMode === 'public') {
      const folderName = await promptPublicContentFolderName();
      await setPublicContentFolderName(folderName);
      console.log(chalk.green(`  Public folder saved: BlankDrive/${folderName}\n`));
    }
  }

  const cloudMode = await getCloudStorageMode();
  if (cloudMode === 'public' && !await isPublicContentFolderNameConfigured()) {
    const currentFolderName = await getPublicContentFolderName();
    const folderName = await promptPublicContentFolderName(currentFolderName || undefined);
    await setPublicContentFolderName(folderName);
    console.log(chalk.green(`\n  Public folder saved: BlankDrive/${folderName}\n`));
  }

  const credentialsConfigured = await isGoogleOAuthConfigured();

  if (!credentialsConfigured || forceSetup) {
    const credentials = await promptGoogleOAuthCredentials();
    await setGoogleOAuthCredentials(credentials.clientId, credentials.clientSecret);
    console.log(chalk.green('\n  Google OAuth credentials saved.'));
    console.log(chalk.gray('  Stored locally in encrypted form.\n'));
  } else {
    const credentials = await getGoogleOAuthCredentials();
    if (credentials) {
      console.log(chalk.gray(`  Using Google OAuth Client ID: ${maskGoogleClientId(credentials.clientId)}`));
      console.log(chalk.gray('  Use "BLANK auth --setup" to update credentials.\n'));
    }
  }

  // Check if already authenticated
  if (await isAuthenticated()) {
    console.log(chalk.yellow('  Already authenticated with Google Drive.'));
    const reauth = await promptConfirm('Re-authenticate?');
    if (!reauth) {
      console.log(chalk.gray('\n  Use "BLANK auth --logout" to disconnect.\n'));
      return;
    }
  }

  // Perform OAuth flow
  console.log(chalk.gray('  Opening browser for Google authentication...\n'));

  const spinner = ora('Waiting for authorization...').start();

  try {
    await performOAuthFlow(openBrowser);
    spinner.succeed('Google Drive connected');

    console.log(chalk.green('\n  Successfully connected to Google Drive!'));
    console.log(chalk.gray('  Your tokens are encrypted and stored locally.'));
    console.log(chalk.gray('\n  You can now use "BLANK sync" to upload your entries.\n'));
  } catch (error) {
    spinner.fail('Authentication failed');

    if (isGoogleCredentialError(error)) {
      console.log(chalk.yellow('\n  Your saved Google OAuth credentials are missing or invalid.'));
      console.log(chalk.gray('  Please enter your Google Client ID and Client Secret again.\n'));

      try {
        const credentials = await promptGoogleOAuthCredentials();
        await setGoogleOAuthCredentials(credentials.clientId, credentials.clientSecret);
        console.log(chalk.green('\n  Google OAuth credentials updated.\n'));

        const retrySpinner = ora('Retrying Google authorization...').start();
        try {
          await performOAuthFlow(openBrowser);
          retrySpinner.succeed('Google Drive connected');
          console.log(chalk.green('\n  Successfully connected to Google Drive!'));
          console.log(chalk.gray('  Your tokens are encrypted and stored locally.'));
          console.log(chalk.gray('\n  You can now use "BLANK sync" to upload your entries.\n'));
          return;
        } catch (retryError) {
          retrySpinner.fail('Authentication failed');
          if (retryError instanceof Error) {
            console.log(chalk.red(`\n  ${retryError.message}\n`));
          }
          return;
        }
      } catch (setupError) {
        if (setupError instanceof Error) {
          console.log(chalk.red(`\n  ${setupError.message}\n`));
        }
        return;
      }
    }

    if (isLikelyRedirectMismatch(error)) {
      console.log(chalk.yellow('\n  OAuth callback did not complete.'));
      console.log(chalk.gray('  Likely cause: redirect_uri_mismatch.'));
      console.log(chalk.gray('  Fix: Create Google OAuth credentials as "Desktop app" (not "Web application").'));
      console.log(chalk.gray('  Then run: BLANK auth --setup\n'));
    }

    if (error instanceof Error) {
      console.log(chalk.red(`\n  ${error.message}\n`));
    }
  }
}
