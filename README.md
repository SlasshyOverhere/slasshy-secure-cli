# Slasshy - Military-Grade Secure Storage

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/v/release/SlasshyOverhere/slasshy-secure-cli)](https://github.com/SlasshyOverhere/slasshy-secure-cli/releases)
[![Node.js CI](https://github.com/SlasshyOverhere/slasshy-secure-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SlasshyOverhere/slasshy-secure-cli/actions/workflows/ci.yml)

A zero-knowledge encrypted vault that stores your sensitive data (passwords, files, documents) on Google Drive using **steganography** - hiding encrypted data inside innocent-looking images.

## Features

- 🔐 **AES-256-GCM Encryption** - Military-grade authenticated encryption
- 🔑 **Argon2id Key Derivation** - Memory-hard KDF resistant to brute force
- 🖼️ **Steganography** - Hide encrypted data inside auto-generated PNG images
- 📁 **File Uploads** - Store any file type (videos, documents, archives, etc.)
- ☁️ **Google Drive Sync** - Secure cloud backup that looks like normal photos
- 🕵️ **Zero-Knowledge** - Your master password never leaves your device
- 🎭 **Obfuscation** - Random filenames, decoy files, fragmentation

## How It Works

1. Your data is encrypted with AES-256-GCM
2. Encrypted data is hidden inside PNG images using LSB steganography
3. Images are auto-generated with natural-looking patterns (gradients, textures)
4. Renamed to look like normal photos (`IMG_20260113_143022.png`)
5. Uploaded to Google Drive - appears as regular photo backups
6. **Even Google cannot see what you're storing**

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

# Add a password entry
slasshy add

# Upload any file (drag & drop supported!)
slasshy upload ./secret-document.pdf

# List all entries
slasshy list

# Retrieve a password entry
slasshy get "GitHub" --copy

# Download a file
slasshy download "secret-document"

# Connect to Google Drive
slasshy auth

# Sync to Drive (auto-generates carrier images)
slasshy sync

# Lock vault (clears keys from memory)
slasshy lock
```

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `init` | | Initialize a new encrypted vault |
| `add` | | Add a new password entry |
| `upload [file]` | `up` | Upload any file (drag & drop supported) |
| `get <search>` | | Retrieve a password entry |
| `download [search]` | `dl` | Download a file from vault |
| `list` | `ls` | List all entries (passwords & files) |
| `delete <search>` | `rm` | Delete an entry |
| `auth` | | Authenticate with Google Drive |
| `sync` | | Sync vault with Google Drive |
| `status` | | Show vault status |
| `lock` | | Lock vault and clear keys |

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

# Use custom OAuth server
slasshy auth --server https://your-server.com

# Logout from Google Drive
slasshy auth --logout
```

## File Upload Support

Upload any file type - they're encrypted and hidden inside images:

- 📹 **Video**: MP4, MKV, AVI, MOV, WebM
- 🎵 **Audio**: MP3, WAV, FLAC, OGG
- 🖼️ **Images**: JPG, PNG, GIF, WebP
- 📄 **Documents**: PDF, DOC, DOCX, XLS, XLSX, PPT
- 📦 **Archives**: ZIP, RAR, 7z, TAR, GZ
- 💻 **Code**: JS, TS, JSON, XML, HTML, CSS
- 📁 **Any other file type**

### Drag & Drop

Simply drag a file into the terminal when prompted:

```bash
slasshy upload
# Drag & drop your file here...
```

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

## Security

| Component | Implementation |
|-----------|----------------|
| Encryption | AES-256-GCM (NIST approved) |
| Key Derivation | Argon2id (64MB memory, 3 iterations) |
| Steganography | LSB embedding in RGB channels |
| File Integrity | SHA-256 checksums |
| Token Storage | Encrypted with master key |
| Memory | Secure wiping after use |

## Project Structure

```
slasshy-cli-secure/
├── src/
│   ├── crypto/         # Encryption, KDF, memory guard
│   ├── steganography/  # PNG LSB embedding, auto-carrier generation
│   ├── obfuscation/    # Filename, fragmentation, decoys
│   ├── storage/
│   │   ├── vault/      # Local encrypted vault
│   │   └── drive/      # Google Drive integration
│   └── cli/            # CLI commands
├── server/             # OAuth backend server
├── .github/workflows/  # CI/CD automation
└── dist/               # Compiled JavaScript
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

## License

MIT License - see [LICENSE](LICENSE)

## Disclaimer

This tool is for personal use. Always keep backups of your master password. **If you lose it, your data cannot be recovered.**

---

Made with 🔐 by [Slasshy](https://github.com/SlasshyOverhere)
