import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inventory, readAnchored, readText, editFile, fingerprint } from './workspace.js';
import { assert, truncate } from './util.js';
import { save, event } from './session.js';

const object = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const string = { type: 'string' },
  number = { type: 'integer' };
const tool = (name, description, parameters) => ({
  type: 'function',
  function: { name, description, parameters },
});
export const TOOLS = [
  tool(
    'list_files',
    'List relative workspace file paths. Filter with an optional path substring.',
    object({ contains: string }),
  ),
  tool(
    'read_file',
    'Read numbered lines and a whole-file SHA-256. Lines start at 1. Omit start/limit to read the first 160 lines. Supply the returned hash to edit_file.',
    object(
      {
        path: string,
        start: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      ['path'],
    ),
  ),
  tool(
    'search',
    'Literal case-insensitive text search. Returns paths and numbered matching lines; no regex.',
    object({ query: string, path_contains: string }, ['query']),
  ),
  tool(
    'edit_file',
    'Atomically create, replace, delete, or edit inclusive numbered line ranges. Existing files REQUIRE the latest read_file hash. An insertion has end=start-1. Exactly one of content, edits, remove.',
    object(
      {
        path: string,
        hash: string,
        content: string,
        remove: { type: 'boolean' },
        edits: {
          type: 'array',
          items: object({ start: number, end: number, content: string }, [
            'start',
            'end',
            'content',
          ]),
        },
      },
      ['path'],
    ),
  ),
  tool(
    'run_command',
    'Run a shell command in a disposable Linux Docker container. Only staged workspace persists. No network by default. Host secrets and original repo are never mounted.',
    object({ command: string, timeout_ms: number }, ['command']),
  ),
  tool(
    'checkpoint',
    'Save concise decisions and remaining work across context compaction. No secrets.',
    object({ notes: string }, ['notes']),
  ),
  tool(
    'finish',
    'Submit a concise outcome. Harness runs configured verification commands before accepting completion. A failed check returns feedback for repair.',
    object({ summary: string }, ['summary']),
  ),
];
const allowed = new Map(TOOLS.map((t) => [t.function.name, t.function.parameters]));
function validate(value, schema, label = 'arguments') {
  if (schema.type === 'object') {
    assert(
      value !== null && typeof value === 'object' && !Array.isArray(value),
      `${label} must be an object.`,
    );
    for (const key of schema.required ?? [])
      assert(Object.hasOwn(value, key), `${label}.${key} is required.`);
    for (const [key, v] of Object.entries(value)) {
      assert(Object.hasOwn(schema.properties, key), `Unknown ${label}.${key}.`);
      validate(v, schema.properties[key], `${label}.${key}`);
    }
  } else if (schema.type === 'array') {
    assert(
      Array.isArray(value) && value.length <= 100,
      `${label} must be an array of at most 100 items.`,
    );
    value.forEach((v) => validate(v, schema.items, label));
  } else if (schema.type === 'integer') {
    assert(Number.isSafeInteger(value), `${label} must be an integer.`);
    if (schema.minimum !== undefined)
      assert(value >= schema.minimum, `${label} must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined)
      assert(value <= schema.maximum, `${label} must be at most ${schema.maximum}.`);
  } else assert(typeof value === schema.type, `${label} must be ${schema.type}.`);
}
export function parseTool(call) {
  const name = call.function?.name;
  assert(allowed.has(name), `Unknown tool: ${name}`);
  assert(
    typeof call.function.arguments === 'string' && call.function.arguments.length <= 1024 * 1024,
    'Tool arguments exceed limit.',
  );
  const args = JSON.parse(call.function.arguments);
  validate(args, allowed.get(name));
  return { name, args };
}
export async function verificationCommands(session) {
  if (session.options.verify?.length) return session.options.verify;
  try {
    const p = JSON.parse(await readFile(path.join(session.stage, 'package.json'), 'utf8'));
    if (p.scripts?.test && !p.scripts.test.includes('no test specified')) return ['npm test'];
  } catch {}
  const files = Object.keys(await inventory(session.stage));
  if (files.some((p) => /\.test\.(m?js|cjs)$/.test(p))) return ['node --test'];
  return [];
}
export async function verify(session, sandbox, { signal, onEvent = () => {} } = {}) {
  assert(
    session.status !== 'applied',
    'An applied session cannot be reverified. Start a new session for the updated repository.',
  );
  const commands = await verificationCommands(session);
  session.checks = [];
  if (!commands.length) {
    session.status = 'needs-review';
    session.verifiedHash = null;
    await save(session);
    return {
      ok: !session.options.requireVerification,
      verified: false,
      message:
        'No verification command configured. Review manually or run dhaara verify SESSION --verify "command". Applying requires --allow-unverified.',
    };
  }
  for (const command of commands) {
    onEvent({ type: 'verify', command });
    const result = await sandbox.run(command, {
      signal,
      timeout: session.options.commandTimeout ?? 60000,
    });
    const check = {
      command,
      code: result.code,
      durationMs: result.durationMs,
      output: truncate(result.stdout + '\n' + result.stderr, 12000),
    };
    session.checks.push(check);
    await event(session, 'verification', check);
  }
  const ok = session.checks.every((c) => c.code === 0);
  session.status = ok ? 'verified' : 'verification-failed';
  session.verifiedHash = ok ? await fingerprint(session.stage) : null;
  await save(session);
  return { ok, verified: ok, checks: session.checks };
}
export async function executeTool(name, args, { session, sandbox, signal, onEvent = () => {} }) {
  switch (name) {
    case 'list_files':
      return {
        files: Object.keys(await inventory(session.stage))
          .filter((p) => !args.contains || p.includes(args.contains))
          .slice(0, 300),
      };
    case 'read_file':
      return readAnchored(session.stage, args.path, args.start ?? 1, args.limit ?? 160);
    case 'search': {
      assert(
        args.query.length > 0 && args.query.length <= 500,
        'Search query must be 1–500 characters.',
      );
      const matches = [];
      for (const p of Object.keys(await inventory(session.stage))) {
        if (args.path_contains && !p.includes(args.path_contains)) continue;
        let text;
        try {
          text = await readText(session.stage, p);
        } catch {
          continue;
        }
        text.split('\n').forEach((line, i) => {
          if (matches.length < 80 && line.toLowerCase().includes(args.query.toLowerCase()))
            matches.push({ path: p, line: i + 1, text: truncate(line, 300) });
        });
        if (matches.length >= 80) break;
      }
      return { matches, limited: matches.length === 80 };
    }
    case 'edit_file':
      assert(!session.options.plan, 'Plan mode cannot edit files.');
      session.verifiedHash = null;
      return editFile(session.stage, args);
    case 'run_command': {
      const timeout = args.timeout_ms ?? session.options.commandTimeout ?? 60000;
      assert(
        timeout >= 100 && timeout <= 120000,
        'Command timeout must be between 100 and 120000 ms.',
      );
      session.verifiedHash = null;
      const r = await sandbox.run(args.command, {
        signal,
        timeout,
        readOnly: session.options.plan,
      });
      return { ...r, stdout: truncate(r.stdout), stderr: truncate(r.stderr, 8000) };
    }
    case 'checkpoint':
      assert(args.notes.length <= 6000, 'Keep checkpoint notes under 6000 characters.');
      session.notes = [...session.notes.slice(-2), args.notes];
      await save(session);
      return { saved: true };
    case 'finish': {
      assert(args.summary.length <= 12000, 'Keep the final summary under 12000 characters.');
      session.summary = args.summary;
      if (session.options.plan) {
        session.status = 'planned';
        await save(session);
        return { ok: true, planned: true };
      }
      return verify(session, sandbox, { signal, onEvent });
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
