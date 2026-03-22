## 2024-05-18 - Prevent DNS Rebinding Bypass in Localhost Check
**Vulnerability:** The application verified loopback access using `hostName.startsWith('127.')`. This is vulnerable to DNS rebinding (or host header injection) because a malicious domain like `127.evildomain.com` would pass the check.
**Learning:** Security validations on hostnames must be strict. Using substring or prefix checks (like `startsWith`) on domain names is inherently flawed because they do not account for the domain hierarchy.
**Prevention:** Always use a strict regular expression (e.g., `/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/`) or parsed IP validation logic to strictly ensure that the host resolves to a genuine local IPv4 address.

## 2024-05-18 - Prevent Dangerous CLI Commands in Web UI
**Vulnerability:** The Web UI's `/api/cli/run` endpoint allowed execution of the highly destructive `destruct` command. Even if authenticated locally, this exposes a severe risk of data wiping (both local and cloud) through the browser interface, bypassing intended CLI-only interactions (like prompts and warnings).
**Learning:** Exposing CLI commands directly to a web interface requires a strict allow-list or a comprehensive deny-list of commands that are interactive, destructive, or recursive (like `web` or `destruct`). Dangerous commands should be explicitly blocked from HTTP endpoints.
**Prevention:** Always maintain and review `BLOCKED_WEB_CLI_COMMANDS` or a similar mechanism when adding new CLI features to ensure that administrative or destructive commands cannot be triggered remotely or via XSRF/CSRF from the web interface.
## 2025-02-24 - [Fix PowerShell Command Injection]
**Vulnerability:** A command injection vulnerability existed when passing file paths to a dynamically generated PowerShell script in `execAsync` (found in `src/cli/commands/upload.ts` and `src/cli/commands/download.ts`) by interpolating a potentially unsafe `tempFile` string directly into the script.
**Learning:** Using string interpolation inside execution contexts like `execAsync` or `spawn` can lead to arbitrary command execution if the input is untrusted or contains unexpected shell metacharacters.
**Prevention:** Use environment variables (via the `env` options object) to securely pass data into execution contexts.
