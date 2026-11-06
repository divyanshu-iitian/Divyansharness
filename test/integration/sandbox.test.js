import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { DockerSandbox } from '../../src/sandbox.js';
import { exec } from '../../src/util.js';
import { demo } from '../../src/demo.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'divyansharness-sandbox-test-'));
process.env.DIVYANSHARNESS_HOME = path.join(root, 'home');
test.after(() => rm(root, { recursive: true, force: true }));
test('real Docker: stage writable, root readonly, host env absent, network disabled', async () => {
  const stage = await mkdtemp(path.join(root, 'stage-'));
  const s = new DockerSandbox(stage);
  await s.prepare();
  process.env.DIVYANSHARNESS_TEST_SECRET = 'must-not-reach-container';
  const script = `node -e 'const fs=require("fs"); fs.writeFileSync("proof","yes"); if(process.env.DIVYANSHARNESS_TEST_SECRET)process.exit(2); try {fs.writeFileSync("/escape","x");process.exit(3)} catch(e) {if(e.code!=="EROFS"&&e.code!=="EACCES")throw e;} const nets=require("os").networkInterfaces();if(Object.keys(nets).some(k=>k!=="lo"))process.exit(4);console.log("isolated")'`;
  const r = await s.run(script);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /isolated/);
  assert.equal(await readFile(path.join(stage, 'proof'), 'utf8'), 'yes');
  delete process.env.DIVYANSHARNESS_TEST_SECRET;
});
test('real Docker: plan mount cannot write to stage', async () => {
  const stage = await mkdtemp(path.join(root, 'plan-'));
  await writeFile(path.join(stage, 'file'), 'before');
  const s = new DockerSandbox(stage);
  const r = await s.run('echo after > file', { readOnly: true });
  assert.notEqual(r.code, 0);
  assert.equal(await readFile(path.join(stage, 'file'), 'utf8'), 'before');
});
test('real Docker: timeout kills container, not just the CLI client', async () => {
  const stage = await mkdtemp(path.join(root, 'timeout-'));
  const s = new DockerSandbox(stage);
  const r = await s.run('sleep 60', { timeout: 1200 });
  assert.equal(r.code, 124);
  const ps = await exec('docker', [
    'ps',
    '--filter',
    'label=dev.divyansharness.managed=true',
    '--format',
    '{{.Names}}',
  ]);
  assert.equal(ps.stdout.trim(), '');
});
test('real Docker: abort reaps the container', async () => {
  const stage = await mkdtemp(path.join(root, 'abort-'));
  const s = new DockerSandbox(stage);
  await s.prepare();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    await assert.rejects(s.run('sleep 60', { signal: controller.signal }), { name: 'AbortError' });
  } finally {
    clearTimeout(timer);
  }
  const ps = await exec('docker', [
    'ps',
    '--filter',
    'label=dev.divyansharness.managed=true',
    '--format',
    '{{.Names}}',
  ]);
  assert.equal(ps.stdout.trim(), '');
});
test('real Docker: scripted demo verifies bug fix and preserves original', async () => {
  const s = await demo();
  assert.equal(s.status, 'verified');
  assert.equal(s.checks[0].code, 0);
  assert.match(await readFile(path.join(s.original, 'duration.js'), 'utf8'), /seconds \* 100;/);
  assert.match(await readFile(path.join(s.stage, 'duration.js'), 'utf8'), /seconds \* 1000;/);
  // Demo creates a dedicated temp example. Cleanup only this observed test-owned path.
  await rm(s.original, { recursive: true, force: true });
});
test('real Docker: bridge state persists separately while project stays read-only', async () => {
  const stage = await mkdtemp(path.join(root, 'state-stage-'));
  const stateDirectory = await mkdtemp(path.join(root, 'private-state-'));
  const sandbox = new DockerSandbox(stage, { stateDirectory });
  const first = await sandbox.run(
    'echo remembered > "$HOME/memory"; if touch /workspace/forbidden; then exit 9; fi',
    { readOnly: true },
  );
  assert.equal(first.code, 0, first.stderr);
  const second = await sandbox.run('cat "$HOME/memory"', { readOnly: true });
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.stdout.trim(), 'remembered');
  await assert.rejects(readFile(path.join(stage, 'forbidden')), (e) => e.code === 'ENOENT');
});
