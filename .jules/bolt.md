## 2024-05-14 - Sequential Network I/O Bottleneck
**Learning:** Sequential network I/O in array loops (e.g., deleting file chunks sequentially via `for...of` in the `destruct` command) acts as an architectural bottleneck and significantly degrades performance.
**Action:** Always use the `runParallel` utility with a defined concurrency limit (e.g., `PARALLEL_LIMIT`) to perform network-bound operations in parallel, significantly improving the operation speed over multiple files.

## 2024-03-10 - Parallelized Cloud Uploads/Downloads

**Learning:** The legacy `uploadEntry`, `downloadEntry`, and `deleteEntryFromDrive` operations in `src/storage/drive/synchronizer.ts` iterated over fragments linearly, uploading or downloading them sequentially with `await`. This is a significant bottleneck on systems that manage multi-fragment stealth entries.

**Action:** Refactored `runParallel` from `src/storage/drive/fileSyncService.ts` to be exported and utilized it for all multi-fragment network I/O operations in `synchronizer.ts`, enforcing concurrency up to `PARALLEL_LIMIT` (which defaults to 5), significantly improving network throughput.

## 2024-05-24 - N+1 Disk I/O Bottlenecks in Sequential getEntry() Calls

**Learning:** When retrieving full entries (which requires decrypting specific `.enc` files from the disk) via `await getEntry()`, iterating sequentially through an array of index items (e.g., in a `for...of` loop) causes an N+1 sequential disk I/O bottleneck. This bottleneck significantly degrades performance on commands like `sync` or `audit` when a vault grows large.

**Action:** Whenever multiple full entries must be fetched from the index, avoid sequential `for...of` loops. Instead, utilize `Promise.all()` to fetch entries in parallel, but strictly process them in batches (e.g., chunk sizes of 20) to balance execution speed without exhausting available memory or file handles (`EMFILE` errors).
