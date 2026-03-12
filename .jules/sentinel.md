## 2024-05-18 - Prevent DNS Rebinding Bypass in Localhost Check
**Vulnerability:** The application verified loopback access using `hostName.startsWith('127.')`. This is vulnerable to DNS rebinding (or host header injection) because a malicious domain like `127.evildomain.com` would pass the check.
**Learning:** Security validations on hostnames must be strict. Using substring or prefix checks (like `startsWith`) on domain names is inherently flawed because they do not account for the domain hierarchy.
**Prevention:** Always use a strict regular expression (e.g., `/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/`) or parsed IP validation logic to strictly ensure that the host resolves to a genuine local IPv4 address.
