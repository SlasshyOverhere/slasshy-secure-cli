import chalk from 'chalk';
import ora from 'ora';
import clipboardy from 'clipboardy';
import inquirer from 'inquirer';
import {
  vaultExists,
  unlock,
  searchEntries,
  getEntry,
  isUnlocked,
  listEntries,
  type Entry,
} from '../../storage/vault/index.js';
import { promptPassword, promptSelectEntry } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import { checkPasswordExpiry } from './audit.js';
import { logAuditEvent } from '../auditLog.js';
import {
  fuzzySearchEntries,
  formatSearchResult,
  getMatchQuality,
  type SearchableEntry,
  type FuzzySearchResult,
} from '../fuzzySearch.js';
import { isInDuressMode, getDecoyEntries } from '../duress.js';

export async function getCommand(
  searchTerm?: string,
  options?: { copy?: boolean; showPassword?: boolean }
): Promise<void> {
  // Duress mode - show decoy entries
  if (isInDuressMode()) {
    const decoyEntries = getDecoyEntries();
    const query = searchTerm?.toLowerCase() || '';

    const matches = query
      ? decoyEntries.filter(e => e.title.toLowerCase().includes(query) || e.username.toLowerCase().includes(query))
      : decoyEntries;

    if (matches.length === 0) {
      console.log(chalk.yellow(`\n  No entries found${query ? ` matching "${searchTerm}"` : ''}.\n`));
      return;
    }

    const entry = matches[0]!;
    console.log('');
    console.log(chalk.bold.cyan(`  ${entry.title}`));
    console.log(chalk.gray('  ' + '─'.repeat(40)));
    console.log(`  ${chalk.gray('Username:')} ${entry.username}`);

    // Generate a fake but realistic-looking password
    const fakePassword = 'Tr0ub4dor&3';
    if (options?.showPassword) {
      console.log(`  ${chalk.gray('Password:')} ${fakePassword}`);
    } else {
      console.log(`  ${chalk.gray('Password:')} ${'*'.repeat(12)} ${chalk.gray('(use --show-password to reveal)')}`);
    }

    if (entry.url) {
      console.log(`  ${chalk.gray('URL:')} ${entry.url}`);
    }
    console.log(chalk.gray('  ' + '─'.repeat(40)));
    console.log(chalk.gray(`  Created: ${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleString()}`));
    console.log(chalk.gray(`  Modified: ${new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toLocaleString()}`));
    console.log('');

    if (options?.copy) {
      try {
        await clipboardy.write(fakePassword);
        console.log(chalk.green('  Password copied to clipboard!'));
        console.log(chalk.gray('  (Will be cleared in 30 seconds)\n'));
      } catch {
        console.log(chalk.yellow('  Could not copy to clipboard.\n'));
      }
    }
    return;
  }

  // Check vault exists
  if (!await vaultExists()) {
    console.log(chalk.red('\n  No vault found. Run "BLANK init" first.\n'));
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

  // Search for entries using fuzzy search
  const query = searchTerm || '';
  const spinner = ora('Searching...').start();

  let searchResults: FuzzySearchResult[];
  let allEntries: SearchableEntry[];
  try {
    // Get all entries from vault
    const rawEntries = await listEntries();

    // Convert to searchable entries
    allEntries = rawEntries.map(e => ({
      id: e.id,
      title: e.title,
      username: undefined, // Will be populated later if needed
      url: undefined,
      category: e.category,
      entryType: e.entryType,
      modified: e.modified,
      favorite: e.favorite,
    }));

    // Perform fuzzy search
    searchResults = fuzzySearchEntries(allEntries, query);
    spinner.stop();
  } catch (error) {
    spinner.fail('Search failed');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  if (searchResults.length === 0) {
    console.log(chalk.yellow(`\n  No entries found${query ? ` matching "${query}"` : ''}.\n`));
    return;
  }

  // Select entry if multiple matches
  let entry: Entry | null = null;
  if (searchResults.length === 1) {
    entry = await getEntry(searchResults[0]!.item.id);
  } else {
    // Show fuzzy search results with match quality
    console.log(chalk.bold(`\n  Found ${searchResults.length} entries:\n`));

    // Take top 10 results
    const topResults = searchResults.slice(0, 10);

    const choices = topResults.map((result, idx) => ({
      name: `${getMatchQuality(result.score)} ${formatSearchResult(result)}`,
      value: result.item.id,
    }));

    if (searchResults.length > 10) {
      console.log(chalk.gray(`  Showing top 10 of ${searchResults.length} matches\n`));
    }

    const { selectedId } = await inquirer.prompt<{ selectedId: string }>([
      {
        type: 'list',
        name: 'selectedId',
        message: chalk.cyan('Select entry:'),
        choices,
      },
    ]);

    if (!selectedId) {
      return;
    }

    entry = await getEntry(selectedId);
  }

  if (!entry) {
    console.log(chalk.red('\n  Entry not found.\n'));
    return;
  }

  // Display entry
  displayEntry(entry, options?.showPassword);

  // Log audit events
  await logAuditEvent('entry_accessed', { entryId: entry.id, entryTitle: entry.title });
  if (options?.showPassword && entry.password) {
    await logAuditEvent('password_viewed', { entryId: entry.id, entryTitle: entry.title });
  }

  // Copy password if requested
  if (options?.copy && entry.password) {
    try {
      await clipboardy.write(entry.password);
      console.log(chalk.green('  Password copied to clipboard!'));
      console.log(chalk.gray('  (Will be cleared in 30 seconds)\n'));

      // Log password copy
      await logAuditEvent('password_copied', { entryId: entry.id, entryTitle: entry.title });

      // Clear clipboard after 30 seconds
      setTimeout(async () => {
        try {
          const current = await clipboardy.read();
          if (current === entry.password) {
            await clipboardy.write('');
          }
        } catch {
          // Ignore clipboard errors
        }
      }, 30000);
    } catch {
      console.log(chalk.yellow('  Could not copy to clipboard.\n'));
    }
  }
}

function displayEntry(entry: Entry, showPassword: boolean = false): void {
  console.log('');
  console.log(chalk.bold.cyan(`  ${entry.title}`));
  console.log(chalk.gray('  ' + '─'.repeat(40)));

  if (entry.username) {
    console.log(`  ${chalk.gray('Username:')} ${entry.username}`);
  }

  if (entry.password) {
    if (showPassword) {
      console.log(`  ${chalk.gray('Password:')} ${entry.password}`);
    } else {
      console.log(`  ${chalk.gray('Password:')} ${'*'.repeat(12)} ${chalk.gray('(use --show-password to reveal)')}`);
    }

    // Check password expiry and show warning if needed
    const expiryWarning = checkPasswordExpiry(entry);
    if (expiryWarning) {
      console.log(`  ${expiryWarning}`);
    }
  }

  if (entry.url) {
    console.log(`  ${chalk.gray('URL:')} ${entry.url}`);
  }

  if (entry.notes) {
    console.log(`  ${chalk.gray('Notes:')}`);
    entry.notes.split('\n').forEach(line => {
      console.log(chalk.gray(`    ${line}`));
    });
  }

  console.log(chalk.gray('  ' + '─'.repeat(40)));
  console.log(chalk.gray(`  Created: ${new Date(entry.created).toLocaleString()}`));
  console.log(chalk.gray(`  Modified: ${new Date(entry.modified).toLocaleString()}`));
  if (entry.passwordLastChanged) {
    console.log(chalk.gray(`  Password changed: ${new Date(entry.passwordLastChanged).toLocaleString()}`));
  }
  console.log('');
}
