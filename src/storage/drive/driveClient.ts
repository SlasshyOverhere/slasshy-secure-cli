import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { encryptToPayload, decryptToString, getMetadataKey, randomHex } from '../../crypto/index.js';

// Scopes needed: drive.file for visible files, drive.appdata for hidden appDataFolder
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata'
];
const TOKEN_PATH = path.join(os.homedir(), '.slasshy', 'drive_token.enc');
const CONFIG_PATH = path.join(os.homedir(), '.slasshy', 'oauth_config.json');

// Hidden folder name in appDataFolder for encrypted file chunks
const VAULT_FILES_FOLDER = 'slasshy_vault_files';

let driveClient: drive_v3.Drive | null = null;
let authClient: OAuth2Client | null = null;

interface OAuthConfig {
  serverUrl: string;
}

/**
 * Check if OAuth server URL is configured
 */
export async function isOAuthServerConfigured(): Promise<boolean> {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8')) as OAuthConfig;
    return !!config.serverUrl && config.serverUrl.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get OAuth server URL from config
 */
export async function getOAuthServerUrl(): Promise<string | null> {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8')) as OAuthConfig;
    return config.serverUrl || null;
  } catch {
    return null;
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

  if (!serverUrl) {
    throw new Error('OAuth server not configured. Run "slasshy auth" to set up your backend URL.');
  }

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

  if (!serverUrl) {
    throw new Error('OAuth server not configured.');
  }

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

  if (!serverUrl) {
    throw new Error('OAuth server not configured.');
  }

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

// ============================================================================
// HIDDEN APPDATAFOLDER FUNCTIONS - Files stored here are INVISIBLE to users
// ============================================================================

/**
 * Upload a file to the hidden appDataFolder (invisible to user in Drive UI)
 */
export async function uploadToAppData(
  filePath: string,
  fileName: string,
  onProgress?: (bytesUploaded: number, totalBytes: number) => void
): Promise<string> {
  const drive = getDriveClient();

  const stats = await fs.stat(filePath);
  const totalBytes = stats.size;

  const fileMetadata: drive_v3.Schema$File = {
    name: fileName,
    parents: ['appDataFolder'], // This makes it hidden!
  };

  const media = {
    mimeType: 'application/octet-stream',
    body: fsSync.createReadStream(filePath),
  };

  // Track upload progress
  let bytesUploaded = 0;
  if (onProgress) {
    const stream = media.body as fsSync.ReadStream;
    stream.on('data', (chunk: Buffer | string) => {
      const chunkLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      bytesUploaded += chunkLength;
      onProgress(bytesUploaded, totalBytes);
    });
  }

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id,name,size',
  });

  if (!response.data.id) {
    throw new Error('Failed to upload file to appDataFolder: no ID returned');
  }

  return response.data.id;
}

/**
 * Upload a buffer directly to appDataFolder (for smaller data)
 */
export async function uploadBufferToAppData(
  data: Buffer,
  fileName: string
): Promise<string> {
  const drive = getDriveClient();

  const { Readable } = await import('stream');
  const stream = Readable.from(data);

  const fileMetadata: drive_v3.Schema$File = {
    name: fileName,
    parents: ['appDataFolder'],
  };

  const media = {
    mimeType: 'application/octet-stream',
    body: stream,
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id,name,size',
  });

  if (!response.data.id) {
    throw new Error('Failed to upload buffer to appDataFolder: no ID returned');
  }

  return response.data.id;
}

/**
 * List files in appDataFolder
 */
export async function listAppDataFiles(
  namePattern?: string
): Promise<drive_v3.Schema$File[]> {
  const drive = getDriveClient();
  const allFiles: drive_v3.Schema$File[] = [];

  let query = "'appDataFolder' in parents and trashed=false";
  if (namePattern) {
    query += ` and name contains '${namePattern}'`;
  }

  let pageToken: string | undefined = undefined;

  do {
    // Explicit type to avoid "implicitly any" TS7022 error
    const response: any = await drive.files.list({
      spaces: 'appDataFolder',
      q: query,
      fields: 'nextPageToken, files(id, name, size, createdTime, modifiedTime)',
      pageSize: 1000,
      pageToken,
    });

    if (response.data.files) {
      allFiles.push(...response.data.files);
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return allFiles;
}

/**
 * Find a file in appDataFolder by exact name
 */
export async function findAppDataFile(fileName: string): Promise<string | null> {
  const drive = getDriveClient();

  const response = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name='${fileName}' and 'appDataFolder' in parents and trashed=false`,
    fields: 'files(id, name)',
  });

  const files = response.data.files;
  if (files && files.length > 0) {
    return files[0]!.id || null;
  }

  return null;
}

/**
 * Download a file from appDataFolder
 */
export async function downloadFromAppData(
  fileId: string,
  outputPath: string,
  onProgress?: (bytesDownloaded: number, totalBytes: number) => void
): Promise<void> {
  const drive = getDriveClient();

  // First get file size
  const fileMeta = await drive.files.get({
    fileId,
    fields: 'size',
  });
  const totalBytes = parseInt(fileMeta.data.size || '0', 10);

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  const dest = fsSync.createWriteStream(outputPath);
  let bytesDownloaded = 0;

  return new Promise((resolve, reject) => {
    const stream = response.data as NodeJS.ReadableStream;

    if (onProgress) {
      stream.on('data', (chunk: Buffer) => {
        bytesDownloaded += chunk.length;
        onProgress(bytesDownloaded, totalBytes);
      });
    }

    stream
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .pipe(dest);
  });
}

/**
 * Download a file from appDataFolder to buffer (for smaller files)
 */
export async function downloadAppDataToBuffer(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(response.data as ArrayBuffer);
}

/**
 * Delete a file from appDataFolder
 */
export async function deleteFromAppData(fileId: string): Promise<void> {
  if (!fileId || fileId.trim() === '') {
    throw new Error('Invalid file ID: empty or undefined');
  }

  const drive = getDriveClient();

  try {
    // First verify the file exists and get its info
    await drive.files.get({
      fileId,
      fields: 'id,name',
    });

    // Now delete it
    await drive.files.delete({ fileId });
  } catch (error: unknown) {
    // Extract detailed error from Google API response
    const gaxiosError = error as { response?: { status?: number; data?: { error?: { message?: string; code?: number } } }; message?: string };
    const status = gaxiosError.response?.status;
    const apiMessage = gaxiosError.response?.data?.error?.message || gaxiosError.message || 'Unknown error';
    const apiCode = gaxiosError.response?.data?.error?.code;

    if (status === 404 || apiCode === 404) {
      throw new Error('not found');
    }

    throw new Error(`${apiMessage} (status: ${status || apiCode || 'unknown'}, fileId: ${fileId.substring(0, 20)}...)`);
  }
}

/**
 * Update/replace a file in appDataFolder
 */
export async function updateAppDataFile(
  fileId: string,
  data: Buffer
): Promise<void> {
  const drive = getDriveClient();

  const { Readable } = await import('stream');
  const stream = Readable.from(data);

  await drive.files.update({
    fileId,
    media: {
      mimeType: 'application/octet-stream',
      body: stream,
    },
  });
}

/**
 * Get or create the vault files index in appDataFolder
 */
export async function getOrCreateVaultIndex(): Promise<{ id: string; isNew: boolean }> {
  const indexFileName = 'slasshy_vault_index.json';

  const existingId = await findAppDataFile(indexFileName);
  if (existingId) {
    return { id: existingId, isNew: false };
  }

  // Create empty index
  const emptyIndex = JSON.stringify({ files: {}, version: '2.0.0' });
  const id = await uploadBufferToAppData(Buffer.from(emptyIndex, 'utf-8'), indexFileName);

  return { id, isNew: true };
}

/**
 * Check if appDataFolder scope is available (user may need to re-auth)
 */
export async function hasAppDataAccess(): Promise<boolean> {
  try {
    const drive = getDriveClient();
    await drive.files.list({
      spaces: 'appDataFolder',
      pageSize: 1,
    });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('insufficient')) {
      return false;
    }
    throw error;
  }
}

