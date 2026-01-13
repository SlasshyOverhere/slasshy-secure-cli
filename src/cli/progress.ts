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
 * Format speed (bytes per second)
 */
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

/**
 * Format time remaining
 */
function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export interface ProgressTracker {
  bar: cliProgress.SingleBar;
  totalBytes: number;
  transferredBytes: number;
  update: (bytes: number) => void;
  setProgress: (transferred: number, total: number) => void;
  finish: () => void;
}

/**
 * Create a progress tracker for file operations with byte tracking, speed, and ETA
 */
export function createProgressTracker(
  action: 'Uploading' | 'Downloading' | 'Encrypting' | 'Decrypting' | 'Syncing',
  totalBytes: number
): ProgressTracker {
  const bar = new cliProgress.SingleBar({
    format: `  ${action} |${chalk.cyan('{bar}')}| {percentage}% | {transferred}/{size} | {speed} | ETA: {eta}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: false,
  }, cliProgress.Presets.shades_classic);

  const startTime = Date.now();
  let transferredBytes = 0;
  let currentTotalBytes = totalBytes;
  let lastUpdateTime = startTime;
  let lastTransferredBytes = 0;
  let smoothSpeed = 0; // Smoothed speed for display

  bar.start(100, 0, {
    transferred: formatBytes(0),
    size: formatBytes(totalBytes),
    speed: '-- MB/s',
    eta: '--:--',
    percentage: 0,
  });

  const calculateSpeedAndETA = () => {
    const now = Date.now();
    const elapsedSinceStart = (now - startTime) / 1000; // seconds
    const elapsedSinceLastUpdate = (now - lastUpdateTime) / 1000;

    // Calculate instantaneous speed
    let instantSpeed = 0;
    if (elapsedSinceLastUpdate > 0.1) {
      instantSpeed = (transferredBytes - lastTransferredBytes) / elapsedSinceLastUpdate;
      lastUpdateTime = now;
      lastTransferredBytes = transferredBytes;
    }

    // Smooth the speed (exponential moving average)
    if (smoothSpeed === 0) {
      smoothSpeed = instantSpeed;
    } else if (instantSpeed > 0) {
      smoothSpeed = smoothSpeed * 0.7 + instantSpeed * 0.3;
    }

    // Use average speed for more stable display
    const avgSpeed = elapsedSinceStart > 0 ? transferredBytes / elapsedSinceStart : 0;
    const displaySpeed = smoothSpeed > 0 ? smoothSpeed : avgSpeed;

    // Calculate ETA
    const remainingBytes = currentTotalBytes - transferredBytes;
    const eta = displaySpeed > 0 ? remainingBytes / displaySpeed : 0;

    return { speed: displaySpeed, eta };
  };

  return {
    bar,
    totalBytes: currentTotalBytes,
    get transferredBytes() { return transferredBytes; },
    set transferredBytes(val) { transferredBytes = val; },

    update(bytes: number) {
      transferredBytes += bytes;
      transferredBytes = Math.min(transferredBytes, currentTotalBytes);
      const { speed, eta } = calculateSpeedAndETA();
      const percentage = Math.round((transferredBytes / currentTotalBytes) * 100);

      bar.update(percentage, {
        transferred: formatBytes(transferredBytes),
        size: formatBytes(currentTotalBytes),
        speed: formatSpeed(speed),
        eta: formatETA(eta),
        percentage,
      });
    },

    setProgress(transferred: number, total: number) {
      transferredBytes = transferred;
      if (total > 0) {
        currentTotalBytes = total;
      }
      const { speed, eta } = calculateSpeedAndETA();
      const percentage = Math.round((transferred / currentTotalBytes) * 100);

      bar.update(percentage, {
        transferred: formatBytes(transferred),
        size: formatBytes(currentTotalBytes),
        speed: formatSpeed(speed),
        eta: formatETA(eta),
        percentage,
      });
    },

    finish() {
      const elapsed = (Date.now() - startTime) / 1000;
      const avgSpeed = elapsed > 0 ? currentTotalBytes / elapsed : 0;

      bar.update(100, {
        transferred: formatBytes(currentTotalBytes),
        size: formatBytes(currentTotalBytes),
        speed: formatSpeed(avgSpeed),
        eta: '0s',
        percentage: 100,
      });
      bar.stop();
    },
  };
}

/**
 * Create a multi-progress bar for batch operations
 */
export function createMultiProgressBar(): cliProgress.MultiBar {
  return new cliProgress.MultiBar({
    format: `  {name} |${chalk.cyan('{bar}')}| {percentage}% | {transferred}/{total} | {speed}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true,
  }, cliProgress.Presets.shades_classic);
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
