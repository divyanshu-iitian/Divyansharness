import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { home } from './session.js';
import { atomicJSON, assert, endpoint } from './util.js';

const allowed = ['provider', 'model', 'baseURL', 'network'];
export function cleanSettings(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid settings.');
  const data = Object.fromEntries(
    allowed.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
  );
  if (data.provider !== undefined)
    assert(
      ['ollama', 'opencode', 'openrouter', 'compatible'].includes(data.provider),
      'Unknown saved provider.',
    );
  if (data.model !== undefined)
    assert(
      typeof data.model === 'string' && data.model.length > 0 && data.model.length < 300,
      'Invalid saved model.',
    );
  if (data.baseURL !== undefined) data.baseURL = endpoint(data.baseURL);
  if (data.network !== undefined)
    assert(typeof data.network === 'boolean', 'Invalid network setting.');
  return data;
}
export async function readSettings() {
  try {
    return cleanSettings(JSON.parse(await readFile(path.join(home(), 'config.json'), 'utf8')));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${path.join(home(), 'config.json')}: ${e.message}`);
  }
}
export async function writeSettings(value) {
  // Never persist credentials, prompts, or arbitrary caller fields.
  await atomicJSON(path.join(home(), 'config.json'), cleanSettings(value));
}
