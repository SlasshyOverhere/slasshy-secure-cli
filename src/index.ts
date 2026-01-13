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
  statusCommand,
  lockCommand,
  authCommand,
  uploadCommand,
  downloadCommand,
  destructCommand,
} from './cli/commands/index.js';
import { startShell } from './cli/shell.js';

// Get version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const VERSION = pkg.version;

const program = new Command();

// ASCII art banner
const banner = `
  ███████╗██╗      █████╗ ███████╗███████╗██╗  ██╗██╗   ██╗
  ██╔════╝██║     ██╔══██╗██╔════╝██╔════╝██║  ██║╚██╗ ██╔╝
  ███████╗██║     ███████║███████╗███████╗███████║ ╚████╔╝
  ╚════██║██║     ██╔══██║╚════██║╚════██║██╔══██║  ╚██╔╝
  ███████║███████╗██║  ██║███████║███████║██║  ██║   ██║
  ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝
`;

program
  .name('slasshy')
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
  .option('-t, --type <type>', 'Filter by type: passwords or files')
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

// Status command
program
  .command('status')
  .description('Show vault and sync status')
  .action(async () => {
    await statusCommand();
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
  .description('Authenticate with Google Drive via OAuth')
  .option('-s, --server <url>', 'Custom OAuth server URL')
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

// Version command (explicit)
program
  .command('version')
  .description('Show version number')
  .action(() => {
    console.log(chalk.cyan(`\n  Slasshy v${VERSION}\n`));
  });

// Check for interactive shell mode (no arguments)
if (!process.argv.slice(2).length) {
  startShell();
} else {
  // Parse arguments for CLI mode
  program.parse();
}
