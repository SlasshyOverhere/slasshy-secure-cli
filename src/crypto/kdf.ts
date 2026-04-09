import argon2 from 'argon2';
import crypto from 'crypto';
import { generateSalt } from './random.js';
import { wipeBuffer } from './memoryGuard.js';
import type { DerivedKeys, KdfParams } from '../types/index.js';
import { DEFAULT_KDF_PARAMS } from '../types/index.js';

/**
 * Derive master key from password using Argon2id with improved parameters
 */
export async function deriveKey(
  password: string | Buffer,
  salt: Buffer,
  params: KdfParams = DEFAULT_KDF_PARAMS
): Promise<Buffer> {
  // Use stronger parameters for better security
  const enhancedParams = {
    ...params,
    // Increase memory cost for better resistance to GPU attacks
    memoryCost: Math.max(params.memoryCost, 131072), // Minimum 128 MB
    // Increase parallelism for CPU hardness
    parallelism: Math.max(params.parallelism, 4),
  };

  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    salt,
    timeCost: enhancedParams.timeCost,
    memoryCost: enhancedParams.memoryCost,
    parallelism: enhancedParams.parallelism,
    hashLength: enhancedParams.hashLength,
    raw: true,
  });

  return hash;
}

/**
 * Derive sub-keys from master key using HKDF
 */
export function deriveSubKey(
  masterKey: Buffer,
  context: string,
  length: number = 32
): Buffer {
  const derived = crypto.hkdfSync(
    'sha256',
    masterKey,
    Buffer.alloc(0), // No salt for HKDF (already salted in Argon2)
    Buffer.from(context, 'utf-8'),
    length
  );
  return Buffer.from(derived);
}

/**
 * Derive all necessary keys from master password
 */
export async function deriveAllKeys(
  password: string,
  salt?: Buffer
): Promise<{ keys: DerivedKeys; salt: Buffer }> {
  const actualSalt = salt || generateSalt(32);

  const masterKey = await deriveKey(password, actualSalt);

  const keys: DerivedKeys = {
    masterKey,
    indexKey: deriveSubKey(masterKey, 'slasshy-index-key'),
    entryKey: deriveSubKey(masterKey, 'slasshy-entry-key'),
    metadataKey: deriveSubKey(masterKey, 'slasshy-metadata-key'),
  };

  return { keys, salt: actualSalt };
}

/**
 * Verify password against stored HMAC hash with constant-time comparison
 */
export async function verifyPassword(
  password: string | Buffer,
  salt: Buffer,
  expectedKeyHash: Buffer,
  context?: string
): Promise<boolean> {
  const masterKey = await deriveKey(password, salt);
  const keyHash = hashKey(masterKey, context);

  // Constant-time comparison prevents timing attacks
  const isValid = crypto.timingSafeEqual(keyHash, expectedKeyHash);

  // Securely wipe the derived key
  wipeBuffer(masterKey);

  return isValid;
}

/**
 * Create a secure verification hash using HMAC-SHA256 with context binding
 */
export function hashKey(key: Buffer, context?: string): Buffer {
  // Use HMAC to prevent rainbow table attacks and add domain separation
  const hmacKey = deriveSubKey(key, 'key-verification-context');
  const message = context || 'master-key-hash';
  return crypto.createHmac('sha256', hmacKey).update(message).digest();
}
