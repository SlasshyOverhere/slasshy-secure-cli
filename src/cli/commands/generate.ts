import chalk from 'chalk';
import inquirer from 'inquirer';
import clipboardy from 'clipboardy';
import {
  generatePassword,
  generatePassphrase,
  analyzePassword,
  PASSWORD_PRESETS,
  type PasswordOptions,
} from '../../crypto/index.js';

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
 * Get strength bar visualization
 */
function getStrengthBar(score: number): string {
  const filled = Math.round(score / 5); // 20 blocks max
  const empty = 20 - filled;

  let color: (text: string) => string;
  if (score >= 80) color = chalk.green;
  else if (score >= 65) color = chalk.cyan;
  else if (score >= 50) color = chalk.blue;
  else if (score >= 35) color = chalk.yellow;
  else color = chalk.red;

  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

/**
 * Display password with analysis
 */
function displayPassword(password: string, copy: boolean = false): void {
  const analysis = analyzePassword(password);
  const strengthColor = getStrengthColor(analysis.strength);

  console.log('');
  console.log(chalk.bold('  Generated Password:'));
  console.log('');
  console.log(`  ${chalk.white.bgGray(` ${password} `)}`);
  console.log('');
  console.log(`  Strength:  ${getStrengthBar(analysis.score)} ${strengthColor(analysis.strength.toUpperCase())} (${analysis.score}/100)`);
  console.log(`  Entropy:   ${chalk.cyan(analysis.entropy.toFixed(1) + ' bits')}`);
  console.log(`  Length:    ${chalk.cyan(password.length + ' characters')}`);

  if (analysis.feedback.length > 0 && analysis.strength !== 'excellent' && analysis.strength !== 'strong') {
    console.log('');
    console.log(chalk.gray('  Suggestions:'));
    analysis.feedback.forEach(tip => {
      console.log(chalk.gray(`    • ${tip}`));
    });
  }

  if (copy) {
    try {
      clipboardy.writeSync(password);
      console.log('');
      console.log(chalk.green('  ✓ Password copied to clipboard'));
    } catch (error) {
      console.log('');
      console.log(chalk.yellow('  ⚠ Could not copy to clipboard'));
    }
  }

  console.log('');
}

/**
 * Interactive password generation
 */
async function interactiveGenerate(): Promise<void> {
  const { mode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: chalk.cyan('Generation mode:'),
      choices: [
        { name: '🔐 Password (random characters)', value: 'password' },
        { name: '📝 Passphrase (memorable words)', value: 'passphrase' },
        { name: '⚡ Quick (use preset)', value: 'preset' },
      ],
    },
  ]);

  let password: string;

  if (mode === 'passphrase') {
    const { wordCount, separator } = await inquirer.prompt([
      {
        type: 'number',
        name: 'wordCount',
        message: chalk.cyan('Number of words (3-12):'),
        default: 5,
        validate: (input: number) => {
          if (input < 3) return 'Minimum 3 words';
          if (input > 12) return 'Maximum 12 words';
          return true;
        },
      },
      {
        type: 'list',
        name: 'separator',
        message: chalk.cyan('Word separator:'),
        choices: [
          { name: 'Hyphen (-)', value: '-' },
          { name: 'Underscore (_)', value: '_' },
          { name: 'Period (.)', value: '.' },
          { name: 'None', value: '' },
        ],
      },
    ]);

    password = generatePassphrase(wordCount, separator);

  } else if (mode === 'preset') {
    const { preset, copy } = await inquirer.prompt([
      {
        type: 'list',
        name: 'preset',
        message: chalk.cyan('Select preset:'),
        choices: [
          { name: `Strong (24 chars, all types)`, value: 'strong' },
          { name: `Standard (16 chars, all types)`, value: 'standard' },
          { name: `Alphanumeric (16 chars, no symbols)`, value: 'alphanumeric' },
          { name: `Memorable (12 chars, easy to type)`, value: 'memorable' },
          { name: `PIN (6 digits)`, value: 'pin' },
        ],
      },
      {
        type: 'confirm',
        name: 'copy',
        message: chalk.cyan('Copy to clipboard?'),
        default: true,
      },
    ]);

    password = generatePassword(PASSWORD_PRESETS[preset as keyof typeof PASSWORD_PRESETS]);
    displayPassword(password, copy);
    return;

  } else {
    // Custom password options
    const options = await inquirer.prompt([
      {
        type: 'number',
        name: 'length',
        message: chalk.cyan('Password length (4-256):'),
        default: 20,
        validate: (input: number) => {
          if (input < 4) return 'Minimum length is 4';
          if (input > 256) return 'Maximum length is 256';
          return true;
        },
      },
      {
        type: 'checkbox',
        name: 'charTypes',
        message: chalk.cyan('Character types:'),
        choices: [
          { name: 'Uppercase (A-Z)', value: 'uppercase', checked: true },
          { name: 'Lowercase (a-z)', value: 'lowercase', checked: true },
          { name: 'Numbers (0-9)', value: 'numbers', checked: true },
          { name: 'Symbols (!@#$...)', value: 'symbols', checked: true },
        ],
        validate: (input: string[]) => {
          if (input.length === 0) return 'Select at least one character type';
          return true;
        },
      },
      {
        type: 'confirm',
        name: 'excludeAmbiguous',
        message: chalk.cyan('Exclude ambiguous characters (0, O, l, 1, I)?'),
        default: true,
      },
    ]);

    const passwordOptions: Partial<PasswordOptions> = {
      length: options.length,
      uppercase: options.charTypes.includes('uppercase'),
      lowercase: options.charTypes.includes('lowercase'),
      numbers: options.charTypes.includes('numbers'),
      symbols: options.charTypes.includes('symbols'),
      excludeAmbiguous: options.excludeAmbiguous,
    };

    password = generatePassword(passwordOptions);
  }

  const { copy, regenerate } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'copy',
      message: chalk.cyan('Copy to clipboard?'),
      default: true,
    },
    {
      type: 'confirm',
      name: 'regenerate',
      message: chalk.cyan('Generate another with same settings?'),
      default: false,
      when: () => mode !== 'preset',
    },
  ]);

  displayPassword(password, copy);

  // Allow regeneration loop
  if (regenerate) {
    await interactiveGenerate();
  }
}

/**
 * Generate command handler
 */
export async function generateCommand(options: {
  length?: number;
  preset?: string;
  passphrase?: boolean;
  words?: number;
  copy?: boolean;
  noSymbols?: boolean;
}): Promise<void> {
  console.log(chalk.bold('\n  🔐 Password Generator\n'));

  try {
    // If no options provided, run interactive mode
    if (!options.length && !options.preset && !options.passphrase) {
      await interactiveGenerate();
      return;
    }

    let password: string;

    // Passphrase mode
    if (options.passphrase) {
      const wordCount = options.words || 5;
      password = generatePassphrase(wordCount);

    // Preset mode
    } else if (options.preset && options.preset in PASSWORD_PRESETS) {
      password = generatePassword(PASSWORD_PRESETS[options.preset as keyof typeof PASSWORD_PRESETS]);

    // Custom options
    } else {
      password = generatePassword({
        length: options.length || 20,
        symbols: !options.noSymbols,
      });
    }

    displayPassword(password, options.copy ?? false);

  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`  Error: ${error.message}\n`));
    }
  }
}

/**
 * Quick generate (for integration with add command)
 * Returns the generated password string
 */
export async function quickGenerate(): Promise<string | null> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.cyan('Password:'),
      choices: [
        { name: '🔐 Generate strong password', value: 'generate' },
        { name: '📝 Generate passphrase', value: 'passphrase' },
        { name: '✏️  Enter manually', value: 'manual' },
      ],
    },
  ]);

  if (action === 'manual') {
    return null; // Signal to use manual input
  }

  let password: string;

  if (action === 'passphrase') {
    password = generatePassphrase(5);
  } else {
    password = generatePassword(PASSWORD_PRESETS.strong);
  }

  const analysis = analyzePassword(password);
  const strengthColor = getStrengthColor(analysis.strength);

  console.log('');
  console.log(`  Generated: ${chalk.white(password)}`);
  console.log(`  Strength:  ${strengthColor(analysis.strength.toUpperCase())} (${analysis.entropy.toFixed(0)} bits)`);
  console.log('');

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.cyan('Use this password?'),
      default: true,
    },
  ]);

  if (confirm) {
    return password;
  }

  // Regenerate if not confirmed
  return quickGenerate();
}
