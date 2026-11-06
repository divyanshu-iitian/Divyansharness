import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createSession, loadSession, stageConversation, save } from '../src/session.js';
import { runChat } from '../src/chat.js';
import { writeSettings, readSettings } from '../src/settings.js';
import { TerminalInput } from '../src/terminal-input.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'divyansharness-chat-test-'));
process.env.DIVYANSHARNESS_HOME = path.join(root, 'home');
test.after(async () => {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('divyansharness-chat-test-'));
  await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const cwd = await mkdtemp(path.join(root, 'project-'));
  await writeFile(path.join(cwd, 'private-source.js'), 'not-sent-by-chat');
  return createSession(cwd, { chatOnly: true, provider: 'compatible' });
}
test('native chat preserves turns without copying project files or calling sandbox/tools', async () => {
  const s = await fixture();
  let turn = 0;
  const provider = {
    model: 'test',
    complete: async (messages, tools) => {
      assert.deepEqual(tools, []);
      assert.ok(!JSON.stringify(messages).includes('not-sent-by-chat'));
      if (turn++)
        assert.ok(
          messages.some((m) => m.role === 'assistant' && m.content === 'remembered cobalt'),
        );
      return {
        message: { role: 'assistant', content: 'remembered cobalt' },
        usage: { prompt_tokens: 4, completion_tokens: 3 },
        finish: 'stop',
      };
    },
  };
  await runChat(s, provider, { prompt: 'Remember cobalt' });
  await runChat(s, provider, { prompt: 'What word?' });
  assert.equal(s.status, 'answered');
  assert.equal(s.usage.input, 8);
  assert.deepEqual(await readdir(s.stage), []);
  const saved = await loadSession(s.id);
  assert.equal(saved.messages.length, 4);
});
test('chat mode refuses unsolicited tool execution', async () => {
  const s = await fixture();
  const provider = {
    model: 'bad',
    complete: async () => ({
      message: {
        role: 'assistant',
        tool_calls: [
          { id: 'x', function: { name: 'run_command', arguments: '{"command":"touch bad"}' } },
        ],
      },
    }),
  };
  await assert.rejects(runChat(s, provider, { prompt: 'hello' }), /does not execute tools/);
  assert.deepEqual(await readdir(s.stage), []);
  assert.equal(s.status, 'failed');
});
test('an applied session stays applied when conversation resume is rejected',async()=>{
  const s=await fixture();s.status='applied';await save(s);
  await assert.rejects(runChat(s,{model:'unused'},{prompt:'continue'}),/new conversation/);
  assert.equal((await loadSession(s.id)).status,'applied');
});
test('explicit promotion attaches source while retaining the conversation', async () => {
  const s = await fixture();
  s.messages = [{ role: 'user', content: 'Design it first' }];
  assert.deepEqual(await readdir(s.stage), []);
  await stageConversation(s);
  assert.equal(await readFile(path.join(s.stage, 'private-source.js'), 'utf8'), 'not-sent-by-chat');
  assert.equal(s.messages[0].content, 'Design it first');
  assert.equal(s.options.chatOnly, false);
  await stageConversation(s); // idempotent after success
});
test('saved provider preferences never retain secrets or arbitrary fields', async () => {
  await writeSettings({
    provider: 'openrouter',
    model: 'model:free',
    network: false,
    apiKey: 'do-not-save',
    prompt: 'private',
  });
  const text = await readFile(path.join(process.env.DIVYANSHARNESS_HOME, 'config.json'), 'utf8');
  assert.ok(!text.includes('do-not-save'));
  assert.ok(!text.includes('private'));
  assert.deepEqual(await readSettings(), {
    provider: 'openrouter',
    model: 'model:free',
    network: false,
  });
});
test('terminal input preserves pasted lines and typeahead through asynchronous turns', async () => {
  const stdin = new PassThrough(),
    stdout = new PassThrough();
  const input = new TerminalInput(stdin, stdout);
  const first = input.ask('> ');
  stdin.write('first\nsecond\nthird\n');
  assert.equal(await first, 'first');
  stdin.end();
  assert.equal(await input.ask('> '), 'second');
  assert.equal(await input.ask('> '), 'third');
  assert.equal(await input.ask('> '), null);
});
test('actual CLI handles first-run provider selection, two queued turns and context', async (t) => {
  let requests = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    assert.equal(data.tools, undefined);
    const remembered = data.messages.some(
      (m) => m.role === 'assistant' && m.content === 'Stored cobalt-7.',
    );
    requests++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: remembered ? 'Your marker is cobalt-7.' : 'Stored cobalt-7.',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const child = spawn(process.execPath, ['bin/divyansharness.js', 'chat'], {
    env: { ...process.env, DIVYANSHARNESS_HOME: path.join(root, 'cli-home') },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '',
    errors = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (errors += c));
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  child.stdin.end(
    `4\nhttp://127.0.0.1:${server.address().port}/v1\ntest\nRemember cobalt-7\nWhat marker did I give you?\n/status\n/exit\n`,
  );
  assert.equal(await exited, 0, errors);
  assert.equal(requests, 2);
  assert.match(output, /Your marker is cobalt-7/);
  assert.match(output, /Project: not attached/);
  const settings = JSON.parse(await readFile(path.join(root, 'cli-home', 'config.json'), 'utf8'));
  assert.equal(settings.provider, 'compatible');
  assert.equal(settings.model, 'test');
});
