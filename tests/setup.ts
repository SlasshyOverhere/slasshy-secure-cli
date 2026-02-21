/**
 * Test Setup and Utilities
 *
 * Provides common test helpers, mocks, and setup for all test files.
 */

import { vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Test vault directory (isolated from real vault)
export const TEST_VAULT_DIR = path.join(os.tmpdir(), 'slasshy-test-vault-' + crypto.randomBytes(8).toString('hex'));
export const TEST_PASSWORD = 'TestPassword123!@#';
export const TEST_WEAK_PASSWORD = '123456';
export const TEST_STRONG_PASSWORD = 'X#9kL$mN2@pQ5rT8vW!yZ';

/**
 * Setup test environment
 */
export async function setupTestEnvironment(): Promise<void> {
  // Create test vault directory
  await fs.mkdir(TEST_VAULT_DIR, { recursive: true });
  await fs.mkdir(path.join(TEST_VAULT_DIR, 'entries'), { recursive: true });
  await fs.mkdir(path.join(TEST_VAULT_DIR, 'carriers'), { recursive: true });
}

/**
 * Cleanup test environment
 */
export async function cleanupTestEnvironment(): Promise<void> {
  try {
    await fs.rm(TEST_VAULT_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a mock entry for testing
 */
export function createMockEntry(overrides: Partial<MockEntry> = {}): MockEntry {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'password',
    title: 'Test Entry',
    username: 'testuser@example.com',
    password: 'TestPassword123!',
    url: 'https://example.com',
    notes: 'Test notes',
    favorite: false,
    category: 'test',
    created: now,
    modified: now,
    ...overrides,
  };
}

export interface MockEntry {
  id: string;
  type: string;
  title: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  favorite: boolean;
  category?: string;
  created: number;
  modified: number;
  totp?: {
    secret: string;
    issuer?: string;
    algorithm?: string;
    digits?: number;
    period?: number;
  };
}

/**
 * Create a mock note entry for testing
 */
export function createMockNote(overrides: Partial<MockNote> = {}): MockNote {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'note',
    title: 'Test Note',
    content: 'This is test note content.',
    favorite: false,
    created: now,
    modified: now,
    ...overrides,
  };
}

export interface MockNote {
  id: string;
  type: string;
  title: string;
  content: string;
  favorite: boolean;
  created: number;
  modified: number;
}

/**
 * Create a mock file entry for testing
 */
export function createMockFileEntry(overrides: Partial<MockFileEntry> = {}): MockFileEntry {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'file',
    title: 'Test File',
    originalName: 'test.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    checksum: crypto.randomBytes(32).toString('hex'),
    notes: 'Test file notes',
    favorite: false,
    created: now,
    modified: now,
    ...overrides,
  };
}

export interface MockFileEntry {
  id: string;
  type: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum: string;
  notes?: string;
  favorite: boolean;
  created: number;
  modified: number;
}

/**
 * Mock console for testing output
 */
export function createMockConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];

  return {
    log: vi.fn((...args: unknown[]) => logs.push(args.join(' '))),
    error: vi.fn((...args: unknown[]) => errors.push(args.join(' '))),
    warn: vi.fn((...args: unknown[]) => warns.push(args.join(' '))),
    clear: vi.fn(),
    getLogs: () => logs,
    getErrors: () => errors,
    getWarns: () => warns,
    reset: () => {
      logs.length = 0;
      errors.length = 0;
      warns.length = 0;
    },
  };
}

/**
 * Mock inquirer prompts
 */
export function mockInquirerPrompts(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((questions: Array<{ name: string }>) => {
    const result: Record<string, unknown> = {};
    for (const q of questions) {
      if (q.name in responses) {
        result[q.name] = responses[q.name];
      }
    }
    return Promise.resolve(result);
  });
}

/**
 * Wait for a specified time (for async tests)
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random string
 */
export function randomString(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Generate random email
 */
export function randomEmail(): string {
  return `test-${randomString(8)}@example.com`;
}

/**
 * Generate random URL
 */
export function randomUrl(): string {
  return `https://${randomString(8)}.example.com`;
}

/**
 * Assert that a function throws an error with a specific message
 */
export async function expectAsyncError(
  fn: () => Promise<unknown>,
  expectedMessage?: string | RegExp
): Promise<void> {
  let error: Error | null = null;
  try {
    await fn();
  } catch (e) {
    error = e as Error;
  }

  if (!error) {
    throw new Error('Expected function to throw an error');
  }

  if (expectedMessage) {
    if (typeof expectedMessage === 'string') {
      if (!error.message.includes(expectedMessage)) {
        throw new Error(`Expected error message to include "${expectedMessage}", got "${error.message}"`);
      }
    } else {
      if (!expectedMessage.test(error.message)) {
        throw new Error(`Expected error message to match ${expectedMessage}, got "${error.message}"`);
      }
    }
  }
}

/**
 * Create test TOTP secret
 */
export function createTestTOTPSecret(): string {
  // Base32 encoded secret for testing
  return 'JBSWY3DPEHPK3PXP';
}

/**
 * Freeze time for testing
 */
export function freezeTime(timestamp: number) {
  const originalNow = Date.now;
  vi.spyOn(Date, 'now').mockReturnValue(timestamp);

  return () => {
    vi.spyOn(Date, 'now').mockImplementation(originalNow);
  };
}

/**
 * Create a mock fetch response
 */
export function mockFetchResponse(data: unknown, options: { ok?: boolean; status?: number } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}
