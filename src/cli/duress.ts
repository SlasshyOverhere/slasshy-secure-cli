/**
 * Duress Password Feature
 *
 * A secondary "panic" password that, when entered, unlocks a decoy vault
 * instead of the real vault. This protects users under coercion.
 *
 * How it works:
 * - User sets up a duress password (different from master password)
 * - If duress password is entered at unlock:
 *   - A decoy vault with fake/minimal entries is shown
 *   - Real vault data remains hidden and encrypted
 *   - Optional: trigger silent logging or alert
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import chalk from 'chalk';
import inquirer from 'inquirer';
import argon2 from 'argon2';
import { encryptToPayload, decryptToString, initializeKeyManager } from '../crypto/index.js';
import { uploadDuressHashToCloud } from '../storage/drive/synchronizer.js';

const DURESS_CONFIG_FILE = path.join(os.homedir(), '.slasshy', 'duress.enc');
const DURESS_SALT_FILE = path.join(os.homedir(), '.slasshy', 'duress.salt');
const DURESS_HASH_FILE = path.join(os.homedir(), '.slasshy', 'duress.hash'); // Standalone hash for pre-unlock check

/**
 * Duress configuration
 */
interface DuressConfig {
  enabled: boolean;
  passwordHash: string;
  mode: 'decoy' | 'wipe' | 'minimal';
  decoyEntries?: Array<{
    title: string;
    username: string;
    url?: string;
  }>;
  lastTriggered?: number;
  triggerCount: number;
}

let duressConfig: DuressConfig | null = null;
let isDuressMode = false;

/**
 * Activate duress mode without needing vault key (for pre-unlock activation)
 */
export function activateDuressModeSimple(): void {
  isDuressMode = true;

  // Set default decoy entries
  duressConfig = {
    enabled: true,
    passwordHash: '',
    mode: 'minimal',
    decoyEntries: [
      { title: 'Email', username: 'user@example.com', url: 'https://mail.google.com' },
      { title: 'Bank', username: 'customer123', url: 'https://bank.example.com' },
    ],
    triggerCount: 1,
  };

  // Log duress activation (silently)
  logDuressActivationAsync();
}

/**
 * Helper to log duress activation asynchronously
 */
function logDuressActivationAsync(): void {
  const logFile = path.join(os.homedir(), '.slasshy', '.duress.log');
  const entry = `${new Date().toISOString()} | Duress mode activated\n`;
  fs.appendFile(logFile, entry, { encoding: 'utf-8', mode: 0o600 }).catch(() => {});
}

/**
 * Check if duress password is configured
 */
export async function isDuressConfigured(): Promise<boolean> {
  try {
    await fs.access(DURESS_HASH_FILE);
    return true;
  } catch {
    // Fallback to old method
    try {
      await fs.access(DURESS_CONFIG_FILE);
      await fs.access(DURESS_SALT_FILE);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Generate duress salt
 */
async function generateDuressSalt(): Promise<Buffer> {
  const salt = crypto.randomBytes(32);
  await fs.writeFile(DURESS_SALT_FILE, salt, { mode: 0o600 });
  return salt;
}

/**
 * Get duress salt
 */
async function getDuressSalt(): Promise<Buffer> {
  try {
    return await fs.readFile(DURESS_SALT_FILE);
  } catch {
    return generateDuressSalt();
  }
}

/**
 * Hash duress password using Argon2
 */
async function hashDuressPassword(password: string): Promise<string> {
  const salt = await getDuressSalt();
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
    salt,
  });
  return hash;
}

/**
 * Verify duress password
 */
async function verifyDuressPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Set up duress password
 */
export async function setupDuressPassword(
  password: string,
  indexKey: Buffer,
  mode: 'decoy' | 'wipe' | 'minimal' = 'minimal'
): Promise<void> {
  // Ensure directory exists
  await fs.mkdir(path.dirname(DURESS_CONFIG_FILE), { recursive: true, mode: 0o700 });

  // Hash the duress password
  const passwordHash = await hashDuressPassword(password);

  // Save standalone hash for pre-unlock verification
  await fs.writeFile(DURESS_HASH_FILE, passwordHash, { encoding: 'utf-8', mode: 0o600 });

  // Sync duress hash to cloud (if connected)
  try {
    await uploadDuressHashToCloud();
  } catch {
    // Silently fail - cloud sync is optional
  }

  // Create default decoy entries
  const decoyEntries = [
    { title: 'Email', username: 'user@example.com', url: 'https://mail.google.com' },
    { title: 'Bank', username: 'customer123', url: 'https://bank.example.com' },
  ];

  // Create config
  const config: DuressConfig = {
    enabled: true,
    passwordHash,
    mode,
    decoyEntries,
    triggerCount: 0,
  };

  // Encrypt and save config
  const encrypted = encryptToPayload(JSON.stringify(config), indexKey);
  await fs.writeFile(DURESS_CONFIG_FILE, encrypted, { encoding: 'utf-8', mode: 0o600 });

  duressConfig = config;
}

/**
 * Load duress config
 */
async function loadDuressConfig(indexKey: Buffer): Promise<DuressConfig | null> {
  try {
    const encrypted = await fs.readFile(DURESS_CONFIG_FILE, 'utf-8');
    const decrypted = decryptToString(encrypted, indexKey);
    return JSON.parse(decrypted) as DuressConfig;
  } catch {
    return null;
  }
}

/**
 * Check if a password matches the duress password (WITHOUT needing vault unlocked)
 * This uses the standalone hash file for pre-unlock verification
 */
export async function checkDuressPasswordPreUnlock(password: string): Promise<boolean> {
  if (!await isDuressConfigured()) {
    return false;
  }

  try {
    const storedHash = await fs.readFile(DURESS_HASH_FILE, 'utf-8');
    return await verifyDuressPassword(password, storedHash.trim());
  } catch {
    return false;
  }
}

/**
 * Check if a password matches the duress password
 */
export async function checkDuressPassword(
  password: string,
  indexKey: Buffer
): Promise<boolean> {
  if (!await isDuressConfigured()) {
    return false;
  }

  const config = await loadDuressConfig(indexKey);
  if (!config || !config.enabled) {
    return false;
  }

  return verifyDuressPassword(password, config.passwordHash);
}

/**
 * Activate duress mode
 */
export async function activateDuressMode(indexKey: Buffer): Promise<void> {
  const config = await loadDuressConfig(indexKey);
  if (!config) return;

  isDuressMode = true;
  duressConfig = config;

  // Update trigger count and timestamp
  config.lastTriggered = Date.now();
  config.triggerCount++;

  // Save updated config
  const encrypted = encryptToPayload(JSON.stringify(config), indexKey);
  await fs.writeFile(DURESS_CONFIG_FILE, encrypted, { encoding: 'utf-8', mode: 0o600 });

  // Log duress activation (silently, to a hidden file)
  await logDuressActivation();
}

/**
 * Log duress activation (for forensic purposes)
 */
async function logDuressActivation(): Promise<void> {
  try {
    const logFile = path.join(os.homedir(), '.slasshy', '.duress.log');
    const entry = `${new Date().toISOString()} | Duress mode activated\n`;
    await fs.appendFile(logFile, entry, { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Silently fail - don't reveal duress mode
  }
}

/**
 * Check if currently in duress mode
 */
export function isInDuressMode(): boolean {
  return isDuressMode;
}

/**
 * Get duress mode settings
 */
export function getDuressMode(): 'decoy' | 'wipe' | 'minimal' | null {
  return duressConfig?.mode || null;
}

/**
 * Get decoy entries for duress mode
 */
export function getDecoyEntries(): Array<{ id: string; title: string; username: string; url?: string }> {
  if (!duressConfig?.decoyEntries) {
    return [];
  }

  return duressConfig.decoyEntries.map((e, idx) => ({
    id: `decoy_${idx}`,
    ...e,
  }));
}

/**
 * Disable duress password
 */
export async function disableDuressPassword(): Promise<void> {
  try {
    await fs.unlink(DURESS_CONFIG_FILE);
    await fs.unlink(DURESS_SALT_FILE);
    duressConfig = null;
    isDuressMode = false;
  } catch {
    // Files might not exist
  }
}

/**
 * Reset duress mode state
 */
export function resetDuressState(): void {
  isDuressMode = false;
  // Keep config for next check
}

/**
 * Interactive setup for duress password
 */
export async function interactiveSetupDuress(indexKey: Buffer): Promise<boolean> {
  console.log(chalk.bold('\n  🚨 Duress Password Setup\n'));
  console.log(chalk.gray('  A duress password is a secondary password that shows a'));
  console.log(chalk.gray('  decoy vault when you are forced to reveal your password.'));
  console.log(chalk.gray('  Your real data remains hidden and protected.\n'));

  const { duressPassword, confirmPassword } = await inquirer.prompt<{
    duressPassword: string;
    confirmPassword: string;
  }>([
    {
      type: 'password',
      name: 'duressPassword',
      message: chalk.cyan('Duress password:'),
      mask: '*',
      validate: (input: string) => {
        if (input.length < 12) {
          return 'Duress password must be at least 12 characters';
        }
        return true;
      },
    },
    {
      type: 'password',
      name: 'confirmPassword',
      message: chalk.cyan('Confirm duress password:'),
      mask: '*',
    },
  ]);

  if (duressPassword !== confirmPassword) {
    console.log(chalk.red('\n  Passwords do not match.\n'));
    return false;
  }

  const { mode } = await inquirer.prompt<{ mode: 'minimal' | 'decoy' }>([
    {
      type: 'list',
      name: 'mode',
      message: chalk.cyan('What should happen when duress password is used?'),
      choices: [
        { name: 'Show minimal decoy entries (recommended)', value: 'minimal' },
        { name: 'Show custom decoy entries', value: 'decoy' },
      ],
    },
  ]);

  try {
    await setupDuressPassword(duressPassword, indexKey, mode);
    console.log(chalk.green('\n  ✓ Duress password configured successfully!'));
    console.log(chalk.yellow('  ⚠ Remember: Use this password if forced to reveal your vault.\n'));
    return true;
  } catch (error) {
    console.log(chalk.red('\n  Failed to set up duress password.'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
    return false;
  }
}
