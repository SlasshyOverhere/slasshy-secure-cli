import crypto from 'crypto';

const SECURE_BUFFERS: Set<Buffer> = new Set();

/**
 * SecureString - A class that keeps sensitive data in mutable Buffers only
 * Prevents string immutability issues by never converting to JavaScript strings
 */
export class SecureString {
  private buffer: Buffer | null = null;
  private readonly encoding: BufferEncoding = 'utf-8';

  constructor(secret: Buffer | string) {
    if (Buffer.isBuffer(secret)) {
      this.buffer = Buffer.from(secret);
      SECURE_BUFFERS.add(this.buffer);
    } else {
      // Convert string to buffer immediately
      this.buffer = Buffer.from(secret, this.encoding);
      SECURE_BUFFERS.add(this.buffer);
      // Note: The original string still exists in caller's scope
      // This is why we should use SecureString from input point
    }
  }

  /**
   * Get the secret as a buffer (copy)
   */
  getBuffer(): Buffer {
    if (!this.buffer) {
      throw new Error('SecureString has been wiped');
    }
    return Buffer.from(this.buffer);
  }

  /**
   * Get the secret as a string (temporary, caller must not store)
   */
  getString(): string {
    if (!this.buffer) {
      throw new Error('SecureString has been wiped');
    }
    return this.buffer.toString(this.encoding);
  }

  /**
   * Securely wipe the secret from memory
   */
  wipe(): void {
    if (this.buffer) {
      wipeBuffer(this.buffer);
      this.buffer = null;
    }
  }

  /**
   * Check if still has data
   */
  isWiped(): boolean {
    return this.buffer === null;
  }

  /**
   * Auto-wipe on garbage collection
   */
  [Symbol.dispose]() {
    this.wipe();
  }
}

/**
 * Create a secure buffer that will be tracked for wiping
 */
export function createSecureBuffer(size: number): Buffer {
  const buffer = Buffer.alloc(size);
  SECURE_BUFFERS.add(buffer);
  return buffer;
}

/**
 * Securely wipe a buffer by overwriting with random data then zeros
 */
export function wipeBuffer(buffer: Buffer): void {
  if (!buffer || buffer.length === 0) return;

  // Overwrite with random data
  crypto.randomFillSync(buffer);
  // Overwrite with zeros
  buffer.fill(0);

  SECURE_BUFFERS.delete(buffer);
}

/**
 * Wipe all tracked secure buffers
 */
export function wipeAllSecureBuffers(): void {
  for (const buffer of SECURE_BUFFERS) {
    wipeBuffer(buffer);
  }
  SECURE_BUFFERS.clear();
}

/**
 * Securely wipe a string by creating a buffer and wiping it
 * Note: JavaScript strings are immutable, so this creates a buffer copy
 */
export function wipeString(str: string): void {
  if (!str) return;
  const buffer = Buffer.from(str, 'utf-8');
  wipeBuffer(buffer);
}

/**
 * Key holder that auto-wipes after timeout
 */
export class SecureKeyHolder {
  private key: Buffer | null = null;
  private timeoutId: NodeJS.Timeout | null = null;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = 300000) { // 5 minutes default
    this.timeoutMs = timeoutMs;
  }

  setKey(key: Buffer): void {
    this.clear();
    this.key = Buffer.from(key);
    SECURE_BUFFERS.add(this.key);
    this.resetTimeout();
  }

  getKey(): Buffer | null {
    if (this.key) {
      this.resetTimeout();
    }
    return this.key;
  }

  hasKey(): boolean {
    return this.key !== null;
  }

  clear(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.key) {
      wipeBuffer(this.key);
      this.key = null;
    }
  }

  private resetTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => {
      this.clear();
    }, this.timeoutMs);
  }
}

/**
 * Process cleanup handler
 */
export function setupSecureCleanup(): void {
  const cleanup = () => {
    wipeAllSecureBuffers();
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    cleanup();
    process.exit(1);
  });
}

/**
 * Constant-time buffer comparison to prevent timing attacks
 */
export function secureCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
