## 2024-05-14 - Sequential Network I/O Bottleneck
**Learning:** Sequential network I/O in array loops (e.g., deleting file chunks sequentially via `for...of` in the `destruct` command) acts as an architectural bottleneck and significantly degrades performance.
**Action:** Always use the `runParallel` utility with a defined concurrency limit (e.g., `PARALLEL_LIMIT`) to perform network-bound operations in parallel, significantly improving the operation speed over multiple files.

## 2024-03-10 - Parallelized Cloud Uploads/Downloads

**Learning:** The legacy `uploadEntry`, `downloadEntry`, and `deleteEntryFromDrive` operations in `src/storage/drive/synchronizer.ts` iterated over fragments linearly, uploading or downloading them sequentially with `await`. This is a significant bottleneck on systems that manage multi-fragment stealth entries.

**Action:** Refactored `runParallel` from `src/storage/drive/fileSyncService.ts` to be exported and utilized it for all multi-fragment network I/O operations in `synchronizer.ts`, enforcing concurrency up to `PARALLEL_LIMIT` (which defaults to 5), significantly improving network throughput.

## 2024-05-15 - Batched Promise.all Fetching
**Learning:** Sequential local loop lookups fetching entry values via `await getEntry` cause an N+1 performance bottleneck that drastically impacts commands performing bulk iterations across the file system (e.g. `audit`, `totp`, and `breach` checks in the shell).
**Action:** Replace sequential iterations of localized file system reads and encryptions with a batched `Promise.all` approach using chunk sizes (e.g., 20) to maintain balanced system memory and limit concurrent file handles while significantly boosting processing speed.

## 2024-05-24 - N+1 Disk I/O Bottlenecks in Sequential getEntry() Calls

**Learning:** When retrieving full entries (which requires decrypting specific `.enc` files from the disk) via `await getEntry()`, iterating sequentially through an array of index items (e.g., in a `for...of` loop) causes an N+1 sequential disk I/O bottleneck. This bottleneck significantly degrades performance on commands like `sync` or `audit` when a vault grows large.

**Action:** Whenever multiple full entries must be fetched from the index, avoid sequential `for...of` loops. Instead, utilize `Promise.all()` to fetch entries in parallel, but strictly process them in batches (e.g., chunk sizes of 20) to balance execution speed without exhausting available memory or file handles (`EMFILE` errors).

## 2024-06-21 - Resolving N+1 Sequential Disk I/O Bottlenecks

**Learning:** Iterating through vault index entries and sequentially fetching the full entry (e.g. `await getEntry(id)`) causes an N+1 read bottleneck that scales poorly with large vaults. This issue occurred in both `searchEntries` (fetching matches sequentially) and `syncCommand` (fetching the entire vault sequentially).

**Action:** Use `Promise.all()` to fetch full entries in parallel from the index. When handling large subsets of entries, process them in batches (e.g. 20 concurrent tasks) using `Promise.all` over `slice()` bounds to maximize throughput while avoiding file descriptor limits ("too many open files").

## 2024-05-25 - Parallelizing Network I/O in Low-Level Clients
**Learning:** Sequential network I/O in arrays creates significant bottlenecks. However, when working in low-level client files like `src/storage/drive/driveClient.ts`, importing higher-level parallelization utilities (like `runParallel` from `fileSyncService.ts`) creates inverted/circular dependencies that complicate architecture.
**Action:** When parallelizing network requests in foundational client modules, avoid external imports. Instead, implement inline chunked batching (e.g., using `Promise.all` over chunks of 5-20) to maintain high throughput while strictly preserving module dependency boundaries.
## 2024-05-18 - Caching API Results Locally
**Learning:** When a synchronous operation like `checkPasswordBreach` is used in a sequential loop with an artificial rate-limit delay, caching the *input* (like a 5-char SHA-1 prefix) only prevents the network call, but does not prevent the artificial delay if the loop logic does not explicitly skip the delay. Furthermore, to effectively prevent duplicate sequential loops, caching the entire result by the plaintext input is often faster and much more readable than repeating the hashing overhead.
**Action:** Use an in-memory `Map` keyed by the exact plaintext input to cache function return values instead of partial inputs (like prefixes), and ensure the loop explicitly skips artificial `setTimeout` delays if the result was pulled from the cache.
