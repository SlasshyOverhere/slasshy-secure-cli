// NOTE: Run this test file individually to avoid mock conflicts: bun test src/storage/drive/fileSyncService.test.ts
import { describe, it, expect, mock, beforeEach, beforeAll } from "bun:test";

// Mock ALL missing dependencies
mock.module("googleapis", () => ({ default: {} }));
mock.module("google-auth-library", () => ({ default: {} }));
mock.module("argon2", () => ({ default: {} }));
mock.module("crypto-js", () => ({ default: {} }));
mock.module("pngjs", () => ({ default: {} }));
mock.module("cli-progress", () => ({ default: {} }));
mock.module("ora", () => ({ default: {} }));
mock.module("inquirer", () => ({ default: {} }));
mock.module("chalk", () => ({ default: {} }));
mock.module("clipboardy", () => ({ default: {} }));
mock.module("uuid", () => ({ default: {} }));
mock.module("zod", () => ({ default: {} }));

// Mock fs if needed
mock.module("fs", () => ({ default: { promises: {} } }));

// Mock fs/promises
mock.module("fs/promises", () => ({
  default: {
    stat: mock(async () => ({ size: 1024 })),
    mkdir: mock(async () => {}),
  },
  stat: mock(async () => ({ size: 1024 })),
  mkdir: mock(async () => {}),
}));

// Mock driveClient
const findAppDataFileMock = mock(async () => null);
const uploadToAppDataMock = mock(async () => "mock-file-id");
const listAppDataFilesMock = mock(async () => []);
const hasAppDataAccessMock = mock(async () => true);
const downloadFromAppDataMock = mock(async () => {});
const downloadAppDataToBufferMock = mock(async () => Buffer.from([]));
const deleteFromAppDataMock = mock(async () => {});

mock.module("./driveClient.js", () => {
  return {
    findAppDataFile: findAppDataFileMock,
    uploadToAppData: uploadToAppDataMock,
    listAppDataFiles: listAppDataFilesMock,
    hasAppDataAccess: hasAppDataAccessMock,
    downloadFromAppData: downloadFromAppDataMock,
    downloadAppDataToBuffer: downloadAppDataToBufferMock,
    deleteFromAppData: deleteFromAppDataMock,
  };
});

describe("uploadFileToCloud", () => {
  beforeEach(() => {
    findAppDataFileMock.mockClear();
    uploadToAppDataMock.mockClear();
    listAppDataFilesMock.mockClear();
  });

  it("uses listAppDataFiles instead of findAppDataFile loop", async () => {
    const { uploadFileToCloud } = await import("./fileSyncService.js");
    const chunkCount = 5;

    // Mock listAppDataFiles to return empty list
    listAppDataFilesMock.mockResolvedValue([]);

    await uploadFileToCloud("test-entry", chunkCount);

    // Expect listAppDataFiles to be called ONCE
    expect(listAppDataFilesMock).toHaveBeenCalledTimes(1);

    // Expect findAppDataFile to NOT be called
    expect(findAppDataFileMock).toHaveBeenCalledTimes(0);

    // Since list returned empty, all chunks should be uploaded
    expect(uploadToAppDataMock).toHaveBeenCalledTimes(chunkCount);
  });
});
