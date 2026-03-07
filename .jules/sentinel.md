## 2024-03-07 - [Missing Rate Limiting on Vault Unlock Endpoint]
**Vulnerability:** The `/api/unlock` endpoint in the Web UI did not have rate limiting, making it vulnerable to brute-force attacks against the vault password.
**Learning:** Even internal/localhost-bound web servers need protection against automated attacks, especially on authentication or decryption endpoints. A malicious script running on the host could attempt to brute-force the vault password.
**Prevention:** Implement an in-memory rate limiter for sensitive endpoints like login/unlock that returns a 429 status code if brute-force thresholds are exceeded.
