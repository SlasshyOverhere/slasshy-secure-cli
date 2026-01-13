#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import {
  initCommand,
  addCommand,
  getCommand,
  listCommand,
  deleteCommand,
  syncCommand,
  statusCommand,
  lockCommand,
  authCommand,
  uploadCommand,
  downloadCommand,
} from './cli/commands/index.js';

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
  .version('1.3.0')
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

// Sync command
program
  .command('sync')
  .description('Sync vault with Google Drive')
  .option('--push', 'Push local changes only')
  .option('--pull', 'Pull remote changes only')
  .option('--carrier-dir <path>', 'Directory containing carrier images')
  .action(async (options) => {
    await syncCommand(options);
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

// Parse arguments
program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  console.log(chalk.cyan(banner));
  console.log(chalk.bold('  Military-grade encrypted storage with steganography\n'));
  console.log(chalk.gray('  Your secrets are encrypted locally, then hidden inside'));
  console.log(chalk.gray('  innocent-looking images before uploading to Google Drive.'));
  console.log(chalk.gray('  Even Google cannot see what you\'re storing.\n'));
  program.outputHelp();
}
