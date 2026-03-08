import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsPromisesMock = vi.hoisted(() => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

const driveApiMock = vi.hoisted(() => ({
  files: {
    delete: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  default: fsPromisesMock,
}));

vi.mock('../src/crypto/index.js', () => ({
  decryptToString: vi.fn((value: string) => value),
  encryptToPayload: vi.fn((value: string) => value),
  getMetadataKey: vi.fn(() => Buffer.from('test-key')),
}));

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => driveApiMock),
  },
  drive_v3: {},
}));

vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    credentials: Record<string, unknown> = {};

    constructor(..._args: unknown[]) {}

    setCredentials = vi.fn((credentials: Record<string, unknown>) => {
      this.credentials = credentials;
    });

    refreshAccessToken = vi.fn();
  }

  return {
    OAuth2Client: MockOAuth2Client,
    CodeChallengeMethod: { S256: 'S256' },
  };
});

import {
  authenticateDrive,
  deleteFromAppData,
  disconnectDrive,
  setGoogleOAuthCredentialsForSession,
} from '../src/storage/drive/driveClient.js';

describe('deleteFromAppData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disconnectDrive();
    setGoogleOAuthCredentialsForSession('client-id', 'client-secret');
    fsPromisesMock.readFile.mockImplementation(async (filePath: string) => {
      if (String(filePath).includes('drive_token.enc')) {
        return JSON.stringify({
          access_token: 'test-access-token',
          expiry_date: Date.now() + 60_000,
        });
      }

      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  it('deletes appData files without a preliminary lookup', async () => {
    driveApiMock.files.delete.mockResolvedValue({});

    await authenticateDrive();
    await deleteFromAppData('file-123');

    expect(driveApiMock.files.delete).toHaveBeenCalledWith({ fileId: 'file-123' });
    expect(driveApiMock.files.get).not.toHaveBeenCalled();
  });

  it('maps delete-time 404 responses to not found', async () => {
    driveApiMock.files.delete.mockRejectedValue({
      response: {
        status: 404,
        data: {
          error: {
            code: 404,
            message: 'File not found',
          },
        },
      },
      message: 'File not found',
    });

    await authenticateDrive();

    await expect(deleteFromAppData('missing-file')).rejects.toThrow('not found');
    expect(driveApiMock.files.get).not.toHaveBeenCalled();
  });

  it('preserves detailed API error context for non-404 delete failures', async () => {
    const fileId = 'file-12345678901234567890';
    driveApiMock.files.delete.mockRejectedValue({
      response: {
        status: 500,
        data: {
          error: {
            code: 500,
            message: 'Drive backend exploded',
          },
        },
      },
      message: 'Internal Server Error',
    });

    await authenticateDrive();

    const error = await deleteFromAppData(fileId).then(
      () => null,
      (caughtError: unknown) => caughtError as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('Drive backend exploded');
    expect(error?.message).toContain('status: 500');
    expect(error?.message).toContain(`fileId: ${fileId.substring(0, 20)}...`);
    expect(driveApiMock.files.get).not.toHaveBeenCalled();
  });
});
