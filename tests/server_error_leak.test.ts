import { describe, it, expect, vi, afterEach } from 'vitest';
import { startWebUiServer } from '../src/webui/server.js';

// Mock the vault module
vi.mock('../src/storage/vault/index.js', () => {
  return {
    initVault: vi.fn().mockRejectedValue(new Error('DATABASE_PASSWORD=secret_leak')),
    vaultExists: vi.fn().mockResolvedValue(false), // Allow init to proceed
    isUnlocked: vi.fn().mockReturnValue(true),
    getStats: vi.fn().mockReturnValue({}),
    getVaultPaths: vi.fn().mockReturnValue({ dir: '/tmp/test' }),
    // Mock other exports used by server.ts if necessary, but these should be enough for /api/init
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
  };
});

describe('Web UI Error Handling', () => {
  let serverHandle: { url: string; close: () => Promise<void> } | null = null;

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = null;
    }
    vi.restoreAllMocks();
  });

  it('should NOT leak internal error details (fix verified)', async () => {
    // Start server on random port
    serverHandle = await startWebUiServer({ port: 0 });
    const port = new URL(serverHandle.url).port;

    // Send request that triggers the mocked error
    const response = await fetch(`http://localhost:${port}/api/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BlankDrive-UI': '1', // Required header
      },
      body: JSON.stringify({ password: 'test' }),
    });

    const body = await response.json();

    expect(response.status).toBe(500);
    // Expect generic error message
    expect(body).toEqual({ error: 'Internal Server Error' });
  });
});
