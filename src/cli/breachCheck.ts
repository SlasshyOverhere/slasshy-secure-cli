/**
 * Breach Detection using Have I Been Pwned (HIBP) API
 *
 * Uses k-anonymity model to check if passwords have been exposed
 * in known data breaches without sending the actual password.
 *
 * How it works:
 * 1. Hash password with SHA-1
 * 2. Send only first 5 characters of hash to HIBP API
 * 3. API returns all matching hash suffixes
 * 4. Check locally if full hash is in the returned list
 */

import crypto from 'crypto';
import https from 'https';
import chalk from 'chalk';

const HIBP_API_URL = 'https://api.pwnedpasswords.com/range/';

/**
 * Result of a breach check
 */
export interface BreachCheckResult {
  breached: boolean;
  count: number; // Number of times seen in breaches (0 if not breached)
  error?: string;
}

/**
 * Hash a password with SHA-1 (required by HIBP API)
 */
function sha1Hash(password: string): string {
  return crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
}

/**
 * Make HTTPS request to HIBP API
 */
async function fetchHIBP(hashPrefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.pwnedpasswords.com',
      path: `/range/${hashPrefix}`,
      method: 'GET',
      headers: {
        'User-Agent': 'BlankDrive-Password-Vault',
        'Add-Padding': 'true', // Add padding to responses for privacy
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HIBP API returned status ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Check if a password has been exposed in known data breaches
 * Uses k-anonymity to protect the password
 */
export async function checkPasswordBreach(password: string): Promise<BreachCheckResult> {
  try {
    // Hash the password
    const hash = sha1Hash(password);
    const prefix = hash.substring(0, 5);
    const suffix = hash.substring(5);

    // Fetch matching hashes from HIBP
    const response = await fetchHIBP(prefix);

    // Parse response (format: SUFFIX:COUNT\r\n)
    const lines = response.split('\r\n');

    for (const line of lines) {
      if (!line) continue;

      const [hashSuffix, countStr] = line.split(':');
      if (hashSuffix === suffix) {
        const count = parseInt(countStr || '0', 10);
        return {
          breached: true,
          count,
        };
      }
    }

    return {
      breached: false,
      count: 0,
    };
  } catch (error) {
    return {
      breached: false,
      count: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check multiple passwords for breaches
 */
export async function checkMultipleBreaches(
  passwords: Array<{ id: string; title: string; password: string }>,
  onProgress?: (checked: number, total: number) => void
): Promise<Map<string, BreachCheckResult>> {
  const results = new Map<string, BreachCheckResult>();
  let checked = 0;

  for (const entry of passwords) {
    const result = await checkPasswordBreach(entry.password);
    results.set(entry.id, result);

    checked++;
    if (onProgress) {
      onProgress(checked, passwords.length);
    }

    // Small delay to avoid rate limiting
    if (checked < passwords.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

/**
 * Display breach check result
 */
export function displayBreachResult(result: BreachCheckResult, title?: string): void {
  console.log('');
  if (title) {
    console.log(chalk.bold(`  ${title}`));
  }
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  if (result.error) {
    console.log(chalk.yellow(`  ⚠ Could not check: ${result.error}`));
  } else if (result.breached) {
    console.log(chalk.red.bold(`  🚨 PASSWORD BREACHED!`));
    console.log(chalk.red(`  This password was found in ${result.count.toLocaleString()} data breaches.`));
    console.log(chalk.yellow('  ⚠ You should change this password immediately!'));
  } else {
    console.log(chalk.green('  ✓ Password not found in known breaches.'));
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}

/**
 * Get breach severity level
 */
export function getBreachSeverity(count: number): 'critical' | 'high' | 'medium' | 'low' | 'safe' {
  if (count === 0) return 'safe';
  if (count >= 100000) return 'critical';
  if (count >= 10000) return 'high';
  if (count >= 1000) return 'medium';
  return 'low';
}

/**
 * Get breach severity color and icon
 */
export function getBreachDisplay(count: number): { icon: string; color: (s: string) => string; label: string } {
  const severity = getBreachSeverity(count);

  switch (severity) {
    case 'critical':
      return { icon: '🔴', color: chalk.red, label: 'CRITICAL' };
    case 'high':
      return { icon: '🟠', color: chalk.red, label: 'HIGH RISK' };
    case 'medium':
      return { icon: '🟡', color: chalk.yellow, label: 'MEDIUM RISK' };
    case 'low':
      return { icon: '🟢', color: chalk.yellow, label: 'LOW RISK' };
    default:
      return { icon: '✓', color: chalk.green, label: 'SAFE' };
  }
}

/**
 * Format breach count for display
 */
export function formatBreachCount(count: number): string {
  if (count === 0) return 'No breaches';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M+ exposures`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K exposures`;
  return `${count} exposures`;
}
