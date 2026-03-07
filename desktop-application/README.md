# BlankDrive Desktop (Tauri)

Desktop shell for BlankDrive that packages the BlankDrive Node backend with the installer.
This desktop release is focused on simplicity and stability while keeping one shared backend across CLI, Web UI, and desktop.

## Architecture

- Tauri app (`desktop-application`) starts a local Node sidecar process.
- Release builds bundle `dist/`, production `node_modules/`, and a Node runtime inside `blankdrive-runtime`.
- Sidecar command: `node dist/index.js web --port <port>`.
- The desktop window then loads the local BlankDrive Web UI URL.
- This means CLI and desktop use the same backend/runtime and vault data format.

## Development Prerequisites

- Node.js 18+ (22 LTS recommended)
- Rust toolchain (`rustup`, stable)
- Root project dependencies installed in `D:\BlankDrive`

## Development

From `D:\BlankDrive\desktop-application`:

```bash
npm install
npm run tauri:dev
```

`tauri:dev` automatically builds the backend and prepares a packaged runtime before launching Tauri.

## Build Installer

From `D:\BlankDrive\desktop-application`:

```bash
npm run tauri:build
```

`tauri:build` prepares a self-contained `blankdrive-runtime` folder first, including the backend JS, production dependencies, and a bundled Node executable.

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
- `BLANKDRIVE_NODE_BIN`: force Node executable path (overrides the bundled Node runtime when set)

## Current Scope

- Desktop launcher + sidecar lifecycle is implemented here.
- Main vault UI and CLI functionality remain in the existing BlankDrive Node project.
