/**
 * Password Strength Audit Tests
 *
 * Tests for password strength analysis using zxcvbn-like logic.
 */

import { describe, it, expect } from 'vitest';

// Password strength analysis functions
function analyzePasswordStrength(password: string): {
  score: number;
  crackTime: string;
  feedback: string[];
  entropy: number;
} {
  if (!password || password.length === 0) {
    return {
      score: 0,
      crackTime: 'instant',
      feedback: ['Password is empty'],
      entropy: 0,
    };
  }

  let score = 0;
  const feedback: string[] = [];

  // Length checks
  if (password.length < 8) {
    feedback.push('Password is too short (minimum 8 characters)');
  } else if (password.length >= 8) {
    score += 1;
  }
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;

  // Character variety
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);

  if (hasLower) score += 0.5;
  if (hasUpper) score += 0.5;
  if (hasDigit) score += 0.5;
  if (hasSymbol) score += 0.5;

  if (!hasLower && !hasUpper) feedback.push('Add letters');
  if (!hasDigit) feedback.push('Add numbers');
  if (!hasSymbol) feedback.push('Add special characters');

  // Pattern detection
  const commonPatterns = [
    /^[a-z]+$/i, // only letters
    /^[0-9]+$/, // only numbers
    /(.)\1{2,}/, // repeated characters
    /^(abc|123|qwerty|password|admin|letmein)/i, // common starts
    /(123|abc|qwe|asd|zxc)/i, // keyboard patterns
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      score -= 0.5;
      feedback.push('Avoid common patterns');
      break;
    }
  }

  // Common passwords check
  const commonPasswords = [
    'password', '123456', '12345678', 'qwerty', 'abc123',
    'monkey', 'master', 'dragon', 'letmein', 'login',
    'password1', 'iloveyou', 'admin', 'welcome', 'hello',
  ];

  if (commonPasswords.includes(password.toLowerCase())) {
    score = 0;
    feedback.unshift('This is a very common password');
  }

  // Calculate entropy (simplified)
  let charsetSize = 0;
  if (hasLower) charsetSize += 26;
  if (hasUpper) charsetSize += 26;
  if (hasDigit) charsetSize += 10;
  if (hasSymbol) charsetSize += 32;

  const entropy = password.length * Math.log2(Math.max(charsetSize, 1));

  // Normalize score to 0-4
  score = Math.max(0, Math.min(4, Math.round(score)));

  // Estimate crack time
  const crackTimes = ['instant', 'seconds', 'minutes', 'hours', 'days', 'months', 'years', 'centuries'];
  const crackTimeIndex = Math.min(Math.floor(entropy / 10), crackTimes.length - 1);
  const crackTime = crackTimes[crackTimeIndex] || 'unknown';

  return { score, crackTime, feedback, entropy };
}

function getScoreLabel(score: number): string {
  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  return labels[Math.min(score, 4)] || 'Unknown';
}

function getScoreColor(score: number): string {
  const colors = ['red', 'orange', 'yellow', 'green', 'brightgreen'];
  return colors[Math.min(score, 4)] || 'gray';
}

describe('Password Strength Analysis', () => {
  describe('analyzePasswordStrength', () => {
    it('should return score 0 for empty password', () => {
      const result = analyzePasswordStrength('');
      expect(result.score).toBe(0);
      expect(result.feedback).toContain('Password is empty');
    });

    it('should return score 0 for common passwords', () => {
      const commonPasswords = ['password', '123456', 'qwerty', 'admin'];
      for (const pwd of commonPasswords) {
        const result = analyzePasswordStrength(pwd);
        expect(result.score).toBe(0);
        expect(result.feedback.some(f => f.includes('common'))).toBe(true);
      }
    });

    it('should penalize short passwords', () => {
      const result = analyzePasswordStrength('Ab1!');
      expect(result.feedback.some(f => f.includes('short'))).toBe(true);
    });

    it('should reward longer passwords', () => {
      const short = analyzePasswordStrength('Abc123!');
      const long = analyzePasswordStrength('Abc123!Xyz789@Qwe');
      expect(long.score).toBeGreaterThanOrEqual(short.score);
    });

    it('should detect missing character types', () => {
      const noNumbers = analyzePasswordStrength('AbcdefgHijklmn!');
      expect(noNumbers.feedback.some(f => f.includes('numbers'))).toBe(true);

      const noSymbols = analyzePasswordStrength('Abcdefg123456');
      expect(noSymbols.feedback.some(f => f.includes('special'))).toBe(true);
    });

    it('should detect repeated characters', () => {
      const result = analyzePasswordStrength('aaabbbccc123');
      expect(result.feedback.some(f => f.includes('pattern'))).toBe(true);
    });

    it('should give high score for strong passwords', () => {
      const result = analyzePasswordStrength('X#9kL$mN2@pQ5rT8vW!');
      expect(result.score).toBeGreaterThanOrEqual(3);
    });

    it('should calculate entropy correctly', () => {
      const result = analyzePasswordStrength('Abc123!@#XYZ');
      expect(result.entropy).toBeGreaterThan(0);
      expect(result.entropy).toBeLessThan(200);
    });

    it('should estimate crack time', () => {
      const weak = analyzePasswordStrength('abc');
      const strong = analyzePasswordStrength('X#9kL$mN2@pQ5rT8vW!yZ');

      // Weak passwords should have fast crack times
      expect(['instant', 'seconds']).toContain(weak.crackTime);
      expect(['years', 'centuries']).toContain(strong.crackTime);
    });
  });

  describe('getScoreLabel', () => {
    it('should return correct labels', () => {
      expect(getScoreLabel(0)).toBe('Very Weak');
      expect(getScoreLabel(1)).toBe('Weak');
      expect(getScoreLabel(2)).toBe('Fair');
      expect(getScoreLabel(3)).toBe('Strong');
      expect(getScoreLabel(4)).toBe('Very Strong');
    });

    it('should handle out of range scores', () => {
      expect(getScoreLabel(5)).toBe('Very Strong');
      expect(getScoreLabel(-1)).toBe('Unknown');
    });
  });

  describe('getScoreColor', () => {
    it('should return correct colors', () => {
      expect(getScoreColor(0)).toBe('red');
      expect(getScoreColor(1)).toBe('orange');
      expect(getScoreColor(2)).toBe('yellow');
      expect(getScoreColor(3)).toBe('green');
      expect(getScoreColor(4)).toBe('brightgreen');
    });
  });
});

describe('Password Expiry', () => {
  function checkPasswordExpiry(
    lastChanged: number,
    expiryDays: number = 90
  ): { isExpired: boolean; daysRemaining: number; status: string } {
    const now = Date.now();
    const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
    const expiryDate = lastChanged + expiryMs;
    const daysRemaining = Math.floor((expiryDate - now) / (24 * 60 * 60 * 1000));

    if (daysRemaining < 0) {
      return { isExpired: true, daysRemaining, status: 'expired' };
    } else if (daysRemaining <= 7) {
      return { isExpired: false, daysRemaining, status: 'expiring_soon' };
    } else {
      return { isExpired: false, daysRemaining, status: 'healthy' };
    }
  }

  it('should detect expired passwords', () => {
    const lastChanged = Date.now() - (100 * 24 * 60 * 60 * 1000); // 100 days ago
    const result = checkPasswordExpiry(lastChanged, 90);
    expect(result.isExpired).toBe(true);
    expect(result.status).toBe('expired');
  });

  it('should detect passwords expiring soon', () => {
    const lastChanged = Date.now() - (85 * 24 * 60 * 60 * 1000); // 85 days ago
    const result = checkPasswordExpiry(lastChanged, 90);
    expect(result.isExpired).toBe(false);
    expect(result.status).toBe('expiring_soon');
  });

  it('should detect healthy passwords', () => {
    const lastChanged = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
    const result = checkPasswordExpiry(lastChanged, 90);
    expect(result.isExpired).toBe(false);
    expect(result.status).toBe('healthy');
  });

  it('should handle custom expiry periods', () => {
    const lastChanged = Date.now() - (40 * 24 * 60 * 60 * 1000); // 40 days ago

    const result30 = checkPasswordExpiry(lastChanged, 30);
    expect(result30.isExpired).toBe(true);

    const result60 = checkPasswordExpiry(lastChanged, 60);
    expect(result60.isExpired).toBe(false);
  });

  it('should calculate days remaining correctly', () => {
    const lastChanged = Date.now();
    const result = checkPasswordExpiry(lastChanged, 90);
    expect(result.daysRemaining).toBeGreaterThanOrEqual(89);
    expect(result.daysRemaining).toBeLessThanOrEqual(90);
  });
});
