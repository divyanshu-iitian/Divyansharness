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

## 05 — CI, architecture and contributor workflow

Added Node 22/24 tests on Linux, macOS and Windows, plus a real-Docker CI job.
Documented architecture, provider access, security boundaries, research decisions,
contribution rules, issue templates and a measurement-first roadmap.

Local CLI overhead sample (Windows, Node 25.2.1, i5-13420H): 7 version-command
runs, **69.6 ms median startup**, **48.8 MB RSS** after importing the CLI,
**61,655 bytes** of runtime source, **0 runtime npm dependencies**. These are
machine-specific CLI overhead measurements, excluding Docker and model memory.
Reproduce with `npm run bench`; raw output is written to `artifacts/overhead.json`.

## Provider research decision

## 06 — Failure feedback and bridge startup repair

Observed a real local `qwen2.5:1.5b` run fail the tiny bug task: it proposed fixes
in prose but did not edit the file. All verification attempts failed and no source
changes were applied. Improved line-number schemas and actionable repair feedback;
three unchanged failed submissions now stop with `stalled` instead of consuming
the entire turn budget. Applied sessions cannot receive a fresh verification receipt.

The first OpenCode image had truncated npm platform binaries. Installing only the
required official platform package fixed startup; image builds now execute
`opencode --version` and fail if the binary cannot run. Confirmed **v2.2.5** starts.
Bridge event parsing now retains early errors even after the output tail rolls over.
Provider parsing rejects truncated completions and oversized multiline SSE events.

Validation: **32 unit/protocol tests passed, 1 Windows symlink test skipped**;
20 modules passed syntax checks. Previous checkpoint's seven GitHub CI jobs passed
on Node 22/24 across Linux, Windows and macOS, including real Docker isolation.

## Provider research decision

OpenCode's current [inference documentation](https://opencode.ai/docs/console/api/inference/)
restricts free-tier chat inference to OpenCode itself. A direct request was rejected.
Native free-model access will use OpenRouter or local Ollama. OpenCode access will
run the official CLI as an explicit bridge, subject to its own account/rate limits.
No spoofed client headers, shared keys, or paid fallback.
