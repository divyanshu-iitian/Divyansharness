# Using Divyansharness

## Requirements and storage

Use Node 22/24 LTS and a local Linux Docker engine. The host CLI runs on Windows,
macOS and Linux. `divyansharness doctor` checks engine and default image; `sandbox setup`
explicitly downloads it. Tasks never silently pull images or fall back to a host shell.

Install directly from the GitHub release tarball; npm registry publication is not
assumed. `npm uninstall -g @divyanshu-iitian/divyansharness` removes the CLI, retaining sessions.
Sessions live in `~/.divyansharness/sessions/ID/`. Set `DIVYANSHARNESS_HOME` to change that directory.
Windows paths may contain spaces but not commas (Docker mount syntax restriction).

Each session contains `session.json`, `events.jsonl`, `workspace/` and `baseline/`.
The baseline preserves original snapshotted content. Native history is retained;
bridge logs retain a bounded output tail and event summary. These local files are
not encrypted and can contain sensitive source or transcripts.

## Exclusions

`.gitignore` is not interpreted. Add `.divyansharnessignore` at the source root:

```text
# Simple path patterns, not full gitignore syntax
artifacts/
data/*.csv
private-notes.md
```

`*` matches any characters including `/`; `?` matches one character. No negation
syntax. Ignored files are absent from the snapshot and are not deleted by apply.
Dependencies/build directories and common secret filenames are excluded automatically;
embedded secrets in ordinary code are not detected. Binary assets may be snapshotted,
but text reads/diffs can reject them. Symlinks and nonportable paths are unsupported.
Limits are 5,000 files, 64 MiB total, 1 MiB per file; narrow/exclude larger inputs.

## Dependencies and custom images

Native shell networking defaults off. Host inference can still reach the selected
provider. The default `node:22-alpine` image contains Node/npm, not your dependencies;
`node_modules` is excluded from source snapshots. Explicitly enable downloads:

```sh
divyansharness run "Install with npm ci, then fix the parser" --model YOUR_MODEL --network --verify "npm test"
```

This grants network access to the **whole container**, not only npm. For offline
work, prepare a suitable image or populate the staged dependency directory yourself.
Never mount host credentials or the Docker socket into an agent container.

Another runtime:

```sh
docker pull python:3.12-alpine
divyansharness run "Fix the unit tests" --model YOUR_MODEL --image python:3.12-alpine --verify "python -m unittest"
```

Images must support `sh -lc`, the host UID (1000 on Windows), a readonly root,
writable `/tmp`, and code at `/workspace`. Each command gets a new container:
variables, `cd` and root-level package installs do not persist; workspace files do.
Native containers default to 512 MiB RAM, one CPU, 128 PIDs and 128 MiB tmpfs.
The exported `DockerSandbox` constructor accepts `memory`/`cpus`; v0.1 CLI limits
are fixed. Bridge mode uses 1 GiB RAM and the pinned official CLI image.

## Verification, apply and recovery

Repeat `--verify` for multiple checks. Otherwise Divyansharness discovers a package test
script or JavaScript `.test` files. No check produces `needs-review`, not `verified`.
`--require-verification` refuses completion without a check.

`verify SESSION` records checks and the stage fingerprint. `apply` requires that
receipt and checks original baseline hashes. Resolve conflicts manually; there is
no force-overwrite mode. The explicit `--allow-unverified` override bypasses the
verification requirement only, not conflict checks. Multi-file apply is not atomic
against disk failure or concurrent writers; retained baselines support recovery.

Passing tests does not prove task correctness. The model can edit workspace tests;
use external/held-out checks for evaluations. Our smoke evaluator also verifies
that its fixture tests did not change.

| Symptom | Action |
|---|---|
| Docker unavailable | Start the Linux engine; run `divyansharness doctor` |
| Missing image | `divyansharness sandbox setup`, or explicitly pull/build your custom image |
| HTTP 429 | Respect limits; choose another currently free model or a local model |
| `STALE_EDIT` | Reread the file and use its current hash |
| `stalled` | Three unchanged failed submissions; inspect checks and resume with a stronger model or specific repair |
| `budget-exhausted` | Progress saved; resume with an appropriate budget |
| Ollama out of memory | Free resources you control or use a smaller model; model weights are separate from harness overhead |
| No verified result | Inspect `divyansharness show SESSION`, configure checks and verify again |
| Bridge native resume error | Review/apply the bridge session, or start a new bridge run |

Native recovery does not automatically replay interrupted actions. It tells the
model side effects may have happened, so it can inspect before retrying. Find saved
runs with `divyansharness sessions`. A hard host crash may leave a container running;
see [SECURITY.md](../SECURITY.md) for identifying only Divyansharness-owned containers.

## Budgets and providers

Native defaults: 24 turns, about 160,000 input+output tokens, 10 minutes overall,
60 seconds per command. Context uses character budgets, not exact tokenization.
Provider token reports are used when present, estimates otherwise. A request may
cross the budget before its usage is known. This is not a financial spending cap.
`usage.cost` sums reported costs; absent reporting does not prove a compatible API
is free. Use provider-side limits when selecting a paid compatible endpoint.

The OpenCode bridge uses the official client's loop and token behavior; Divyansharness
enforces the outer timeout and container resources. Provider terms and project-level
OpenCode configuration still apply. An optional `OPENCODE_API_KEY` is visible to
tools inside that network-enabled container. Native provider keys stay on the host.
Do not use native `resume` for an OpenCode bridge session.
