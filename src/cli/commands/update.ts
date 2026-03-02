import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import https from 'https';
import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../../package.json') as { version?: string };
const CURRENT_VERSION = pkg.version || '0.0.0';
const NPM_REGISTRY_HOST = 'registry.npmjs.org';
const NPM_PACKAGE_NAME = 'blankdrive';
const UPDATE_STATE_FILE = path.join(os.homedir(), '.slasshy', 'cli-update-check.json');
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdateState {
  lastCheckedAt?: string;
}

interface UpdateCheckOptions {
  scheduled?: boolean;
  currentVersion?: string;
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
    const latestVersion = await fetchLatestNpmVersion(NPM_PACKAGE_NAME);
    const updateAvailable = isNewerVersion(latestVersion, currentVersion);

    await writeState({
      lastCheckedAt: toIsoDate(Date.now()),
    });

    return {
      currentVersion,
      latestVersion,
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

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

interface NpmLatestPayload {
  version?: string;
}

function fetchLatestNpmVersion(packageName: string): Promise<string> {
  const encoded = packageName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: NPM_REGISTRY_HOST,
        path: `/${encoded}/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'BlankDrive-CLI',
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 500;
          const body = Buffer.concat(chunks).toString('utf-8');

          if (status < 200 || status >= 300) {
            reject(new Error(`npm registry request failed with status ${status}.`));
            return;
          }

          try {
            const parsed = JSON.parse(body) as NpmLatestPayload;
            const version = parsed.version?.trim();
            if (!version) {
              reject(new Error('npm registry response did not include a version.'));
              return;
            }
            resolve(version);
          } catch {
            reject(new Error('Invalid JSON response from npm registry.'));
          }
        });
      }
    );

    req.on('error', (error) => reject(error));
    req.setTimeout(20000, () => {
      req.destroy(new Error('npm registry request timed out.'));
    });
    req.end();
  });
}

function parseVersion(value: string): number[] {
  const normalized = value.trim().replace(/^v/i, '').split('-')[0] || '';
  if (!normalized) {
    return [0];
  }

  return normalized.split('.').map((part) => {
    const match = part.match(/^(\d+)/);
    if (!match) {
      return 0;
    }
    return parseInt(match[1] ?? '0', 10);
  });
}

function isNewerVersion(latestTag: string, currentVersion: string): boolean {
  const latest = parseVersion(latestTag);
  const current = parseVersion(currentVersion);
  const maxLen = Math.max(latest.length, current.length);

  for (let i = 0; i < maxLen; i++) {
    const left = latest[i] ?? 0;
    const right = current[i] ?? 0;
    if (left > right) {
      return true;
    }
    if (left < right) {
      return false;
    }
  }

  return false;
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function installLatestFromNpm(quiet: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand(), ['install', '-g', `${NPM_PACKAGE_NAME}@latest`], {
      stdio: quiet ? 'ignore' : 'inherit',
      windowsHide: true,
    });

    child.once('error', (error) => reject(error));
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm install exited with code ${code ?? 'unknown'}.`));
    });
  });
}

function relaunchSelf(): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptArgs = process.argv.slice(1);
    const child = spawn(process.execPath, scriptArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.once('error', (error) => reject(error));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function runScheduledUpdateCheckPrompt(): Promise<boolean> {
  const result = await runUpdateCheck({ scheduled: true });
  if (result.skipped || result.error || !result.updateAvailable || !result.latestVersion) {
    return false;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  console.log(chalk.yellow(`\n  Update available: ${result.latestVersion} (current ${result.currentVersion})`));
  console.log(chalk.gray('  Install latest BlankDrive CLI from npm and restart now?\n'));

  const { installNow } = await inquirer.prompt<{ installNow: boolean }>([
    {
      type: 'confirm',
      name: 'installNow',
      message: 'Install and restart now?',
      default: false,
    },
  ]);

  if (!installNow) {
    console.log(chalk.gray('  Skipped update for now.\n'));
    return false;
  }

  try {
    await installLatestFromNpm(false);
    console.log(chalk.green('\n  ✓ CLI update installed.'));
    console.log(chalk.gray('  Restarting BlankDrive...\n'));

    await relaunchSelf();
    process.exit(0);
  } catch (error) {
    console.log(chalk.red('\n  ✗ Failed to install update.'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    console.log('');
    return false;
  }
}

export async function updateCommand(options: UpdateCommandOptions = {}): Promise<void> {
  const scheduled = options.scheduled === true;
  const nonInteractive = options.yes === true || options.json === true;
  const forceInstall = options.install === true;
  const currentVersion = options.currentVersion?.trim() || CURRENT_VERSION;

  const result = await runUpdateCheck({
    scheduled,
    currentVersion,
  });

  if (options.json) {
    const basePayload: Record<string, unknown> = {
      ...result,
      scheduled,
      channel: 'npm',
      packageName: NPM_PACKAGE_NAME,
    };

    if (result.error || !result.updateAvailable || !forceInstall) {
      printJson(basePayload);
      return;
    }

    try {
      await installLatestFromNpm(true);

      printJson({
        ...basePayload,
        installed: true,
        restarted: false,
        restartRecommended: true,
      });
    } catch (error) {
      printJson({
        ...basePayload,
        installed: false,
        restarted: false,
        error: error instanceof Error ? error.message : 'Update install failed.',
      });
    }

    return;
  }

  console.log(chalk.bold('\n  BlankDrive CLI Update (npm)\n'));

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
  console.log(chalk.gray(`  Source: npm package "${NPM_PACKAGE_NAME}"`));
  console.log('');

  if (options.check && !forceInstall) {
    console.log(chalk.gray('  Run "BLANK update --install" to install and restart.\n'));
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
    await installLatestFromNpm(false);

    console.log('');
    console.log(chalk.green('  ✓ CLI update installed.'));

    if (nonInteractive) {
      console.log(chalk.gray('  Restart skipped in non-interactive mode.'));
      console.log(chalk.gray('  Run BLANK again to use the updated version.\n'));
      return;
    }

    console.log(chalk.gray('  Restarting BlankDrive...\n'));
    await relaunchSelf();
    process.exit(0);
  } catch (error) {
    console.log('');
    console.log(chalk.red('  ✗ Failed to install update.'));
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
    }
    console.log('');
  }
}
