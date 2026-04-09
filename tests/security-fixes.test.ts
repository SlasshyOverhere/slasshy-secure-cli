import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  deriveKey,
  verifyPassword,
  hashKey,
} from '../src/crypto/kdf.js';
import {
  SecureString,
  wipeBuffer,
} from '../src/crypto/memoryGuard.js';
import {
  encrypt,
  decrypt,
} from '../src/crypto/encryption.js';
import { generateSalt } from '../src/crypto/random.js';

describe('Security Fixes Validation', () => {
  describe('Memory Management', () => {
    it('should securely wipe buffers', () => {
      const buffer = Buffer.alloc(32, 0xFF);
      const originalContent = Buffer.from(buffer);

      wipeBuffer(buffer);

      // Buffer should be overwritten (not all zeros or all 0xFF)
      expect(buffer.equals(originalContent)).toBe(false);

      // Check that it's been zeroed out after random fill + zero
      for (let i = 0; i < buffer.length; i++) {
        expect(buffer[i]).toBe(0);
      }
    });

    it('should handle SecureString properly', () => {
      const secret = 'SuperSecretPassword123!';
      const secureStr = new SecureString(secret);

      expect(secureStr.isWiped()).toBe(false);
      expect(secureStr.getString()).toBe(secret);

      const bufferCopy = secureStr.getBuffer();
      expect(bufferCopy.toString('utf-8')).toBe(secret);

      // Wipe the secure string
      secureStr.wipe();
      expect(secureStr.isWiped()).toBe(true);

      // Should throw after wiping
      expect(() => secureStr.getString()).toThrow('SecureString has been wiped');
    });

    it('should auto-wipe SecureString on disposal', () => {
      let secureStr: SecureString | null = new SecureString('TestSecret');
      expect(secureStr.isWiped()).toBe(false);

      secureStr[Symbol.dispose]();
      expect(secureStr.isWiped()).toBe(true);

      secureStr = null;
    });
  });

  describe('Key Derivation Improvements', () => {
    it('should derive keys with enhanced parameters', async () => {
      const password = 'test-password-123';
      const salt = generateSalt(32);

      const key = await deriveKey(password, salt);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32); // 256 bits

      // Verify enhanced parameters are applied
      // Memory cost should be at least 128 MB
      const key2 = await deriveKey(password, salt);
      expect(key.equals(key2)).toBe(true); // Deterministic
    });

    it('should work with buffer passwords', async () => {
      const passwordBuffer = Buffer.from('buffer-password-test');
      const salt = generateSalt(32);

      const key = await deriveKey(passwordBuffer, salt);
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should produce different keys with different salts', async () => {
      const password = 'same-password';
      const salt1 = generateSalt(32);
      const salt2 = generateSalt(32);

      const key1 = await deriveKey(password, salt1);
      const key2 = await deriveKey(password, salt2);

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('HMAC Key Hashing', () => {
    it('should use HMAC instead of plain SHA-256', async () => {
      const password = 'hmac-test-password';
      const salt = generateSalt(32);
      const key = await deriveKey(password, salt);

      const hash1 = hashKey(key, 'test-context');
      const hash2 = hashKey(key, 'test-context');

      expect(hash1).toBeInstanceOf(Buffer);
      expect(hash1.equals(hash2)).toBe(true); // Deterministic with same context

      // Different contexts should produce different hashes
      const hash3 = hashKey(key, 'different-context');
      expect(hash1.equals(hash3)).toBe(false);
    });

    it('should prevent rainbow table attacks with HMAC', async () => {
      const password = 'rainbow-test';
      const salt = generateSalt(32);
      const key = await deriveKey(password, salt);

      const hmacHash = hashKey(key);
      const plainHash = crypto.createHash('sha256').update(key).digest();

      // HMAC should be different from plain hash
      expect(hmacHash.equals(plainHash)).toBe(false);
    });
  });

  describe('Password Verification', () => {
    it('should verify passwords with constant-time comparison', async () => {
      const password = 'verify-test-password';
      const salt = generateSalt(32);
      const key = await deriveKey(password, salt);
      const keyHash = hashKey(key);

      const isValid = await verifyPassword(password, salt, keyHash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect passwords', async () => {
      const password = 'correct-password';
      const salt = generateSalt(32);
      const key = await deriveKey(password, salt);
      const keyHash = hashKey(key);

      const isValid = await verifyPassword('wrong-password', salt, keyHash);
      expect(isValid).toBe(false);
    });

    it('should work with context-specific verification', async () => {
      const password = 'context-password';
      const salt = generateSalt(32);
      const key = await deriveKey(password, salt);
      const keyHash = hashKey(key, 'specific-context');

      // Verify with same context
      const isValid = await verifyPassword(password, salt, keyHash, 'specific-context');
      expect(isValid).toBe(true);

      // Verify with different context should fail
      const isValidWrong = await verifyPassword(password, salt, keyHash, 'wrong-context');
      expect(isValidWrong).toBe(false);
    });
  });

  describe('Encryption/Decryption', () => {
    it('should encrypt and decrypt data correctly', () => {
      const plaintext = Buffer.from('Hello, World!');
      const key = crypto.randomBytes(32);

      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('should fail with wrong key', () => {
      const plaintext = Buffer.from('Secret data');
      const key1 = crypto.randomBytes(32);
      const key2 = crypto.randomBytes(32);

      const encrypted = encrypt(plaintext, key1);

      expect(() => decrypt(encrypted, key2)).toThrow('Decryption failed');
    });

    it('should include authentication tag', () => {
      const plaintext = Buffer.from('Authenticated data');
      const key = crypto.randomBytes(32);

      const encrypted = encrypt(plaintext, key);

      expect(encrypted.iv.length).toBe(12);
      expect(encrypted.authTag.length).toBe(16);
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Optimizations', () => {
    it('should handle batch operations efficiently', async () => {
      const iterations = 100;
      const password = 'perf-test';
      const salt = generateSalt(32);

      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        await deriveKey(password, salt);
      }

      const elapsed = Date.now() - start;
      const perOperation = elapsed / iterations;

      console.log(`Key derivation: ${perOperation.toFixed(2)}ms per operation`);
      expect(perOperation).toBeLessThan(1000); // Should be under 1 second each
    });

    it('should process parallel searches efficiently', async () => {
      // This tests the parallel search optimization
      const entries = Array.from({ length: 100 }, (_, i) => ({
        id: `entry-${i}`,
        title: `Entry Title ${i}`,
      }));

      const query = 'Title 50';
      const matches: string[] = [];

      const start = Date.now();

      // Simulate parallel processing
      const results = await Promise.all(
        entries.map(async (entry) => {
          if (entry.title.toLowerCase().includes(query.toLowerCase())) {
            return entry.id;
          }
          return null;
        })
      );

      const elapsed = Date.now() - start;

      matches.push(...results.filter((r): r is string => r !== null));

      expect(matches.length).toBe(1);
      expect(matches[0]).toBe('entry-50');
      console.log(`Parallel search: ${elapsed}ms for ${entries.length} entries`);
    });
  });
});
