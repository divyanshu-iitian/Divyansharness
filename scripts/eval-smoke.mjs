// One transparent bug-fix smoke task, not a comparative benchmark.
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolveProvider } from '../src/providers.js';
import { createSession } from '../src/session.js';
import { runAgent } from '../src/agent.js';
import { DockerSandbox } from '../src/sandbox.js';
import { bridge } from '../src/bridge.js';
import { sha, integer, uid } from '../src/util.js';
import { changes } from '../src/workspace.js';

const {values:v}=parseArgs({options:{provider:{type:'string',default:'ollama'},model:{type:'string'},bridge:{type:'boolean'},network:{type:'boolean'},timeout:{type:'string',default:'240'},'max-turns':{type:'string',default:'12'},'base-url':{type:'string'}}});
const fixture=fileURLToPath(new URL('../examples/tiny-bug/',import.meta.url));
const prompt='Fix the secondsToMilliseconds bug in duration.js. Read the implementation and tests, edit the implementation, then finish. Keep the tests unchanged.';
const options={provider:v.provider,model:v.model,baseURL:v['base-url'],verify:['node --test'],requireVerification:true,maxTurns:integer(v['max-turns'],'max-turns',1,200),durationMs:integer(v.timeout,'timeout',1,7200)*1000,network:v.network};
const onEvent=e=>{if(e.type==='turn')console.log(`turn ${e.turn}`);if(e.type==='tool')console.log(`tool ${e.name}`);if(e.type==='verify')console.log(`verify ${e.command}`);};
const original=sha(await readFile(new URL('../examples/tiny-bug/duration.js',import.meta.url)));
const testHash=sha(await readFile(new URL('../examples/tiny-bug/duration.test.js',import.meta.url)));
const started=Date.now();let session;
const report={task:'tiny-duration-bug-v1',kind:'live-smoke-not-benchmark',date:new Date().toISOString(),provider:v.bridge?'opencode-bridge':v.provider,model:v.model,passed:false};
try{
  if(v.bridge)session=await bridge(fixture,prompt,options,{onEvent});
  else{
    const provider=await resolveProvider(options);session=await createSession(fixture,options);
    await runAgent(session,provider,new DockerSandbox(session.stage),{...options,prompt,onEvent});
  }
  report.session=session.id;report.model=session.model;report.status=session.status;report.usage=session.usage;
  report.testsUnchanged=testHash===sha(await readFile(`${session.stage}/duration.test.js`));
  report.originalUnchanged=original===sha(await readFile(`${fixture}/duration.js`));
  report.changes=(await changes(session)).map(c=>({path:c.path,type:c.type}));
  // Controller-owned probes are not sent to the model. They run in fresh offline isolation.
  const probe=`node --input-type=module -e 'import assert from "node:assert/strict";import {secondsToMilliseconds as f} from "./duration.js";for(const n of [0,0.001,1.25,17,9999])assert.equal(f(n),n*1000);for(const n of [-1,NaN,Infinity])assert.throws(()=>f(n),RangeError);console.log("held-out probes passed")'`;
  const result=await new DockerSandbox(session.stage).run(probe);
  report.heldOutPassed=result.code===0;
  report.passed=report.status==='verified'&&report.testsUnchanged&&report.originalUnchanged&&report.heldOutPassed&&report.changes.length===1&&report.changes[0].path==='duration.js';
}catch(e){report.error=e.message;report.session=session?.id;}
report.durationMs=Date.now()-started;
await mkdir('artifacts',{recursive:true});const output=`artifacts/eval-${uid()}.json`;
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));console.log(`Report: ${output}`);
if(!report.passed)process.exitCode=1;
