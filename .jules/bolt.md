
## 2026-03-06 - Parallelizing Network I/O
**Learning:** Sequential network I/O in array loops (e.g., deleting file chunks sequentially via `for...of`) acts as an architectural bottleneck in this codebase, significantly degrading performance.
**Action:** Always use the `runParallel` utility exported from `src/storage/drive/fileSyncService.ts` with a defined concurrency limit (e.g., `PARALLEL_LIMIT`) to perform network-bound operations in parallel instead of sequential `for...of` loops.
