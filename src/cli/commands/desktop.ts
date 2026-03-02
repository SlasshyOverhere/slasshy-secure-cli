import chalk from 'chalk';
import https from 'https';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import { createProgressTracker, formatBytes } from '../progress.js';

const GITHUB_OWNER = 'SlasshyOverhere';
const GITHUB_REPO = 'BlankDrive';
const GITHUB_API_HOST = 'api.github.com';
const MAX_REDIRECTS = 5;

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

export interface DesktopCommandOptions {
  release?: string;
  version?: string;
  output?: string;
  asset?: string;
  force?: boolean;
  install?: boolean;
  nonInteractive?: boolean;
  quiet?: boolean;
}

export interface DesktopReleaseInfo {
  tagName: string;
  assetName: string;
  assetSize: number;
  downloadUrl: string;
}

export interface DesktopDownloadResult {
  releaseTag: string;
  assetName: string;
  assetSize: number;
  outputPath: string;
}

function getArchHints(): string[] {
  switch (process.arch) {
    case 'x64':
      return ['x64', 'amd64'];
    case 'arm64':
      return ['arm64', 'aarch64'];
    case 'ia32':
      return ['x86', 'ia32', 'i386'];
    default:
      return [process.arch.toLowerCase()];
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const msg = error.message.toLowerCase();
  return msg.includes('404') || msg.includes('not found');
}

function normalizeReleaseTags(tag: string): string[] {
  const clean = tag.trim();
  if (!clean) {
    return [];
  }

  if (clean.startsWith('v')) {
    return [clean, clean.slice(1)];
  }

  return [clean, `v${clean}`];
}

async function githubApiGet<T>(apiPath: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN?.trim();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: GITHUB_API_HOST,
        path: apiPath,
        method: 'GET',
        headers: {
          'User-Agent': 'BlankDrive-CLI',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 500;

          if (status < 200 || status >= 300) {
            let message = `GitHub API request failed with status ${status}.`;
            try {
              const parsed = JSON.parse(body) as { message?: string };
              if (parsed.message) {
                message = parsed.message;
              }
            } catch {
              // Keep default message
            }
            reject(new Error(message));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('Invalid JSON response from GitHub API.'));
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(20000, () => {
      req.destroy(new Error('GitHub API request timed out.'));
    });

    req.end();
  });
}

async function fetchRelease(tag?: string): Promise<GitHubRelease> {
  const repoPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

  if (!tag) {
    return githubApiGet<GitHubRelease>(`${repoPath}/latest`);
  }

  const candidates = normalizeReleaseTags(tag);
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return await githubApiGet<GitHubRelease>(
        `${repoPath}/tags/${encodeURIComponent(candidate)}`
      );
    } catch (error) {
      lastError = error;
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error(`Release "${tag}" not found.`);
}

function selectExeAsset(release: GitHubRelease, requestedAsset?: string): GitHubReleaseAsset {
  const exeAssets = release.assets.filter((asset) => asset.name.toLowerCase().endsWith('.exe'));

  if (exeAssets.length === 0) {
    throw new Error('No .exe asset found in this release.');
  }

  if (requestedAsset) {
    const needle = requestedAsset.toLowerCase();
    const exactMatch = exeAssets.find((asset) => asset.name.toLowerCase() === needle);
    if (exactMatch) {
      return exactMatch;
    }

    const partialMatch = exeAssets.find((asset) => asset.name.toLowerCase().includes(needle));
    if (partialMatch) {
      return partialMatch;
    }

    throw new Error(`No .exe asset matching "${requestedAsset}" found.`);
  }

  const archHints = getArchHints();
  const archMatches = exeAssets.filter((asset) =>
    archHints.some((hint) => asset.name.toLowerCase().includes(hint))
  );
  const pool = archMatches.length > 0 ? archMatches : exeAssets;

  const setupAsset = pool.find((asset) => asset.name.toLowerCase().includes('setup'));
  return setupAsset ?? pool[0]!;
}

export async function getDesktopReleaseInfo(tag?: string, requestedAsset?: string): Promise<DesktopReleaseInfo> {
  const release = await fetchRelease(tag);
  const asset = selectExeAsset(release, requestedAsset);

  return {
    tagName: release.tag_name,
    assetName: asset.name,
    assetSize: asset.size,
    downloadUrl: asset.browser_download_url,
  };
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

export function isNewerVersion(latestTag: string, currentVersion: string): boolean {
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

async function resolveOutputPath(output: string | undefined, assetName: string): Promise<string> {
  if (!output || !output.trim()) {
    return path.join(os.homedir(), 'Downloads', assetName);
  }

  const resolved = path.resolve(output);

  try {
    const stats = await fsPromises.stat(resolved);
    if (stats.isDirectory()) {
      return path.join(resolved, assetName);
    }
    return resolved;
  } catch {
    if (output.endsWith('\\') || output.endsWith('/') || output.endsWith(path.sep)) {
      return path.join(resolved, assetName);
    }

    // No extension usually means this is intended as a folder.
    if (!path.extname(resolved)) {
      return path.join(resolved, assetName);
    }

    return resolved;
  }
}

async function ensureOverwriteAllowed(
  outputPath: string,
  force: boolean,
  nonInteractive: boolean
): Promise<boolean> {
  try {
    const stats = await fsPromises.stat(outputPath);
    if (!stats.isFile()) {
      return true;
    }
  } catch {
    return true;
  }

  if (force) {
    return true;
  }

  if (nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Output file already exists: ${outputPath}. Use --force to overwrite.`);
  }

  const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
    {
      type: 'confirm',
      name: 'overwrite',
      message: `File already exists at "${outputPath}". Overwrite?`,
      default: false,
    },
  ]);

  return overwrite;
}

async function downloadWithProgress(
  url: string,
  outputPath: string,
  fallbackSize: number,
  redirectsLeft: number,
  showProgress: boolean
): Promise<void> {
  if (redirectsLeft < 0) {
    throw new Error('Too many redirects while downloading.');
  }

  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers: {
          'User-Agent': 'BlankDrive-CLI',
          'Accept': 'application/octet-stream',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          response.resume();
          const nextUrl = new URL(location, parsedUrl).toString();
          resolve(downloadWithProgress(nextUrl, outputPath, fallbackSize, redirectsLeft - 1, showProgress));
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Download failed with status ${status}.`));
          return;
        }

        const headerSize = Number(response.headers['content-length']);
        const totalBytes = Number.isFinite(headerSize) && headerSize > 0
          ? headerSize
          : Math.max(fallbackSize, 1);

        const progress = showProgress ? createProgressTracker('Downloading', totalBytes) : null;
        const stream = fs.createWriteStream(outputPath);
        let downloaded = 0;
        let finished = false;

        const fail = async (error: Error): Promise<void> => {
          if (finished) {
            return;
          }
          finished = true;
          if (progress) {
            progress.bar.stop();
          }
          stream.destroy();
          response.destroy();
          await fsPromises.unlink(outputPath).catch(() => {});
          reject(error);
        };

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (progress) {
            progress.setProgress(downloaded, totalBytes);
          }
        });

        response.on('error', (error) => {
          void fail(error);
        });

        stream.on('error', (error) => {
          void fail(error);
        });

        stream.on('finish', () => {
          if (finished) {
            return;
          }
          finished = true;
          if (progress) {
            progress.finish();
          }
          stream.close((closeError) => {
            if (closeError) {
              reject(closeError);
              return;
            }
            resolve();
          });
        });

        response.pipe(stream);
      }
    );

    request.on('error', (error) => {
      reject(error);
    });

    request.setTimeout(30000, () => {
      request.destroy(new Error('Download request timed out.'));
    });
  });
}

export async function downloadDesktopRelease(options: DesktopCommandOptions = {}): Promise<DesktopDownloadResult> {
  const requestedRelease = options.release || options.version;
  const info = await getDesktopReleaseInfo(requestedRelease, options.asset);
  const outputPath = await resolveOutputPath(options.output, info.assetName);
  const quiet = options.quiet === true;
  const nonInteractive = options.nonInteractive === true;

  const allowOverwrite = await ensureOverwriteAllowed(outputPath, options.force === true, nonInteractive);
  if (!allowOverwrite) {
    throw new Error('Download cancelled by user.');
  }

  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

  if (!quiet) {
    console.log('');
    console.log(chalk.gray(`  Release: ${info.tagName}`));
    console.log(chalk.gray(`  Asset:   ${info.assetName}`));
    console.log(chalk.gray(`  Size:    ${formatBytes(info.assetSize)}`));
    console.log(chalk.gray(`  Output:  ${outputPath}`));
    console.log('');
  }

  await downloadWithProgress(
    info.downloadUrl,
    outputPath,
    info.assetSize,
    MAX_REDIRECTS,
    !quiet
  );

  return {
    releaseTag: info.tagName,
    assetName: info.assetName,
    assetSize: info.assetSize,
    outputPath,
  };
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function launchDesktopInstaller(installerPath: string): Promise<void> {
  const resolvedPath = path.resolve(installerPath);

  if (process.platform === 'win32') {
    await spawnDetached('cmd', ['/c', 'start', '', resolvedPath]);
    return;
  }

  if (process.platform === 'darwin') {
    await spawnDetached('open', [resolvedPath]);
    return;
  }

  await spawnDetached('xdg-open', [resolvedPath]);
}

export async function desktopCommand(options: DesktopCommandOptions = {}): Promise<void> {
  const quiet = options.quiet === true;
  const installAfterDownload = options.install === true;

  if (!quiet) {
    console.log(chalk.bold('\n  Download BlankDrive Desktop\n'));
    console.log(chalk.gray('  Fetching release metadata...'));
  }

  try {
    const result = await downloadDesktopRelease(options);

    if (!quiet) {
      console.log('');
      console.log(chalk.green('  ✓ Desktop executable downloaded successfully!'));
      console.log(chalk.green(`  Saved to: ${result.outputPath}`));
    }

    if (installAfterDownload) {
      await launchDesktopInstaller(result.outputPath);
      if (!quiet) {
        console.log(chalk.green('  ✓ Installer launched.\n'));
      }
    } else if (!quiet) {
      console.log(chalk.gray('  Run the installer to launch BlankDrive Desktop.\n'));
    }
  } catch (error) {
    if (!quiet) {
      console.log('');
      console.log(chalk.red('  ✗ Failed to download desktop executable.'));
      if (error instanceof Error) {
        if (error.message === 'Download cancelled by user.') {
          console.log(chalk.yellow(`  ${error.message}`));
        } else {
          console.log(chalk.red(`  ${error.message}`));
        }
        if (error.message.toLowerCase().includes('api rate limit')) {
          console.log(chalk.gray('  Tip: set GITHUB_TOKEN to avoid anonymous GitHub API limits.'));
        }
      }
      console.log('');
      return;
    }

    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Desktop download failed.');
  }
}
