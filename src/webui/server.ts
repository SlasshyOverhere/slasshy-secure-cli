import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  addFileEntry,
  addEntry,
  addNoteEntry,
  deleteEntry,
  getEntry,
  getFileData,
  getFileEntry,
  getNoteEntry,
  getStats,
  getVaultIndex,
  getVaultPaths,
  initVault,
  isUnlocked,
  listEntries,
  lock,
  toggleFavorite,
  unlock,
  updateEntry,
  updateNoteEntry,
  vaultExists,
} from '../storage/vault/index.js';
import {
  downloadFileFromCloud,
  isCloudSyncAvailable,
  type CloudFileChunk,
} from '../storage/drive/index.js';
import { renderWebUiHtml } from './template.js';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 4310;
const MAX_JSON_REQUEST_BYTES = 1_000_000;
const MIN_UPLOAD_CHUNK_BYTES = 256 * 1024;
const MAX_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_SESSION_AGE_MS = 60 * 60 * 1000;
const CLI_RUN_TIMEOUT_MS = 120_000;
const CLI_RUN_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const BLOCKED_WEB_CLI_COMMANDS = new Set(['web', 'ui']);

const execFileAsync = promisify(execFile);

type JsonBody = Record<string, unknown>;

interface UploadSession {
  uploadId: string;
  uploadDir: string;
  uploadPath: string;
  entryTitle: string;
  notes?: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number;
  receivedBytes: number;
  nextChunkIndex: number;
  updatedAt: number;
}

interface CliRunResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

const uploadSessions = new Map<string, UploadSession>();

class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface WebUiServerOptions {
  host?: string;
  port?: number;
}

export interface WebUiServerHandle {
  url: string;
  close: () => Promise<void>;
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string, nonce: string): void {
  setSecurityHeaders(res);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`,
  });
  res.end(html);
}

function sendMethodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'Method not allowed.' });
}

function isWriteMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseHostName(hostHeader: string | undefined): string | null {
  if (!hostHeader) {
    return null;
  }

  const host = hostHeader.trim().toLowerCase();
  if (!host) {
    return null;
  }

  if (host.startsWith('[')) {
    const closingIndex = host.indexOf(']');
    if (closingIndex === -1) {
      return null;
    }
    return host.slice(1, closingIndex);
  }

  const portSeparator = host.indexOf(':');
  if (portSeparator === -1) {
    return host;
  }

  return host.slice(0, portSeparator);
}

function isLoopbackHostName(hostName: string | null): boolean {
  if (!hostName) {
    return false;
  }
  if (hostName === 'localhost' || hostName === '::1' || hostName === '127.0.0.1') {
    return true;
  }
  if (hostName.startsWith('127.')) {
    return true;
  }
  return false;
}

function requireLocalhostRequest(req: IncomingMessage): void {
  const hostName = parseHostName(headerValue(req.headers.host));
  if (!isLoopbackHostName(hostName)) {
    throw new HttpError(403, 'Web UI is only accessible via loopback (localhost / 127.0.0.1 / ::1).');
  }
}

function requireUiWriteGuard(req: IncomingMessage): void {
  const value = headerValue(req.headers['x-blankdrive-ui']);
  if (value !== '1') {
    throw new HttpError(403, 'Forbidden request.');
  }
}

function toOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.length === 0 ? undefined : value;
}

function readString(
  body: JsonBody,
  key: string,
  options: {
    required?: boolean;
    maxLength: number;
    trim?: boolean;
    allowEmpty?: boolean;
  },
): string | undefined {
  const raw = body[key];
  const required = options.required ?? false;
  const trim = options.trim ?? false;
  const allowEmpty = options.allowEmpty ?? true;

  if (raw === undefined || raw === null) {
    if (required) {
      throw new HttpError(400, `${key} is required.`);
    }
    return undefined;
  }

  if (typeof raw !== 'string') {
    throw new HttpError(400, `${key} must be a string.`);
  }

  const value = trim ? raw.trim() : raw;
  if (!allowEmpty && value.length === 0) {
    throw new HttpError(400, `${key} cannot be empty.`);
  }
  if (value.length > options.maxLength) {
    throw new HttpError(400, `${key} exceeds max length.`);
  }

  return value;
}

function readBoolean(body: JsonBody, key: string): boolean | undefined {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'boolean') {
    throw new HttpError(400, `${key} must be a boolean.`);
  }
  return raw;
}

function readInteger(
  body: JsonBody,
  key: string,
  options: { required?: boolean; min?: number; max?: number },
): number | undefined {
  const raw = body[key];
  const required = options.required ?? false;
  if (raw === undefined || raw === null) {
    if (required) {
      throw new HttpError(400, `${key} is required.`);
    }
    return undefined;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new HttpError(400, `${key} must be an integer.`);
  }
  if (options.min !== undefined && raw < options.min) {
    throw new HttpError(400, `${key} must be >= ${options.min}.`);
  }
  if (options.max !== undefined && raw > options.max) {
    throw new HttpError(400, `${key} must be <= ${options.max}.`);
  }
  return raw;
}

function ensureValidUrl(value: string | undefined, key: string): void {
  if (!value) {
    return;
  }

  try {
    const url = new URL(value);
    if (!url.protocol.startsWith('http')) {
      throw new Error();
    }
  } catch {
    throw new HttpError(400, `${key} must be a valid URL.`);
  }
}

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_JSON_REQUEST_BYTES): Promise<JsonBody> {
  if (!req.method || req.method === 'GET' || req.method === 'HEAD') {
    return {};
  }

  const chunks: Buffer[] = [];
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', resolve);
    req.on('error', reject);
  });

  if (chunks.length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'JSON body must be an object.');
  }

  return parsed as JsonBody;
}

async function readBinaryBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  if (!req.method || req.method === 'GET' || req.method === 'HEAD') {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, 'Chunk exceeds allowed size.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', resolve);
    req.on('error', reject);
  });

  return Buffer.concat(chunks);
}

async function cleanupUploadSession(uploadId: string): Promise<void> {
  const session = uploadSessions.get(uploadId);
  if (!session) {
    return;
  }

  uploadSessions.delete(uploadId);
  await fs.unlink(session.uploadPath).catch(() => {});
  await fs.rm(session.uploadDir, { recursive: true, force: true }).catch(() => {});
}

async function cleanupExpiredUploadSessions(): Promise<void> {
  const now = Date.now();
  const expiredIds: string[] = [];
  for (const [uploadId, session] of uploadSessions) {
    if (now - session.updatedAt > MAX_UPLOAD_SESSION_AGE_MS) {
      expiredIds.push(uploadId);
    }
  }

  await Promise.all(expiredIds.map((uploadId) => cleanupUploadSession(uploadId)));
}

function parseCliCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (ch === '\\') {
      const next = input[i + 1];
      if (next !== undefined) {
        current += next;
        i++;
        continue;
      }
      current += ch;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (quote) {
    throw new HttpError(400, 'Unclosed quote in command.');
  }
  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

async function resolveCliEntrypoint(): Promise<string> {
  const cliPath = path.join(process.cwd(), 'dist', 'index.js');
  try {
    await fs.access(cliPath);
    return cliPath;
  } catch {
    throw new HttpError(500, 'CLI runtime not found. Run "npm run build" and restart web UI.');
  }
}

function normalizeExecText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf-8');
  }
  return '';
}

async function runCliCommand(commandLine: string): Promise<CliRunResult> {
  const args = parseCliCommandLine(commandLine.trim());
  if (args.length === 0) {
    throw new HttpError(400, 'Command is required.');
  }

  const command = args[0]!.toLowerCase();
  if (BLOCKED_WEB_CLI_COMMANDS.has(command)) {
    throw new HttpError(400, `Command "${command}" is not allowed inside Web UI.`);
  }

  const cliEntrypoint = await resolveCliEntrypoint();

  try {
    const result = await execFileAsync(
      process.execPath,
      [cliEntrypoint, ...args],
      {
        cwd: process.cwd(),
        timeout: CLI_RUN_TIMEOUT_MS,
        maxBuffer: CLI_RUN_MAX_BUFFER_BYTES,
        windowsHide: true,
      },
    );

    return {
      command,
      args: args.slice(1),
      stdout: normalizeExecText(result.stdout),
      stderr: normalizeExecText(result.stderr),
      exitCode: 0,
      timedOut: false,
    };
  } catch (error) {
    const execError = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
      signal?: string | null;
      message?: string;
      killed?: boolean;
    };

    const timedOut = execError.signal === 'SIGTERM'
      && typeof execError.message === 'string'
      && execError.message.toLowerCase().includes('timed out');
    const fallbackMessage = execError.message || 'Command failed.';
    const stderr = normalizeExecText(execError.stderr) || fallbackMessage;
    const exitCode = typeof execError.code === 'number' ? execError.code : (timedOut ? null : 1);

    return {
      command,
      args: args.slice(1),
      stdout: normalizeExecText(execError.stdout),
      stderr,
      exitCode,
      timedOut,
    };
  }
}

function ensureUnlocked(): void {
  if (!isUnlocked()) {
    throw new HttpError(423, 'Vault is locked.');
  }
}

function sanitizeUploadFileName(fileName: string): string {
  const baseName = path.basename(fileName).trim();
  if (!baseName) {
    throw new HttpError(400, 'fileName is invalid.');
  }

  const safeName = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new HttpError(400, 'fileName is invalid.');
  }

  if (safeName.length > 255) {
    throw new HttpError(400, 'fileName exceeds max length.');
  }

  return safeName;
}

function normalizeDownloadFileName(fileName: string): string {
  const safeName = sanitizeUploadFileName(fileName);
  return safeName.replace(/"/g, '');
}

type KnownEntryType = 'password' | 'note' | 'file';

function getEntryType(id: string): KnownEntryType | null {
  const index = getVaultIndex();
  const entry = index?.entries[id];
  if (!entry) {
    return null;
  }

  if (entry.entryType === 'note') {
    return 'note';
  }
  if (entry.entryType === 'file') {
    return 'file';
  }

  return 'password';
}

async function getEntryDetails(id: string, type: KnownEntryType): Promise<unknown | null> {
  if (type === 'note') {
    return getNoteEntry(id);
  }
  if (type === 'file') {
    return getFileEntry(id);
  }
  return getEntry(id);
}

function parseEntryRoute(pathname: string): { id: string; action?: string } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'entries') {
    return null;
  }

  const rawId = parts[2];
  if (!rawId) {
    return null;
  }

  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    throw new HttpError(400, 'Invalid entry id.');
  }

  const action = parts.length > 3 ? parts[3] : undefined;
  return { id, action };
}

function parseFileDownloadRoute(pathname: string): { id: string } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'files' || parts[3] !== 'download') {
    return null;
  }

  const rawId = parts[2];
  if (!rawId) {
    return null;
  }

  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    throw new HttpError(400, 'Invalid entry id.');
  }

  return { id };
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
): Promise<void> {
  const method = req.method ?? 'GET';
  const pathname = requestUrl.pathname;

  if (isWriteMethod(method)) {
    requireUiWriteGuard(req);
  }

  if (pathname === '/api/status') {
    if (method !== 'GET') {
      sendMethodNotAllowed(res);
      return;
    }

    const exists = await vaultExists();
    const unlocked = isUnlocked();

    sendJson(res, 200, {
      vaultExists: exists,
      unlocked,
      stats: unlocked ? getStats() : null,
      vaultPath: getVaultPaths().dir,
    });
    return;
  }

  if (pathname === '/api/init') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }

    const body = await readJsonBody(req);
    const password = readString(body, 'password', {
      required: true,
      maxLength: 4096,
      trim: false,
      allowEmpty: false,
    });

    if (await vaultExists()) {
      throw new HttpError(409, 'Vault already exists.');
    }

    await initVault(password!);
    sendJson(res, 201, {
      initialized: true,
      unlocked: true,
      stats: getStats(),
    });
    return;
  }

  if (pathname === '/api/unlock') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }

    const body = await readJsonBody(req);
    const password = readString(body, 'password', {
      required: true,
      maxLength: 4096,
      trim: false,
      allowEmpty: false,
    });

    if (!await vaultExists()) {
      throw new HttpError(404, 'Vault not initialized.');
    }

    await unlock(password!);
    sendJson(res, 200, {
      unlocked: true,
      stats: getStats(),
    });
    return;
  }

  if (pathname === '/api/lock') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }
    if (isUnlocked()) {
      lock();
    }
    const activeUploadIds = [...uploadSessions.keys()];
    await Promise.all(activeUploadIds.map((uploadId) => cleanupUploadSession(uploadId)));
    sendJson(res, 200, { locked: true });
    return;
  }

  if (pathname === '/api/entries' && method === 'GET') {
    ensureUnlocked();
    let entries = await listEntries();

    const query = requestUrl.searchParams.get('query')?.toLowerCase().trim();
    if (query) {
      entries = entries.filter((entry) => entry.title.toLowerCase().includes(query));
    }

    const typeFilter = requestUrl.searchParams.get('type');
    if (typeFilter === 'password' || typeFilter === 'note' || typeFilter === 'file') {
      entries = entries.filter((entry) => {
        const type = entry.entryType || 'password';
        return type === typeFilter;
      });
    }

    sendJson(res, 200, { entries });
    return;
  }

  if (pathname === '/api/entries' && method === 'POST') {
    ensureUnlocked();
    const body = await readJsonBody(req);
    const type = readString(body, 'type', {
      required: false,
      maxLength: 32,
      trim: true,
      allowEmpty: false,
    });
    const selectedType = type === 'note' ? 'note' : 'password';
    const title = readString(body, 'title', {
      required: true,
      maxLength: 256,
      trim: true,
      allowEmpty: false,
    })!;

    if (selectedType === 'note') {
      const content = readString(body, 'content', {
        required: true,
        maxLength: 1048576,
        trim: false,
        allowEmpty: true,
      })!;
      const favorite = readBoolean(body, 'favorite');
      const entry = await addNoteEntry(title, content, favorite);
      sendJson(res, 201, { entry });
      return;
    }

    const username = toOptional(readString(body, 'username', {
      required: false,
      maxLength: 256,
      trim: false,
      allowEmpty: true,
    }));
    const password = toOptional(readString(body, 'password', {
      required: false,
      maxLength: 4096,
      trim: false,
      allowEmpty: true,
    }));
    const url = readString(body, 'url', {
      required: false,
      maxLength: 2048,
      trim: true,
      allowEmpty: true,
    });
    ensureValidUrl(url, 'url');
    const notes = toOptional(readString(body, 'notes', {
      required: false,
      maxLength: 65536,
      trim: false,
      allowEmpty: true,
    }));
    const category = readString(body, 'category', {
      required: false,
      maxLength: 64,
      trim: true,
      allowEmpty: true,
    });

    const entry = await addEntry(title, {
      username,
      password,
      url: toOptional(url),
      notes,
      category: toOptional(category),
    });

    sendJson(res, 201, { entry });
    return;
  }

  if (pathname === '/api/files/upload/start') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }

    ensureUnlocked();
    await cleanupExpiredUploadSessions();

    const body = await readJsonBody(req);
    const fileName = readString(body, 'fileName', {
      required: true,
      maxLength: 512,
      trim: true,
      allowEmpty: false,
    })!;
    const title = readString(body, 'title', {
      required: false,
      maxLength: 256,
      trim: true,
      allowEmpty: true,
    });
    const notes = readString(body, 'notes', {
      required: false,
      maxLength: 65536,
      trim: false,
      allowEmpty: true,
    });
    const totalSize = readInteger(body, 'totalSize', {
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    })!;
    const requestedChunkSize = readInteger(body, 'chunkSize', {
      required: false,
      min: MIN_UPLOAD_CHUNK_BYTES,
      max: MAX_UPLOAD_CHUNK_BYTES,
    });

    const safeFileName = sanitizeUploadFileName(fileName);
    const entryTitle = toOptional(title) ?? safeFileName;
    const chunkSize = requestedChunkSize ?? MAX_UPLOAD_CHUNK_BYTES;
    const totalChunks = totalSize === 0 ? 0 : Math.ceil(totalSize / chunkSize);
    const uploadId = randomUUID();
    const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blankdrive-web-upload-'));
    const uploadPath = path.join(uploadDir, safeFileName);

    await fs.writeFile(uploadPath, Buffer.alloc(0), { flag: 'wx' });

    uploadSessions.set(uploadId, {
      uploadId,
      uploadDir,
      uploadPath,
      entryTitle,
      notes: toOptional(notes),
      totalSize,
      chunkSize,
      totalChunks,
      receivedChunks: 0,
      receivedBytes: 0,
      nextChunkIndex: 0,
      updatedAt: Date.now(),
    });

    sendJson(res, 201, {
      uploadId,
      chunkSize,
      totalChunks,
    });
    return;
  }

  if (pathname === '/api/files/upload/chunk') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }

    ensureUnlocked();
    await cleanupExpiredUploadSessions();

    const uploadId = requestUrl.searchParams.get('uploadId')?.trim();
    const indexRaw = requestUrl.searchParams.get('index')?.trim();
    if (!uploadId) {
      throw new HttpError(400, 'uploadId is required.');
    }
    if (!indexRaw) {
      throw new HttpError(400, 'index is required.');
    }

    const index = Number.parseInt(indexRaw, 10);
    if (Number.isNaN(index) || index < 0) {
      throw new HttpError(400, 'index must be a non-negative integer.');
    }

    const session = uploadSessions.get(uploadId);
    if (!session) {
      throw new HttpError(404, 'Upload session not found or expired.');
    }
    if (session.totalChunks === 0) {
      throw new HttpError(400, 'Zero-byte uploads do not accept chunks.');
    }
    if (index !== session.nextChunkIndex) {
      throw new HttpError(409, `Expected chunk ${session.nextChunkIndex}, received ${index}.`);
    }

    const expectedBytes = index === session.totalChunks - 1
      ? session.totalSize - (session.chunkSize * (session.totalChunks - 1))
      : session.chunkSize;

    const chunkBuffer = await readBinaryBody(req, session.chunkSize + 1);
    if (chunkBuffer.length !== expectedBytes) {
      throw new HttpError(400, `Chunk ${index} size mismatch. Expected ${expectedBytes} bytes.`);
    }

    await fs.appendFile(session.uploadPath, chunkBuffer);

    session.receivedChunks += 1;
    session.receivedBytes += chunkBuffer.length;
    session.nextChunkIndex += 1;
    session.updatedAt = Date.now();

    sendJson(res, 200, {
      uploadId,
      receivedChunks: session.receivedChunks,
      totalChunks: session.totalChunks,
      receivedBytes: session.receivedBytes,
      totalBytes: session.totalSize,
    });
    return;
  }

  if (pathname === '/api/files/upload/complete') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }

    ensureUnlocked();
    await cleanupExpiredUploadSessions();

    const body = await readJsonBody(req);
    const uploadId = readString(body, 'uploadId', {
      required: true,
      maxLength: 128,
      trim: true,
      allowEmpty: false,
    })!;
    const session = uploadSessions.get(uploadId);
    if (!session) {
      throw new HttpError(404, 'Upload session not found or expired.');
    }
    if (session.receivedChunks !== session.totalChunks || session.receivedBytes !== session.totalSize) {
      throw new HttpError(409, 'Upload is incomplete. Send all chunks before finalizing.');
    }

    try {
      const entry = await addFileEntry(session.entryTitle, session.uploadPath, session.notes);
      sendJson(res, 201, { entry });
      return;
    } finally {
      await cleanupUploadSession(uploadId);
    }
  }

  if (pathname === '/api/files/upload/abort') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }

    const body = await readJsonBody(req);
    const uploadId = readString(body, 'uploadId', {
      required: true,
      maxLength: 128,
      trim: true,
      allowEmpty: false,
    })!;

    await cleanupUploadSession(uploadId);
    sendJson(res, 200, { aborted: true });
    return;
  }

  if (pathname === '/api/files/upload') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }
    throw new HttpError(410, 'Legacy upload API removed. Use chunked upload endpoints.');
  }

  if (pathname === '/api/cli/run') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }

    const body = await readJsonBody(req);
    const command = readString(body, 'command', {
      required: true,
      maxLength: 2048,
      trim: true,
      allowEmpty: false,
    })!;
    const result = await runCliCommand(command);

    sendJson(res, 200, result);
    return;
  }

  const fileDownloadRoute = parseFileDownloadRoute(pathname);
  if (fileDownloadRoute) {
    if (method !== 'GET') {
      sendMethodNotAllowed(res);
      return;
    }

    ensureUnlocked();
    const { id } = fileDownloadRoute;
    if (getEntryType(id) !== 'file') {
      sendJson(res, 404, { error: 'File entry not found.' });
      return;
    }

    const fileEntry = await getFileEntry(id);
    if (!fileEntry) {
      sendJson(res, 404, { error: 'File entry not found.' });
      return;
    }

    let fileData: Buffer | null;
    try {
      fileData = await getFileData(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to read encrypted file data.';
      const lowerMessage = errorMessage.toLowerCase();
      const indexEntry = getVaultIndex()?.entries[id];
      const cloudChunks = (indexEntry?.cloudChunks as CloudFileChunk[] | undefined) ?? [];
      const shouldAttemptCloudDownload = cloudChunks.length > 0
        && (lowerMessage.includes('not found')
          || lowerMessage.includes('missing chunk')
          || lowerMessage.includes('deleted')
          || lowerMessage.includes('corrupted'));

      if (!shouldAttemptCloudDownload) {
        throw new HttpError(409, errorMessage);
      }

      try {
        const cloudAvailable = await isCloudSyncAvailable();
        if (!cloudAvailable) {
          throw new HttpError(409, 'Local file data is missing and cloud sync is not available.');
        }

        await downloadFileFromCloud(id, cloudChunks);
      } catch (cloudError) {
        if (cloudError instanceof HttpError) {
          throw cloudError;
        }
        if (cloudError instanceof Error) {
          throw new HttpError(409, cloudError.message);
        }
        throw cloudError;
      }

      try {
        fileData = await getFileData(id);
      } catch (retryError) {
        if (retryError instanceof Error) {
          throw new HttpError(409, retryError.message);
        }
        throw retryError;
      }
    }

    if (!fileData) {
      sendJson(res, 404, { error: 'Encrypted file data not found.' });
      return;
    }

    const downloadName = normalizeDownloadFileName(fileEntry.originalName);
    res.writeHead(200, {
      'content-type': fileEntry.mimeType || 'application/octet-stream',
      'content-length': String(fileData.byteLength),
      'content-disposition': `attachment; filename="${downloadName}"`,
      'cache-control': 'no-store',
    });
    res.end(fileData);
    return;
  }

  const entryRoute = parseEntryRoute(pathname);
  if (!entryRoute) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  ensureUnlocked();
  const { id, action } = entryRoute;
  const entryType = getEntryType(id);
  if (!entryType) {
    sendJson(res, 404, { error: 'Entry not found.' });
    return;
  }

  if (action === undefined) {
    if (method === 'GET') {
      const entry = await getEntryDetails(id, entryType);
      if (!entry) {
        sendJson(res, 404, { error: 'Entry not found.' });
        return;
      }

      sendJson(res, 200, { entry });
      return;
    }

    if (method === 'DELETE') {
      const deleted = await deleteEntry(id);
      if (!deleted) {
        sendJson(res, 404, { error: 'Entry not found.' });
        return;
      }

      sendJson(res, 200, { deleted: true });
      return;
    }

    if (method === 'PUT') {
      const body = await readJsonBody(req);

      if (entryType === 'file') {
        throw new HttpError(400, 'File entries are read-only in web UI.');
      }

      if (entryType === 'note') {
        const updates: Partial<{ title: string; content: string }> = {};
        const title = readString(body, 'title', {
          required: false,
          maxLength: 256,
          trim: true,
          allowEmpty: false,
        });
        const content = readString(body, 'content', {
          required: false,
          maxLength: 1048576,
          trim: false,
          allowEmpty: true,
        });
        if (title !== undefined) {
          updates.title = title;
        }
        if (content !== undefined) {
          updates.content = content;
        }

        const updated = await updateNoteEntry(id, updates);
        if (!updated) {
          sendJson(res, 404, { error: 'Entry not found.' });
          return;
        }

        sendJson(res, 200, { entry: updated });
        return;
      }

      const updates: Partial<{
        title: string;
        username: string;
        password: string;
        url: string;
        notes: string;
        category: string;
      }> = {};

      const title = readString(body, 'title', {
        required: false,
        maxLength: 256,
        trim: true,
        allowEmpty: false,
      });
      const username = readString(body, 'username', {
        required: false,
        maxLength: 256,
        trim: false,
        allowEmpty: true,
      });
      const password = readString(body, 'password', {
        required: false,
        maxLength: 4096,
        trim: false,
        allowEmpty: true,
      });
      const url = readString(body, 'url', {
        required: false,
        maxLength: 2048,
        trim: true,
        allowEmpty: true,
      });
      const notes = readString(body, 'notes', {
        required: false,
        maxLength: 65536,
        trim: false,
        allowEmpty: true,
      });
      const category = readString(body, 'category', {
        required: false,
        maxLength: 64,
        trim: true,
        allowEmpty: true,
      });

      ensureValidUrl(url, 'url');

      if (title !== undefined) {
        updates.title = title;
      }
      if (username !== undefined) {
        updates.username = username;
      }
      if (password !== undefined) {
        updates.password = password;
      }
      if (url !== undefined) {
        updates.url = url;
      }
      if (notes !== undefined) {
        updates.notes = notes;
      }
      if (category !== undefined) {
        updates.category = category;
      }

      const updated = await updateEntry(id, updates);
      if (!updated) {
        sendJson(res, 404, { error: 'Entry not found.' });
        return;
      }

      sendJson(res, 200, { entry: updated });
      return;
    }

    sendMethodNotAllowed(res);
    return;
  }

  if (action === 'favorite') {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }
    const result = await toggleFavorite(id);
    if (!result) {
      sendJson(res, 404, { error: 'Entry not found.' });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
}

async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const method = req.method ?? 'GET';
    requireLocalhostRequest(req);
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');

    if (requestUrl.pathname === '/' && method === 'GET') {
      const nonce = randomBytes(16).toString('base64');
      sendHtml(res, renderWebUiHtml(nonce), nonce);
      return;
    }

    if (requestUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApiRequest(req, res, requestUrl);
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }

    if (error instanceof Error) {
      console.error('Internal Server Error:', error);
      sendJson(res, 500, { error: 'Internal Server Error' });
      return;
    }

    console.error('Unknown Server Error:', error);
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function startWebUiServer(options: WebUiServerOptions = {}): Promise<WebUiServerHandle> {
  const requestedHost = options.host?.trim().toLowerCase();
  if (requestedHost && requestedHost !== 'localhost') {
    throw new Error('Web UI host is fixed to localhost.');
  }
  const host = DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const server = createServer((req, res) => {
    void requestHandler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Failed to resolve listening address.');
  }

  return {
    url: `http://${host}:${address.port}`,
    close: async (): Promise<void> => closeServer(server),
  };
}
