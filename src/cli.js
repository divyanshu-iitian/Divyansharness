import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createSession, loadSession, sessions, save, event, lock } from './session.js';
import { DockerSandbox, doctor, DEFAULT_IMAGE } from './sandbox.js';
import { resolveProvider, listModels } from './providers.js';
import { runAgent } from './agent.js';
import { diff, applyChanges } from './workspace.js';
import { verify } from './tools.js';
import { demo } from './demo.js';
import { bridge, BRIDGE_IMAGE } from './bridge.js';
import { banner, renderer, receipt } from './ui.js';
import { VERSION, assert, integer, exec, safeText } from './util.js';

const HELP = `Dhaara ${VERSION} — Think freely. Change deliberately.

Usage: dhaara [command] [task or session] [options]

  run "task"                  Work in a staged copy; never auto-apply
  plan "task"                 Read-only exploration in a sandbox
  resume SESSION ["task"]      Continue saved work; no blind action replay
  diff SESSION                Review staged changes
  verify SESSION              Run checks independently of the model
  apply SESSION               Apply verified, conflict-free changes
  show SESSION                Show status, usage and checks
  sessions                    List saved runs
  models                      List available models (free cloud / local)
  bridge "task" --network      Run official OpenCode in Docker
  sandbox setup [--bridge]     Pull native image / build optional bridge image
  doctor                      Check Node, Docker and image readiness
  demo                        Scripted bug fix; REAL Docker and verification

Options:
  --provider ollama|openrouter|compatible  Default: ollama
  --model ID                  Exact model ID; live catalog validation
  --base-url URL              Local or compatible Chat Completions endpoint
  --cwd PATH                  Source workspace (default: current directory)
  --verify "command"          Repeatable sandbox verification command
  --require-verification      Do not accept completion without a check
  --image IMAGE               Default: node:22-alpine
  --network                   Allow outbound network inside the sandbox
  --max-turns N               Default: 24; hard maximum 200
  --max-tokens N              Approximate total input + output budget: 160000
  --timeout N                 Whole-run timeout in seconds: 600
  --command-timeout N         Command timeout in seconds: 60
  --allow-unverified          Explicit override for apply only
  --json                      Newline-delimited structured events
  --help / --version

Native OpenRouter mode selects only zero-price :free models with tools.
Set OPENROUTER_API_KEY. No automatic paid fallback. Limits still apply.
Compatible mode uses DHAARA_API_KEY and may incur provider charges.
OpenCode free models require the official CLI bridge; no direct API bypass.

Run without arguments in a terminal for interactive mode.
`;
function options(args) {
  const { values: v, positionals: p } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      json: { type: 'boolean' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      cwd: { type: 'string' },
      verify: { type: 'string', multiple: true },
      image: { type: 'string' },
      network: { type: 'boolean' },
      'max-turns': { type: 'string' },
      'max-tokens': { type: 'string' },
      timeout: { type: 'string' },
      'command-timeout': { type: 'string' },
      'allow-unverified': { type: 'boolean' },
      'require-verification': { type: 'boolean' },
      bridge: { type: 'boolean' },
    },
  });
  return {
    v,
    p,
    config: {
      provider: v.provider,
      model: v.model,
      baseURL: v['base-url'],
      verify: v.verify,
      image: v.image,
      network: v.network,
      requireVerification: v['require-verification'],
      maxTurns: integer(v['max-turns'] ?? 24, 'max-turns', 1, 200),
      maxTokens: integer(v['max-tokens'] ?? 160000, 'max-tokens', 1000, 10000000),
      durationMs: integer(v.timeout ?? 600, 'timeout', 1, 7200) * 1000,
      commandTimeout: integer(v['command-timeout'] ?? 60, 'command-timeout', 1, 120) * 1000,
    },
  };
}
async function withCancellation(fn) {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new DOMException('Cancelled; session saved.', 'AbortError'));
  process.on('SIGINT', cancel);
  try {
    return await fn(controller.signal);
  } finally {
    process.removeListener('SIGINT', cancel);
  }
}
async function nativeRun(command, prompt, config, cwd, onEvent, signal, id) {
  assert(prompt || id, 'Provide a task, for example: dhaara run "Fix the failing tests"');
  let session;
  if (id) {
    session = await loadSession(id);
    config = {
      ...session.options,
      ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
    };
  }
  const provider = await resolveProvider({ ...config, signal });
  session ??= await createSession(cwd, { ...config, plan: command === 'plan' });
  if (command === 'run' || command === 'plan') session.options.plan = command === 'plan';
  session.options = {
    ...session.options,
    ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
  };
  const sandbox = new DockerSandbox(session.stage, { ...config, timeout: config.commandTimeout });
  return runAgent(session, provider, sandbox, { prompt, signal, onEvent, ...config });
}
export async function main(args = process.argv.slice(2)) {
  const { v, p, config } = options(args);
  const cwd = v.cwd ?? process.cwd(),
    onEvent = renderer(v.json);
  if (v.version) {
    console.log(VERSION);
    return;
  }
  if (v.help) {
    console.log(HELP);
    return;
  }
  if (p.length === 0) {
    if (process.stdin.isTTY && !v.json) return interactive(config, cwd);
    console.log(HELP);
    return;
  }
  const [command, ...rest] = p;
  if (command === 'doctor') {
    const d = await doctor();
    if (v.json) console.log(JSON.stringify(d));
    else {
      banner();
      console.log(
        `  Node    ${d.node}\n  Docker  ${d.docker ? 'ready' : 'unavailable'}\n  Image   ${d.image ? 'ready' : `missing — docker pull ${DEFAULT_IMAGE}`}\n`,
      );
      if (d.detail) console.log(safeText(d.detail));
    }
    if (!d.docker || !d.image) process.exitCode = 1;
    return;
  }
  if (command === 'models') {
    const models = await listModels(config.provider ?? 'openrouter', { baseURL: config.baseURL });
    if (v.json) console.log(JSON.stringify(models));
    else {
      console.log(`\n  ${config.provider ?? 'openrouter'} models\n`);
      for (const m of models) console.log(`  ${m.id}${m.bridge ? '  [official CLI bridge]' : ''}`);
      console.log('\n  Availability and rate limits are controlled by the provider.\n');
    }
    return;
  }
  if (command === 'sessions') {
    const list = await sessions();
    if (v.json) console.log(JSON.stringify(list));
    else
      for (const s of list)
        console.log(`  ${s.id}  ${s.status.padEnd(20)} ${safeText(s.original)}`);
    return;
  }
  if (command === 'sandbox') {
    assert(rest[0] === 'setup', 'Use dhaara sandbox setup [--bridge].');
    const build = v.bridge;
    const dockerfile = fileURLToPath(new URL('../sandbox/Dockerfile.opencode', import.meta.url));
    const r = await exec(
      'docker',
      build
        ? [
            'build',
            '--file',
            dockerfile,
            '--tag',
            BRIDGE_IMAGE,
            fileURLToPath(new URL('../sandbox/', import.meta.url)),
          ]
        : ['pull', config.image ?? DEFAULT_IMAGE],
      {
        timeout: 600000,
        onData: (text, err) => (err ? process.stderr : process.stdout).write(safeText(text)),
      },
    );
    assert(r.code === 0, `Docker setup exited ${r.code}.`);
    return;
  }
  if (['diff', 'show', 'apply', 'verify'].includes(command)) {
    const session = await loadSession(rest[0]);
    if (command === 'diff') {
      const text = await diff(session);
      console.log(v.json ? JSON.stringify({ session: session.id, diff: text }) : safeText(text));
      return;
    }
    if (command === 'show') {
      const data = {
        id: session.id,
        status: session.status,
        model: session.model,
        original: session.original,
        stage: session.stage,
        summary: session.summary,
        error: session.error,
        checks: session.checks,
        usage: session.usage,
      };
      console.log(v.json ? JSON.stringify(data) : safeText(JSON.stringify(data, null, 2)));
      return;
    }
    const release = await lock(session);
    try {
      if (command === 'apply') {
        const changed = await applyChanges(session, { allowUnverified: v['allow-unverified'] });
        session.status = 'applied';
        await save(session);
        await event(session, 'applied', { changes: changed });
        console.log(
          v.json
            ? JSON.stringify({ session: session.id, applied: changed })
            : `Applied ${changed.length} file(s) to ${safeText(session.original)}.`,
        );
      } else {
        if (v.verify) session.options.verify = v.verify;
        const sandbox = new DockerSandbox(session.stage, {
          image: v.image ?? session.options.image,
          network: v.network ?? false,
        });
        await sandbox.prepare();
        const result = await withCancellation((signal) =>
          verify(session, sandbox, { signal, onEvent }),
        );
        console.log(
          v.json
            ? JSON.stringify({ type: 'verification', ...result })
            : safeText(JSON.stringify(result, null, 2)),
        );
        if (!result.verified) process.exitCode = 1;
      }
    } finally {
      await release();
    }
    return;
  }
  if (!v.json) banner();
  const session = await withCancellation(async (signal) => {
    if (command === 'demo') return demo({ signal, onEvent });
    if (command === 'bridge') {
      assert(rest.length, 'Provide a task for the bridge.');
      return bridge(cwd, rest.join(' '), config, { signal, onEvent });
    }
    if (command === 'resume')
      return nativeRun(command, rest.slice(1).join(' '), config, cwd, onEvent, signal, rest[0]);
    assert(['run', 'plan'].includes(command), `Unknown command ${command}. Run dhaara --help.`);
    return nativeRun(command, rest.join(' '), config, cwd, onEvent, signal);
  });
  receipt(session, v.json);
  if (
    ['failed', 'interrupted', 'budget-exhausted', 'verification-failed', 'stalled'].includes(
      session.status,
    )
  )
    process.exitCode = 1;
}
async function interactive(config, cwd) {
  banner();
  console.log('  /help for commands · Ctrl+C cancels a run · /exit to leave\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let session,
    mode = 'run',
    active;
  rl.on('SIGINT', () => {
    if (active) active.abort(new DOMException('Cancelled', 'AbortError'));
    else rl.close();
  });
  try {
    for await (const line of prompts(rl)) {
      const text = line.trim();
      if (!text) continue;
      if (text === '/exit' || text === '/quit') break;
      if (text === '/help') {
        console.log(
          '  /plan · /build · /new · /models · /diff · /status · /exit\n  Apply separately with: dhaara apply SESSION\n',
        );
        continue;
      }
      if (text === '/plan') {
        mode = 'plan';
        console.log('  Read-only plan mode.');
        continue;
      }
      if (text === '/build') {
        mode = 'run';
        console.log('  Build mode; changes remain staged.');
        continue;
      }
      if (text === '/new') {
        session = undefined;
        console.log('  Next task starts a fresh snapshot.');
        continue;
      }
      if (text === '/models') {
        try {
          console.log(
            (await listModels(config.provider ?? 'ollama', { baseURL: config.baseURL }))
              .map((m) => m.id)
              .join('\n'),
          );
        } catch (e) {
          console.log(safeText(e.message));
        }
        continue;
      }
      if (text === '/status') {
        console.log(session ? `${session.id}: ${session.status}` : '  No session yet.');
        continue;
      }
      if (text === '/diff') {
        console.log(session ? safeText(await diff(session)) : '  No session yet.');
        continue;
      }
      if (text.startsWith('/')) {
        console.log('  Unknown command. Use /help.');
        continue;
      }
      active = new AbortController();
      try {
        session = await nativeRun(mode, text, config, cwd, renderer(), active.signal, session?.id);
        receipt(session);
      } catch (e) {
        console.log(`\n  ${safeText(e.message)}\n  Saved runs: dhaara sessions\n`);
      } finally {
        active = undefined;
      }
    }
  } finally {
    rl.close();
  }
}
async function* prompts(rl) {
  while (!rl.closed) {
    try {
      yield await rl.question('  dhaara › ');
    } catch {
      break;
    }
  }
}
