## 2024-05-18 - Prevent DNS Rebinding Bypass in Localhost Check
**Vulnerability:** The application verified loopback access using `hostName.startsWith('127.')`. This is vulnerable to DNS rebinding (or host header injection) because a malicious domain like `127.evildomain.com` would pass the check.
**Learning:** Security validations on hostnames must be strict. Using substring or prefix checks (like `startsWith`) on domain names is inherently flawed because they do not account for the domain hierarchy.
**Prevention:** Always use a strict regular expression (e.g., `/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/`) or parsed IP validation logic to strictly ensure that the host resolves to a genuine local IPv4 address.

## 2024-05-24 - [Block destructive command from Web UI]
**Vulnerability:** The `destruct` command could potentially be executed via the Web UI's `/api/cli/run` endpoint, allowing the entire vault and cloud backups to be deleted.
**Learning:** Even though the CLI prompts for confirmation, relying entirely on the CLI prompt in a Web context is a risk as the frontend CLI handler executes commands via `execFile` without true terminal tty capabilities.
**Prevention:** Always maintain a strict blocklist for highly sensitive CLI commands (like `destruct`) to prevent their execution from alternative interfaces like the Web UI.
