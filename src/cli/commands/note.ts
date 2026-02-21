import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import {
  vaultExists,
  unlock,
  addNoteEntry,
  getNoteEntry,
  updateNoteEntry,
  listEntries,
  isUnlocked,
  type NoteEntry,
} from '../../storage/vault/index.js';
import { promptPassword, promptSelectEntry } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import { isInDuressMode } from '../duress.js';

/**
 * Add a new note
 */
export async function noteAddCommand(): Promise<void> {
  console.log(chalk.bold('\n  📝 Add Secure Note\n'));

  // Duress mode - pretend to add note
  if (isInDuressMode()) {
    const { title } = await inquirer.prompt([
      {
        type: 'input',
        name: 'title',
        message: chalk.cyan('Note title:'),
        validate: (input: string) => input.length > 0 || 'Title is required',
      },
    ]);

    console.log(chalk.gray('\n  Opening editor for note content...'));
    console.log(chalk.gray('  (Save and close the editor when done)\n'));

    await inquirer.prompt([
      {
        type: 'editor',
        name: 'content',
        message: chalk.cyan('Note content:'),
      },
    ]);

    const spinner = ora('Saving note...').start();
    await new Promise(resolve => setTimeout(resolve, 500));
    spinner.succeed('Note saved');

    console.log(chalk.green(`\n  📝 "${title}" saved successfully!`));
    console.log(chalk.gray(`  ID: note_${Date.now().toString(36)}`));
    console.log(chalk.gray(`  Length: 0 characters\n`));
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

  // Get note details
  const { title } = await inquirer.prompt([
    {
      type: 'input',
      name: 'title',
      message: chalk.cyan('Note title:'),
      validate: (input: string) => input.length > 0 || 'Title is required',
    },
  ]);

  console.log(chalk.gray('\n  Opening editor for note content...'));
  console.log(chalk.gray('  (Save and close the editor when done)\n'));

  const { content } = await inquirer.prompt([
    {
      type: 'editor',
      name: 'content',
      message: chalk.cyan('Note content:'),
      validate: (input: string) => input.trim().length > 0 || 'Content is required',
    },
  ]);

  // Save note
  const spinner = ora('Saving note...').start();

  try {
    const note = await addNoteEntry(title, content.trim());
    spinner.succeed('Note saved');

    console.log(chalk.green(`\n  📝 "${note.title}" saved successfully!`));
    console.log(chalk.gray(`  ID: ${note.id}`));
    console.log(chalk.gray(`  Length: ${note.content.length} characters\n`));
  } catch (error) {
    spinner.fail('Failed to save note');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * View a note
 */
export async function noteViewCommand(searchTerm?: string): Promise<void> {
  console.log(chalk.bold('\n  📝 View Secure Note\n'));

  // Duress mode - no notes to view
  if (isInDuressMode()) {
    console.log(chalk.yellow('  No notes found.'));
    console.log(chalk.gray('  Use "BLANK note add" to create one.\n'));
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

  // Get all entries and filter to notes
  const spinner = ora('Loading notes...').start();
  let entries: Awaited<ReturnType<typeof listEntries>>;

  try {
    entries = await listEntries();
    spinner.stop();
  } catch (error) {
    spinner.fail('Failed to load entries');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // Filter to notes only
  let noteEntries = entries.filter(e => e.entryType === 'note');

  if (noteEntries.length === 0) {
    console.log(chalk.yellow('  No notes found.'));
    console.log(chalk.gray('  Use "BLANK note add" to create one.\n'));
    return;
  }

  // Filter by search term if provided
  if (searchTerm) {
    const searchLower = searchTerm.toLowerCase();
    noteEntries = noteEntries.filter(e =>
      e.title.toLowerCase().includes(searchLower)
    );

    if (noteEntries.length === 0) {
      console.log(chalk.yellow(`  No notes found matching "${searchTerm}".\n`));
      return;
    }
  }

  // Select note
  let selectedId: string | null;

  if (noteEntries.length === 1) {
    selectedId = noteEntries[0]!.id;
  } else {
    const formattedEntries = noteEntries.map(e => ({
      id: e.id,
      title: `${e.favorite ? '⭐ ' : '   '}📝 ${e.title}`,
      modified: e.modified,
    }));

    selectedId = await promptSelectEntry(formattedEntries);
  }

  if (!selectedId) {
    return;
  }

  // Get full note
  const note = await getNoteEntry(selectedId);

  if (!note) {
    console.log(chalk.red('\n  Note not found.\n'));
    return;
  }

  // Display note
  displayNote(note);
}

/**
 * Edit a note
 */
export async function noteEditCommand(searchTerm?: string): Promise<void> {
  console.log(chalk.bold('\n  ✏️ Edit Secure Note\n'));

  // Duress mode - no notes to edit
  if (isInDuressMode()) {
    console.log(chalk.yellow('  No notes found.\n'));
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

  // Get all notes
  const spinner = ora('Loading notes...').start();
  let entries: Awaited<ReturnType<typeof listEntries>>;

  try {
    entries = await listEntries();
    spinner.stop();
  } catch (error) {
    spinner.fail('Failed to load entries');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    return;
  }

  // Filter to notes only
  let noteEntries = entries.filter(e => e.entryType === 'note');

  if (noteEntries.length === 0) {
    console.log(chalk.yellow('  No notes found.\n'));
    return;
  }

  // Filter by search term if provided
  if (searchTerm) {
    const searchLower = searchTerm.toLowerCase();
    noteEntries = noteEntries.filter(e =>
      e.title.toLowerCase().includes(searchLower)
    );

    if (noteEntries.length === 0) {
      console.log(chalk.yellow(`  No notes found matching "${searchTerm}".\n`));
      return;
    }
  }

  // Select note
  let selectedId: string | null;

  if (noteEntries.length === 1) {
    selectedId = noteEntries[0]!.id;
  } else {
    const formattedEntries = noteEntries.map(e => ({
      id: e.id,
      title: `📝 ${e.title}`,
      modified: e.modified,
    }));

    selectedId = await promptSelectEntry(formattedEntries);
  }

  if (!selectedId) {
    return;
  }

  // Get full note
  const note = await getNoteEntry(selectedId);

  if (!note) {
    console.log(chalk.red('\n  Note not found.\n'));
    return;
  }

  // What to edit?
  const { editChoice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'editChoice',
      message: chalk.cyan('What would you like to edit?'),
      choices: [
        { name: 'Content', value: 'content' },
        { name: 'Title', value: 'title' },
        { name: 'Both', value: 'both' },
      ],
    },
  ]);

  const updates: Partial<NoteEntry> = {};

  if (editChoice === 'title' || editChoice === 'both') {
    const { newTitle } = await inquirer.prompt([
      {
        type: 'input',
        name: 'newTitle',
        message: chalk.cyan('New title:'),
        default: note.title,
        validate: (input: string) => input.length > 0 || 'Title is required',
      },
    ]);
    updates.title = newTitle;
  }

  if (editChoice === 'content' || editChoice === 'both') {
    console.log(chalk.gray('\n  Opening editor with current content...'));

    const { newContent } = await inquirer.prompt([
      {
        type: 'editor',
        name: 'newContent',
        message: chalk.cyan('Edit content:'),
        default: note.content,
        validate: (input: string) => input.trim().length > 0 || 'Content is required',
      },
    ]);
    updates.content = newContent.trim();
  }

  // Save changes
  const saveSpinner = ora('Saving changes...').start();

  try {
    const updated = await updateNoteEntry(note.id, updates);

    if (updated) {
      saveSpinner.succeed('Note updated');
      console.log(chalk.green(`\n  "${updated.title}" has been updated.\n`));
    } else {
      saveSpinner.fail('Failed to update note');
    }
  } catch (error) {
    saveSpinner.fail('Failed to save changes');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * List all notes
 */
export async function noteListCommand(): Promise<void> {
  console.log(chalk.bold('\n  📝 Secure Notes\n'));

  // Duress mode - show no notes
  if (isInDuressMode()) {
    console.log(chalk.yellow('  No notes found.'));
    console.log(chalk.gray('  Use "BLANK note add" to create one.\n'));
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

  // Get all notes
  const spinner = ora('Loading notes...').start();

  try {
    const entries = await listEntries();
    spinner.stop();

    const noteEntries = entries.filter(e => e.entryType === 'note');

    if (noteEntries.length === 0) {
      console.log(chalk.yellow('  No notes found.'));
      console.log(chalk.gray('  Use "BLANK note add" to create one.\n'));
      return;
    }

    console.log(chalk.gray(`  Found ${noteEntries.length} note${noteEntries.length > 1 ? 's' : ''}:\n`));
    console.log(chalk.gray('  ' + '─'.repeat(50)));

    for (const entry of noteEntries) {
      const star = entry.favorite ? '⭐ ' : '   ';
      const date = new Date(entry.modified).toLocaleDateString();
      console.log(`  ${star}📝 ${chalk.white(entry.title)} ${chalk.gray(`(${date})`)}`);
    }

    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(chalk.gray(`\n  View: note view <title>  |  Edit: note edit <title>\n`));
  } catch (error) {
    spinner.fail('Failed to load notes');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * Display a note
 */
function displayNote(note: NoteEntry): void {
  console.log('');
  console.log(chalk.bold.cyan(`  📝 ${note.title}`));
  console.log(chalk.gray('  ' + '─'.repeat(60)));
  console.log('');

  // Display content with proper indentation
  const lines = note.content.split('\n');
  for (const line of lines) {
    console.log(`  ${line}`);
  }

  console.log('');
  console.log(chalk.gray('  ' + '─'.repeat(60)));
  console.log(chalk.gray(`  Created:  ${new Date(note.created).toLocaleString()}`));
  console.log(chalk.gray(`  Modified: ${new Date(note.modified).toLocaleString()}`));
  console.log(chalk.gray(`  Length:   ${note.content.length} characters`));
  console.log('');
}

/**
 * Main note command - shows subcommand menu or lists notes
 */
export async function noteCommand(subcommand?: string, arg?: string): Promise<void> {
  switch (subcommand) {
    case 'add':
    case 'new':
    case 'create':
      await noteAddCommand();
      break;
    case 'view':
    case 'show':
    case 'get':
      await noteViewCommand(arg);
      break;
    case 'edit':
      await noteEditCommand(arg);
      break;
    case 'list':
    case 'ls':
      await noteListCommand();
      break;
    default:
      // If no subcommand, show the list
      await noteListCommand();
  }
}
