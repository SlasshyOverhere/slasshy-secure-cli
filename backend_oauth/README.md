# BlankDrive OAuth Backend

A lightweight, secure OAuth2 backend service for handling Google Drive authentication in BlankDrive.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd backend_oauth
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Get these from https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret-here

PORT=3410
FRONTEND_URL=http://localhost:4310
```

### 3. Start Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server will start on `http://localhost:3410`

## 🔧 Setup Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Google Drive API**
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → OAuth client ID**
6. Application type: **Desktop app**
7. Authorized redirect URIs: `http://localhost:4310/api/oauth/callback`
8. Copy Client ID and Client Secret to `.env`

## 📡 API Endpoints

### Generate Authorization URL

**GET** `/api/oauth/generate-url`

Generate OAuth authorization URL with PKCE.

**Response:**
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "random-state-string",
  "codeVerifier": "pkce-code-verifier"
}
```

### Exchange Code for Tokens

**POST** `/api/oauth/exchange-code`

Exchange authorization code for access/refresh tokens.

**Request Body:**
```json
{
  "code": "authorization-code-from-google",
  "codeVerifier": "pkce-code-verifier"
}
```

**Response:**
```json
{
  "success": true,
  "tokens": {
    "access_token": "ya29.a0AfH6SMC...",
    "refresh_token": "1//0g...",
    "expiry_date": 1234567890
  }
}
```

### Refresh Access Token

**POST** `/api/oauth/refresh-token`

Refresh an expired access token.

**Request Body:**
```json
{
  "refresh_token": "1//0g..."
}
```

**Response:**
```json
{
  "success": true,
  "tokens": {
    "access_token": "ya29.a0AfH6SMC...",
    "expiry_date": 1234567890
  }
}
```

### Health Check

**GET** `/health`

Check if the service is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-04-10T00:00:00.000Z"
}
```

## 🔒 Security Features

- ✅ **PKCE (Proof Key for Code Exchange)** - Prevents authorization code interception
- ✅ **Rate Limiting** - Protects against abuse (default: 10 req/min per IP)
- ✅ **CORS Protection** - Only allows requests from configured frontend
- ✅ **Environment Variables** - Secrets never hardcoded
- ✅ **No Token Storage** - Tokens returned to client immediately, not stored server-side

## 🏗️ Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│   BlankDrive│         │  OAuth Backend   │         │    Google    │
│   Frontend  │◄───────►│  (This Service)  │◄───────►│     OAuth    │
│             │  HTTP   │                  │  HTTPS  │              │
└─────────────┘         └──────────────────┘         └──────────────┘
```

**Flow:**
1. Frontend requests auth URL from backend
2. Backend generates URL with PKCE and returns to frontend
3. Frontend opens browser, user authorizes
4. Google redirects to frontend with code
5. Frontend sends code to backend for exchange
6. Backend exchanges code for tokens, returns to frontend
7. Frontend encrypts and stores tokens locally

## 📦 Deployment

### Docker (Optional)

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production

COPY . .
EXPOSE 3410

CMD ["node", "server.js"]
```

Build and run:

```bash
docker build -t blankdrive-oauth .
docker run -p 3410:3410 --env-file .env blankdrive-oauth
```

### Environment Variables for Production

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
PORT=3410
FRONTEND_URL=https://yourdomain.com  # Change to your production URL
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=10
```

## 🧪 Testing

Test the endpoints with curl:

```bash
# Health check
curl http://localhost:3410/health

# Generate auth URL
curl http://localhost:3410/api/oauth/generate-url
```

## 📝 Notes

- This is a **stateless service** - no database required
- Tokens are **NOT stored** on the server (returned to client immediately)
- For production, consider using Redis for rate limiting instead of in-memory
- The service is designed to be lightweight and easy to deploy anywhere

## 🛠️ Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **OAuth Library:** googleapis
- **Security:** CORS, Rate Limiting, PKCE
- **Config:** dotenv for environment variables

## 📄 License

MIT - Same as BlankDrive main project
