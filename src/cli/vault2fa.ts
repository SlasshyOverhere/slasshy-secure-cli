/**
 * Vault 2FA Protection
 *
 * Protects the vault itself with TOTP-based two-factor authentication.
 * When enabled, users must enter both their master password AND a 6-digit
 * code from Google Authenticator (or any TOTP app) to unlock the vault.
 *
 * This is NOT for storing website 2FA codes - see totp.ts for that.
 * This protects YOUR vault with an extra layer of security.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import crypto from 'crypto';
import qrcode from 'qrcode-terminal';
import {
  generateTOTPCodeSync,
  validateTOTPSecret,
  cleanTOTPSecret,
  getTimeRemaining,
} from './totp.js';

const BACKUP_CODE_PBKDF2_ITERATIONS = 150000;
const BACKUP_CODE_PBKDF2_KEYLEN = 32;
const BACKUP_CODE_PBKDF2_DIGEST = 'sha256';

function normalizeBackupCode(code: string): string {
  return code.replace(/-/g, '').toUpperCase();
}

function deriveBackupCodeHash(code: string, saltHex: string): string {
  return crypto.pbkdf2Sync(
    code,
    Buffer.from(saltHex, 'hex'),
    BACKUP_CODE_PBKDF2_ITERATIONS,
    BACKUP_CODE_PBKDF2_KEYLEN,
    BACKUP_CODE_PBKDF2_DIGEST
  ).toString('hex');
}

function secureHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length || (a.length % 2 !== 0) || (b.length % 2 !== 0)) {
    return false;
  }

  const aBuffer = Buffer.from(a, 'hex');
  const bBuffer = Buffer.from(b, 'hex');
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Vault 2FA configuration stored in vault metadata
 */
export interface Vault2FAConfig {
  enabled: boolean;
  secret: string; // Base32 encoded TOTP secret
  enabledAt: number; // Timestamp when 2FA was enabled
  backupCodes?: string[]; // Emergency backup codes (hashed)
}

/**
 * Generate a new TOTP secret for vault 2FA
 * Returns a base32-encoded secret suitable for Google Authenticator
 */
export function generateVault2FASecret(): string {
  // Generate 20 random bytes (160 bits) for the secret
  const bytes = crypto.randomBytes(20);

  // Encode as base32
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';

  // Convert bytes to base32
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }

  for (let i = 0; i + 5 <= bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5);
    secret += base32chars[parseInt(chunk, 2)];
  }

  return secret;
}

/**
 * Generate backup codes for emergency access
 * Returns array of 8-character alphanumeric codes
 */
export function generateBackupCodes(count: number = 8): string[] {
  const codes: string[] = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars

  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += chars[crypto.randomInt(chars.length)];
    }
    // Format as XXXX-XXXX for readability
    codes.push(code.slice(0, 4) + '-' + code.slice(4));
  }

  return codes;
}

/**
 * Hash a backup code for storage
 */
export function hashBackupCode(code: string): string {
  const normalized = normalizeBackupCode(code);
  const saltHex = crypto.randomBytes(16).toString('hex');
  const derivedHex = deriveBackupCodeHash(normalized, saltHex);
  return `${saltHex}:${derivedHex}`;
}

/**
 * Verify a backup code against stored hashes
 */
export function verifyBackupCode(code: string, hashedCodes: string[]): number {
  const normalized = normalizeBackupCode(code);

  for (let i = 0; i < hashedCodes.length; i++) {
    const stored = hashedCodes[i];
    if (!stored) {
      continue;
    }

    // New format: "saltHex:derivedHex"
    const splitIndex = stored.indexOf(':');
    if (splitIndex > 0) {
      const saltHex = stored.slice(0, splitIndex);
      const expectedHex = stored.slice(splitIndex + 1);
      if (saltHex.length === 32 && expectedHex.length === (BACKUP_CODE_PBKDF2_KEYLEN * 2)) {
        const actualHex = deriveBackupCodeHash(normalized, saltHex);
        if (secureHexEqual(actualHex, expectedHex)) {
          return i;
        }
      }
      continue;
    }

    // Legacy format fallback: unsalted SHA-256 hex
    const legacyHash = crypto.createHash('sha256').update(normalized).digest('hex');
    if (secureHexEqual(legacyHash, stored)) {
      return i;
    }
  }

  return -1;
}

/**
 * Verify a TOTP code for vault 2FA
 * Allows for 1 step clock drift (30 seconds before/after)
 */
export function verifyVault2FACode(code: string, secret: string): boolean {
  const cleanSecret = cleanTOTPSecret(secret);
  const inputCode = code.replace(/\s/g, '');

  if (!/^\d{6}$/.test(inputCode)) {
    return false;
  }

  // Check current code
  const currentCode = generateTOTPCodeSync(cleanSecret);
  if (inputCode === currentCode) {
    return true;
  }

  // Check previous code (clock drift tolerance)
  const epoch = Math.floor(Date.now() / 1000);
  const previousCounter = Math.floor(epoch / 30) - 1;
  const previousCode = generateTOTPCodeForCounter(cleanSecret, previousCounter);
  if (inputCode === previousCode) {
    return true;
  }

  // Check next code (clock drift tolerance)
  const nextCounter = Math.floor(epoch / 30) + 1;
  const nextCode = generateTOTPCodeForCounter(cleanSecret, nextCounter);
  if (inputCode === nextCode) {
    return true;
  }

  return false;
}

/**
 * Generate TOTP code for a specific counter value
 */
function generateTOTPCodeForCounter(secret: string, counter: number): string {
  // Decode base32 secret
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '')) {
    const val = base32chars.indexOf(char);
    if (val === -1) throw new Error('Invalid base32 character');
    bits += val.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);

  // Create counter buffer (8 bytes, big-endian)
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  // HMAC-SHA1
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1]! & 0xf;
  const code = (
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff)
  ) % 1000000;

  return code.toString().padStart(6, '0');
}

/**
 * Generate a text-based QR code representation
 * Uses a simple block pattern that can be displayed in terminal
 */
export function generateTextQRCode(data: string): string {
  // For terminal display, we'll show the otpauth URI and manual entry instructions
  // A full QR code would require a library like 'qrcode' - keeping it simple

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold('  Scan with your authenticator app:'));
  lines.push('');
  lines.push(chalk.gray('  ┌─────────────────────────────────────────────┐'));
  lines.push(chalk.gray('  │') + chalk.yellow('  Can\'t scan? Enter the secret key manually:  ') + chalk.gray('│'));
  lines.push(chalk.gray('  └─────────────────────────────────────────────┘'));

  return lines.join('\n');
}

/**
 * Format secret for easy manual entry (groups of 4)
 */
export function formatSecretForDisplay(secret: string): string {
  const groups: string[] = [];
  for (let i = 0; i < secret.length; i += 4) {
    groups.push(secret.slice(i, i + 4));
  }
  return groups.join(' ');
}

/**
 * Generate otpauth URI for QR code scanning
 */
export function generateOTPAuthURI(secret: string, accountName: string = 'BlankDrive Vault'): string {
  const issuer = 'BlankDrive';
  const encodedAccount = encodeURIComponent(accountName);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Display the 2FA setup instructions with QR code
 */
export function displaySetupInstructions(secret: string): void {
  const uri = generateOTPAuthURI(secret);
  const formattedSecret = formatSecretForDisplay(secret);

  console.log('');
  console.log(chalk.bold.cyan('  ═══════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('            VAULT 2FA SETUP'));
  console.log(chalk.bold.cyan('  ═══════════════════════════════════════════════════'));
  console.log('');
  console.log(chalk.white('  Scan this QR code with your authenticator app:'));
  console.log('');

  // Display QR code in terminal
  qrcode.generate(uri, { small: true }, (qrString: string) => {
    // Indent the QR code for better display
    const lines = qrString.split('\n');
    lines.forEach(line => {
      console.log('    ' + line);
    });
  });

  console.log('');
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.yellow('  Can\'t scan? Enter this secret key manually:'));
  console.log('');
  console.log(chalk.gray('  ┌─────────────────────────────────────────────────┐'));
  console.log(chalk.gray('  │                                                 │'));
  console.log(chalk.gray('  │  ') + chalk.bold.green(formattedSecret) + chalk.gray('      │'));
  console.log(chalk.gray('  │                                                 │'));
  console.log(chalk.gray('  └─────────────────────────────────────────────────┘'));
  console.log('');
  console.log(chalk.gray('  Account name: ') + chalk.cyan('BlankDrive Vault'));
  console.log('');
}

/**
 * Display backup codes to the user
 */
export function displayBackupCodes(codes: string[]): void {
  console.log('');
  console.log(chalk.bold.yellow('  ═══════════════════════════════════════════════════'));
  console.log(chalk.bold.yellow('            BACKUP CODES - SAVE THESE!'));
  console.log(chalk.bold.yellow('  ═══════════════════════════════════════════════════'));
  console.log('');
  console.log(chalk.white('  If you lose access to your authenticator app, you can'));
  console.log(chalk.white('  use one of these backup codes to unlock your vault.'));
  console.log(chalk.red.bold('  Each code can only be used ONCE.'));
  console.log('');
  console.log(chalk.gray('  ┌─────────────────────────────────────────────────┐'));

  for (let i = 0; i < codes.length; i++) {
    const num = (i + 1).toString().padStart(2, ' ');
    console.log(chalk.gray('  │  ') + chalk.white(`${num}. `) + chalk.bold.cyan(codes[i]) + chalk.gray('                              │'));
  }

  console.log(chalk.gray('  └─────────────────────────────────────────────────┘'));
  console.log('');
  console.log(chalk.yellow('  Store these codes in a safe place!'));
  console.log(chalk.gray('  (Screenshot, print, or write them down)'));
  console.log('');
}

/**
 * Prompt for 2FA code during unlock
 */
export async function prompt2FACode(): Promise<string> {
  const { code } = await inquirer.prompt<{ code: string }>([
    {
      type: 'input',
      name: 'code',
      message: chalk.cyan('2FA Code from authenticator app:'),
      validate: (input: string) => {
        const cleaned = input.replace(/\s/g, '');
        if (!/^\d{6}$/.test(cleaned) && !/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(cleaned)) {
          return 'Enter 6-digit code or backup code (XXXX-XXXX)';
        }
        return true;
      },
    },
  ]);

  return code;
}

/**
 * Prompt for 2FA verification during setup
 */
export async function promptVerify2FASetup(): Promise<string> {
  console.log(chalk.white('  Now enter the 6-digit code shown in your app to verify:'));
  console.log('');

  const { code } = await inquirer.prompt<{ code: string }>([
    {
      type: 'input',
      name: 'code',
      message: chalk.cyan('Verification code:'),
      validate: (input: string) => {
        const cleaned = input.replace(/\s/g, '');
        if (!/^\d{6}$/.test(cleaned)) {
          return 'Enter the 6-digit code from your authenticator app';
        }
        return true;
      },
    },
  ]);

  return code.replace(/\s/g, '');
}

/**
 * Show help for vault 2FA
 */
export function showVault2FAHelp(): void {
  console.log(chalk.bold('\n  ═══════════════════════════════════════════════════'));
  console.log(chalk.bold('           PROTECT YOUR VAULT WITH 2FA'));
  console.log(chalk.bold('  ═══════════════════════════════════════════════════\n'));

  console.log(chalk.white('  What is this?\n'));
  console.log(chalk.gray('  Two-factor authentication (2FA) adds an extra layer'));
  console.log(chalk.gray('  of security to YOUR BlankDrive vault. Even if someone'));
  console.log(chalk.gray('  knows your master password, they cannot access your'));
  console.log(chalk.gray('  vault without your phone.\n'));

  console.log(chalk.gray('  ─────────────────────────────────────────────────\n'));

  console.log(chalk.white('  How it works:\n'));
  console.log(chalk.gray('  1. You set up 2FA once using Google Authenticator'));
  console.log(chalk.gray('     (or any TOTP app like Authy, Microsoft Auth, etc.)'));
  console.log(chalk.gray('  2. Every time you unlock your vault, after entering'));
  console.log(chalk.gray('     your password, you also enter a 6-digit code'));
  console.log(chalk.gray('     from your phone'));
  console.log(chalk.gray('  3. The code changes every 30 seconds\n'));

  console.log(chalk.gray('  ─────────────────────────────────────────────────\n'));

  console.log(chalk.white('  Quick setup:\n'));
  console.log(chalk.cyan('  1. ') + chalk.gray('Run ') + chalk.cyan('2fa-setup') + chalk.gray(' command'));
  console.log(chalk.cyan('  2. ') + chalk.gray('Open Google Authenticator on your phone'));
  console.log(chalk.cyan('  3. ') + chalk.gray('Tap + and enter the secret key shown'));
  console.log(chalk.cyan('  4. ') + chalk.gray('Enter the 6-digit code to verify'));
  console.log(chalk.cyan('  5. ') + chalk.gray('Save your backup codes somewhere safe!\n'));

  console.log(chalk.gray('  ─────────────────────────────────────────────────\n'));

  console.log(chalk.yellow('  Note: ') + chalk.gray('This protects YOUR vault. To store 2FA'));
  console.log(chalk.gray('  codes for websites, use the ') + chalk.cyan('totp') + chalk.gray(' command instead.\n'));
}

/**
 * Interactive 2FA setup flow
 */
export async function interactiveSetup2FA(
  currentConfig: Vault2FAConfig | undefined,
  saveConfig: (config: Vault2FAConfig | undefined) => Promise<void>
): Promise<void> {
  // Check if already enabled
  if (currentConfig?.enabled) {
    console.log(chalk.green('\n  Vault 2FA is currently ENABLED\n'));

    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: chalk.cyan('What would you like to do?'),
        choices: [
          { name: 'View backup codes', value: 'backup' },
          { name: 'Generate new backup codes', value: 'newbackup' },
          { name: 'Disable 2FA (not recommended)', value: 'disable' },
          { name: 'Cancel', value: 'cancel' },
        ],
      },
    ]);

    if (action === 'cancel') {
      return;
    }

    if (action === 'backup') {
      console.log(chalk.yellow('\n  Backup codes cannot be viewed after setup.'));
      console.log(chalk.gray('  For security, they are stored as hashes only.'));
      console.log(chalk.gray('  Select "Generate new backup codes" to get new ones.\n'));
      return;
    }

    if (action === 'newbackup') {
      // Verify current 2FA first
      console.log(chalk.white('\n  Verify your identity first:\n'));
      const code = await prompt2FACode();

      if (!verifyVault2FACode(code, currentConfig.secret)) {
        console.log(chalk.red('\n  Invalid code. Cannot generate new backup codes.\n'));
        return;
      }

      // Generate new backup codes
      const newCodes = generateBackupCodes(8);
      const hashedCodes = newCodes.map(hashBackupCode);

      displayBackupCodes(newCodes);

      // Update config with new hashed codes
      await saveConfig({
        ...currentConfig,
        backupCodes: hashedCodes,
      });

      console.log(chalk.green('  New backup codes generated and saved.\n'));
      return;
    }

    if (action === 'disable') {
      // Verify current 2FA first
      console.log(chalk.white('\n  Verify your identity to disable 2FA:\n'));
      const code = await prompt2FACode();

      if (!verifyVault2FACode(code, currentConfig.secret)) {
        console.log(chalk.red('\n  Invalid code. Cannot disable 2FA.\n'));
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: chalk.red('Are you sure you want to disable 2FA? This reduces security.'),
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.gray('\n  Cancelled. 2FA remains enabled.\n'));
        return;
      }

      await saveConfig(undefined);
      console.log(chalk.yellow('\n  2FA has been disabled.\n'));
      return;
    }

    return;
  }

  // New setup flow
  console.log(chalk.bold('\n  ═══════════════════════════════════════════════════'));
  console.log(chalk.bold('          SET UP VAULT 2FA PROTECTION'));
  console.log(chalk.bold('  ═══════════════════════════════════════════════════\n'));

  console.log(chalk.white('  This will add two-factor authentication to your vault.'));
  console.log(chalk.white('  You will need a TOTP app on your phone:\n'));
  console.log(chalk.gray('    - Google Authenticator'));
  console.log(chalk.gray('    - Authy'));
  console.log(chalk.gray('    - Microsoft Authenticator'));
  console.log(chalk.gray('    - 1Password'));
  console.log(chalk.gray('    - Any TOTP-compatible app\n'));

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: 'confirm',
      name: 'proceed',
      message: chalk.cyan('Ready to set up 2FA?'),
      default: true,
    },
  ]);

  if (!proceed) {
    console.log(chalk.gray('\n  Setup cancelled.\n'));
    return;
  }

  // Generate secret
  const spinner = ora('Generating secure secret...').start();
  const secret = generateVault2FASecret();
  spinner.succeed('Secret generated');

  // Display setup instructions
  displaySetupInstructions(secret);

  // Verify the setup
  let verified = false;
  let attempts = 0;
  const maxAttempts = 3;

  while (!verified && attempts < maxAttempts) {
    attempts++;
    const code = await promptVerify2FASetup();

    if (verifyVault2FACode(code, secret)) {
      verified = true;
    } else {
      const remaining = maxAttempts - attempts;
      if (remaining > 0) {
        console.log(chalk.red(`\n  Invalid code. ${remaining} attempt(s) remaining.`));
        console.log(chalk.gray('  Make sure the code matches what\'s shown in your app.\n'));
      } else {
        console.log(chalk.red('\n  Too many failed attempts. Setup cancelled.\n'));
        return;
      }
    }
  }

  console.log(chalk.green('\n  Code verified successfully!\n'));

  // Generate backup codes
  const backupCodes = generateBackupCodes(8);
  const hashedBackupCodes = backupCodes.map(hashBackupCode);

  displayBackupCodes(backupCodes);

  // Confirm backup codes saved
  const { savedCodes } = await inquirer.prompt<{ savedCodes: boolean }>([
    {
      type: 'confirm',
      name: 'savedCodes',
      message: chalk.yellow('Have you saved your backup codes?'),
      default: false,
    },
  ]);

  if (!savedCodes) {
    console.log(chalk.yellow('\n  Please save your backup codes before continuing.'));
    console.log(chalk.gray('  You will need them if you lose access to your phone.\n'));

    displayBackupCodes(backupCodes);

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow('I have saved my backup codes'),
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.red('\n  Setup cancelled. Please save your backup codes and try again.\n'));
      return;
    }
  }

  // Save the configuration
  const config: Vault2FAConfig = {
    enabled: true,
    secret,
    enabledAt: Date.now(),
    backupCodes: hashedBackupCodes,
  };

  await saveConfig(config);

  console.log(chalk.bold.green('\n  ═══════════════════════════════════════════════════'));
  console.log(chalk.bold.green('           2FA ENABLED SUCCESSFULLY!'));
  console.log(chalk.bold.green('  ═══════════════════════════════════════════════════\n'));
  console.log(chalk.white('  From now on, you will need both your password AND'));
  console.log(chalk.white('  a code from your authenticator app to unlock your vault.\n'));
}
