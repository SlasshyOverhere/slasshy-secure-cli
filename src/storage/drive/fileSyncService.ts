/**
 * File Sync Service - Handles uploading/downloading encrypted file chunks to/from
 * Google Drive's hidden appDataFolder (invisible to users in Drive UI)
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  uploadToAppData,
  downloadFromAppData,
  findAppDataFile,
  deleteFromAppData,
  listAppDataFiles,
  hasAppDataAccess,
} from './driveClient.js';

const VAULT_DIR = path.join(os.homedir(), '.slasshy');
const FILES_DIR = path.join(VAULT_DIR, 'files');

export interface CloudFileChunk {
  chunkIndex: number;
  driveFileId: string;
  size: number;
}

export interface CloudFileInfo {
  entryId: string;
  totalSize: number;
  chunkCount: number;
  chunks: CloudFileChunk[];
  uploadedAt: number;
}

/**
 * Upload all encrypted chunks for a file entry to the hidden appDataFolder
 */
export async function uploadFileToCloud(
  entryId: string,
  chunkCount: number,
  onProgress?: (chunksUploaded: number, totalChunks: number, bytesUploaded: number, totalBytes: number) => void
): Promise<CloudFileChunk[]> {
  const chunks: CloudFileChunk[] = [];
  let totalBytesUploaded = 0;

  // Calculate total size first
  let totalBytes = 0;
  for (let i = 0; i < chunkCount; i++) {
    const chunkPath = path.join(FILES_DIR, `${entryId}_${i}.bin`);
    try {
      const stats = await fs.stat(chunkPath);
      totalBytes += stats.size;
    } catch {
      // Try single file format
      if (i === 0 && chunkCount === 1) {
        const singlePath = path.join(FILES_DIR, `${entryId}.bin`);
        const stats = await fs.stat(singlePath);
        totalBytes = stats.size;
      }
    }
  }

  for (let i = 0; i < chunkCount; i++) {
    // Determine the local chunk path
    let chunkPath: string;
    if (chunkCount === 1) {
      // Single file (not chunked)
      chunkPath = path.join(FILES_DIR, `${entryId}.bin`);
    } else {
      // Chunked file
      chunkPath = path.join(FILES_DIR, `${entryId}_${i}.bin`);
    }

    // Check if already uploaded (idempotency)
    const cloudFileName = `slasshy_${entryId}_chunk_${i}.bin`;
    const existingId = await findAppDataFile(cloudFileName);

    if (existingId) {
      // Already uploaded, get size and continue
      const stats = await fs.stat(chunkPath);
      chunks.push({
        chunkIndex: i,
        driveFileId: existingId,
        size: stats.size,
      });
      totalBytesUploaded += stats.size;

      if (onProgress) {
        onProgress(i + 1, chunkCount, totalBytesUploaded, totalBytes);
      }
      continue;
    }

    // Upload the chunk
    const stats = await fs.stat(chunkPath);
    const driveFileId = await uploadToAppData(
      chunkPath,
      cloudFileName,
      (bytesUploaded, chunkTotalBytes) => {
        if (onProgress) {
          onProgress(i, chunkCount, totalBytesUploaded + bytesUploaded, totalBytes);
        }
      }
    );

    chunks.push({
      chunkIndex: i,
      driveFileId,
      size: stats.size,
    });

    totalBytesUploaded += stats.size;

    if (onProgress) {
      onProgress(i + 1, chunkCount, totalBytesUploaded, totalBytes);
    }
  }

  return chunks;
}

/**
 * Download all encrypted chunks for a file entry from appDataFolder
 */
export async function downloadFileFromCloud(
  entryId: string,
  cloudChunks: CloudFileChunk[],
  onProgress?: (chunksDownloaded: number, totalChunks: number, bytesDownloaded: number, totalBytes: number) => void
): Promise<void> {
  await fs.mkdir(FILES_DIR, { recursive: true });

  const totalBytes = cloudChunks.reduce((sum, c) => sum + c.size, 0);
  let totalBytesDownloaded = 0;

  for (let i = 0; i < cloudChunks.length; i++) {
    const chunk = cloudChunks[i]!;

    // Determine local path
    let localPath: string;
    if (cloudChunks.length === 1) {
      localPath = path.join(FILES_DIR, `${entryId}.bin`);
    } else {
      localPath = path.join(FILES_DIR, `${entryId}_${chunk.chunkIndex}.bin`);
    }

    // Check if already exists locally
    try {
      await fs.access(localPath);
      // File exists, skip download
      totalBytesDownloaded += chunk.size;
      if (onProgress) {
        onProgress(i + 1, cloudChunks.length, totalBytesDownloaded, totalBytes);
      }
      continue;
    } catch {
      // File doesn't exist, download it
    }

    await downloadFromAppData(
      chunk.driveFileId,
      localPath,
      (bytesDownloaded, chunkTotalBytes) => {
        if (onProgress) {
          onProgress(i, cloudChunks.length, totalBytesDownloaded + bytesDownloaded, totalBytes);
        }
      }
    );

    totalBytesDownloaded += chunk.size;

    if (onProgress) {
      onProgress(i + 1, cloudChunks.length, totalBytesDownloaded, totalBytes);
    }
  }
}

/**
 * Delete all cloud chunks for a file entry
 */
export async function deleteFileFromCloud(
  entryId: string,
  cloudChunks: CloudFileChunk[]
): Promise<void> {
  for (const chunk of cloudChunks) {
    try {
      await deleteFromAppData(chunk.driveFileId);
    } catch {
      // Ignore errors (file may already be deleted)
    }
  }
}

/**
 * Check if a file entry has all chunks uploaded to cloud
 */
export async function isFileInCloud(entryId: string, chunkCount: number): Promise<boolean> {
  for (let i = 0; i < chunkCount; i++) {
    const cloudFileName = `slasshy_${entryId}_chunk_${i}.bin`;
    const existingId = await findAppDataFile(cloudFileName);
    if (!existingId) {
      return false;
    }
  }
  return true;
}

/**
 * Get cloud storage usage (total bytes in appDataFolder)
 */
export async function getCloudStorageUsage(): Promise<{ fileCount: number; totalBytes: number }> {
  const files = await listAppDataFiles('slasshy_');

  let totalBytes = 0;
  for (const file of files) {
    totalBytes += parseInt(file.size || '0', 10);
  }

  return {
    fileCount: files.length,
    totalBytes,
  };
}

/**
 * Check if cloud sync is available (has appDataFolder access)
 */
export async function isCloudSyncAvailable(): Promise<boolean> {
  return hasAppDataAccess();
}
