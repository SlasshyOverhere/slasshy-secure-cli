import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vaultMocks = vi.hoisted(() => ({
  initVault: vi.fn(),
  vaultExists: vi.fn(),
  isUnlocked: vi.fn(),
  getStats: vi.fn(),
  getVaultPaths: vi.fn(),
  addEntry: vi.fn(),
  addNoteEntry: vi.fn(),
  addFileEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getEntry: vi.fn(),
  getFileData: vi.fn(),
  getFileEntry: vi.fn(),
  getNoteEntry: vi.fn(),
  getVaultIndex: vi.fn(),
  listEntries: vi.fn(),
  lock: vi.fn(),
  toggleFavorite: vi.fn(),
  unlock: vi.fn(),
  updateEntry: vi.fn(),
  updateNoteEntry: vi.fn(),
}));

vi.mock('../src/storage/vault/index.js', () => vaultMocks);

import { startWebUiServer } from '../src/webui/server.js';

describe('Web UI unlock rate limiting', () => {
  let serverHandle: { url: string; close: () => Promise<void> } | null = null;
  let currentTime = 1_700_000_000_000;

  beforeEach(() => {
    vi.clearAllMocks();
    currentTime = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    vaultMocks.initVault.mockResolvedValue(undefined);
    vaultMocks.vaultExists.mockResolvedValue(true);
    vaultMocks.isUnlocked.mockReturnValue(false);
    vaultMocks.getStats.mockReturnValue({});
    vaultMocks.getVaultPaths.mockReturnValue({ dir: '/tmp/test' });
    vaultMocks.unlock.mockRejectedValue(new Error('Decryption failed: Invalid key or corrupted data'));
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = null;
    }
    vi.restoreAllMocks();
  });

  async function requestJson(path: string, body: unknown): Promise<Response> {
    if (!serverHandle) {
      serverHandle = await startWebUiServer({ port: 0 });
    }

    return fetch(`${serverHandle.url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BlankDrive-UI': '1',
      },
      body: JSON.stringify(body),
    });
  }

  it('returns 429 on the sixth bad unlock attempt within the rate-limit window', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await requestJson('/api/unlock', { password: 'bad-password' });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Invalid password.' });
    }

    const response = await requestJson('/api/unlock', { password: 'bad-password' });
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Too many unlock attempts. Please try again later.',
    });
  });

  it('allows unlock attempts again after the rate-limit window expires', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await requestJson('/api/unlock', { password: 'bad-password' });
    }

    const blocked = await requestJson('/api/unlock', { password: 'bad-password' });
    expect(blocked.status).toBe(429);

    currentTime += 60_001;

    const retried = await requestJson('/api/unlock', { password: 'bad-password' });
    expect(retried.status).toBe(401);
    await expect(retried.json()).resolves.toEqual({ error: 'Invalid password.' });
  });

  it('resets the failed-attempt counter after a successful unlock', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await requestJson('/api/unlock', { password: 'bad-password' });
      expect(response.status).toBe(401);
    }

    vaultMocks.unlock.mockResolvedValueOnce(undefined);

    const success = await requestJson('/api/unlock', { password: 'correct-password' });
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({
      unlocked: true,
      stats: {},
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await requestJson('/api/unlock', { password: 'bad-password' });
      expect(response.status).toBe(401);
    }

    const blocked = await requestJson('/api/unlock', { password: 'bad-password' });
    expect(blocked.status).toBe(429);
  });

  it('does not rate limit /api/init after repeated unlock failures', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await requestJson('/api/unlock', { password: 'bad-password' });
    }

    const blocked = await requestJson('/api/unlock', { password: 'bad-password' });
    expect(blocked.status).toBe(429);

    vaultMocks.vaultExists.mockResolvedValue(false);

    const initResponse = await requestJson('/api/init', { password: 'new-password' });
    expect(initResponse.status).toBe(201);
    await expect(initResponse.json()).resolves.toEqual({
      initialized: true,
      unlocked: true,
      stats: {},
    });
  });

  it('keeps internal unlock failures on the generic 500 path to prevent info leak', async () => {
    vaultMocks.unlock.mockRejectedValue(new Error('disk failure'));

    const response = await requestJson('/api/unlock', { password: 'correct-password' });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal Server Error' });
  });
});
