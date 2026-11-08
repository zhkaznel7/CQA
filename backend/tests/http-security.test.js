import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('real HTTP rate limit returns 429 and security headers without exposing internals',async()=>{
 const appUrl=new URL('../src/app.js',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {createApp} from ${JSON.stringify(appUrl)};const server=createApp().listen(0,'127.0.0.1',()=>console.log('PORT='+server.address().port));`],{
  env:{...process.env,DATABASE_URL:'postgresql://synthetic@127.0.0.1:1/cqa_test',RATE_LIMIT_MAX:'2',RATE_LIMIT_WINDOW_MS:'60000',NODE_ENV:'test',AI_MODE:'mock'},stdio:['ignore','pipe','pipe']});
 try{
  const port=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(new Error('Test server did not start')),10000);child.once('error',()=>{clearTimeout(timer);reject(new Error('Test process failed'));});child.stdout.on('data',data=>{buffer+=data;const match=/PORT=(\d+)/.exec(buffer);if(match){clearTimeout(timer);resolve(match[1]);}});child.stderr.resume();});
  for(const expected of [200,200,429]){const response=await fetch('http://127.0.0.1:'+port+'/api/health');assert.equal(response.status,expected);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.has('x-powered-by'),false);if(expected===429){assert.equal((await response.json()).error.code,'RATE_LIMIT_EXCEEDED');assert.ok(response.headers.has('ratelimit'));}}
 }finally{if(child.pid&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
});
