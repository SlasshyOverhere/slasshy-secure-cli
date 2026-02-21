# BlankDrive - Military-Grade Secure Storage

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/v/release/SlasshyOverhere/BlankDrive)](https://github.com/SlasshyOverhere/BlankDrive/releases)
[![Node.js CI](https://github.com/SlasshyOverhere/BlankDrive/actions/workflows/ci.yml/badge.svg)](https://github.com/SlasshyOverhere/BlankDrive/actions/workflows/ci.yml)

A zero-knowledge encrypted vault that stores your sensitive data (passwords, files, documents) in Google Drive using either hidden `appDataFolder` storage or a visible `BlankDrive/<your-folder>/` path.

## Features

- **AES-256-GCM Encryption** - Military-grade authenticated encryption
- **Argon2id Key Derivation** - Memory-hard KDF resistant to brute force
- **Flexible Cloud Storage** - Choose hidden appDataFolder or visible `BlankDrive` folder
- **Auto Cloud Sync** - Files automatically sync to cloud on upload
- **Large File Support** - Chunked uploads/downloads with parallel processing
- **Progress Tracking** - Real-time speed, ETA, and progress bars
- **Interactive Shell** - Run multiple commands without re-invoking CLI
- **Zero-Knowledge** - Your master password never leaves your device
- **Cloud Restore** - Restore your vault on any device from cloud backup

## How It Works

1. Your data is encrypted locally with AES-256-GCM
2. Encrypted chunks are uploaded to Google Drive in either hidden `appDataFolder` or visible `BlankDrive/<your-folder>/`
3. The appDataFolder is **invisible** in Drive UI - only your app can access it
4. Metadata is encrypted and synced for cross-device restore
5. **Even Google cannot see what you're storing**

## Installation

```bash
npm install -g blankdrive
```

### From Source

```bash
# Clone the repository
git clone https://github.com/SlasshyOverhere/BlankDrive.git
cd BlankDrive

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
BLANK init

# Connect to Google Drive (required for cloud sync)
BLANK auth

# Add a password entry
BLANK add

# Upload any file (auto-syncs to cloud)
BLANK upload ./secret-document.pdf

# List all entries
BLANK list

# Retrieve a password entry
BLANK get "GitHub" --copy

# Download a file
BLANK download 1              # By number
BLANK download "document"     # By name

# Check vault status
BLANK status

# Lock vault (clears keys from memory)
BLANK lock

# Interactive shell mode
BLANK shell
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
| `settings` | | App settings (cloud storage mode + public folder name) |
| `status` | | Show vault and cloud status |
| `lock` | | Lock vault and clear keys |
| `destruct` | | Permanently destroy vault (local + cloud) |
| `shell` | | Start interactive shell mode |

### Command Options

```bash
# List only files or passwords
BLANK list --type files
BLANK list --type passwords

# Filter by name
BLANK list --filter "github"

# Copy password to clipboard
BLANK get "GitHub" --copy

# Show password in output
BLANK get "GitHub" --show-password

# Delete by number
BLANK delete 1
BLANK del 3

# Force delete without confirmation
BLANK delete "entry" --force

# One-time Google OAuth setup (bring your own credentials)
BLANK auth --setup

# Change cloud storage mode manually later
BLANK settings --storage hidden
BLANK settings --storage public
BLANK settings --folder my-device
BLANK settings --storage public --folder my-device

# Logout from Google Drive
BLANK auth --logout

# Restore vault from cloud
BLANK init --restore
```

## Interactive Shell Mode

Start an interactive session to run multiple commands without re-invoking the CLI:

```bash
BLANK shell
```

```
  ██████╗ ██╗      █████╗ ███╗   ██╗██╗  ██╗
  ██╔══██╗██║     ██╔══██╗████╗  ██║██║ ██╔╝
  ██████╔╝██║     ███████║██╔██╗ ██║█████╔╝
  ██╔══██╗██║     ██╔══██║██║╚██╗██║██╔═██╗
  ██████╔╝███████╗██║  ██║██║ ╚████║██║  ██╗
  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
     ██████╗ ██████╗ ██╗██╗   ██╗███████╗
     ██╔══██╗██╔══██╗██║██║   ██║██╔════╝
     ██║  ██║██████╔╝██║██║   ██║█████╗
     ██║  ██║██╔══██╗██║╚██╗ ██╔╝██╔══╝
     ██████╔╝██║  ██║██║ ╚████╔╝ ███████╗
     ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝

BLANK> list
BLANK> upload ./file.pdf
BLANK> download 1
BLANK> exit
```

## Cloud Backup & Restore

Your vault metadata is automatically backed up to the cloud. Restore on any device:

```bash
# On a new device, restore from cloud
BLANK init --restore

# OAuth runs automatically if needed
# Enter your Google credentials when prompted (first time)
# Then enter your master password
# Vault metadata and file index restored from cloud
# Download files on-demand with: BLANK download <name>
```

## File Upload Support

Upload any file type - they're encrypted and stored in your selected cloud storage mode:

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

## Google OAuth Setup (No Backend Required)

BlankDrive now uses direct local OAuth for Google Drive.

- No backend URL needed
- Each user brings their own Google OAuth Client ID/Secret
- OAuth tokens and client credentials are encrypted and stored locally
- If credentials are missing, `BLANK auth` prompts for them automatically first

### 1. Create Your Google OAuth App

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Go to **APIs & Services > Library** and enable **Google Drive API**.
4. Go to **APIs & Services > OAuth consent screen** and configure:
   - App name and support email
   - Add scopes:
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/drive.appdata`
   - Add your Google account as a **Test user** if app is in Testing mode
5. Go to **APIs & Services > Credentials** and create an **OAuth client ID**.
6. Choose **Application type: Desktop app** (important).
7. Copy your **Client ID** and **Client Secret**.

### 2. Configure BlankDrive

Run:

```bash
BLANK auth
```

Then:
1. Paste your Client ID.
2. Paste your Client Secret.
3. Browser opens automatically.
4. Sign in and approve Google Drive access.
5. Return to terminal when complete.

### 3. Reconfigure / Rotate Credentials

```bash
BLANK auth --setup
```

### Troubleshooting

- `redirect_uri_mismatch`: Use **Desktop app** OAuth credentials (not Web application). BlankDrive uses loopback redirect like `http://127.0.0.1:<port>`.
- `access blocked` or `app not verified`: Add your Google account under OAuth consent screen **Test users**.
- Not getting a fresh token: run `BLANK auth --logout` then `BLANK auth`.

## Cloud Storage Mode

During first onboarding, BlankDrive asks where encrypted cloud data should be stored:

- `hidden` (recommended): Google Drive `appDataFolder` (not visible in Drive UI)
- `public`: A visible path in Drive: `BlankDrive/<your-folder-name>/`

When `public` mode is selected, BlankDrive asks for the upload folder and stores encrypted files under `BlankDrive/<selected-folder>/`.

You can change it any time:

```bash
BLANK settings
# or
BLANK settings --storage hidden
BLANK settings --storage public
BLANK settings --folder my-device
BLANK settings --storage public --folder my-device
```

Note: switching mode does not migrate already uploaded cloud files automatically.

## Security

| Component | Implementation |
|-----------|----------------|
| Encryption | AES-256-GCM (NIST approved) |
| Key Derivation | Argon2id (64MB memory, 3 iterations) |
| File Chunking | 20MB chunks with per-chunk encryption |
| File Integrity | SHA-256 checksums |
| Token Storage | Encrypted with machine-derived key |
| Cloud Storage | Hidden appDataFolder or visible `BlankDrive/<folder>` |
| Memory | Secure wiping after use |

## Project Structure

```
blankdrive/
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

### v0.0.1
- **Auto Cloud Sync** - Files automatically sync to cloud on upload
- **Hidden Storage** - Uses Google Drive's invisible appDataFolder
- **Cloud Restore** - Restore vault on any device with `init --restore`
- **Interactive Shell** - `BLANK shell` for multi-command sessions
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

Made with security in mind by [BlankDrive](https://github.com/SlasshyOverhere)
