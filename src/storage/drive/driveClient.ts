import fs from 'fs/promises';
import fsSync from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client, Credentials, CodeChallengeMethod } from 'google-auth-library';
import { encryptToPayload, decryptToString, getMetadataKey } from '../../crypto/index.js';

// Scopes needed: drive.file for visible files, drive.appdata for hidden appDataFolder
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata'
];
const TOKEN_PATH = path.join(os.homedir(), '.slasshy', 'drive_token.enc');
const GOOGLE_OAUTH_CREDENTIALS_PATH = path.join(os.homedir(), '.slasshy', 'google_oauth_credentials.enc');
const CLOUD_STORAGE_CONFIG_PATH = path.join(os.homedir(), '.slasshy', 'cloud_storage_config.json');
const OAUTH_CALLBACK_PATH = '/';
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const PUBLIC_ROOT_FOLDER_NAME = 'BlankDrive';

let driveClient: drive_v3.Drive | null = null;
let authClient: OAuth2Client | null = null;
let sessionOAuthCredentials: GoogleOAuthCredentials | null = null;
let cachedPublicRootFolderId: string | null = null;
let cachedPublicContentFolderId: string | null = null;
let publicRootFolderInitPromise: Promise<string> | null = null;
let publicContentFolderInitPromise: Promise<string> | null = null;

interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export type CloudStorageMode = 'hidden' | 'public';

interface CloudStorageConfig {
  mode: CloudStorageMode;
  publicContentFolderName?: string;
}

function normalizePublicContentFolderName(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return null;
  }

  return trimmed;
}

function resetPublicFolderCache(): void {
  cachedPublicRootFolderId = null;
  cachedPublicContentFolderId = null;
  publicRootFolderInitPromise = null;
  publicContentFolderInitPromise = null;
}

async function readCloudStorageConfig(): Promise<Partial<CloudStorageConfig>> {
  try {
    return JSON.parse(await fs.readFile(CLOUD_STORAGE_CONFIG_PATH, 'utf-8')) as Partial<CloudStorageConfig>;
  } catch {
    return {};
  }
}

async function writeCloudStorageConfig(config: Partial<CloudStorageConfig>): Promise<void> {
  const configDir = path.dirname(CLOUD_STORAGE_CONFIG_PATH);
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    CLOUD_STORAGE_CONFIG_PATH,
    JSON.stringify(config, null, 2),
    { encoding: 'utf-8', mode: 0o600 }
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert buffer to RFC4648 base64url without padding
 */
function toBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Generate PKCE code verifier
 */
function generateCodeVerifier(): string {
  return toBase64Url(crypto.randomBytes(64));
}

/**
 * Generate PKCE code challenge
 */
function generateCodeChallenge(codeVerifier: string): string {
  return toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());
}

/**
 * Read Google OAuth client credentials from local encrypted storage
 */
export async function getGoogleOAuthCredentials(): Promise<GoogleOAuthCredentials | null> {
  try {
    const encrypted = await fs.readFile(GOOGLE_OAUTH_CREDENTIALS_PATH, 'utf-8');
    const metadataKey = getMetadataKey();
    const decrypted = decryptToString(encrypted, metadataKey);
    const parsed = JSON.parse(decrypted) as Partial<GoogleOAuthCredentials>;

    if (!parsed.clientId || !parsed.clientSecret) {
      return null;
    }

    return {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
    };
  } catch {
    return sessionOAuthCredentials;
  }
}

/**
 * Check if Google OAuth credentials are configured
 */
export async function isGoogleOAuthConfigured(): Promise<boolean> {
  const credentials = await getGoogleOAuthCredentials();
  return !!credentials?.clientId && !!credentials?.clientSecret;
}

/**
 * Check if cloud storage mode has been configured.
 */
export async function isCloudStorageModeConfigured(): Promise<boolean> {
  const config = await readCloudStorageConfig();
  return config.mode === 'hidden' || config.mode === 'public';
}

/**
 * Get cloud storage mode.
 * Defaults to public so encrypted uploads are visible in Drive by default.
 */
export async function getCloudStorageMode(): Promise<CloudStorageMode> {
  const config = await readCloudStorageConfig();
  if (config.mode === 'hidden' || config.mode === 'public') {
    return config.mode;
  }

  return 'public';
}

/**
 * Persist cloud storage mode.
 */
export async function setCloudStorageMode(mode: CloudStorageMode): Promise<void> {
  if (mode !== 'hidden' && mode !== 'public') {
    throw new Error('Invalid cloud storage mode. Use "hidden" or "public".');
  }

  const currentConfig = await readCloudStorageConfig();
  await writeCloudStorageConfig({
    ...currentConfig,
    mode,
  });

  resetPublicFolderCache();
}

/**
 * Check if public storage folder name is configured.
 */
export async function isPublicContentFolderNameConfigured(): Promise<boolean> {
  return (await getPublicContentFolderName()) !== null;
}

/**
 * Get configured public storage folder name used under BlankDrive/.
 */
export async function getPublicContentFolderName(): Promise<string | null> {
  const config = await readCloudStorageConfig();
  return normalizePublicContentFolderName(config.publicContentFolderName);
}

/**
 * Persist public storage folder name.
 */
export async function setPublicContentFolderName(folderName: string): Promise<void> {
  const normalized = normalizePublicContentFolderName(folderName);
  if (!normalized) {
    throw new Error('Invalid public folder name. It must be non-empty and cannot include "/" or "\\".');
  }

  const currentConfig = await readCloudStorageConfig();
  await writeCloudStorageConfig({
    ...currentConfig,
    publicContentFolderName: normalized,
  });

  resetPublicFolderCache();
}

/**
 * Save Google OAuth client credentials to local encrypted storage
 */
export async function setGoogleOAuthCredentials(clientId: string, clientSecret: string): Promise<void> {
  const trimmedClientId = clientId.trim();
  const trimmedClientSecret = clientSecret.trim();

  if (!trimmedClientId || !trimmedClientSecret) {
    throw new Error('Google OAuth Client ID and Client Secret are required.');
  }

  const metadataKey = getMetadataKey();
  const encrypted = encryptToPayload(
    JSON.stringify({
      clientId: trimmedClientId,
      clientSecret: trimmedClientSecret,
    }),
    metadataKey
  );

  const credentialsDir = path.dirname(GOOGLE_OAUTH_CREDENTIALS_PATH);
  await fs.mkdir(credentialsDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(GOOGLE_OAUTH_CREDENTIALS_PATH, encrypted, { encoding: 'utf-8', mode: 0o600 });
  sessionOAuthCredentials = {
    clientId: trimmedClientId,
    clientSecret: trimmedClientSecret,
  };
}

/**
 * Store Google OAuth client credentials for current process only (not persisted).
 * Useful before vault exists/unlock (e.g. restore flow).
 */
export function setGoogleOAuthCredentialsForSession(clientId: string, clientSecret: string): void {
  const trimmedClientId = clientId.trim();
  const trimmedClientSecret = clientSecret.trim();

  if (!trimmedClientId || !trimmedClientSecret) {
    throw new Error('Google OAuth Client ID and Client Secret are required.');
  }

  sessionOAuthCredentials = {
    clientId: trimmedClientId,
    clientSecret: trimmedClientSecret,
  };
}

/**
 * Build OAuth2 client for Google APIs
 */
function createOAuthClient(
  credentials: GoogleOAuthCredentials,
  redirectUri?: string
): OAuth2Client {
  return new OAuth2Client(
    credentials.clientId,
    credentials.clientSecret,
    redirectUri
  );
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
async function saveTokens(tokens: Credentials): Promise<void> {
  const metadataKey = getMetadataKey();
  const encrypted = encryptToPayload(JSON.stringify(tokens), metadataKey);
  const tokenDir = path.dirname(TOKEN_PATH);
  await fs.mkdir(tokenDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_PATH, encrypted, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Load and decrypt tokens
 */
async function loadTokens(): Promise<Credentials | null> {
  try {
    const encrypted = await fs.readFile(TOKEN_PATH, 'utf-8');
    const metadataKey = getMetadataKey();
    const decrypted = decryptToString(encrypted, metadataKey);
    return JSON.parse(decrypted) as Credentials;
  } catch {
    return null;
  }
}

/**
 * Simple success HTML for local OAuth callback
 */
function oauthSuccessPage(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>BlankDrive OAuth Complete</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #e2e8f0;
    }
    .card {
      text-align: center;
      padding: 24px 28px;
      border-radius: 12px;
      background: #1e293b;
      border: 1px solid #334155;
    }
    .ok {
      color: #22c55e;
      font-size: 32px;
      margin-bottom: 8px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="ok">Success</div>
    <div>You can close this tab and return to BlankDrive CLI.</div>
  </div>
</body>
</html>`;
}

/**
 * Simple error HTML for local OAuth callback
 */
function oauthErrorPage(message: string): string {
  const safeMessage = escapeHtml(message);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>BlankDrive OAuth Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #e2e8f0;
    }
    .card {
      text-align: center;
      padding: 24px 28px;
      border-radius: 12px;
      background: #1e293b;
      border: 1px solid #334155;
    }
    .err {
      color: #ef4444;
      font-size: 32px;
      margin-bottom: 8px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="err">Failed</div>
    <div>${safeMessage}</div>
  </div>
</body>
</html>`;
}

/**
 * Start local loopback callback server and wait for Google redirect
 */
async function startOAuthCallbackServer(
  expectedState: string
): Promise<{ redirectUri: string; codePromise: Promise<string> }> {
  const host = '127.0.0.1';
  const server = http.createServer();

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(0, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to start local OAuth callback server.');
  }

  const redirectUri = `http://${host}:${address.port}`;

  const codePromise = new Promise<string>((resolve, reject) => {
    let finished = false;

    const finish = (error?: Error, code?: string) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      server.close(() => {
        if (error) {
          reject(error);
          return;
        }
        if (!code) {
          reject(new Error('OAuth callback did not return an authorization code.'));
          return;
        }
        resolve(code);
      });
    };

    const timeout = setTimeout(() => {
      finish(new Error('OAuth authorization timed out. Run "BLANK auth" and try again.'));
    }, OAUTH_TIMEOUT_MS);

    server.on('request', (req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', `http://${host}:${address.port}`);

        if (requestUrl.pathname !== OAUTH_CALLBACK_PATH) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const oauthError = requestUrl.searchParams.get('error');
        const state = requestUrl.searchParams.get('state');
        const code = requestUrl.searchParams.get('code');

        if (oauthError) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(oauthErrorPage(`Authorization denied: ${oauthError}`));
          finish(new Error(`Google OAuth error: ${oauthError}`));
          return;
        }

        if (state !== expectedState) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(oauthErrorPage('Invalid state. Please return to the CLI and try again.'));
          finish(new Error('Invalid OAuth state returned by Google.'));
          return;
        }

        if (!code) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(oauthErrorPage('Missing authorization code.'));
          finish(new Error('Google OAuth callback missing authorization code.'));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(oauthSuccessPage());
        finish(undefined, code);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected OAuth callback failure.';
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(oauthErrorPage(message));
        finish(new Error(message));
      }
    });

    server.on('error', (error: Error) => {
      finish(error);
    });
  });

  return { redirectUri, codePromise };
}

/**
 * Refresh access token directly with Google
 */
async function refreshTokensWithGoogle(
  savedTokens: Credentials,
  credentials: GoogleOAuthCredentials
): Promise<Credentials> {
  if (!savedTokens.refresh_token) {
    throw new Error('No refresh token available.');
  }

  const oauth2Client = createOAuthClient(credentials);
  oauth2Client.setCredentials({ refresh_token: savedTokens.refresh_token });

  const { credentials: refreshedTokens } = await oauth2Client.refreshAccessToken();

  return {
    ...savedTokens,
    ...refreshedTokens,
    refresh_token: refreshedTokens.refresh_token || savedTokens.refresh_token,
  };
}

/**
 * Authenticate with Google Drive using locally stored OAuth client credentials
 */
export async function authenticateDrive(): Promise<void> {
  const oauthCredentials = await getGoogleOAuthCredentials();
  if (!oauthCredentials) {
    throw new Error(
      'Google OAuth credentials not configured. Run "BLANK auth" to set them up.'
    );
  }

  const savedTokens = await loadTokens();
  if (savedTokens) {
    const hasAccessToken = !!savedTokens.access_token;
    const isExpired = typeof savedTokens.expiry_date === 'number'
      ? savedTokens.expiry_date <= Date.now()
      : false;

    if (hasAccessToken && !isExpired) {
      await setupDriveClient(savedTokens, oauthCredentials);
      return;
    }

    if (savedTokens.refresh_token) {
      try {
        const refreshedTokens = await refreshTokensWithGoogle(savedTokens, oauthCredentials);
        await saveTokens(refreshedTokens);
        await setupDriveClient(refreshedTokens, oauthCredentials);
        return;
      } catch {
        // Refresh failed, user will need to run auth flow again
      }
    }

    if (hasAccessToken) {
      // Last attempt: try using existing token even if expiry metadata is missing/stale.
      await setupDriveClient(savedTokens, oauthCredentials);
      return;
    }
  }

  throw new Error(
    'Not authenticated. Run "BLANK auth" to connect to Google Drive.'
  );
}

/**
 * Perform full OAuth authentication flow
 */
export async function performOAuthFlow(
  openBrowser: (url: string) => Promise<void>,
  options?: {
    persistTokens?: boolean;
  }
): Promise<void> {
  const oauthCredentials = await getGoogleOAuthCredentials();
  if (!oauthCredentials) {
    throw new Error(
      'Google OAuth credentials not configured. Run "BLANK auth" to set them up.'
    );
  }

  const state = toBase64Url(crypto.randomBytes(24));
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const { redirectUri, codePromise } = await startOAuthCallbackServer(state);
  const oauth2Client = createOAuthClient(oauthCredentials, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  await openBrowser(authUrl);

  const code = await codePromise;
  const { tokens } = await oauth2Client.getToken({
    code,
    codeVerifier,
    redirect_uri: redirectUri,
  });

  if (!tokens.access_token && !tokens.refresh_token) {
    throw new Error('Google OAuth completed but no tokens were returned.');
  }

  if (options?.persistTokens !== false) {
    await saveTokens(tokens);
  }
  await setupDriveClient(tokens, oauthCredentials);
}

/**
 * Persist currently authenticated Google tokens to encrypted local storage.
 * Requires vault keys to be available (vault unlocked).
 */
export async function persistCurrentGoogleTokens(): Promise<void> {
  if (!authClient?.credentials) {
    throw new Error('No authenticated Google session to persist.');
  }
  await saveTokens(authClient.credentials);
}

/**
 * Setup Drive client with tokens
 */
async function setupDriveClient(
  tokens: Credentials,
  credentials: GoogleOAuthCredentials
): Promise<void> {
  authClient = createOAuthClient(credentials);
  authClient.setCredentials(tokens);

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
export async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const drive = getDriveClient();

  const escapedName = name.replace(/'/g, "\\'");
  let query = `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    query = `'${parentId}' in parents and ${query}`;
  }

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name, createdTime)',
    orderBy: 'createdTime asc',
    pageSize: 1,
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
export async function getOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const existingId = await findFolder(name, parentId);
  if (existingId) {
    return existingId;
  }
  return createFolder(name, parentId);
}

async function getPublicRootFolderId(): Promise<string> {
  if (cachedPublicRootFolderId) {
    return cachedPublicRootFolderId;
  }

  if (publicRootFolderInitPromise) {
    return publicRootFolderInitPromise;
  }

  const listPublicRootFolders = async (): Promise<drive_v3.Schema$File[]> => {
    const drive = getDriveClient();
    const escapedRootName = PUBLIC_ROOT_FOLDER_NAME.replace(/'/g, "\\'");
    const response = await drive.files.list({
      q: `'root' in parents and name='${escapedRootName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime asc',
      pageSize: 1000,
    });
    return response.data.files || [];
  };

  const moveFolderChildren = async (sourceFolderId: string, targetFolderId: string): Promise<void> => {
    if (sourceFolderId === targetFolderId) {
      return;
    }

    const drive = getDriveClient();
    const response = await drive.files.list({
      q: `'${sourceFolderId}' in parents and trashed=false`,
      fields: 'files(id)',
      pageSize: 1000,
    });

    for (const child of response.data.files || []) {
      if (!child.id) {
        continue;
      }

      await drive.files.update({
        fileId: child.id,
        addParents: targetFolderId,
        removeParents: sourceFolderId,
        fields: 'id',
      });
    }
  };

  publicRootFolderInitPromise = (async () => {
    const drive = getDriveClient();
    const existingRoots = await listPublicRootFolders();
    let rootId = existingRoots[0]?.id || null;

    if (!rootId) {
      rootId = await createFolder(PUBLIC_ROOT_FOLDER_NAME, 'root');
    }

    if (!rootId) {
      throw new Error('Failed to resolve BlankDrive root folder.');
    }

    // Consolidate duplicate BlankDrive roots caused by older parallel creation races.
    for (const duplicate of existingRoots.slice(1)) {
      if (!duplicate.id) {
        continue;
      }

      try {
        await moveFolderChildren(duplicate.id, rootId);
        await drive.files.delete({ fileId: duplicate.id });
      } catch {
        // Keep duplicate if we cannot safely move/delete it.
      }
    }

    cachedPublicRootFolderId = rootId;
    return rootId;
  })().finally(() => {
    publicRootFolderInitPromise = null;
  });

  return publicRootFolderInitPromise;
}

async function getPublicContentFolderId(): Promise<string> {
  if (cachedPublicContentFolderId) {
    return cachedPublicContentFolderId;
  }

  if (publicContentFolderInitPromise) {
    return publicContentFolderInitPromise;
  }

  publicContentFolderInitPromise = (async () => {
    const rootId = await getPublicRootFolderId();
    const folderName = await getPublicContentFolderName();

    if (!folderName) {
      throw new Error('Public storage folder is not configured. Run "BLANK settings --folder <name>" first.');
    }

    const folderId = await getOrCreateFolder(folderName, rootId);
    cachedPublicContentFolderId = folderId;
    return folderId;
  })().finally(() => {
    publicContentFolderInitPromise = null;
  });

  return publicContentFolderInitPromise;
}

async function findPublicFileByName(fileName: string): Promise<string | null> {
  const drive = getDriveClient();
  const parentId = await getPublicContentFolderId();
  const escapedName = fileName.replace(/'/g, "\\'");

  const response = await drive.files.list({
    q: `'${parentId}' in parents and name='${escapedName}' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  const files = response.data.files;
  if (files && files.length > 0) {
    return files[0]!.id || null;
  }

  return null;
}

async function listPublicModeFiles(namePattern?: string): Promise<drive_v3.Schema$File[]> {
  const drive = getDriveClient();
  const contentFolderId = await getPublicContentFolderId();
  const escapedPattern = namePattern ? namePattern.replace(/'/g, "\\'") : undefined;

  let query = `'${contentFolderId}' in parents and trashed=false`;
  if (escapedPattern) {
    query += ` and name contains '${escapedPattern}'`;
  }

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name, size, createdTime, modifiedTime)',
    pageSize: 1000,
  });

  return response.data.files || [];
}

// ============================================================================
// HIDDEN APPDATAFOLDER FUNCTIONS - Files stored here are INVISIBLE to users
// ============================================================================

/**
 * Upload a file to cloud storage based on configured mode:
 * - hidden: appDataFolder (invisible in Drive UI)
 * - public: BlankDrive/<configured-folder>
 */
export async function uploadToAppData(
  filePath: string,
  fileName: string,
  onProgress?: (bytesUploaded: number, totalBytes: number) => void
): Promise<string> {
  const drive = getDriveClient();
  const mode = await getCloudStorageMode();

  const stats = await fs.stat(filePath);
  const totalBytes = stats.size;

  const fileMetadata: drive_v3.Schema$File = { name: fileName };
  if (mode === 'hidden') {
    fileMetadata.parents = ['appDataFolder']; // Hidden mode
  } else {
    const parentId = await getPublicContentFolderId();
    fileMetadata.parents = [parentId];
  }

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
  const mode = await getCloudStorageMode();

  const { Readable } = await import('stream');
  const stream = Readable.from(data);

  const fileMetadata: drive_v3.Schema$File = { name: fileName };
  if (mode === 'hidden') {
    fileMetadata.parents = ['appDataFolder'];
  } else {
    const parentId = await getPublicContentFolderId();
    fileMetadata.parents = [parentId];
  }

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
  const mode = await getCloudStorageMode();

  if (mode === 'public') {
    return listPublicModeFiles(namePattern);
  }

  const drive = getDriveClient();
  const escapedPattern = namePattern ? namePattern.replace(/'/g, "\\'") : undefined;
  let query = "'appDataFolder' in parents and trashed=false";
  if (escapedPattern) {
    query += ` and name contains '${escapedPattern}'`;
  }

  const response = await drive.files.list({
    spaces: 'appDataFolder',
    q: query,
    fields: 'files(id, name, size, createdTime, modifiedTime)',
    pageSize: 1000,
  });

  return response.data.files || [];
}

/**
 * Find a file in appDataFolder by exact name
 */
export async function findAppDataFile(fileName: string): Promise<string | null> {
  const mode = await getCloudStorageMode();
  if (mode === 'public') {
    return findPublicFileByName(fileName);
  }

  const drive = getDriveClient();
  const escapedName = fileName.replace(/'/g, "\\'");

  const response = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name='${escapedName}' and 'appDataFolder' in parents and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
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

  // First get file size (only if progress tracking is needed)
  let totalBytes = 0;
  if (onProgress) {
    const fileMeta = await drive.files.get({
      fileId,
      fields: 'size',
    });
    totalBytes = parseInt(fileMeta.data.size || '0', 10);
  }

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
 * Download a text file from appDataFolder
 */
export async function downloadAppDataToText(fileId: string): Promise<string> {
  const drive = getDriveClient();

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );

  return typeof response.data === 'string'
    ? response.data
    : String(response.data ?? '');
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
  const mode = await getCloudStorageMode();

  try {
    const drive = getDriveClient();
    if (mode === 'hidden') {
      await drive.files.list({
        spaces: 'appDataFolder',
        pageSize: 1,
      });
    } else {
      await getPublicContentFolderId();
    }
    return true;
  } catch (error) {
    if (
      error instanceof Error
      && (error.message.includes('insufficient') || error.message.includes('permission'))
    ) {
      return false;
    }
    throw error;
  }
}
