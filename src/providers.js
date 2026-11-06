import { assert, endpoint, truncate } from './util.js';

const OPENROUTER='https://openrouter.ai/api/v1';
const OPENCODE_MODELS='https://opencode.ai/inference/v1/models';
export async function fetchJSON(url, { signal, ...init }={}) {
  const timeout=AbortSignal.timeout(20000);
  const res=await fetch(url,{...init,signal:signal?AbortSignal.any([signal,timeout]):timeout,redirect:'error'});
  if(!res.ok)throw new Error(`Catalog HTTP ${res.status}: ${truncate(await res.text(),300)}`);
  return res.json();
}
export async function listModels(provider='openrouter', options={}) {
  if(provider==='opencode') {
    const data=await fetchJSON(OPENCODE_MODELS,options);
    return data.data.filter(m=>m.capabilities?.tools?.supported && m.cost?.text?.input?.price===0 && m.cost?.text?.output?.price===0).map(m=>({id:m.id,name:m.name,free:true,bridge:true,context:m.limit?.context}));
  }
  if(provider==='openrouter') {
    const data=await fetchJSON(`${OPENROUTER}/models`,options);
    return data.data.filter(m=>m.id.endsWith(':free') && m.pricing?.prompt!==undefined && m.pricing?.completion!==undefined && Number(m.pricing.prompt)===0 && Number(m.pricing.completion)===0 && m.supported_parameters?.includes('tools')).map(m=>({id:m.id,name:m.name,free:true,context:m.context_length}));
  }
  const base=endpoint(options.baseURL||'http://localhost:11434/v1');
  const data=await fetchJSON(`${base}/models`,options);
  return data.data.map(m=>({id:m.id,name:m.id,free:provider==='ollama',context:32000}));
}
export async function resolveProvider(options={}) {
  const kind=options.provider||'ollama';
  if(kind==='opencode')throw new Error('OpenCode free models require the official CLI. Use: dhaara bridge "your task". Native free cloud mode: --provider openrouter.');
  assert(['ollama','openrouter','compatible'].includes(kind),'Provider must be ollama, openrouter, or compatible.');
  let baseURL=options.baseURL||(kind==='openrouter'?OPENROUTER:'http://localhost:11434/v1');
  baseURL=endpoint(baseURL);
  const apiKey=kind==='openrouter'?process.env.OPENROUTER_API_KEY:kind==='compatible'?process.env.DHAARA_API_KEY:undefined;
  if(kind==='openrouter')assert(apiKey,'Set OPENROUTER_API_KEY to your own OpenRouter key. Free models have provider rate limits.');
  if(kind==='compatible')assert(options.model&&options.baseURL,'Compatible mode requires --base-url and --model. Pricing is unknown; use your provider limits.');
  if(kind==='openrouter')assert(baseURL===OPENROUTER,'OpenRouter credentials are sent only to the official OpenRouter endpoint.');
  let model=options.model, context=32000;
  if(kind!=='compatible') {
    const models=await listModels(kind,{baseURL,signal:options.signal});
    assert(models.length>0,kind==='ollama'?'No local models found. Pull a tool-capable model with Ollama first.':'No free tool-capable OpenRouter models available right now. Try later or use Ollama.');
    const chosen=model?models.find(m=>m.id===model):models[0];
    assert(chosen,`Model ${model} is not in the ${kind==='openrouter'?'current free tool-capable':'local'} catalog. Run dhaara models --provider ${kind}.`);
    model=chosen.id; context=chosen.context??32000;
    if(kind==='ollama')assert(!/(:|-)(cloud)(:|$)/i.test(model),'Use a local Ollama model for local/free mode. Cloud models require explicitly configured compatible mode.');
  }
  return new ChatProvider({kind,baseURL,apiKey,model,context});
}

/** Small, provider-neutral SSE adapter; handles arbitrary chunk/UTF-8 boundaries. */
export async function* sse(body) {
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',data=[],size=0;
  try {
    while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
      assert(buffer.length<4*1024*1024,'Provider SSE frame exceeds 4 MiB.');
      let at;
      while((at=buffer.indexOf('\n'))!==-1){let line=buffer.slice(0,at).replace(/\r$/,'');buffer=buffer.slice(at+1);
        if(!line){if(data.length){yield data.join('\n');data=[];size=0;}}
        else if(line.startsWith('data:')){size+=line.length;assert(size<4*1024*1024,'Provider SSE event exceeds 4 MiB.');data.push(line.slice(5).replace(/^ /,''));}
      }
      if(done){if(buffer.startsWith('data:'))data.push(buffer.slice(5).trimStart());if(data.length)yield data.join('\n');break;}
    }
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
export class ChatProvider {
  constructor(config) {Object.assign(this,config);}
  async complete(messages,tools,{signal,onToken,maxTokens=4096}={}) {
    const request={model:this.model,messages,tools,stream:true,stream_options:{include_usage:true},max_tokens:maxTokens};
    if(this.kind==='openrouter')request.provider={max_price:{prompt:0,completion:0},require_parameters:true};
    const headers={'content-type':'application/json'};
    if(this.apiKey)headers.authorization=`Bearer ${this.apiKey}`;
    if(this.kind==='openrouter'){headers['HTTP-Referer']='https://github.com/divyanshu-iitian/Divyansharness';headers['X-Title']='Dhaara';}
    let response;
    for(let attempt=0;attempt<3;attempt++) {
      const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
      response=await fetch(`${this.baseURL}/chat/completions`,{method:'POST',headers,body:JSON.stringify(request),signal:combined,redirect:'error'});
      if(response.ok)break;
      const detail=truncate(await response.text(),800);
      if(![429,500,502,503,504].includes(response.status)||attempt===2)throw new Error(`Provider HTTP ${response.status}: ${detail}${response.status===429?'\nRate limit reached. No paid fallback was attempted.':''}`);
      const wait=Math.min(10000,Math.max(1000,Number(response.headers.get('retry-after')||0)*1000,1000*2**attempt));
      await new Promise((resolve,reject)=>{const t=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},wait);const cancel=()=>{clearTimeout(t);reject(signal.reason);};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});
    }
    const message={role:'assistant',content:''};const calls=new Map();let usage={},finish;
    if(response.headers.get('content-type')?.includes('application/json')){
      const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
      try{while(true){const {done,value}=await reader.read();text+=decoder.decode(value,{stream:!done});assert(text.length<2*1024*1024,'Provider response exceeds 2 MiB.');if(done)break;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const data=JSON.parse(text);assert(!data.error,data.error?.message??'Provider error');
      assert(data.choices?.[0]?.message,'Provider returned no assistant message.');
      assert(['stop','tool_calls','function_call'].includes(data.choices[0].finish_reason),'Incomplete provider response. No tool calls executed; increase the output budget or use a more capable model.');
      return {message:data.choices[0].message,usage:data.usage??{},finish:data.choices[0].finish_reason};
    }
    let received=false;
    for await (const frame of sse(response.body)) {
      if(frame==='[DONE]')break; const data=JSON.parse(frame);assert(!data.error,data.error?.message??'Provider stream failed');
      if(data.usage)usage=data.usage;
      const choice=data.choices?.[0];if(!choice)continue;received=true;
      if(choice.finish_reason)finish=choice.finish_reason;
      const delta=choice.delta??{};
      if(delta.content){message.content+=delta.content;onToken?.(delta.content);}
      if(delta.reasoning_content)message.reasoning_content=(message.reasoning_content??'')+delta.reasoning_content;
      for(const part of delta.tool_calls??[]){const i=part.index??0;const call=calls.get(i)??{id:'',type:'function',function:{name:'',arguments:''}};
        if(part.id)call.id=part.id;if(part.function?.name)call.function.name+=part.function.name;if(part.function?.arguments)call.function.arguments+=part.function.arguments;calls.set(i,call);
      }
      assert(message.content.length+(message.reasoning_content?.length??0)+[...calls.values()].reduce((n,c)=>n+c.function.arguments.length,0)<2*1024*1024,'Provider response exceeds 2 MiB.');
    }
    assert(received && finish,'Incomplete provider stream. Retry/resume; no partial tool calls were executed.');
    assert(['stop','tool_calls','function_call'].includes(finish),'Incomplete provider response. No tool calls executed; increase the output budget or use a more capable model.');
    if(calls.size){message.tool_calls=[...calls.values()];assert(message.tool_calls.every(c=>c.id&&c.function.name),'Incomplete tool call.');}
    return {message,usage,finish};
  }
}
