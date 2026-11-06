# Security model and reporting

Report security issues privately through
[GitHub private vulnerability reporting](https://github.com/divyanshu-iitian/Divyansharness/security/advisories/new).
Do not include secrets or exploit other people's systems in a public issue.

## Boundaries

Dhaara's native command tool runs only in a local Docker **Linux** container.
There is no unsandboxed fallback. The original working tree, Docker socket,
provider keys, SSH agent and home directory are not mounted. Containers have a
read-only root filesystem, all capabilities dropped, no-new-privileges, PID/CPU/
memory limits, and a bounded temporary filesystem. Outbound networking is off
unless the user passes `--network`. Containers are removed after completion,
timeout and cancellation. A host crash can still leave one running; inspect
`docker ps --filter label=dev.dhaara.managed=true` and remove only the named
Dhaara container you intend to stop.

File tools operate on a staged copy. They reject traversal, symlinks, Windows
device names and alternate streams. Snapshot and apply omit known secret filenames,
`.git`, dependency directories, and configured `.dhaaraignore` entries. This is
not a secret scanner: secrets embedded in ordinary source files are still source.
Inspect what you give to an agent, especially before using a remote provider.

## Limits

- Docker shares its host's Linux kernel (or Docker Desktop VM kernel). It is not
  a hardened microVM and does not guarantee isolation against kernel exploits.
- The Docker daemon is a trusted dependency. Never expose it to the model.
- A custom container image is trusted code and may contain its own credentials.
- `--network` permits outbound traffic from the whole container. It is not a
  domain allowlist. Native inference runs on the host separately from shell networking.
- The official OpenCode bridge needs networking for inference. An explicitly
  supplied `OPENCODE_API_KEY` is available inside that bridge container, including
  its shell tools. Native providers do not have this limitation.
- Verification commands execute project code. A passing command is evidence of
  that command passing, not proof of correctness or protection against a model
  weakening tests. Use external/held-out tests for evaluations.
- Session files, staged sources and logs stay in `DHAARA_HOME` and may contain
  sensitive source data. They are not encrypted. Do not publish them wholesale.
- Apply checks all conflicts before beginning and rechecks each file before
  replacement. Multi-file application is not an OS-level atomic transaction.
  Concurrent writers or a disk failure may cause partial application; original
  snapshots remain in the session's `baseline` directory. Stop other writers
  while applying and inspect changes if an error occurs.
- A malicious local process with the same user privileges can alter files and
  session records. Same-user attacks and host filesystem race attacks are outside
  this boundary.

## Provider access

Dhaara does not spoof OpenCode client identities, extract subscription tokens,
ship shared API keys, or evade usage restrictions. Free services can rate-limit,
change prices, change terms, or disappear. OpenRouter native free mode validates
zero pricing, requests zero maximum prompt/completion price, and sends no paid
fallback models. Compatible mode has unknown pricing and is explicitly selected.
