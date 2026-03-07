## 2024-03-07 - Parallelize Network I/O
**Learning:** Sequential network I/O operations (like API calls in a `for...of` loop) are a significant bottleneck in cloud sync processes.
**Action:** Always use parallel execution (e.g., `runParallel` with `PARALLEL_LIMIT`) for network-bound batch operations.
