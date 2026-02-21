import chalk from 'chalk';
import ora from 'ora';
import {
  vaultExists,
  unlock,
  listEntries,
  toggleFavorite,
  isUnlocked,
} from '../../storage/vault/index.js';
import { promptPassword, promptSelectEntry } from '../prompts.js';
import { initializeKeyManager } from '../../crypto/index.js';
import { isInDuressMode, getDecoyEntries } from '../duress.js';

/**
 * Favorite command handler - toggle favorite status of an entry
 */
export async function favoriteCommand(searchTerm?: string): Promise<void> {
  console.log(chalk.bold('\n  ⭐ Toggle Favorite\n'));

  // Duress mode - pretend to toggle favorite
  if (isInDuressMode()) {
    const decoyEntries = getDecoyEntries();
    const query = searchTerm?.toLowerCase() || '';

    let matches = query
      ? decoyEntries.filter(e => e.title.toLowerCase().includes(query))
      : decoyEntries;

    if (matches.length === 0) {
      console.log(chalk.yellow(`\n  No entries found${query ? ` matching "${searchTerm}"` : ''}.\n`));
      return;
    }

    const entry = matches[0]!;

    const spinner = ora('Updating...').start();
    await new Promise(resolve => setTimeout(resolve, 300));
    spinner.stop();

    // Randomly decide if adding or removing
    const adding = Math.random() > 0.5;
    if (adding) {
      console.log(chalk.green(`\n  ⭐ "${entry.title}" added to favorites!\n`));
    } else {
      console.log(chalk.gray(`\n  ✓ "${entry.title}" removed from favorites.\n`));
    }
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

  // Get all entries
  const spinner = ora('Loading entries...').start();
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

  if (entries.length === 0) {
    console.log(chalk.yellow('\n  No entries in vault.\n'));
    return;
  }

  // Filter entries if search term provided
  let filteredEntries = entries;
  if (searchTerm) {
    const searchLower = searchTerm.toLowerCase();
    filteredEntries = entries.filter(e =>
      e.title.toLowerCase().includes(searchLower)
    );

    if (filteredEntries.length === 0) {
      console.log(chalk.yellow(`\n  No entries found matching "${searchTerm}".\n`));
      return;
    }
  }

  // Format entries for selection with favorite indicator
  const formattedEntries = filteredEntries.map(e => ({
    id: e.id,
    title: `${e.favorite ? '⭐ ' : '   '}${e.title}`,
    modified: e.modified,
  }));

  // Select entry
  let selectedId: string | null;

  if (filteredEntries.length === 1) {
    selectedId = filteredEntries[0]!.id;
    console.log(chalk.gray(`\n  Selected: ${filteredEntries[0]!.title}\n`));
  } else {
    console.log(chalk.gray('\n  Select an entry to toggle favorite:\n'));
    selectedId = await promptSelectEntry(formattedEntries);
  }

  if (!selectedId) {
    return;
  }

  // Toggle favorite
  const toggleSpinner = ora('Updating...').start();

  try {
    const result = await toggleFavorite(selectedId);

    if (result) {
      toggleSpinner.stop();
      const entry = entries.find(e => e.id === selectedId);
      const title = entry?.title || 'Entry';

      if (result.favorite) {
        console.log(chalk.green(`\n  ⭐ "${title}" added to favorites!\n`));
      } else {
        console.log(chalk.gray(`\n  ✓ "${title}" removed from favorites.\n`));
      }
    } else {
      toggleSpinner.fail('Entry not found');
    }
  } catch (error) {
    toggleSpinner.fail('Failed to update favorite status');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}

/**
 * List only favorite entries
 */
export async function listFavoritesCommand(): Promise<void> {
  console.log(chalk.bold('\n  ⭐ Favorite Entries\n'));

  // Duress mode - show decoy favorites
  if (isInDuressMode()) {
    const decoyEntries = getDecoyEntries();
    // Show first entry as a favorite
    if (decoyEntries.length > 0) {
      const entry = decoyEntries[0]!;
      console.log(chalk.gray(`  Found 1 favorite:\n`));
      const date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toLocaleDateString();
      console.log(`  🔐 ⭐ ${chalk.white(entry.title)} ${chalk.gray(`(${date})`)}`);
      console.log('');
    } else {
      console.log(chalk.yellow('  No favorite entries yet.'));
      console.log(chalk.gray('  Use "BLANK favorite" to star entries.\n'));
    }
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

  // Get all entries
  const spinner = ora('Loading entries...').start();

  try {
    const entries = await listEntries();
    spinner.stop();

    // Filter to favorites only
    const favorites = entries.filter(e => e.favorite);

    if (favorites.length === 0) {
      console.log(chalk.yellow('  No favorite entries yet.'));
      console.log(chalk.gray('  Use "BLANK favorite" to star entries.\n'));
      return;
    }

    console.log(chalk.gray(`  Found ${favorites.length} favorite${favorites.length > 1 ? 's' : ''}:\n`));

    for (const entry of favorites) {
      const typeIcon = entry.entryType === 'file' ? '📁' : '🔐';
      const date = new Date(entry.modified).toLocaleDateString();
      console.log(`  ${typeIcon} ⭐ ${chalk.white(entry.title)} ${chalk.gray(`(${date})`)}`);
    }

    console.log('');
  } catch (error) {
    spinner.fail('Failed to load entries');
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}\n`));
    }
  }
}
