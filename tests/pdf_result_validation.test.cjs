'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('./fixtures/gas_runtime.cjs');
const facts={court:'Seoul Central District Court',caseNumber:'2030-TEST-42',itemNumber:'1',auctionDate:'2030-10-22',appraisal:'200000000 KRW',minimumPrice:'KRW 140,000,000',saleResult:'UNKNOWN'};
function fixture(overrides={}){const e=createRuntime();e.ctx.setupJournal();e.ctx.saveApiKey('private-pdf-fixture-only');e.setFetch({status:200,body:{candidates:[{content:{parts:[{text:JSON.stringify({fields:{...facts,...overrides},confidence:{},warnings:[]})}]}}]}});return e;}

test('the exact currencies and UNKNOWN label printed in the synthetic PDF normalize and validate',()=>{
 const e=fixture(),r=e.ctx.runSampleCheck();assert.equal(r.ok,true);assert.equal(r.status,'SAMPLE_PASSED');assert.equal(r.apiResponseReceived,true);assert.equal(r.normalized.appraisal,200000000);assert.equal(r.normalized.minimumPrice,140000000);assert.equal(r.normalized.saleResult,'미확인');assert.equal(r.extracted.appraisal,'200000000 KRW');assert.equal(r.extracted.saleResult,'UNKNOWN');assert.equal(r.checks.length,5);assert.equal(e.ctx.getAppState().records.length,0);assert.equal(e.getArchiveCount(),0);
});

test('explicit won currency boundaries are accepted without guessing other currencies, ranges or free text',()=>{
 const e=createRuntime();for(const s of ['200,000,000 KRW','KRW 200000000','₩200,000,000','￦200000000','200000000₩','200000000원'])assert.equal(e.ctx.amount_(s,'가격'),200000000);
 for(const s of ['$200000000','USD 200000000','200000000 USD','약 2억','1억~2억','KRW 1.25','1.25 KRW','KRW USD 200000000'])assert.throws(()=>e.ctx.amount_(s,'가격'),/금액/);
 assert.equal(e.ctx.amount_('₩1.1억','가격'),110000000);assert.equal(e.ctx.amount_('KRW 0','가격'),0);assert.equal(e.ctx.amount_('','가격'),null);
});

test('invalid extracted values remain failed with their field error and original extraction preserved',()=>{
 for(const [fields,reason] of [[{area:'N/A'},'면적'],[{auctionDate:'2030.10.22'},'매각기일'],[{appraisal:'USD 200000000'},'appraisal'],[{saleResult:'UNSOLD'},'매각 결과']]){
  const e=fixture(fields),r=e.ctx.runSampleCheck();assert.equal(r.ok,false);assert.equal(r.status,'SAMPLE_VALUE_INVALID');assert.equal(r.failurePhase,'validate_fields');assert.equal(r.apiResponseReceived,true);assert.ok(r.extracted);assert.match(r.message,/PDF 인식 응답을 받았지만/);assert.ok(r.safeDetail.includes(reason));assert.equal(r.checks.length,0);assert.equal(e.ctx.getLastDiagnostic().failurePhase,'validate_fields');assert.equal(e.ctx.getAppState().records.length,0);
 }
});

test('cache errors identify post-response storage failure without hiding the extracted facts or claiming success',()=>{
 const e=fixture();e.ctx.CacheService.getUserCache=()=>({put(){throw new Error('cache quota private-pdf-fixture-only');}});const r=e.ctx.runSampleCheck();assert.equal(r.ok,false);assert.equal(r.status,'DRAFT_CACHE_FAILED');assert.equal(r.failurePhase,'draft_cache');assert.equal(r.apiResponseReceived,true);assert.equal(r.extracted.minimumPrice,'KRW 140,000,000');assert.match(r.safeDetail,/cache quota/);assert.equal(JSON.stringify(r).includes('private-pdf-fixture-only'),false);assert.equal(e.ctx.getAppState().records.length,0);
});

test('field coercion failures preserve bounded extracted context',()=>{
 const e=fixture({address:'x'.repeat(1001)}),r=e.ctx.runSampleCheck();assert.equal(r.ok,false);assert.equal(r.status,'EXTRACTED_FIELD_INVALID');assert.equal(r.failurePhase,'field_processing');assert.equal(r.apiResponseReceived,true);assert.equal(r.extracted.caseNumber,'2030-TEST-42');
});

test('preparation and HTTP errors identify different phases and preserve structured Google errors',()=>{
 const e=fixture();e.ctx.Utilities.base64Encode=()=>{throw new Error('fixture encoding failed');};let r=e.ctx.runSampleCheck();assert.equal(r.failurePhase,'sample_pdf');assert.equal(r.status,'SAMPLE_PROCESSING_FAILED');assert.equal(r.apiResponseReceived,false);assert.equal(r.extracted,null);
 const failed=fixture();failed.setFetch({status:503,body:{error:{status:'UNAVAILABLE',message:'High demand'}}});r=failed.ctx.runSampleCheck();assert.equal(r.status,'HTTP_503');assert.equal(r.failurePhase,'extract_documents');assert.equal(r.apiResponseReceived,false);assert.equal(r.googleError.status,'UNAVAILABLE');
});

test('normalization accepts UNKNOWN only as unconfirmed, never as awarded, and preserves won values through saving',()=>{
 const e=fixture();const d=e.ctx.extractDocuments([e.ctx.samplePdfDocument_()]);const r=e.ctx.saveReviewedRecord({fields:{...d.fields,forecastDate:'2026-10-01'},draftId:d.draftId,reviewed:true,beforeResultConfirmed:true});assert.equal(r.record.saleResult,'미확인');assert.equal(r.record.appraisal,200000000);assert.equal(r.record.actualPrice,null);assert.equal(r.record.evaluable,false);assert.match(e.sheets['마당 변경 이력'].rows[2][3],/200000000 KRW/);
});
