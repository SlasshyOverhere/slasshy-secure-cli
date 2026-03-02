# BlankDrive Desktop (Tauri)

Desktop shell for BlankDrive that reuses the existing Node CLI backend.
This desktop release is focused on simplicity and stability while keeping one shared backend across CLI, Web UI, and desktop.

## Architecture

- Tauri app (`desktop-application`) starts a local Node sidecar process.
- Sidecar command: `node dist/index.js web --port <port>`.
- The desktop window then loads the local BlankDrive Web UI URL.
- This means CLI and desktop use the same backend/runtime and vault data.

## Prerequisites

- Node.js 18+ (22 LTS recommended)
- Rust toolchain (`rustup`, stable)
- Root project dependencies installed in `D:\BlankDrive`

## Development

From `D:\BlankDrive\desktop-application`:

```bash
npm install
npm run tauri:dev
```

`tauri:dev` automatically runs `npm --prefix .. run build` first, so `../dist/index.js` is available.

## Build Installer

From `D:\BlankDrive\desktop-application`:

```bash
npm run tauri:build
```

## Release Distribution

- Windows installer artifacts (`.exe`/`.msi`) are published to GitHub Releases via `.github/workflows/publish.yml`.
- Users can install directly from CLI without browsing releases manually:

```bash
BLANK desktop --install
```

## Update Flow

- CLI and desktop check for updates every 24 hours.
- CLI command:

```bash
BLANK update --check
BLANK update --install
```

- Desktop launcher prompts when an update is available and can launch installer directly.

## Environment Overrides

- `BLANKDRIVE_ROOT`: force the backend root folder (must contain `dist/index.js`)
- `BLANKDRIVE_NODE_BIN`: force Node executable path (defaults to `node`)

## Current Scope

- Desktop launcher + sidecar lifecycle is implemented here.
- Main vault UI and CLI functionality remain in the existing BlankDrive Node project.
