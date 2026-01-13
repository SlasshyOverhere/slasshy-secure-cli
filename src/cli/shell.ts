import chalk from 'chalk';
import readline from 'readline';
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
} from './commands/index.js';

const SHELL_PROMPT = chalk.cyan('slasshy') + chalk.gray('> ');

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
  console.log(chalk.white('    sync') + chalk.gray('              Sync with Google Drive'));
  console.log(chalk.white('    status') + chalk.gray('            Show vault status'));
  console.log(chalk.white('    auth') + chalk.gray('              Authenticate with Google Drive'));
  console.log(chalk.white('    lock') + chalk.gray('              Lock the vault'));
  console.log(chalk.white('    help') + chalk.gray('              Show this help'));
  console.log(chalk.white('    exit, quit, q') + chalk.gray('     Exit shell'));
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

      case 'sync':
        const syncOptions: { push?: boolean; pull?: boolean } = {};
        if (args.includes('--push')) syncOptions.push = true;
        if (args.includes('--pull')) syncOptions.pull = true;
        await syncCommand(syncOptions);
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(SHELL_PROMPT, async (input) => {
      const { cmd, args } = parseCommand(input);
      const continueRunning = await executeCommand(cmd, args);

      if (continueRunning) {
        prompt();
      } else {
        rl.close();
        process.exit(0);
      }
    });
  };

  prompt();
}
