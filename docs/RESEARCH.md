# Research decisions — 7 November 2026

These sources informed independently written code. Feature ideas do not establish
superiority, and old benchmark percentages do not establish current rankings.

| Source | Useful finding | Dhaara decision |
|---|---|---|
| [Pi](https://github.com/earendil-works/pi) | Small extensible agent core | Native Node modules; no runtime package dependencies |
| [Oh My Pi editing experiment](https://stencil.so/blog/the-harness-problem) | Edit format materially changes some models' reliability; not all models improve | Whole-file SHA-256 plus numbered range edits; retain a full replacement path |
| [Deep Agents harness experiment](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering) | Verification, time awareness and failure feedback helped a fixed model | Harness-owned verification and bounded repair loop |
| [Deep Agents v0.7](https://www.langchain.com/blog/deep-agents-v0-7) | Removing redundant context reduced base input overhead | Small schemas, recent complete exchanges, explicit notes |
| [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) | Session events and execution interfaces are distinct concerns | Persisted session state and explicit tool intent/result records |
| [OpenHands architecture](https://docs.openhands.dev/sdk/arch/overview) | Workspace execution should be separated from the UI | Standalone sandbox and workspace modules |
| [Docker security](https://docs.docker.com/engine/security/) | Containers require explicit capability and runtime constraints | Offline default, dropped capabilities, read-only root and resource limits |
| [OpenCode inference policy](https://opencode.ai/docs/console/api/inference/) | Free-tier chat is restricted to OpenCode itself | Official CLI bridge; no identity spoofing |
| [OpenCode automation](https://opencode.ai/docs/cli/commands/#run) | `opencode run` supports automation and JSON events | Pinned optional bridge image |
| [OpenRouter free variants](https://openrouter.ai/docs/guides/routing/model-variants/free) | Paid fallbacks can incur charges even after a free first model | Only live zero-price tool models; no paid fallback array |
| [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility) | Local Chat Completions is supported | Local-native adapter without an SDK dependency |

## What we do not claim

- No SWE-bench or Terminal-Bench win has been established.
- A scripted demo is not an LLM evaluation.
- A benchmark using a different model or budget cannot isolate harness quality.
- Successful tests do not prove code has no defects.
- A free provider is not an unlimited service.
- Zero runtime npm dependencies does not mean zero system requirements: Node and
  Docker are required; local model inference has its own RAM and disk requirements.

## Next experiments

Compare native Dhaara against pinned OpenCode and DeepSeek Harness releases with
the same model, tasks, tool access, token/time budgets and held-out verifiers.
Repeat runs and publish failures, costs and timings. Ablate hashed range edits,
verification feedback and context limits individually before claiming a benefit.
