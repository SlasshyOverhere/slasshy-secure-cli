import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  uploadFile,
  downloadFile,
  deleteFile,
  listFiles,
  getOrCreateFolder,
  isDriveConnected,
  uploadToAppData,
  downloadFromAppData,
  findAppDataFile,
} from './driveClient.js';
import {
  getVaultIndex,
  updateVaultIndex,
  getEntry,
  getVaultPaths,
} from '../vault/index.js';
import { embedInPNG, extractFromPNG } from '../../steganography/index.js';
import {
  fragmentData,
  serializeFragment,
  deserializeFragment,
  reassembleFragments,
  generateFilename,
} from '../../obfuscation/index.js';
import { encryptObject, decryptObject, getEntryKey } from '../../crypto/index.js';
import { randomInt } from '../../crypto/random.js';

const BLANKDRIVE_FOLDER_NAME = 'Photos'; // Innocuous folder name
const DURESS_HASH_FILE = path.join(os.homedir(), '.slasshy', 'duress.hash');
const DURESS_HASH_CLOUD_NAME = 'slasshy_duress.hash';

interface SyncResult {
  uploaded: number;
  downloaded: number;
  deleted: number;
  errors: string[];
}

/**
 * Get or create the BlankDrive folder on Drive
 */
export async function getBlankDriveFolder(): Promise<string> {
  return getOrCreateFolder(BLANKDRIVE_FOLDER_NAME);
}

/**
 * Upload an entry to Google Drive (embedded in carrier images)
 */
export async function uploadEntry(
  entryId: string,
  carrierPaths: string[]
): Promise<string[]> {
  if (!isDriveConnected()) {
    throw new Error('Drive not connected');
  }

  const entry = await getEntry(entryId);
  if (!entry) {
    throw new Error(`Entry ${entryId} not found`);
  }

  const entryKey = getEntryKey();
  const encryptedEntry = encryptObject(entry, entryKey, entryId);
  const entryBuffer = Buffer.from(encryptedEntry, 'utf-8');

  // Fragment the data
  const fragments = fragmentData(entryBuffer);
  const { carriers } = getVaultPaths();

  if (fragments.length > carrierPaths.length) {
    throw new Error(
      `Not enough carrier images. Need ${fragments.length}, have ${carrierPaths.length}`
    );
  }

  const folderId = await getBlankDriveFolder();
  const driveFileIds: string[] = [];

  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]!;
    const carrierPath = carrierPaths[i]!;

    // Serialize fragment
    const serializedFragment = serializeFragment(fragment);

    // Generate output filename
    const outputFilename = generateFilename('png');
    const outputPath = path.join(carriers, outputFilename);

    // Embed in carrier
    await embedInPNG(carrierPath, serializedFragment, outputPath);

    // Random delay to avoid patterns (0-5 seconds)
    const delay = randomInt(0, 5000);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Upload to Drive
    const fileId = await uploadFile(outputPath, outputFilename, 'image/png', folderId);
    driveFileIds.push(fileId);

    // Clean up local carrier copy
    try {
      await fs.unlink(outputPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  return driveFileIds;
}

/**
 * Download and reconstruct an entry from Google Drive
 */
export async function downloadEntry(
  entryId: string,
  driveFileIds: string[]
): Promise<Buffer> {
  if (!isDriveConnected()) {
    throw new Error('Drive not connected');
  }

  const { carriers } = getVaultPaths();
  const fragments: ReturnType<typeof deserializeFragment>[] = [];

  for (const fileId of driveFileIds) {
    // Download file
    const tempPath = path.join(carriers, `temp_${fileId}.png`);
    await downloadFile(fileId, tempPath);

    // Extract data
    const { data } = await extractFromPNG(tempPath);
    const fragment = deserializeFragment(data);
    fragments.push(fragment);

    // Clean up temp file
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Reassemble fragments
  return reassembleFragments(fragments);
}

/**
 * Delete an entry from Google Drive
 */
export async function deleteEntryFromDrive(driveFileIds: string[]): Promise<void> {
  if (!isDriveConnected()) {
    throw new Error('Drive not connected');
  }

  for (const fileId of driveFileIds) {
    try {
      await deleteFile(fileId);
    } catch (error) {
      // Log but continue with other deletions
      console.error(`Failed to delete file ${fileId}:`, error);
    }
  }
}

/**
 * Sync local vault with Google Drive
 */
export async function syncWithDrive(): Promise<SyncResult> {
  if (!isDriveConnected()) {
    throw new Error('Drive not connected');
  }

  const result: SyncResult = {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    errors: [],
  };

  const vaultIndex = getVaultIndex();
  if (!vaultIndex) {
    throw new Error('Vault not loaded');
  }

  // Find entries that need to be uploaded (no fragments yet)
  for (const [entryId, indexEntry] of Object.entries(vaultIndex.entries)) {
    if (indexEntry.fragments.length === 0) {
      // This entry needs to be uploaded
      // For now, we skip - user needs to provide carrier images
      result.errors.push(`Entry ${entryId} has no carrier images assigned`);
    }
  }

  // Update sync timestamp
  await updateVaultIndex({ lastSync: Date.now() });

  return result;
}

/**
 * Get sync status
 */
export function getSyncStatus(): {
  connected: boolean;
  lastSync: number | null;
  pendingUploads: number;
} {
  const vaultIndex = getVaultIndex();

  let pendingUploads = 0;
  if (vaultIndex) {
    for (const indexEntry of Object.values(vaultIndex.entries)) {
      if (indexEntry.fragments.length === 0) {
        pendingUploads++;
      }
    }
  }

  return {
    connected: isDriveConnected(),
    lastSync: vaultIndex?.metadata.lastSync || null,
    pendingUploads,
  };
}

/**
 * Upload duress.hash file to cloud (appDataFolder)
 */
export async function uploadDuressHashToCloud(): Promise<boolean> {
  if (!isDriveConnected()) {
    return false;
  }

  try {
    await fs.access(DURESS_HASH_FILE);
    await uploadToAppData(DURESS_HASH_FILE, DURESS_HASH_CLOUD_NAME);
    return true;
  } catch {
    // File doesn't exist or upload failed
    return false;
  }
}

/**
 * Download duress.hash file from cloud
 */
export async function downloadDuressHashFromCloud(): Promise<boolean> {
  if (!isDriveConnected()) {
    return false;
  }

  try {
    const fileId = await findAppDataFile(DURESS_HASH_CLOUD_NAME);
    if (!fileId) {
      return false;
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(DURESS_HASH_FILE), { recursive: true });
    await downloadFromAppData(fileId, DURESS_HASH_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if duress.hash exists in cloud
 */
export async function isDuressHashInCloud(): Promise<boolean> {
  if (!isDriveConnected()) {
    return false;
  }

  try {
    const fileId = await findAppDataFile(DURESS_HASH_CLOUD_NAME);
    return !!fileId;
  } catch {
    return false;
  }
}

/**
 * Sync duress.hash - uploads local to cloud, or downloads from cloud if local doesn't exist
 */
export async function syncDuressHash(): Promise<'uploaded' | 'downloaded' | 'none' | 'error'> {
  if (!isDriveConnected()) {
    return 'error';
  }

  try {
    // Check if local file exists
    let localExists = false;
    try {
      await fs.access(DURESS_HASH_FILE);
      localExists = true;
    } catch {
      localExists = false;
    }

    // Check if cloud file exists
    const cloudExists = await isDuressHashInCloud();

    if (localExists && !cloudExists) {
      // Upload local to cloud
      await uploadDuressHashToCloud();
      return 'uploaded';
    } else if (!localExists && cloudExists) {
      // Download from cloud
      await downloadDuressHashFromCloud();
      return 'downloaded';
    } else if (localExists && cloudExists) {
      // Both exist - upload local (local is source of truth)
      await uploadDuressHashToCloud();
      return 'uploaded';
    }

    return 'none';
  } catch {
    return 'error';
  }
}
