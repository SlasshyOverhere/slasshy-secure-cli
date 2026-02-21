#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'module';
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
  settingsCommand,
} from './cli/commands/index.js';
import { startShell } from './cli/shell.js';

// Get version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const VERSION = pkg.version;

const program = new Command();

// ASCII art banner
const banner = `
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
`;

program
  .name('BLANK')
  .description('Military-grade secure storage with steganography & Google Drive sync')
  .version(VERSION, '-v, --version', 'Show version number')
  .addHelpText('before', chalk.cyan(banner));

// Init command
program
  .command('init')
  .description('Initialize a new encrypted vault')
  .option('-d, --drive', 'Set up Google Drive sync')
  .option('-r, --restore', 'Restore vault from cloud backup')
  .action(async (options) => {
    await initCommand(options);
  });

// Add command
program
  .command('add')
  .description('Add a new entry to the vault')
  .action(async () => {
    await addCommand();
  });

// Get command
program
  .command('get [search]')
  .description('Retrieve an entry from the vault')
  .option('-c, --copy', 'Copy password to clipboard')
  .option('-s, --show-password', 'Show password in output')
  .action(async (search, options) => {
    await getCommand(search, options);
  });

// List command
program
  .command('list')
  .alias('ls')
  .description('List all entries in the vault')
  .option('-f, --filter <term>', 'Filter entries by title')
  .option('-t, --type <type>', 'Filter by type: passwords, files, or notes')
  .option('-c, --category <name>', 'Filter by category')
  .action(async (options) => {
    await listCommand(options);
  });

// Upload command
program
  .command('upload [file]')
  .alias('up')
  .description('Upload a file to the vault (drag & drop supported)')
  .action(async (file) => {
    await uploadCommand(file);
  });

// Download command
program
  .command('download [search]')
  .alias('dl')
  .description('Download a file from the vault')
  .action(async (search) => {
    await downloadCommand(search);
  });

// Delete command
program
  .command('delete [search]')
  .alias('rm')
  .description('Delete an entry from the vault')
  .option('-f, --force', 'Skip confirmation')
  .action(async (search, options) => {
    await deleteCommand(search, options);
  });

// Edit command
program
  .command('edit [search]')
  .description('Edit an existing entry in the vault')
  .action(async (search) => {
    await editCommand(search);
  });

// Favorite command
program
  .command('favorite [search]')
  .alias('fav')
  .description('Toggle favorite status of an entry')
  .action(async (search) => {
    await favoriteCommand(search);
  });

// Favorites list command
program
  .command('favorites')
  .alias('favs')
  .description('List all favorite entries')
  .action(async () => {
    await listFavoritesCommand();
  });

// Note command
program
  .command('note [subcommand] [arg]')
  .description('Manage secure notes (add, view, edit, list)')
  .action(async (subcommand, arg) => {
    await noteCommand(subcommand, arg);
  });

// Audit command
program
  .command('audit')
  .description('Check password security and expiry status')
  .option('-a, --all', 'Show all passwords including up-to-date ones')
  .action(async (options) => {
    await auditCommand(options);
  });

// Status command
program
  .command('status')
  .description('Show vault and sync status')
  .action(async () => {
    await statusCommand();
  });

// Settings command
program
  .command('settings')
  .description('Manage app settings')
  .option('--storage <mode>', 'Cloud storage mode: hidden or public')
  .option('--folder <name>', 'Public folder name under BlankDrive')
  .action(async (options) => {
    await settingsCommand(options);
  });

// Lock command
program
  .command('lock')
  .description('Lock the vault and clear keys from memory')
  .action(async () => {
    await lockCommand();
  });

// Auth command
program
  .command('auth')
  .description('Authenticate with Google Drive via OAuth (your own client credentials)')
  .option('--setup', 'Set or update Google OAuth Client ID/Secret')
  .option('-l, --logout', 'Disconnect from Google Drive')
  .action(async (options) => {
    await authCommand(options);
  });

// Destruct command
program
  .command('destruct')
  .description('⚠️  Permanently destroy vault (local + cloud)')
  .action(async () => {
    await destructCommand();
  });

// Generate command
program
  .command('generate')
  .alias('gen')
  .description('Generate a secure password or passphrase')
  .option('-l, --length <number>', 'Password length (default: 20)')
  .option('-p, --preset <name>', 'Use preset: strong, standard, alphanumeric, memorable, pin')
  .option('--passphrase', 'Generate a memorable passphrase')
  .option('-w, --words <number>', 'Number of words for passphrase (default: 5)')
  .option('-c, --copy', 'Copy to clipboard')
  .option('--no-symbols', 'Exclude symbols')
  .action(async (options) => {
    await generateCommand({
      length: options.length ? parseInt(options.length, 10) : undefined,
      preset: options.preset,
      passphrase: options.passphrase,
      words: options.words ? parseInt(options.words, 10) : undefined,
      copy: options.copy,
      noSymbols: !options.symbols,
    });
  });

// Version command (explicit)
program
  .command('version')
  .description('Show version number')
  .action(() => {
    console.log(chalk.cyan(`\n  BlankDrive v${VERSION}\n`));
  });

// Check for interactive shell mode (no arguments)
if (!process.argv.slice(2).length) {
  startShell();
} else {
  // Parse arguments for CLI mode
  program.parse();
}
