# Dhaara

**A small terminal harness. A separate workspace. Evidence before apply.**

> Active build: implementation is landing in incremental, reviewable commits.
> See [WORKLOG.md](WORKLOG.md) for verified progress. The first release is not yet published.

Dhaara is an independent, MIT-licensed terminal coding harness designed around a
small native Node.js core, staged file changes, local Docker isolation, and explicit
verification. No runtime npm dependencies. No background telemetry.

Native providers: local Ollama and dynamically discovered OpenRouter free models.
OpenCode integration uses its official CLI: its current free API is restricted to
OpenCode clients, so Dhaara does not impersonate a client or bypass provider limits.

The project is being implemented and tested before release. It does not claim a
benchmark win over OpenCode, DeepSeek Harness, or other agents.

## Build direction

- Snapshot the workspace, leaving your working tree untouched.
- Reject stale edits using whole-file hashes.
- Run commands in resource-limited Docker containers, offline by default.
- Preserve session history and interrupted-action records.
- Run configured tests before accepting verified completion.
- Apply only after a review, with baseline conflict detection.

## License

[MIT](LICENSE). Created by [Divyanshu](https://github.com/divyanshu-iitian).
