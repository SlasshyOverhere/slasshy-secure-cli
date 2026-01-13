import cliProgress from 'cli-progress';
import chalk from 'chalk';

/**
 * Format bytes to human readable string (KB, MB, GB)
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Create a progress bar for file operations
 */
export function createProgressBar(action: 'Uploading' | 'Downloading' | 'Encrypting' | 'Decrypting' | 'Syncing'): cliProgress.SingleBar {
  return new cliProgress.SingleBar({
    format: `  ${action} |${chalk.cyan('{bar}')}| {percentage}% | {transferred}/{total}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true,
  }, cliProgress.Presets.shades_classic);
}

/**
 * Create a multi-progress bar for batch operations
 */
export function createMultiProgressBar(): cliProgress.MultiBar {
  return new cliProgress.MultiBar({
    format: `  {name} |${chalk.cyan('{bar}')}| {percentage}% | {transferred}/{total}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true,
  }, cliProgress.Presets.shades_classic);
}

export interface ProgressTracker {
  bar: cliProgress.SingleBar;
  totalBytes: number;
  transferredBytes: number;
  update: (bytes: number) => void;
  finish: () => void;
}

/**
 * Create a progress tracker for file operations with byte tracking
 */
export function createProgressTracker(
  action: 'Uploading' | 'Downloading' | 'Encrypting' | 'Decrypting' | 'Syncing',
  totalBytes: number
): ProgressTracker {
  const bar = createProgressBar(action);

  bar.start(100, 0, {
    transferred: formatBytes(0),
    total: formatBytes(totalBytes),
  });

  let transferredBytes = 0;

  return {
    bar,
    totalBytes,
    transferredBytes,
    update(bytes: number) {
      transferredBytes += bytes;
      const percentage = Math.min(Math.round((transferredBytes / totalBytes) * 100), 100);
      bar.update(percentage, {
        transferred: formatBytes(transferredBytes),
        total: formatBytes(totalBytes),
      });
    },
    finish() {
      bar.update(100, {
        transferred: formatBytes(totalBytes),
        total: formatBytes(totalBytes),
      });
      bar.stop();
    },
  };
}

/**
 * Simulate progress for operations that don't have granular progress events
 * Useful for encryption/decryption which happens in memory
 */
export async function simulateProgress(
  action: 'Uploading' | 'Downloading' | 'Encrypting' | 'Decrypting' | 'Syncing',
  totalBytes: number,
  operation: () => Promise<void>,
  durationMs: number = 500
): Promise<void> {
  const tracker = createProgressTracker(action, totalBytes);

  const intervalMs = 50;
  const steps = Math.max(durationMs / intervalMs, 10);
  const bytesPerStep = totalBytes / steps;

  let completed = false;

  // Start the operation
  const operationPromise = operation().then(() => {
    completed = true;
  });

  // Simulate progress while operation runs
  let simulatedBytes = 0;
  while (!completed && simulatedBytes < totalBytes * 0.9) {
    await new Promise(r => setTimeout(r, intervalMs));
    const increment = Math.min(bytesPerStep, totalBytes * 0.9 - simulatedBytes);
    simulatedBytes += increment;
    tracker.update(increment);
  }

  // Wait for actual completion
  await operationPromise;

  // Complete the progress bar
  tracker.finish();
}
