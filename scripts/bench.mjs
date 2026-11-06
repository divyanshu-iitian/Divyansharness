import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { VERSION } from '../src/util.js';

const samples = [];
for (let i = 0; i < 7; i++) {
  const start = performance.now();
  const r = spawnSync(process.execPath, ['bin/dhaara.js', '--version'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  samples.push(performance.now() - start);
}
let sourceBytes = 0;
for (const name of await readdir('src')) sourceBytes += (await stat(path.join('src', name))).size;
const m = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "await import('./src/cli.js');console.log(JSON.stringify(process.memoryUsage()))",
  ],
  { encoding: 'utf8' },
);
if (m.status !== 0) throw new Error(m.stderr);
const report = {
  kind: 'local-cli-overhead-not-model-benchmark',
  version: VERSION,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: os.cpus()[0]?.model,
  measuredAt: new Date().toISOString(),
  runtimeDependencies: 0,
  sourceBytes,
  startupMs: samples.map((n) => Math.round(n * 10) / 10),
  medianStartupMs: Math.round([...samples].sort((a, b) => a - b)[3] * 10) / 10,
  importedCLI: JSON.parse(m.stdout),
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/overhead.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
