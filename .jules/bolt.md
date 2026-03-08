## 2024-05-18 - Avoid Redundant Cloud API "Exists" Checks
**Learning:** Checking if a file exists before deleting it in Google Drive (`drive.files.get` followed by `drive.files.delete`) doubles the network roundtrips. The cloud provider's API already validates existence and throws a predictable error (e.g., 404 Not Found) if the resource is missing.
**Action:** When performing destructive or mutative cloud operations (delete, update), attempt the operation directly and handle the "not found" error locally rather than performing a preemptive read/check.
