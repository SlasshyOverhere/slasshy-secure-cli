import chalk from 'chalk';
import ora from 'ora';
import {
  vaultExists,
  unlock,
  listEntries,
  getEntry,
  isUnlocked,
  type Entry,
} from '../../storage/vault/index.js';
import { promptPassword } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import {
  analyzePasswordStrength,
  getScoreColor,
  getScoreBar,
  getStrengthSummary,
} from '../passwordStrength.js';
import { isInDuressMode, getDecoyEntries } from '../duress.js';

// Default password age threshold (90 days)
const DEFAULT_EXPIRY_DAYS = 90;

/**
 * Calculate password age in days
 */
function getPasswordAgeDays(entry: Entry): number | null {
  const lastChanged = entry.passwordLastChanged || entry.created;
  if (!lastChanged) return null;

  const ageMs = Date.now() - lastChanged;
  return Math.floor(ageMs / (1000 * 60 * 60 * 24));
}

/**
 * Get password status based on age
 */
function getPasswordStatus(entry: Entry): { status: 'good' | 'warning' | 'expired' | 'unknown'; ageDays: number | null; expiryDays: number } {
  const ageDays = getPasswordAgeDays(entry);
  const expiryDays = entry.passwordExpiryDays || DEFAULT_EXPIRY_DAYS;

  if (ageDays === null || !entry.password) {
    return { status: 'unknown', ageDays: null, expiryDays };
  }

  if (ageDays >= expiryDays) {
    return { status: 'expired', ageDays, expiryDays };
  }

  // Warning at 75% of expiry period
  const warningThreshold = Math.floor(expiryDays * 0.75);
  if (ageDays >= warningThreshold) {
    return { status: 'warning', ageDays, expiryDays };
  }

  return { status: 'good', ageDays, expiryDays };
}

/**
 * Get status icon and color
 */
function getStatusDisplay(status: 'good' | 'warning' | 'expired' | 'unknown'): { icon: string; color: (text: string) => string } {
  switch (status) {
    case 'good':
      return { icon: '✓', color: chalk.green };
    case 'warning':
      return { icon: '⚠', color: chalk.yellow };
    case 'expired':
      return { icon: '✗', color: chalk.red };
    default:
      return { icon: '?', color: chalk.gray };
  }
}

/**
 * Format age display
 */
function formatAge(days: number | null): string {
  if (days === null) return 'Unknown';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? '1 month' : `${months} months`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year' : `${years} years`;
}

/**
 * Audit command - Check password ages and security
 */
export async function auditCommand(options?: { all?: boolean }): Promise<void> {
  console.log(chalk.bold('\n  🔍 Password Security Audit\n'));

  // Duress mode - show fake audit (all good)
  if (isInDuressMode()) {
    const decoyEntries = getDecoyEntries();

    const spinner = ora('Analyzing passwords...').start();
    await new Promise(resolve => setTimeout(resolve, 800));
    spinner.stop();

    console.log(chalk.gray('  ' + '─'.repeat(60)));
    console.log('');
    console.log(chalk.bold('  📊 Password Age Summary:'));
    console.log(`  ${chalk.green('✓')} ${chalk.green(decoyEntries.length.toString())} passwords are up to date`);
    console.log('');

    console.log(chalk.bold('  🔐 Password Strength Summary:'));
    console.log(`  ${chalk.red('🔴')} Very Weak: 0  ${chalk.red('🟠')} Weak: 0  ${chalk.yellow('🟡')} Fair: 0  ${chalk.green('🟢')} Strong: ${decoyEntries.length}  ${chalk.green('💚')} Very Strong: 0`);
    console.log('');

    if (options?.all) {
      console.log(chalk.green.bold('  ✓ Up-to-date Passwords:'));
      console.log(chalk.gray('  ' + '─'.repeat(60)));
      for (const entry of decoyEntries) {
        console.log(`  ${chalk.green('✓')} ${chalk.white(entry.title)} 🟢 ${chalk.gray('(15 days old)')}`);
      }
      console.log('');
    }

    console.log(chalk.green('  ✓ All passwords are up to date and strong!\n'));
    return;
  }

  // Check vault exists
  if (!await vaultExists()) {
    console.log(chalk.red('  No vault found. Run "BLANK init" first.\n'));
    return;
  }

  // Unlock if needed
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

  const spinner = ora('Analyzing passwords...').start();

  try {
    const entries = await listEntries();

    // Filter to password entries only
    const passwordEntryIds = entries.filter(e =>
      e.entryType === 'password' || !e.entryType
    );

    if (passwordEntryIds.length === 0) {
      spinner.stop();
      console.log(chalk.yellow('  No password entries found.\n'));
      return;
    }

    // Get full entries with password details
    const passwordEntries: Entry[] = [];
    for (const e of passwordEntryIds) {
      const entry = await getEntry(e.id);
      if (entry && entry.password) {
        passwordEntries.push(entry);
      }
    }

    spinner.stop();

    if (passwordEntries.length === 0) {
      console.log(chalk.yellow('  No passwords to audit.\n'));
      return;
    }

    // Analyze entries - now including strength
    const expired: Array<{ entry: Entry; strength: ReturnType<typeof getStrengthSummary> }> = [];
    const warnings: Array<{ entry: Entry; strength: ReturnType<typeof getStrengthSummary> }> = [];
    const good: Array<{ entry: Entry; strength: ReturnType<typeof getStrengthSummary> }> = [];
    const unknown: Array<{ entry: Entry; strength: ReturnType<typeof getStrengthSummary> }> = [];
    const weakPasswords: Array<{ entry: Entry; strength: ReturnType<typeof getStrengthSummary> }> = [];

    for (const entry of passwordEntries) {
      const { status } = getPasswordStatus(entry);
      const strength = entry.password ? getStrengthSummary(entry.password) : { score: -1, icon: '⚪', label: 'Unknown' };

      const item = { entry, strength };

      // Categorize by age status
      switch (status) {
        case 'expired': expired.push(item); break;
        case 'warning': warnings.push(item); break;
        case 'good': good.push(item); break;
        default: unknown.push(item);
      }

      // Also track weak passwords (score 0 or 1)
      if (strength.score >= 0 && strength.score <= 1) {
        weakPasswords.push(item);
      }
    }

    // Summary
    console.log(chalk.gray('  ' + '─'.repeat(60)));
    console.log('');
    console.log(chalk.bold('  📊 Password Age Summary:'));
    console.log(`  ${chalk.green('✓')} ${chalk.green(good.length.toString())} passwords are up to date`);
    if (warnings.length > 0) {
      console.log(`  ${chalk.yellow('⚠')} ${chalk.yellow(warnings.length.toString())} passwords expiring soon`);
    }
    if (expired.length > 0) {
      console.log(`  ${chalk.red('✗')} ${chalk.red(expired.length.toString())} passwords have expired`);
    }
    if (unknown.length > 0) {
      console.log(`  ${chalk.gray('?')} ${chalk.gray(unknown.length.toString())} passwords with unknown age`);
    }
    console.log('');

    // Password Strength Summary
    console.log(chalk.bold('  🔐 Password Strength Summary:'));
    const strengthCounts = [0, 0, 0, 0, 0]; // Very Weak to Very Strong
    for (const { strength } of [...expired, ...warnings, ...good, ...unknown]) {
      if (strength.score >= 0 && strength.score <= 4) {
        strengthCounts[strength.score] = (strengthCounts[strength.score] || 0) + 1;
      }
    }
    console.log(`  ${chalk.red('🔴')} Very Weak: ${strengthCounts[0]}  ${chalk.red('🟠')} Weak: ${strengthCounts[1]}  ${chalk.yellow('🟡')} Fair: ${strengthCounts[2]}  ${chalk.green('🟢')} Strong: ${strengthCounts[3]}  ${chalk.green('💚')} Very Strong: ${strengthCounts[4]}`);
    console.log('');

    // Show weak passwords
    if (weakPasswords.length > 0) {
      console.log(chalk.red.bold('  🚨 Weak Passwords (need immediate attention):'));
      console.log(chalk.gray('  ' + '─'.repeat(60)));
      for (const { entry, strength } of weakPasswords) {
        const color = getScoreColor(strength.score);
        console.log(`  ${strength.icon} ${chalk.white(entry.title)}`);
        console.log(chalk.gray(`      Strength: ${getScoreBar(strength.score)} ${color(strength.label)}`));
        // Show feedback for weak passwords
        if (entry.password) {
          const fullAnalysis = analyzePasswordStrength(entry.password);
          if (fullAnalysis.feedback.warning) {
            console.log(chalk.yellow(`      ⚠ ${fullAnalysis.feedback.warning}`));
          }
        }
      }
      console.log('');
    }

    // Show expired passwords
    if (expired.length > 0) {
      console.log(chalk.red.bold('  ⏰ Expired Passwords (need immediate change):'));
      console.log(chalk.gray('  ' + '─'.repeat(60)));
      for (const { entry, strength } of expired) {
        const { ageDays, expiryDays } = getPasswordStatus(entry);
        const overdue = ageDays !== null ? ageDays - expiryDays : 0;
        console.log(`  ${chalk.red('✗')} ${chalk.white(entry.title)} ${strength.icon}`);
        console.log(chalk.gray(`      Age: ${formatAge(ageDays)} (${overdue} days overdue)`));
      }
      console.log('');
    }

    // Show warning passwords
    if (warnings.length > 0) {
      console.log(chalk.yellow.bold('  ⚠️  Passwords Expiring Soon:'));
      console.log(chalk.gray('  ' + '─'.repeat(60)));
      for (const { entry, strength } of warnings) {
        const { ageDays, expiryDays } = getPasswordStatus(entry);
        const daysLeft = ageDays !== null ? expiryDays - ageDays : 0;
        console.log(`  ${chalk.yellow('⚠')} ${chalk.white(entry.title)} ${strength.icon}`);
        console.log(chalk.gray(`      Age: ${formatAge(ageDays)} (${daysLeft} days until expiry)`));
      }
      console.log('');
    }

    // Show good passwords only if --all flag
    if (options?.all && good.length > 0) {
      console.log(chalk.green.bold('  ✓ Up-to-date Passwords:'));
      console.log(chalk.gray('  ' + '─'.repeat(60)));
      for (const { entry, strength } of good) {
        const { ageDays } = getPasswordStatus(entry);
        console.log(`  ${chalk.green('✓')} ${chalk.white(entry.title)} ${strength.icon} ${chalk.gray(`(${formatAge(ageDays)} old)`)}`);
      }
      console.log('');
    }

    // Recommendations
    if (expired.length > 0 || warnings.length > 0 || weakPasswords.length > 0) {
      console.log(chalk.gray('  ' + '─'.repeat(60)));
      console.log(chalk.bold('  📋 Recommendations:'));
      console.log(chalk.gray('  • Use "BLANK edit <entry>" to update passwords'));
      console.log(chalk.gray('  • Use "BLANK generate" to create strong passwords'));
      if (weakPasswords.length > 0) {
        console.log(chalk.gray('  • Prioritize strengthening weak passwords'));
      }
      console.log(chalk.gray('  • Consider using unique passwords for each account'));
      console.log('');
    } else {
      console.log(chalk.green('  ✓ All passwords are up to date and strong!\n'));
    }

  } catch (error) {
    spinner.fail('Audit failed');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * Check password expiry for a single entry and return warning message if needed
 */
export function checkPasswordExpiry(entry: Entry): string | null {
  if (!entry.password) return null;

  const { status, ageDays, expiryDays } = getPasswordStatus(entry);

  if (status === 'expired') {
    const overdue = ageDays !== null ? ageDays - expiryDays : 0;
    return chalk.red(`⚠️  Password expired! (${overdue} days overdue - consider changing it)`);
  }

  if (status === 'warning') {
    const daysLeft = ageDays !== null ? expiryDays - ageDays : 0;
    return chalk.yellow(`⚠  Password expiring soon (${daysLeft} days left)`);
  }

  return null;
}
