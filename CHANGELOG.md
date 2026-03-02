# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-03-02

### Integration Follow-up

This entry documents the post-review integration that landed on `main` in commit `d5f8b6c`.

#### Integrated PR work (inspected, overlap-resolved, merged via integration commit)

- `#9` Security: preserved sanitized 500 responses and added regression coverage in `tests/server_error_leak.test.ts`.
- `#10` UI/A11y: merged copy-password action and accessibility improvements in Web UI forms/controls.
- `#11` Security headers: merged CSP + nonce model and security headers in Web UI server/template.
- `#12` Drive sync performance: merged lower-latency upload/download path improvements.
- `#14` Vault controls UX: merged vault control visibility/focus and responsive control layout improvements.
- `#18` PNG stego performance: merged direct bitwise encode/decode optimization and added an extra fix for empty-payload extraction.
- `#19` Accessibility pass: merged broad ARIA label coverage for Web UI form fields.

#### Rejected PRs

- Rejected as duplicate/superseded/noisy (`#7`, `#8`, `#13`, `#15`, `#16`, `#17`).

#### Validation performed before integration

- `npm test` (378 passing)
- `npm run build`
- `npm run lint`

## [0.0.3] - 2026-02-24

### Added

- Local Web UI server and command (`BLANK web` / `BLANK ui`) for vault management.
- Web UI flows for vault init/unlock/lock, entry CRUD, chunked file upload, file download, and CLI command execution.
- Improved shell help experience with interactive command picker and `help --list`.

### Fixed

- Automatic Drive authentication bootstrap in file sync/upload/download/cloud-availability paths.
