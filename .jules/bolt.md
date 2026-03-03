## 2024-05-24 - Iterate Vault Index Entries Efficiently
**Learning:** `vaultIndex.entries` is a map-like object that can become quite large. Iterating over it using `Object.entries()` or `Object.values()` requires the JavaScript engine to allocate a massive intermediate array and causes huge garbage collection overhead.
**Action:** Always use a `for...in` loop with direct property access to iterate over `vaultIndex.entries` to avoid massive array allocation overhead and improve memory performance.
