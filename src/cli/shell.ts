import chalk from 'chalk';
import readline from 'readline';
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
} from './commands/index.js';

// Get version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
const VERSION = pkg.version;

const SHELL_PROMPT = chalk.cyan('slasshy') + chalk.gray('> ');

const AVAILABLE_COMMANDS = [
  'init',
  'add',
  'list', 'ls',
  'get',
  'delete', 'rm', 'del',
  'upload', 'up',
  'download', 'dl',
  'status',
  'auth',
  'lock',
  'destruct', 'destroy', 'wipe',
  'version', 'ver',
  'help', '?',
  'exit', 'quit', 'q',
  'clear', 'cls'
];

/**
 * Tab completion function
 */
function completer(line: string) {
  const hits = AVAILABLE_COMMANDS.filter((c) => c.startsWith(line));
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
function showHelp(): void {
  console.log(chalk.bold('\n  Available Commands:\n'));
  console.log(chalk.white('    init') + chalk.gray('              Initialize a new vault'));
  console.log(chalk.white('    init --restore') + chalk.gray('    Restore vault from cloud'));
  console.log(chalk.white('    add') + chalk.gray('               Add a new password entry'));
  console.log(chalk.white('    list, ls') + chalk.gray('          List all entries'));
  console.log(chalk.white('    get <search>') + chalk.gray('      Get an entry'));
  console.log(chalk.white('    delete, rm') + chalk.gray('        Delete an entry'));
  console.log(chalk.white('    upload, up') + chalk.gray('        Upload a file'));
  console.log(chalk.white('    download, dl') + chalk.gray('      Download a file'));
  console.log(chalk.white('    status') + chalk.gray('            Show vault status'));
  console.log(chalk.white('    auth') + chalk.gray('              Authenticate with Google Drive'));
  console.log(chalk.white('    lock') + chalk.gray('              Lock the vault'));
  console.log(chalk.red('    destruct') + chalk.gray('          ⚠️  Destroy vault completely'));
  console.log(chalk.white('    version') + chalk.gray('           Show version number'));
  console.log(chalk.white('    help') + chalk.gray('              Show this help'));
  console.log(chalk.white('    exit, quit, q') + chalk.gray('     Exit shell'));
  console.log(chalk.white('    clear, cls') + chalk.gray('        Clear screen'));
  console.log('');
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

      case 'list':
      case 'ls':
        const listOptions: { filter?: string; type?: string } = {};
        const filterIdx = args.indexOf('-f');
        if (filterIdx !== -1 && args[filterIdx + 1]) {
          listOptions.filter = args[filterIdx + 1];
        }
        const typeIdx = args.indexOf('-t');
        if (typeIdx !== -1 && args[typeIdx + 1]) {
          listOptions.type = args[typeIdx + 1];
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

      case 'auth':
        const authOptions: { server?: string; logout?: boolean } = {};
        if (args.includes('-l') || args.includes('--logout')) authOptions.logout = true;
        const serverIdx = args.indexOf('-s');
        if (serverIdx !== -1 && args[serverIdx + 1]) {
          authOptions.server = args[serverIdx + 1];
        }
        await authCommand(authOptions);
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
        console.log(chalk.cyan(`\n  Slasshy v${VERSION}\n`));
        break;

      case 'help':
      case '?':
        showHelp();
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
 * Promisified readline question
 */
function askQuestion(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Create a new readline interface
 */
function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });
}

/**
 * Start interactive shell
 */
export async function startShell(): Promise<void> {
  console.log(chalk.cyan(`
  ███████╗██╗      █████╗ ███████╗███████╗██╗  ██╗██╗   ██╗
  ██╔════╝██║     ██╔══██╗██╔════╝██╔════╝██║  ██║╚██╗ ██╔╝
  ███████╗██║     ███████║███████╗███████╗███████║ ╚████╔╝
  ╚════██║██║     ██╔══██║╚════██║╚════██║██╔══██║  ╚██╔╝
  ███████║███████╗██║  ██║███████║███████║██║  ██║   ██║
  ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝
`));

  console.log(chalk.bold('  Interactive Shell Mode'));
  console.log(chalk.gray('  Type "help" for commands, "exit" to quit.\n'));

  // Main loop
  let running = true;
  while (running) {
    // Create fresh readline for each prompt (avoids conflicts with inquirer)
    const rl = createReadline();
    const input = await askQuestion(rl, SHELL_PROMPT);
    rl.close();

    const { cmd, args } = parseCommand(input);
    running = await executeCommand(cmd, args);
  }

  process.exit(0);
}
