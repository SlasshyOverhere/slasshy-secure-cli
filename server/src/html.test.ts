import { describe, it } from 'node:test';
import assert from 'node:assert';
import { escapeHtml, errorPage } from './html.js';

describe('HTML Utilities', () => {
  it('should escape special characters', () => {
    const input = '<script>alert("XSS")</script>';
    const expected = '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;';
    assert.strictEqual(escapeHtml(input), expected);
  });

  it('should handle ampersands correctly', () => {
    const input = 'Tom & Jerry';
    const expected = 'Tom &amp; Jerry';
    assert.strictEqual(escapeHtml(input), expected);
  });

  it('should handle single quotes', () => {
    const input = "'OR 1=1";
    const expected = "&#039;OR 1=1";
    assert.strictEqual(escapeHtml(input), expected);
  });

  it('errorPage should sanitize the message', () => {
    const maliciousInput = '<script>alert(1)</script>';
    const html = errorPage(maliciousInput);

    // Should NOT contain the raw script tag
    assert.ok(!html.includes(maliciousInput), 'Should not contain raw script tag');

    // Should contain the escaped version
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Should contain escaped script tag');
  });
});
