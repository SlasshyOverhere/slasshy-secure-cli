## 2024-05-18 - Prevent DNS Rebinding Bypass in Localhost Check
**Vulnerability:** The application verified loopback access using `hostName.startsWith('127.')`. This is vulnerable to DNS rebinding (or host header injection) because a malicious domain like `127.evildomain.com` would pass the check.
**Learning:** Security validations on hostnames must be strict. Using substring or prefix checks (like `startsWith`) on domain names is inherently flawed because they do not account for the domain hierarchy.
**Prevention:** Always use a strict regular expression (e.g., `/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/`) or parsed IP validation logic to strictly ensure that the host resolves to a genuine local IPv4 address.

## 2024-05-18 - Prevent Dangerous CLI Commands in Web UI
**Vulnerability:** The Web UI's `/api/cli/run` endpoint allowed execution of the highly destructive `destruct` command. Even if authenticated locally, this exposes a severe risk of data wiping (both local and cloud) through the browser interface, bypassing intended CLI-only interactions (like prompts and warnings).
**Learning:** Exposing CLI commands directly to a web interface requires a strict allow-list or a comprehensive deny-list of commands that are interactive, destructive, or recursive (like `web` or `destruct`). Dangerous commands should be explicitly blocked from HTTP endpoints.
**Prevention:** Always maintain and review `BLOCKED_WEB_CLI_COMMANDS` or a similar mechanism when adding new CLI features to ensure that administrative or destructive commands cannot be triggered remotely or via XSRF/CSRF from the web interface.

## 2024-06-25 - Prevent Command Injection via Dynamic Arguments
**Vulnerability:** In `download.ts` and `upload.ts`, `execAsync` was used with string interpolation inside the `-Command` argument: `powershell -NoProfile -Command "${psScript}"`. This could lead to a command injection vulnerability if the file path or environment variables used to construct the script content were maliciously crafted.
**Learning:** Never use string interpolation for dynamic arguments to shell commands or scripts, especially when paths might contain spaces, quotes, or special characters.
**Prevention:** Always pass dynamic data securely using environment variables within the `execAsync` options (e.g., `env: { ...process.env, VAR_NAME: value }`) and reference them natively in the shell script context (e.g., `$env:VAR_NAME`).
