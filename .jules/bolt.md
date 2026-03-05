## 2024-05-24 - Parallelize Cloud Chunk Deletions
**Learning:** Sequential network I/O in a simple array loop, like deleting chunks iteratively, acts as an architectural bottleneck causing significant delays. Waiting for each chunk deletion's HTTP request to finish before starting the next leads to O(n) network roundtrips.
**Action:** Replaced sequential loops (`for...of`) for network operations with a parallel execution strategy, utilizing batching or the `runParallel` utility to reduce overall network latency without overwhelming the system.
