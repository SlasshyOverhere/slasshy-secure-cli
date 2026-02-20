import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import {
  vaultExists,
  unlock,
  searchEntries,
  deleteEntry,
  listEntries,
  isUnlocked,
  getVaultIndex,
  type Entry,
} from '../../storage/vault/index.js';
import { promptPassword, promptConfirm, promptSelectEntry } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import { ensureAuthenticated } from '../ensureAuth.js';
import { deleteFileFromCloud } from '../../storage/drive/index.js';

export async function deleteCommand(
  searchTerm?: string,
  options?: { force?: boolean }
): Promise<void> {
  // Auto-authenticate with Google Drive (also handles vault unlock)
  if (!await ensureAuthenticated()) {
    return;
  }

  // Search for entries
  const query = searchTerm || '';
  if (!query) {
    console.log(chalk.yellow('\n  Please specify an entry to delete.\n'));
    console.log(chalk.gray('  Usage: slasshy delete <number> or slasshy delete <title>\n'));
    return;
  }

  const spinner = ora('Searching...').start();

  let entries: Entry[];
  let entry: Entry | undefined;
  const vaultIndex = getVaultIndex();

  try {
    // Check if query is a number (file ID)
    const numIndex = parseInt(query, 10);
    if (!isNaN(numIndex) && numIndex > 0) {
      // Get all entries and use index
      const allEntries = await listEntries();

      // Separate files and passwords like list command does
      const fileEntries = allEntries.filter(e => vaultIndex?.entries[e.id]?.entryType === 'file');
      const passwordEntries = allEntries.filter(e => vaultIndex?.entries[e.id]?.entryType !== 'file');

      // Check valid indexes
      const fileEntry = numIndex <= fileEntries.length ? fileEntries[numIndex - 1] : undefined;
      const passwordEntry = numIndex <= passwordEntries.length ? passwordEntries[numIndex - 1] : undefined;

      if (fileEntry && passwordEntry) {
        spinner.stop();
        // Ambiguous index - ask user
        console.log(chalk.yellow(`\n  Ambiguous index: ${numIndex} matches both a file and a password.`));
        const { targetType } = await inquirer.prompt<{ targetType: string }>([
          {
            type: 'list',
            name: 'targetType',
            message: 'Which one do you want to delete?',
            choices: [
              { name: `Password: ${passwordEntry.title}`, value: 'password' },
              { name: `File: ${fileEntry.title}`, value: 'file' },
            ],
          },
        ]);

        const target = targetType === 'password' ? passwordEntry : fileEntry;
        entries = await searchEntries(target.title);
        entry = entries.find(e => e.id === target.id);
      } else if (fileEntry) {
        entries = await searchEntries(fileEntry.title);
        entry = entries.find(e => e.id === fileEntry.id);
      } else if (passwordEntry) {
        entries = await searchEntries(passwordEntry.title);
        entry = entries.find(e => e.id === passwordEntry.id);
      } else {
        spinner.stop();
        console.log(chalk.red(`\n  Invalid number: ${numIndex}`));
        if (fileEntries.length > 0) {
          console.log(chalk.gray(`  Files range: 1-${fileEntries.length}`));
        }
        if (passwordEntries.length > 0) {
          console.log(chalk.gray(`  Passwords range: 1-${passwordEntries.length}`));
        }
        console.log(chalk.gray(`  Use "list" to see all entries.\n`));
        return;
      }
    } else {
      // Search by title
      entries = await searchEntries(query);
    }
    spinner.stop();
  } catch (error) {
    spinner.fail('Search failed');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  if (entries.length === 0) {
    console.log(chalk.yellow(`\n  No entries found matching "${query}".\n`));
    return;
  }

  // Select entry if multiple matches (and entry not already set by numeric ID)
  if (!entry) {
    if (entries.length === 1) {
      entry = entries[0]!;
    } else {
      console.log(chalk.gray(`\n  Found ${entries.length} entries:\n`));
      const selectedId = await promptSelectEntry(
        entries.map(e => ({ id: e.id, title: e.title, modified: e.modified }))
      );
      if (!selectedId) {
        return;
      }
      entry = entries.find(e => e.id === selectedId)!;
    }
  }

  // Confirm deletion
  if (!options?.force) {
    console.log('');
    const confirmed = await promptConfirm(
      `Delete "${entry.title}"? This cannot be undone.`
    );
    if (!confirmed) {
      console.log(chalk.gray('\n  Cancelled.\n'));
      return;
    }
  }

  // Delete entry (local + cloud)
  const deleteSpinner = ora('Deleting entry...').start();

  try {
    // Delete from cloud if it's a file with cloud chunks
    const indexEntry = vaultIndex?.entries[entry.id];
    let cloudDeleteFailed = false;
    let cloudError = '';

    if (indexEntry?.entryType === 'file' && indexEntry.cloudChunks && indexEntry.cloudChunks.length > 0) {
      deleteSpinner.text = 'Deleting from cloud...';
      try {
        await deleteFileFromCloud(entry.id, indexEntry.cloudChunks);
      } catch (error) {
        cloudDeleteFailed = true;
        cloudError = error instanceof Error ? error.message : 'Unknown error';
      }
    }

    if (cloudDeleteFailed) {
      deleteSpinner.warn('Cloud deletion failed');
      console.log(chalk.yellow(`\n  ${cloudError}\n`));

      // Ask if user wants to delete locally anyway
      const { proceedLocal } = await inquirer.prompt<{ proceedLocal: boolean }>([
        {
          type: 'confirm',
          name: 'proceedLocal',
          message: 'Delete local entry anyway? (Cloud files may remain)',
          default: true,
        },
      ]);

      if (!proceedLocal) {
        console.log(chalk.gray('\n  Cancelled.\n'));
        return;
      }
    }

    // Delete local entry
    deleteSpinner.start('Deleting local entry...');
    await deleteEntry(entry.id);
    deleteSpinner.succeed('Entry deleted');

    if (cloudDeleteFailed) {
      console.log(chalk.yellow(`\n  "${entry.title}" deleted locally. Cloud files may need manual cleanup.\n`));
    } else {
      console.log(chalk.green(`\n  "${entry.title}" has been deleted from local and cloud.\n`));
    }
  } catch (error) {
    deleteSpinner.fail('Failed to delete entry');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
