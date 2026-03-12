# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- No unreleased entries yet.

## [0.1.4] - 2026-03-12

### Fixed

- Prevented DNS rebinding in localhost checks by enforcing strict loopback matching.
- Avoided redundant Drive delete preflight lookups with added error handling tests.

### Improved

- Parallelized Drive sync operations for upload, download, and delete paths.
- Parallelized cloud destruct deletion for faster cleanup.
- Improved Web UI accessibility and focus management for entry list, busy states, and modal video preview.

## [0.1.3] - 2026-03-07

### Fixed

- Desktop installer/runtime now ships a self-contained backend runtime with production dependencies and a bundled Node executable, so installed desktop launches no longer fail on missing modules.
- Desktop sidecar startup errors now surface the backend stderr/stdout details instead of only reporting `exit code: 1`.
- CLI scheduled npm update prompts are skipped for `web` / `ui` launches so desktop startup does not get delayed by update checks.

### Improved

- Web UI keyboard focus styling now stays visible on buttons and active entry rows.
- Web UI unlock now has bounded brute-force protection with tests, while preserving `/api/init` behavior and real server error handling.
- Cloud chunk deletions now run with bounded parallelism and deterministic aggregated error reporting.

## [0.1.2] - 2026-03-03

### Fixed

- Added missing `ensureUnlocked()` guard to `/api/cli/run` in the Web UI server.

### Improved

- Large vault iteration path in `vaultManager` now avoids `Object.entries(...)` tuple allocation overhead and uses safe `for...in` with `Object.hasOwn`.
- Removed generated `.jules/*` artifacts from merged PR changes.

## [0.1.1] - 2026-03-02

### Added

- Official Tauri desktop app under `desktop-application/` that launches the shared Node backend.
- CLI desktop installer command (`BLANK desktop`) with direct `.exe` download from latest GitHub release.
- CLI update command (`BLANK update`) with check/install flows and machine-readable JSON mode.
- 24-hour scheduled update checks with prompt-to-install flow in CLI and desktop launcher.
- Desktop release build/upload job in `publish.yml` for Windows installers (`.exe` / `.msi`).
- Desktop logo and icon set integration across web UI and desktop packaging.

### Improved

- CLI help/shell startup now highlights desktop install/update commands prominently.
- Desktop launcher UI now includes update prompt actions (`Download & Install` / continue).

### Fixed

- Desktop update checks now compare against desktop app version when running in Tauri.
- Update schedule cache now records check attempts even on API/asset lookup failures.

## [0.0.3] - 2026-02-24

### Added

- Local Web UI server and command (`BLANK web` / `BLANK ui`) for vault management.
- Web UI flows for vault init/unlock/lock, entry CRUD, chunked file upload, file download, and CLI command execution.
- Improved shell help experience with interactive command picker and `help --list`.

### Fixed

- Automatic Drive authentication bootstrap in file sync/upload/download/cloud-availability paths.
