import chalk from 'chalk';
import readline from 'readline';
import inquirer from 'inquirer';
import ora from 'ora';
import { createRequire } from 'module';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  initCommand,
  addCommand,
  getCommand,
  listCommand,
  deleteCommand,
  editCommand,
  favoriteCommand,
  listFavoritesCommand,
  noteCommand,
  auditCommand,
  statusCommand,
  lockCommand,
  authCommand,
  uploadCommand,
  downloadCommand,
  destructCommand,
  generateCommand,
  totpCommand,
  syncCommand,
  settingsCommand,
  webCommand,
  desktopCommand,
  updateCommand,
} from './commands/index.js';
import { resetAutoLockTimer, startAutoLockTimer, stopAutoLockTimer, setAutoLockTimeout, getAutoLockSettings } from './autoLock.js';
import { setTheme, getCurrentTheme, getAvailableThemes, showAllThemes, loadTheme, type ThemeName } from './themes.js';
import { displayAuditLog } from './auditLog.js';
import { isDuressConfigured, interactiveSetupDuress, disableDuressPassword, isInDuressMode } from './duress.js';
import { getIndexKey } from '../crypto/index.js';
import { isUnlocked as checkVaultUnlocked, getEntry, listEntries, type Entry } from '../storage/vault/index.js';
import { checkPasswordBreach, displayBreachResult, getBreachDisplay, formatBreachCount, type BreachCheckResult } from './breachCheck.js';
import { interactiveSetup2FA, showVault2FAHelp } from './vault2fa.js';
import { isVault2FAEnabled, getVault2FAConfig, setVault2FAConfig, type Vault2FAConfig } from '../storage/vault/index.js';
import { promptPassword } from './prompts.js';

// Get version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
const VERSION = pkg.version;

const SHELL_PROMPT = chalk.cyan('BLANK') + chalk.gray('> ');

// Command history settings
const HISTORY_FILE = path.join(os.homedir(), '.slasshy', 'history');
const MAX_HISTORY = 100;
let commandHistory: string[] = [];

/**
 * Load command history from file
 */
async function loadHistory(): Promise<void> {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    commandHistory = data.split('\n').filter(line => line.trim());
    // Limit to max history size
    if (commandHistory.length > MAX_HISTORY) {
      commandHistory = commandHistory.slice(-MAX_HISTORY);
    }
  } catch {
    // History file doesn't exist yet, that's fine
    commandHistory = [];
  }
}

/**
 * Save command history to file
 */
async function saveHistory(): Promise<void> {
  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    // Keep only last MAX_HISTORY commands
    const historyToSave = commandHistory.slice(-MAX_HISTORY);
    await fs.writeFile(HISTORY_FILE, historyToSave.join('\n'), 'utf-8');
  } catch {
    // Silently fail - history is not critical
  }
}

/**
 * Add command to history (avoid duplicates of last command)
 */
function addToHistory(command: string): void {
  const trimmed = command.trim();
  if (trimmed && trimmed !== commandHistory[commandHistory.length - 1]) {
    commandHistory.push(trimmed);
    // Trim if over max
    if (commandHistory.length > MAX_HISTORY) {
      commandHistory = commandHistory.slice(-MAX_HISTORY);
    }
  }
}

/**
 * Show command history
 */
function showHistory(count?: number): void {
  const displayCount = count || 20;
  const history = commandHistory.slice(-displayCount);

  if (history.length === 0) {
    console.log(chalk.yellow('\n  No command history yet.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Command History (last ${history.length}):\n`));

  const startNum = commandHistory.length - history.length + 1;
  history.forEach((cmd, idx) => {
    const num = (startNum + idx).toString().padStart(4, ' ');
    console.log(`  ${chalk.gray(num)}  ${chalk.white(cmd)}`);
  });

  console.log(chalk.gray('\n  Use ↑/↓ arrows to navigate history.\n'));
}

// All available commands for tab completion
const COMMANDS = [
  'init', 'init --restore', 'init --drive',
  'add',
  'generate', 'gen',
  'list', 'ls',
  'get',
  'edit',
  'favorite', 'fav',
  'favorites', 'favs',
  'note', 'note add', 'note view', 'note edit', 'note list',
  'totp', 'totp add', 'totp view', 'totp remove', 'totp list', '2fa', 'otp',
  '2fa-setup', 'vault-2fa',
  'audit', 'audit --all',
  'delete', 'rm',
  'upload', 'up',
  'download', 'dl',
  'status',
  'autolock',
  'theme', 'theme default', 'theme ocean', 'theme forest', 'theme sunset', 'theme mono', 'theme hacker',
  'history', 'hist',
  'auditlog', 'log',
  'duress', 'panic',
  'breach', 'breach --all', 'pwned', 'hibp',
  'sync', 'sync --status', 'sync --conflicts', 'sync --force',
  'settings', 'settings --storage hidden', 'settings --storage public', 'settings --folder vault-data', 'settings --storage public --folder vault-data',
  'web', 'web --open', 'web --port 4310', 'ui', 'ui --open',
  'desktop', 'desktop --release v0.0.3', 'desktop --install',
  'update', 'update --check', 'update --install', 'update --scheduled',
  'auth', 'auth --setup', 'auth --logout',
  'lock',
  'destruct',
  'version',
  'help', 'help --list',
  'exit', 'quit', 'q',
  'clear', 'cls',
];

type HelpCategory = 'Vault' | 'Entries' | 'Security' | 'Cloud & Preferences' | 'System';

interface HelpEntry {
  id: string;
  usage: string;
  run: string;
  description: string;
  category: HelpCategory;
  aliases?: string;
  runnable?: boolean;
  danger?: boolean;
  common?: boolean;
}

const HELP_ENTRIES: HelpEntry[] = [
  { id: 'init', usage: 'init [--drive|--restore]', run: 'init', description: 'Create or restore vault', category: 'Vault', common: true },
  { id: 'lock', usage: 'lock', run: 'lock', description: 'Lock vault and clear keys', category: 'Vault' },
  { id: 'status', usage: 'status', run: 'status', description: 'Show vault + sync status', category: 'Vault', common: true },
  { id: 'web', usage: 'web|ui [--open --port <n>]', run: 'web --open', description: 'Launch local web UI', category: 'Vault', common: true },
  { id: 'desktop', usage: 'desktop [--release <tag>] [--install]', run: 'desktop', description: 'Download desktop installer', category: 'System' },
  { id: 'update', usage: 'update [--check|--install|--scheduled]', run: 'update --check', description: 'Check/install CLI npm updates', category: 'System', common: true },
  { id: 'add', usage: 'add', run: 'add', description: 'Add password entry', category: 'Entries', common: true },
  { id: 'list', usage: 'list|ls [-f -t -c]', run: 'list', description: 'List entries with filters', category: 'Entries', common: true },
  { id: 'get', usage: 'get <search> [-c -s]', run: 'get', description: 'View/retrieve an entry', category: 'Entries', common: true },
  { id: 'edit', usage: 'edit [search]', run: 'edit', description: 'Edit an entry', category: 'Entries' },
  { id: 'delete', usage: 'delete|rm [search] [-f]', run: 'delete', description: 'Delete an entry', category: 'Entries' },
  { id: 'favorite', usage: 'favorite|fav [search]', run: 'favorite', description: 'Toggle favorite', category: 'Entries' },
  { id: 'favorites', usage: 'favorites|favs', run: 'favorites', description: 'List favorites', category: 'Entries' },
  { id: 'note', usage: 'note <add|view|edit|list> [arg]', run: 'note', description: 'Secure notes workflow', category: 'Entries' },
  { id: 'upload', usage: 'upload|up [file]', run: 'upload', description: 'Encrypt and upload file', category: 'Entries', common: true },
  { id: 'download', usage: 'download|dl [search]', run: 'download', description: 'Download file', category: 'Entries', common: true },
  { id: 'generate', usage: 'generate|gen [options]', run: 'generate', description: 'Password/passphrase generator', category: 'Entries' },
  { id: 'totp', usage: 'totp|otp <add|view|remove|list> [arg] [-c]', run: 'totp', description: 'Website 2FA/TOTP secrets', category: 'Security' },
  { id: 'vault2fa', usage: '2fa-setup|vault-2fa|2fa', run: '2fa-setup', description: 'Protect vault with TOTP', category: 'Security' },
  { id: 'breach', usage: 'breach|pwned|hibp [entry|--all]', run: 'breach --all', description: 'Check against HIBP breaches', category: 'Security' },
  { id: 'audit', usage: 'audit [--all]', run: 'audit', description: 'Password strength + expiry audit', category: 'Security' },
  { id: 'auditlog', usage: 'auditlog|log [n]', run: 'auditlog', description: 'Security event log', category: 'Security' },
  { id: 'duress', usage: 'duress|panic', run: 'duress', description: 'Decoy vault/duress mode', category: 'Security' },
  { id: 'auth', usage: 'auth [--setup|-l]', run: 'auth', description: 'Google Drive auth/connect', category: 'Cloud & Preferences', common: true },
  { id: 'sync', usage: 'sync [--status|--conflicts|--force]', run: 'sync --status', description: 'Cloud sync operations', category: 'Cloud & Preferences', common: true },
  { id: 'settings', usage: 'settings [--storage ...] [--folder ...]', run: 'settings', description: 'Storage mode and folder config', category: 'Cloud & Preferences' },
  { id: 'autolock', usage: 'autolock [minutes]', run: 'autolock', description: 'Auto-lock timeout', category: 'Cloud & Preferences' },
  { id: 'theme', usage: 'theme [name]', run: 'theme', description: 'Switch shell theme', category: 'Cloud & Preferences' },
  { id: 'history', usage: 'history|hist [n]', run: 'history', description: 'Command history', category: 'Cloud & Preferences' },
  { id: 'help', usage: 'help [--list]', run: 'help --list', description: 'Help output (plain/list)', category: 'System', runnable: true },
  { id: 'version', usage: 'version', run: 'version', description: 'Show app version', category: 'System' },
  { id: 'clear', usage: 'clear|cls', run: 'clear', description: 'Clear terminal', category: 'System' },
  { id: 'exit', usage: 'exit|quit|q', run: 'exit', description: 'Exit shell', category: 'System', runnable: false },
  { id: 'destruct', usage: 'destruct', run: 'destruct', description: 'Destroy vault permanently', category: 'System', danger: true, runnable: false },
];

/**
 * Tab completion function for readline
 */
function completer(line: string): [string[], string] {
  const lineLower = line.toLowerCase();

  // Find matching commands
  const hits = COMMANDS.filter(cmd => cmd.startsWith(lineLower));

  // If no matches, return empty
  if (hits.length === 0) {
    return [[], line];
  }

  // If exact match, add space for next argument
  if (hits.length === 1 && hits[0] === lineLower) {
    return [[hits[0] + ' '], line];
  }

  return [hits, line];
}

/**
 * Parse command string into command and arguments
 */
function parseCommand(input: string): { cmd: string; args: string[] } {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || '';
  const args = parts.slice(1);
  return { cmd, args };
}

/**
 * Show available commands
 */
function showHelpList(): void {
  console.log(chalk.bold('\n  BLANK Shell Help\n'));
  console.log(chalk.gray('  Tip: run "help" for interactive command picker, or "help --list" for this view.\n'));
  console.log(chalk.bgCyan.black(' FEATURED ') + chalk.white(' Desktop app is live: ') + chalk.cyan('desktop --install'));
  console.log(chalk.gray('  Download only: ') + chalk.cyan('desktop') + chalk.gray(' | Check updates: ') + chalk.cyan('update --check'));

  console.log(chalk.cyan('  Vault'));
  console.log(chalk.white('    init [--drive|--restore], lock, status, version'));
  console.log(chalk.white('    web|ui [--open --port <n>], help, clear|cls, exit|quit|q'));

  console.log(chalk.cyan('\n  Entries'));
  console.log(chalk.white('    add, list|ls [-f -t -c], get <search> [-c -s], edit [search], delete|rm [search] [-f]'));
  console.log(chalk.white('    favorite|fav [search], favorites|favs'));
  console.log(chalk.white('    note <add|view|edit|list> [arg], upload|up [file], download|dl [search], generate|gen [options]'));

  console.log(chalk.cyan('\n  Security'));
  console.log(chalk.white('    totp|otp <add|view|remove|list> [arg] [-c], 2fa-setup|vault-2fa|2fa'));
  console.log(chalk.white('    breach|pwned|hibp [entry|--all], audit [--all], auditlog|log [n], duress|panic'));

  console.log(chalk.cyan('\n  Cloud & Preferences'));
  console.log(chalk.white('    auth [--setup|-l], sync [--status|--conflicts|--force]'));
  console.log(chalk.white('    settings [--storage hidden|public] [--folder <name>], autolock [minutes], theme [name], history|hist [n]'));

  console.log(chalk.cyan('\n  System'));
  console.log(chalk.white('    desktop [--release <tag>] [--install], update [--check|--install|--scheduled]'));
  console.log(chalk.white('    help [--list], version, clear|cls, exit|quit|q'));

  console.log(chalk.red('\n  Danger'));
  console.log(chalk.red('    destruct') + chalk.gray('  (permanently destroy vault)'));
  console.log('');
}

async function showInteractiveHelp(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    showHelpList();
    return;
  }

  const categoryOrder: Array<'common' | HelpCategory | 'all'> = [
    'common',
    'Vault',
    'Entries',
    'Security',
    'Cloud & Preferences',
    'System',
    'all',
  ];

  const categoryLabel = (value: 'common' | HelpCategory | 'all'): string => {
    if (value === 'common') return 'Common Commands';
    if (value === 'all') return 'All Commands';
    return value;
  };

  console.log(chalk.bold('\n  Interactive Help\n'));

  while (true) {
    const { category } = await inquirer.prompt<{ category: 'common' | HelpCategory | 'all' | 'exit' }>([
      {
        type: 'list',
        name: 'category',
        message: 'Choose a command group:',
        pageSize: 10,
        choices: [
          ...categoryOrder.map((value) => ({
            name: categoryLabel(value),
            value,
          })),
          { name: 'Exit Help', value: 'exit' },
        ],
      },
    ]);

    if (category === 'exit') {
      console.log('');
      return;
    }

    const scopedEntries = HELP_ENTRIES.filter((entry) => {
      if (category === 'all') return true;
      if (category === 'common') return entry.common === true;
      return entry.category === category;
    });

    const commandChoices: Array<{ name: string; value: string } | inquirer.Separator> = [];
    scopedEntries.forEach((entry, index) => {
      const marker = entry.danger ? chalk.red('⚠ ') : '';
      commandChoices.push({
        name: `${marker}${chalk.white(entry.usage)} ${chalk.gray('- ' + entry.description)}`,
        value: entry.id,
      });
      if (index < scopedEntries.length - 1) {
        commandChoices.push(new inquirer.Separator(' '));
      }
    });

    const { selected } = await inquirer.prompt<{ selected: string }>([
      {
        type: 'list',
        name: 'selected',
        message: `Commands in ${categoryLabel(category)}:`,
        pageSize: 15,
        choices: [
          ...commandChoices,
          new inquirer.Separator(' '),
          { name: 'Back', value: '__back' },
        ],
      },
    ]);

    if (selected === '__back') {
      continue;
    }

    const entry = HELP_ENTRIES.find((item) => item.id === selected);
    if (!entry) {
      continue;
    }

    console.log('');
    console.log(chalk.bold(`  ${entry.usage}`));
    console.log(chalk.gray(`  ${entry.description}`));
    if (entry.aliases) {
      console.log(chalk.gray(`  Aliases: ${entry.aliases}`));
    }
    console.log(chalk.gray(`  Runs: BLANK ${entry.run}`));
    console.log('');

    const choices: Array<{ name: string; value: 'run' | 'back' | 'list' }> = [
      { name: 'Back to picker', value: 'back' },
      { name: 'Show text help list', value: 'list' },
    ];
    if (entry.runnable !== false) {
      choices.unshift({ name: 'Run this command now', value: 'run' });
    }

    const { action } = await inquirer.prompt<{ action: 'run' | 'back' | 'list' }>([
      {
        type: 'list',
        name: 'action',
        message: 'Next action:',
        choices,
      },
    ]);

    if (action === 'list') {
      showHelpList();
      continue;
    }

    if (action === 'run') {
      const { cmd, args } = parseCommand(entry.run);
      await executeCommand(cmd, args);
      console.log('');
    }
  }
}

/**
 * Execute a command
 */
async function executeCommand(cmd: string, args: string[]): Promise<boolean> {
  try {
    switch (cmd) {
      case 'init':
        const initOptions: { drive?: boolean; restore?: boolean } = {};
        if (args.includes('--restore') || args.includes('-r')) initOptions.restore = true;
        if (args.includes('--drive') || args.includes('-d')) initOptions.drive = true;
        await initCommand(initOptions);
        break;

      case 'add':
        await addCommand();
        break;

      case 'generate':
      case 'gen':
        const genOptions: {
          length?: number;
          preset?: string;
          passphrase?: boolean;
          words?: number;
          copy?: boolean;
          noSymbols?: boolean;
        } = {};
        // Parse generate command options
        if (args.includes('--passphrase') || args.includes('-p')) genOptions.passphrase = true;
        if (args.includes('-c') || args.includes('--copy')) genOptions.copy = true;
        if (args.includes('--no-symbols')) genOptions.noSymbols = true;
        const lengthIdx = args.indexOf('-l');
        if (lengthIdx !== -1 && args[lengthIdx + 1]) {
          genOptions.length = parseInt(args[lengthIdx + 1]!, 10);
        }
        const wordsIdx = args.indexOf('-w');
        if (wordsIdx !== -1 && args[wordsIdx + 1]) {
          genOptions.words = parseInt(args[wordsIdx + 1]!, 10);
        }
        const presetIdx = args.indexOf('--preset');
        if (presetIdx !== -1 && args[presetIdx + 1]) {
          genOptions.preset = args[presetIdx + 1];
        }
        await generateCommand(genOptions);
        break;

      case 'list':
      case 'ls':
        const listOptions: { filter?: string; type?: string; category?: string } = {};
        const filterIdx = args.indexOf('-f');
        if (filterIdx !== -1 && args[filterIdx + 1]) {
          listOptions.filter = args[filterIdx + 1];
        }
        const typeIdx = args.indexOf('-t');
        if (typeIdx !== -1 && args[typeIdx + 1]) {
          listOptions.type = args[typeIdx + 1];
        }
        const catIdx = args.indexOf('-c');
        if (catIdx !== -1 && args[catIdx + 1]) {
          listOptions.category = args[catIdx + 1];
        }
        await listCommand(listOptions);
        break;

      case 'get':
        const getOptions: { copy?: boolean; showPassword?: boolean } = {};
        if (args.includes('-c') || args.includes('--copy')) getOptions.copy = true;
        if (args.includes('-s') || args.includes('--show-password')) getOptions.showPassword = true;
        const getSearch = args.filter(a => !a.startsWith('-'))[0];
        await getCommand(getSearch, getOptions);
        break;

      case 'edit':
        const editSearch = args.filter(a => !a.startsWith('-'))[0];
        await editCommand(editSearch);
        break;

      case 'favorite':
      case 'fav':
        const favSearch = args.filter(a => !a.startsWith('-'))[0];
        await favoriteCommand(favSearch);
        break;

      case 'favorites':
      case 'favs':
        await listFavoritesCommand();
        break;

      case 'note':
      case 'notes':
        const noteSubcmd = args[0];
        const noteArg = args.slice(1).join(' ') || undefined;
        await noteCommand(noteSubcmd, noteArg);
        break;

      case 'totp':
      case 'otp':
        const totpSubcmd = args[0];
        const totpArg = args.slice(1).join(' ') || undefined;
        const totpOptions: { copy?: boolean } = {};
        if (args.includes('-c') || args.includes('--copy')) totpOptions.copy = true;
        await totpCommand(totpSubcmd, totpArg, totpOptions);
        break;

      case '2fa-setup':
      case 'vault-2fa':
      case '2fa':
        // Handle 2fa without subcommand as vault 2FA setup
        if (cmd === '2fa' && args.length > 0) {
          // If 2fa has args, treat as totp command
          const totpSubcmd2 = args[0];
          const totpArg2 = args.slice(1).join(' ') || undefined;
          const totpOptions2: { copy?: boolean } = {};
          if (args.includes('-c') || args.includes('--copy')) totpOptions2.copy = true;
          await totpCommand(totpSubcmd2, totpArg2, totpOptions2);
          break;
        }

        // Vault 2FA setup
        if (!checkVaultUnlocked()) {
          console.log(chalk.red('\n  Vault must be unlocked to configure 2FA protection.\n'));
          break;
        }

        if (isInDuressMode()) {
          console.log(chalk.yellow('\n  Cannot configure vault 2FA in duress mode.\n'));
          break;
        }

        if (args.includes('--help') || args.includes('-h')) {
          showVault2FAHelp();
          break;
        }

        // Run interactive 2FA setup
        const currentConfig = getVault2FAConfig();
        await interactiveSetup2FA(currentConfig, async (config: Vault2FAConfig | undefined) => {
          await setVault2FAConfig(config);
        });
        break;

      case 'breach':
      case 'pwned':
      case 'hibp':
        if (!checkVaultUnlocked()) {
          console.log(chalk.red('\n  Vault must be unlocked to check breaches.\n'));
          break;
        }

        const breachSearch = args.filter(a => !a.startsWith('-'))[0];
        const breachAll = args.includes('--all') || args.includes('-a');

        if (breachAll || !breachSearch) {
          // Check all passwords
          console.log(chalk.bold('\n  🔐 Breach Check - All Passwords\n'));
          console.log(chalk.gray('  Checking passwords against Have I Been Pwned database...\n'));

          const spinner = ora('Loading entries...').start();

          try {
            const allEntriesList = await listEntries();
            const passwordEntriesList = allEntriesList.filter(e =>
              e.entryType === 'password' || !e.entryType
            );

            const passwordsToCheck: Array<{ id: string; title: string; password: string }> = [];

            // Batch fetch entries to prevent N+1 sequential disk I/O bottlenecks
            const batchSize = 20;
            for (let i = 0; i < passwordEntriesList.length; i += batchSize) {
              const batch = passwordEntriesList.slice(i, i + batchSize);
              const batchEntries = await Promise.all(batch.map((e) => getEntry(e.id)));
              for (let j = 0; j < batch.length; j++) {
                const entry = batchEntries[j];
                const e = batch[j]!;
                if (entry?.password) {
                  passwordsToCheck.push({
                    id: e.id,
                    title: e.title,
                    password: entry.password,
                  });
                }
              }
            }

            if (passwordsToCheck.length === 0) {
              spinner.stop();
              console.log(chalk.yellow('  No passwords to check.\n'));
              break;
            }

            spinner.text = `Checking ${passwordsToCheck.length} passwords...`;

            const breachedEntries: Array<{ title: string; count: number }> = [];
            const safeEntries: string[] = [];
            const errorEntries: string[] = [];

            let checked = 0;
            for (const entry of passwordsToCheck) {
              const result = await checkPasswordBreach(entry.password);
              checked++;
              spinner.text = `Checking ${checked}/${passwordsToCheck.length} passwords...`;

              if (result.error) {
                errorEntries.push(entry.title);
              } else if (result.breached) {
                breachedEntries.push({ title: entry.title, count: result.count });
              } else {
                safeEntries.push(entry.title);
              }

              // Delay to avoid rate limiting
              if (!result.networkRequestSkipped && checked < passwordsToCheck.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            }

            spinner.stop();

            // Display results
            console.log(chalk.gray('  ' + '─'.repeat(60)));

            if (breachedEntries.length > 0) {
              console.log(chalk.red.bold(`\n  🚨 ${breachedEntries.length} PASSWORDS FOUND IN BREACHES:\n`));
              for (const { title, count } of breachedEntries) {
                const { icon, color } = getBreachDisplay(count);
                console.log(`  ${icon} ${chalk.white(title)} - ${color(formatBreachCount(count))}`);
              }
              console.log('');
            }

            console.log(chalk.green(`  ✓ ${safeEntries.length} passwords are safe`));
            if (errorEntries.length > 0) {
              console.log(chalk.yellow(`  ⚠ ${errorEntries.length} could not be checked`));
            }
            console.log('');

            if (breachedEntries.length > 0) {
              console.log(chalk.yellow('  ⚠ Change breached passwords immediately!'));
              console.log(chalk.gray('  Use "BLANK edit <entry>" to update.\n'));
            }
          } catch (error) {
            spinner.fail('Breach check failed');
            if (error instanceof Error) {
              console.log(chalk.red(`  ${error.message}\n`));
            }
          }
        } else {
          // Check specific entry
          const searchSpinner = ora('Searching...').start();

          try {
            const allEntriesList = await listEntries();
            const searchLower = breachSearch.toLowerCase();
            const matches = allEntriesList.filter(e =>
              e.title.toLowerCase().includes(searchLower) &&
              (e.entryType === 'password' || !e.entryType)
            );

            if (matches.length === 0) {
              searchSpinner.fail(`No entries matching "${breachSearch}"`);
              break;
            }

            const matchId = matches[0]!.id;
            const matchTitle = matches[0]!.title;
            const entry = await getEntry(matchId);

            if (!entry?.password) {
              searchSpinner.fail('Entry has no password');
              break;
            }

            searchSpinner.text = 'Checking breach database...';

            const result = await checkPasswordBreach(entry.password);

            searchSpinner.stop();
            displayBreachResult(result, matchTitle);
          } catch (error) {
            searchSpinner.fail('Breach check failed');
            if (error instanceof Error) {
              console.log(chalk.red(`  ${error.message}\n`));
            }
          }
        }
        break;

      case 'audit':
        const auditOptions: { all?: boolean } = {};
        if (args.includes('-a') || args.includes('--all')) auditOptions.all = true;
        await auditCommand(auditOptions);
        break;

      case 'delete':
      case 'del':
      case 'rm':
        const deleteOptions: { force?: boolean } = {};
        if (args.includes('-f') || args.includes('--force')) deleteOptions.force = true;
        const deleteSearch = args.filter(a => !a.startsWith('-'))[0];
        await deleteCommand(deleteSearch, deleteOptions);
        break;

      case 'upload':
      case 'up':
        const uploadFile = args.filter(a => !a.startsWith('-'))[0];
        await uploadCommand(uploadFile);
        break;

      case 'download':
      case 'dl':
        const downloadSearch = args.filter(a => !a.startsWith('-'))[0];
        await downloadCommand(downloadSearch);
        break;

      case 'status':
        await statusCommand();
        break;

      case 'autolock':
        const minutes = args[0] ? parseInt(args[0], 10) : undefined;
        if (minutes !== undefined) {
          if (isNaN(minutes) || minutes < 0) {
            console.log(chalk.red('\n  Invalid value. Use a number (0 to disable, or minutes).\n'));
          } else if (minutes === 0) {
            setAutoLockTimeout(0);
            console.log(chalk.yellow('\n  ⚠ Auto-lock disabled. Vault will stay unlocked.\n'));
          } else {
            setAutoLockTimeout(minutes);
            console.log(chalk.green(`\n  ✓ Auto-lock set to ${minutes} minute${minutes > 1 ? 's' : ''}.\n`));
          }
        } else {
          const settings = getAutoLockSettings();
          console.log(chalk.bold('\n  🔒 Auto-lock Settings\n'));
          console.log(`  Status:  ${settings.enabled ? chalk.green('Enabled') : chalk.yellow('Disabled')}`);
          if (settings.enabled) {
            console.log(`  Timeout: ${chalk.cyan(settings.timeoutMinutes + ' minutes')}`);
          }
          console.log(chalk.gray('\n  Usage: autolock <minutes> (0 to disable)\n'));
        }
        break;

      case 'theme':
        const themeName = args[0]?.toLowerCase();
        if (themeName) {
          const availableThemes = getAvailableThemes();
          if (availableThemes.includes(themeName as ThemeName)) {
            await setTheme(themeName as ThemeName);
            console.log(chalk.green(`\n  ✓ Theme changed to "${themeName}"\n`));
          } else {
            console.log(chalk.red(`\n  Unknown theme: ${themeName}`));
            console.log(chalk.gray(`  Available: ${availableThemes.join(', ')}\n`));
          }
        } else {
          showAllThemes();
        }
        break;

      case 'history':
      case 'hist':
        const histCount = args[0] ? parseInt(args[0], 10) : undefined;
        showHistory(histCount);
        break;

      case 'auditlog':
      case 'log':
        const logCount = args[0] ? parseInt(args[0], 10) : undefined;
        await displayAuditLog(logCount);
        break;

      case 'duress':
      case 'panic':
        if (!checkVaultUnlocked()) {
          console.log(chalk.red('\n  Vault must be unlocked to configure duress password.\n'));
          break;
        }

        if (isInDuressMode()) {
          console.log(chalk.yellow('\n  Cannot configure duress settings in duress mode.\n'));
          break;
        }

        const duressConfigured = await isDuressConfigured();
        if (duressConfigured) {
          const { action } = await inquirer.prompt<{ action: string }>([
            {
              type: 'list',
              name: 'action',
              message: chalk.cyan('Duress password is configured. What would you like to do?'),
              choices: [
                { name: 'View status', value: 'status' },
                { name: 'Reconfigure duress password', value: 'reconfigure' },
                { name: 'Disable duress password', value: 'disable' },
                { name: 'Cancel', value: 'cancel' },
              ],
            },
          ]);

          if (action === 'status') {
            console.log(chalk.green('\n  ✓ Duress password is active.'));
            console.log(chalk.gray('  If you enter the duress password instead of your master password,'));
            console.log(chalk.gray('  a decoy vault will be shown to protect your real data.\n'));
          } else if (action === 'reconfigure') {
            await interactiveSetupDuress(getIndexKey());
          } else if (action === 'disable') {
            await disableDuressPassword();
            console.log(chalk.yellow('\n  ⚠ Duress password disabled.\n'));
          }
        } else {
          await interactiveSetupDuress(getIndexKey());
        }
        break;

      case 'auth':
        const authOptions: { setup?: boolean; logout?: boolean } = {};
        if (args.includes('--setup')) authOptions.setup = true;
        if (args.includes('-l') || args.includes('--logout')) authOptions.logout = true;
        await authCommand(authOptions);
        break;

      case 'sync':
        const syncOptions: { force?: boolean; status?: boolean; conflicts?: boolean } = {};
        if (args.includes('--force') || args.includes('-f')) syncOptions.force = true;
        if (args.includes('--status') || args.includes('-s')) syncOptions.status = true;
        if (args.includes('--conflicts') || args.includes('-c')) syncOptions.conflicts = true;
        await syncCommand(syncOptions);
        break;

      case 'settings':
        const settingsOptions: { storage?: string; folder?: string } = {};
        const storageIdx = args.indexOf('--storage');
        if (storageIdx !== -1 && args[storageIdx + 1]) {
          settingsOptions.storage = args[storageIdx + 1];
        }
        const folderIdx = args.indexOf('--folder');
        if (folderIdx !== -1 && args[folderIdx + 1]) {
          settingsOptions.folder = args[folderIdx + 1];
        }
        await settingsCommand(settingsOptions);
        break;

      case 'web':
      case 'ui':
        const webOptions: { port?: string; open?: boolean } = {};
        const portIdx = args.findIndex((arg) => arg === '--port' || arg === '-p');
        if (portIdx !== -1 && args[portIdx + 1]) {
          webOptions.port = args[portIdx + 1];
        }
        if (args.includes('--open') || args.includes('-o')) {
          webOptions.open = true;
        }
        await webCommand(webOptions);
        break;

      case 'desktop':
        const desktopOptions: {
          release?: string;
          output?: string;
          asset?: string;
          force?: boolean;
          install?: boolean;
          nonInteractive?: boolean;
        } = {};
        const releaseIdx = args.findIndex((arg) =>
          arg === '--release' || arg === '-r' || arg === '--version'
        );
        if (releaseIdx !== -1 && args[releaseIdx + 1]) {
          desktopOptions.release = args[releaseIdx + 1];
        }
        const outputIdx = args.findIndex((arg) => arg === '--output' || arg === '-o');
        if (outputIdx !== -1 && args[outputIdx + 1]) {
          desktopOptions.output = args[outputIdx + 1];
        }
        const assetIdx = args.findIndex((arg) => arg === '--asset' || arg === '-a');
        if (assetIdx !== -1 && args[assetIdx + 1]) {
          desktopOptions.asset = args[assetIdx + 1];
        }
        if (args.includes('--force') || args.includes('-f')) {
          desktopOptions.force = true;
        }
        if (args.includes('--install') || args.includes('-i')) {
          desktopOptions.install = true;
        }
        if (args.includes('--yes') || args.includes('-y')) {
          desktopOptions.nonInteractive = true;
        }
        await desktopCommand(desktopOptions);
        break;

      case 'update':
        const updateOptions: {
          check?: boolean;
          install?: boolean;
          release?: string;
          currentVersion?: string;
          asset?: string;
          output?: string;
          force?: boolean;
          yes?: boolean;
          json?: boolean;
          scheduled?: boolean;
        } = {};
        if (args.includes('--check') || args.includes('-c')) {
          updateOptions.check = true;
        }
        if (args.includes('--install') || args.includes('-i')) {
          updateOptions.install = true;
        }
        const updateReleaseIdx = args.findIndex((arg) =>
          arg === '--release' || arg === '-r' || arg === '--version'
        );
        if (updateReleaseIdx !== -1 && args[updateReleaseIdx + 1]) {
          updateOptions.release = args[updateReleaseIdx + 1];
        }
        const currentVersionIdx = args.findIndex((arg) => arg === '--current-version');
        if (currentVersionIdx !== -1 && args[currentVersionIdx + 1]) {
          updateOptions.currentVersion = args[currentVersionIdx + 1];
        }
        const updateAssetIdx = args.findIndex((arg) => arg === '--asset' || arg === '-a');
        if (updateAssetIdx !== -1 && args[updateAssetIdx + 1]) {
          updateOptions.asset = args[updateAssetIdx + 1];
        }
        const updateOutputIdx = args.findIndex((arg) => arg === '--output' || arg === '-o');
        if (updateOutputIdx !== -1 && args[updateOutputIdx + 1]) {
          updateOptions.output = args[updateOutputIdx + 1];
        }
        if (args.includes('--force') || args.includes('-f')) {
          updateOptions.force = true;
        }
        if (args.includes('--yes') || args.includes('-y')) {
          updateOptions.yes = true;
        }
        if (args.includes('--json')) {
          updateOptions.json = true;
        }
        if (args.includes('--scheduled')) {
          updateOptions.scheduled = true;
        }
        await updateCommand(updateOptions);
        break;

      case 'lock':
        await lockCommand();
        break;

      case 'destruct':
      case 'destroy':
      case 'wipe':
        await destructCommand();
        break;

      case 'version':
      case 'ver':
      case '-v':
        console.log(chalk.cyan(`\n  BlankDrive v${VERSION}\n`));
        break;

      case 'help':
      case '?':
        if (args.includes('--list') || args.includes('-l') || args.includes('--plain')) {
          showHelpList();
        } else {
          await showInteractiveHelp();
        }
        break;

      case 'exit':
      case 'quit':
      case 'q':
        console.log(chalk.gray('\n  Goodbye! 👋\n'));
        return false; // Signal to exit

      case 'clear':
      case 'cls':
        console.clear();
        break;

      case '':
        // Empty command, just show prompt again
        break;

      default:
        console.log(chalk.red(`\n  Unknown command: ${cmd}`));
        console.log(chalk.gray('  Type "help" for available commands.\n'));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`\n  Error: ${error.message}\n`));
    }
  }

  return true; // Continue running
}

/**
 * Promisified readline question with proper terminal handling
 */
function askQuestion(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    // Ensure stdin is in the right mode before asking
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.resume();

    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Create a new readline interface with history and tab completion support
 */
function createReadlineWithHistory(): readline.Interface {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: MAX_HISTORY,
    removeHistoryDuplicates: true,
    completer: completer,
  });

  // Populate history (oldest first for readline)
  // @ts-ignore - history is not in types but is supported
  if (rl.history && Array.isArray(commandHistory)) {
    // @ts-ignore
    rl.history.push(...[...commandHistory].reverse());
  }

  return rl;
}

/**
 * Start interactive shell
 */
export async function startShell(): Promise<void> {
  console.log(chalk.cyan(`
  ██████╗ ██╗      █████╗ ███╗   ██╗██╗  ██╗
  ██╔══██╗██║     ██╔══██╗████╗  ██║██║ ██╔╝
  ██████╔╝██║     ███████║██╔██╗ ██║█████╔╝
  ██╔══██╗██║     ██╔══██║██║╚██╗██║██╔═██╗
  ██████╔╝███████╗██║  ██║██║ ╚████║██║  ██╗
  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
     ██████╗ ██████╗ ██╗██╗   ██╗███████╗
     ██╔══██╗██╔══██╗██║██║   ██║██╔════╝
     ██║  ██║██████╔╝██║██║   ██║█████╗
     ██║  ██║██╔══██╗██║╚██╗ ██╔╝██╔══╝
     ██████╔╝██║  ██║██║ ╚████╔╝ ███████╗
     ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝
`));

  console.log(chalk.bold('  Secure Password Manager'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────\n'));
  console.log(chalk.bgCyan.black(' DESKTOP RELEASE LIVE ') + chalk.white(' Install: ') + chalk.cyan('desktop --install'));
  console.log(chalk.gray('  Download: ') + chalk.cyan('desktop') + chalk.gray(' | Update check: ') + chalk.cyan('update --check'));
  console.log('');

  // Load saved theme
  await loadTheme();

  // Check if vault exists
  const { vaultExists } = await import('../storage/vault/index.js');
  if (!await vaultExists()) {
    console.log(chalk.yellow('  Welcome! No vault found.\n'));
    console.log(chalk.white('  To get started, create a new vault:\n'));
    console.log(chalk.cyan('    init') + chalk.gray('          Create a new vault'));
    console.log(chalk.cyan('    init --restore') + chalk.gray('  Restore from cloud backup\n'));

    // Allow only init command until vault is created
    let vaultCreated = false;
    while (!vaultCreated) {
      const rl = createReadlineWithHistory();
      const input = await askQuestion(rl, SHELL_PROMPT);
      rl.close();

      const { cmd, args } = parseCommand(input);

      if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
        console.log(chalk.gray('\n  Goodbye! 👋\n'));
        process.exit(0);
      }

      if (cmd === 'init') {
        const initOptions: { drive?: boolean; restore?: boolean } = {};
        if (args.includes('--restore') || args.includes('-r')) initOptions.restore = true;
        if (args.includes('--drive') || args.includes('-d')) initOptions.drive = true;
        await initCommand(initOptions);

        // Check if vault was created
        if (await vaultExists()) {
          vaultCreated = true;
        }
      } else if (cmd === 'web' || cmd === 'ui') {
        const webOptions: { port?: string; open?: boolean } = {};
        const portIdx = args.findIndex((arg) => arg === '--port' || arg === '-p');
        if (portIdx !== -1 && args[portIdx + 1]) {
          webOptions.port = args[portIdx + 1];
        }
        if (args.includes('--open') || args.includes('-o')) {
          webOptions.open = true;
        }
        await webCommand(webOptions);
      } else if (cmd === 'desktop') {
        const desktopOptions: {
          release?: string;
          output?: string;
          asset?: string;
          force?: boolean;
          install?: boolean;
          nonInteractive?: boolean;
        } = {};
        const releaseIdx = args.findIndex((arg) =>
          arg === '--release' || arg === '-r' || arg === '--version'
        );
        if (releaseIdx !== -1 && args[releaseIdx + 1]) {
          desktopOptions.release = args[releaseIdx + 1];
        }
        const outputIdx = args.findIndex((arg) => arg === '--output' || arg === '-o');
        if (outputIdx !== -1 && args[outputIdx + 1]) {
          desktopOptions.output = args[outputIdx + 1];
        }
        const assetIdx = args.findIndex((arg) => arg === '--asset' || arg === '-a');
        if (assetIdx !== -1 && args[assetIdx + 1]) {
          desktopOptions.asset = args[assetIdx + 1];
        }
        if (args.includes('--force') || args.includes('-f')) {
          desktopOptions.force = true;
        }
        if (args.includes('--install') || args.includes('-i')) {
          desktopOptions.install = true;
        }
        if (args.includes('--yes') || args.includes('-y')) {
          desktopOptions.nonInteractive = true;
        }
        await desktopCommand(desktopOptions);
      } else if (cmd === 'update') {
        const updateOptions: {
          check?: boolean;
          install?: boolean;
          release?: string;
          currentVersion?: string;
          asset?: string;
          output?: string;
          force?: boolean;
          yes?: boolean;
          json?: boolean;
          scheduled?: boolean;
        } = {};
        if (args.includes('--check') || args.includes('-c')) {
          updateOptions.check = true;
        }
        if (args.includes('--install') || args.includes('-i')) {
          updateOptions.install = true;
        }
        const updateReleaseIdx = args.findIndex((arg) =>
          arg === '--release' || arg === '-r' || arg === '--version'
        );
        if (updateReleaseIdx !== -1 && args[updateReleaseIdx + 1]) {
          updateOptions.release = args[updateReleaseIdx + 1];
        }
        const currentVersionIdx = args.findIndex((arg) => arg === '--current-version');
        if (currentVersionIdx !== -1 && args[currentVersionIdx + 1]) {
          updateOptions.currentVersion = args[currentVersionIdx + 1];
        }
        const updateAssetIdx = args.findIndex((arg) => arg === '--asset' || arg === '-a');
        if (updateAssetIdx !== -1 && args[updateAssetIdx + 1]) {
          updateOptions.asset = args[updateAssetIdx + 1];
        }
        const updateOutputIdx = args.findIndex((arg) => arg === '--output' || arg === '-o');
        if (updateOutputIdx !== -1 && args[updateOutputIdx + 1]) {
          updateOptions.output = args[updateOutputIdx + 1];
        }
        if (args.includes('--force') || args.includes('-f')) {
          updateOptions.force = true;
        }
        if (args.includes('--yes') || args.includes('-y')) {
          updateOptions.yes = true;
        }
        if (args.includes('--json')) {
          updateOptions.json = true;
        }
        if (args.includes('--scheduled')) {
          updateOptions.scheduled = true;
        }
        await updateCommand(updateOptions);
      } else if (cmd === 'help' || cmd === '?') {
        console.log(chalk.yellow('\n  Please create a vault first:\n'));
        console.log(chalk.cyan('    init') + chalk.gray('          Create a new vault'));
        console.log(chalk.cyan('    init --restore') + chalk.gray('  Restore from cloud backup'));
        console.log(chalk.cyan('    web --open') + chalk.gray('    Open local web UI'));
        console.log(chalk.cyan('    desktop') + chalk.gray('       Download desktop installer'));
        console.log(chalk.cyan('    update --check') + chalk.gray('  Check CLI updates via npm'));
        console.log(chalk.cyan('    exit') + chalk.gray('          Exit the application\n'));
      } else if (cmd !== '') {
        console.log(chalk.red('\n  Please create a vault first using "init"\n'));
      }
    }
  }

  // Vault exists - require unlock
  const { isUnlocked, unlock } = await import('../storage/vault/index.js');
  const { initializeKeyManager } = await import('../crypto/index.js');
  const { logAuditEvent } = await import('./auditLog.js');
  const { checkDuressPasswordPreUnlock, activateDuressModeSimple, isInDuressMode: checkDuressMode } = await import('./duress.js');

  if (!isUnlocked() && !checkDuressMode()) {
    console.log(chalk.white('  Please unlock your vault to continue.\n'));

    let unlocked = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!unlocked && attempts < maxAttempts) {
      attempts++;

      try {
        initializeKeyManager();
        const password = await promptPassword();

        const spinner = ora('Unlocking vault...').start();

        // First check if this is a duress password
        const isDuress = await checkDuressPasswordPreUnlock(password);

        if (isDuress) {
          // Duress password entered - activate duress mode
          spinner.succeed('Vault unlocked');

          // Activate duress mode (shows decoy entries)
          activateDuressModeSimple();

          // Mark as unlocked in duress mode
          unlocked = true;
          console.log(chalk.green('\n  ✓ Welcome back!\n'));
          break;
        }

        try {
          await unlock(password);
          spinner.succeed('Vault unlocked');
          unlocked = true;

          // Check for 2FA
          const config = getVault2FAConfig();
          if (config?.enabled) {
            const { prompt2FACode, verifyVault2FACode, verifyBackupCode } = await import('./vault2fa.js');

            let twoFAVerified = false;
            let twoFAAttempts = 0;
            const maxTwoFAAttempts = 3;

            while (!twoFAVerified && twoFAAttempts < maxTwoFAAttempts) {
              twoFAAttempts++;
              const code = await prompt2FACode();

              // Check if it's a backup code (XXXX-XXXX format)
              if (/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(code.replace(/\s/g, ''))) {
                const backupIndex = verifyBackupCode(code, config.backupCodes || []);
                if (backupIndex >= 0) {
                  // Valid backup code - consume it
                  const { useBackupCode } = await import('../storage/vault/index.js');
                  await useBackupCode(backupIndex);
                  await logAuditEvent('vault_unlocked_backup_code');
                  console.log(chalk.yellow('\n  ⚠ Backup code used. Consider generating new codes.\n'));
                  twoFAVerified = true;
                }
              } else if (verifyVault2FACode(code, config.secret)) {
                twoFAVerified = true;
              }

              if (!twoFAVerified) {
                const remaining = maxTwoFAAttempts - twoFAAttempts;
                if (remaining > 0) {
                  console.log(chalk.red(`\n  Invalid code. ${remaining} attempt(s) remaining.\n`));
                } else {
                  console.log(chalk.red('\n  Too many failed attempts. Vault locked.\n'));
                  await logAuditEvent('failed_2fa_attempt');
                  const { lock } = await import('../storage/vault/index.js');
                  lock();
                  process.exit(1);
                }
              }
            }
          }

          await logAuditEvent('vault_unlocked');
          console.log(chalk.green('\n  ✓ Welcome back!\n'));

        } catch (error) {
          spinner.fail('Failed to unlock vault');
          await logAuditEvent('failed_unlock_attempt');

          const remaining = maxAttempts - attempts;
          if (remaining > 0) {
            console.log(chalk.red(`  Invalid password. ${remaining} attempt(s) remaining.\n`));
          } else {
            console.log(chalk.red('\n  Too many failed attempts. Exiting.\n'));
            process.exit(1);
          }
        }
      } catch (error) {
        // User cancelled or other error
        if (error instanceof Error && error.message.includes('cancelled')) {
          console.log(chalk.gray('\n  Goodbye! 👋\n'));
          process.exit(0);
        }
      }
    }
  } else {
    console.log(chalk.green('  ✓ Vault already unlocked.\n'));
  }

  // Now show the interactive shell
  console.log(chalk.gray('  Type "help" for commands, "exit" to quit.'));
  console.log(chalk.gray('  Use ↑/↓ arrows for history, Tab for completion.\n'));

  // Load command history
  await loadHistory();

  // Start auto-lock timer
  startAutoLockTimer();

  // Main loop
  let running = true;
  while (running) {
    // Reset auto-lock timer on each prompt
    resetAutoLockTimer();

    // Ensure terminal is in a clean state before prompting
    // This fixes issues where inquirer leaves terminal in a bad state
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.resume();

    // Create fresh readline for each prompt with history support
    const rl = createReadlineWithHistory();
    const input = await askQuestion(rl, SHELL_PROMPT);
    rl.close();

    // Add command to history (non-empty commands only)
    if (input.trim()) {
      addToHistory(input);
    }

    // Reset timer on user input
    resetAutoLockTimer();

    const { cmd, args } = parseCommand(input);
    running = await executeCommand(cmd, args);

    // Clean up terminal state after command execution
    // This ensures inquirer/ora didn't leave stdin in a broken state
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.resume();
  }

  // Save history and stop auto-lock timer on exit
  await saveHistory();
  stopAutoLockTimer();

  process.exit(0);
}
