# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- No unreleased entries yet.

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
