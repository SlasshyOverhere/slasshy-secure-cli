## 2024-05-14 - Sequential Network I/O Bottleneck
**Learning:** Sequential network I/O in array loops (e.g., deleting file chunks sequentially via `for...of` in the `destruct` command) acts as an architectural bottleneck and significantly degrades performance.
**Action:** Always use the `runParallel` utility with a defined concurrency limit (e.g., `PARALLEL_LIMIT`) to perform network-bound operations in parallel, significantly improving the operation speed over multiple files.

## 2024-03-10 - Parallelized Cloud Uploads/Downloads

**Learning:** The legacy `uploadEntry`, `downloadEntry`, and `deleteEntryFromDrive` operations in `src/storage/drive/synchronizer.ts` iterated over fragments linearly, uploading or downloading them sequentially with `await`. This is a significant bottleneck on systems that manage multi-fragment stealth entries.

**Action:** Refactored `runParallel` from `src/storage/drive/fileSyncService.ts` to be exported and utilized it for all multi-fragment network I/O operations in `synchronizer.ts`, enforcing concurrency up to `PARALLEL_LIMIT` (which defaults to 5), significantly improving network throughput.

## 2024-05-15 - Batched Promise.all Fetching
**Learning:** Sequential local loop lookups fetching entry values via `await getEntry` cause an N+1 performance bottleneck that drastically impacts commands performing bulk iterations across the file system (e.g. `audit`, `totp`, and `breach` checks in the shell).
**Action:** Replace sequential iterations of localized file system reads and encryptions with a batched `Promise.all` approach using chunk sizes (e.g., 20) to maintain balanced system memory and limit concurrent file handles while significantly boosting processing speed.
