import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  encryptObject,
  decryptObject,
  encryptToPayload,
  decryptToString,
  decryptFromPayload,
  createVault,
  unlockVault,
  lockVault,
  isVaultUnlocked,
  getIndexKey,
  getEntryKey,
  initializeKeyManager,
  generateUUID,
} from '../../crypto/index.js';
import {
  createEmptyIndex,
  createEntry,
  createFileEntry,
  validateEntry,
  validateFileEntry,
  validateVaultIndex,
  type Entry,
  type FileEntry,
  type VaultIndex,
  type IndexEntry,
} from './schema.js';

const VAULT_DIR = path.join(os.homedir(), '.slasshy');
const INDEX_FILE = 'vault.enc';
const CARRIERS_DIR = 'carriers';
const CONFIG_FILE = 'config.json';

let vaultIndex: VaultIndex | null = null;

/**
 * Ensure vault directory exists
 */
async function ensureVaultDir(): Promise<void> {
  await fs.mkdir(VAULT_DIR, { recursive: true });
  await fs.mkdir(path.join(VAULT_DIR, CARRIERS_DIR), { recursive: true });
}

/**
 * Get vault paths
 */
export function getVaultPaths() {
  return {
    dir: VAULT_DIR,
    index: path.join(VAULT_DIR, INDEX_FILE),
    carriers: path.join(VAULT_DIR, CARRIERS_DIR),
    config: path.join(VAULT_DIR, CONFIG_FILE),
  };
}

/**
 * Check if vault exists
 */
export async function vaultExists(): Promise<boolean> {
  try {
    await fs.access(path.join(VAULT_DIR, INDEX_FILE));
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize a new vault
 */
export async function initVault(password: string): Promise<void> {
  if (await vaultExists()) {
    throw new Error('Vault already exists. Use unlock instead.');
  }

  await ensureVaultDir();
  initializeKeyManager();

  const { salt, keyHash } = await createVault(password);

  vaultIndex = createEmptyIndex(
    salt.toString('base64'),
    keyHash.toString('base64')
  );

  await saveIndex();
}

/**
 * Save the encrypted index to disk
 */
async function saveIndex(): Promise<void> {
  if (!vaultIndex) {
    throw new Error('No vault index loaded');
  }

  const indexKey = getIndexKey();
  const encryptedIndex = encryptObject(vaultIndex, indexKey);

  await fs.writeFile(
    path.join(VAULT_DIR, INDEX_FILE),
    encryptedIndex,
    'utf-8'
  );
}

/**
 * Load and decrypt the index from disk
 */
async function loadIndex(password: string): Promise<VaultIndex> {
  const encryptedIndex = await fs.readFile(
    path.join(VAULT_DIR, INDEX_FILE),
    'utf-8'
  );

  // First, we need to extract salt from a minimal parse
  // The index is encrypted, so we store salt in a header
  const headerEnd = encryptedIndex.indexOf('|');
  if (headerEnd === -1) {
    // Old format - salt is inside encrypted data
    // We need a bootstrap approach
    throw new Error('Invalid vault format');
  }

  const salt = Buffer.from(encryptedIndex.substring(0, headerEnd), 'base64');
  const encryptedData = encryptedIndex.substring(headerEnd + 1);

  await unlockVault(password, salt);

  const indexKey = getIndexKey();
  const decrypted = decryptObject<VaultIndex>(encryptedData, indexKey);

  return validateVaultIndex(decrypted);
}

/**
 * Initialize vault with proper header format
 */
export async function initVaultWithHeader(password: string): Promise<void> {
  if (await vaultExists()) {
    throw new Error('Vault already exists. Use unlock instead.');
  }

  await ensureVaultDir();
  initializeKeyManager();

  const { salt, keyHash } = await createVault(password);

  vaultIndex = createEmptyIndex(
    salt.toString('base64'),
    keyHash.toString('base64')
  );

  // Save with header format: SALT_BASE64|ENCRYPTED_INDEX
  const indexKey = getIndexKey();
  const encryptedIndex = encryptObject(vaultIndex, indexKey);
  const fileContent = `${salt.toString('base64')}|${encryptedIndex}`;

  await fs.writeFile(
    path.join(VAULT_DIR, INDEX_FILE),
    fileContent,
    'utf-8'
  );
}

/**
 * Unlock existing vault
 */
export async function unlock(password: string): Promise<void> {
  if (!await vaultExists()) {
    throw new Error('No vault found. Use init to create one.');
  }

  initializeKeyManager();
  vaultIndex = await loadIndex(password);
}

/**
 * Lock the vault
 */
export function lock(): void {
  lockVault();
  vaultIndex = null;
}

/**
 * Check if vault is currently unlocked
 */
export function isUnlocked(): boolean {
  return isVaultUnlocked() && vaultIndex !== null;
}

/**
 * Add a new entry to the vault
 */
export async function addEntry(
  title: string,
  data: {
    username?: string;
    password?: string;
    url?: string;
    notes?: string;
  }
): Promise<Entry> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const entry = createEntry(title, data);
  const entryKey = getEntryKey();
  const indexKey = getIndexKey();

  // Encrypt the full entry data
  const encryptedEntry = encryptObject(entry, entryKey, entry.id);

  // Encrypt title for index
  const encryptedTitle = encryptToPayload(title, indexKey);

  // Create index entry
  const indexEntry: IndexEntry = {
    titleEncrypted: encryptedTitle,
    entryType: 'password',
    fragments: [], // Will be populated when syncing to Drive
    carrierType: 'png',
    localPath: undefined,
    created: entry.created,
    modified: entry.modified,
  };

  // Store encrypted entry locally
  const entryPath = path.join(VAULT_DIR, 'entries', `${entry.id}.enc`);
  await fs.mkdir(path.join(VAULT_DIR, 'entries'), { recursive: true });
  await fs.writeFile(entryPath, encryptedEntry, 'utf-8');

  // Update index
  vaultIndex.entries[entry.id] = indexEntry;
  vaultIndex.metadata.entryCount++;
  vaultIndex.metadata.lastSync = null; // Mark as needs sync

  await saveIndexWithHeader();

  return entry;
}

/**
 * Save index with header format
 */
async function saveIndexWithHeader(): Promise<void> {
  if (!vaultIndex) {
    throw new Error('No vault index loaded');
  }

  const indexKey = getIndexKey();
  const encryptedIndex = encryptObject(vaultIndex, indexKey);
  const fileContent = `${vaultIndex.salt}|${encryptedIndex}`;

  await fs.writeFile(
    path.join(VAULT_DIR, INDEX_FILE),
    fileContent,
    'utf-8'
  );
}

/**
 * Get an entry by ID
 */
export async function getEntry(id: string): Promise<Entry | null> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  if (!vaultIndex.entries[id]) {
    return null;
  }

  const entryPath = path.join(VAULT_DIR, 'entries', `${id}.enc`);

  try {
    const encryptedEntry = await fs.readFile(entryPath, 'utf-8');
    const entryKey = getEntryKey();
    const entry = decryptObject<Entry>(encryptedEntry, entryKey, id);
    return validateEntry(entry);
  } catch {
    return null;
  }
}

/**
 * Search entries by title
 */
export async function searchEntries(query: string): Promise<Entry[]> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const results: Entry[] = [];
  const indexKey = getIndexKey();
  const queryLower = query.toLowerCase();

  for (const [id, indexEntry] of Object.entries(vaultIndex.entries)) {
    try {
      const title = decryptToString(indexEntry.titleEncrypted, indexKey);
      if (title.toLowerCase().includes(queryLower)) {
        const entry = await getEntry(id);
        if (entry) {
          results.push(entry);
        }
      }
    } catch {
      // Skip entries that fail to decrypt
    }
  }

  return results;
}

/**
 * List all entries (titles only for performance)
 */
export async function listEntries(): Promise<Array<{ id: string; title: string; modified: number }>> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const results: Array<{ id: string; title: string; modified: number }> = [];
  const indexKey = getIndexKey();

  for (const [id, indexEntry] of Object.entries(vaultIndex.entries)) {
    try {
      const title = decryptToString(indexEntry.titleEncrypted, indexKey);
      results.push({
        id,
        title,
        modified: indexEntry.modified,
      });
    } catch {
      // Skip entries that fail to decrypt
    }
  }

  return results.sort((a, b) => b.modified - a.modified);
}

/**
 * Update an entry
 */
export async function updateEntry(
  id: string,
  updates: Partial<Omit<Entry, 'id' | 'created'>>
): Promise<Entry | null> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const existing = await getEntry(id);
  if (!existing) {
    return null;
  }

  const updated: Entry = {
    ...existing,
    ...updates,
    modified: Date.now(),
  };

  const entryKey = getEntryKey();
  const indexKey = getIndexKey();

  // Re-encrypt entry
  const encryptedEntry = encryptObject(updated, entryKey, id);
  const entryPath = path.join(VAULT_DIR, 'entries', `${id}.enc`);
  await fs.writeFile(entryPath, encryptedEntry, 'utf-8');

  // Update index if title changed
  if (updates.title) {
    vaultIndex.entries[id]!.titleEncrypted = encryptToPayload(updates.title, indexKey);
  }
  vaultIndex.entries[id]!.modified = updated.modified;

  await saveIndexWithHeader();

  return updated;
}

/**
 * Delete an entry
 */
export async function deleteEntry(id: string): Promise<boolean> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  if (!vaultIndex.entries[id]) {
    return false;
  }

  // Delete encrypted entry file
  const entryPath = path.join(VAULT_DIR, 'entries', `${id}.enc`);
  try {
    await fs.unlink(entryPath);
  } catch {
    // File might not exist
  }

  // Remove from index
  delete vaultIndex.entries[id];
  vaultIndex.metadata.entryCount--;

  await saveIndexWithHeader();

  return true;
}

/**
 * Get vault stats
 */
export function getStats(): { entryCount: number; lastSync: number | null; created: number } | null {
  if (!vaultIndex) {
    return null;
  }

  return {
    entryCount: vaultIndex.metadata.entryCount,
    lastSync: vaultIndex.metadata.lastSync,
    created: vaultIndex.metadata.created,
  };
}

/**
 * Get current vault index (for sync operations)
 */
export function getVaultIndex(): VaultIndex | null {
  return vaultIndex;
}

/**
 * Update vault index (after sync)
 */
export async function updateVaultIndex(updates: Partial<VaultIndex['metadata']>): Promise<void> {
  if (!vaultIndex) {
    throw new Error('No vault loaded');
  }

  vaultIndex.metadata = { ...vaultIndex.metadata, ...updates };
  await saveIndexWithHeader();
}

/**
 * Calculate file checksum (SHA-256)
 */
function calculateChecksum(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Add a file entry to the vault
 */
export async function addFileEntry(
  title: string,
  filePath: string,
  notes?: string
): Promise<FileEntry> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  // Read file
  const fileData = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();

  // Determine MIME type
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
  };

  const mimeType = mimeTypes[ext] || 'application/octet-stream';
  const checksum = calculateChecksum(fileData);

  // Create file entry metadata
  const entry = createFileEntry(title, {
    originalName: fileName,
    mimeType,
    size: fileData.length,
    checksum,
    notes,
  });

  const entryKey = getEntryKey();
  const indexKey = getIndexKey();

  // Encrypt the file entry metadata
  const encryptedEntry = encryptObject(entry, entryKey, entry.id);

  // Encrypt the file data separately (as base64 payload)
  const encryptedFileData = encryptToPayload(fileData, entryKey, entry.id);

  // Create index entry
  const indexEntry: IndexEntry = {
    titleEncrypted: encryptToPayload(title, indexKey),
    entryType: 'file',
    fragments: [],
    carrierType: 'png',
    localPath: undefined,
    fileSize: fileData.length,
    mimeType,
    created: entry.created,
    modified: entry.modified,
  };

  // Store encrypted entry metadata
  const entryPath = path.join(VAULT_DIR, 'entries', `${entry.id}.enc`);
  await fs.mkdir(path.join(VAULT_DIR, 'entries'), { recursive: true });
  await fs.writeFile(entryPath, encryptedEntry, 'utf-8');

  // Store encrypted file data
  const filesDir = path.join(VAULT_DIR, 'files');
  await fs.mkdir(filesDir, { recursive: true });
  const fileDataPath = path.join(filesDir, `${entry.id}.bin`);
  await fs.writeFile(fileDataPath, encryptedFileData, 'utf-8');

  // Update index
  vaultIndex.entries[entry.id] = indexEntry;
  vaultIndex.metadata.entryCount++;
  vaultIndex.metadata.lastSync = null;

  await saveIndexWithHeader();

  return entry;
}

/**
 * Get a file entry by ID
 */
export async function getFileEntry(id: string): Promise<FileEntry | null> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const indexEntry = vaultIndex.entries[id];
  if (!indexEntry || indexEntry.entryType !== 'file') {
    return null;
  }

  const entryPath = path.join(VAULT_DIR, 'entries', `${id}.enc`);

  try {
    const encryptedEntry = await fs.readFile(entryPath, 'utf-8');
    const entryKey = getEntryKey();
    const entry = decryptObject<FileEntry>(encryptedEntry, entryKey, id);
    return validateFileEntry(entry);
  } catch {
    return null;
  }
}

/**
 * Get the decrypted file data by entry ID
 */
export async function getFileData(id: string): Promise<Buffer | null> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const indexEntry = vaultIndex.entries[id];
  if (!indexEntry || indexEntry.entryType !== 'file') {
    return null;
  }

  const fileDataPath = path.join(VAULT_DIR, 'files', `${id}.bin`);

  try {
    const encryptedData = await fs.readFile(fileDataPath, 'utf-8');
    const entryKey = getEntryKey();
    return decryptFromPayload(encryptedData, entryKey, id);
  } catch {
    return null;
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
