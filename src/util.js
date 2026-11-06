import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export const VERSION = '0.2.0';
export const sha = (data) => createHash('sha256').update(data).digest('hex');
export const uid = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
export const truncate = (s, n = 16000) =>
  s.length > n ? `${s.slice(0, n)}\n[truncated: ${s.length - n} more characters]` : s;
// Never let repository/model output emit terminal controls or OSC hyperlinks.
export const safeText = (s) =>
  String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function integer(value, name, min, max) {
  const n = Number(value);
  assert(
    Number.isSafeInteger(n) && n >= min && n <= max,
    `${name} must be an integer from ${min} to ${max}.`,
  );
  return n;
}
export async function atomicJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(5).toString('hex')}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

/** Spawn without a shell. Bounded output; AbortSignal and timeout kill the client. */
export function exec(
  file,
  args = [],
  { cwd, env, timeout = 30000, signal, maxOutput = 64000, onData } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    let output = '',
      errorOutput = '',
      timedOut = false,
      settled = false;
    const child = spawn(file, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (data, err) => {
      const text = data.toString();
      onData?.(text, err);
      if (err) errorOutput = (errorOutput + text).slice(-maxOutput);
      else output = (output + text).slice(-maxOutput);
    };
    child.stdout.on('data', (data) => append(data, false));
    child.stderr.on('data', (data) => append(data, true));
    const cancel = () => child.kill('SIGKILL');
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, timeout);
    signal?.addEventListener('abort', cancel, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    };
    child.on('error', (e) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(e);
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal?.aborted)
        return reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        stdout: output,
        stderr: errorOutput,
        timedOut,
      });
    });
  });
}

export function endpoint(value) {
  const url = new URL(value);
  assert(
    !url.username && !url.password && !url.search && !url.hash,
    'Provider URL cannot contain credentials, query parameters, or fragments.',
  );
  assert(
    url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)),
    'Use HTTPS, or HTTP on localhost.',
  );
  return url.href.replace(/\/$/, '');
}
