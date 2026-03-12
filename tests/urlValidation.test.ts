import { test, describe, expect } from 'vitest';
import { isLoopbackHost } from '../src/security/urlValidation.js';
// Server exposes 'isLoopbackHostName' indirectly via requireLocalhostRequest,
// but isLoopbackHost validates identically.

describe('URL Validation Loopback Testing', () => {
  test('should allow strict localhost representations', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  test('should allow other valid IPv4 loopback variants in the 127.x.x.x block', () => {
    expect(isLoopbackHost('127.123.0.1')).toBe(true);
    expect(isLoopbackHost('127.255.255.254')).toBe(true);
    expect(isLoopbackHost('127.0.0.2')).toBe(true);
  });

  test('should reject malicious DNS rebinding attempts (127.evildomain.com)', () => {
    expect(isLoopbackHost('127.evildomain.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.attacker.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.nip.io')).toBe(false); // Can be considered remote in this context
  });

  test('should reject invalid IPs starting with 127', () => {
    expect(isLoopbackHost('127')).toBe(false);
    expect(isLoopbackHost('127.0')).toBe(false);
    expect(isLoopbackHost('127.0.0')).toBe(false);
    expect(isLoopbackHost('127.0.0.256')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.1')).toBe(false);
  });
});
