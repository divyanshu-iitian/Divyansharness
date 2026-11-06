# Build log

This log records implementation checkpoints. Commit history is the authoritative
sequence; this file records validation and limitations without invented timestamps
or benchmark claims. Build date: **7 November 2026 (Asia/Kolkata)**.

## 01 — Foundation

Implemented:
- Dependency-free Node.js package scaffold and MIT license.
- Bounded workspace snapshots excluding dependency directories, credentials, and symlinks.
- Whole-file hash validation for transactional range edits.
- Staged diffs and baseline conflict checks before applying changes.
- Persistent sessions, event logs, and process locks.
- Disposable local Docker command runner with no-network default, dropped capabilities,
  read-only root filesystem, resource limits, and explicit cleanup after cancellation.

Observed validation:
- Docker Desktop started successfully through `docker desktop start`.
- A real `node:22-alpine` container ran as UID 1000 with networking disabled,
  a read-only root, all capabilities dropped, and no-new-privileges enabled.

Pending: CLI, unit/integration tests, provider checks, packaging and first release.

## Provider research decision

OpenCode's current [inference documentation](https://opencode.ai/docs/console/api/inference/)
restricts free-tier chat inference to OpenCode itself. A direct request was rejected.
Native free-model access will use OpenRouter or local Ollama. OpenCode access will
run the official CLI as an explicit bridge, subject to its own account/rate limits.
No spoofed client headers, shared keys, or paid fallback.
