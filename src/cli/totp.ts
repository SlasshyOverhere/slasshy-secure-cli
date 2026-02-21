/**
 * TOTP (Time-based One-Time Password) Support
 *
 * Provides 2FA/MFA code generation for stored entries
 */

import { generate, verify, generateSecret as genSecret, generateURI } from 'otplib';
import chalk from 'chalk';
import crypto from 'crypto';

/**
 * TOTP entry data stored with password entries
 */
export interface TOTPData {
  secret: string;
  issuer?: string;
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
  digits?: number;
  period?: number;
}

/**
 * Validate a TOTP secret
 */
export function validateTOTPSecret(secret: string): boolean {
  // Remove spaces and convert to uppercase
  const cleaned = secret.replace(/\s+/g, '').toUpperCase();

  // Check if it's a valid base32 string
  const base32Regex = /^[A-Z2-7]+=*$/;

  if (!base32Regex.test(cleaned)) {
    return false;
  }

  // Check minimum length (at least 16 characters for reasonable security)
  if (cleaned.length < 16) {
    return false;
  }

  return true;
}

/**
 * Clean and normalize a TOTP secret
 */
export function cleanTOTPSecret(secret: string): string {
  return secret.replace(/\s+/g, '').toUpperCase();
}

/**
 * Generate current TOTP code
 */
export async function generateTOTPCode(secret: string): Promise<string> {
  try {
    const cleanSecret = cleanTOTPSecret(secret);
    return await generate({ secret: cleanSecret });
  } catch (error) {
    throw new Error('Invalid TOTP secret');
  }
}

/**
 * Generate TOTP code synchronously (for display purposes)
 */
export function generateTOTPCodeSync(secret: string): string {
  const cleanSecret = cleanTOTPSecret(secret);

  // Decode base32 secret
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of cleanSecret.replace(/=+$/, '')) {
    const val = base32chars.indexOf(char);
    if (val === -1) throw new Error('Invalid base32 character');
    bits += val.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);

  // Calculate counter
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);

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
 * Verify a TOTP code
 */
export async function verifyTOTPCode(code: string, secret: string): Promise<boolean> {
  try {
    const cleanSecret = cleanTOTPSecret(secret);
    const result = await verify({ token: code, secret: cleanSecret });
    // Result can be 'valid', 'invalid', or various error types
    return String(result) === 'valid' || Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Get time remaining until current code expires
 */
export function getTimeRemaining(): number {
  const step = 30;
  const now = Math.floor(Date.now() / 1000);
  return step - (now % step);
}

/**
 * Parse otpauth:// URI
 * Format: otpauth://totp/LABEL?secret=SECRET&issuer=ISSUER
 */
export function parseOTPAuthURI(uri: string): TOTPData | null {
  try {
    const url = new URL(uri);

    if (url.protocol !== 'otpauth:') {
      return null;
    }

    if (url.host !== 'totp') {
      return null; // We only support TOTP, not HOTP
    }

    const secret = url.searchParams.get('secret');
    if (!secret) {
      return null;
    }

    const issuer = url.searchParams.get('issuer') || undefined;
    const algorithm = (url.searchParams.get('algorithm')?.toUpperCase() as 'SHA1' | 'SHA256' | 'SHA512') || undefined;
    const digits = url.searchParams.get('digits') ? parseInt(url.searchParams.get('digits')!, 10) : undefined;
    const period = url.searchParams.get('period') ? parseInt(url.searchParams.get('period')!, 10) : undefined;

    return {
      secret: cleanTOTPSecret(secret),
      issuer,
      algorithm,
      digits,
      period,
    };
  } catch {
    return null;
  }
}

/**
 * Generate otpauth:// URI from TOTP data
 */
export function generateOTPAuthURI(label: string, data: TOTPData): string {
  const params = new URLSearchParams();
  params.set('secret', data.secret);

  if (data.issuer) {
    params.set('issuer', data.issuer);
  }
  if (data.algorithm) {
    params.set('algorithm', data.algorithm);
  }
  if (data.digits && data.digits !== 6) {
    params.set('digits', data.digits.toString());
  }
  if (data.period && data.period !== 30) {
    params.set('period', data.period.toString());
  }

  const encodedLabel = encodeURIComponent(label);
  return `otpauth://totp/${encodedLabel}?${params.toString()}`;
}

/**
 * Display TOTP code with countdown
 */
export function displayTOTPCode(code: string, label?: string): void {
  const remaining = getTimeRemaining();

  console.log('');
  if (label) {
    console.log(chalk.bold(`  ${label}`));
  }
  console.log(chalk.gray('  ' + '─'.repeat(40)));

  // Format code with spaces for readability (e.g., "123 456")
  const formattedCode = code.slice(0, 3) + ' ' + code.slice(3);

  // Color code based on time remaining
  let codeColor: (s: string) => string;
  let timeColor: (s: string) => string;
  let barLength: number;

  if (remaining <= 5) {
    codeColor = chalk.red;
    timeColor = chalk.red;
    barLength = Math.floor((remaining / 30) * 20);
  } else if (remaining <= 10) {
    codeColor = chalk.yellow;
    timeColor = chalk.yellow;
    barLength = Math.floor((remaining / 30) * 20);
  } else {
    codeColor = chalk.green;
    timeColor = chalk.cyan;
    barLength = Math.floor((remaining / 30) * 20);
  }

  const progressBar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);

  console.log(`  ${chalk.gray('Code:')}  ${chalk.bold(codeColor(formattedCode))}`);
  console.log(`  ${chalk.gray('Timer:')} [${timeColor(progressBar)}] ${remaining}s`);
  console.log(chalk.gray('  ' + '─'.repeat(40)));
  console.log('');
}

/**
 * Generate a random TOTP secret
 */
export async function generateTOTPSecret(): Promise<string> {
  return await genSecret();
}
