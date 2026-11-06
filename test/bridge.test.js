import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeEvents } from '../src/bridge.js';

test('bridge retains early errors across fragmented events and long output',()=>{
  const events=bridgeEvents();events.push('{"type":"err');events.push('or","error":{"message":"denied"}}\n');
  for(let i=0;i<2000;i++)events.push(JSON.stringify({type:'text',text:'x'.repeat(100)})+'\n');
  events.push('{"type":"done"}');assert.deepEqual(events.finish(),{count:2002,error:true,overflow:false});
});
test('bridge rejects oversized incomplete events',()=>{
  const events=bridgeEvents();events.push('x'.repeat(2*1024*1024+1));assert.equal(events.finish().overflow,true);
});
