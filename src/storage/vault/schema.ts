import { z } from 'zod';

// Entry types
export const EntryType = z.enum(['password', 'file']);
export type EntryTypeEnum = z.infer<typeof EntryType>;

// Base entry schema for password entries
export const EntrySchema = z.object({
  id: z.string().uuid(),
  type: EntryType.default('password'),
  title: z.string().min(1).max(256),
  username: z.string().max(256).optional(),
  password: z.string().max(4096).optional(),
  url: z.string().url().max(2048).optional().or(z.literal('')),
  notes: z.string().max(65536).optional(),
  created: z.number().int().positive(),
  modified: z.number().int().positive(),
});

export type Entry = z.infer<typeof EntrySchema>;

// File entry schema
export const FileEntrySchema = z.object({
  id: z.string().uuid(),
  type: z.literal('file'),
  title: z.string().min(1).max(256),
  originalName: z.string().min(1).max(512),
  mimeType: z.string().max(256),
  size: z.number().int().nonnegative(),
  checksum: z.string(), // SHA-256 hash for integrity
  notes: z.string().max(65536).optional(),
  created: z.number().int().positive(),
  modified: z.number().int().positive(),
});

export type FileEntry = z.infer<typeof FileEntrySchema>;

// Cloud file chunk schema (for files stored in appDataFolder)
export const CloudChunkSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  driveFileId: z.string(),
  size: z.number().int().nonnegative(),
});

export type CloudChunk = z.infer<typeof CloudChunkSchema>;

// Vault index entry (encrypted reference)
export const IndexEntrySchema = z.object({
  titleEncrypted: z.string(),
  entryType: EntryType.default('password'), // password or file
  fragments: z.array(z.string()), // Drive file IDs or local file paths (for steganography)
  carrierType: z.enum(['png', 'jpg', 'decoy']),
  localPath: z.string().optional(), // Path to local carrier file
  fileSize: z.number().int().nonnegative().optional(), // For file entries
  mimeType: z.string().optional(), // For file entries
  chunkCount: z.number().int().nonnegative().optional(), // Number of chunks for large files
  // Cloud sync for file entries (hidden appDataFolder storage)
  cloudChunks: z.array(CloudChunkSchema).optional(), // Cloud storage chunk info
  cloudSyncStatus: z.enum(['pending', 'uploading', 'synced', 'error']).optional(),
  cloudSyncedAt: z.number().int().positive().optional(),
  created: z.number().int().positive(),
  modified: z.number().int().positive(),
});

export type IndexEntry = z.infer<typeof IndexEntrySchema>;

// Full vault index
export const VaultIndexSchema = z.object({
  version: z.string(),
  salt: z.string(), // Base64 encoded
  keyHash: z.string(), // Base64 encoded, for verification
  entries: z.record(z.string(), IndexEntrySchema),
  metadata: z.object({
    created: z.number().int().positive(),
    lastSync: z.number().int().positive().nullable(),
    entryCount: z.number().int().nonnegative(),
  }),
});

export type VaultIndex = z.infer<typeof VaultIndexSchema>;

// Vault configuration
export const VaultConfigSchema = z.object({
  vaultPath: z.string(),
  carriersPath: z.string(),
  autoLockTimeout: z.number().int().positive().default(300000), // 5 minutes
  autoSync: z.boolean().default(false),
  decoyRatio: z.number().int().nonnegative().default(2),
  preferredCarrier: z.enum(['png', 'jpg']).default('png'),
});

export type VaultConfig = z.infer<typeof VaultConfigSchema>;

// Create empty vault index
export function createEmptyIndex(salt: string, keyHash: string): VaultIndex {
  const now = Date.now();
  return {
    version: '1.0.0',
    salt,
    keyHash,
    entries: {},
    metadata: {
      created: now,
      lastSync: null,
      entryCount: 0,
    },
  };
}

// Create a new entry
export function createEntry(
  title: string,
  data: {
    username?: string;
    password?: string;
    url?: string;
    notes?: string;
  }
): Entry {
  const now = Date.now();
  const id = crypto.randomUUID();

  return EntrySchema.parse({
    id,
    type: 'password',
    title,
    username: data.username || undefined,
    password: data.password || undefined,
    url: data.url || undefined,
    notes: data.notes || undefined,
    created: now,
    modified: now,
  });
}

// Create a new file entry
export function createFileEntry(
  title: string,
  data: {
    originalName: string;
    mimeType: string;
    size: number;
    checksum: string;
    notes?: string;
  }
): FileEntry {
  const now = Date.now();
  const id = crypto.randomUUID();

  return FileEntrySchema.parse({
    id,
    type: 'file',
    title,
    originalName: data.originalName,
    mimeType: data.mimeType,
    size: data.size,
    checksum: data.checksum,
    notes: data.notes || undefined,
    created: now,
    modified: now,
  });
}

// Validate entry
export function validateEntry(entry: unknown): Entry {
  return EntrySchema.parse(entry);
}

// Validate file entry
export function validateFileEntry(entry: unknown): FileEntry {
  return FileEntrySchema.parse(entry);
}

// Validate vault index
export function validateVaultIndex(index: unknown): VaultIndex {
  return VaultIndexSchema.parse(index);
}
