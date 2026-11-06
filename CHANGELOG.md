# Changelog

## 0.1.0 — 7 November 2026 — Experimental preview

First public release of Dhaara, an MIT terminal coding harness with zero runtime
npm dependencies. Distributed as source and an installable GitHub release tarball.

- Native CLI/REPL, JSON events, plan mode, sessions, resume, diff, verify and apply.
- Staged workspaces, hash-checked edits, conflict preflight and verification receipts.
- Local Docker command isolation, offline default and timeout/cancellation cleanup.
- Ollama and OpenRouter free-model discovery; compatible Chat Completions adapter.
- Optional official OpenCode 2.2.5 bridge for its free models, independently verified.
- Bounded requests/context, strict tools, stalled-repair detection and crash recovery.
- Cross-platform tests, Docker/bridge image checks, reproducible demo and live smoke evaluator.
- Research notes, explicit security boundaries, failure reports and incremental build log.

Known limits: native small-model smoke failed; 3B model loading hit machine memory
limits. A live OpenCode free-model smoke passed. No general performance ranking,
unlimited free access, hardened VM isolation, full-screen TUI, MCP/LSP or multi-agent
support is claimed. See [evaluation](docs/EVALUATION.md), [security](SECURITY.md)
and [roadmap](docs/ROADMAP.md).
