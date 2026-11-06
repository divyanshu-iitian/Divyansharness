import { exec, uid, assert } from './util.js';

export const DEFAULT_IMAGE = 'node:22-alpine';
export class DockerSandbox {
  constructor(workspace, { image=DEFAULT_IMAGE, network=false, memory=512, cpus=1, timeout=60000 }={}) {
    this.workspace=workspace; this.image=image; this.network=network; this.memory=memory; this.cpus=cpus; this.timeout=timeout;
  }
  async prepare() {
    const info=await exec('docker',['info','--format','{{.OSType}}'],{timeout:15000});
    assert(info.code===0 && info.stdout.trim()==='linux','Docker Linux engine is unavailable. Start Docker Desktop (Linux containers) or Docker Engine, then run dhaara doctor. No host-shell fallback is used.');
    const image=await exec('docker',['image','inspect',this.image,'--format','{{.Id}}'],{timeout:15000});
    assert(image.code===0,`Sandbox image ${this.image} is missing. Run: docker pull ${this.image}`);
    this.resolvedImage=image.stdout.trim();
    assert(/^sha256:[a-f0-9]{64}$/.test(this.resolvedImage),'Unexpected Docker image ID.');
    return this.resolvedImage;
  }
  args(name, command, { readOnly=false, environment={} }={}) {
    assert(!this.workspace.includes(','),'Docker workspace paths cannot contain commas. Set DHAARA_HOME to a path without commas.');
    const user=typeof process.getuid==='function' ? process.getuid() : 1000;
    const args=['run','--rm','--pull','never','--name',name,'--label','dev.dhaara.managed=true',
      '--network',this.network?'bridge':'none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
      '--pids-limit','128','--memory',`${this.memory}m`,'--memory-swap',`${this.memory}m`,'--cpus',String(this.cpus),
      '--user',`${user}:${user}`,'--tmpfs','/tmp:rw,nosuid,size=128m,mode=1777','--workdir','/workspace',
      '--mount',`type=bind,source=${this.workspace},target=/workspace${readOnly?',readonly':''}`,
      '--env','HOME=/tmp/home','--env','CI=1','--env','NO_COLOR=1'];
    // Only explicit names; secret values are inherited through Docker's environment lookup,
    // never command arguments, transcripts, or the workspace snapshot.
    for(const key of Object.keys(environment)) { assert(/^[A-Z_][A-Z0-9_]*$/.test(key),'Invalid environment key.');args.push('--env',key); }
    args.push(this.resolvedImage??this.image,'sh','-lc',command); return args;
  }
  async run(command, { signal, timeout=this.timeout, readOnly=false, environment={}, onData }={}) {
    assert(typeof command==='string' && command.length>0 && command.length<=16000,'Command must be 1–16000 characters.');
    if(!this.resolvedImage)await this.prepare();
    const name=`dhaara-${uid()}`; const start=Date.now();
    try {
      const result=await exec('docker',this.args(name,command,{readOnly,environment}),{signal,timeout,env:{...process.env,...environment},onData});
      return {...result,durationMs:Date.now()-start};
    } finally {
      // Killing the docker client does NOT kill its container. Explicitly reap on every path.
      await exec('docker',['rm','-f',name],{timeout:10000}).catch(()=>{});
    }
  }
}
export async function doctor() {
  const result={node:process.version,platform:process.platform,docker:false,image:false};
  try { const r=await exec('docker',['info','--format','{{.OSType}}'],{timeout:15000});result.docker=r.code===0&&r.stdout.trim()==='linux'; if(!result.docker)result.detail=r.stderr.trim(); }
  catch(e){result.detail=e.message;}
  if(result.docker){const r=await exec('docker',['image','inspect',DEFAULT_IMAGE,'--format','{{.Id}}']);result.image=r.code===0;}
  return result;
}
