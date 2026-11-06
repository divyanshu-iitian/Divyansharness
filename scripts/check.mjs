import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
let count = 0;
async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (/\.(m?js)$/.test(p)) {
      const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
      if (r.status !== 0) {
        console.error(r.stderr);
        process.exitCode = 1;
      }
      count++;
    }
  }
}
for (const dir of ['src', 'bin', 'scripts', 'test']) await walk(dir);
console.log(
  `${process.exitCode ? 'Some checks failed; inspected' : 'Syntax checked'} ${count} JavaScript modules.`,
);
