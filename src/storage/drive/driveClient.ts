import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { encryptToPayload, decryptToString, getMetadataKey, randomHex } from '../../crypto/index.js';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const TOKEN_PATH = path.join(os.homedir(), '.slasshy', 'drive_token.enc');
const CONFIG_PATH = path.join(os.homedir(), '.slasshy', 'oauth_config.json');

// Default OAuth server URL (can be overridden in config)
const DEFAULT_OAUTH_SERVER = 'https://slasshy-secure-cli.onrender.com';

let driveClient: drive_v3.Drive | null = null;
let authClient: OAuth2Client | null = null;

interface OAuthConfig {
  serverUrl: string;
}

/**
 * Get OAuth server URL from config or use default
 */
async function getOAuthServerUrl(): Promise<string> {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8')) as OAuthConfig;
    return config.serverUrl || DEFAULT_OAUTH_SERVER;
  } catch {
    return DEFAULT_OAUTH_SERVER;
  }
}

/**
 * Set OAuth server URL
 */
export async function setOAuthServerUrl(serverUrl: string): Promise<void> {
  const configDir = path.dirname(CONFIG_PATH);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify({ serverUrl }), 'utf-8');
}

/**
 * Check if already authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
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
async function saveTokens(tokens: object): Promise<void> {
  const metadataKey = getMetadataKey();
  const encrypted = encryptToPayload(JSON.stringify(tokens), metadataKey);
  const tokenDir = path.dirname(TOKEN_PATH);
  await fs.mkdir(tokenDir, { recursive: true });
  await fs.writeFile(TOKEN_PATH, encrypted, 'utf-8');
}

/**
 * Load and decrypt tokens
 */
async function loadTokens(): Promise<object | null> {
  try {
    const encrypted = await fs.readFile(TOKEN_PATH, 'utf-8');
    const metadataKey = getMetadataKey();
    const decrypted = decryptToString(encrypted, metadataKey);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

// API Response types
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
  message?: string;
}

interface OAuthRefreshResponse {
  status: string;
  tokens: string;
  encrypted: boolean;
}

/**
 * Start OAuth flow via backend server
 */
export async function startOAuthFlow(): Promise<{ authUrl: string; sessionId: string }> {
  const serverUrl = await getOAuthServerUrl();

  const response = await fetch(`${serverUrl}/oauth/start`);
  if (!response.ok) {
    throw new Error(`OAuth server error: ${response.statusText}`);
  }

  const data = await response.json() as OAuthStartResponse;
  return { authUrl: data.authUrl, sessionId: data.sessionId };
}

/**
 * Poll for OAuth completion
 */
export async function pollForTokens(
  sessionId: string,
  encryptionKey: string,
  maxAttempts: number = 60,
  intervalMs: number = 2000
): Promise<object> {
  const serverUrl = await getOAuthServerUrl();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `${serverUrl}/oauth/poll/${sessionId}?encryptionKey=${encodeURIComponent(encryptionKey)}`
    );

    if (!response.ok) {
      throw new Error(`OAuth server error: ${response.statusText}`);
    }

    const data = await response.json() as OAuthPollResponse;

    if (data.status === 'complete' && data.tokens) {
      // Decrypt tokens if encrypted
      if (data.encrypted) {
        const CryptoJS = (await import('crypto-js')).default;
        const decrypted = CryptoJS.AES.decrypt(data.tokens, encryptionKey);
        return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
      }
      return JSON.parse(data.tokens);
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
 * Refresh access token via backend server
 */
async function refreshTokensViaServer(refreshToken: string): Promise<object> {
  const serverUrl = await getOAuthServerUrl();
  const encryptionKey = randomHex(16);

  const response = await fetch(`${serverUrl}/oauth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, encryptionKey }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.statusText}`);
  }

  const data = await response.json() as OAuthRefreshResponse;

  if (data.encrypted) {
    const CryptoJS = (await import('crypto-js')).default;
    const decrypted = CryptoJS.AES.decrypt(data.tokens, encryptionKey);
    return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
  }

  return JSON.parse(data.tokens);
}

/**
 * Authenticate with Google Drive via backend OAuth server
 */
export async function authenticateDrive(): Promise<void> {
  // Try to load existing tokens first
  const savedTokens = await loadTokens() as {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
  } | null;

  if (savedTokens && savedTokens.access_token) {
    // Check if token is expired
    if (savedTokens.expiry_date && savedTokens.expiry_date < Date.now()) {
      // Try to refresh
      if (savedTokens.refresh_token) {
        try {
          const newTokens = await refreshTokensViaServer(savedTokens.refresh_token);
          await saveTokens(newTokens);
          await setupDriveClient(newTokens);
          return;
        } catch {
          // Refresh failed, need to re-authenticate
        }
      }
    } else {
      // Token still valid
      await setupDriveClient(savedTokens);
      return;
    }
  }

  // Need to perform OAuth flow
  throw new Error(
    'Not authenticated. Run "slasshy auth" to connect to Google Drive.'
  );
}

/**
 * Perform full OAuth authentication flow
 */
export async function performOAuthFlow(
  openBrowser: (url: string) => Promise<void>
): Promise<void> {
  // Start OAuth flow
  const { authUrl, sessionId } = await startOAuthFlow();

  // Generate encryption key for secure token transfer
  const encryptionKey = randomHex(32);

  // Open browser for user to authenticate
  await openBrowser(authUrl);

  // Poll for completion
  const tokens = await pollForTokens(sessionId, encryptionKey);

  // Save tokens
  await saveTokens(tokens);

  // Setup client
  await setupDriveClient(tokens);
}

/**
 * Setup Drive client with tokens
 */
async function setupDriveClient(tokens: object): Promise<void> {
  authClient = new OAuth2Client();
  authClient.setCredentials(tokens as any);

  driveClient = google.drive({ version: 'v3', auth: authClient });
}

/**
 * Get the Drive client
 */
export function getDriveClient(): drive_v3.Drive {
  if (!driveClient) {
    throw new Error('Drive not authenticated. Call authenticateDrive() first.');
  }
  return driveClient;
}

/**
 * Check if Drive is connected
 */
export function isDriveConnected(): boolean {
  return driveClient !== null;
}

/**
 * Disconnect from Drive
 */
export function disconnectDrive(): void {
  driveClient = null;
  authClient = null;
}

/**
 * Delete stored tokens (logout)
 */
export async function logout(): Promise<void> {
  disconnectDrive();
  try {
    await fs.unlink(TOKEN_PATH);
  } catch {
    // Token file might not exist
  }
}

/**
 * Upload a file to Google Drive
 */
export async function uploadFile(
  filePath: string,
  fileName: string,
  mimeType: string = 'image/png',
  folderId?: string
): Promise<string> {
  const drive = getDriveClient();

  const fileMetadata: drive_v3.Schema$File = {
    name: fileName,
  };

  if (folderId) {
    fileMetadata.parents = [folderId];
  }

  const media = {
    mimeType,
    body: (await import('fs')).createReadStream(filePath),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id',
  });

  if (!response.data.id) {
    throw new Error('Failed to upload file: no ID returned');
  }

  return response.data.id;
}

/**
 * Download a file from Google Drive
 */
export async function downloadFile(
  fileId: string,
  outputPath: string
): Promise<void> {
  const drive = getDriveClient();

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  const dest = (await import('fs')).createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    (response.data as NodeJS.ReadableStream)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .pipe(dest);
  });
}

/**
 * Delete a file from Google Drive
 */
export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

/**
 * List files in Drive (optional folder filter)
 */
export async function listFiles(
  folderId?: string,
  pageSize: number = 100
): Promise<drive_v3.Schema$File[]> {
  const drive = getDriveClient();

  let query = "mimeType='image/png' or mimeType='image/jpeg'";
  if (folderId) {
    query = `'${folderId}' in parents and (${query})`;
  }

  const response = await drive.files.list({
    q: query,
    pageSize,
    fields: 'files(id, name, mimeType, createdTime, modifiedTime, size)',
  });

  return response.data.files || [];
}

/**
 * Create a folder in Google Drive
 */
export async function createFolder(
  name: string,
  parentId?: string
): Promise<string> {
  const drive = getDriveClient();

  const fileMetadata: drive_v3.Schema$File = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentId) {
    fileMetadata.parents = [parentId];
  }

  const response = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id',
  });

  if (!response.data.id) {
    throw new Error('Failed to create folder: no ID returned');
  }

  return response.data.id;
}

/**
 * Check if a folder exists by name
 */
export async function findFolder(name: string): Promise<string | null> {
  const drive = getDriveClient();

  const response = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  const files = response.data.files;
  if (files && files.length > 0) {
    return files[0]!.id || null;
  }

  return null;
}

/**
 * Get or create a folder
 */
export async function getOrCreateFolder(name: string): Promise<string> {
  const existingId = await findFolder(name);
  if (existingId) {
    return existingId;
  }
  return createFolder(name);
}
