import { beforeEach, describe, expect, it, vi } from 'vitest';

const driveClientMocks = vi.hoisted(() => ({
  authenticateDrive: vi.fn(),
  isDriveConnected: vi.fn(),
  uploadToAppData: vi.fn(),
  downloadFromAppData: vi.fn(),
  downloadAppDataToBuffer: vi.fn(),
  deleteFromAppData: vi.fn(),
  listAppDataFiles: vi.fn(),
  hasAppDataAccess: vi.fn(),
}));

vi.mock('../src/storage/drive/driveClient.js', () => driveClientMocks);

import { deleteFileFromCloud } from '../src/storage/drive/fileSyncService.js';

describe('deleteFileFromCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveClientMocks.isDriveConnected.mockReturnValue(true);
  });

  it('ignores missing cloud chunks but reports other failures in chunk order', async () => {
    driveClientMocks.deleteFromAppData.mockImplementation(async (fileId: string) => {
      if (fileId === 'missing') {
        throw new Error('404 Not Found');
      }
      if (fileId === 'late-failure') {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('late failure');
      }
      if (fileId === 'early-failure') {
        throw new Error('early failure');
      }
    });

    await expect(
      deleteFileFromCloud('entry-1', [
        { chunkIndex: 2, driveFileId: 'late-failure', size: 1 },
        { chunkIndex: 0, driveFileId: 'missing', size: 1 },
        { chunkIndex: 1, driveFileId: 'early-failure', size: 1 },
      ]),
    ).rejects.toThrow(
      'Failed to delete some chunks from cloud: Chunk 1: early failure, Chunk 2: late failure',
    );
  });

  it('keeps deletion concurrency bounded to the shared parallel limit', async () => {
    let activeDeletes = 0;
    let maxActiveDeletes = 0;

    driveClientMocks.deleteFromAppData.mockImplementation(async () => {
      activeDeletes += 1;
      maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeDeletes -= 1;
    });

    await deleteFileFromCloud(
      'entry-2',
      Array.from({ length: 8 }, (_, chunkIndex) => ({
        chunkIndex,
        driveFileId: `chunk-${chunkIndex}`,
        size: 1,
      })),
    );
    expect(driveClientMocks.deleteFromAppData).toHaveBeenCalledTimes(8);
    expect(maxActiveDeletes).toBe(5);
  });
});
