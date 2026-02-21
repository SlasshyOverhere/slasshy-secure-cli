/**
 * Dropbox Client for Slasshy Vault
 *
 * Uses Dropbox API v2 for file operations.
 * Supports both visible folder storage and App folder for app-specific storage.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { encryptToPayload, decryptToString, getMetadataKey, randomHex } from '../../crypto/index.js';
import { assertSecureServerUrl, parseHttpUrl } from '../../security/urlValidation.js';

// Dropbox API endpoints
const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';

// Token and config paths
const TOKEN_PATH = path.join(os.homedir(), '.slasshy', 'dropbox_token.enc');
const CONFIG_PATH = path.join(os.homedir(), '.slasshy', 'dropbox_config.json');

// App folder path (Dropbox App folder is automatically scoped)
const APP_FOLDER_PATH = '/SlasshyVault';

// Client state
let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokenExpiry: number = 0;

interface DropboxConfig {
  serverUrl: string;
  appKey?: string;
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expiry_date?: number;
}

interface DropboxFileMetadata {
  '.tag': 'file';
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
  size: number;
  client_modified: string;
  server_modified: string;
  content_hash?: string;
}

interface DropboxFolderMetadata {
  '.tag': 'folder';
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
}

interface DropboxDeletedMetadata {
  '.tag': 'deleted';
  name: string;
  path_lower: string;
  path_display: string;
}

type DropboxMetadata = DropboxFileMetadata | DropboxFolderMetadata | DropboxDeletedMetadata;

interface ListFolderResult {
  entries: DropboxMetadata[];
  cursor: string;
  has_more: boolean;
}

const DROPBOX_AUTH_HOSTS = new Set([
  'www.dropbox.com',
  'dropbox.com',
]);

function normalizeServerUrl(serverUrl: string): string {
  const parsed = assertSecureServerUrl(serverUrl, 'Dropbox OAuth server URL');
  return parsed.toString().replace(/\/+$/, '');
}

function validateDropboxAuthUrl(authUrl: string): string {
  const parsed = parseHttpUrl(authUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Invalid Dropbox authorization URL protocol.');
  }

  const host = parsed.hostname.toLowerCase();
  if (!DROPBOX_AUTH_HOSTS.has(host)) {
    throw new Error('Unexpected Dropbox authorization host returned by backend.');
  }

  return parsed.toString();
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Check if Dropbox OAuth server URL is configured
 */
export async function isDropboxConfigured(): Promise<boolean> {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8')) as DropboxConfig;
    return !!config.serverUrl && config.serverUrl.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get Dropbox OAuth server URL from config
 */
export async function getDropboxServerUrl(): Promise<string | null> {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8')) as DropboxConfig;
    return config.serverUrl || null;
  } catch {
    return null;
  }
}

/**
 * Set Dropbox OAuth server URL
 */
export async function setDropboxServerUrl(serverUrl: string): Promise<void> {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const configDir = path.dirname(CONFIG_PATH);
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });

  let existingConfig: DropboxConfig = { serverUrl: '' };
  try {
    existingConfig = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  } catch {
    // No existing config
  }

  await fs.writeFile(
    CONFIG_PATH,
    JSON.stringify({ ...existingConfig, serverUrl: normalizedServerUrl }),
    { encoding: 'utf-8', mode: 0o600 }
  );
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Check if already authenticated with Dropbox
 */
export async function isDropboxAuthenticated(): Promise<boolean> {
  try {
    await fs.access(TOKEN_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save encrypted tokens
 */
async function saveTokens(tokens: TokenData): Promise<void> {
  const metadataKey = getMetadataKey();
  const tokenData = {
    ...tokens,
    expiry_date: Date.now() + (tokens.expires_in * 1000),
  };
  const encrypted = encryptToPayload(JSON.stringify(tokenData), metadataKey);
  const tokenDir = path.dirname(TOKEN_PATH);
  await fs.mkdir(tokenDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_PATH, encrypted, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Load and decrypt tokens
 */
async function loadTokens(): Promise<TokenData | null> {
  try {
    const encrypted = await fs.readFile(TOKEN_PATH, 'utf-8');
    const metadataKey = getMetadataKey();
    const decrypted = decryptToString(encrypted, metadataKey);
    return JSON.parse(decrypted) as TokenData;
  } catch {
    return null;
  }
}

/**
 * Refresh access token via backend server
 */
async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) {
    return false;
  }

  const serverUrl = await getDropboxServerUrl();
  if (!serverUrl) {
    return false;
  }
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  try {
    const encryptionKey = randomHex(16);

    const response = await fetch(`${normalizedServerUrl}/dropbox/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, encryptionKey }),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json() as { tokens: string; encrypted?: boolean };

    let tokens: TokenData;
    if (data.encrypted) {
      const CryptoJS = (await import('crypto-js')).default;
      const decrypted = CryptoJS.AES.decrypt(data.tokens, encryptionKey);
      tokens = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
    } else {
      tokens = JSON.parse(data.tokens);
    }

    await saveTokens(tokens);
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    tokenExpiry = Date.now() + (tokens.expires_in * 1000);

    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure we have a valid access token
 */
async function ensureValidToken(): Promise<void> {
  // Check if token is expired or about to expire (5 min buffer)
  if (accessToken && tokenExpiry > Date.now() + 300000) {
    return;
  }

  // Try to refresh
  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    throw new Error('Dropbox authentication expired. Run "BLANK auth --dropbox" to reconnect.');
  }
}

/**
 * Initialize Dropbox client with saved tokens
 */
export async function initializeDropbox(): Promise<void> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error('Not authenticated with Dropbox. Run "BLANK auth --dropbox" to connect.');
  }

  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
  tokenExpiry = tokens.expiry_date || 0;

  // Check if token needs refresh
  if (tokenExpiry < Date.now() + 300000) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      throw new Error('Dropbox authentication expired. Run "BLANK auth --dropbox" to reconnect.');
    }
  }
}

/**
 * Check if Dropbox is connected
 */
export function isDropboxConnected(): boolean {
  return accessToken !== null && tokenExpiry > Date.now();
}

/**
 * Disconnect from Dropbox
 */
export function disconnectDropbox(): void {
  accessToken = null;
  refreshToken = null;
  tokenExpiry = 0;
}

/**
 * Delete stored tokens (logout)
 */
export async function logoutDropbox(): Promise<void> {
  disconnectDropbox();
  try {
    await fs.unlink(TOKEN_PATH);
  } catch {
    // Token file might not exist
  }
}

// ============================================================================
// OAUTH FLOW
// ============================================================================

interface OAuthStartResponse {
  authUrl: string;
  sessionId: string;
  expiresIn: number;
}

interface OAuthPollResponse {
  status: 'pending' | 'complete' | 'error' | 'not_found';
  tokens?: string;
  encrypted?: boolean;
  error?: string;
}

/**
 * Start Dropbox OAuth flow via backend server
 */
export async function startDropboxOAuthFlow(): Promise<{ authUrl: string; sessionId: string }> {
  const serverUrl = await getDropboxServerUrl();

  if (!serverUrl) {
    throw new Error('Dropbox OAuth server not configured. Run "BLANK auth --dropbox" to set up.');
  }
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  const response = await fetch(`${normalizedServerUrl}/dropbox/start`);
  if (!response.ok) {
    throw new Error(`OAuth server error: ${response.statusText}`);
  }

  const data = await response.json() as OAuthStartResponse;
  return { authUrl: validateDropboxAuthUrl(data.authUrl), sessionId: data.sessionId };
}

/**
 * Poll for OAuth completion
 */
export async function pollForDropboxTokens(
  sessionId: string,
  encryptionKey: string,
  maxAttempts: number = 60,
  intervalMs: number = 2000
): Promise<TokenData> {
  const serverUrl = await getDropboxServerUrl();

  if (!serverUrl) {
    throw new Error('Dropbox OAuth server not configured.');
  }
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const pollBaseUrl = `${normalizedServerUrl}/dropbox/poll/${encodeURIComponent(sessionId)}`;
  let useLegacyQueryPoll = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    if (useLegacyQueryPoll) {
      response = await fetch(`${pollBaseUrl}?encryptionKey=${encodeURIComponent(encryptionKey)}`);
    } else {
      response = await fetch(pollBaseUrl, {
        headers: { 'x-blankdrive-encryption-key': encryptionKey },
      });

      if (response.status === 400 || response.status === 404 || response.status === 405) {
        useLegacyQueryPoll = true;
        response = await fetch(`${pollBaseUrl}?encryptionKey=${encodeURIComponent(encryptionKey)}`);
      }
    }

    if (!response.ok) {
      throw new Error(`OAuth server error: ${response.statusText}`);
    }

    const data = await response.json() as OAuthPollResponse;

    if (data.status === 'complete' && data.tokens) {
      let tokens: TokenData;
      if (data.encrypted) {
        const CryptoJS = (await import('crypto-js')).default;
        const decrypted = CryptoJS.AES.decrypt(data.tokens, encryptionKey);
        tokens = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
      } else {
        tokens = JSON.parse(data.tokens);
      }

      await saveTokens(tokens);
      accessToken = tokens.access_token;
      refreshToken = tokens.refresh_token;
      tokenExpiry = Date.now() + (tokens.expires_in * 1000);

      return tokens;
    }

    if (data.status === 'error') {
      throw new Error(data.error || 'OAuth authorization failed');
    }

    if (data.status === 'not_found') {
      throw new Error('Session expired. Please try again.');
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('OAuth timeout. Please try again.');
}

/**
 * Perform full Dropbox OAuth flow
 */
export async function performDropboxOAuthFlow(
  openBrowser: (url: string) => Promise<void>
): Promise<void> {
  const { authUrl, sessionId } = await startDropboxOAuthFlow();
  const encryptionKey = randomHex(32);

  await openBrowser(authUrl);
  await pollForDropboxTokens(sessionId, encryptionKey);
}

// ============================================================================
// API HELPERS
// ============================================================================

/**
 * Make authenticated request to Dropbox API
 */
async function dropboxRequest<T>(
  endpoint: string,
  body?: object
): Promise<T> {
  await ensureValidToken();

  const response = await fetch(`${DROPBOX_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Dropbox API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Upload file via Dropbox content API
 */
async function dropboxUpload(
  path: string,
  data: Buffer | fsSync.ReadStream,
  mode: 'add' | 'overwrite' = 'overwrite'
): Promise<DropboxFileMetadata> {
  await ensureValidToken();

  const response = await fetch(`${DROPBOX_CONTENT_URL}/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode,
        autorename: false,
        mute: true,
      }),
    },
    body: data as any,
  });

  if (!response.ok) {
    throw new Error(`Dropbox upload error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<DropboxFileMetadata>;
}

/**
 * Download file from Dropbox
 */
async function dropboxDownload(path: string): Promise<Buffer> {
  await ensureValidToken();

  const response = await fetch(`${DROPBOX_CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });

  if (!response.ok) {
    throw new Error(`Dropbox download error: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Ensure app folder exists
 */
export async function ensureAppFolder(): Promise<void> {
  try {
    await dropboxRequest('/files/get_metadata', { path: APP_FOLDER_PATH });
  } catch {
    // Folder doesn't exist, create it
    await dropboxRequest('/files/create_folder_v2', { path: APP_FOLDER_PATH });
  }
}

/**
 * Upload a file to Dropbox
 */
export async function uploadToDropbox(
  filePath: string,
  fileName: string,
  folderPath: string = APP_FOLDER_PATH
): Promise<string> {
  const dropboxPath = `${folderPath}/${fileName}`;
  const fileStream = fsSync.createReadStream(filePath);

  const result = await dropboxUpload(dropboxPath, fileStream);
  return result.id;
}

/**
 * Upload buffer to Dropbox
 */
export async function uploadBufferToDropbox(
  data: Buffer,
  fileName: string,
  folderPath: string = APP_FOLDER_PATH
): Promise<string> {
  const dropboxPath = `${folderPath}/${fileName}`;

  const result = await dropboxUpload(dropboxPath, data);
  return result.id;
}

/**
 * Download a file from Dropbox
 */
export async function downloadFromDropbox(
  dropboxPath: string,
  outputPath: string
): Promise<void> {
  const data = await dropboxDownload(dropboxPath);
  await fs.writeFile(outputPath, data);
}

/**
 * Download file to buffer
 */
export async function downloadDropboxToBuffer(dropboxPath: string): Promise<Buffer> {
  return dropboxDownload(dropboxPath);
}

/**
 * Delete a file from Dropbox
 */
export async function deleteFromDropbox(dropboxPath: string): Promise<void> {
  await dropboxRequest('/files/delete_v2', { path: dropboxPath });
}

/**
 * List files in a Dropbox folder
 */
export async function listDropboxFiles(
  folderPath: string = APP_FOLDER_PATH
): Promise<DropboxFileMetadata[]> {
  try {
    const result = await dropboxRequest<ListFolderResult>('/files/list_folder', {
      path: folderPath,
      recursive: false,
      include_deleted: false,
    });

    const files: DropboxFileMetadata[] = [];

    for (const entry of result.entries) {
      if (entry['.tag'] === 'file') {
        files.push(entry);
      }
    }

    // Handle pagination
    let hasMore = result.has_more;
    let cursor = result.cursor;

    while (hasMore) {
      const continueResult = await dropboxRequest<ListFolderResult>('/files/list_folder/continue', {
        cursor,
      });

      for (const entry of continueResult.entries) {
        if (entry['.tag'] === 'file') {
          files.push(entry);
        }
      }

      hasMore = continueResult.has_more;
      cursor = continueResult.cursor;
    }

    return files;
  } catch {
    // Folder might not exist
    return [];
  }
}

/**
 * Find file in folder by name
 */
export async function findDropboxFile(
  fileName: string,
  folderPath: string = APP_FOLDER_PATH
): Promise<string | null> {
  const files = await listDropboxFiles(folderPath);
  const file = files.find(f => f.name === fileName);
  return file?.path_lower || null;
}

/**
 * Get or create vault index
 */
export async function getOrCreateDropboxVaultIndex(): Promise<{ path: string; isNew: boolean }> {
  const indexFileName = 'slasshy_vault_index.json';
  const indexPath = `${APP_FOLDER_PATH}/${indexFileName}`;

  const existingPath = await findDropboxFile(indexFileName);
  if (existingPath) {
    return { path: existingPath, isNew: false };
  }

  // Ensure folder exists
  await ensureAppFolder();

  // Create empty index
  const emptyIndex = JSON.stringify({ files: {}, version: '2.0.0', provider: 'dropbox' });
  await uploadBufferToDropbox(Buffer.from(emptyIndex, 'utf-8'), indexFileName);

  return { path: indexPath, isNew: true };
}

/**
 * Get Dropbox user info
 */
export async function getDropboxUserInfo(): Promise<{ name: string; email: string }> {
  const user = await dropboxRequest<{
    name: { display_name: string };
    email: string;
  }>('/users/get_current_account', {});

  return {
    name: user.name.display_name,
    email: user.email,
  };
}

/**
 * Get Dropbox storage quota
 */
export async function getDropboxQuota(): Promise<{ used: number; allocated: number }> {
  const quota = await dropboxRequest<{
    used: number;
    allocation: { '.tag': string; allocated?: number };
  }>('/users/get_space_usage', {});

  return {
    used: quota.used,
    allocated: quota.allocation.allocated || 0,
  };
}
