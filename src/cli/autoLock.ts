import { lock, isUnlocked } from '../storage/vault/index.js';
import chalk from 'chalk';

// Default auto-lock timeout: 5 minutes (in milliseconds)
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Auto-lock state
let autoLockTimeout: NodeJS.Timeout | null = null;
let lastActivity: number = Date.now();
let timeoutMs: number = DEFAULT_TIMEOUT_MS;
let isEnabled: boolean = true;
let onLockCallback: (() => void) | null = null;

/**
 * Reset the auto-lock timer (call on any user activity)
 */
export function resetAutoLockTimer(): void {
  lastActivity = Date.now();

  if (autoLockTimeout) {
    clearTimeout(autoLockTimeout);
    autoLockTimeout = null;
  }

  if (isEnabled && isUnlocked()) {
    autoLockTimeout = setTimeout(() => {
      performAutoLock();
    }, timeoutMs);
  }
}

/**
 * Perform the auto-lock
 */
function performAutoLock(): void {
  if (isUnlocked()) {
    lock();
    console.log(chalk.yellow('\n\n  🔒 Vault auto-locked due to inactivity.\n'));
    console.log(chalk.gray('  Enter your password to unlock.\n'));

    if (onLockCallback) {
      onLockCallback();
    }
  }
  autoLockTimeout = null;
}

/**
 * Start the auto-lock timer
 */
export function startAutoLockTimer(callback?: () => void): void {
  if (callback) {
    onLockCallback = callback;
  }
  resetAutoLockTimer();
}

/**
 * Stop the auto-lock timer
 */
export function stopAutoLockTimer(): void {
  if (autoLockTimeout) {
    clearTimeout(autoLockTimeout);
    autoLockTimeout = null;
  }
}

/**
 * Set the auto-lock timeout duration
 * @param minutes Timeout in minutes (0 to disable)
 */
export function setAutoLockTimeout(minutes: number): void {
  if (minutes <= 0) {
    isEnabled = false;
    stopAutoLockTimer();
  } else {
    isEnabled = true;
    timeoutMs = minutes * 60 * 1000;
    resetAutoLockTimer();
  }
}

/**
 * Get the current auto-lock settings
 */
export function getAutoLockSettings(): { enabled: boolean; timeoutMinutes: number; lastActivity: number } {
  return {
    enabled: isEnabled,
    timeoutMinutes: timeoutMs / 60000,
    lastActivity,
  };
}

/**
 * Enable auto-lock
 */
export function enableAutoLock(): void {
  isEnabled = true;
  resetAutoLockTimer();
}

/**
 * Disable auto-lock
 */
export function disableAutoLock(): void {
  isEnabled = false;
  stopAutoLockTimer();
}

/**
 * Check if auto-lock is enabled
 */
export function isAutoLockEnabled(): boolean {
  return isEnabled;
}

/**
 * Get time remaining before auto-lock (in seconds)
 */
export function getTimeRemaining(): number | null {
  if (!isEnabled || !autoLockTimeout) {
    return null;
  }

  const elapsed = Date.now() - lastActivity;
  const remaining = Math.max(0, timeoutMs - elapsed);
  return Math.ceil(remaining / 1000);
}

/**
 * Format time remaining for display
 */
export function formatTimeRemaining(): string {
  const seconds = getTimeRemaining();
  if (seconds === null) {
    return 'Auto-lock disabled';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}
