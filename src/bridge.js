import { createSession, save, event, lock, stageConversation } from './session.js';
import path from 'node:path';
import { mkdir, lstat } from 'node:fs/promises';
import { DockerSandbox } from './sandbox.js';
import { listModels } from './providers.js';
import { verify } from './tools.js';
import { assert } from './util.js';

export const BRIDGE_IMAGE = 'divyansharness-opencode:2.2.5';
// Inspect every event, including those evicted from the bounded output tail.
export function bridgeEvents(onRecord = () => {}) {
  let buffer = '',
    count = 0,
    error = false,
    overflow = false,
    stopped = false,
    sessionID,
    answer = '';
  const seen = new Set(),
    usage = { input: 0, output: 0, cost: 0 };
  const line = (text) => {
    try {
      const data = JSON.parse(text);
      count++;
      if (typeof data.sessionID === 'string' && /^ses_[A-Za-z0-9]+$/.test(data.sessionID))
        sessionID = data.sessionID;
      if (data.type === 'text' && typeof data.part?.text === 'string')
        answer = (answer + data.part.text).slice(-64000);
      if (data.type === 'error' || data.error) error = true;
      if (data.type === 'step_finish' && data.part) {
        if (data.part.reason === 'stop') stopped = true;
        if (data.part.id && !seen.has(data.part.id)) {
          seen.add(data.part.id);
          for (const key of ['input', 'output'])
            if (Number.isFinite(data.part.tokens?.[key])) usage[key] += data.part.tokens[key];
          if (Number.isFinite(data.part.cost)) usage.cost += data.part.cost;
        }
      }
      onRecord(data);
    } catch {}
  };
  return {
    push(text) {
      buffer += text;
      if (buffer.length > 2 * 1024 * 1024) {
        overflow = true;
        buffer = '';
        return;
      }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    },
    finish() {
      if (buffer.trim()) {
        line(buffer);
        buffer = '';
      }
      return { count, error, overflow, stopped, usage, sessionID, answer };
    },
  };
}
export async function bridge(
  workspace,
  prompt,
  options,
  { session, signal, onEvent = () => {}, onSession = () => {} } = {},
) {
  assert(
    options.network,
    'OpenCode bridge needs provider network access. Pass --network explicitly. The whole bridge container then has outbound access.',
  );
  const models = await listModels('opencode', { signal });
  const model = options.model ?? models.find((m) => m.id === 'big-pickle')?.id ?? models[0]?.id;
  assert(
    models.some((m) => m.id === model),
    'Select a currently free OpenCode model with divyansharness models --provider opencode.',
  );
  const mode = options.mode ?? 'build';
  session ??= await createSession(workspace, {
    ...options,
    mode,
    chatOnly: mode === 'chat',
    provider: 'opencode-bridge',
  });
  assert(session.status !== 'applied', 'Start a new conversation after applying changes.');
  assert(
    ['opencode', 'opencode-bridge'].includes(session.options.provider),
    'Use /new when switching between native and OpenCode providers.',
  );
  if (mode !== 'chat') await stageConversation(session);
  session.options = {
    ...session.options,
    ...options,
    mode,
    provider: 'opencode-bridge',
    chatOnly: session.options.chatOnly,
  };
  onSession(session);
  const previousStatus = session.status;
  const stateDirectory = path.join(session.dir, 'bridge-state');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  assert(!(await lstat(stateDirectory)).isSymbolicLink(), 'Bridge state cannot be a symlink.');
  const sandbox = new DockerSandbox(session.stage, {
    image: options.image ?? BRIDGE_IMAGE,
    network: true,
    memory: 1024,
    timeout: options.durationMs ?? 600000,
    stateDirectory,
  });
  session.task ??= prompt;
  session.model = `opencode/${model}`;
  const release = await lock(session);
  try {
    await sandbox.prepare();
    session.status = 'running';
    await save(session);
    const environment = {
      DIVYANSHARNESS_BRIDGE_MODEL: `opencode/${model}`,
      DIVYANSHARNESS_BRIDGE_PROMPT:
        mode === 'chat'
          ? `CHAT mode. Reply conversationally in the user's language. Do not run tools or inspect files. If code changes are wanted, suggest /build. User message: ${prompt}`
          : prompt,
      DIVYANSHARNESS_BRIDGE_AGENT: mode === 'build' ? 'build' : 'plan',
      DIVYANSHARNESS_BRIDGE_SESSION: session.bridgeSession ?? '',
    };
    assert(
      !session.bridgeSession || /^ses_[A-Za-z0-9]+$/.test(session.bridgeSession),
      'Invalid saved bridge session ID.',
    );
    if (process.env.OPENCODE_API_KEY) environment.OPENCODE_API_KEY = process.env.OPENCODE_API_KEY;
    await event(session, 'bridge_start', { model: session.model, image: sandbox.resolvedImage });
    const shown = new Set();
    const events = bridgeEvents((data) => {
      if (data.sessionID && /^ses_[A-Za-z0-9]+$/.test(data.sessionID))
        session.bridgeSession = data.sessionID;
      if (data.type === 'text' && data.part?.text) onEvent({ type: 'token', text: data.part.text });
      if (
        data.type === 'tool_use' &&
        data.part?.state?.status === 'completed' &&
        !shown.has(data.part.id)
      ) {
        shown.add(data.part.id);
        onEvent({ type: 'tool', name: data.part.tool, args: data.part.state.input ?? {} });
      }
      if (data.type === 'error' || data.error)
        onEvent({
          type: 'tool_result',
          name: 'opencode',
          result: {
            error:
              data.error?.data?.message ?? data.error?.message ?? 'OpenCode reported an error.',
          },
        });
    });
    session.messages.push({ role: 'user', content: prompt });
    await save(session);
    const result = await sandbox.run(
      'mkdir -p "$HOME"; if [ -n "$DIVYANSHARNESS_BRIDGE_SESSION" ]; then set -- --session "$DIVYANSHARNESS_BRIDGE_SESSION"; else set --; fi; opencode run --standalone --auto --format json --agent "$DIVYANSHARNESS_BRIDGE_AGENT" --model "$DIVYANSHARNESS_BRIDGE_MODEL" "$@" "$DIVYANSHARNESS_BRIDGE_PROMPT"',
      {
        signal,
        environment,
        timeout: options.durationMs ?? 600000,
        readOnly: mode !== 'build',
        onData: (text, stderr) => {
          if (!stderr) events.push(text);
        },
      },
    );
    const observed = events.finish();
    for (const key of ['input', 'output', 'cost']) session.usage[key] += observed.usage[key];
    await event(session, 'bridge_exit', {
      code: result.code,
      durationMs: result.durationMs,
      events: observed,
      stdoutTail: result.stdout,
      stderrTail: result.stderr,
    });
    assert(
      result.code === 0,
      `Official OpenCode CLI exited ${result.code}. ${result.stderr.slice(-1200)}\nSession ${session.id} is saved. Provider free-tier access is not guaranteed.`,
    );
    // Some CLIs return 0 while reporting provider errors as JSON events.
    assert(
      !observed.error && !observed.overflow,
      `OpenCode reported an error or oversized event. Inspect session ${session.id}; no completion accepted.`,
    );
    assert(observed.count > 0, 'OpenCode returned no JSON events. No completion accepted.');
    assert(
      observed.stopped,
      'OpenCode returned no final stop event. Inspect the saved session before retrying.',
    );
    session.summary = observed.answer || 'Official OpenCode turn completed.';
    session.messages.push({ role: 'assistant', content: session.summary });
    if (mode !== 'build') {
      session.status =
        mode === 'plan' ? 'planned' : previousStatus === 'verified' ? 'verified' : 'answered';
      await save(session);
      return session;
    }
    // Verification defaults back to offline isolation, even though inference needed network.
    const checker = new DockerSandbox(session.stage, {
      image: options.verifyImage ?? 'node:22-alpine',
      network: false,
    });
    await checker.prepare();
    await verify(session, checker, { signal, onEvent });
    await save(session);
    return session;
  } catch (e) {
    session.status = signal?.aborted ? 'interrupted' : 'failed';
    session.error = e.message;
    await save(session);
    throw e;
  } finally {
    await release();
  }
}
