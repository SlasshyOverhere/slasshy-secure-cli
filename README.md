# Slasshy - Military-Grade Secure Storage

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/v/release/SlasshyOverhere/slasshy-secure-cli)](https://github.com/SlasshyOverhere/slasshy-secure-cli/releases)
[![Node.js CI](https://github.com/SlasshyOverhere/slasshy-secure-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SlasshyOverhere/slasshy-secure-cli/actions/workflows/ci.yml)

A zero-knowledge encrypted vault that stores your sensitive data (passwords, files, documents) on Google Drive's **hidden appDataFolder** - completely invisible to users in Drive UI.

## Features

- **AES-256-GCM Encryption** - Military-grade authenticated encryption
- **Argon2id Key Derivation** - Memory-hard KDF resistant to brute force
- **Hidden Cloud Storage** - Files stored in Google Drive's invisible appDataFolder
- **Auto Cloud Sync** - Files automatically sync to cloud on upload
- **Large File Support** - Chunked uploads/downloads with parallel processing
- **Progress Tracking** - Real-time speed, ETA, and progress bars
- **Interactive Shell** - Run multiple commands without re-invoking CLI
- **Zero-Knowledge** - Your master password never leaves your device
- **Cloud Restore** - Restore your vault on any device from cloud backup

## How It Works

1. Your data is encrypted locally with AES-256-GCM
2. Encrypted chunks are uploaded to Google Drive's hidden `appDataFolder`
3. The appDataFolder is **invisible** in Drive UI - only your app can access it
4. Metadata is encrypted and synced for cross-device restore
5. **Even Google cannot see what you're storing**

## Installation

```bash
npm install -g slasshy-secure-cli
```

### From Source

```bash
# Clone the repository
git clone https://github.com/SlasshyOverhere/slasshy-secure-cli.git
cd slasshy-secure-cli

# Install dependencies
npm install

# Build
npm run build

# Link globally
npm link
```

## Quick Start

```bash
# Initialize your vault
slasshy init

# Connect to Google Drive (required for cloud sync)
slasshy auth

# Add a password entry
slasshy add

# Upload any file (auto-syncs to cloud)
slasshy upload ./secret-document.pdf

# List all entries
slasshy list

# Retrieve a password entry
slasshy get "GitHub" --copy

# Download a file
slasshy download 1              # By number
slasshy download "document"     # By name

# Check vault status
slasshy status

# Lock vault (clears keys from memory)
slasshy lock

# Interactive shell mode
slasshy shell
```

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `init` | | Initialize a new encrypted vault |
| `init --restore` | | Restore vault from cloud backup |
| `add` | | Add a new password entry |
| `upload [file]` | `up` | Upload any file (auto-syncs to cloud) |
| `get <search>` | | Retrieve a password entry |
| `download [search]` | `dl` | Download a file from vault |
| `list` | `ls` | List all entries (passwords & files) |
| `delete <search>` | `rm`, `del` | Delete an entry (local + cloud) |
| `auth` | | Authenticate with Google Drive |
| `status` | | Show vault and cloud status |
| `lock` | | Lock vault and clear keys |
| `destruct` | | Permanently destroy vault (local + cloud) |
| `shell` | | Start interactive shell mode |

### Command Options

```bash
# List only files or passwords
slasshy list --type files
slasshy list --type passwords

# Filter by name
slasshy list --filter "github"

# Copy password to clipboard
slasshy get "GitHub" --copy

# Show password in output
slasshy get "GitHub" --show-password

# Delete by number
slasshy delete 1
slasshy del 3

# Force delete without confirmation
slasshy delete "entry" --force

# Use custom OAuth server
slasshy auth --server https://your-server.com

# Logout from Google Drive
slasshy auth --logout

# Restore vault from cloud
slasshy init --restore
```

## Interactive Shell Mode

Start an interactive session to run multiple commands without re-invoking the CLI:

```bash
slasshy shell
```

```
  ███████╗██╗      █████╗ ███████╗███████╗██╗  ██╗██╗   ██╗
  ██╔════╝██║     ██╔══██╗██╔════╝██╔════╝██║  ██║╚██╗ ██╔╝
  ███████╗██║     ███████║███████╗███████╗███████║ ╚████╔╝
  ╚════██║██║     ██╔══██║╚════██║╚════██║██╔══██║  ╚██╔╝
  ███████║███████╗██║  ██║███████║███████║██║  ██║   ██║
  ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝

slasshy> list
slasshy> upload ./file.pdf
slasshy> download 1
slasshy> exit
```

## Cloud Backup & Restore

Your vault metadata is automatically backed up to the cloud. Restore on any device:

```bash
# On a new device, restore from cloud
slasshy init --restore

# Enter your master password
# Vault metadata and file index restored from cloud
# Download files on-demand with: slasshy download <name>
```

## File Upload Support

Upload any file type - they're encrypted and stored in hidden cloud storage:

- **Video**: MP4, MKV, AVI, MOV, WebM
- **Audio**: MP3, WAV, FLAC, OGG
- **Images**: JPG, PNG, GIF, WebP
- **Documents**: PDF, DOC, DOCX, XLS, XLSX, PPT
- **Archives**: ZIP, RAR, 7z, TAR, GZ
- **Code**: JS, TS, JSON, XML, HTML, CSS
- **Any other file type**

### Large File Support

Files are automatically chunked for reliable upload/download:
- Parallel processing (up to 5 concurrent chunks)
- Adaptive parallelism based on available RAM
- Resume support for interrupted transfers
- Real-time progress with speed and ETA

## OAuth Server Setup

The CLI requires your own OAuth backend server for Google Drive authentication.

### Deploy Your Own Server

1. Go to `server/` directory in this repo
2. Deploy to Render, Railway, Vercel, or any Node.js host
3. Set environment variables:
   - `GOOGLE_CLIENT_ID` - From Google Cloud Console
   - `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
   - `SERVER_URL` - Your deployed server URL (no trailing slash)

4. On first `slasshy auth`, you'll be prompted to enter your backend URL:
   ```
   ? Backend OAuth server URL: https://your-server.onrender.com
   ```

5. The URL is saved and reused for future authentication.

### Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Google Drive API
4. Create OAuth 2.0 credentials (Web application)
5. Add redirect URI: `https://your-server.com/oauth/callback`
6. Copy Client ID and Secret to your server's environment variables

**Required OAuth Scopes:**
- `https://www.googleapis.com/auth/drive.file` - For visible files
- `https://www.googleapis.com/auth/drive.appdata` - For hidden appDataFolder

## Security

| Component | Implementation |
|-----------|----------------|
| Encryption | AES-256-GCM (NIST approved) |
| Key Derivation | Argon2id (64MB memory, 3 iterations) |
| File Chunking | 20MB chunks with per-chunk encryption |
| File Integrity | SHA-256 checksums |
| Token Storage | Encrypted with machine-derived key |
| Cloud Storage | Hidden appDataFolder (invisible to user) |
| Memory | Secure wiping after use |

## Project Structure

```
slasshy-cli-secure/
├── src/
│   ├── crypto/           # Encryption, KDF, key management
│   ├── storage/
│   │   ├── vault/        # Local encrypted vault
│   │   └── drive/        # Google Drive integration
│   │       ├── driveClient.ts      # Drive API wrapper
│   │       └── fileSyncService.ts  # Chunked upload/download
│   └── cli/
│       ├── commands/     # CLI command handlers
│       ├── shell.ts      # Interactive shell mode
│       ├── progress.ts   # Progress bar utilities
│       └── ensureAuth.ts # Auto-authentication helper
├── server/               # OAuth backend server
├── .github/workflows/    # CI/CD automation
└── dist/                 # Compiled JavaScript
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Changelog

### v2.0.0
- **Auto Cloud Sync** - Files automatically sync to cloud on upload
- **Hidden Storage** - Uses Google Drive's invisible appDataFolder
- **Cloud Restore** - Restore vault on any device with `init --restore`
- **Interactive Shell** - `slasshy shell` for multi-command sessions
- **Destruct Command** - Permanently wipe vault (local + cloud)
- **Progress Bars** - Real-time speed, ETA, and transfer progress
- **Large File Support** - Chunked uploads with parallel processing
- **Improved Error Handling** - Better error messages and recovery
- Removed manual `sync` command (now automatic)

## License

MIT License - see [LICENSE](LICENSE)

## Disclaimer

This tool is for personal use. Always keep backups of your master password. **If you lose it, your data cannot be recovered.**

---

Made with security in mind by [Slasshy](https://github.com/SlasshyOverhere)
