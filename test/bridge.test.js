import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeEvents } from '../src/bridge.js';

test('bridge retains early errors across fragmented events and long output',()=>{
  const events=bridgeEvents();events.push('{"type":"err');events.push('or","error":{"message":"denied"}}\n');
  for(let i=0;i<2000;i++)events.push(JSON.stringify({type:'text',text:'x'.repeat(100)})+'\n');
  events.push('{"type":"done"}');const result=events.finish();assert.equal(result.count,2002);assert.equal(result.error,true);assert.equal(result.overflow,false);
});
test('bridge requires a final stop and counts each reported step once',()=>{
  const events=bridgeEvents();const step=JSON.stringify({type:'step_finish',part:{id:'step1',reason:'stop',cost:0,tokens:{input:200,output:40}}})+'\n';
  events.push(step+step);const result=events.finish();assert.equal(result.stopped,true);assert.deepEqual(result.usage,{input:200,output:40,cost:0});
});
test('bridge rejects oversized incomplete events',()=>{
  const events=bridgeEvents();events.push('x'.repeat(2*1024*1024+1));assert.equal(events.finish().overflow,true);
});
