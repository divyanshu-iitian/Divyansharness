import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { sse, ChatProvider, resolveProvider } from '../src/providers.js';
import { endpoint } from '../src/util.js';

test('SSE parser survives split UTF-8, CRLF, multiple data lines and no trailing newline',async()=>{
  const bytes=new TextEncoder().encode('data: héllo\r\n\r\ndata: one\ndata: two\n\ndata: [DONE]');let i=0;
  const body=new ReadableStream({pull(c){if(i===bytes.length)c.close();else c.enqueue(bytes.slice(i,i+=1));}});
  const frames=[];for await(const frame of sse(body))frames.push(frame);assert.deepEqual(frames,['héllo','one\ntwo','[DONE]']);
});
async function server(t,handler){const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.closeAllConnections();s.close(r);}));return `http://127.0.0.1:${s.address().port}/v1`;}
test('provider assembles fragmented tool calls and preserves reasoning',async t=>{
  const baseURL=await server(t,(req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});for(const part of [
    {choices:[{delta:{reasoning_content:'internal',tool_calls:[{index:0,id:'call1',function:{name:'read_',arguments:'{"pa'}}]}}]},
    {choices:[{delta:{tool_calls:[{index:0,function:{name:'file',arguments:'th":"a.js"}'}}]},finish_reason:'tool_calls'}]},
    {choices:[],usage:{prompt_tokens:12,completion_tokens:4}}
  ])res.write('data: '+JSON.stringify(part)+'\n\n');res.end('data: [DONE]\n\n');});
  const p=new ChatProvider({baseURL,model:'test'});const r=await p.complete([{role:'user',content:'x'}],[]);
  assert.equal(r.message.tool_calls[0].function.name,'read_file');assert.deepEqual(JSON.parse(r.message.tool_calls[0].function.arguments),{path:'a.js'});assert.equal(r.message.reasoning_content,'internal');assert.equal(r.usage.prompt_tokens,12);
});
test('truncated streams cannot execute partial tools',async t=>{
  const baseURL=await server(t,(req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'x',function:{name:'run_command',arguments:'{}'}}]}}]})+'\n\n');});
  await assert.rejects(new ChatProvider({baseURL,model:'test'}).complete([],[]),/Incomplete provider stream/);
});
test('HTTP auth errors are actionable and not retried',async t=>{
  let calls=0;const baseURL=await server(t,(req,res)=>{calls++;res.writeHead(401);res.end('no key');});await assert.rejects(new ChatProvider({baseURL,model:'test'}).complete([],[]),/401/);assert.equal(calls,1);
});
test('provider never follows redirects with credentials',async t=>{
  let target=false;const baseURL=await server(t,(req,res)=>{if(req.url==='/stolen')target=true;res.writeHead(302,{location:'/stolen'});res.end();});await assert.rejects(new ChatProvider({baseURL,model:'test',apiKey:'test-secret'}).complete([],[]));assert.equal(target,false);
});
test('native OpenCode free API is not impersonated',async()=>{await assert.rejects(resolveProvider({provider:'opencode'}),/official CLI/);});
test('endpoint validation forbids credentials and insecure remote URLs',()=>{
  for(const bad of ['http://remote.test/v1','https://key:secret@example.test','https://example.test?key=secret','https://example.test/#key'])assert.throws(()=>endpoint(bad));
  assert.equal(endpoint('http://localhost:11434/v1/'),'http://localhost:11434/v1');
});
