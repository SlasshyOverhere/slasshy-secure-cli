/**
 * Ensure user is authenticated with Google Drive
 * Auto-triggers auth flow if not authenticated
 */

import chalk from 'chalk';
import ora from 'ora';
import {
  isAuthenticated,
  authenticateDrive,
  performOAuthFlow,
  setGoogleOAuthCredentials,
  isGoogleOAuthConfigured,
  getCloudStorageMode,
  isCloudStorageModeConfigured,
  getPublicContentFolderName,
  isPublicContentFolderNameConfigured,
  setPublicContentFolderName,
  setCloudStorageMode,
} from '../storage/drive/index.js';
import {
  vaultExists,
  unlock,
  isUnlocked,
  getVault2FAConfig,
  useBackupCode,
} from '../storage/vault/index.js';
import { initializeKeyManager } from '../crypto/index.js';
import { promptPassword } from './prompts.js';
import { logAuditEvent } from './auditLog.js';
import {
  verifyVault2FACode,
  verifyBackupCode,
  prompt2FACode,
} from './vault2fa.js';
import { isInDuressMode } from './duress.js';
import { promptGoogleOAuthCredentials } from './googleOAuthSetup.js';
import { promptCloudStorageMode, promptPublicContentFolderName } from './cloudStorageSetup.js';
import { openExternalUrl } from './openExternal.js';

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

/**
 * Ensure user is authenticated with Google Drive
 * Handles vault unlock and auth flow automatically
 * Returns true if authenticated, false if auth failed/cancelled
 */
export async function ensureAuthenticated(): Promise<boolean> {
  // Duress mode - skip auth, pretend everything is connected
  if (isInDuressMode()) {
    return true;
  }

  // Step 1: Check vault exists
  if (!await vaultExists()) {
    console.log(chalk.red('  No vault found. Run "BLANK init" first.\n'));
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

      // Check if 2FA is enabled
      const vault2FAConfig = getVault2FAConfig();
      if (vault2FAConfig?.enabled) {
        spinner.stop();
        console.log(chalk.cyan('\n  Two-factor authentication required.\n'));

        let authenticated = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!authenticated && attempts < maxAttempts) {
          attempts++;
          const code = await prompt2FACode();

          // Check if it's a backup code (format: XXXX-XXXX)
          if (/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(code.replace(/\s/g, ''))) {
            // Try as backup code
            if (vault2FAConfig.backupCodes) {
              const backupIndex = verifyBackupCode(code, vault2FAConfig.backupCodes);
              if (backupIndex >= 0) {
                // Valid backup code - use it (removes from list)
                await useBackupCode(backupIndex);
                authenticated = true;
                console.log(chalk.yellow('\n  Backup code used. ' + (vault2FAConfig.backupCodes.length - 1) + ' codes remaining.'));
                await logAuditEvent('vault_unlocked_backup_code');
              }
            }
          } else {
            // Try as TOTP code
            if (verifyVault2FACode(code, vault2FAConfig.secret)) {
              authenticated = true;
            }
          }

          if (!authenticated) {
            const remaining = maxAttempts - attempts;
            if (remaining > 0) {
              console.log(chalk.red(`  Invalid code. ${remaining} attempt(s) remaining.\n`));
            }
          }
        }

        if (!authenticated) {
          // Lock the vault since 2FA failed
          const { lock } = await import('../storage/vault/index.js');
          lock();
          await logAuditEvent('failed_2fa_attempt');
          console.log(chalk.red('\n  Too many failed 2FA attempts. Vault locked.\n'));
          return false;
        }

        console.log(chalk.green('  2FA verified successfully.\n'));
      }

      // Log successful unlock
      await logAuditEvent('vault_unlocked');
    } catch (error) {
      spinner.fail('Failed to unlock vault');

      // Log failed unlock attempt
      await logAuditEvent('failed_unlock_attempt');

      if (error instanceof Error) {
        console.log(chalk.red(`  ${error.message}`));
      }
      return false;
    }
  }

  // Step 3: Cloud storage onboarding (mode + required public folder name)
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

  // Step 4: Ensure Google OAuth client credentials exist before any auth attempt
  if (!await isGoogleOAuthConfigured()) {
    const credentials = await promptGoogleOAuthCredentials();
    await setGoogleOAuthCredentials(credentials.clientId, credentials.clientSecret);
    console.log(chalk.green('\n  Google OAuth credentials saved.\n'));
  }

  // Step 5: If already authenticated, initialize the client
  if (await isAuthenticated()) {
    try {
      await authenticateDrive();
      return true;
    } catch {
      // Token might be expired/invalid, continue to re-auth
      console.log(chalk.yellow('  Session expired. Re-authenticating...\n'));
    }
  }

  // Step 6: Need to authenticate
  console.log(chalk.yellow('  Google Drive authentication required.\n'));

  // Perform OAuth flow
  console.log(chalk.gray('  Opening browser for Google authentication...\n'));

  const spinner = ora('Waiting for authorization...').start();

  try {
    await performOAuthFlow(openBrowser);
    spinner.succeed('Google Drive connected');

    // Log successful authentication
    await logAuditEvent('auth_google_connected');

    console.log(chalk.green('\n  Successfully connected to Google Drive!\n'));
    return true;
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
          await logAuditEvent('auth_google_connected');
          console.log(chalk.green('\n  Successfully connected to Google Drive!\n'));
          return true;
        } catch (retryError) {
          retrySpinner.fail('Authentication failed');
          if (retryError instanceof Error) {
            console.log(chalk.red(`\n  ${retryError.message}\n`));
          }
          return false;
        }
      } catch (setupError) {
        if (setupError instanceof Error) {
          console.log(chalk.red(`\n  ${setupError.message}\n`));
        }
        return false;
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
    return false;
  }
}
