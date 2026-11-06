import { safeText, truncate, VERSION } from './util.js';
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
export function banner() {
  console.log(
    `\n  ${c('1;36', '╭─ Divyansharness')} ${c('2', `v${VERSION}`)}\n  ${c('2', '╰─ Talk. Plan. Build. Verify.')}\n`,
  );
}
export function renderer(json = false, { chat = false } = {}) {
  let streaming = false,
    emitted = '';
  return (e) => {
    if (json) {
      process.stdout.write(JSON.stringify(e) + '\n');
      return;
    }
    if (e.type === 'token') {
      process.stdout.write(safeText(e.text));
      emitted += e.text;
      streaming = true;
      return;
    }
    if (streaming) {
      process.stdout.write('\n');
      streaming = false;
    }
    if (e.type === 'turn' && !chat) console.log(c('2', `  [${e.turn}] ${e.model}`));
    if (e.type === 'tool')
      console.log(
        `  ${c('36', '›')} ${c('1', e.name)} ${safeText(truncate(e.args.path ?? e.args.command ?? e.args.query ?? '', 150))}`,
      );
    if (e.type === 'tool_result' && e.result.error)
      console.log(c('33', `    ${safeText(e.result.error)}`));
    if (e.type === 'tool_result' && e.result.code !== undefined)
      console.log(
        c(
          e.result.code === 0 ? '2' : '33',
          `    exit ${e.result.code} · ${e.result.durationMs}ms\n${safeText(truncate(e.result.stdout + e.result.stderr, 1600))}`,
        ),
      );
    if (e.type === 'verify') console.log(`  ${c('36', '◆')} verify ${safeText(e.command)}`);
    if (e.type === 'done' && chat) {
      if (e.summary && !emitted.includes(e.summary)) console.log('\n' + safeText(e.summary));
      emitted = '';
    }
    if (e.type === 'done' && !chat)
      console.log(
        `\n  ${c(e.status === 'verified' ? '32' : '33', e.status)} · ${e.session}\n\n${safeText(e.summary ?? '')}\n`,
      );
    if (e.type === 'bridge_output') process.stdout.write(safeText(e.text));
  };
}
export function chatFooter(session, mode) {
  console.log(`\n\n  ${c('2', `${mode} · ${session.status} · ${session.id}`)}`);
  if (mode === 'build')
    console.log(c('2', '  /diff to review · /verify to check · /apply when verified'));
  console.log();
}
export function receipt(session, json = false) {
  const data = {
    session: session.id,
    status: session.status,
    model: session.model,
    workspace: session.original,
    staged: session.stage,
    checks: session.checks?.map((c) => ({ command: c.command, code: c.code })),
    usage: session.usage,
  };
  if (json) {
    console.log(JSON.stringify({ type: 'receipt', ...data }));
    return;
  }
  const next =
    session.status === 'verified'
      ? `Apply   divyansharness apply ${session.id}`
      : `Verify  divyansharness verify ${session.id} --verify "your test command"`;
  console.log(
    `  Original files unchanged.\n  Review  divyansharness diff ${session.id}\n  ${next}\n  Resume  divyansharness resume ${session.id} "continue"\n`,
  );
}
