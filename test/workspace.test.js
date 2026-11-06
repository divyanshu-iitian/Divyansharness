import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises';
import {
  safePath,
  snapshot,
  readAnchored,
  editFile,
  applyChanges,
  fingerprint,
  changes,
  inventory,
} from '../src/workspace.js';

async function fixture(t, files = { 'a.js': 'one\ntwo\nthree\n' }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dhaara-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = path.join(dir, 'source'),
    stage = path.join(dir, 'stage'),
    baseline = path.join(dir, 'baseline');
  await mkdir(original);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(original, name)), { recursive: true });
    await writeFile(path.join(original, name), text);
  }
  const data = await snapshot(original, stage, baseline);
  return { dir, stage, baseline, ...data, status: 'needs-review' };
}
test('snapshot excludes secrets, dependencies and ignore patterns', async (t) => {
  const s = await fixture(t, {
    'a.js': 'ok',
    '.env': 'SECRET',
    'nested/.env.local': 'SECRET',
    'key.pem': 'SECRET',
    'node_modules/pkg/x.js': 'x',
    '.dhaaraignore': 'generated/\n',
    'generated/x': 'skip',
  });
  assert.deepEqual(Object.keys(s.files), ['a.js']);
});
test('workspace rejects traversal, absolute paths, NTFS streams and device names', async (t) => {
  const s = await fixture(t);
  for (const bad of [
    '../escape',
    '/etc/passwd',
    'C:/x',
    'a\\b',
    'a.js:stream',
    'a/../../z',
    'NUL',
    'x/CON.txt',
    '.git/config',
    '.env',
    'x.',
    'x ',
  ])
    await assert.rejects(safePath(s.stage, bad));
});
test('range edit uses a whole-file hash and leaves original untouched', async (t) => {
  const s = await fixture(t);
  const r = await readAnchored(s.stage, 'a.js');
  await editFile(s.stage, {
    path: 'a.js',
    hash: r.hash,
    edits: [{ start: 2, end: 2, content: 'TWO' }],
  });
  assert.equal(await readFile(path.join(s.stage, 'a.js'), 'utf8'), 'one\nTWO\nthree\n');
  assert.equal(await readFile(path.join(s.original, 'a.js'), 'utf8'), 'one\ntwo\nthree\n');
  await assert.rejects(
    editFile(s.stage, { path: 'a.js', hash: r.hash, content: 'BAD' }),
    /STALE_EDIT/,
  );
});
test('invalid multi-edit transaction applies nothing', async (t) => {
  const s = await fixture(t);
  const r = await readAnchored(s.stage, 'a.js');
  await assert.rejects(
    editFile(s.stage, {
      path: 'a.js',
      hash: r.hash,
      edits: [
        { start: 1, end: 2, content: 'x' },
        { start: 2, end: 3, content: 'y' },
      ],
    }),
    /overlapping/,
  );
  assert.equal((await readAnchored(s.stage, 'a.js')).hash, r.hash);
});
test('new files, inserts and deletions work without blind overwrite', async (t) => {
  const s = await fixture(t);
  await editFile(s.stage, { path: 'new/f.js', content: 'hello' });
  const r = await readAnchored(s.stage, 'a.js');
  await editFile(s.stage, {
    path: 'a.js',
    hash: r.hash,
    edits: [{ start: 2, end: 1, content: 'insert' }],
  });
  assert.match(await readFile(path.join(s.stage, 'a.js'), 'utf8'), /one\ninsert\ntwo/);
  await assert.rejects(editFile(s.stage, { path: 'new/f.js', content: 'overwrite' }), /STALE_EDIT/);
  const n = await readAnchored(s.stage, 'new/f.js');
  await editFile(s.stage, { path: 'new/f.js', hash: n.hash, remove: true });
  assert.equal((await changes(s)).length, 1);
});
test('apply preflights ALL conflicts before writing any original file', async (t) => {
  const s = await fixture(t, { 'a.js': 'a', 'z.js': 'z' });
  for (const p of ['a.js', 'z.js']) {
    const r = await readAnchored(s.stage, p);
    await editFile(s.stage, { path: p, hash: r.hash, content: 'changed' });
  }
  await writeFile(path.join(s.original, 'z.js'), 'human edit');
  await assert.rejects(applyChanges(s, { allowUnverified: true }), /CONFLICT/);
  assert.equal(await readFile(path.join(s.original, 'a.js'), 'utf8'), 'a');
});
test('verified apply rejects changes after verification', async (t) => {
  const s = await fixture(t);
  s.status = 'verified';
  s.verifiedHash = await fingerprint(s.stage);
  await writeFile(path.join(s.stage, 'a.js'), 'changed');
  await assert.rejects(applyChanges(s), /not passed verification/);
});
test('verified apply adds, edits and deletes files', async (t) => {
  const s = await fixture(t, { 'a.js': 'a', 'delete.js': 'd' });
  await writeFile(path.join(s.stage, 'a.js'), 'new');
  await editFile(s.stage, { path: 'added.js', content: 'added' });
  const r = await readAnchored(s.stage, 'delete.js');
  await editFile(s.stage, { path: 'delete.js', hash: r.hash, remove: true });
  s.status = 'verified';
  s.verifiedHash = await fingerprint(s.stage);
  assert.equal((await applyChanges(s)).length, 3);
  assert.equal(await readFile(path.join(s.original, 'a.js'), 'utf8'), 'new');
  await assert.rejects(lstat(path.join(s.original, 'delete.js')), /ENOENT/);
});
test('agent-created ignore rules cannot hide staged changes', async (t) => {
  const s = await fixture(t);
  await writeFile(path.join(s.stage, '.dhaaraignore'), '*');
  await writeFile(path.join(s.stage, 'a.js'), 'changed');
  assert.equal((await changes(s)).length, 1);
  assert.equal(Object.keys(await inventory(s.stage)).length, 1);
});
test('symlinks are rejected by tools and skipped by snapshots', async (t) => {
  const s = await fixture(t);
  const target = path.join(s.dir, 'secret');
  await writeFile(target, 'secret');
  try {
    await symlink(target, path.join(s.stage, 'link'));
  } catch (e) {
    if (e.code === 'EPERM') {
      t.skip('Windows symlink privilege unavailable');
      return;
    }
    throw e;
  }
  await assert.rejects(readAnchored(s.stage, 'link'), /Symlinks/);
  assert.equal(Object.keys(await inventory(s.stage)).length, 1);
});
