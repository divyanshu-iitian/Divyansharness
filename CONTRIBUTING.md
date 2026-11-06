# Contributing to Dhaara

The product goal is simple: finish useful coding tasks with less machinery and
give the user a reviewable, reproducible result.

Node 22 or 24 LTS is recommended. There is no build step and no runtime package
installation. Clone the repository, then run:

```sh
npm run check
npm test
docker pull node:22-alpine
npm run test:sandbox
node bin/dhaara.js demo
```

Keep changes focused. For a bug, add a regression that would have caught it.
For performance work, include reproducible measurements and failure cases.
Avoid dependencies unless the implementation and maintenance benefit is clear.
New providers must not silently change a user's spending policy.

Security invariants:

- Never execute model commands on the host.
- Never mount the original working tree or Docker socket into a task container.
- Do not follow workspace symlinks or put provider keys into native task containers.
- Persist tool intent before execution. An interrupted action must not be silently replayed.
- Verification belongs to the harness; model text is not evidence.
- Never auto-apply edits or overwrite a changed original file.

MIT licensing applies to contributions. Do not copy code from projects with
incompatible licenses. Research ideas and cite sources; implement independently.
