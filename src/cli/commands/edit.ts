import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import {
  vaultExists,
  unlock,
  searchEntries,
  getEntry,
  updateEntry,
  isUnlocked,
  listEntries,
  type Entry,
} from '../../storage/vault/index.js';
import { promptPassword, promptSelectEntry } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import {
  generatePassword,
  generatePassphrase,
  analyzePassword,
  PASSWORD_PRESETS,
} from '../../crypto/index.js';
import { logAuditEvent } from '../auditLog.js';
import { isInDuressMode, getDecoyEntries } from '../duress.js';

/**
 * Get strength color based on level
 */
function getStrengthColor(strength: string): (text: string) => string {
  switch (strength) {
    case 'excellent': return chalk.green;
    case 'strong': return chalk.cyan;
    case 'good': return chalk.blue;
    case 'fair': return chalk.yellow;
    case 'weak': return chalk.red;
    default: return chalk.gray;
  }
}

/**
 * Display current entry values
 */
function displayCurrentEntry(entry: Entry): void {
  console.log('');
  console.log(chalk.bold.cyan(`  Current Values for "${entry.title}":`));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  ${chalk.gray('Title:')}    ${entry.title}`);
  console.log(`  ${chalk.gray('Username:')} ${entry.username || chalk.dim('(not set)')}`);
  console.log(`  ${chalk.gray('Password:')} ${entry.password ? '*'.repeat(12) : chalk.dim('(not set)')}`);
  console.log(`  ${chalk.gray('URL:')}      ${entry.url || chalk.dim('(not set)')}`);
  console.log(`  ${chalk.gray('Notes:')}    ${entry.notes ? entry.notes.substring(0, 50) + (entry.notes.length > 50 ? '...' : '') : chalk.dim('(not set)')}`);
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}

/**
 * Prompt for which fields to edit
 */
async function promptFieldsToEdit(entry: Entry): Promise<string[]> {
  const { fields } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'fields',
      message: chalk.cyan('Select fields to edit:'),
      choices: [
        { name: `Title (current: ${entry.title})`, value: 'title' },
        { name: `Username (current: ${entry.username || 'not set'})`, value: 'username' },
        { name: `Password ${entry.password ? '(currently set)' : '(not set)'}`, value: 'password' },
        { name: `URL (current: ${entry.url || 'not set'})`, value: 'url' },
        { name: `Notes ${entry.notes ? '(currently set)' : '(not set)'}`, value: 'notes' },
      ],
      validate: (input: string[]) => {
        if (input.length === 0) {
          return 'Select at least one field to edit';
        }
        return true;
      },
    },
  ]);

  return fields;
}

/**
 * Prompt for new password with generation option
 */
async function promptNewPassword(currentHasPassword: boolean): Promise<string | undefined | null> {
  const choices = [
    { name: '🔐 Generate strong password', value: 'generate_strong' },
    { name: '📝 Generate passphrase', value: 'generate_passphrase' },
    { name: '✏️  Enter manually', value: 'manual' },
  ];

  if (currentHasPassword) {
    choices.push({ name: '🗑️  Remove password', value: 'remove' });
    choices.push({ name: '⏭️  Keep current password', value: 'keep' });
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.cyan('New password:'),
      choices,
    },
  ]);

  if (action === 'keep') {
    return null; // Signal to not change
  }

  if (action === 'remove') {
    return undefined; // Signal to remove
  }

  if (action === 'manual') {
    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: chalk.cyan('Enter new password:'),
        mask: '*',
      },
    ]);
    return password || undefined;
  }

  // Generate password
  let password: string;
  if (action === 'generate_passphrase') {
    password = generatePassphrase(5);
  } else {
    password = generatePassword(PASSWORD_PRESETS.strong);
  }

  const analysis = analyzePassword(password);
  const strengthColor = getStrengthColor(analysis.strength);

  console.log('');
  console.log(`  ${chalk.bold('Generated:')} ${chalk.white(password)}`);
  console.log(`  ${chalk.bold('Strength:')}  ${strengthColor(analysis.strength.toUpperCase())} (${analysis.entropy.toFixed(0)} bits)`);
  console.log('');

  const { confirm } = await inquirer.prompt([
    {
      type: 'list',
      name: 'confirm',
      message: chalk.cyan('Use this password?'),
      choices: [
        { name: '✓ Yes, use this password', value: 'yes' },
        { name: '🔄 Generate another', value: 'regenerate' },
        { name: '✏️  Enter manually instead', value: 'manual' },
      ],
    },
  ]);

  if (confirm === 'yes') {
    return password;
  } else if (confirm === 'regenerate') {
    return promptNewPassword(currentHasPassword);
  } else {
    const { manualPassword } = await inquirer.prompt([
      {
        type: 'password',
        name: 'manualPassword',
        message: chalk.cyan('Enter new password:'),
        mask: '*',
      },
    ]);
    return manualPassword || undefined;
  }
}

/**
 * Prompt for field values
 */
async function promptFieldValues(
  entry: Entry,
  fields: string[]
): Promise<Partial<Entry>> {
  const updates: Partial<Entry> = {};

  for (const field of fields) {
    switch (field) {
      case 'title': {
        const { title } = await inquirer.prompt([
          {
            type: 'input',
            name: 'title',
            message: chalk.cyan('New title:'),
            default: entry.title,
            validate: (input: string) => input.length > 0 || 'Title is required',
          },
        ]);
        updates.title = title;
        break;
      }

      case 'username': {
        const { username } = await inquirer.prompt([
          {
            type: 'input',
            name: 'username',
            message: chalk.cyan('New username (leave empty to remove):'),
            default: entry.username || '',
          },
        ]);
        updates.username = username || undefined;
        break;
      }

      case 'password': {
        const password = await promptNewPassword(!!entry.password);
        if (password !== null) {
          updates.password = password;
        }
        break;
      }

      case 'url': {
        const { url } = await inquirer.prompt([
          {
            type: 'input',
            name: 'url',
            message: chalk.cyan('New URL (leave empty to remove):'),
            default: entry.url || '',
          },
        ]);
        updates.url = url || undefined;
        break;
      }

      case 'notes': {
        const { notes } = await inquirer.prompt([
          {
            type: 'editor',
            name: 'notes',
            message: chalk.cyan('Edit notes:'),
            default: entry.notes || '',
          },
        ]);
        updates.notes = notes?.trim() || undefined;
        break;
      }
    }
  }

  return updates;
}

/**
 * Edit command handler
 */
export async function editCommand(searchTerm?: string): Promise<void> {
  console.log(chalk.bold('\n  ✏️  Edit Entry\n'));

  // Duress mode - pretend to edit decoy entries
  if (isInDuressMode()) {
    const decoyEntries = getDecoyEntries();
    const query = searchTerm?.toLowerCase() || '';

    let matches = query
      ? decoyEntries.filter(e => e.title.toLowerCase().includes(query))
      : decoyEntries;

    if (matches.length === 0) {
      console.log(chalk.yellow(`\n  No entries found matching "${searchTerm}".\n`));
      return;
    }

    const entry = matches[0]!;
    console.log('');
    console.log(chalk.bold.cyan(`  Current Values for "${entry.title}":`));
    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(`  ${chalk.gray('Title:')}    ${entry.title}`);
    console.log(`  ${chalk.gray('Username:')} ${entry.username}`);
    console.log(`  ${chalk.gray('Password:')} ************`);
    console.log(`  ${chalk.gray('URL:')}      ${entry.url || chalk.dim('(not set)')}`);
    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log('');

    const { fields } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'fields',
        message: chalk.cyan('Select fields to edit:'),
        choices: [
          { name: `Title (current: ${entry.title})`, value: 'title' },
          { name: `Username (current: ${entry.username})`, value: 'username' },
          { name: `Password (currently set)`, value: 'password' },
          { name: `URL (current: ${entry.url || 'not set'})`, value: 'url' },
        ],
      },
    ]);

    if (fields.length === 0) {
      console.log(chalk.yellow('\n  No changes made.\n'));
      return;
    }

    // Collect fake edits
    for (const field of fields) {
      await inquirer.prompt([
        {
          type: field === 'password' ? 'password' : 'input',
          name: 'value',
          message: chalk.cyan(`New ${field}:`),
          mask: field === 'password' ? '*' : undefined,
        },
      ]);
    }

    const spinner = ora('Saving changes...').start();
    await new Promise(resolve => setTimeout(resolve, 600));
    spinner.succeed('Entry updated successfully');

    console.log(chalk.green(`\n  "${entry.title}" has been updated.\n`));
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

  // Find entry to edit
  let entry: Entry | null = null;

  if (searchTerm) {
    // Search for entries
    const spinner = ora('Searching...').start();
    try {
      const entries = await searchEntries(searchTerm);
      spinner.stop();

      if (entries.length === 0) {
        console.log(chalk.yellow(`\n  No entries found matching "${searchTerm}".\n`));
        return;
      }

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
        entry = entries.find(e => e.id === selectedId) || null;
      }
    } catch (error) {
      spinner.fail('Search failed');
      if (error instanceof Error) {
        console.log(chalk.red(`  ${error.message}`));
      }
      return;
    }
  } else {
    // List all entries and let user select
    const spinner = ora('Loading entries...').start();
    try {
      const allEntries = await listEntries();
      spinner.stop();

      if (allEntries.length === 0) {
        console.log(chalk.yellow('\n  No entries in vault.\n'));
        return;
      }

      // Filter to only password entries (not files)
      const passwordEntries = allEntries.filter(e => !e.id.startsWith('file_'));

      if (passwordEntries.length === 0) {
        console.log(chalk.yellow('\n  No password entries to edit.\n'));
        return;
      }

      const selectedId = await promptSelectEntry(passwordEntries);
      if (!selectedId) {
        return;
      }

      entry = await getEntry(selectedId);
    } catch (error) {
      spinner.fail('Failed to load entries');
      if (error instanceof Error) {
        console.log(chalk.red(`  ${error.message}`));
      }
      return;
    }
  }

  if (!entry) {
    console.log(chalk.red('\n  Entry not found.\n'));
    return;
  }

  // Display current values
  displayCurrentEntry(entry);

  // Select fields to edit
  const fieldsToEdit = await promptFieldsToEdit(entry);

  if (fieldsToEdit.length === 0) {
    console.log(chalk.yellow('\n  No changes made.\n'));
    return;
  }

  // Get new values
  const updates = await promptFieldValues(entry, fieldsToEdit);

  // Check if any changes were made
  const hasChanges = Object.keys(updates).some(key => {
    const k = key as keyof typeof updates;
    return updates[k] !== entry![k];
  });

  if (!hasChanges) {
    console.log(chalk.yellow('\n  No changes detected.\n'));
    return;
  }

  // Confirm changes
  console.log('');
  console.log(chalk.bold('  Changes to be applied:'));
  console.log(chalk.gray('  ' + '─'.repeat(40)));

  for (const [key, value] of Object.entries(updates)) {
    const displayValue = key === 'password'
      ? (value ? '********' : chalk.dim('(removed)'))
      : (value || chalk.dim('(removed)'));
    console.log(`  ${chalk.cyan(key)}: ${displayValue}`);
  }

  console.log(chalk.gray('  ' + '─'.repeat(40)));
  console.log('');

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.yellow('Apply these changes?'),
      default: true,
    },
  ]);

  if (!confirm) {
    console.log(chalk.gray('\n  Edit cancelled.\n'));
    return;
  }

  // Apply changes
  const spinner = ora('Saving changes...').start();

  try {
    const updatedEntry = await updateEntry(entry.id, updates);

    if (updatedEntry) {
      spinner.succeed('Entry updated successfully');

      // Log audit event
      await logAuditEvent('entry_updated', { entryId: entry.id, entryTitle: updatedEntry.title });

      console.log(chalk.green(`\n  "${updatedEntry.title}" has been updated.\n`));
    } else {
      spinner.fail('Failed to update entry');
      console.log(chalk.red('\n  Entry could not be updated.\n'));
    }
  } catch (error) {
    spinner.fail('Failed to save changes');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}
