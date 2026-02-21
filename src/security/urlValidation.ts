const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Check if a hostname points to local loopback.
 */
export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.has(normalized)) {
    return true;
  }

  return normalized.startsWith('127.');
}

/**
 * Parse a URL and ensure it uses http(s) without embedded credentials.
 */
export function parseHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// or https:// URLs are allowed.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed.');
  }

  return parsed;
}

/**
 * Require HTTPS for remote hosts. Localhost may use HTTP for development.
 */
export function isHttpsOrLocalhostHttp(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
}

/**
 * Parse and validate a backend server URL.
 */
export function assertSecureServerUrl(rawUrl: string, label: string): URL {
  const parsed = parseHttpUrl(rawUrl);
  if (!isHttpsOrLocalhostHttp(parsed)) {
    throw new Error(`${label} must use HTTPS. HTTP is only allowed for localhost.`);
  }
  return parsed;
}
