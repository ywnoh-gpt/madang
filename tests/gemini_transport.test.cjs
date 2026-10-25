'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('./fixtures/gas_runtime.cjs');

function failing(message,metadataStatus=200){
  const runtime=createRuntime(),calls=[];
  runtime.ctx.setupJournal();runtime.ctx.saveApiKey('transport-fixture-not-real');
  runtime.ctx.UrlFetchApp.fetch=(url,options)=>{
    calls.push({url,options});
    if(options.method==='get')return {getResponseCode:()=>metadataStatus,getContentText:()=>JSON.stringify({models:[{name:'models/test'}]})};
    throw new Error(message);
  };
  return {runtime,calls};
}

test('Apps Script permission and URL Fetch quotas have actionable distinct errors without repeated requests',()=>{
  for(const [message,status] of [
    ['You do not have permission to call UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request','EXTERNAL_REQUEST_PERMISSION'],
    ['Service invoked too many times for one day: urlfetch.','URLFETCH_QUOTA'],
    ['UrlFetchApp.fetch를 호출할 권한이 없습니다.','EXTERNAL_REQUEST_PERMISSION']
  ]){
    const e=failing(message),result=e.runtime.ctx.checkGeminiConnection();
    assert.equal(result.status,status);assert.equal(result.ok,false);assert.equal(e.calls.length,1);assert.equal(result.metadataProbe,undefined);
  }
});

test('timeout can be separated from a working read-only API route without claiming key generation access',()=>{
  const e=failing('Timeout: https://generativelanguage.googleapis.com/v1beta/models/test:generateContent');
  const result=e.runtime.ctx.checkGeminiConnection();
  assert.equal(result.status,'FETCH_TIMEOUT');assert.equal(result.keyVerified,false);assert.equal(result.ok,false);
  const metadata=e.runtime.ctx.verifyRegisteredKey();assert.equal(metadata.status,'MODEL_LIST_ACCESSIBLE');assert.equal(metadata.ok,true);assert.equal(metadata.keyVerified,false);
  assert.deepEqual(e.calls.map(call=>call.options.method),['post','get']);
  assert.equal(e.calls[1].options.payload,undefined);assert.equal(e.calls[1].options.headers['x-goog-api-key'],'transport-fixture-not-real');assert.equal(e.calls[1].options.followRedirects,false);
  assert.equal(Object.keys(e.runtime.sheets).length,3);assert.equal(e.runtime.ctx.getAppState().records.length,0);
});

test('DNS, TLS, address and invalid request exceptions are distinguished',()=>{
  for(const [message,status] of [['DNS error: private.example','FETCH_DNS'],['SSL certificate error','FETCH_TLS'],['Address unavailable','FETCH_UNAVAILABLE'],['Invalid argument: headers','FETCH_INVALID_REQUEST']]){
    const e=failing(message),result=e.runtime.ctx.checkGeminiConnection();assert.equal(result.status,status);assert.equal(result.ok,false);
  }
});

test('unknown exception diagnostics redact keys, encoded keys, URLs, emails and long identifiers before truncation',()=>{
  const e=failing('opaque failure transport-fixture-not-real https://example.com/path?key=transport-fixture-not-real owner@example.com abcdefghijklmnopqrstuvwxyz0123456789');
  const result=e.runtime.ctx.checkGeminiConnection(),serialized=JSON.stringify(result);
  assert.equal(result.status,'NETWORK_ERROR');assert.ok(result.safeDetail);
  for(const secret of ['transport-fixture-not-real','owner@example.com','example.com/path','abcdefghijklmnopqrstuvwxyz0123456789'])assert.equal(serialized.includes(secret),false,secret);
  const special='fixture-key+/=?';const error=e.runtime.ctx.fetchFailure_(new Error(special+' '+encodeURIComponent(special)),special);assert.equal(error.safeDetail.includes(special),false);assert.equal(error.safeDetail.includes(encodeURIComponent(special)),false);
});

test('metadata failure or malformed response remains separate from the generation exception',()=>{
  const e=failing('Request timed out',403);let result=e.runtime.ctx.checkGeminiConnection();
  assert.equal(result.status,'FETCH_TIMEOUT');const metadata=e.runtime.ctx.verifyRegisteredKey();assert.equal(metadata.status,'HTTP_403');assert.equal(metadata.ok,false);
  e.runtime.ctx.UrlFetchApp.fetch=()=>{throw new Error('DNS error for private location');};result=e.runtime.ctx.checkGeminiConnection();assert.equal(result.status,'FETCH_DNS');assert.equal(e.runtime.ctx.verifyRegisteredKey().status,'FETCH_DNS');
  const malformed=failing('Timeout');malformed.runtime.ctx.UrlFetchApp.fetch=(url,options)=>{if(options.method==='post')throw new Error('Timeout');return {getResponseCode:()=>200,getContentText:()=>'<html>not JSON</html>'};};
  assert.equal(malformed.runtime.ctx.verifyRegisteredKey().status,'INVALID_RESPONSE');
});
