import os from 'node:os';
import path from 'node:path';
import { mkdtemp, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSession } from './session.js';
import { DockerSandbox } from './sandbox.js';
import { runAgent } from './agent.js';

/** Deterministic protocol fixture, explicitly NOT an LLM benchmark. Docker and tests are real. */
export class DemoProvider {
  model='scripted-demo';context=32000;step=0;
  async complete(messages) {
    let name,args;
    if(this.step===0){name='read_file';args={path:'duration.js'};}
    else if(this.step===1){const read=JSON.parse(messages.findLast(m=>m.role==='tool').content);name='edit_file';args={path:'duration.js',hash:read.hash,edits:[{start:3,end:3,content:'  return seconds * 1000;'}]};}
    else {name='finish';args={summary:'Fixed seconds-to-milliseconds conversion. The configured tests ran in the real Docker sandbox. This was a scripted demo, not a model evaluation.'};}
    this.step++;
    return {message:{role:'assistant',content:'',tool_calls:[{id:`demo_${this.step}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]},usage:{prompt_tokens:0,completion_tokens:0},finish:'tool_calls'};
  }
}
export async function demo({onEvent,signal}={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dhaara-demo-'));
  const example=fileURLToPath(new URL('../examples/tiny-bug/',import.meta.url));await cp(example,root,{recursive:true});
  const session=await createSession(root,{verify:['node --test']});
  await runAgent(session,new DemoProvider(),new DockerSandbox(session.stage),{prompt:'Fix the duration conversion bug without changing the tests.',onEvent,signal});
  return session;
}
