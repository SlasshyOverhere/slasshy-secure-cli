/**
 * File Sync Service - Handles uploading/downloading encrypted file chunks to/from
 * Google Drive using the configured cloud mode (hidden appDataFolder or public BlankDrive folder)
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  authenticateDrive,
  isDriveConnected,
  uploadToAppData,
  downloadFromAppData,
  downloadAppDataToBuffer,
  deleteFromAppData,
  listAppDataFiles,
  hasAppDataAccess,
} from './driveClient.js';
import { decryptFromBuffer, decryptFromPayload } from '../../crypto/index.js';
import fsSync from 'fs';

// Use temp folder for encrypted chunks
const TEMP_FILES_DIR = path.join(process.env.TEMP || os.tmpdir(), 'slasshy_temp');

// Number of parallel uploads/downloads
const PARALLEL_LIMIT = 5;

/**
 * Initialize Drive client from persisted session when needed.
 */
async function ensureDriveAuthenticated(): Promise<void> {
  if (isDriveConnected()) {
    return;
  }
  await authenticateDrive();
}

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
 * Run tasks with limited parallelism
 */
async function runParallel<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onTaskComplete?: (completed: number, total: number, result: T) => void
): Promise<T[]> {
  const results: T[] = [];
  let completed = 0;
  let index = 0;

  async function runNext(): Promise<void> {
    if (index >= tasks.length) return;

    const currentIndex = index++;
    const task = tasks[currentIndex]!;

    const result = await task();
    results[currentIndex] = result;
    completed++;

    if (onTaskComplete) {
      onTaskComplete(completed, tasks.length, result);
    }

    await runNext();
  }

  // Start initial batch
  const workers = Array(Math.min(limit, tasks.length))
    .fill(null)
    .map(() => runNext());

  await Promise.all(workers);
  return results;
}

/**
 * Upload all encrypted chunks for a file entry to the configured cloud storage mode
 * Uses parallel uploads for speed
 */
export async function uploadFileToCloud(
  entryId: string,
  chunkCount: number,
  onProgress?: (chunksUploaded: number, totalChunks: number, bytesUploaded: number, totalBytes: number) => void
): Promise<CloudFileChunk[]> {
  await ensureDriveAuthenticated();

  // Calculate total size first (parallelized for performance)
  const chunkPaths = Array.from({ length: chunkCount }, (_, i) => {
    if (chunkCount === 1) {
      return path.join(TEMP_FILES_DIR, `${entryId}.bin`);
    }
    return path.join(TEMP_FILES_DIR, `${entryId}_${i}.bin`);
  });

  const chunkSizes = await Promise.all(
    chunkPaths.map(async (chunkPath) => {
      try {
        const stats = await fs.stat(chunkPath);
        return stats.size;
      } catch {
        return 0;
      }
    })
  );

  const totalBytes = chunkSizes.reduce((sum, size) => sum + size, 0);

  let bytesUploaded = 0;
  const existingFiles = await listAppDataFiles(`slasshy_${entryId}_chunk_`);
  const existingByName = new Map<string, string>();
  for (const file of existingFiles) {
    if (!file.name || !file.id) {
      continue;
    }
    existingByName.set(file.name, file.id);
  }

  // Create upload tasks
  const uploadTasks = Array.from({ length: chunkCount }, (_, i) => {
    return async (): Promise<CloudFileChunk> => {
      let chunkPath: string;
      if (chunkCount === 1) {
        chunkPath = path.join(TEMP_FILES_DIR, `${entryId}.bin`);
      } else {
        chunkPath = path.join(TEMP_FILES_DIR, `${entryId}_${i}.bin`);
      }

      const cloudFileName = `slasshy_${entryId}_chunk_${i}.bin`;

      // Check if already uploaded (idempotency)
      const existingId = existingByName.get(cloudFileName);
      if (existingId) {
        return {
          chunkIndex: i,
          driveFileId: existingId,
          size: chunkSizes[i] || 0,
        };
      }

      // Upload the chunk
      const driveFileId = await uploadToAppData(chunkPath, cloudFileName);

      return {
        chunkIndex: i,
        driveFileId,
        size: chunkSizes[i] || 0,
      };
    };
  });

  // Run uploads in parallel
  const chunks = await runParallel(uploadTasks, PARALLEL_LIMIT, (completed, total, result) => {
    bytesUploaded += result.size;
    if (onProgress) {
      onProgress(completed, total, bytesUploaded, totalBytes);
    }
  });

  return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/**
 * Download all encrypted chunks for a file entry from appDataFolder
 * Uses parallel downloads for speed
 */
export async function downloadFileFromCloud(
  entryId: string,
  cloudChunks: CloudFileChunk[],
  onProgress?: (chunksDownloaded: number, totalChunks: number, bytesDownloaded: number, totalBytes: number) => void
): Promise<void> {
  await ensureDriveAuthenticated();
  await fs.mkdir(TEMP_FILES_DIR, { recursive: true });

  const totalBytes = cloudChunks.reduce((sum, c) => sum + c.size, 0);
  let bytesDownloaded = 0;

  // Create download tasks
  const downloadTasks = cloudChunks.map((chunk) => {
    return async (): Promise<number> => {
      let localPath: string;
      if (cloudChunks.length === 1) {
        localPath = path.join(TEMP_FILES_DIR, `${entryId}.bin`);
      } else {
        localPath = path.join(TEMP_FILES_DIR, `${entryId}_${chunk.chunkIndex}.bin`);
      }

      // Check if already exists locally
      try {
        await fs.access(localPath);
        // File exists, skip download
        return chunk.size;
      } catch {
        // File doesn't exist, download it
      }

      await downloadFromAppData(chunk.driveFileId, localPath);
      return chunk.size;
    };
  });

  // Run downloads in parallel
  await runParallel(downloadTasks, PARALLEL_LIMIT, (completed, total, processedBytes) => {
    bytesDownloaded += processedBytes;
    if (onProgress) {
      onProgress(completed, total, bytesDownloaded, totalBytes);
    }
  });
}

/**
 * Delete all cloud chunks for a file entry
 */
export async function deleteFileFromCloud(
  entryId: string,
  cloudChunks: CloudFileChunk[]
): Promise<void> {
  await ensureDriveAuthenticated();
  const errors: string[] = [];

  for (const chunk of cloudChunks) {
    try {
      await deleteFromAppData(chunk.driveFileId);
    } catch (error) {
      // Only ignore 404 "file not found" errors (already deleted)
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('not found') || message.includes('404')) {
          // File already deleted, ignore
          continue;
        }
        errors.push(`Chunk ${chunk.chunkIndex}: ${error.message}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to delete some chunks from cloud: ${errors.join(', ')}`);
  }
}

/**
 * Check if a file entry has all chunks uploaded to cloud
 */
export async function isFileInCloud(entryId: string, chunkCount: number): Promise<boolean> {
  await ensureDriveAuthenticated();
  const files = await listAppDataFiles(`slasshy_${entryId}_chunk_`);
  const availableNames = new Set(files.map((file) => file.name).filter((name): name is string => !!name));

  for (let i = 0; i < chunkCount; i++) {
    const cloudFileName = `slasshy_${entryId}_chunk_${i}.bin`;
    if (!availableNames.has(cloudFileName)) {
      return false;
    }
  }
  return true;
}

/**
 * Get cloud storage usage (total bytes in appDataFolder)
 */
export async function getCloudStorageUsage(): Promise<{ fileCount: number; totalBytes: number }> {
  await ensureDriveAuthenticated();
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
  await ensureDriveAuthenticated();
  return hasAppDataAccess();
}

/**
 * Determine optimal parallelism based on available system RAM
 */
function getAdaptiveParallelism(): number {
  const freeMemory = os.freemem();
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;

  if (freeMemory > 2 * GB) {
    return 5; // High RAM: 5 parallel chunks (~100MB in memory)
  } else if (freeMemory > 512 * MB) {
    return 2; // Medium RAM: 2 parallel chunks (~40MB in memory)
  } else {
    return 1; // Low RAM: sequential (~20MB in memory)
  }
}

/**
 * Stream download from cloud directly to output file
 * Adaptive parallelism based on available RAM
 * No temp files - chunks are decrypted in memory and written directly
 */
export async function streamDownloadToFile(
  entryId: string,
  cloudChunks: CloudFileChunk[],
  outputPath: string,
  entryKey: Buffer,
  onProgress?: (bytesProcessed: number, totalBytes: number) => void
): Promise<void> {
  await ensureDriveAuthenticated();
  const totalBytes = cloudChunks.reduce((sum, c) => sum + c.size, 0);
  const parallelism = getAdaptiveParallelism();

  // Ensure output directory exists (skip if it's a drive root like D:\)
  const outputDir = path.dirname(outputPath);
  if (outputDir && outputDir !== outputPath && !outputDir.match(/^[A-Za-z]:[\\/]?$/)) {
    await fs.mkdir(outputDir, { recursive: true });
  }

  // Sort chunks by index to ensure correct order
  const sortedChunks = [...cloudChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const chunkCount = sortedChunks.length;

  // For sequential processing or single chunk, process in order
  if (parallelism === 1 || chunkCount === 1) {
    // Open file for writing
    const writeStream = fsSync.createWriteStream(outputPath);
    let bytesProcessed = 0;

    for (const chunk of sortedChunks) {
      // Download chunk to memory
      const encryptedPayload = await downloadAppDataToBuffer(chunk.driveFileId);

      // Decrypt chunk
      const aad = chunkCount === 1 ? entryId : `${entryId}_chunk_${chunk.chunkIndex}`;
      let decryptedData: Buffer;
      try {
        decryptedData = decryptFromBuffer(encryptedPayload, entryKey, aad);
      } catch {
        // Backward compatibility for legacy base64 payloads.
        decryptedData = decryptFromPayload(encryptedPayload.toString('utf-8'), entryKey, aad);
      }

      // Write to file
      writeStream.write(decryptedData);

      bytesProcessed += decryptedData.length;
      if (onProgress) {
        onProgress(bytesProcessed, totalBytes);
      }
    }

    // Close stream
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } else {
    // Parallel download with ordered writing
    // Download chunks in parallel, but write in order
    const downloadedChunks: Map<number, Buffer> = new Map();
    let nextChunkToWrite = 0;
    let bytesProcessed = 0;

    // Open file for writing
    const writeStream = fsSync.createWriteStream(outputPath);

    // Create a promise that resolves when all chunks are written
    const writeComplete = new Promise<void>((resolve, reject) => {
      const tryWriteNextChunks = () => {
        while (downloadedChunks.has(nextChunkToWrite)) {
          const data = downloadedChunks.get(nextChunkToWrite)!;
          writeStream.write(data);
          downloadedChunks.delete(nextChunkToWrite);
          bytesProcessed += data.length;
          if (onProgress) {
            onProgress(bytesProcessed, totalBytes);
          }
          nextChunkToWrite++;
        }

        if (nextChunkToWrite >= chunkCount) {
          writeStream.end((err: Error | null | undefined) => {
            if (err) reject(err);
            else resolve();
          });
        }
      };

      // Create download tasks
      const downloadTasks = sortedChunks.map((chunk) => {
        return async (): Promise<void> => {
          // Download chunk to memory
          const encryptedPayload = await downloadAppDataToBuffer(chunk.driveFileId);

          // Decrypt chunk
          const aad = chunkCount === 1 ? entryId : `${entryId}_chunk_${chunk.chunkIndex}`;
          let decryptedData: Buffer;
          try {
            decryptedData = decryptFromBuffer(encryptedPayload, entryKey, aad);
          } catch {
            // Backward compatibility for legacy base64 payloads.
            decryptedData = decryptFromPayload(encryptedPayload.toString('utf-8'), entryKey, aad);
          }

          // Store in map for ordered writing
          downloadedChunks.set(chunk.chunkIndex, decryptedData);

          // Try to write any ready chunks
          tryWriteNextChunks();
        };
      });

      // Run downloads in parallel with adaptive limit
      runParallel(downloadTasks, parallelism).catch(reject);
    });

    await writeComplete;
  }
}

/**
 * Get current adaptive parallelism level (for display purposes)
 */
export function getParallelismInfo(): { level: number; memoryMB: number } {
  const freeMemory = os.freemem();
  return {
    level: getAdaptiveParallelism(),
    memoryMB: Math.round(freeMemory / (1024 * 1024)),
  };
}
