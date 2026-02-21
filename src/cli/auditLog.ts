import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { getIndexKey, encryptToPayload, decryptToString } from '../crypto/index.js';
import { isUnlocked } from '../storage/vault/index.js';

const AUDIT_FILE = path.join(os.homedir(), '.slasshy', 'audit.enc');
const MAX_ENTRIES = 500;

/**
 * Audit event types
 */
export type AuditEventType =
  | 'vault_created'
  | 'vault_unlocked'
  | 'vault_unlocked_backup_code'
  | 'vault_locked'
  | 'vault_destroyed'
  | 'vault_2fa_enabled'
  | 'vault_2fa_disabled'
  | 'entry_created'
  | 'entry_accessed'
  | 'entry_updated'
  | 'entry_deleted'
  | 'password_copied'
  | 'password_viewed'
  | 'file_uploaded'
  | 'file_downloaded'
  | 'note_created'
  | 'note_accessed'
  | 'note_updated'
  | 'auth_google_connected'
  | 'auth_google_disconnected'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'failed_unlock_attempt'
  | 'failed_2fa_attempt';

/**
 * Audit log entry
 */
export interface AuditEntry {
  timestamp: number;
  event: AuditEventType;
  details?: string;
  entryId?: string;
  entryTitle?: string;
}

let auditEntries: AuditEntry[] = [];
let auditLoaded = false;

/**
 * Load audit log from encrypted file
 */
async function loadAuditLog(): Promise<void> {
  if (auditLoaded) return;

  try {
    const encryptedData = await fs.readFile(AUDIT_FILE, 'utf-8');

    if (isUnlocked()) {
      const indexKey = getIndexKey();
      const decrypted = decryptToString(encryptedData, indexKey);
      auditEntries = JSON.parse(decrypted);
    }

    auditLoaded = true;
  } catch {
    // No audit file yet or can't decrypt - start fresh
    auditEntries = [];
    auditLoaded = true;
  }
}

/**
 * Save audit log to encrypted file
 */
async function saveAuditLog(): Promise<void> {
  if (!isUnlocked()) {
    return; // Can't save if vault is locked
  }

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true, mode: 0o700 });

    // Trim to max entries
    if (auditEntries.length > MAX_ENTRIES) {
      auditEntries = auditEntries.slice(-MAX_ENTRIES);
    }

    const indexKey = getIndexKey();
    const encrypted = encryptToPayload(JSON.stringify(auditEntries), indexKey);
    await fs.writeFile(AUDIT_FILE, encrypted, { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Silently fail - audit log is not critical
  }
}

/**
 * Log an audit event
 */
export async function logAuditEvent(
  event: AuditEventType,
  options?: {
    details?: string;
    entryId?: string;
    entryTitle?: string;
  }
): Promise<void> {
  await loadAuditLog();

  const entry: AuditEntry = {
    timestamp: Date.now(),
    event,
    ...options,
  };

  auditEntries.push(entry);

  // Save immediately for security events
  await saveAuditLog();
}

/**
 * Get audit log entries
 */
export async function getAuditEntries(count?: number): Promise<AuditEntry[]> {
  await loadAuditLog();

  if (count) {
    return auditEntries.slice(-count);
  }

  return [...auditEntries];
}

/**
 * Format event type for display
 */
function formatEventType(event: AuditEventType): string {
  const icons: Record<AuditEventType, string> = {
    vault_created: '🔒',
    vault_unlocked: '🔓',
    vault_unlocked_backup_code: '🔓',
    vault_locked: '🔒',
    vault_destroyed: '💥',
    vault_2fa_enabled: '🛡️',
    vault_2fa_disabled: '⚠️',
    entry_created: '➕',
    entry_accessed: '👁️',
    entry_updated: '✏️',
    entry_deleted: '🗑️',
    password_copied: '📋',
    password_viewed: '👀',
    file_uploaded: '📤',
    file_downloaded: '📥',
    note_created: '📝',
    note_accessed: '📖',
    note_updated: '✏️',
    auth_google_connected: '🔗',
    auth_google_disconnected: '🔌',
    sync_started: '🔄',
    sync_completed: '✅',
    sync_failed: '❌',
    failed_unlock_attempt: '🚫',
    failed_2fa_attempt: '🚫',
  };

  const names: Record<AuditEventType, string> = {
    vault_created: 'Vault Created',
    vault_unlocked: 'Vault Unlocked',
    vault_unlocked_backup_code: 'Unlocked (Backup Code)',
    vault_locked: 'Vault Locked',
    vault_destroyed: 'Vault Destroyed',
    vault_2fa_enabled: '2FA Enabled',
    vault_2fa_disabled: '2FA Disabled',
    entry_created: 'Entry Created',
    entry_accessed: 'Entry Accessed',
    entry_updated: 'Entry Updated',
    entry_deleted: 'Entry Deleted',
    password_copied: 'Password Copied',
    password_viewed: 'Password Viewed',
    file_uploaded: 'File Uploaded',
    file_downloaded: 'File Downloaded',
    note_created: 'Note Created',
    note_accessed: 'Note Accessed',
    note_updated: 'Note Updated',
    auth_google_connected: 'Google Connected',
    auth_google_disconnected: 'Google Disconnected',
    sync_started: 'Sync Started',
    sync_completed: 'Sync Completed',
    sync_failed: 'Sync Failed',
    failed_unlock_attempt: 'Failed Unlock',
    failed_2fa_attempt: 'Failed 2FA',
  };

  return `${icons[event]} ${names[event]}`;
}

/**
 * Display audit log
 */
export async function displayAuditLog(count?: number): Promise<void> {
  if (!isUnlocked()) {
    console.log(chalk.red('\n  Vault is locked. Unlock to view audit log.\n'));
    return;
  }

  const entries = await getAuditEntries(count || 30);

  if (entries.length === 0) {
    console.log(chalk.yellow('\n  No audit log entries yet.\n'));
    return;
  }

  console.log(chalk.bold(`\n  📜 Audit Log (last ${entries.length} events)\n`));
  console.log(chalk.gray('  ' + '─'.repeat(70)));

  entries.reverse().forEach((entry) => {
    const date = new Date(entry.timestamp);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString();
    const eventStr = formatEventType(entry.event);

    let line = `  ${chalk.gray(dateStr)} ${chalk.gray(timeStr)}  ${eventStr}`;

    if (entry.entryTitle) {
      line += chalk.cyan(` "${entry.entryTitle}"`);
    }

    if (entry.details) {
      line += chalk.gray(` - ${entry.details}`);
    }

    // Color code security-sensitive events
    if (entry.event === 'failed_unlock_attempt' || entry.event === 'vault_destroyed') {
      console.log(chalk.red(line));
    } else if (entry.event === 'password_copied' || entry.event === 'password_viewed') {
      console.log(chalk.yellow(line));
    } else {
      console.log(line);
    }
  });

  console.log(chalk.gray('  ' + '─'.repeat(70)));
  console.log(chalk.gray(`\n  Showing ${entries.length}/${auditEntries.length} total entries.\n`));
}

/**
 * Clear audit log (requires confirmation)
 */
export async function clearAuditLog(): Promise<void> {
  auditEntries = [];
  await saveAuditLog();
}

/**
 * Reset audit log state (for when vault is locked)
 */
export function resetAuditState(): void {
  auditEntries = [];
  auditLoaded = false;
}
