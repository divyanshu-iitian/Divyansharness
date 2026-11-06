import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSession, loadSession, lock } from '../src/session.js';
import { runAgent, contextMessages } from '../src/agent.js';
import { executeTool, parseTool } from '../src/tools.js';
import { DockerSandbox } from '../src/sandbox.js';
import { safeText } from '../src/util.js';

const base=await mkdtemp(path.join(os.tmpdir(),'dhaara-agent-test-'));process.env.DHAARA_HOME=path.join(base,'home');
test.after(()=>rm(base,{recursive:true,force:true}));
async function fixture(){const cwd=await mkdtemp(path.join(base,'project-'));await writeFile(path.join(cwd,'a.js'),'original');return createSession(cwd,{verify:['test-command']});}
const sandbox={prepare:async()=>{},run:async()=>({code:0,stdout:'ok',stderr:'',durationMs:1})};
test('finish is gated by independent failing verification',async()=>{
  const s=await fixture();const provider={model:'fake',complete:async()=>({message:{role:'assistant',content:'done'},finish:'stop',usage:{}})};
  await runAgent(s,provider,{...sandbox,run:async()=>({code:1,stdout:'failed',stderr:'',durationMs:1})},{prompt:'task',maxTurns:1});
  assert.equal(s.status,'budget-exhausted');assert.equal(s.checks[0].code,1);assert.ok(!s.verifiedHash);
});
test('successful checks create a persisted verification receipt',async()=>{
  const s=await fixture();const provider={model:'fake',complete:async()=>({message:{role:'assistant',content:'done'},finish:'stop',usage:{prompt_tokens:20,completion_tokens:5}})};
  await runAgent(s,provider,sandbox,{prompt:'task'});const loaded=await loadSession(s.id);assert.equal(loaded.status,'verified');assert.equal(loaded.usage.input,20);assert.equal(loaded.verifiedHash.length,64);
});
test('unchanged failed completions stop instead of wasting the whole run budget',async()=>{
  const s=await fixture();let calls=0;
  const provider={model:'weak',complete:async()=>{calls++;return {message:{role:'assistant',content:'Here is a proposed patch'},finish:'stop'};}};
  await runAgent(s,provider,{...sandbox,run:async()=>({code:1,stdout:'still broken',stderr:'',durationMs:1})},{prompt:'fix',maxTurns:12});
  assert.equal(calls,3);assert.equal(s.status,'stalled');assert.equal(s.verifiedHash,null);
  assert.match(s.messages.filter(m=>m.role==='tool')[0].content,/call edit_file/);
});
test('applied session cannot acquire a fresh verification receipt',async()=>{
  const s=await fixture();s.status='applied';
  await assert.rejects(executeTool('finish',{summary:'done'},{session:s,sandbox}),/cannot be reverified/);
});
test('plan mode cannot edit and commands get a read-only mount',async()=>{
  const s=await fixture();s.options.plan=true;await assert.rejects(executeTool('edit_file',{path:'new',content:'x'},{session:s,sandbox}),/Plan mode/);
  let readOnly=false;await executeTool('run_command',{command:'true'},{session:s,sandbox:{run:async(cmd,opts)=>{readOnly=opts.readOnly;return {code:0,stdout:'',stderr:''};}}});assert.equal(readOnly,true);
});
test('session lock rejects simultaneous writers',async()=>{const s=await fixture();const release=await lock(s);await assert.rejects(lock(s),/already in use/);await release();const release2=await lock(s);await release2();});
test('interrupted tool actions receive recovery markers, not automatic replay',async()=>{
  const s=await fixture();s.task='task';s.messages=[{role:'assistant',content:'',tool_calls:[{id:'old',type:'function',function:{name:'run_command',arguments:'{"command":"danger"}'}}]}];
  let observed;const provider={model:'fake',complete:async messages=>{observed=messages;return {message:{role:'assistant',content:'done'},finish:'stop'};}};
  await runAgent(s,provider,sandbox,{});assert.match(observed.find(m=>m.tool_call_id==='old').content,/interrupted/);
});
test('context compaction preserves call/result pairs',()=>{
  const s={task:'task',notes:['critical fact'],messages:[]};for(let i=0;i<20;i++)s.messages.push({role:'assistant',content:'x'.repeat(1000),tool_calls:[{id:String(i)}]},{role:'tool',tool_call_id:String(i),content:'y'.repeat(1000)});
  const m=contextMessages(s,'system',5000);for(const a of m.filter(x=>x.tool_calls))for(const call of a.tool_calls)assert.ok(m.some(x=>x.tool_call_id===call.id));assert.match(m[0].content,/critical fact/);assert.ok(m.length<41);
});
test('strict schema rejects unknown fields and invalid types',()=>{
  assert.throws(()=>parseTool({function:{name:'run_command',arguments:'{"command":"ls","host":true}'}}),/Unknown/);
  assert.throws(()=>parseTool({function:{name:'read_file',arguments:'{"path":"x","start":"1"}'}}),/integer/);
  assert.throws(()=>parseTool({function:{name:'read_file',arguments:'{"path":"x","start":0}'}}),/at least 1/);
});
test('Docker arguments use only the stage mount and explicit restrictions',()=>{
  const s=new DockerSandbox('/tmp/stage');const args=s.args('test','echo ok');assert.ok(args.includes('none'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('ALL'));assert.ok(args.includes('no-new-privileges'));assert.equal(args.filter(a=>a==='--mount').length,1);assert.ok(!args.some(a=>a.includes('docker.sock')));
});
test('terminal output strips ANSI and OSC controls',()=>{assert.equal(safeText('\x1b[31mred\x1b[0m\x1b]52;c;secret\x07'),'red');});
