'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('./fixtures/gas_runtime.cjs');
function scenario(status,error){const e=createRuntime();e.ctx.saveApiKey('sensitive-fixture-not-real');e.ctx.setModel('gemini-2.5-flash');e.setFetch({status,body:{error}});return {e,report:e.ctx.checkGeminiConnection()};}

test('404 includes the actual model and upstream status/message without claiming model-list success implies generation',()=>{
 const {e,report:r}=scenario(404,{code:404,status:'NOT_FOUND',message:'models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent.'});
 assert.equal(r.status,'HTTP_404');assert.equal(r.model,'gemini-2.5-flash');assert.equal(r.keyVerified,false);assert.equal(r.googleError.status,'NOT_FOUND');assert.match(r.message,/Google 설명/);assert.match(r.googleError.message,/not found/);assert.equal(r.googleError.apiVersion,'v1beta');assert.equal(e.ctx.getLastDiagnostic().googleError.status,'NOT_FOUND');
});

test('400 preserves public error reason while omitting arbitrary details, raw metadata and the registered key',()=>{
 const {report:r}=scenario(400,{status:'INVALID_ARGUMENT',message:'API key sensitive-fixture-not-real is invalid. Contact owner@example.com at https://example.com/?key=sensitive-fixture-not-real',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'API_KEY_INVALID',metadata:{api_key:'sensitive-fixture-not-real',internalSecret:'do-not-return'}}],privateField:'do-not-return'});
 assert.equal(r.googleError.reason,'API_KEY_INVALID');assert.equal(r.googleError.status,'INVALID_ARGUMENT');const serialized=JSON.stringify(r);for(const secret of ['sensitive-fixture-not-real','owner@example.com','https://example.com','do-not-return'])assert.equal(serialized.includes(secret),false,secret);assert.equal(r.googleError.metadata,undefined);assert.equal(r.googleError.details,undefined);
});

test('503 exposes the Google explanation and keeps one attempt, no silent retry or key validation',()=>{
 const {e,report:r}=scenario(503,{status:'UNAVAILABLE',message:'This model is currently experiencing high demand. Please try again later.'});
 assert.equal(r.status,'HTTP_503');assert.equal(r.googleError.status,'UNAVAILABLE');assert.match(r.googleError.message,/high demand/);assert.match(r.message,/자동 재시도하지 않습니다/);assert.equal(r.keyVerified,false);assert.equal(e.getArchiveCount(),0);
});

test('non-JSON error pages and missing body readers do not leak arbitrary response bodies or hide the HTTP status',()=>{
 const e=createRuntime();e.ctx.saveApiKey('sensitive-fixture-not-real');e.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>404,getContentText:()=>'<html>sensitive-fixture-not-real</html>'});let r=e.ctx.checkGeminiConnection();assert.equal(r.status,'HTTP_404');assert.equal(JSON.stringify(r).includes('sensitive-fixture-not-real'),false);assert.equal(r.googleError.httpStatus,404);
 e.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>503});r=e.ctx.checkGeminiConnection();assert.equal(r.status,'HTTP_503');assert.equal(r.ok,false);
});
