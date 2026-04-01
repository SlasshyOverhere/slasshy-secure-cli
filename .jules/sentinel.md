## 2024-05-18 - Prevent DNS Rebinding Bypass in Localhost Check
**Vulnerability:** The application verified loopback access using `hostName.startsWith('127.')`. This is vulnerable to DNS rebinding (or host header injection) because a malicious domain like `127.evildomain.com` would pass the check.
**Learning:** Security validations on hostnames must be strict. Using substring or prefix checks (like `startsWith`) on domain names is inherently flawed because they do not account for the domain hierarchy.
**Prevention:** Always use a strict regular expression (e.g., `/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/`) or parsed IP validation logic to strictly ensure that the host resolves to a genuine local IPv4 address.

## 2024-05-18 - Prevent Dangerous CLI Commands in Web UI
**Vulnerability:** The Web UI's `/api/cli/run` endpoint allowed execution of the highly destructive `destruct` command. Even if authenticated locally, this exposes a severe risk of data wiping (both local and cloud) through the browser interface, bypassing intended CLI-only interactions (like prompts and warnings).
**Learning:** Exposing CLI commands directly to a web interface requires a strict allow-list or a comprehensive deny-list of commands that are interactive, destructive, or recursive (like `web` or `destruct`). Dangerous commands should be explicitly blocked from HTTP endpoints.
**Prevention:** Always maintain and review `BLOCKED_WEB_CLI_COMMANDS` or a similar mechanism when adding new CLI features to ensure that administrative or destructive commands cannot be triggered remotely or via XSRF/CSRF from the web interface.

## 2024-05-18 - Maintain HTTP Semantics While Preventing Information Leakage
**Vulnerability:** Masking internal non-auth failures (like disk or database errors) as `401 Unauthorized` strictly hides information but breaks HTTP semantics and disrupts observability, monitoring, and debugging.
**Learning:** Security fixes must balance strict information-hiding constraints with correct protocol usage. Failing securely should use generic messages on correct status codes rather than hijacking unrelated codes.
**Prevention:** For internal errors, throw a generic `500 Internal Server Error` instead of re-throwing arbitrary error objects or masquerading them as client auth errors (`401`).

## 2024-05-18 - Prevent Command Injection via String Interpolation in Shell Execution
**Vulnerability:** Shell commands (like `powershell -Command "..."`) dynamically constructed using string interpolation (e.g., ``[System.IO.File]::WriteAllText('${tempFile}')``) are vulnerable to command injection if variables can contain unescaped characters or malicious inputs, even if they're partially escaped (like replacing backslashes).
**Learning:** Never use string interpolation to pass dynamic data directly into a shell context. Relying on string replacement patterns for escaping is often incomplete and error-prone.
**Prevention:** Always pass dynamic data securely using environment variables (e.g., via the `env` options object in `execAsync`) and reference them natively in the shell context (e.g., `$env:TEMP_FILE` in PowerShell).
