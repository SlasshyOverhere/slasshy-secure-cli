import crypto from 'crypto';
import { generateIV } from './random.js';
import { secureCompare } from './memoryGuard.js';
import type { EncryptedData, EncryptedPayload } from '../types/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(
  plaintext: Buffer,
  key: Buffer,
  aad?: Buffer
): EncryptedData {
  const iv = generateIV();

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  if (aad) {
    cipher.setAAD(aad);
  }

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return { iv, ciphertext, authTag };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(
  encryptedData: EncryptedData,
  key: Buffer,
  aad?: Buffer
): Buffer {
  const { iv, ciphertext, authTag } = encryptedData;

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  if (aad) {
    decipher.setAAD(aad);
  }

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext;
  } catch (error) {
    throw new Error('Decryption failed: Invalid key or corrupted data');
  }
}

/**
 * Encrypt and serialize to Buffer payload (IV + Ciphertext + AuthTag)
 */
export function encryptToBuffer(
  plaintext: string | Buffer,
  key: Buffer,
  aad?: string
): Buffer {
  const plaintextBuffer = typeof plaintext === 'string'
    ? Buffer.from(plaintext, 'utf-8')
    : plaintext;

  const aadBuffer = aad ? Buffer.from(aad, 'utf-8') : undefined;
  const encrypted = encrypt(plaintextBuffer, key, aadBuffer);

  // Combine: IV (12) + Ciphertext + AuthTag (16)
  return Buffer.concat([
    encrypted.iv,
    encrypted.ciphertext,
    encrypted.authTag,
  ]);
}

/**
 * Decrypt from Buffer payload (IV + Ciphertext + AuthTag)
 */
export function decryptFromBuffer(
  combined: Buffer,
  key: Buffer,
  aad?: string
): Buffer {
  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted payload: too short');
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const aadBuffer = aad ? Buffer.from(aad, 'utf-8') : undefined;

  return decrypt({ iv, ciphertext, authTag }, key, aadBuffer);
}

/**
 * Encrypt and serialize to base64 payload
 */
export function encryptToPayload(
  plaintext: string | Buffer,
  key: Buffer,
  aad?: string
): string {
  return encryptToBuffer(plaintext, key, aad).toString('base64');
}

/**
 * Decrypt from base64 payload
 */
export function decryptFromPayload(
  payload: string,
  key: Buffer,
  aad?: string
): Buffer {
  const combined = Buffer.from(payload, 'base64');
  return decryptFromBuffer(combined, key, aad);
}

/**
 * Decrypt from base64 payload to string
 */
export function decryptToString(
  payload: string,
  key: Buffer,
  aad?: string
): string {
  return decryptFromPayload(payload, key, aad).toString('utf-8');
}

/**
 * Encrypt an object to JSON payload
 */
export function encryptObject<T>(
  obj: T,
  key: Buffer,
  aad?: string
): string {
  const json = JSON.stringify(obj);
  return encryptToPayload(json, key, aad);
}

/**
 * Decrypt JSON payload to object
 */
export function decryptObject<T>(
  payload: string,
  key: Buffer,
  aad?: string
): T {
  const json = decryptToString(payload, key, aad);
  return JSON.parse(json) as T;
}
