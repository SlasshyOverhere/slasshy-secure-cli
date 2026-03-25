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

## 2026-03-25 - Rate-Limited APIs and Parallelization
**Learning:** The `checkPasswordBreach` feature deliberately iterates sequentially and implements a delay to avoid rate limiting from the Have I Been Pwned API. Attempting to parallelize it with `runParallel` or `Promise.all` triggers 429 Too Many Requests errors and breaks the functionality.
**Action:** Never parallelize external API requests to rate-limited services unless explicitly handled with queuing mechanisms. Retain the sequential `for...of` loop and deliberate delays for such operations.
