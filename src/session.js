import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, appendFile, readdir, open, unlink } from 'node:fs/promises';
import { atomicJSON, uid, assert } from './util.js';
import { snapshot } from './workspace.js';

export const home = () =>
  path.resolve(process.env.DIVYANSHARNESS_HOME || process.env.DHAARA_HOME || path.join(os.homedir(), '.divyansharness'));
export async function createSession(workspace, options = {}) {
  const id = uid(),
    dir = path.join(home(), 'sessions', id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stage = path.join(dir, 'workspace'),
    baseline = path.join(dir, 'baseline');
  const data = await snapshot(workspace, stage, baseline);
  const session = {
    version: 1,
    id,
    dir,
    stage,
    baseline,
    ...data,
    created: new Date().toISOString(),
    status: 'ready',
    messages: [],
    notes: [],
    checks: [],
    usage: { input: 0, output: 0, cost: 0 },
    options,
  };
  await save(session);
  await event(session, 'created', { files: Object.keys(data.files).length });
  return session;
}
export async function loadSession(id) {
  assert(
    typeof id === 'string' && /^[a-z0-9]+-[a-f0-9]{10}$/.test(id),
    'Invalid session ID. Use divyansharness sessions.',
  );
  const dir = path.join(home(), 'sessions', id);
  const session = JSON.parse(await readFile(path.join(dir, 'session.json'), 'utf8'));
  assert(session.version === 1 && session.id === id, 'Unsupported session format.');
  // Storage paths never come from editable JSON.
  return {
    ...session,
    dir,
    stage: path.join(dir, 'workspace'),
    baseline: path.join(dir, 'baseline'),
  };
}
export async function save(session) {
  session.updated = new Date().toISOString();
  await atomicJSON(path.join(session.dir, 'session.json'), session);
}
export async function event(session, type, data = {}) {
  await appendFile(
    path.join(session.dir, 'events.jsonl'),
    JSON.stringify({ time: new Date().toISOString(), type, ...data }) + '\n',
    { mode: 0o600 },
  );
}
export async function sessions() {
  let entries;
  try {
    entries = await readdir(path.join(home(), 'sessions'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const results = [];
  for (const id of entries) {
    try {
      const s = await loadSession(id);
      results.push({
        id: s.id,
        status: s.status,
        original: s.original,
        created: s.created,
        updated: s.updated,
      });
    } catch {}
  }
  return results.sort((a, b) => (b.updated ?? b.created).localeCompare(a.updated ?? a.created));
}
export async function lock(session) {
  const file = path.join(session.dir, 'lock');
  try {
    const fd = await open(file, 'wx', 0o600);
    await fd.writeFile(JSON.stringify({ pid: process.pid, time: Date.now() }));
    await fd.close();
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let old;
    try {
      old = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      throw new Error(
        'Session lock is unreadable. Inspect the session directory before removing its lock.',
      );
    }
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') alive = false;
    }
    assert(!alive, 'Session is already in use by another process.');
    await unlink(file);
    return lock(session);
  }
  return async () => {
    try {
      await unlink(file);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  };
}
