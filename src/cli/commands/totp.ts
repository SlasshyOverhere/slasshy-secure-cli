import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import clipboardy from 'clipboardy';
import {
  vaultExists,
  isUnlocked,
  listEntries,
  getEntry,
  updateEntry,
  type Entry,
} from '../../storage/vault/index.js';
import { ensureAuthenticated } from '../ensureAuth.js';
import {
  generateTOTPCodeSync,
  validateTOTPSecret,
  cleanTOTPSecret,
  parseOTPAuthURI,
  displayTOTPCode,
  getTimeRemaining,
  type TOTPData,
} from '../totp.js';
import { isInDuressMode } from '../duress.js';

/**
 * TOTP command - manage 2FA codes
 * Subcommands: add, view, remove, list
 */
export async function totpCommand(
  subcommand?: string,
  searchTerm?: string,
  options?: { copy?: boolean }
): Promise<void> {
  // Duress mode - show no TOTP entries
  if (isInDuressMode()) {
    const cmd = subcommand?.toLowerCase();

    if (cmd === 'list' || cmd === 'ls') {
      console.log(chalk.bold('\n  🔐 Entries with TOTP/2FA\n'));
      console.log(chalk.yellow('  No entries have TOTP configured.'));
      console.log(chalk.gray('  Use "totp add <entry>" to set up 2FA.\n'));
      return;
    }

    if (cmd === 'add' || cmd === 'setup') {
      console.log(chalk.bold('\n  ➕ Add TOTP/2FA\n'));
      console.log(chalk.yellow('  No password entries found.\n'));
      return;
    }

    if (cmd === 'view' || cmd === 'show' || cmd === 'code') {
      console.log(chalk.yellow('\n  No entries have TOTP configured.\n'));
      return;
    }

    if (cmd === 'remove' || cmd === 'delete' || cmd === 'rm') {
      console.log(chalk.bold('\n  🗑️  Remove TOTP\n'));
      console.log(chalk.yellow('  No entries have TOTP configured.\n'));
      return;
    }

    // Default - show help
    showTOTPHelp();
    return;
  }

  // Ensure authenticated
  if (!await ensureAuthenticated()) {
    return;
  }

  const cmd = subcommand?.toLowerCase();

  switch (cmd) {
    case 'add':
    case 'setup':
      await addTOTP(searchTerm);
      break;

    case 'view':
    case 'show':
    case 'code':
      await viewTOTP(searchTerm, options?.copy);
      break;

    case 'remove':
    case 'delete':
    case 'rm':
      await removeTOTP(searchTerm);
      break;

    case 'list':
    case 'ls':
      await listTOTPEntries();
      break;

    default:
      showTOTPHelp();
  }
}

/**
 * Show TOTP command help
 */
function showTOTPHelp(): void {
  console.log(chalk.bold('\n  Store Website 2FA Codes\n'));
  console.log(chalk.gray('  ' + '─'.repeat(55)));
  console.log(chalk.white('\n  What is this?\n'));
  console.log(chalk.gray('  Many websites (Google, GitHub, Instagram, etc.) offer'));
  console.log(chalk.gray('  extra security called 2FA. When logging in, they ask'));
  console.log(chalk.gray('  for a 6-digit code that changes every 30 seconds.'));
  console.log('');
  console.log(chalk.gray('  Instead of using Google Authenticator or Authy,'));
  console.log(chalk.cyan('  you can store those codes right here in BlankDrive!'));
  console.log(chalk.gray('  Your passwords AND 2FA codes - all in one place.'));
  console.log(chalk.gray('\n  ' + '─'.repeat(55)));
  console.log(chalk.white('\n  Commands:\n'));
  console.log(`  ${chalk.cyan('totp add')}      Save a 2FA code for a website`);
  console.log(`  ${chalk.cyan('totp view')}     Get current 6-digit code to login`);
  console.log(`  ${chalk.cyan('totp list')}     See which accounts have 2FA saved`);
  console.log(`  ${chalk.cyan('totp remove')}   Remove 2FA from an account`);
  console.log(chalk.gray('\n  ' + '─'.repeat(55)));
  console.log(chalk.white('\n  How to set it up:\n'));
  console.log(chalk.gray('  1. First, save the website password: ') + chalk.cyan('add'));
  console.log(chalk.gray('  2. Go to that website\'s security settings'));
  console.log(chalk.gray('  3. Enable "Authenticator App" or "2FA"'));
  console.log(chalk.gray('  4. They\'ll show a secret key - copy it'));
  console.log(chalk.gray('  5. Run: ') + chalk.cyan('totp add') + chalk.gray(' and paste the key'));
  console.log(chalk.gray('  6. Next login, run: ') + chalk.cyan('totp view') + chalk.gray(' to get the code'));
  console.log(chalk.gray('\n  ' + '─'.repeat(55)));
  console.log(chalk.yellow('\n  Want to protect YOUR vault with 2FA?'));
  console.log(chalk.gray('  Run ') + chalk.cyan('2fa-setup') + chalk.gray(' to add extra security to your vault.'));
  console.log(chalk.gray('  This requires a code from your phone every time you unlock.\n'));
}

/**
 * Add TOTP to an entry
 */
async function addTOTP(searchTerm?: string): Promise<void> {
  console.log(chalk.bold('\n  ➕ Add TOTP/2FA\n'));

  // Find entry
  const entry = await findPasswordEntry(searchTerm);
  if (!entry) return;

  // Check if already has TOTP
  if (entry.totp) {
    const { replace } = await inquirer.prompt<{ replace: boolean }>([
      {
        type: 'confirm',
        name: 'replace',
        message: chalk.yellow('This entry already has TOTP configured. Replace it?'),
        default: false,
      },
    ]);

    if (!replace) {
      console.log(chalk.gray('\n  Cancelled.\n'));
      return;
    }
  }

  // Get TOTP secret
  console.log(chalk.gray('  You can enter a secret key or paste an otpauth:// URI.\n'));

  const { input } = await inquirer.prompt<{ input: string }>([
    {
      type: 'input',
      name: 'input',
      message: chalk.cyan('TOTP secret or otpauth:// URI:'),
      validate: (value: string) => {
        if (!value.trim()) {
          return 'Secret is required';
        }

        // Try parsing as otpauth URI
        if (value.startsWith('otpauth://')) {
          const parsed = parseOTPAuthURI(value);
          if (!parsed) {
            return 'Invalid otpauth:// URI';
          }
          return true;
        }

        // Validate as raw secret
        if (!validateTOTPSecret(value)) {
          return 'Invalid TOTP secret (must be valid base32, at least 16 characters)';
        }

        return true;
      },
    },
  ]);

  let totpData: TOTPData;

  if (input.startsWith('otpauth://')) {
    const parsed = parseOTPAuthURI(input);
    if (!parsed) {
      console.log(chalk.red('\n  Failed to parse otpauth:// URI.\n'));
      return;
    }
    totpData = {
      secret: parsed.secret,
      issuer: parsed.issuer,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period,
    };
  } else {
    // Get optional issuer
    const { issuer } = await inquirer.prompt<{ issuer: string }>([
      {
        type: 'input',
        name: 'issuer',
        message: chalk.cyan('Issuer/Service name (optional):'),
        default: entry.title,
      },
    ]);

    totpData = {
      secret: cleanTOTPSecret(input),
      issuer: issuer || undefined,
    };
  }

  // Test the TOTP code
  const spinner = ora('Testing TOTP code...').start();

  try {
    const testCode = generateTOTPCodeSync(totpData.secret);
    spinner.succeed('TOTP code generated successfully');

    console.log('');
    displayTOTPCode(testCode, entry.title);

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.cyan('Save this TOTP configuration?'),
        default: true,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray('\n  Cancelled.\n'));
      return;
    }

    // Save TOTP to entry
    await updateEntry(entry.id, { totp: totpData });

    console.log(chalk.green('\n  ✓ TOTP added successfully!'));
    console.log(chalk.gray(`  Use "totp view ${entry.title}" to see current code.\n`));
  } catch (error) {
    spinner.fail('Failed to generate TOTP code');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * View TOTP code for an entry
 */
async function viewTOTP(searchTerm?: string, copyToClipboard?: boolean): Promise<void> {
  // Find entry
  const entry = await findPasswordEntry(searchTerm, true);
  if (!entry) return;

  if (!entry.totp) {
    console.log(chalk.yellow(`\n  "${entry.title}" does not have TOTP configured.`));
    console.log(chalk.gray(`  Use "totp add ${entry.title}" to set it up.\n`));
    return;
  }

  try {
    const code = generateTOTPCodeSync(entry.totp.secret);
    displayTOTPCode(code, entry.title);

    if (copyToClipboard) {
      try {
        await clipboardy.write(code);
        console.log(chalk.green('  Code copied to clipboard!'));

        const remaining = getTimeRemaining();
        console.log(chalk.gray(`  (Valid for ${remaining} more seconds)\n`));

        // Clear clipboard after code expires
        setTimeout(async () => {
          try {
            const current = await clipboardy.read();
            if (current === code) {
              await clipboardy.write('');
            }
          } catch {
            // Ignore
          }
        }, remaining * 1000);
      } catch {
        console.log(chalk.yellow('  Could not copy to clipboard.\n'));
      }
    }
  } catch (error) {
    console.log(chalk.red('\n  Failed to generate TOTP code.'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * Remove TOTP from an entry
 */
async function removeTOTP(searchTerm?: string): Promise<void> {
  console.log(chalk.bold('\n  🗑️  Remove TOTP\n'));

  // Find entry
  const entry = await findPasswordEntry(searchTerm);
  if (!entry) return;

  if (!entry.totp) {
    console.log(chalk.yellow(`\n  "${entry.title}" does not have TOTP configured.\n`));
    return;
  }

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.yellow(`Remove TOTP from "${entry.title}"?`),
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.gray('\n  Cancelled.\n'));
    return;
  }

  // Remove TOTP
  await updateEntry(entry.id, { totp: undefined });

  console.log(chalk.green(`\n  ✓ TOTP removed from "${entry.title}".\n`));
}

/**
 * List entries with TOTP configured
 */
async function listTOTPEntries(): Promise<void> {
  console.log(chalk.bold('\n  🔐 Entries with TOTP/2FA\n'));

  const spinner = ora('Loading entries...').start();

  try {
    const entries = await listEntries();
    const passwordEntries = entries.filter(e => e.entryType === 'password' || !e.entryType);

    // Get full entries to check for TOTP
    const entriesWithTOTP: Array<{ id: string; title: string; issuer?: string }> = [];

    for (const e of passwordEntries) {
      const full = await getEntry(e.id);
      if (full?.totp) {
        entriesWithTOTP.push({
          id: full.id,
          title: full.title,
          issuer: full.totp.issuer,
        });
      }
    }

    spinner.stop();

    if (entriesWithTOTP.length === 0) {
      console.log(chalk.yellow('  No entries have TOTP configured.'));
      console.log(chalk.gray('  Use "totp add <entry>" to set up 2FA.\n'));
      return;
    }

    console.log(chalk.gray('  ' + '─'.repeat(50)));

    entriesWithTOTP.forEach((e, idx) => {
      const num = (idx + 1).toString().padStart(2, ' ');
      const issuer = e.issuer ? chalk.gray(` (${e.issuer})`) : '';
      console.log(`  ${chalk.gray(num + '.')} 🔐 ${chalk.cyan(e.title)}${issuer}`);
    });

    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(chalk.gray(`\n  ${entriesWithTOTP.length} entries with TOTP configured.\n`));
  } catch (error) {
    spinner.fail('Failed to load entries');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * Find a password entry by search term
 */
async function findPasswordEntry(
  searchTerm?: string,
  requireTOTP?: boolean
): Promise<Entry | null> {
  const spinner = ora('Loading entries...').start();

  try {
    const entries = await listEntries();
    const passwordEntries = entries.filter(e => e.entryType === 'password' || !e.entryType);

    spinner.stop();

    if (passwordEntries.length === 0) {
      console.log(chalk.yellow('  No password entries found.\n'));
      return null;
    }

    let targetEntry: Entry | null = null;

    if (searchTerm) {
      // Search by title
      const searchLower = searchTerm.toLowerCase();
      const matches = passwordEntries.filter(e =>
        e.title.toLowerCase().includes(searchLower)
      );

      if (matches.length === 0) {
        console.log(chalk.yellow(`  No entries matching "${searchTerm}".\n`));
        return null;
      }

      if (matches.length === 1) {
        targetEntry = await getEntry(matches[0]!.id);
      } else {
        // Multiple matches - let user choose
        const { selectedId } = await inquirer.prompt<{ selectedId: string }>([
          {
            type: 'list',
            name: 'selectedId',
            message: chalk.cyan('Multiple entries found. Select one:'),
            choices: matches.map(e => ({
              name: e.title,
              value: e.id,
            })),
          },
        ]);

        targetEntry = await getEntry(selectedId);
      }
    } else {
      // No search term - show all entries
      let entriesToShow = passwordEntries;

      // If requireTOTP, filter to only entries with TOTP
      if (requireTOTP) {
        const entriesWithTOTP: typeof passwordEntries = [];
        for (const e of passwordEntries) {
          const full = await getEntry(e.id);
          if (full?.totp) {
            entriesWithTOTP.push(e);
          }
        }
        entriesToShow = entriesWithTOTP;

        if (entriesToShow.length === 0) {
          console.log(chalk.yellow('  No entries have TOTP configured.\n'));
          return null;
        }
      }

      const { selectedId } = await inquirer.prompt<{ selectedId: string }>([
        {
          type: 'list',
          name: 'selectedId',
          message: chalk.cyan('Select an entry:'),
          choices: entriesToShow.map(e => ({
            name: e.title,
            value: e.id,
          })),
        },
      ]);

      targetEntry = await getEntry(selectedId);
    }

    return targetEntry;
  } catch (error) {
    spinner.fail('Failed to load entries');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
    return null;
  }
}
