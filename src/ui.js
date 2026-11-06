import { safeText, truncate, VERSION } from './util.js';
const color=process.stdout.isTTY&&!process.env.NO_COLOR;
const c=(code,text)=>color?`\x1b[${code}m${text}\x1b[0m`:text;
export function banner() {
  console.log(`\n  ${c('1;36','dhaara')} ${c('2',`v${VERSION}`)}\n  ${c('2','Think freely. Change deliberately.')}\n`);
}
export function renderer(json=false) {
  let streaming=false;
  return e=>{
    if(json){process.stdout.write(JSON.stringify(e)+'\n');return;}
    if(e.type==='token'){process.stdout.write(safeText(e.text));streaming=true;return;}
    if(streaming){process.stdout.write('\n');streaming=false;}
    if(e.type==='turn')console.log(c('2',`  [${e.turn}] ${e.model}`));
    if(e.type==='tool')console.log(`  ${c('36','›')} ${c('1',e.name)} ${safeText(truncate(e.args.path??e.args.command??e.args.query??'',150))}`);
    if(e.type==='tool_result'&&e.result.error)console.log(c('33',`    ${safeText(e.result.error)}`));
    if(e.type==='tool_result'&&e.result.code!==undefined)console.log(c(e.result.code===0?'2':'33',`    exit ${e.result.code} · ${e.result.durationMs}ms\n${safeText(truncate(e.result.stdout+e.result.stderr,1600))}`));
    if(e.type==='verify')console.log(`  ${c('36','◆')} verify ${safeText(e.command)}`);
    if(e.type==='done')console.log(`\n  ${c(e.status==='verified'?'32':'33',e.status)} · ${e.session}\n\n${safeText(e.summary??'')}\n`);
    if(e.type==='bridge_output')process.stdout.write(safeText(e.text));
  };
}
export function receipt(session,json=false) {
  const data={session:session.id,status:session.status,model:session.model,workspace:session.original,staged:session.stage,checks:session.checks?.map(c=>({command:c.command,code:c.code})),usage:session.usage};
  if(json){console.log(JSON.stringify({type:'receipt',...data}));return;}
  const next=session.status==='verified'?`Apply   dhaara apply ${session.id}`:`Verify  dhaara verify ${session.id} --verify "your test command"`;
  console.log(`  Original files unchanged.\n  Review  dhaara diff ${session.id}\n  ${next}\n  Resume  dhaara resume ${session.id} "continue"\n`);
}
