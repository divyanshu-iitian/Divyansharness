import path from 'node:path';
import { constants } from 'node:fs';
import { readdir, lstat, readFile, writeFile, mkdir, realpath, copyFile, rename, unlink, open } from 'node:fs/promises';
import { assert, sha, uid, truncate } from './util.js';

const EXCLUDED = new Set(['.git', '.dhaara', '.dhaaraignore', 'node_modules', '.venv', 'venv', '__pycache__', '.next', '.nuxt', 'dist', 'build', 'coverage', '.ssh', '.aws', '.azure', '.config', '.opencode', '.npmrc', '.pypirc']);
const SECRET = /(^\.env($|\.)|\.(pem|key|p12|pfx|keystore)$|^id_(rsa|ed25519)$|^credentials(\.json)?$)/i;
export const MAX_FILE = 1024 * 1024;
export function blocked(relative) {
  return relative.split('/').some(part => EXCLUDED.has(part.toLowerCase()) || SECRET.test(part));
}
function glob(pattern) {
  return new RegExp('^' + pattern.split('').map(c => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[\\^$+?.()|{}\[\]]/g, '\\$&')).join('') + '(?:/.*)?$');
}
export async function rules(root) {
  try { const file=path.join(root,'.dhaaraignore');assert(!(await lstat(file)).isSymbolicLink(),'.dhaaraignore cannot be a symlink.');return (await readFile(file, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(s => glob(s.replace(/^\//, '').replace(/\/$/, ''))); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
/** Reject traversal, links, reserved names and non-portable paths on every platform. */
export async function safePath(root, relative) {
  assert(typeof relative === 'string' && relative.length > 0 && relative.length <= 1000, 'A relative file path is required.');
  assert(!relative.includes('\\') && !relative.includes(':') && !path.posix.isAbsolute(relative), 'Use a relative path with forward slashes.');
  const parts = relative.split('/');
  assert(parts.every(p => p && p !== '.' && p !== '..' && !/[\x00-\x1f<>"|?*]/.test(p) && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)), 'Unsafe or non-portable path.');
  assert(!blocked(relative), 'This path is excluded from the agent workspace.');
  let candidate = root;
  for (const part of parts) {
    candidate = path.join(candidate, part);
    try { const stat = await lstat(candidate); assert(!stat.isSymbolicLink(), 'Symlinks are not supported in agent workspaces.'); assert(stat.isFile() || stat.isDirectory(), 'Special files are not supported.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return candidate;
}
export async function inventory(root, { maxFiles = 5000, maxBytes = 64 * 1024 * 1024, useIgnore = false } = {}) {
  const files = {}; let bytes = 0;
  const ignores = useIgnore ? await rules(root) : [];
  async function walk(dir, prefix = '') {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name));
    for (const item of entries) {
      const rel = prefix + item.name;
      if (blocked(rel) || ignores.some(re => re.test(rel)) || item.isSymbolicLink()) continue;
      // The same validation is used by snapshot, inspection and application.
      const full = await safePath(root, rel);
      if (item.isDirectory()) { await walk(full, rel + '/'); continue; }
      if (!item.isFile()) continue;
      const stat = await lstat(full);
      assert(stat.size <= MAX_FILE, `${rel} exceeds 1 MiB. Exclude it in .dhaaraignore.`);
      bytes += stat.size;
      assert(bytes <= maxBytes && Object.keys(files).length < maxFiles, 'Snapshot exceeds 64 MiB / 5000 files. Add exclusions to .dhaaraignore.');
      const data = await readFile(full);
      files[rel] = { hash: sha(data), bytes: data.length, mode: stat.mode & 0o777 };
    }
  }
  await walk(root);
  return files;
}
export async function snapshot(source, stage, baseline) {
  const original = await realpath(source);
  const files = await inventory(original, { useIgnore: true });
  for (const dest of [stage, baseline]) {
    await mkdir(dest, { recursive: true, mode: 0o700 });
    for (const [rel, info] of Object.entries(files)) {
      const target = path.join(dest, rel); await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(original, rel), target, constants.COPYFILE_EXCL);
      // Catch source changes during the snapshot instead of recording a wrong baseline.
      assert(sha(await readFile(target)) === info.hash, `${rel} changed during snapshot. Retry.`);
    }
  }
  return { original, files };
}
export async function readText(root, relative) {
  const full = await safePath(root, relative); const stat = await lstat(full);
  assert(stat.isFile() && stat.size <= MAX_FILE, 'Read expects a text file no larger than 1 MiB.');
  const content = await readFile(full, 'utf8'); assert(!content.includes('\0'), 'Binary files cannot be edited as text.'); return content;
}
export async function readAnchored(root, relative, start = 1, limit = 160) {
  const text = await readText(root, relative); const lines = text.split('\n');
  assert(Number.isInteger(start) && start >= 1 && Number.isInteger(limit) && limit >= 1 && limit <= 500, 'Invalid line range.');
  return { path: relative, hash: sha(text), total_lines: lines.length, content: truncate(lines.slice(start-1, start-1+limit).map((line,i) => `${start+i}|${line}`).join('\n'), 18000) };
}
export async function editFile(root, args) {
  const { path: relative, hash, content, edits, remove = false } = args;
  const full = await safePath(root, relative);
  let before = null;
  try { before = await readText(root, relative); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (before !== null) assert(hash === sha(before), 'STALE_EDIT: read the file again and use its current full hash. No changes applied.');
  else assert(hash === undefined || hash === null, 'File no longer exists; read the directory again.');
  assert([remove, content !== undefined, edits !== undefined].filter(Boolean).length === 1, 'Choose exactly one: content, edits, or remove.');
  if (remove) { assert(before !== null, 'Cannot delete a missing file.'); await unlink(full); return { path: relative, deleted: true }; }
  let after = content;
  if (edits !== undefined) {
    assert(before !== null && Array.isArray(edits) && edits.length > 0 && edits.length <= 100, 'Edits require an existing file and 1–100 ranges.');
    const lines = before.split('\n');
    const ordered = [...edits].sort((a,b) => a.start - b.start); let previousEnd = 0;
    for (const e of ordered) {
      assert(Number.isInteger(e.start) && Number.isInteger(e.end) && typeof e.content === 'string' && e.start > previousEnd && e.start >= 1 && e.end >= e.start - 1 && e.end <= lines.length && e.start <= lines.length + 1, 'Invalid or overlapping line ranges.');
      previousEnd = Math.max(e.start, e.end);
    }
    for (const e of ordered.reverse()) lines.splice(e.start-1, e.end-e.start+1, ...(e.content === '' ? [] : e.content.split('\n')));
    after = lines.join('\n');
  }
  assert(typeof after === 'string' && !after.includes('\0') && Buffer.byteLength(after) <= MAX_FILE, 'Content must be text under 1 MiB.');
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.dhaara-${uid()}`;
  await writeFile(tmp, after, { flag: 'wx' }); await rename(tmp, full);
  return { path: relative, hash: sha(after), bytes: Buffer.byteLength(after) };
}
export async function changes(session) {
  const now = await inventory(session.stage);
  return [...new Set([...Object.keys(session.files), ...Object.keys(now)])].sort().filter(p => session.files[p]?.hash !== now[p]?.hash).map(p => ({ path: p, type: !session.files[p] ? 'add' : !now[p] ? 'delete' : 'modify', before: session.files[p]?.hash ?? null, after: now[p]?.hash ?? null }));
}
export async function fingerprint(root) { return sha(JSON.stringify(await inventory(root))); }
export async function diff(session) {
  const result = [];
  for (const change of await changes(session)) {
    const before = change.before ? await readText(session.baseline, change.path) : '';
    const after = change.after ? await readText(session.stage, change.path) : '';
    const a = before.split('\n'), b = after.split('\n'); let first = 0, lastA = a.length, lastB = b.length;
    while (first < Math.min(a.length,b.length) && a[first] === b[first]) first++;
    while (lastA > first && lastB > first && a[lastA-1] === b[lastB-1]) {lastA--;lastB--;}
    const from = Math.max(0, first-3), toA = Math.min(a.length,lastA+3), toB = Math.min(b.length,lastB+3);
    result.push(`diff --dhaara a/${change.path} b/${change.path}\n--- ${change.before ? 'a/'+change.path : '/dev/null'}\n+++ ${change.after ? 'b/'+change.path : '/dev/null'}\n@@ -${from+1},${toA-from} +${from+1},${toB-from} @@\n` + a.slice(from,first).map(s=>' '+s).concat(a.slice(first,lastA).map(s=>'-'+s),b.slice(first,lastB).map(s=>'+'+s),b.slice(lastB,toB).map(s=>' '+s)).join('\n'));
  }
  return result.join('\n\n') || 'No changes.';
}

/** Preflight ALL conflicts before touching original files; keep durable originals for recovery. */
export async function applyChanges(session, { allowUnverified = false } = {}) {
  assert(session.status !== 'running', 'Cannot apply a running session.');
  assert(session.status !== 'applied', 'This session is already applied.');
  assert(allowUnverified || (session.status === 'verified' && session.verifiedHash === await fingerprint(session.stage)), 'Changes have not passed verification, or changed since verification. Review them; use --allow-unverified explicitly if appropriate.');
  const list = await changes(session); const prepared = [];
  for (const change of list) {
    const target = await safePath(session.original, change.path); let existing = null;
    try { existing = sha(await readFile(target)); } catch(e) { if(e.code !== 'ENOENT') throw e; }
    assert(existing === change.before, `CONFLICT: ${change.path} changed in your working tree. Nothing applied.`);
    const data = change.after ? await readFile(await safePath(session.stage, change.path)) : null;
    assert(data === null || sha(data) === change.after, 'Stage changed during application. Retry.');
    prepared.push({ ...change, target, data });
  }
  // No force overwrite. Existing files are checked again immediately before replacement.
  for (const item of prepared) {
    await safePath(session.original, item.path);
    let current = null; try { current = sha(await readFile(item.target)); } catch(e) { if(e.code !== 'ENOENT') throw e; }
    assert(current === item.before, `CONFLICT during apply: ${item.path}. Earlier files may have applied; originals remain in ${session.baseline}.`);
    if (item.data === null) await unlink(item.target);
    else if (!item.before) { await mkdir(path.dirname(item.target), {recursive:true}); const h = await open(item.target,'wx'); try {await h.writeFile(item.data);} finally {await h.close();} }
    else { const tmp = `${item.target}.dhaara-${uid()}`; await writeFile(tmp,item.data,{flag:'wx',mode:session.files[item.path]?.mode}); await rename(tmp,item.target); }
  }
  return list;
}
