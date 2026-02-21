import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  generatePassword,
  generatePassphrase,
  analyzePassword,
  PASSWORD_PRESETS,
} from '../crypto/index.js';

/**
 * Prompt for master password (hidden input)
 * @param message - The prompt message
 * @param requireMinLength - Whether to enforce minimum length (for new passwords only)
 */
export async function promptPassword(message: string = 'Master Password', requireMinLength: boolean = false): Promise<string> {
  const { password } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: chalk.cyan(message + ':'),
      mask: '*',
      validate: (input: string) => {
        if (input.length === 0) {
          return 'Password is required';
        }
        if (requireMinLength && input.length < 8) {
          return 'Password must be at least 8 characters';
        }
        return true;
      },
    },
  ]);
  return password;
}

/**
 * Prompt for password confirmation
 */
export async function promptPasswordConfirm(): Promise<string> {
  const { password, confirm } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: chalk.cyan('Master Password:'),
      mask: '*',
      validate: (input: string) => {
        if (input.length < 8) {
          return 'Password must be at least 8 characters';
        }
        return true;
      },
    },
    {
      type: 'password',
      name: 'confirm',
      message: chalk.cyan('Confirm Password:'),
      mask: '*',
    },
  ]);

  if (password !== confirm) {
    throw new Error('Passwords do not match');
  }

  return password;
}

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
 * Prompt for password with generation option
 */
async function promptPasswordWithGeneration(): Promise<string | undefined> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.cyan('Password:'),
      choices: [
        { name: '🔐 Generate strong password (recommended)', value: 'strong' },
        { name: '📝 Generate memorable passphrase', value: 'passphrase' },
        { name: '⚡ Generate standard password', value: 'standard' },
        { name: '✏️  Enter manually', value: 'manual' },
        { name: '⏭️  Skip (no password)', value: 'skip' },
      ],
    },
  ]);

  if (action === 'skip') {
    return undefined;
  }

  if (action === 'manual') {
    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: chalk.cyan('Enter password:'),
        mask: '*',
      },
    ]);
    return password || undefined;
  }

  // Generate password based on selection
  let password: string;
  if (action === 'passphrase') {
    password = generatePassphrase(5);
  } else if (action === 'standard') {
    password = generatePassword(PASSWORD_PRESETS.standard);
  } else {
    password = generatePassword(PASSWORD_PRESETS.strong);
  }

  const analysis = analyzePassword(password);
  const strengthColor = getStrengthColor(analysis.strength);

  console.log('');
  console.log(`  ${chalk.bold('Generated:')} ${chalk.white(password)}`);
  console.log(`  ${chalk.bold('Strength:')}  ${strengthColor(analysis.strength.toUpperCase())} (${analysis.entropy.toFixed(0)} bits entropy)`);
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
    return promptPasswordWithGeneration();
  } else {
    const { manualPassword } = await inquirer.prompt([
      {
        type: 'password',
        name: 'manualPassword',
        message: chalk.cyan('Enter password:'),
        mask: '*',
      },
    ]);
    return manualPassword || undefined;
  }
}

/**
 * Prompt for entry details
 */
export async function promptEntryDetails(): Promise<{
  title: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  category?: string;
}> {
  // Get basic info first
  const basicInfo = await inquirer.prompt([
    {
      type: 'input',
      name: 'title',
      message: chalk.cyan('Title:'),
      validate: (input: string) => input.length > 0 || 'Title is required',
    },
    {
      type: 'input',
      name: 'username',
      message: chalk.cyan('Username (optional):'),
    },
  ]);

  // Password with generation option
  const password = await promptPasswordWithGeneration();

  // Additional info including category
  const additionalInfo = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: chalk.cyan('URL (optional):'),
    },
    {
      type: 'input',
      name: 'category',
      message: chalk.cyan('Category (optional, e.g. Banking, Social, Work):'),
    },
    {
      type: 'editor',
      name: 'notes',
      message: chalk.cyan('Notes (optional, opens editor):'),
    },
  ]);

  return {
    title: basicInfo.title,
    username: basicInfo.username || undefined,
    password: password,
    url: additionalInfo.url || undefined,
    category: additionalInfo.category || undefined,
    notes: additionalInfo.notes?.trim() || undefined,
  };
}

/**
 * Prompt for confirmation
 */
export async function promptConfirm(message: string): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: chalk.yellow(message),
      default: false,
    },
  ]);
  return confirmed;
}

/**
 * Prompt for search term
 */
export async function promptSearch(): Promise<string> {
  const { query } = await inquirer.prompt([
    {
      type: 'input',
      name: 'query',
      message: chalk.cyan('Search:'),
    },
  ]);
  return query;
}

/**
 * Select from a list of entries
 */
export async function promptSelectEntry(
  entries: Array<{ id: string; title: string; modified: number }>
): Promise<string | null> {
  if (entries.length === 0) {
    return null;
  }

  const choices = entries.map(e => ({
    name: `${e.title} (modified: ${new Date(e.modified).toLocaleDateString()})`,
    value: e.id,
  }));

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: chalk.cyan('Select entry:'),
      choices,
    },
  ]);

  return selected;
}

/**
 * Prompt for carrier image paths
 */
export async function promptCarrierPaths(): Promise<string[]> {
  const { pathsInput } = await inquirer.prompt([
    {
      type: 'input',
      name: 'pathsInput',
      message: chalk.cyan('Carrier image paths (comma-separated):'),
      validate: (input: string) => input.length > 0 || 'At least one path is required',
    },
  ]);

  return pathsInput.split(',').map((p: string) => p.trim());
}
