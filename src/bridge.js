import { createSession, save, event, lock } from './session.js';
import { DockerSandbox } from './sandbox.js';
import { listModels } from './providers.js';
import { verify } from './tools.js';
import { assert } from './util.js';

export const BRIDGE_IMAGE='dhaara-opencode:2.2.5';
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
    const result=await sandbox.run('mkdir -p "$HOME" && opencode run --standalone --auto --format json --model "$DHAARA_BRIDGE_MODEL" "$DHAARA_BRIDGE_PROMPT"',{signal,environment,timeout:options.durationMs??600000,onData:text=>onEvent({type:'bridge_output',text})});
    await event(session,'bridge_exit',{code:result.code,durationMs:result.durationMs});
    assert(result.code===0,`Official OpenCode CLI exited ${result.code}. ${result.stderr.slice(-1200)}\nSession ${session.id} is saved. Provider free-tier access is not guaranteed.`);
    // Some CLIs return 0 while reporting provider errors as JSON events.
    const lines=result.stdout.split('\n').map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
    assert(!lines.some(l=>l.type==='error'||l.error),`OpenCode reported an error. Inspect session ${session.id}; no completion accepted.`);
    assert(lines.length>0,'OpenCode returned no JSON events. No completion accepted.');
    session.summary='Official OpenCode run completed. Dhaara independently checked the staged workspace.';
    // Verification defaults back to offline isolation, even though inference needed network.
    const checker=new DockerSandbox(session.stage,{image:options.verifyImage??'node:22-alpine',network:false});await checker.prepare();
    await verify(session,checker,{signal,onEvent});await save(session);return session;
  }catch(e){session.status=signal?.aborted?'interrupted':'failed';session.error=e.message;await save(session);throw e;}finally{await release();}
}
