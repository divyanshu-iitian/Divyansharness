# What has actually been measured

Date: **7 November 2026, Asia/Kolkata** (raw timestamps are UTC).
These are engineering checks and smoke runs, not a comparative leaderboard.

## Live tiny-task smoke

The task fixes a multiplier in `examples/tiny-bug/duration.js`. The evaluator requires
a verified result, unchanged fixture tests, unchanged original source, exactly the
expected implementation-file change, and independent numeric/validation probes in
a fresh offline container. Extra probes are not sent to the model. One task and
one run cannot estimate general coding ability.

| Backend | Model | Outcome | Duration | Reported input/output tokens |
|---|---|---|---|---|
| Official OpenCode 2.2.5 bridge | big-pickle | Passed all smoke conditions | 21.6 s | 21,366 / 432 |
| Native Ollama | qwen2.5:1.5b | Failed; stopped as `stalled`; no files changed | 19.4 s | 5,383 / 347 |
| Native Ollama | qwen2.5:3b | Model load failed; CUDA allocation error | Not scored | No completed inference |

The bridge reported $0 model cost. This is **OpenCode's loop** inside Dhaara's
staging/container/verification boundary, not a result for Dhaara's native loop.
An earlier bridge smoke also passed visible tests. An earlier 1.5B run exhausted
eight turns; that failure motivated clearer schemas and stall detection. These
were development runs, not a preregistered benchmark. [Raw smoke reports](evaluations/smoke-2026-11-07.json).

Machine: Windows, i5-13420H, 16 GB RAM, RTX 2050 4 GB, Node 25.2.1, other applications
running. Local inference caused severe host memory pressure and Node allocation
failures. Unloading the test model restored passing sequential unit/syntax checks.
We recommend the CI-tested Node 22/24 LTS versions.

No live OpenRouter inference was attempted without a user-provided key. Discovery,
zero-price request constraints, stream assembly, errors and redirects are tested.

Reproduce from a checkout:

```sh
npm run eval:smoke -- --bridge --network --model big-pickle
npm run eval:smoke -- --provider ollama --model YOUR_LOCAL_MODEL
npm run eval:smoke -- --provider openrouter --model YOUR_FREE_MODEL
```

Reports go to `artifacts/eval-*.json`. The evaluator never applies changes and exits
nonzero on failure. Prompts/source are published; these are transparent smoke
fixtures, not a contamination-resistant benchmark.

## Runtime overhead

`npm run bench` launches `--version` seven times and measures CLI import RSS in
another process. Two Windows batches observed median startup of 69.6 and 107.3 ms,
RSS of 48.8 and 57.2 MB, and about 65 KB runtime source after hardening. Results vary
with machine load. Docker, image storage, model loading/inference memory are excluded.

## Automated checks

- 34 unit/protocol tests at checkpoint 07: 33 passed locally, one skipped for missing
  Windows symlink privilege. Linux CI exercises that case.
- Five real Docker tests cover isolation, readonly plan mode, timeout cleanup,
  cancellation cleanup and the scripted end-to-end demo.
- CI runs Node 22/24 on Linux, macOS and Windows plus real Docker on Linux.
  Consult the live workflow for the current commit.

## Before claiming “better”

A comparison needs pinned harness versions, the same models, tasks, tool/network
permissions, token/time budgets, held-out checks, repeated runs and published failures.
Report success, verification quality, latency, tokens, price and resource use.
Evaluate the native loop separately from the OpenCode bridge. None of those
comparative experiments has been completed for v0.1; no ranking is claimed.
