/**
 * OneDrive Client for Slasshy Vault
 *
 * Uses Microsoft Graph API for file operations.
 * Supports both visible folder storage and hidden appFolder for invisible storage.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { encryptToPayload, decryptToString, getMetadataKey, randomHex } from '../../crypto/index.js';
import { assertSecureServerUrl, parseHttpUrl } from '../../security/urlValidation.js';

// Microsoft Graph API endpoints
const GRAPH_API_URL = 'https://graph.microsoft.com/v1.0';

// Token and config paths
const TOKEN_PATH = path.join(os.homedir(), '.slasshy', 'onedrive_token.enc');
const CONFIG_PATH = path.join(os.homedir(), '.slasshy', 'onedrive_config.json');

// App folder name (hidden in OneDrive special approot folder)
const APP_FOLDER_NAME = 'SlasshyVault';

// Client state
let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokenExpiry: number = 0;

interface OneDriveConfig {
  serverUrl: string;
  clientId?: string;
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expiry_date?: number;
}

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType: string };
  folder?: { childCount: number };
  '@microsoft.graph.downloadUrl'?: string;
}

interface DriveItemsResponse {
  value: DriveItem[];
  '@odata.nextLink'?: string;
}

const ONEDRIVE_AUTH_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.live.com',
]);

function normalizeServerUrl(serverUrl: string): string {
  const parsed = assertSecureServerUrl(serverUrl, 'OneDrive OAuth server URL');
  return parsed.toString().replace(/\/+$/, '');
}

function validateOneDriveAuthUrl(authUrl: string): string {
  const parsed = parseHttpUrl(authUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Invalid OneDrive authorization URL protocol.');
  }

  const host = parsed.hostname.toLowerCase();
  if (!ONEDRIVE_AUTH_HOSTS.has(host)) {
    throw new Error('Unexpected OneDrive authorization host returned by backend.');
  }

  return parsed.toString();
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Check if OneDrive OAuth server URL is configured
 */
export async function isOneDriveConfigured(): Promise<boolean> {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8')) as OneDriveConfig;
    return !!config.serverUrl && config.serverUrl.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get OneDrive OAuth server URL from config
 */
export async function getOneDriveServerUrl(): Promise<string | null> {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8')) as OneDriveConfig;
    return config.serverUrl || null;
  } catch {
    return null;
  }
}

/**
 * Set OneDrive OAuth server URL
 */
export async function setOneDriveServerUrl(serverUrl: string): Promise<void> {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const configDir = path.dirname(CONFIG_PATH);
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });

  let existingConfig: OneDriveConfig = { serverUrl: '' };
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
 * Check if already authenticated with OneDrive
 */
export async function isOneDriveAuthenticated(): Promise<boolean> {
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

  const serverUrl = await getOneDriveServerUrl();
  if (!serverUrl) {
    return false;
  }
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  try {
    const encryptionKey = randomHex(16);

    const response = await fetch(`${normalizedServerUrl}/onedrive/refresh`, {
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
    throw new Error('OneDrive authentication expired. Run "BLANK auth --onedrive" to reconnect.');
  }
}

/**
 * Initialize OneDrive client with saved tokens
 */
export async function initializeOneDrive(): Promise<void> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error('Not authenticated with OneDrive. Run "BLANK auth --onedrive" to connect.');
  }

  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
  tokenExpiry = tokens.expiry_date || 0;

  // Check if token needs refresh
  if (tokenExpiry < Date.now() + 300000) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      throw new Error('OneDrive authentication expired. Run "BLANK auth --onedrive" to reconnect.');
    }
  }
}

/**
 * Check if OneDrive is connected
 */
export function isOneDriveConnected(): boolean {
  return accessToken !== null && tokenExpiry > Date.now();
}

/**
 * Disconnect from OneDrive
 */
export function disconnectOneDrive(): void {
  accessToken = null;
  refreshToken = null;
  tokenExpiry = 0;
}

/**
 * Delete stored tokens (logout)
 */
export async function logoutOneDrive(): Promise<void> {
  disconnectOneDrive();
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
 * Start OneDrive OAuth flow via backend server
 */
export async function startOneDriveOAuthFlow(): Promise<{ authUrl: string; sessionId: string }> {
  const serverUrl = await getOneDriveServerUrl();

  if (!serverUrl) {
    throw new Error('OneDrive OAuth server not configured. Run "BLANK auth --onedrive" to set up.');
  }
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  const response = await fetch(`${normalizedServerUrl}/onedrive/start`);
  if (!response.ok) {
    throw new Error(`OAuth server error: ${response.statusText}`);
  }

  const data = await response.json() as OAuthStartResponse;
  return { authUrl: validateOneDriveAuthUrl(data.authUrl), sessionId: data.sessionId };
}

/**
 * Poll for OAuth completion
 */
export async function pollForOneDriveTokens(
  sessionId: string,
  encryptionKey: string,
  maxAttempts: number = 60,
  intervalMs: number = 2000
): Promise<TokenData> {
  const serverUrl = await getOneDriveServerUrl();

  if (!serverUrl) {
    throw new Error('OneDrive OAuth server not configured.');
  }
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const pollBaseUrl = `${normalizedServerUrl}/onedrive/poll/${encodeURIComponent(sessionId)}`;
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
 * Perform full OneDrive OAuth flow
 */
export async function performOneDriveOAuthFlow(
  openBrowser: (url: string) => Promise<void>
): Promise<void> {
  const { authUrl, sessionId } = await startOneDriveOAuthFlow();
  const encryptionKey = randomHex(32);

  await openBrowser(authUrl);
  await pollForOneDriveTokens(sessionId, encryptionKey);
}

// ============================================================================
// GRAPH API HELPERS
// ============================================================================

/**
 * Make authenticated request to Microsoft Graph API
 */
async function graphRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  await ensureValidToken();

  const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_API_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Graph API error: ${response.status} ${response.statusText}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Upload file via Graph API
 */
async function graphUpload(
  endpoint: string,
  data: Buffer | fsSync.ReadStream,
  contentType: string = 'application/octet-stream'
): Promise<DriveItem> {
  await ensureValidToken();

  const url = `${GRAPH_API_URL}${endpoint}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': contentType,
    },
    body: data as any,
  });

  if (!response.ok) {
    throw new Error(`Graph API upload error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<DriveItem>;
}

// ============================================================================
// FILE OPERATIONS - VISIBLE FOLDER
// ============================================================================

/**
 * Get or create the Slasshy folder in OneDrive root
 */
export async function getOrCreateSlasshyFolder(): Promise<string> {
  try {
    // Try to find existing folder
    const response = await graphRequest<DriveItemsResponse>(
      `/me/drive/root/children?$filter=name eq '${APP_FOLDER_NAME}' and folder ne null`
    );

    if (response.value && response.value.length > 0) {
      return response.value[0]!.id;
    }
  } catch {
    // Folder doesn't exist, create it
  }

  // Create folder
  const folder = await graphRequest<DriveItem>('/me/drive/root/children', {
    method: 'POST',
    body: JSON.stringify({
      name: APP_FOLDER_NAME,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });

  return folder.id;
}

/**
 * Upload a file to OneDrive
 */
export async function uploadToOneDrive(
  filePath: string,
  fileName: string,
  folderId?: string
): Promise<string> {
  const parentPath = folderId
    ? `/me/drive/items/${folderId}`
    : '/me/drive/root';
  const fileStream = fsSync.createReadStream(filePath);

  const item = await graphUpload(
    `${parentPath}:/${encodeURIComponent(fileName)}:/content`,
    fileStream
  );

  return item.id;
}

/**
 * Upload buffer to OneDrive
 */
export async function uploadBufferToOneDrive(
  data: Buffer,
  fileName: string,
  folderId?: string
): Promise<string> {
  const parentPath = folderId
    ? `/me/drive/items/${folderId}`
    : '/me/drive/root';

  const item = await graphUpload(
    `${parentPath}:/${encodeURIComponent(fileName)}:/content`,
    data
  );

  return item.id;
}

/**
 * Download a file from OneDrive
 */
export async function downloadFromOneDrive(
  fileId: string,
  outputPath: string
): Promise<void> {
  await ensureValidToken();

  // Get download URL
  const item = await graphRequest<DriveItem>(
    `/me/drive/items/${fileId}?select=id,@microsoft.graph.downloadUrl`
  );

  const downloadUrl = item['@microsoft.graph.downloadUrl'];
  if (!downloadUrl) {
    throw new Error('No download URL available');
  }

  // Download file
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

/**
 * Download file to buffer
 */
export async function downloadOneDriveToBuffer(fileId: string): Promise<Buffer> {
  await ensureValidToken();

  const item = await graphRequest<DriveItem>(
    `/me/drive/items/${fileId}?select=id,@microsoft.graph.downloadUrl`
  );

  const downloadUrl = item['@microsoft.graph.downloadUrl'];
  if (!downloadUrl) {
    throw new Error('No download URL available');
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Delete a file from OneDrive
 */
export async function deleteFromOneDrive(fileId: string): Promise<void> {
  await graphRequest<void>(`/me/drive/items/${fileId}`, {
    method: 'DELETE',
  });
}

/**
 * List files in a OneDrive folder
 */
export async function listOneDriveFiles(
  folderId?: string,
  filter?: string
): Promise<DriveItem[]> {
  const parentPath = folderId
    ? `/me/drive/items/${folderId}/children`
    : '/me/drive/root/children';

  let query = parentPath;
  if (filter) {
    query += `?$filter=${encodeURIComponent(filter)}`;
  }

  const response = await graphRequest<DriveItemsResponse>(query);
  return response.value || [];
}

// ============================================================================
// APP FOLDER OPERATIONS - HIDDEN STORAGE
// ============================================================================

/**
 * Get app folder path (special folder for app-specific data)
 * This uses the OneDrive approot special folder
 */
async function getAppFolderPath(): Promise<string> {
  return '/me/drive/special/approot';
}

/**
 * Upload to hidden app folder
 */
export async function uploadToOneDriveAppFolder(
  filePath: string,
  fileName: string
): Promise<string> {
  const fileData = await fs.readFile(filePath);
  const appPath = await getAppFolderPath();

  const item = await graphUpload(
    `${appPath}:/${encodeURIComponent(fileName)}:/content`,
    fileData
  );

  return item.id;
}

/**
 * Upload buffer to hidden app folder
 */
export async function uploadBufferToOneDriveAppFolder(
  data: Buffer,
  fileName: string
): Promise<string> {
  const appPath = await getAppFolderPath();

  const item = await graphUpload(
    `${appPath}:/${encodeURIComponent(fileName)}:/content`,
    data
  );

  return item.id;
}

/**
 * Download from hidden app folder
 */
export async function downloadFromOneDriveAppFolder(
  fileId: string,
  outputPath: string
): Promise<void> {
  return downloadFromOneDrive(fileId, outputPath);
}

/**
 * Download from app folder to buffer
 */
export async function downloadOneDriveAppFolderToBuffer(fileId: string): Promise<Buffer> {
  return downloadOneDriveToBuffer(fileId);
}

/**
 * List files in app folder
 */
export async function listOneDriveAppFolderFiles(
  namePattern?: string
): Promise<DriveItem[]> {
  const appPath = await getAppFolderPath();

  let query = `${appPath}/children`;
  if (namePattern) {
    query += `?$filter=contains(name,'${namePattern}')`;
  }

  try {
    const response = await graphRequest<DriveItemsResponse>(query);
    return response.value || [];
  } catch {
    // App folder might not exist yet
    return [];
  }
}

/**
 * Find file in app folder by name
 */
export async function findOneDriveAppFolderFile(fileName: string): Promise<string | null> {
  const files = await listOneDriveAppFolderFiles();

  const file = files.find(f => f.name === fileName);
  return file?.id || null;
}

/**
 * Delete from app folder
 */
export async function deleteFromOneDriveAppFolder(fileId: string): Promise<void> {
  return deleteFromOneDrive(fileId);
}

/**
 * Update file in app folder
 */
export async function updateOneDriveAppFolderFile(
  fileId: string,
  data: Buffer
): Promise<void> {
  await graphUpload(
    `/me/drive/items/${fileId}/content`,
    data
  );
}

/**
 * Get or create vault index in app folder
 */
export async function getOrCreateOneDriveVaultIndex(): Promise<{ id: string; isNew: boolean }> {
  const indexFileName = 'slasshy_vault_index.json';

  const existingId = await findOneDriveAppFolderFile(indexFileName);
  if (existingId) {
    return { id: existingId, isNew: false };
  }

  // Create empty index
  const emptyIndex = JSON.stringify({ files: {}, version: '2.0.0', provider: 'onedrive' });
  const id = await uploadBufferToOneDriveAppFolder(Buffer.from(emptyIndex, 'utf-8'), indexFileName);

  return { id, isNew: true };
}

/**
 * Check if app folder access is available
 */
export async function hasOneDriveAppFolderAccess(): Promise<boolean> {
  try {
    await graphRequest<DriveItem>('/me/drive/special/approot');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get OneDrive user info
 */
export async function getOneDriveUserInfo(): Promise<{ name: string; email: string }> {
  const user = await graphRequest<{ displayName: string; mail?: string; userPrincipalName: string }>(
    '/me?$select=displayName,mail,userPrincipalName'
  );

  return {
    name: user.displayName,
    email: user.mail || user.userPrincipalName,
  };
}

/**
 * Get OneDrive storage quota
 */
export async function getOneDriveQuota(): Promise<{ used: number; total: number; remaining: number }> {
  const drive = await graphRequest<{
    quota: { used: number; total: number; remaining: number };
  }>('/me/drive?$select=quota');

  return {
    used: drive.quota.used,
    total: drive.quota.total,
    remaining: drive.quota.remaining,
  };
}
