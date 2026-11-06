import { createSession, stageConversation } from './session.js';
import { resolveProvider } from './providers.js';
import { DockerSandbox } from './sandbox.js';
import { runAgent } from './agent.js';
import { runChat } from './chat.js';
import { bridge } from './bridge.js';
import { assert } from './util.js';

export async function runTurn({
  session,
  cwd,
  prompt,
  mode = 'chat',
  config = {},
  signal,
  onEvent = () => {},
  onSession = () => {},
}) {
  assert(
    typeof prompt === 'string' && prompt.trim() && prompt.length <= 32000,
    'Enter a message of 1–32000 characters.',
  );
  assert(['chat', 'plan', 'build'].includes(mode), 'Unknown mode.');
  const merged = {
    ...session?.options,
    ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
    mode,
    plan: mode === 'plan',
  };
  const providerKind =
    merged.provider === 'opencode-bridge' ? 'opencode' : (merged.provider ?? 'ollama');
  merged.provider = providerKind;
  if (providerKind === 'opencode')
    return bridge(cwd, prompt, merged, { session, signal, onEvent, onSession });
  const provider = await resolveProvider({ ...merged, signal });
  session ??= await createSession(cwd, { ...merged, chatOnly: mode === 'chat' });
  session.options = { ...session.options, ...merged };
  onSession(session);
  if (mode !== 'chat') await stageConversation(session);
  if (mode === 'chat') return runChat(session, provider, { prompt, signal, onEvent, ...merged });
  return runAgent(
    session,
    provider,
    new DockerSandbox(session.stage, { ...merged, timeout: merged.commandTimeout }),
    { prompt, signal, onEvent, ...merged },
  );
}
