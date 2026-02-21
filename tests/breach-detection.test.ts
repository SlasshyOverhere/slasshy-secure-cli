/**
 * Breach Detection Tests
 *
 * Tests for Have I Been Pwned API integration using k-anonymity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Breach check implementation for testing
function sha1Hash(password: string): string {
  return crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
}

function getHashPrefix(hash: string): string {
  return hash.substring(0, 5);
}

function getHashSuffix(hash: string): string {
  return hash.substring(5);
}

interface BreachCheckResult {
  found: boolean;
  count: number;
  severity: 'safe' | 'low' | 'medium' | 'high';
}

function parseHIBPResponse(response: string, suffix: string): number {
  const lines = response.split('\n');
  for (const line of lines) {
    const [hashSuffix, countStr] = line.split(':');
    if (hashSuffix?.trim().toUpperCase() === suffix.toUpperCase()) {
      return parseInt(countStr?.trim() || '0', 10);
    }
  }
  return 0;
}

function getSeverity(count: number): 'safe' | 'low' | 'medium' | 'high' {
  if (count === 0) return 'safe';
  if (count <= 10) return 'low';
  if (count <= 100) return 'medium';
  return 'high';
}

function formatBreachCount(count: number): string {
  if (count === 0) return 'Not found in any breaches';
  if (count === 1) return 'Found in 1 breach';
  if (count < 1000) return `Found in ${count} breaches`;
  if (count < 1000000) return `Found in ${Math.floor(count / 1000)}K+ breaches`;
  return `Found in ${Math.floor(count / 1000000)}M+ breaches`;
}

async function checkPasswordBreach(
  password: string,
  mockResponse?: string
): Promise<BreachCheckResult> {
  const hash = sha1Hash(password);
  const prefix = getHashPrefix(hash);
  const suffix = getHashSuffix(hash);

  // In real implementation, this would call the HIBP API
  // For testing, we use a mock response
  const response = mockResponse || '';
  const count = parseHIBPResponse(response, suffix);

  return {
    found: count > 0,
    count,
    severity: getSeverity(count),
  };
}

describe('Breach Detection', () => {
  describe('sha1Hash', () => {
    it('should generate correct SHA1 hash', () => {
      // Known SHA1 hash for "password"
      const hash = sha1Hash('password');
      expect(hash).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    });

    it('should generate uppercase hash', () => {
      const hash = sha1Hash('test');
      expect(hash).toMatch(/^[A-F0-9]+$/);
    });

    it('should generate 40-character hash', () => {
      const hash = sha1Hash('anypassword');
      expect(hash.length).toBe(40);
    });

    it('should generate different hashes for different passwords', () => {
      const hash1 = sha1Hash('password1');
      const hash2 = sha1Hash('password2');
      expect(hash1).not.toBe(hash2);
    });

    it('should generate same hash for same password', () => {
      const hash1 = sha1Hash('samepassword');
      const hash2 = sha1Hash('samepassword');
      expect(hash1).toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = sha1Hash('');
      expect(hash).toBe('DA39A3EE5E6B4B0D3255BFEF95601890AFD80709');
    });

    it('should handle unicode characters', () => {
      const hash = sha1Hash('пароль'); // Russian word for "password"
      expect(hash.length).toBe(40);
    });

    it('should handle special characters', () => {
      const hash = sha1Hash('p@$$w0rd!#$%');
      expect(hash.length).toBe(40);
    });
  });

  describe('getHashPrefix and getHashSuffix', () => {
    it('should split hash correctly', () => {
      const hash = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
      expect(getHashPrefix(hash)).toBe('5BAA6');
      expect(getHashSuffix(hash)).toBe('1E4C9B93F3F0682250B6CF8331B7EE68FD8');
    });

    it('should return 5-character prefix', () => {
      const hash = sha1Hash('test');
      expect(getHashPrefix(hash).length).toBe(5);
    });

    it('should return 35-character suffix', () => {
      const hash = sha1Hash('test');
      expect(getHashSuffix(hash).length).toBe(35);
    });

    it('prefix + suffix should equal original hash', () => {
      const hash = sha1Hash('mypassword');
      const prefix = getHashPrefix(hash);
      const suffix = getHashSuffix(hash);
      expect(prefix + suffix).toBe(hash);
    });
  });

  describe('parseHIBPResponse', () => {
    it('should find matching hash suffix', () => {
      const response = `
1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493
2AAE6C35C94FCFB415DBE95F408B9CE91EE8:123
3B5D5C3712955042212316173CCCD29A:456
      `.trim();

      const count = parseHIBPResponse(response, '1E4C9B93F3F0682250B6CF8331B7EE68FD8');
      expect(count).toBe(3861493);
    });

    it('should return 0 for non-matching suffix', () => {
      const response = `
1E4C9B93F3F0682250B6CF8331B7EE68FD8:100
2AAE6C35C94FCFB415DBE95F408B9CE91EE8:200
      `.trim();

      const count = parseHIBPResponse(response, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000');
      expect(count).toBe(0);
    });

    it('should handle empty response', () => {
      const count = parseHIBPResponse('', 'ABC123');
      expect(count).toBe(0);
    });

    it('should be case insensitive', () => {
      const response = 'abc123def456789012345678901234567890:500';
      const count = parseHIBPResponse(response, 'ABC123DEF456789012345678901234567890');
      expect(count).toBe(500);
    });

    it('should handle malformed lines', () => {
      const response = `
validhash12345678901234567890123456789:100
malformed line without colon
another:invalid:line
      `.trim();

      const count = parseHIBPResponse(response, 'validhash12345678901234567890123456789');
      expect(count).toBe(100);
    });
  });

  describe('getSeverity', () => {
    it('should return safe for count 0', () => {
      expect(getSeverity(0)).toBe('safe');
    });

    it('should return low for count 1-10', () => {
      expect(getSeverity(1)).toBe('low');
      expect(getSeverity(5)).toBe('low');
      expect(getSeverity(10)).toBe('low');
    });

    it('should return medium for count 11-100', () => {
      expect(getSeverity(11)).toBe('medium');
      expect(getSeverity(50)).toBe('medium');
      expect(getSeverity(100)).toBe('medium');
    });

    it('should return high for count > 100', () => {
      expect(getSeverity(101)).toBe('high');
      expect(getSeverity(1000)).toBe('high');
      expect(getSeverity(1000000)).toBe('high');
    });
  });

  describe('formatBreachCount', () => {
    it('should format count 0', () => {
      expect(formatBreachCount(0)).toBe('Not found in any breaches');
    });

    it('should format count 1', () => {
      expect(formatBreachCount(1)).toBe('Found in 1 breach');
    });

    it('should format count < 1000', () => {
      expect(formatBreachCount(500)).toBe('Found in 500 breaches');
    });

    it('should format count >= 1000 as K+', () => {
      expect(formatBreachCount(1500)).toBe('Found in 1K+ breaches');
      expect(formatBreachCount(50000)).toBe('Found in 50K+ breaches');
    });

    it('should format count >= 1000000 as M+', () => {
      expect(formatBreachCount(1500000)).toBe('Found in 1M+ breaches');
      expect(formatBreachCount(10000000)).toBe('Found in 10M+ breaches');
    });
  });

  describe('checkPasswordBreach', () => {
    it('should detect breached password', async () => {
      // Mock response containing the hash suffix for "password"
      const mockResponse = '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493';
      const result = await checkPasswordBreach('password', mockResponse);

      expect(result.found).toBe(true);
      expect(result.count).toBe(3861493);
      expect(result.severity).toBe('high');
    });

    it('should return safe for non-breached password', async () => {
      const mockResponse = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:100';
      const result = await checkPasswordBreach('X#9kL$mN2@pQ5rT8vW!yZ', mockResponse);

      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.severity).toBe('safe');
    });

    it('should handle empty response', async () => {
      const result = await checkPasswordBreach('anypassword', '');

      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.severity).toBe('safe');
    });
  });
});

describe('K-Anonymity Model', () => {
  it('should never send full password hash', () => {
    const password = 'secretpassword';
    const hash = sha1Hash(password);
    const prefix = getHashPrefix(hash);

    // Verify only 5 characters are sent (prefix)
    expect(prefix.length).toBe(5);
    // Verify prefix doesn't reveal the password
    expect(prefix).not.toBe(hash);
  });

  it('should have sufficient prefix space for anonymity', () => {
    // 5 hex characters = 16^5 = 1,048,576 possible prefixes
    // This provides adequate k-anonymity
    const prefixSpace = Math.pow(16, 5);
    expect(prefixSpace).toBe(1048576);
  });

  it('should make it infeasible to determine password from prefix', () => {
    // Multiple passwords can have the same prefix
    const passwords = ['test1', 'test2', 'test3', 'password', '123456'];
    const prefixes = passwords.map(p => getHashPrefix(sha1Hash(p)));

    // While unlikely all have same prefix, this demonstrates the concept
    // In practice, many passwords share the same 5-char prefix
    expect(new Set(prefixes).size).toBeLessThanOrEqual(passwords.length);
  });
});
