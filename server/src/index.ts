import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import CryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { errorPage, successPage } from './html.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'default-key-change-in-production';
const REDIRECT_URI = `${SERVER_URL}/oauth/callback`;

// Validate required environment variables
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  process.exit(1);
}

// In-memory session store (use Redis in production for multiple instances)
const pendingSessions = new Map<string, {
  createdAt: number;
  tokens?: object;
  error?: string;
}>();

// Clean up old sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [sessionId, session] of pendingSessions.entries()) {
    if (now - session.createdAt > maxAge) {
      pendingSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000);

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS === '*' ? '*' : process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true,
}));
app.use(express.json());

// Create OAuth2 client
function createOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start OAuth flow - returns auth URL and session ID
app.get('/oauth/start', (req, res) => {
  const sessionId = uuidv4();
  const oauth2Client = createOAuth2Client();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata'  // Hidden app data folder
    ],
    state: sessionId,
    prompt: 'consent', // Force consent to get refresh token
  });

  pendingSessions.set(sessionId, { createdAt: Date.now() });

  res.json({
    authUrl,
    sessionId,
    expiresIn: 600, // 10 minutes
  });
});

// OAuth callback - handles Google's redirect
app.get('/oauth/callback', async (req, res) => {
  const { code, state: sessionId, error } = req.query;

  if (error) {
    if (sessionId && typeof sessionId === 'string') {
      pendingSessions.set(sessionId, {
        createdAt: Date.now(),
        error: error as string,
      });
    }
    return res.send(errorPage('Authorization denied: ' + error));
  }

  if (!code || !sessionId || typeof sessionId !== 'string') {
    return res.status(400).send(errorPage('Invalid callback parameters'));
  }

  const session = pendingSessions.get(sessionId);
  if (!session) {
    return res.status(400).send(errorPage('Session expired or invalid'));
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);

    // Store tokens in session
    pendingSessions.set(sessionId, {
      createdAt: session.createdAt,
      tokens,
    });

    res.send(successPage());
  } catch (err) {
    console.error('Token exchange error:', err);
    pendingSessions.set(sessionId, {
      createdAt: session.createdAt,
      error: 'Failed to exchange authorization code',
    });
    res.status(500).send(errorPage('Failed to complete authorization'));
  }
});

// Poll for tokens - CLI calls this to check if auth is complete
app.get('/oauth/poll/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { encryptionKey } = req.query;

  const session = pendingSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ status: 'not_found', message: 'Session not found or expired' });
  }

  if (session.error) {
    pendingSessions.delete(sessionId);
    return res.json({ status: 'error', error: session.error });
  }

  if (session.tokens) {
    // Encrypt tokens before sending if encryption key provided
    let tokenData: string;
    if (encryptionKey && typeof encryptionKey === 'string') {
      tokenData = CryptoJS.AES.encrypt(
        JSON.stringify(session.tokens),
        encryptionKey
      ).toString();
    } else {
      tokenData = JSON.stringify(session.tokens);
    }

    pendingSessions.delete(sessionId);
    return res.json({
      status: 'complete',
      tokens: tokenData,
      encrypted: !!encryptionKey,
    });
  }

  return res.json({ status: 'pending', message: 'Waiting for user authorization' });
});

// Refresh token endpoint
app.post('/oauth/refresh', async (req, res) => {
  const { refreshToken, encryptionKey } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await oauth2Client.refreshAccessToken();

    let tokenData: string;
    if (encryptionKey) {
      tokenData = CryptoJS.AES.encrypt(
        JSON.stringify(credentials),
        encryptionKey
      ).toString();
    } else {
      tokenData = JSON.stringify(credentials);
    }

    res.json({
      status: 'success',
      tokens: tokenData,
      encrypted: !!encryptionKey,
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(401).json({ error: 'Failed to refresh token' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║         Slasshy OAuth Server                      ║
  ╠═══════════════════════════════════════════════════╣
  ║  Status:    Running                               ║
  ║  Port:      ${String(PORT).padEnd(37)}║
  ║  Callback:  ${REDIRECT_URI.padEnd(37).slice(0, 37)}║
  ╚═══════════════════════════════════════════════════╝
  `);
});

export default app;
