## 2024-03-09 - Parallelizing Sequential Cloud Deletions in CLI Commands
**Learning:** Sequential network I/O in array loops, such as deleting cloud files sequentially in the destruct CLI command (`for (const file of cloudFiles)`), acts as an architectural bottleneck leading to slower command execution.
**Action:** Use the `runParallel` utility exported from `src/storage/drive/fileSyncService.ts` with a defined concurrency limit (e.g., `PARALLEL_LIMIT` or `5`) to perform network-bound operations in parallel.
