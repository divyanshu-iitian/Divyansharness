import { createSession, save, event, lock } from './session.js';
import { DockerSandbox } from './sandbox.js';
import { listModels } from './providers.js';
import { verify } from './tools.js';
import { assert } from './util.js';

export const BRIDGE_IMAGE='dhaara-opencode:2.2.5';
// Inspect every event, including those evicted from the bounded output tail.
export function bridgeEvents() {
  let buffer='',count=0,error=false,overflow=false,stopped=false;
  const seen=new Set(),usage={input:0,output:0,cost:0};
  const line=text=>{try{
    const data=JSON.parse(text);count++;if(data.type==='error'||data.error)error=true;
    if(data.type==='step_finish'&&data.part){
      if(data.part.reason==='stop')stopped=true;
      if(data.part.id&&!seen.has(data.part.id)){
        seen.add(data.part.id);
        for(const key of ['input','output'])if(Number.isFinite(data.part.tokens?.[key]))usage[key]+=data.part.tokens[key];
        if(Number.isFinite(data.part.cost))usage.cost+=data.part.cost;
      }
    }
  }catch{}};
  return {
    push(text){buffer+=text;if(buffer.length>2*1024*1024){overflow=true;buffer='';return;}let end;while((end=buffer.indexOf('\n'))!==-1){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}},
    finish(){if(buffer.trim()){line(buffer);buffer='';}return {count,error,overflow,stopped,usage};}
  };
}
export async function bridge(workspace,prompt,options,{signal,onEvent=()=>{}}={}) {
  assert(options.network,'OpenCode bridge needs provider network access. Pass --network explicitly. The whole bridge container then has outbound access.');
  const models=await listModels('opencode',{signal});
  const model=options.model??models.find(m=>m.id==='big-pickle')?.id??models[0]?.id;
  assert(models.some(m=>m.id===model),'Select a currently free OpenCode model with dhaara models --provider opencode.');
  const session=await createSession(workspace,{...options,provider:'opencode-bridge'});const release=await lock(session);
  const sandbox=new DockerSandbox(session.stage,{image:options.image??BRIDGE_IMAGE,network:true,memory:1024,timeout:options.durationMs??600000});
  session.task=prompt;session.model=`opencode/${model}`;
  try {
    await sandbox.prepare();session.status='running';await save(session);
    const environment={DHAARA_BRIDGE_MODEL:`opencode/${model}`,DHAARA_BRIDGE_PROMPT:prompt};
    if(process.env.OPENCODE_API_KEY)environment.OPENCODE_API_KEY=process.env.OPENCODE_API_KEY;
    await event(session,'bridge_start',{model:session.model,image:sandbox.resolvedImage});
    const events=bridgeEvents();
    const result=await sandbox.run('mkdir -p "$HOME" && opencode run --standalone --auto --format json --model "$DHAARA_BRIDGE_MODEL" "$DHAARA_BRIDGE_PROMPT"',{signal,environment,timeout:options.durationMs??600000,onData:(text,stderr)=>{if(!stderr)events.push(text);onEvent({type:'bridge_output',text});}});
    const observed=events.finish();
    session.usage=observed.usage;
    await event(session,'bridge_exit',{code:result.code,durationMs:result.durationMs,events:observed,stdoutTail:result.stdout,stderrTail:result.stderr});
    assert(result.code===0,`Official OpenCode CLI exited ${result.code}. ${result.stderr.slice(-1200)}\nSession ${session.id} is saved. Provider free-tier access is not guaranteed.`);
    // Some CLIs return 0 while reporting provider errors as JSON events.
    assert(!observed.error&&!observed.overflow,`OpenCode reported an error or oversized event. Inspect session ${session.id}; no completion accepted.`);
    assert(observed.count>0,'OpenCode returned no JSON events. No completion accepted.');
    assert(observed.stopped,'OpenCode returned no final stop event. Inspect the saved session before retrying.');
    session.summary='Official OpenCode run completed. Dhaara independently checked the staged workspace.';
    // Verification defaults back to offline isolation, even though inference needed network.
    const checker=new DockerSandbox(session.stage,{image:options.verifyImage??'node:22-alpine',network:false});await checker.prepare();
    await verify(session,checker,{signal,onEvent});await save(session);return session;
  }catch(e){session.status=signal?.aborted?'interrupted':'failed';session.error=e.message;await save(session);throw e;}finally{await release();}
}
