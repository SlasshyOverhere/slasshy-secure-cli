import chalk from 'chalk';
import { lock, isUnlocked } from '../../storage/vault/index.js';
import { disconnectDrive } from '../../storage/drive/index.js';
import { logAuditEvent, resetAuditState } from '../auditLog.js';

export async function lockCommand(): Promise<void> {
  if (!isUnlocked()) {
    console.log(chalk.yellow('\n  Vault is already locked.\n'));
    return;
  }

  // Log before locking (since we need the vault to be unlocked to encrypt the log)
  await logAuditEvent('vault_locked');

  lock();
  disconnectDrive();
  resetAuditState();

  console.log(chalk.green('\n  Vault locked. All keys cleared from memory.\n'));
}
