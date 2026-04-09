import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3410;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4310';

// Security: Validate environment variables
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('❌ Missing required environment variables');
  console.error('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env file');
  process.exit(1);
}

// Middleware
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// Rate limiting (simple in-memory implementation)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10;

function rateLimitMiddleware(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;

  // Clean old entries
  for (const [key, timestamp] of rateLimitStore.entries()) {
    if (timestamp < windowStart) {
      rateLimitStore.delete(key);
    }
  }

  // Check current request count
  const key = `${clientIP}:${req.path}`;
  const requests = Array.from(rateLimitStore.values()).filter(ts => ts > windowStart).length;

  if (requests >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  rateLimitStore.set(`${key}:${now}`, now);
  next();
}

app.use(rateLimitMiddleware);

// Google OAuth2 client configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${FRONTEND_URL}/api/oauth/callback`
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata'
];

/**
 * GET /api/oauth/generate-url
 * Generate OAuth authorization URL
 * Query params:
 *   - redirect_uri (optional) - custom redirect URI
 *   - state (optional) - pre-generated state from frontend
 */
// Simple in-memory store for code verifiers (use Redis in production)
const codeVerifierStore = new Map();

app.get('/api/oauth/generate-url', (req, res) => {
  try {
    // Use custom redirect URI if provided, otherwise use default
    const redirectUri = req.query.redirect_uri || `${FRONTEND_URL}/api/oauth/callback`;

    // Use frontend-provided state, code_challenge, and code_verifier
    const state = req.query.state;
    const codeChallenge = req.query.code_challenge;
    const codeChallengeMethod = req.query.code_challenge_method || 'S256';
    const codeVerifier = req.query.code_verifier;

    if (!state || !codeChallenge || !codeVerifier) {
      return res.status(400).json({
        error: 'Missing required parameters: state, code_challenge, and code_verifier are required'
      });
    }

    // Verify the code challenge matches the verifier
    const computedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    if (computedChallenge !== codeChallenge) {
      console.warn('⚠️ Code challenge mismatch!');
      console.log('  Expected:', codeChallenge.substring(0, 20));
      console.log('  Computed:', computedChallenge.substring(0, 20));
      // Continue anyway - let Google validate
    }

    // Store code verifier with state as key (expires in 10 minutes)
    codeVerifierStore.set(state, {
      codeVerifier, // Store the SAME verifier frontend used
      codeChallenge,
      redirectUri,
      createdAt: Date.now()
    });

    // Clean up old entries (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of codeVerifierStore.entries()) {
      if (value.createdAt < tenMinutesAgo) {
        codeVerifierStore.delete(key);
        console.log('🧹 Cleaned up expired code verifier for state:', key.substring(0, 10));
      }
    }

    console.log('💾 Stored code verifier for state:', state.substring(0, 10), '...');
    console.log('   Verifier (first 20):', codeVerifier.substring(0, 20), '...');
    console.log('   Challenge (first 20):', codeChallenge.substring(0, 20), '...');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      code_challenge: codeChallenge, // Use frontend's challenge
      code_challenge_method: codeChallengeMethod,
      state,
      redirect_uri: redirectUri,
    });

    res.json({
      authUrl,
      state,
      codeVerifier, // Return the SAME verifier for exchange
      redirectUri: redirectUri,
    });

    console.log('✓ Auth URL generated successfully');
  } catch (error) {
    console.error('❌ Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

/**
 * POST /api/oauth/exchange-code
 * Exchange authorization code for tokens
 */
app.post('/api/oauth/exchange-code', async (req, res) => {
  try {
    const { code, state, redirect_uri } = req.body;

    console.log('📥 Exchange request received:');
    console.log('  - Code length:', code?.length || 0);
    console.log('  - State:', state?.substring(0, 10), '...');
    console.log('  - Redirect URI:', redirect_uri);

    if (!code || !state) {
      console.error('❌ Missing required fields');
      return res.status(400).json({
        error: 'Missing code or state',
        received: { hasCode: !!code, hasState: !!state }
      });
    }

    // Retrieve stored code verifier using state
    const storedData = codeVerifierStore.get(state);
    if (!storedData) {
      console.error('❌ No code verifier found for state:', state.substring(0, 10));
      return res.status(400).json({
        error: 'Invalid or expired state. Please start the OAuth flow again.',
        hint: 'The code verifier was not found. This can happen if too much time passed between generating the auth URL and exchanging the code.'
      });
    }

    const { codeVerifier, redirectUri: storedRedirectUri, createdAt } = storedData;
    console.log('✅ Retrieved stored code verifier for state:', state.substring(0, 10));
    console.log('   Stored at:', new Date(createdAt).toISOString());
    console.log('   Age:', Math.round((Date.now() - createdAt) / 1000), 'seconds');

    // Verify redirect URI matches
    const redirectUri = redirect_uri || storedRedirectUri;
    if (redirectUri !== storedRedirectUri) {
      console.warn('⚠️ Redirect URI mismatch!');
      console.log('   Expected:', storedRedirectUri);
      console.log('   Got:', redirectUri);
    }

    console.log('🔄 Using redirect URI:', redirectUri);
    console.log('🔑 Code verifier (first 20 chars):', codeVerifier.substring(0, 20), '...');

    // Exchange code for tokens
    console.log('🔑 Exchanging code for tokens...');
    console.log('   Code (first 20):', code.substring(0, 20), '...');
    console.log('   Code verifier (first 20):', codeVerifier.substring(0, 20), '...');
    console.log('   Redirect URI:', redirectUri);

    // Try manual token exchange to ensure code_verifier is sent
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const postData = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });

    console.log('📤 Sending POST to Google:');
    console.log('   URL:', tokenUrl);
    console.log('   Body:', postData.toString());
    console.log('   Body keys:', [...postData.keys()].join(', '));

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: postData.toString(),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('❌ Google returned error:', data);
        throw new Error(`Google OAuth error: ${data.error_description || data.error}`);
      }

      console.log('✅ Google returned tokens');
      const tokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expiry_date: data.expires_in ? Date.now() + (data.expires_in * 1000) : undefined,
      };

      console.log('   Has access_token:', !!tokens.access_token);
      console.log('   Has refresh_token:', !!tokens.refresh_token);

      if (!tokens.access_token) {
        console.error('❌ No access token in response');
        throw new Error('No access token received');
      }

      // Clean up used code verifier
      codeVerifierStore.delete(state);
      console.log('🧹 Cleaned up used code verifier');

      res.json({
        success: true,
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date,
        },
      });

      console.log('✓ Exchange completed successfully');
    } catch (innerError) {
      // Error from manual fetch request
      console.error('❌ Manual token exchange failed:', innerError);
      throw innerError;
    }
  } catch (error) {
    // Error from outer try block
    console.error('❌ Error exchanging code:', error);
    console.error('  Error details:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });

    res.status(500).json({
      error: 'Failed to exchange authorization code',
      message: error.message,
      details: error.response?.data || error.toString(),
    });
  }
});

/**
 * POST /api/oauth/refresh-token
 * Refresh an expired access token
 */
app.post('/api/oauth/refresh-token', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'Missing refresh_token' });
    }

    oauth2Client.setCredentials({ refresh_token });
    const { credentials } = await oauth2Client.refreshAccessToken();

    res.json({
      success: true,
      tokens: {
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date,
      },
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({
      error: 'Failed to refresh token',
      message: error.message,
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /
 * API info
 */
app.get('/', (req, res) => {
  res.json({
    service: 'BlankDrive OAuth Backend',
    version: '1.0.0',
    endpoints: {
      'GET /api/oauth/generate-url': 'Generate OAuth authorization URL',
      'POST /api/oauth/exchange-code': 'Exchange code for tokens',
      'POST /api/oauth/refresh-token': 'Refresh access token',
      'GET /health': 'Health check',
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ BlankDrive OAuth Backend running on http://localhost:${PORT}`);
  console.log(`📍 Frontend URL: ${FRONTEND_URL}`);
  console.log(`🔐 Google Client ID: ${process.env.GOOGLE_CLIENT_ID.substring(0, 20)}...`);
});

export default app;
