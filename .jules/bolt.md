## 2024-03-11 - Optimize Drive Syncing With Parallelism
**Learning:** Sequential network I/O in loops is an architectural bottleneck for network-bound operations like synchronizing files with Google Drive.
**Action:** Always use the \`runParallel\` utility to perform network-bound operations in parallel, replacing sequential loops like \`for...of\` when executing \`driveFileIds\` or fragments iterations.
