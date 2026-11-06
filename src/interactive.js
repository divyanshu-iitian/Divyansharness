import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TerminalInput } from './terminal-input.js';
import { runTurn } from './runner.js';
import { listModels } from './providers.js';
import { writeSettings } from './settings.js';
import { loadSession, sessions, save, lock } from './session.js';
import { diff, applyChanges } from './workspace.js';
import { verify } from './tools.js';
import { DockerSandbox, DEFAULT_IMAGE } from './sandbox.js';
import { BRIDGE_IMAGE } from './bridge.js';
import { banner, renderer, chatFooter } from './ui.js';
import { exec, safeText, assert } from './util.js';

const HELP = `  /chat         Conversation; no project attached until /plan or /build
  /plan         Attach project for read-only exploration
  /build        Enable coding in the staged workspace
  /model [ID]   Pick or change a model; conversation is retained
  /provider     Pick a provider; starts a new conversation
  /new          Fresh conversation in this project
  /resume [ID]  Pick a saved conversation, or open its ID
  /sessions     List saved conversations
  /diff         Review staged changes
  /verify CMD   Configure and run an independent check
  /apply        Apply verified changes, then start fresh
  /setup        Prepare the selected provider's Docker image
  /status       Show mode, provider, session and usage
  /multiline    Paste until /send; /cancel discards the block
  /help /exit   Show help / leave

  Ctrl+C cancels an answer; at an idle prompt it exits.
  /model and /provider never ask you to paste secret keys.`;

async function select(input, items, label, write) {
  assert(items.length, `No ${label} available. Check the provider and try /provider.`);
  items.forEach((item, index) =>
    write(`  ${String(index + 1).padStart(2)}  ${safeText(item.label)}\n`),
  );
  while (true) {
    const answer = await input.ask(`  ${label} [1] > `);
    if (answer === null) return null;
    const entry = answer.trim() || '1';
    const selected = items.find((i) => i.value === entry) ?? items[Number(entry) - 1];
    if (selected) return selected.value;
    write('  Choose a listed number or exact ID.\n');
  }
}
export async function chooseModel(input, config, write, discover = listModels) {
  if (config.provider === 'compatible') {
    const answer = await input.ask('  Model ID > ');
    return answer?.trim() || null;
  }
  write('  Fetching current models…\n');
  const models = await discover(config.provider, { baseURL: config.baseURL });
  if (config.provider === 'opencode')
    models.sort((a, b) => Number(b.id === 'big-pickle') - Number(a.id === 'big-pickle'));
  if (config.provider === 'ollama')
    write('  Local inference needs model RAM/VRAM in addition to the CLI.\n');
  return select(
    input,
    models.map((m) => ({
      value: m.id,
      label: `${m.id}${m.bytes ? `  (${(m.bytes / 1e9).toFixed(1)} GB weights)` : ''}`,
    })),
    'model',
    write,
  );
}
async function chooseProvider(input, current, write, discover) {
  write('\n  Choose how to chat\n');
  const provider = await select(
    input,
    [
      { value: 'opencode', label: 'OpenCode free models · official client · Docker + network' },
      { value: 'ollama', label: 'Ollama · local inference · your installed models' },
      { value: 'openrouter', label: 'OpenRouter free models · your OPENROUTER_API_KEY' },
      { value: 'compatible', label: 'Compatible API · your endpoint/key · pricing may apply' },
    ],
    'provider',
    write,
  );
  if (!provider) return null;
  const next = { provider, network: provider === 'opencode' };
  if (provider === 'opencode')
    write('  This route enables outbound access inside its Docker container.\n');
  if (provider === 'openrouter')
    write('  Set OPENROUTER_API_KEY in your shell before sending a message.\n');
  if (provider === 'compatible') {
    const base = await input.ask('  Chat Completions base URL > ');
    if (base === null) return null;
    next.baseURL = base.trim();
    write('  Set DIVYANSHARNESS_API_KEY in your shell if required.\n');
  }
  next.model = await chooseModel(input, next, write, discover);
  if (!next.model) return null;
  await writeSettings(next);
  return { ...current, ...next, baseURL: next.baseURL };
}
export async function setupImage(config, write, signal) {
  const bridge = config.provider === 'opencode';
  const dockerfile = fileURLToPath(new URL('../sandbox/Dockerfile.opencode', import.meta.url));
  const args = bridge
    ? [
        'build',
        '--file',
        dockerfile,
        '--tag',
        BRIDGE_IMAGE,
        fileURLToPath(new URL('../sandbox/', import.meta.url)),
      ]
    : ['pull', config.image ?? DEFAULT_IMAGE];
  const result = await exec('docker', args, {
    signal,
    timeout: 600000,
    onData: (text) => write(safeText(text)),
  });
  assert(
    result.code === 0,
    'Docker setup failed. Start Docker Desktop/Linux Engine, then use /setup.',
  );
}

export async function interactive(
  initial,
  cwd,
  {
    input = new TerminalInput(),
    write = (text) => process.stdout.write(text),
    run = runTurn,
    discover = listModels,
    setupOnly = false,
  } = {},
) {
  let config = { ...initial },
    session,
    mode = 'chat',
    active;
  const render = renderer(false, { chat: true });
  const cancel = () => {
    if (active) active.abort(new DOMException('Cancelled; conversation saved.', 'AbortError'));
    else input.close();
  };
  input.rl?.on('SIGINT', cancel);
  process.on('SIGINT', cancel);
  banner();
  write(`  ${safeText(path.resolve(cwd))}\n  Chat first. /build to code. /help for commands.\n\n`);
  try {
    if (!config.provider) {
      const chosen = await chooseProvider(input, config, write, discover);
      if (!chosen) return;
      config = chosen;
    } else if (!config.model) {
      config.model = await chooseModel(input, config, write, discover);
      if (!config.model) return;
      await writeSettings(config);
    }
    if (config.provider === 'opencode') config.network = true;
    if (setupOnly) {
      active = new AbortController();
      await setupImage(config, write, active.signal);
      return;
    }
    if (config.provider === 'opencode') {
      active = new AbortController();
      try {
        const image = await exec('docker', ['image', 'inspect', config.image ?? BRIDGE_IMAGE], {
          timeout: 15000,
          signal: active.signal,
        });
        if (image.code !== 0) {
          write('  Preparing the official OpenCode image for first use…\n');
          await setupImage(config, write, active.signal);
        }
      } catch (e) {
        if (active.signal.aborted) return;
        write(`  ${safeText(e.message)}\n  Start Docker, then /setup; or choose /provider.\n`);
      } finally {
        active = undefined;
      }
    }
    write(
      `\n  ${safeText(config.provider)} / ${safeText(config.model)} · CHAT\n  ${config.provider === 'opencode' ? 'Docker + network enabled' : 'Project tools inactive in chat'}\n\n`,
    );
    while (true) {
      const line = await input.ask(`  you [${mode}] > `);
      if (line === null) break;
      let text = line.trim();
      if (!text) continue;
      const [command, ...parts] = text.split(/\s+/);
      const rest = parts.join(' ');
      if (command === '/exit' || command === '/quit') break;
      try {
        if (command === '/help') {
          write(HELP + '\n');
          continue;
        }
        if (['/chat', '/plan', '/build'].includes(command)) {
          mode = command.slice(1);
          write(
            `  Mode: ${mode}. ${mode === 'chat' ? 'Conversation only.' : mode === 'plan' ? 'Project is attached on the next message, read-only.' : 'Project is attached on the next message; edits stay staged.'}\n`,
          );
          continue;
        }
        if (command === '/new') {
          session = undefined;
          mode = 'chat';
          write('  New conversation.\n');
          continue;
        }
        if (command === '/provider') {
          const chosen = await chooseProvider(input, config, write, discover);
          if (chosen) {
            config = chosen;
            session = undefined;
            mode = 'chat';
          }
          continue;
        }
        if (command === '/models' || command === '/model') {
          const id = rest || (await chooseModel(input, config, write, discover));
          if (id) {
            config.model = id;
            await writeSettings(config);
            write(`  Model: ${safeText(id)}\n`);
          }
          continue;
        }
        if (command === '/status') {
          write(
            `  ${mode} · ${safeText(config.provider)}/${safeText(config.model)}\n  Session: ${session?.id ?? 'new'} · ${session?.status ?? 'ready'}\n  Usage: ${session?.usage.input ?? 0} input / ${session?.usage.output ?? 0} output tokens\n  Project: ${session?.options.chatOnly === false ? 'attached' : 'not attached'}\n`,
          );
          continue;
        }
        if (command === '/sessions' || command === '/resume') {
          if (command === '/resume' && rest) session = await loadSession(rest);
          else {
            const list = (await sessions())
              .filter((s) => path.resolve(s.original) === path.resolve(cwd))
              .slice(0, 20);
            if (!list.length) {
              write('  No conversations saved for this project.\n');
              continue;
            }
            if (command === '/sessions') {
              list.forEach((s) => write(`  ${s.id}  ${s.status}  ${safeText(s.model ?? '')}\n`));
              continue;
            }
            const id = await select(
              input,
              list.map((s) => ({ value: s.id, label: `${s.id} · ${s.status} · ${s.model ?? ''}` })),
              'session',
              write,
            );
            if (!id) continue;
            session = await loadSession(id);
          }
          assert(session.status !== 'applied', 'This session was applied. Use /new.');
          cwd = session.original;
          config = {
            ...session.options,
            provider:
              session.options.provider === 'opencode-bridge'
                ? 'opencode'
                : session.options.provider,
          };
          mode = session.options.mode ?? (session.options.plan ? 'plan' : 'build');
          write(`  Resumed ${session.id} · ${mode}\n  ${safeText(cwd)}\n`);
          continue;
        }
        if (command === '/setup') {
          active = new AbortController();
          await setupImage(config, write, active.signal);
          continue;
        }
        if (command === '/diff') {
          write(session ? safeText(await diff(session)) + '\n' : '  No session yet.\n');
          continue;
        }
        if (command === '/apply' || command === '/verify') {
          assert(session && !session.options.chatOnly, 'Attach a project with /build first.');
          const release = await lock(session);
          try {
            if (command === '/apply') {
              const result = await applyChanges(session);
              session.status = 'applied';
              await save(session);
              write(
                `  Applied ${result.length} file(s). Next message starts a fresh conversation.\n`,
              );
              session = undefined;
              mode = 'chat';
            } else {
              if (rest) session.options.verify = [rest];
              active = new AbortController();
              const sandbox = new DockerSandbox(session.stage, {
                image: config.provider === 'opencode' ? DEFAULT_IMAGE : config.image,
              });
              await sandbox.prepare();
              const result = await verify(session, sandbox, {
                signal: active.signal,
                onEvent: render,
              });
              write(`  ${result.verified ? 'verified' : 'not verified'}\n`);
            }
          } finally {
            active = undefined;
            await release();
          }
          continue;
        }
        if (command === '/multiline') {
          write('  Paste your message. /send finishes; /cancel discards.\n');
          const lines = [];
          while (true) {
            const next = await input.ask('  … ');
            if (next === null || next === '/cancel') {
              lines.length = 0;
              break;
            }
            if (next === '/send') break;
            lines.push(next);
            assert(lines.join('\n').length <= 32000, 'Message limit: 32000 characters.');
          }
          text = lines.join('\n');
          if (!text.trim()) continue;
        } else if (text.startsWith('/')) {
          write('  Unknown command. /help lists commands.\n');
          continue;
        }
        active = new AbortController();
        write('\n  assistant > ');
        session = await run({
          session,
          cwd,
          prompt: text,
          mode,
          config,
          signal: active.signal,
          onEvent: render,
          onSession: (value) => {
            session = value;
          },
        });
        chatFooter(session, mode);
      } catch (e) {
        write(
          `\n  ${safeText(e.message)}\n  Use /setup for missing images, /provider to change provider, /resume for saved work.\n`,
        );
      } finally {
        active = undefined;
      }
    }
  } finally {
    process.removeListener('SIGINT', cancel);
    input.close();
  }
}
