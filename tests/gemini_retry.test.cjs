'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('./fixtures/gas_runtime.cjs');

test('503 returns after one generation request without waiting or another API probe',()=>{
 const e=createRuntime();e.ctx.saveApiKey('fixture');let calls=0;
 e.ctx.Utilities.sleep=()=>{throw new Error('must not wait');};
 e.ctx.UrlFetchApp.fetch=(url,options)=>{calls++;assert.equal(options.method,'post');return {getResponseCode:()=>503,getContentText:()=>'{"private":"must not be returned"}'};};
 const r=e.ctx.checkGeminiConnection();assert.equal(r.status,'HTTP_503');assert.equal(r.ok,false);assert.equal(r.keyVerified,false);assert.equal(calls,1);assert.match(r.message,/자동 재시도하지 않습니다/);assert.equal(JSON.stringify(r).includes('must not be returned'),false);
});

test('all HTTP and transport failures make a single outbound request per diagnostic',()=>{
 for(const status of [400,401,403,404,429,500,502,503,504]){
  const e=createRuntime();e.ctx.saveApiKey('fixture');let calls=0;e.ctx.UrlFetchApp.fetch=()=>{calls++;return {getResponseCode:()=>status};};
  assert.equal(e.ctx.checkGeminiConnection().status,'HTTP_'+status);assert.equal(calls,1);
 }
 const e=createRuntime();e.ctx.saveApiKey('fixture');let calls=0;e.ctx.UrlFetchApp.fetch=()=>{calls++;throw new Error('Timeout');};assert.equal(e.ctx.checkGeminiConnection().status,'FETCH_TIMEOUT');assert.equal(calls,1);
});

test('successful generation is bounded in output without an invented UrlFetch timeout option',()=>{
 const e=createRuntime();e.ctx.saveApiKey('fixture');e.setFetch({status:200,body:{candidates:[{content:{parts:[{text:'{"status":"madang_connection_ok"}'}]}}]}});
 assert.equal(e.ctx.checkGeminiConnection().status,'CONNECTED');const request=e.getFetch();assert.equal(JSON.parse(request.payload).generationConfig.maxOutputTokens,8192);assert.equal(request.timeout,undefined);assert.equal(request.timeoutSeconds,undefined);assert.equal(request.validateHttpsCertificates,undefined);
});
