import chalk from 'chalk';
import ora from 'ora';
import {
  vaultExists,
  unlock,
  addEntry,
  isUnlocked,
} from '../../storage/vault/index.js';
import { promptPassword, promptEntryDetails } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import { logAuditEvent } from '../auditLog.js';
import { isInDuressMode } from '../duress.js';

export async function addCommand(): Promise<void> {
  console.log(chalk.bold('\n  Add New Entry\n'));

  // Duress mode - pretend to add but don't save
  if (isInDuressMode()) {
    const details = await promptEntryDetails();

    const spinner = ora('Encrypting and saving entry...').start();
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 800));
    spinner.succeed('Entry added');

    console.log(chalk.green(`\n  Entry "${details.title}" saved successfully!`));
    console.log(chalk.gray(`  ID: decoy_${Date.now().toString(36)}`));
    console.log(chalk.gray('\n  Note: Run "BLANK sync" to upload to Google Drive.\n'));
    return;
  }

  // Check vault exists
  if (!await vaultExists()) {
    console.log(chalk.red('  No vault found. Run "BLANK init" first.'));
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

  // Get entry details
  console.log('');
  const details = await promptEntryDetails();

  // Add entry
  const spinner = ora('Encrypting and saving entry...').start();

  try {
    const entry = await addEntry(details.title, {
      username: details.username,
      password: details.password,
      url: details.url,
      notes: details.notes,
    });

    spinner.succeed('Entry added');

    // Log audit event
    await logAuditEvent('entry_created', { entryId: entry.id, entryTitle: entry.title });

    console.log(chalk.green(`\n  Entry "${entry.title}" saved successfully!`));
    console.log(chalk.gray(`  ID: ${entry.id}`));
    console.log(chalk.gray('\n  Note: Run "BLANK sync" to upload to Google Drive.\n'));
  } catch (error) {
    spinner.fail('Failed to add entry');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
  }
}
