// NOTE: Run this test file individually to avoid mock conflicts: bun test src/storage/drive/driveClient.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock googleapis
const listMock = mock(async (params: any) => {
  const { pageToken } = params || {};
  if (!pageToken) {
    return {
      data: {
        files: [{ id: "1", name: "file1" }],
        nextPageToken: "page2",
      },
    };
  } else if (pageToken === "page2") {
    return {
      data: {
        files: [{ id: "2", name: "file2" }],
        nextPageToken: undefined,
      },
    };
  }
  return { data: { files: [] } };
});

mock.module("googleapis", () => ({
  default: {
    google: {
      drive: () => ({
        files: {
          list: listMock,
        },
      }),
    },
  },
  google: {
    drive: () => ({
      files: {
        list: listMock,
      },
    }),
  },
}));

// Mock google-auth-library
mock.module("google-auth-library", () => ({
  OAuth2Client: class {
    setCredentials() {}
  },
}));

// Mock crypto-js
mock.module("crypto-js", () => ({
  default: {
    AES: { decrypt: () => ({ toString: () => "{}" }) },
    enc: { Utf8: {} },
  },
}));

// Mock crypto module
mock.module("../../crypto/index.js", () => ({
  encryptToPayload: () => "",
  decryptToString: () => JSON.stringify({ access_token: "mock", expiry_date: Date.now() + 10000 }),
  getMetadataKey: () => "",
  randomHex: () => "",
}));

// Mock fs/promises
mock.module("fs/promises", () => ({
  default: {
    readFile: mock(async () => "encrypted-data"),
    writeFile: mock(async () => {}),
    access: mock(async () => {}),
    mkdir: mock(async () => {}),
  },
}));

// Mock fs (sync)
mock.module("fs", () => ({
  default: {
    createReadStream: () => {},
    createWriteStream: () => {},
  },
  createReadStream: () => {},
  createWriteStream: () => {},
}));

describe("listAppDataFiles", () => {
  it("fetches all pages", async () => {
    // Dynamic import to use mocked deps
    const { authenticateDrive, listAppDataFiles } = await import("./driveClient.js");

    await authenticateDrive();

    const files = await listAppDataFiles();

    // Expect 2 files from 2 pages
    // Currently, listAppDataFiles does NOT handle pagination, so it should return only first page (1 file)
    // Wait, the test should fail asserting 2 vs 1.
    expect(files.length).toBe(2);
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
