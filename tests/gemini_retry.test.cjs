'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('./fixtures/gas_runtime.cjs');

function scenario(responses){
  const runtime=createRuntime(),calls=[],sleeps=[];
  runtime.ctx.saveApiKey('retry-test-fixture-only');
  runtime.ctx.Utilities.sleep=ms=>sleeps.push(ms);
  runtime.ctx.UrlFetchApp.fetch=(url,options)=>{
    calls.push({url,options});const item=responses[Math.min(calls.length-1,responses.length-1)];
    if(item.throw)throw new Error('private transport details');
    return {getResponseCode:()=>item.status,getAllHeaders:()=>item.headers||{},getContentText:()=>JSON.stringify(item.status===200?{candidates:[{content:{parts:[{text:'{"status":"madang_connection_ok"}'}]}}]}:{error:{message:'private upstream details'}})};
  };
  return {runtime,calls,sleeps,run:()=>runtime.ctx.checkGeminiConnection()};
}

test('503 responses retry at most twice, preserving the registered key/model and no journal writes',()=>{
  const e=scenario([{status:503},{status:503},{status:200}]);
  assert.equal(e.run().status,'CONNECTED');assert.equal(e.calls.length,3);assert.equal(e.sleeps.length,2);
  assert.ok(e.sleeps[0]>=1000&&e.sleeps[0]<1250);assert.ok(e.sleeps[1]>=2000&&e.sleeps[1]<2250);
  assert.ok(e.calls.every(call=>call.options.headers['x-goog-api-key']==='retry-test-fixture-only'));
  assert.ok(e.calls.every(call=>call.url===e.calls[0].url));
  assert.equal(Object.keys(e.runtime.sheets).length,0);assert.equal(e.runtime.getArchiveCount(),0);
});

test('persistent 503 stays failed and does not claim key validity or sleep after the final response',()=>{
  const e=scenario([{status:503}]),result=e.run();
  assert.equal(result.ok,false);assert.equal(result.status,'HTTP_503');assert.equal(e.calls.length,3);assert.equal(e.sleeps.length,2);
  assert.match(result.message,/자동 재시도 2회/);assert.match(result.message,/유효성은 이 오류만으로 판단할 수 없습니다/);
  assert.equal(JSON.stringify(result).includes('private upstream'),false);assert.equal(JSON.stringify(result).includes('retry-test-fixture-only'),false);
});

test('a non-503 or ambiguous network error stops immediately, including after a retry',()=>{
  for(const status of [400,401,403,404,429,500,502,504]){
    const first=scenario([{status}]);assert.equal(first.run().status,'HTTP_'+status);assert.equal(first.calls.length,1);assert.equal(first.sleeps.length,0);
    const second=scenario([{status:503},{status}]);assert.equal(second.run().status,'HTTP_'+status);assert.equal(second.calls.length,2);assert.equal(second.sleeps.length,1);
  }
  const network=scenario([{status:503},{throw:true}]);assert.equal(network.run().status,'NETWORK_ERROR');assert.equal(network.calls.length,2);assert.equal(network.sleeps.length,1);
});

test('Retry-After hints are case-insensitive, support arrays and never shorten server waits',()=>{
  for(const headers of [{'Retry-After':'10'},{'rEtRy-AfTeR':['10']}]){
    const e=scenario([{status:503,headers},{status:200}]);assert.equal(e.run().ok,true);assert.deepEqual(e.sleeps,[10000]);
  }
  for(const value of ['11','120','invalid','-1']){
    const e=scenario([{status:503,headers:{'Retry-After':value}},{status:200}]);assert.equal(e.run().status,'HTTP_503');assert.equal(e.calls.length,1);assert.deepEqual(e.sleeps,[]);
  }
});

test('HTTP-date retry hints use the server delay or stop if it exceeds the bounded wait',()=>{
  const near=scenario([{status:503,headers:{'Retry-After':'Thu, 22 Oct 2026 03:00:05 GMT'}},{status:200}]);
  assert.equal(near.run().ok,true);assert.ok(near.sleeps[0]>=5000&&near.sleeps[0]<5250);
  const far=scenario([{status:503,headers:{'Retry-After':'Thu, 22 Oct 2026 03:01:00 GMT'}},{status:200}]);
  assert.equal(far.run().ok,false);assert.equal(far.calls.length,1);assert.equal(far.sleeps.length,0);
});
