# BlankDrive

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/v/release/SlasshyOverhere/BlankDrive)](https://github.com/SlasshyOverhere/BlankDrive/releases)
[![Node.js CI](https://github.com/SlasshyOverhere/BlankDrive/actions/workflows/ci.yml/badge.svg)](https://github.com/SlasshyOverhere/BlankDrive/actions/workflows/ci.yml)

Client-side, zero-knowledge vault for passwords, notes, TOTP secrets, and encrypted files synced to Google Drive.

## CLI Use Case Demo

![BlankDrive CLI use case demo](assets/blankdrive-usecase.gif)

CLI command names after install:

- `blankdrive` (default)
- `BLANK` (backward-compatible alias)

## Client-Only Architecture

BlankDrive is fully client-side:

- No backend auth server
- No remote token broker
- OAuth runs locally with Google directly (loopback + PKCE)
- OAuth credentials and tokens are encrypted and stored on your machine

## Tech Stack

- TypeScript + Node.js CLI
- AES-256-GCM for encryption
- Argon2id for key derivation
- Google Drive API (`drive.file` + `drive.appdata`)
- Local OAuth loopback callback (`127.0.0.1`) with PKCE

## Requirements

- Node.js 18+ (22 recommended)
- npm
- Google account
- Google Cloud project with Drive API enabled

## Install

```bash
npm install -g blankdrive
```

Or from source:

```bash
git clone https://github.com/SlasshyOverhere/BlankDrive.git
cd BlankDrive
npm install
npm run build
npm link
```

## Quick Start

```bash
# 1) Initialize vault
blankdrive init

# 2) Configure Google OAuth + connect Drive
blankdrive auth

# 3) Add password
blankdrive add

# 4) Upload encrypted file
blankdrive upload

# 5) List entries
blankdrive list
```

## Primary Use Case

BlankDrive is designed for people who want cloud-backed file/password storage without sending plaintext to any project backend.

Typical real-world flow:

1. You create a local vault protected by your master password.
2. You add passwords, notes, and files locally.
3. BlankDrive encrypts data on-device, then uploads encrypted blobs to your own Google Drive.
4. On a new machine, you restore using the same Google account and your master password.

Practical examples:

- Secure personal document vault (IDs, contracts, statements)
- Encrypted off-device backup of sensitive notes and credentials
- Cross-device password/note/file access via your own Drive account

## Upload/Download Flow (What Actually Happens)

`blankdrive upload` pipeline:

1. Verifies vault is unlocked and Google OAuth is connected.
2. Encrypts file locally with vault entry key (AES-256-GCM + AAD).
3. Chunks large files at 20 MB per chunk.
4. Uploads encrypted chunks to either:
   - `BlankDrive/<your-folder>/` (`public` mode), or
   - `appDataFolder` (`hidden` mode)
5. Stores encrypted metadata in local vault index.

`blankdrive download` pipeline:

1. Lists encrypted cloud chunks from selected storage mode.
2. Downloads chunks (parallel with adaptive concurrency based on free RAM).
3. Decrypts locally and writes restored file to your target path.

## Google OAuth Setup (Step-by-Step)

BlankDrive needs your own Google OAuth Desktop credentials.

### 1. Create or select a Google Cloud project

- Open: https://console.cloud.google.com/

### 2. Enable Google Drive API

- Direct link: https://console.cloud.google.com/apis/library/drive.googleapis.com

### 3. Configure OAuth consent screen

- Google guide: https://developers.google.com/workspace/guides/configure-oauth-consent
- Console shortcut: https://console.cloud.google.com/apis/credentials/consent

Recommended:

- App type: External (or Internal for Workspace org use)
- Add your email and app name
- Add test users (if app is not published)

### 4. Create OAuth Client ID (Desktop app)

- Google guide: https://developers.google.com/workspace/guides/create-credentials
- Console shortcut: https://console.cloud.google.com/apis/credentials
- Select: `Create Credentials` -> `OAuth client ID` -> `Desktop app`

Important:

- Use `Desktop app`, not `Web application`
- BlankDrive uses loopback redirect (`http://127.0.0.1:<dynamic-port>`)

### 5. Run auth in BlankDrive

```bash
BLANK auth
```

You will be prompted for:

- Google OAuth Client ID
- Google OAuth Client Secret

Then BlankDrive opens browser for consent and finishes locally.

### 6. Update or rotate credentials later

```bash
BLANK auth --setup
```

## OAuth Flow (How It Works)

1. BlankDrive starts a local callback server on `127.0.0.1` (random port).
2. It builds a PKCE challenge and opens Google consent URL.
3. Google redirects back to local loopback URL.
4. BlankDrive exchanges code for tokens.
5. Tokens and OAuth credentials are encrypted and stored locally under `~/.slasshy/`.

Reference:

- OAuth native apps: https://developers.google.com/identity/protocols/oauth2/native-app

## Cloud Storage Modes

You can use either:

- `public` (default): visible in Drive UI under `BlankDrive/<folder>/`
- `hidden`: stored in Drive `appDataFolder` (not visible in Drive UI)

Manage anytime:

```bash
BLANK settings
BLANK settings --storage public
BLANK settings --storage hidden
BLANK settings --folder my-device
BLANK settings --storage public --folder my-device
```

Notes:

- In `public` mode, upload prompts for folder each upload (with saved folder as default).
- Switching modes does not automatically migrate existing cloud files.

## Commands

All commands can be run as either `blankdrive ...` or `BLANK ...`.

### CLI Commands

```bash
BLANK init
BLANK init --restore
BLANK add
BLANK get [search] [--copy] [--show-password]
BLANK list [--filter <term>] [--type passwords|files|notes] [--category <name>]
BLANK edit [search]
BLANK favorite [search]
BLANK favorites
BLANK note [add|view|edit|list]
BLANK audit [--all]
BLANK upload [file]
BLANK download [search]
BLANK delete [search] [--force]
BLANK settings [--storage hidden|public] [--folder <name>]
BLANK auth [--setup|--logout]
BLANK generate [options]
BLANK status
BLANK lock
BLANK destruct
BLANK version
```

### Interactive Shell (Extended Commands)

Run with no args:

```bash
BLANK
```

Shell includes additional commands like:

- `sync`
- `totp` / `2fa`
- `breach`
- `duress`
- `autolock`
- `theme`
- `history`
- `auditlog`

## Restore Flow

```bash
BLANK init --restore
```

Restore requires:

- Same Google account
- Correct vault master password
- Correct storage mode/folder location of your backup

## Security Specifications

Core crypto and key management:

- Encryption algorithm: AES-256-GCM
- IV length: 12 bytes
- Auth tag length: 16 bytes
- KDF: Argon2id
- Default Argon2id params: timeCost `3`, memoryCost `65536` (64 MB), parallelism `4`, hashLength `32`
- Sub-key derivation: HKDF-SHA256 contexts (`index`, `entry`, `metadata`)
- AAD binding: entry ID or chunk-specific ID (`<entryId>_chunk_<index>`)

Storage and cloud behavior:

- Local vault path: `~/.slasshy/`
- Encrypted token file: `~/.slasshy/drive_token.enc`
- Encrypted OAuth credentials: `~/.slasshy/google_oauth_credentials.enc`
- Cloud scopes: `drive.file` and `drive.appdata`
- Public mode path: `Google Drive > BlankDrive/<folder>/`
- Hidden mode path: Google `appDataFolder` (not visible in Drive UI)

Performance-related implementation details:

- File chunk size: 20 MB
- Parallel upload/download worker limit: 5
- Adaptive download parallelism:
  - 5 workers when free RAM > 2 GB
  - 2 workers when free RAM > 512 MB
  - 1 worker otherwise

## Trust Boundary and Limits

What BlankDrive does:

- Runs client-side only in this repo (no project-hosted backend required)
- Sends OAuth/auth API requests directly to Google
- Encrypts payloads before cloud upload

What BlankDrive does not guarantee:

- If your machine is compromised while vault is unlocked, local secrets can be exposed
- Losing your master password means encrypted vault data cannot be recovered
- Hidden mode (`appDataFolder`) improves visibility/privacy in Drive UI, but is not a substitute for endpoint security

## Troubleshooting

### `redirect_uri_mismatch`

- Ensure OAuth client type is `Desktop app`
- Then run:

```bash
BLANK auth --setup
```

### Upload says success but file is not visible in Drive

- You are likely in `hidden` mode (`appDataFolder`)
- Switch to public mode:

```bash
BLANK settings --storage public
```

### Need to re-authenticate

```bash
BLANK auth --logout
BLANK auth
```

### Access blocked / unverified app

- Add your Google account as a test user in OAuth consent screen settings.

## Local Data Paths

- Vault and config: `~/.slasshy/`
- Encrypted token file: `~/.slasshy/drive_token.enc`
- Encrypted OAuth creds: `~/.slasshy/google_oauth_credentials.enc`
- Cloud mode config: `~/.slasshy/cloud_storage_config.json`

## License

MIT
