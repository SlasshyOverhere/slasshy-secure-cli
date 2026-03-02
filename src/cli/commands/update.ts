import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import {
  downloadDesktopRelease,
  getDesktopReleaseInfo,
  isNewerVersion,
  launchDesktopInstaller,
  type DesktopCommandOptions,
} from './desktop.js';

const require = createRequire(import.meta.url);
const pkg = require('../../../package.json') as { version?: string };
const CURRENT_VERSION = pkg.version || '0.0.0';
const UPDATE_STATE_FILE = path.join(os.homedir(), '.slasshy', 'desktop-update-check.json');
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdateState {
  lastCheckedAt?: string;
}

interface UpdateCheckOptions {
  scheduled?: boolean;
  release?: string;
  asset?: string;
  currentVersion?: string;
}

interface InstallOptions {
  release?: string;
  asset?: string;
  output?: string;
  force?: boolean;
  quiet?: boolean;
  nonInteractive?: boolean;
}

export interface UpdateCommandOptions {
  check?: boolean;
  install?: boolean;
  release?: string;
  version?: string;
  currentVersion?: string;
  asset?: string;
  output?: string;
  force?: boolean;
  yes?: boolean;
  json?: boolean;
  scheduled?: boolean;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  assetName?: string;
  updateAvailable: boolean;
  checked: boolean;
  skipped: boolean;
  reason?: string;
  error?: string;
}

function toIsoDate(value: number): string {
  return new Date(value).toISOString();
}

async function readState(): Promise<UpdateState> {
  try {
    const raw = await fs.readFile(UPDATE_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as UpdateState;
    return parsed;
  } catch {
    return {};
  }
}

async function writeState(state: UpdateState): Promise<void> {
  await fs.mkdir(path.dirname(UPDATE_STATE_FILE), { recursive: true });
  await fs.writeFile(UPDATE_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function isCheckDue(lastCheckedAt?: string): boolean {
  if (!lastCheckedAt) {
    return true;
  }

  const parsed = Date.parse(lastCheckedAt);
  if (!Number.isFinite(parsed)) {
    return true;
  }

  return Date.now() - parsed >= UPDATE_CHECK_INTERVAL_MS;
}

async function runUpdateCheck(options: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
  const currentVersion = options.currentVersion?.trim() || CURRENT_VERSION;
  const state = await readState();
  const scheduled = options.scheduled === true;

  if (scheduled && !isCheckDue(state.lastCheckedAt)) {
    const nextAt = Date.parse(state.lastCheckedAt || '') + UPDATE_CHECK_INTERVAL_MS;
    return {
      currentVersion,
      updateAvailable: false,
      checked: false,
      skipped: true,
      reason: Number.isFinite(nextAt)
        ? `Next check after ${toIsoDate(nextAt)}`
        : 'Check interval not reached yet.',
    };
  }

  try {
    const info = await getDesktopReleaseInfo(options.release, options.asset);
    const updateAvailable = isNewerVersion(info.tagName, currentVersion);

    await writeState({
      lastCheckedAt: toIsoDate(Date.now()),
    });

    return {
      currentVersion,
      latestVersion: info.tagName,
      assetName: info.assetName,
      updateAvailable,
      checked: true,
      skipped: false,
    };
  } catch (error) {
    await writeState({
      lastCheckedAt: toIsoDate(Date.now()),
    }).catch(() => {});

    return {
      currentVersion,
      updateAvailable: false,
      checked: true,
      skipped: false,
      error: error instanceof Error ? error.message : 'Unknown update check error.',
    };
  }
}

async function installLatestDesktop(options: InstallOptions = {}): Promise<string> {
  const downloadOptions: DesktopCommandOptions = {
    release: options.release,
    asset: options.asset,
    output: options.output,
    force: options.force,
    quiet: options.quiet,
    nonInteractive: options.nonInteractive,
  };

  const result = await downloadDesktopRelease(downloadOptions);
  await launchDesktopInstaller(result.outputPath);
  return result.outputPath;
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function runScheduledUpdateCheckPrompt(): Promise<void> {
  const result = await runUpdateCheck({ scheduled: true });
  if (result.skipped || result.error || !result.updateAvailable || !result.latestVersion) {
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  console.log(chalk.yellow(`\n  Update available: ${result.latestVersion} (current ${result.currentVersion})`));
  console.log(chalk.gray('  Download and install the desktop update now?\n'));

  const { installNow } = await inquirer.prompt<{ installNow: boolean }>([
    {
      type: 'confirm',
      name: 'installNow',
      message: 'Install update now?',
      default: false,
    },
  ]);

  if (!installNow) {
    console.log(chalk.gray('  Skipped update for now.\n'));
    return;
  }

  try {
    const outputPath = await installLatestDesktop({
      release: result.latestVersion,
      force: true,
    });
    console.log(chalk.green('\n  ✓ Update downloaded and installer launched.'));
    console.log(chalk.green(`  Installer: ${outputPath}\n`));
  } catch (error) {
    console.log(chalk.red('\n  ✗ Failed to install update.'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    console.log('');
  }
}

export async function updateCommand(options: UpdateCommandOptions = {}): Promise<void> {
  const release = options.release || options.version;
  const scheduled = options.scheduled === true;
  const nonInteractive = options.yes === true || options.json === true;
  const forceInstall = options.install === true;
  const currentVersion = options.currentVersion?.trim() || CURRENT_VERSION;

  const result = await runUpdateCheck({
    scheduled,
    release,
    asset: options.asset,
    currentVersion,
  });

  if (options.json) {
    const basePayload: Record<string, unknown> = {
      ...result,
      scheduled,
    };

    if (result.error || !result.updateAvailable || !forceInstall) {
      printJson(basePayload);
      return;
    }

    try {
      const outputPath = await installLatestDesktop({
        release: result.latestVersion,
        asset: options.asset,
        output: options.output,
        force: options.force === true,
        quiet: true,
        nonInteractive: true,
      });

      printJson({
        ...basePayload,
        installed: true,
        installerLaunched: true,
        outputPath,
      });
    } catch (error) {
      printJson({
        ...basePayload,
        installed: false,
        installerLaunched: false,
        error: error instanceof Error ? error.message : 'Update install failed.',
      });
    }

    return;
  }

  console.log(chalk.bold('\n  BlankDrive Desktop Update\n'));

  if (result.skipped) {
    console.log(chalk.gray(`  ${result.reason || 'Update check skipped.'}\n`));
    return;
  }

  if (result.error) {
    console.log(chalk.red(`  Update check failed: ${result.error}`));
    console.log(chalk.gray('  Tip: run "BLANK update --check" again later.\n'));
    return;
  }

  if (!result.updateAvailable || !result.latestVersion) {
    console.log(chalk.green(`  ✓ You are up to date (${result.currentVersion}).\n`));
    return;
  }

  console.log(chalk.yellow(`  Update available: ${result.latestVersion}`));
  console.log(chalk.gray(`  Current version: ${result.currentVersion}`));
  if (result.assetName) {
    console.log(chalk.gray(`  Installer: ${result.assetName}`));
  }
  console.log('');

  if (options.check && !forceInstall) {
    console.log(chalk.gray('  Run "BLANK update --install" to download and launch installer.\n'));
    return;
  }

  let installNow = forceInstall;
  if (!installNow && !nonInteractive) {
    const prompt = await inquirer.prompt<{ installNow: boolean }>([
      {
        type: 'confirm',
        name: 'installNow',
        message: 'Download and install now?',
        default: false,
      },
    ]);
    installNow = prompt.installNow;
  }

  if (!installNow) {
    console.log(chalk.gray('  Update skipped.\n'));
    return;
  }

  try {
    const outputPath = await installLatestDesktop({
      release: result.latestVersion,
      asset: options.asset,
      output: options.output,
      force: options.force === true,
      quiet: false,
      nonInteractive,
    });

    console.log('');
    console.log(chalk.green('  ✓ Update downloaded and installer launched.'));
    console.log(chalk.green(`  Installer: ${outputPath}\n`));
  } catch (error) {
    console.log('');
    console.log(chalk.red('  ✗ Failed to install update.'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    console.log('');
  }
}
