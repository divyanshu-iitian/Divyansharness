import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DockerSandbox } from '../../src/sandbox.js';
import { BRIDGE_IMAGE } from '../../src/bridge.js';

test('official CLI starts with bridge isolation and supports the selected automation flags', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dhaara-bridge-image-'));
  try {
    const sandbox = new DockerSandbox(directory, { image: BRIDGE_IMAGE, memory: 1024 });
    const version = await sandbox.run('opencode --version');
    assert.equal(version.code, 0, version.stderr);
    assert.match(version.stdout, /2\.2\.5/);
    const help = await sandbox.run('opencode run --standalone --auto --format json --help');
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /--standalone/);
    assert.match(help.stdout, /--auto/);
  } finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dhaara-bridge-image-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
