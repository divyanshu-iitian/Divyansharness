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

## 02 — Provider adapters and agent loop

Implemented native SSE Chat Completions, bounded retries, local Ollama discovery,
live zero-price OpenRouter catalog filtering, strict tool argument checks, persistent
tool records, recovery markers for interrupted actions, bounded context, checkpoints,
and independent completion verification. No automatic paid fallback.

Validation: all JavaScript modules passed `node --check` through `npm run check`.
Protocol boundary and failure-case tests follow in the hardening checkpoint.

## 03 — Terminal workflow and executable demo

Implemented interactive and one-shot CLI, plan/build modes, JSON event output,
sessions, diff, verify, apply, resume, doctor, sandbox setup, and an optional official
OpenCode bridge. Added a tiny reproducible bug fixture.

Validation: `node bin/dhaara.js demo` completed against real local Docker:
read → hash-checked edit → `node --test` → verified. Original fixture unchanged.
The demo is scripted and is explicitly labeled as such; it is not an LLM benchmark.
Bridge image build and live provider tests are still pending.

## 04 — Adversarial tests and local sandbox verification

Added tests for traversal, NTFS alternate streams, device names, stale edits,
overlapping edits, all-file conflict preflight, post-verification changes,
ignore-file tampering, locks, interrupted action recovery, context/tool pairing,
fragmented SSE, truncated streams, credential redirects and terminal escapes.

Validation on Windows:
- Unit/protocol: **25 passed, 1 skipped** (symlink creation needs Windows privilege).
- Real Docker: **5 passed** — offline networking, readonly root, no host secret env,
  writable staging, readonly plan mount, timeout cleanup, abort cleanup, demo checks.
- Optional OpenCode 2.2.5 image built successfully.
- Live Ollama, OpenRouter and OpenCode catalog discovery returned models.

Follow-up: host Node 25 emitted native OOM crashes during live network probes after
the image build. Investigating runtime/environment stability before release.

## Provider research decision

OpenCode's current [inference documentation](https://opencode.ai/docs/console/api/inference/)
restricts free-tier chat inference to OpenCode itself. A direct request was rejected.
Native free-model access will use OpenRouter or local Ollama. OpenCode access will
run the official CLI as an explicit bridge, subject to its own account/rate limits.
No spoofed client headers, shared keys, or paid fallback.
