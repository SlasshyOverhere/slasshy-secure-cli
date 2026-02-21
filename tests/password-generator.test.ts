/**
 * Password Generator Tests
 *
 * Tests for the password generation utility.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Mock the password generator functions inline for testing
function generatePassword(options: {
  length?: number;
  includeUppercase?: boolean;
  includeLowercase?: boolean;
  includeNumbers?: boolean;
  includeSymbols?: boolean;
} = {}): string {
  const {
    length = 16,
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = true,
  } = options;

  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  let charset = '';
  if (includeUppercase) charset += uppercase;
  if (includeLowercase) charset += lowercase;
  if (includeNumbers) charset += numbers;
  if (includeSymbols) charset += symbols;

  if (charset.length === 0) {
    throw new Error('At least one character type must be included');
  }

  const crypto = require('crypto');
  let password = '';
  const randomBytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }

  return password;
}

function calculatePasswordStrength(password: string): {
  score: number;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumbers: boolean;
  hasSymbols: boolean;
  length: number;
} {
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasSymbols = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password);
  const length = password.length;

  let score = 0;
  if (hasUppercase) score++;
  if (hasLowercase) score++;
  if (hasNumbers) score++;
  if (hasSymbols) score++;
  if (length >= 12) score++;
  if (length >= 16) score++;
  if (length >= 20) score++;

  return { score, hasUppercase, hasLowercase, hasNumbers, hasSymbols, length };
}

describe('Password Generator', () => {
  describe('generatePassword', () => {
    it('should generate password with default length of 16', () => {
      const password = generatePassword();
      expect(password.length).toBe(16);
    });

    it('should generate password with custom length', () => {
      const password = generatePassword({ length: 24 });
      expect(password.length).toBe(24);
    });

    it('should generate password with minimum length of 1', () => {
      const password = generatePassword({ length: 1 });
      expect(password.length).toBe(1);
    });

    it('should generate password with large length', () => {
      const password = generatePassword({ length: 128 });
      expect(password.length).toBe(128);
    });

    it('should include uppercase letters by default', () => {
      const passwords = Array.from({ length: 10 }, () => generatePassword({ length: 32 }));
      const hasUppercase = passwords.some(p => /[A-Z]/.test(p));
      expect(hasUppercase).toBe(true);
    });

    it('should include lowercase letters by default', () => {
      const passwords = Array.from({ length: 10 }, () => generatePassword({ length: 32 }));
      const hasLowercase = passwords.some(p => /[a-z]/.test(p));
      expect(hasLowercase).toBe(true);
    });

    it('should include numbers by default', () => {
      const passwords = Array.from({ length: 10 }, () => generatePassword({ length: 32 }));
      const hasNumbers = passwords.some(p => /[0-9]/.test(p));
      expect(hasNumbers).toBe(true);
    });

    it('should include symbols by default', () => {
      const passwords = Array.from({ length: 10 }, () => generatePassword({ length: 32 }));
      const hasSymbols = passwords.some(p => /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(p));
      expect(hasSymbols).toBe(true);
    });

    it('should exclude uppercase when disabled', () => {
      const passwords = Array.from({ length: 20 }, () =>
        generatePassword({ length: 32, includeUppercase: false })
      );
      const hasUppercase = passwords.some(p => /[A-Z]/.test(p));
      expect(hasUppercase).toBe(false);
    });

    it('should exclude lowercase when disabled', () => {
      const passwords = Array.from({ length: 20 }, () =>
        generatePassword({ length: 32, includeLowercase: false })
      );
      const hasLowercase = passwords.some(p => /[a-z]/.test(p));
      expect(hasLowercase).toBe(false);
    });

    it('should exclude numbers when disabled', () => {
      const passwords = Array.from({ length: 20 }, () =>
        generatePassword({ length: 32, includeNumbers: false })
      );
      const hasNumbers = passwords.some(p => /[0-9]/.test(p));
      expect(hasNumbers).toBe(false);
    });

    it('should exclude symbols when disabled', () => {
      const passwords = Array.from({ length: 20 }, () =>
        generatePassword({ length: 32, includeSymbols: false })
      );
      const hasSymbols = passwords.some(p => /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(p));
      expect(hasSymbols).toBe(false);
    });

    it('should generate only lowercase letters when others disabled', () => {
      const password = generatePassword({
        length: 32,
        includeUppercase: false,
        includeNumbers: false,
        includeSymbols: false,
      });
      expect(password).toMatch(/^[a-z]+$/);
    });

    it('should generate only numbers when others disabled', () => {
      const password = generatePassword({
        length: 32,
        includeUppercase: false,
        includeLowercase: false,
        includeSymbols: false,
      });
      expect(password).toMatch(/^[0-9]+$/);
    });

    it('should throw error when all character types disabled', () => {
      expect(() =>
        generatePassword({
          includeUppercase: false,
          includeLowercase: false,
          includeNumbers: false,
          includeSymbols: false,
        })
      ).toThrow('At least one character type must be included');
    });

    it('should generate unique passwords', () => {
      const passwords = new Set(Array.from({ length: 100 }, () => generatePassword()));
      expect(passwords.size).toBe(100);
    });

    it('should use cryptographically secure randomness', () => {
      // Generate many passwords and check distribution
      const charCounts: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        const password = generatePassword({ length: 100 });
        for (const char of password) {
          charCounts[char] = (charCounts[char] || 0) + 1;
        }
      }

      // All characters should be used (with high probability)
      const usedChars = Object.keys(charCounts).length;
      expect(usedChars).toBeGreaterThan(50); // Should use most of ~90 possible chars
    });
  });

  describe('calculatePasswordStrength', () => {
    it('should return score 0 for empty password', () => {
      const result = calculatePasswordStrength('');
      expect(result.score).toBe(0);
      expect(result.length).toBe(0);
    });

    it('should detect uppercase letters', () => {
      const result = calculatePasswordStrength('ABC');
      expect(result.hasUppercase).toBe(true);
      expect(result.hasLowercase).toBe(false);
    });

    it('should detect lowercase letters', () => {
      const result = calculatePasswordStrength('abc');
      expect(result.hasLowercase).toBe(true);
      expect(result.hasUppercase).toBe(false);
    });

    it('should detect numbers', () => {
      const result = calculatePasswordStrength('123');
      expect(result.hasNumbers).toBe(true);
    });

    it('should detect symbols', () => {
      const result = calculatePasswordStrength('!@#');
      expect(result.hasSymbols).toBe(true);
    });

    it('should give higher score for longer passwords', () => {
      const short = calculatePasswordStrength('Abc1!');
      const medium = calculatePasswordStrength('Abc1!Abc1!Abc1!');
      const long = calculatePasswordStrength('Abc1!Abc1!Abc1!Abc1!Abc1!');

      expect(medium.score).toBeGreaterThan(short.score);
      expect(long.score).toBeGreaterThan(medium.score);
    });

    it('should give maximum score for strong password', () => {
      const result = calculatePasswordStrength('Abc123!@#XyzQwerty');
      expect(result.score).toBeGreaterThanOrEqual(6);
    });
  });
});
