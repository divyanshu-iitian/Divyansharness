# Research → terminal behavior (7 November 2026)

The first preview exposed the engine through a demo, but made real conversation
hard to discover. This pass prioritizes the daily terminal workflow. Sources below
are upstream project documentation, not an unverified ranking or star-count contest.

| Harness / source | What is useful here | Decision in Divyansharness v0.2 |
|---|---|---|
| [Pi terminal usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md) | Model selection, visible session state, queued input, saved conversations | Provider/model chooser, compact status, input queue, /resume and /new |
| [Aider chat modes](https://aider.chat/docs/usage/modes.html) | Discussing a change and applying it can share one conversation with explicit modes | Default chat, then /plan or /build; retain earlier decisions |
| [OpenCode automation](https://opencode.ai/docs/cli/commands/) | Official client supports JSON events and explicit session continuation | Persist its private state, capture its session ID, normalize output into readable chat |
| [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) | Replaceable services separate model, tools, persistence and UI | Separate runner, chat, terminal input, preferences, providers and sandbox modules; no plugin framework dependency yet |
| [OpenHands SDK architecture](https://docs.openhands.dev/sdk/arch/overview) | Agent interaction and workspace execution are separate concerns | Native chat needs no Docker; coding keeps the local isolation boundary |
| [Kimi Code](https://github.com/MoonshotAI/kimi-code) | The current maintained project emphasizes the terminal workflow and compatible providers | Make startup, provider setup, model changes and uninstall easy to find |
| [Ollama model metadata](https://docs.ollama.com/api/tags) | Catalog includes model size | Display weight size and sort local models by size instead of silently choosing the largest |

The old [Kimi CLI repository](https://github.com/MoonshotAI/kimi-cli) is archived and
points to Kimi Code. That is why current upstream links matter more than an old
“best harness” list. Goose session documentation URLs checked during this pass were
unavailable; no new feature claims about those pages are used here.

## What changed because of this research

1. **A useful first screen.** `divyansharness` opens chat and a model chooser when
   unconfigured. Choosing the official free bridge prepares its image if necessary.
   The optional scripted demo is no longer the main getting-started path.
2. **Explicit project attachment.** A new conversation has an empty stage. Native
   chat sends no tools. /plan or /build attaches the source; /build permits staged
   writes. The bridge uses a readonly project mount outside build mode, and retains
   the official client's separate state. It is not a native OpenCode API adapter.
3. **Continuity that survives restart.** Both native message history and official
   bridge session state persist. A real free-model test remembered a marker across
   turns and a separate CLI process, then completed a verified edit in the same session.
4. **Inspectable behavior.** Readable tool steps, /diff, /verify, /apply and /status
   keep the current mode, session and evidence visible. Keys stay in environment
   variables; the preference file has an explicit non-secret field whitelist.
5. **Keep the cost of the shell small.** Native Node modules and ordinary terminal
   scrollback; no React renderer, vector database or extra model calls for each UI action.

## Where established harnesses remain ahead

Pi, OpenCode, DeepSeek Harness and other mature projects offer broader extension
ecosystems and richer interfaces. Divyansharness does not yet implement a full-screen
editor, MCP/LSP, skill packages, native session branching, voice/images or parallel
agents. The OpenCode bridge inherits that client's loop; its successes do not establish
that our native loop is better. The prior small native-model failure is still published.

## A credible route to “best”

Measure the native loop using pinned models and repeated tasks, with matching
time/token budgets and held-out verifiers. Include failures, request counts,
context retention, accidental writes, latency and memory. Compare against pinned
upstream releases under the same conditions. Only add larger features when a
specific failure or measured result justifies them. This release improves usability
and continuity; it does not establish a benchmark win.
