import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  encryptObject,
  decryptObject,
  encryptToBuffer,
  encryptToPayload,
  decryptFromBuffer,
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
  validateNoteEntry,
  createNoteEntry,
  validateVaultIndex,
  type Entry,
  type FileEntry,
  type NoteEntry,
  type VaultIndex,
  type IndexEntry,
  type Vault2FAConfig,
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
    category?: string;
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
    category: data.category, // Include category in index
    favorite: false,
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
export async function listEntries(): Promise<Array<{ id: string; title: string; modified: number; favorite: boolean; entryType: string; category?: string }>> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const results: Array<{ id: string; title: string; modified: number; favorite: boolean; entryType: string; category?: string }> = [];
  const indexKey = getIndexKey();

  for (const [id, indexEntry] of Object.entries(vaultIndex.entries)) {
    try {
      const title = decryptToString(indexEntry.titleEncrypted, indexKey);
      results.push({
        id,
        title,
        modified: indexEntry.modified,
        favorite: indexEntry.favorite || false,
        entryType: indexEntry.entryType || 'password',
        category: indexEntry.category,
      });
    } catch {
      // Skip entries that fail to decrypt
    }
  }

  // Sort: favorites first, then by modified date
  return results.sort((a, b) => {
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    return b.modified - a.modified;
  });
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
  // Update index favorite status
  if (updates.favorite !== undefined) {
    vaultIndex.entries[id]!.favorite = updates.favorite;
  }
  // Update index category
  if (updates.category !== undefined) {
    vaultIndex.entries[id]!.category = updates.category || undefined;
  }
  vaultIndex.entries[id]!.modified = updated.modified;

  await saveIndexWithHeader();

  return updated;
}

/**
 * Toggle favorite status of an entry
 */
export async function toggleFavorite(id: string): Promise<{ favorite: boolean } | null> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const indexEntry = vaultIndex.entries[id];
  if (!indexEntry) {
    return null;
  }

  // Toggle the favorite status
  const newFavoriteStatus = !indexEntry.favorite;

  // Update the full entry if it exists
  const entry = await getEntry(id);
  if (entry) {
    await updateEntry(id, { favorite: newFavoriteStatus });
  } else {
    // For file entries or if entry doesn't exist, just update the index
    indexEntry.favorite = newFavoriteStatus;
    indexEntry.modified = Date.now();
    await saveIndexWithHeader();
  }

  return { favorite: newFavoriteStatus };
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
 * Get vault 2FA configuration
 */
export function getVault2FAConfig(): Vault2FAConfig | undefined {
  if (!vaultIndex) {
    return undefined;
  }
  return vaultIndex.vault2fa;
}

/**
 * Check if vault 2FA is enabled
 */
export function isVault2FAEnabled(): boolean {
  return vaultIndex?.vault2fa?.enabled === true;
}

/**
 * Set vault 2FA configuration
 */
export async function setVault2FAConfig(config: Vault2FAConfig | undefined): Promise<void> {
  if (!vaultIndex) {
    throw new Error('No vault loaded');
  }

  vaultIndex.vault2fa = config;
  await saveIndexWithHeader();
}

/**
 * Use a backup code (removes it from the list after use)
 */
export async function useBackupCode(codeIndex: number): Promise<void> {
  if (!vaultIndex?.vault2fa?.backupCodes) {
    throw new Error('No backup codes available');
  }

  // Remove the used backup code
  vaultIndex.vault2fa.backupCodes.splice(codeIndex, 1);
  await saveIndexWithHeader();
}

/**
 * Calculate file checksum (SHA-256)
 */
function calculateChecksum(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Calculate file checksum from stream (SHA-256)
 */
async function calculateChecksumFromFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Chunk size for large files (20MB to stay well under string limits)
const CHUNK_SIZE = 20 * 1024 * 1024;

// Use temp folder for encrypted chunks (deleted after cloud upload)
const TEMP_FILES_DIR = path.join(process.env.TEMP || os.tmpdir(), 'slasshy_temp');

/**
 * Get the temp files directory path
 */
export function getTempFilesDir(): string {
  return TEMP_FILES_DIR;
}

/**
 * Clean up temp files for an entry
 */
export async function cleanupTempFiles(entryId: string, chunkCount: number): Promise<void> {
  try {
    if (chunkCount === 1) {
      await fs.unlink(path.join(TEMP_FILES_DIR, `${entryId}.bin`)).catch(() => {});
    } else {
      for (let i = 0; i < chunkCount; i++) {
        await fs.unlink(path.join(TEMP_FILES_DIR, `${entryId}_${i}.bin`)).catch(() => {});
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Add a file entry to the vault (supports large files via chunking)
 * Files are encrypted to temp folder for cloud upload
 */
export async function addFileEntry(
  title: string,
  filePath: string,
  notes?: string,
  onProgress?: (bytesProcessed: number, totalBytes: number) => void
): Promise<FileEntry> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const stats = await fs.stat(filePath);
  const fileSize = stats.size;
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

  // Calculate checksum using streaming to avoid memory issues
  const checksum = await calculateChecksumFromFile(filePath);

  // Create file entry metadata
  const entry = createFileEntry(title, {
    originalName: fileName,
    mimeType,
    size: fileSize,
    checksum,
    notes,
  });

  const entryKey = getEntryKey();
  const indexKey = getIndexKey();

  // Encrypt the file entry metadata
  const encryptedEntry = encryptObject(entry, entryKey, entry.id);

  // Prepare directories - use temp folder for encrypted file data
  await fs.mkdir(path.join(VAULT_DIR, 'entries'), { recursive: true });
  await fs.mkdir(TEMP_FILES_DIR, { recursive: true });

  // Determine if we need chunking
  const needsChunking = fileSize > CHUNK_SIZE;
  const chunkCount = needsChunking ? Math.ceil(fileSize / CHUNK_SIZE) : 1;

  if (needsChunking) {
    // Process file in chunks for large files
    const fileHandle = await fs.open(filePath, 'r');
    let bytesProcessed = 0;

    try {
      for (let i = 0; i < chunkCount; i++) {
        const chunkBuffer = Buffer.alloc(Math.min(CHUNK_SIZE, fileSize - bytesProcessed));
        await fileHandle.read(chunkBuffer, 0, chunkBuffer.length, bytesProcessed);

        // Encrypt this chunk
        const encryptedChunk = encryptToBuffer(chunkBuffer, entryKey, `${entry.id}_chunk_${i}`);

        // Write chunk to temp folder as binary
        const chunkPath = path.join(TEMP_FILES_DIR, `${entry.id}_${i}.bin`);
        await fs.writeFile(chunkPath, encryptedChunk);

        bytesProcessed += chunkBuffer.length;
        if (onProgress) {
          onProgress(bytesProcessed, fileSize);
        }
      }
    } finally {
      await fileHandle.close();
    }
  } else {
    // Small file - use original approach
    const fileData = await fs.readFile(filePath);
    const encryptedFileData = encryptToBuffer(fileData, entryKey, entry.id);
    const fileDataPath = path.join(TEMP_FILES_DIR, `${entry.id}.bin`);
    await fs.writeFile(fileDataPath, encryptedFileData);

    if (onProgress) {
      onProgress(fileSize, fileSize);
    }
  }

  // Store encrypted entry metadata
  const entryPath = path.join(VAULT_DIR, 'entries', `${entry.id}.enc`);
  await fs.writeFile(entryPath, encryptedEntry, 'utf-8');

  // Create index entry
  const indexEntry: IndexEntry = {
    titleEncrypted: encryptToPayload(title, indexKey),
    entryType: 'file',
    fragments: [],
    carrierType: 'png',
    localPath: undefined,
    fileSize: fileSize,
    mimeType,
    chunkCount: needsChunking ? chunkCount : undefined,
    favorite: false,
    created: entry.created,
    modified: entry.modified,
  };

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
 * Add a new note entry to the vault
 */
export async function addNoteEntry(
  title: string,
  content: string,
  favorite?: boolean
): Promise<NoteEntry> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const entry = createNoteEntry(title, content, favorite);
  const entryKey = getEntryKey();
  const indexKey = getIndexKey();

  // Encrypt the note entry
  const encryptedEntry = encryptObject(entry, entryKey, entry.id);

  // Store encrypted entry
  const entryPath = path.join(VAULT_DIR, 'entries', `${entry.id}.enc`);
  await fs.mkdir(path.join(VAULT_DIR, 'entries'), { recursive: true });
  await fs.writeFile(entryPath, encryptedEntry, 'utf-8');

  // Create index entry
  const indexEntry: IndexEntry = {
    titleEncrypted: encryptToPayload(title, indexKey),
    entryType: 'note',
    fragments: [],
    carrierType: 'png',
    localPath: undefined,
    favorite: favorite || false,
    created: entry.created,
    modified: entry.modified,
  };

  // Update index
  vaultIndex.entries[entry.id] = indexEntry;
  vaultIndex.metadata.entryCount++;
  vaultIndex.metadata.lastSync = null;

  await saveIndexWithHeader();

  return entry;
}

/**
 * Get a note entry by ID
 */
export async function getNoteEntry(id: string): Promise<NoteEntry | null> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const indexEntry = vaultIndex.entries[id];
  if (!indexEntry || indexEntry.entryType !== 'note') {
    return null;
  }

  const entryPath = path.join(VAULT_DIR, 'entries', `${id}.enc`);

  try {
    const encryptedEntry = await fs.readFile(entryPath, 'utf-8');
    const entryKey = getEntryKey();
    const entry = decryptObject<NoteEntry>(encryptedEntry, entryKey, id);
    return validateNoteEntry(entry);
  } catch {
    return null;
  }
}

/**
 * Update a note entry
 */
export async function updateNoteEntry(
  id: string,
  updates: Partial<Omit<NoteEntry, 'id' | 'type' | 'created'>>
): Promise<NoteEntry | null> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const existing = await getNoteEntry(id);
  if (!existing) {
    return null;
  }

  const updated: NoteEntry = {
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
  // Update index favorite status
  if (updates.favorite !== undefined) {
    vaultIndex.entries[id]!.favorite = updates.favorite;
  }
  vaultIndex.entries[id]!.modified = updated.modified;

  await saveIndexWithHeader();

  return updated;
}

/**
 * Get the decrypted file data by entry ID (supports chunked files)
 */
export async function getFileData(
  id: string,
  onProgress?: (bytesProcessed: number, totalBytes: number) => void
): Promise<Buffer | null> {
  if (!isUnlocked() || !vaultIndex) {
    throw new Error('Vault is locked');
  }

  const indexEntry = vaultIndex.entries[id];
  if (!indexEntry || indexEntry.entryType !== 'file') {
    return null;
  }

  const entryKey = getEntryKey();
  const filesDir = TEMP_FILES_DIR;

  // Check if this is a chunked file
  if (indexEntry.chunkCount && indexEntry.chunkCount > 1) {
    // Reassemble chunked file
    const chunks: Buffer[] = [];
    let bytesProcessed = 0;
    const totalBytes = indexEntry.fileSize || 0;

    for (let i = 0; i < indexEntry.chunkCount; i++) {
      const chunkPath = path.join(filesDir, `${id}_${i}.bin`);

      // Check if chunk file exists
      try {
        await fs.access(chunkPath);
      } catch {
        throw new Error(`Missing chunk file ${i + 1}/${indexEntry.chunkCount}. File may be corrupted.`);
      }

      const encryptedChunk = await fs.readFile(chunkPath);
      let decryptedChunk: Buffer;
      try {
        decryptedChunk = decryptFromBuffer(encryptedChunk, entryKey, `${id}_chunk_${i}`);
      } catch {
        // Backward compatibility for legacy base64 chunk payloads.
        decryptedChunk = decryptFromPayload(encryptedChunk.toString('utf-8'), entryKey, `${id}_chunk_${i}`);
      }
      chunks.push(decryptedChunk);

      bytesProcessed += decryptedChunk.length;
      if (onProgress) {
        onProgress(bytesProcessed, totalBytes);
      }
    }

    return Buffer.concat(chunks);
  } else {
    // Single file (not chunked)
    const fileDataPath = path.join(filesDir, `${id}.bin`);

    // Check if file exists
    try {
      await fs.access(fileDataPath);
    } catch {
      throw new Error('Encrypted file data not found. File may have been deleted.');
    }

    const encryptedData = await fs.readFile(fileDataPath);
    let result: Buffer;
    try {
      result = decryptFromBuffer(encryptedData, entryKey, id);
    } catch {
      // Backward compatibility for legacy base64 payloads.
      result = decryptFromPayload(encryptedData.toString('utf-8'), entryKey, id);
    }

    if (onProgress && indexEntry.fileSize) {
      onProgress(indexEntry.fileSize, indexEntry.fileSize);
    }

    return result;
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
