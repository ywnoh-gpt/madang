'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('./fixtures/gas_runtime.cjs');
function rows(e){return JSON.stringify(Object.fromEntries(Object.entries(e.sheets).map(([n,s])=>[n,s.rows])));}
function metadata(e,status=200){let calls=[];e.ctx.saveApiKey('private-fixture-key');e.ctx.UrlFetchApp.fetch=(url,options)=>{calls.push({url,options});return {getResponseCode:()=>status,getContentText:()=>JSON.stringify({models:[{name:'models/gemini-fixture',displayName:'Fixture Flash',supportedGenerationMethods:['generateContent']},{name:'models/embedding-fixture',supportedGenerationMethods:['embedContent']}],nextPageToken:'next'})};};return calls;}
function sheetRuntime(){const e=createRuntime();e.ctx.setupJournal();e.ctx.UrlFetchApp.fetch=()=>{throw new Error('Sheet check must never request Gemini');};return e;}

test('first diagnostic reads available models in one GET and never calls generation or writes sheets',()=>{
 const e=createRuntime(),calls=metadata(e);const r=e.ctx.verifyRegisteredKey();assert.equal(r.ok,true);assert.equal(r.scope,'model_metadata');assert.equal(r.keyVerified,false);assert.equal(r.keyAcceptedForModelList,true);assert.equal(r.models.length,1);assert.equal(r.models[0].id,'gemini-fixture');assert.equal(r.hasMoreModels,true);assert.equal(calls.length,1);assert.equal(calls[0].options.method,'get');assert.equal(calls[0].options.payload,undefined);assert.equal(Object.keys(e.sheets).length,0);assert.equal(e.ctx.getLastDiagnostic().lastDiagnostic.state,'COMPLETED');assert.equal(JSON.stringify(r).includes('private-fixture-key'),false);
});

test('missing key and metadata 503 do not trigger generation or retry',()=>{
 const missing=createRuntime();assert.equal(missing.ctx.verifyRegisteredKey().status,'MISSING_KEY');assert.equal(missing.getFetch(),undefined);
 const e=createRuntime(),calls=metadata(e,503);const r=e.ctx.verifyRegisteredKey();assert.equal(r.ok,false);assert.equal(r.status,'HTTP_503');assert.equal(r.keyVerified,false);assert.equal(calls.length,1);assert.equal(e.ctx.getLastDiagnostic().lastDiagnostic.state,'COMPLETED');
});

test('progress is persisted before a generation call and an interrupted snapshot never means success',()=>{
 const e=createRuntime();e.ctx.saveApiKey('private-fixture-key');let snapshot;
 e.ctx.UrlFetchApp.fetch=()=>{snapshot=e.ctx.getLastDiagnostic();assert.equal(snapshot.status,'NO_COMPLETION');assert.equal(snapshot.scope,'api_generation');return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{content:{parts:[{text:'{"status":"madang_connection_ok"}'}]}}]})};};
 const r=e.ctx.checkGeminiConnection();assert.equal(r.ok,true);assert.equal(r.keyVerified,true);assert.equal(e.ctx.getLastDiagnostic().lastDiagnostic.state,'COMPLETED');
 e.ctx.PropertiesService.getUserProperties().setProperty('MADANG_LAST_DIAGNOSTIC',JSON.stringify(snapshot.lastDiagnostic));const interrupted=e.ctx.getLastDiagnostic();assert.equal(interrupted.ok,false);assert.equal(interrupted.status,'NO_COMPLETION');assert.equal(interrupted.keyVerified,false);assert.match(interrupted.message,/종료 기록이 없습니다/);assert.equal(JSON.stringify(interrupted).includes('private-fixture-key'),false);
});

test('sheet roundtrip is independent of API/key, preserves records and deletes only its new tab',()=>{
 const e=sheetRuntime(),before=rows(e);const r=e.ctx.verifySheetReadWrite();assert.equal(r.ok,true);assert.equal(r.scope,'sheet_roundtrip');assert.equal(r.keyVerified,false);assert.equal(rows(e),before);assert.equal(e.getArchiveCount(),0);assert.equal(e.getFetch(),undefined);assert.match(r.message,/Gemini 인식은 별도/);
});

test('sheet write failure and readback mismatch remain failures and clean the temporary tab',()=>{
 for(const mode of ['write','read']){
  const e=sheetRuntime(),before=rows(e),insert=e.book.insertSheet.bind(e.book);e.book.insertSheet=n=>{const s=insert(n),get=s.getRange.bind(s);s.getRange=(...args)=>{const r=get(...args);if(args[1]===1&&args[2]===2){if(mode==='write')r.setValues=()=>{throw new Error('failed');};else r.getValues=()=>[['wrong']];}return r;};return s;};
  const r=e.ctx.verifySheetReadWrite();assert.equal(r.ok,false);assert.equal(r.status,mode==='write'?'SHEET_CHECK_FAILED':'SHEET_READBACK_MISMATCH');assert.equal(rows(e),before);
 }
});

test('cleanup throw/no-op cannot pass and existing name collisions are never deleted',()=>{
 for(const noop of [true,false]){const e=sheetRuntime();e.book.deleteSheet=()=>{if(!noop)throw new Error('failed');};const r=e.ctx.verifySheetReadWrite();assert.equal(r.ok,false);assert.equal(r.status,'CLEANUP_FAILED');assert.ok(e.book.getSheetByName(r.cleanupNeeded));}
 const e=sheetRuntime();const name='_마당_연동점검_fixed';e.book.insertSheet(name).appendRow(['keep']);e.ctx.Utilities.getUuid=()=> 'fixed';let deletes=0;e.book.deleteSheet=()=>{deletes++;};assert.equal(e.ctx.verifySheetReadWrite().status,'TEMP_NAME_CONFLICT');assert.equal(deletes,0);
});

test('model selection only stores a valid ID and never makes a generation request',()=>{
 const e=createRuntime();assert.equal(e.ctx.setModel('gemini-fixture').model,'gemini-fixture');assert.equal(e.props.GEMINI_MODEL,'gemini-fixture');assert.equal(e.getFetch(),undefined);assert.throws(()=>e.ctx.setModel('https://example.com/model'),/모델 ID/);
});
