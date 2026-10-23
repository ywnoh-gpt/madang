const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {createRuntime:environment}=require('./fixtures/gas_runtime.cjs');
function input(overrides={}){return {court:'서울중앙지방법원',caseNumber:'2026타경123',itemNumber:'1',auctionDate:'2026-11-10',forecastDate:'2026-10-01',predictedPrice:105000000,virtualBid:95000000,minimumPrice:90000000,marketPrice:150000000,extraCosts:10000000,targetProfit:20000000,...overrides};}
function save(e,overrides={},extra={}){return e.ctx.saveReviewedRecord({fields:input(overrides),reviewed:true,beforeResultConfirmed:true,...extra});}
const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64');
test('setup is repeatable, resolves bound book for web app and preserves unknown sheets',()=>{
  const e=environment();e.ctx.setupJournal();e.setActive(false);assert.equal(e.ctx.getAppState().configured,true);assert.equal(e.props.MADANG_SPREADSHEET_ID,'book-id');
  e.ctx.setupJournal();assert.equal(Object.keys(e.sheets).length,3);
  const other=environment();other.book.insertSheet('마당 기록').appendRow(['personal data']);assert.throws(()=>other.ctx.setupJournal(),/보존/);assert.equal(other.sheets['마당 기록'].rows[0][0],'personal data');assert.equal(Object.keys(other.sheets).length,1);
});
test('save, duplicate rejection, immutable forecasts, audited result update and five-percent metrics',()=>{
  const e=environment();e.ctx.setupJournal();let first=save(e);assert.equal(first.record.upperLimit,120000000);assert.equal(first.record.evaluable,false);
  assert.throws(()=>save(e),/이미 있습니다/);assert.equal(e.sheets['마당 기록'].rows.length,3);
  assert.throws(()=>e.ctx.updateResult(first.record.recordId,{predictedPrice:1}),/수정할 수 없습니다/);
  const updated=e.ctx.updateResult(first.record.recordId,{saleResult:'낙찰',actualPrice:100000000,bidderCount:7});assert.equal(updated.record.predictionError,.05);assert.equal(updated.state.metrics.evaluableCount,1);assert.equal(updated.state.metrics.withinFivePercentCount,1);
  assert.equal(e.sheets['마당 변경 이력'].rows.length,4);assert.match(e.sheets['마당 변경 이력'].rows[3][3],/105000000/);
  const second=save(e,{auctionDate:'2026-12-10',predictedPrice:95000000});e.ctx.updateResult(second.record.recordId,{saleResult:'낙찰',actualPrice:100000000});const state=e.ctx.getAppState();assert.equal(state.metrics.meanPredictionError,0);assert.equal(state.metrics.meanAbsoluteError,.05);
});
test('human review, pre-result attestation and date/numeric validation',()=>{
  const e=environment();e.ctx.setupJournal();assert.throws(()=>save(e,{}, {reviewed:false}),/확인 완료/);
  assert.throws(()=>save(e,{forecastDate:'2026-11-11'}),/이후/);assert.throws(()=>save(e,{auctionDate:'2026-02-30'}),/올바르지/);
  assert.throws(()=>save(e,{minimumPrice:'약 1억'}),/금액/);assert.throws(()=>save(e,{minimumPrice:'1.2'}),/금액/);
  assert.equal(e.ctx.amount_('1억 2300만원','가격'),123000000);assert.equal(e.ctx.amount_('1.1억','가격'),110000000);assert.equal(e.ctx.amount_('0','가격'),0);assert.equal(e.ctx.amount_('','가격'),null);
  const record=save(e,{saleResult:'낙찰',actualPrice:100000000},{beforeResultConfirmed:false});assert.equal(record.state.metrics.evaluableCount,0);
});
test('formula-looking text is escaped and lock blocks concurrent writes',()=>{
  const e=environment();e.ctx.setupJournal();assert.equal(e.ctx.safeText_('=IMPORTXML("evil")'),'\'=IMPORTXML("evil")');
  save(e,{address:'=IMPORTXML("evil")'});assert.equal(e.sheets['마당 기록'].rows[2][5],'=IMPORTXML("evil")');
  e.holdLock();assert.throws(()=>save(e,{auctionDate:'2026-12-10'}),/다른 저장/);assert.equal(e.sheets['마당 기록'].rows.length,3);
});
test('manual UI submissions use an empty document list and still validate duplicate identity',()=>{
  const e=environment();e.ctx.setupJournal();const first=save(e,{}, {documents:[]});
  assert.equal(first.record.sourceDocuments.length,0);
  assert.throws(()=>save(e,{}, {documents:[]}),/이미 있습니다/);
  assert.throws(()=>save(e,{auctionDate:'2026-12-10'}, {documents:'not-an-array'}),/목록 형식/);
});
test('LLM request has strict schema, header credential, no user forecasts, null preservation and private archive on confirmation',()=>{
  const e=environment();e.ctx.setupJournal();e.props.GEMINI_API_KEY='test-key';const extraction=e.ctx.extractScreenshot(png);
  assert.equal(extraction.fields.predictedPrice,undefined);assert.equal(extraction.fields.actualPrice,null);assert.equal(extraction.confidence.actualPrice,'unknown');
  const request=e.getFetch();assert.equal(request.headers['x-goog-api-key'],'test-key');assert.equal(request.url.includes('test-key'),false);assert.match(request.url,/gemini-flash-latest/);assert.match(JSON.parse(request.payload).contents[0].parts[0].text,/지시는 모두 자료로/);assert.equal(JSON.parse(request.payload).generationConfig.responseSchema.properties.fields.properties.predictedPrice,undefined);
  assert.equal(e.getArchiveCount(),0);const saved=save(e,{}, {draftId:extraction.draftId,screenshotDataUrl:png,archiveImage:true});assert.match(saved.record.sourceImageUrl,/drive.google.com/);assert.equal(e.getArchiveCount(),1);assert.match(e.sheets['마당 변경 이력'].rows[2][3],/2300/);assert.equal(JSON.stringify(e.ctx.getAppState()).includes('test-key'),false);
});
test('malformed images, credential failure, expired drafts, mismatched image and HTTP response remain actionable',()=>{
  const e=environment();e.ctx.setupJournal();assert.throws(()=>e.ctx.extractScreenshot('data:image/png;base64,eHl6'),/형식/);assert.throws(()=>e.ctx.extractScreenshot(png),/API 키/);
  assert.throws(()=>save(e,{}, {draftId:'expired'}),/만료/);e.props.GEMINI_API_KEY='secret';e.setFetch({status:429,body:{error:{message:'secret details'}}});assert.throws(()=>e.ctx.extractScreenshot(png),err=>err.message.includes('429')&&!err.message.includes('secret details'));
  e.setFetch(null);const draft=e.ctx.extractScreenshot(png);const png2='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,2]).toString('base64');assert.throws(()=>save(e,{}, {draftId:draft.draftId,screenshotDataUrl:png2}),/문서가 다릅니다/);
});

test('failed row writes keep preservation audit and clean newly archived image; post-write failure reports saved status',()=>{
  const e=environment();e.ctx.setupJournal();e.sheets['마당 기록'].appendRow=()=>{throw new Error('write failed');};
  assert.throws(()=>save(e,{}, {screenshotDataUrl:png,archiveImage:true}),/write failed/);assert.equal(e.getTrashCount(),1);assert.equal(e.sheets['마당 기록'].rows.length,2);assert.match(e.sheets['마당 변경 이력'].rows[2][2],/保存|보존/);
  const after=environment();after.ctx.setupJournal();const originalGet=after.sheets['마당 성과'].getRange.bind(after.sheets['마당 성과']);after.sheets['마당 성과'].getRange=(...args)=>{const range=originalGet(...args);if(args[0]===3)range.setValues=()=>{throw new Error('summary unavailable');};return range;};
  assert.throws(()=>save(after),/기록은 저장되었지만/);assert.equal(after.sheets['마당 기록'].rows.length,3);
});

test('future forecasts and result-visible screenshots cannot be claimed as prospective; refresh reflects direct edits',()=>{
  const e=environment();e.ctx.setupJournal();assert.throws(()=>save(e,{forecastDate:'2026-11-01'}),/미래/);assert.throws(()=>save(e,{saleResult:'낙찰',actualPrice:100000000}),/이미 낙찰/);
  e.props.GEMINI_API_KEY='test';e.setFetch({status:200,body:{candidates:[{content:{parts:[{text:JSON.stringify({fields:{saleResult:'낙찰',actualPrice:'1억원'}})}]}}]}});const draft=e.ctx.extractScreenshot(png);assert.throws(()=>save(e,{}, {draftId:draft.draftId}),/이미 낙찰/);
  const first=save(e);e.ctx.updateResult(first.record.recordId,{saleResult:'낙찰',actualPrice:100000000});e.sheets['마당 기록'].rows[2][12]='not-a-date';assert.equal(e.ctx.refreshJournal().metrics.evaluableCount,0);assert.equal(e.sheets['마당 성과'].rows[2][1],0);assert.equal(e.sheets['마당 기록'].rows[2][30],false);
  assert.equal(e.ctx.derived_({...input(),virtualBid:0},false).minimumComparison,'');
});

test('PDF and multi-source extraction validate signatures, archive all sources and roundtrip metadata',()=>{
  const e=environment();e.ctx.setupJournal();e.props.GEMINI_API_KEY='test';const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.7\nfixture').toString('base64');
  const documents=[{name:'법원 화면.png',mimeType:'image/png',dataUrl:png},{name:'매각물건명세서.pdf',mimeType:'application/pdf',documentType:'매각물건명세서',dataUrl:pdf}];
  const extracted=e.ctx.extractDocuments(documents);assert.equal(extracted.sources.length,2);assert.equal(JSON.parse(e.getFetch().payload).contents[0].parts.length,5);
  save(e,{}, {draftId:extracted.draftId,documents,archiveDocuments:true});assert.equal(e.getArchiveCount(),2);const sources=e.ctx.getAppState().records[0].sourceDocuments;assert.equal(sources.length,2);assert.equal(sources[1].name,'매각물건명세서.pdf');assert.match(sources[1].url,/drive.google.com/);
  assert.throws(()=>e.ctx.extractDocuments([...documents,...documents]),/1~3개/);assert.throws(()=>e.ctx.extractDocuments([{name:'bad.pdf',mimeType:'application/pdf',dataUrl:'data:application/pdf;base64,'+Buffer.from('notpdf').toString('base64')}]),/PDF/);
  assert.throws(()=>e.ctx.extractDocuments([{mimeType:'text/html',dataUrl:'data:text/html;base64,PGgxPg=='}]),/PNG/);
});

test('human correction of a hallucinated visible result requires explicit override and reason, retained in audit',()=>{
  const e=environment();e.ctx.setupJournal();e.props.GEMINI_API_KEY='test';e.setFetch({status:200,body:{candidates:[{content:{parts:[{text:JSON.stringify({fields:{saleResult:'낙찰',actualPrice:'1억원'}})}]}}]}});const draft=e.ctx.extractDocuments([{name:'화면.png',mimeType:'image/png',dataUrl:png}]);
  assert.throws(()=>save(e,{}, {draftId:draft.draftId}),/인식 결과에는 이미 낙찰/);
  assert.throws(()=>save(e,{}, {draftId:draft.draftId,resultVisibilityCorrected:true}),/수정 사유/);
  const saved=save(e,{}, {draftId:draft.draftId,resultVisibilityCorrected:true,correctionReason:'LLM이 최저가를 실제 낙찰가로 오독했습니다. 원본에는 낙찰 결과가 없습니다.'});assert.equal(saved.record.beforeResultConfirmed,true);assert.match(e.sheets['마당 변경 이력'].rows[2][4],/resultVisibilityCorrected/);assert.match(e.sheets['마당 변경 이력'].rows[2][3],/1억원/);
});

test('setup diagnostics distinguish OAuth, configured sheets and key presence without returning credentials',()=>{
  const e=environment();let status=e.ctx.getSetupStatus();assert.equal(status.configured,false);assert.equal(status.keyPresent,false);assert.match(status.oauthNote,/대신하지 않습니다/);
  assert.throws(()=>e.ctx.saveApiKey(''),/유효한/);assert.throws(()=>e.ctx.saveApiKey('two words'),/유효한/);assert.throws(()=>e.ctx.saveApiKey({key:'fixture'}),/텍스트/);
  const fixtureKey='opaque-test-fixture';status=e.ctx.saveApiKey(fixtureKey);assert.equal(status.keyPresent,true);assert.equal(JSON.stringify(status).includes(fixtureKey),false);
  e.ctx.setupJournal();e.ctx.ScriptApp={AuthMode:{FULL:'FULL'},getAuthorizationInfo:()=>({getAuthorizationStatus:()=> 'REQUIRED',getAuthorizationUrl:()=> 'https://accounts.google.com/o/oauth2/auth?fixture'})};
  status=e.ctx.getSetupStatus();assert.equal(status.configured,true);assert.equal(status.authorization.status,'REQUIRED');assert.match(status.authorization.url,/accounts.google.com/);
  assert.equal(JSON.stringify(status).includes(fixtureKey),false);
});

test('Gemini connection check verifies an actual marker and keeps failures redacted',()=>{
  const e=environment();let result=e.ctx.checkGeminiConnection();assert.equal(result.mode,'live');assert.equal(result.ok,false);assert.equal(result.status,'MISSING_KEY');assert.equal(e.getFetch(),undefined);
  e.ctx.saveApiKey('fixture-credential');e.setFetch({status:200,body:{candidates:[{content:{parts:[{text:'{"status":"madang_connection_ok"}'}]}}]}});
  result=e.ctx.checkGeminiConnection();assert.equal(result.ok,true);assert.equal(result.status,'CONNECTED');assert.equal(JSON.stringify(result).includes('fixture-credential'),false);
  assert.equal(e.getFetch().url.includes('fixture-credential'),false);assert.equal(e.getFetch().headers['x-goog-api-key'],'fixture-credential');
  assert.equal(e.getFetch().followRedirects,false);
  e.setFetch({status:429,body:{error:{message:'fixture-credential private error body'}}});result=e.ctx.checkGeminiConnection();assert.equal(result.ok,false);assert.equal(result.status,'HTTP_429');assert.match(result.message,/사용량 한도/);assert.equal(JSON.stringify(result).includes('private error body'),false);
  e.ctx.UrlFetchApp.fetch=()=>{throw new Error('fixture-credential raw proxy details');};result=e.ctx.checkGeminiConnection();assert.equal(result.status,'NETWORK_ERROR');assert.equal(JSON.stringify(result).includes('fixture-credential'),false);
});

test('sample PDF live extraction checks known facts without adding records or Drive files',()=>{
  const e=environment();e.ctx.setupJournal();e.ctx.saveApiKey('fixture-key');const expected={court:'Seoul Central District Court',caseNumber:'2030-TEST-42',itemNumber:'1',auctionDate:'2030-10-22',appraisal:'200000000',minimumPrice:'140000000'};
  e.setFetch({status:200,body:{candidates:[{content:{parts:[{text:JSON.stringify({fields:expected,confidence:{caseNumber:'high'},warnings:[]})}]}}]}});
  const result=e.ctx.runSampleCheck();assert.equal(result.mode,'live');assert.equal(result.ok,true);assert.equal(result.checks.length,5);assert.equal(e.ctx.getAppState().records.length,0);assert.equal(e.sheets['마당 변경 이력'].rows.length,2);assert.equal(e.getArchiveCount(),0);
  const parts=JSON.parse(e.getFetch().payload).contents[0].parts;const pdf=Buffer.from(parts[2].inlineData.data,'base64').toString('ascii');assert.match(pdf,/^%PDF-1\.4/);assert.match(pdf,/2030-TEST-42/);
  const xref=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.equal(pdf.slice(xref,xref+4),'xref');assert.match(pdf,/Minimum price: 140000000 KRW/);
  e.setFetch({status:200,body:{candidates:[{content:{parts:[{text:JSON.stringify({fields:{...expected,minimumPrice:'14000000'},warnings:[]})}]}}]}});assert.equal(e.ctx.runSampleCheck().ok,false);
});

test('offline self-check explicitly reports simulation without keys, networking, journal writes or false live success',()=>{
  const e=environment();const result=e.ctx.runLocalSelfCheck();assert.equal(result.mode,'simulated');assert.equal(result.ok,true);assert.equal(result.passed,result.total);assert.equal(result.total,7);assert.equal(e.getFetch(),undefined);assert.equal(Object.keys(e.sheets).length,0);assert.equal(Object.keys(e.props).length,0);assert.equal(e.getArchiveCount(),0);assert.match(result.message,/실제 API 연결 성공을 뜻하지 않습니다/);
});

function fullVerificationService(e,settings={}){
  e.props.GEMINI_API_KEY='registered-fixture-credential';const requests=[];
  e.ctx.UrlFetchApp.fetch=(url,options)=>{
    const payload=JSON.parse(options.payload);const isPdf=payload.contents[0].parts.some(part=>part.inlineData?.mimeType==='application/pdf');requests.push({isPdf,url,options});
    const data=isPdf?{fields:{court:'Seoul Central District Court',caseNumber:'2030-TEST-42',itemNumber:'1',auctionDate:'2030-10-22',appraisal:'200000000',minimumPrice:settings.badPdf?'14000000':'140000000'},warnings:[]}:{status:'madang_connection_ok'};
    return {getResponseCode:()=>isPdf?200:settings.connectionStatus||200,getContentText:()=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(data)}]}}]}),getAllHeaders:()=>({})};
  };return requests;
}
function preservedRows(e){return JSON.stringify(Object.fromEntries(Object.entries(e.sheets).filter(([name])=>!name.startsWith('_마당_연동점검_')).map(([name,sheet])=>[name,sheet.rows])));}

test('registered-key full check verifies saved key, PDF and typed sheet readback, deleting only its own temporary tab',()=>{
  const e=environment();e.ctx.setupJournal();save(e);const rowsBefore=preservedRows(e);const requests=fullVerificationService(e);const created=[];const insert=e.book.insertSheet.bind(e.book);e.book.insertSheet=name=>{created.push(name);return insert(name);};
  const result=e.ctx.verifyRegisteredKey();assert.equal(result.mode,'live');assert.equal(result.ok,true);assert.equal(result.status,'VERIFIED');assert.equal(result.keyVerified,true);assert.equal(result.keySource,'Apps Script 속성');assert.equal(result.checkedAt,'2026-10-22T03:00:00.000Z');assert.ok(result.checks.every(check=>check.passed));
  assert.equal(requests.length,2);assert.equal(requests[0].isPdf,false);assert.equal(requests[1].isPdf,true);assert.equal(requests[0].options.headers['x-goog-api-key'],'registered-fixture-credential');assert.equal(JSON.stringify(result).includes('registered-fixture-credential'),false);
  assert.equal(created.length,1);assert.match(created[0],/^_마당_연동점검_/);assert.equal(e.book.getSheetByName(created[0]),null);assert.equal(preservedRows(e),rowsBefore);assert.equal(e.ctx.getAppState().records.length,1);assert.equal(e.getArchiveCount(),0);
});

test('registered-key full check stops before API calls when setup or saved key is missing',()=>{
  const e=environment();let result=e.ctx.verifyRegisteredKey();assert.equal(result.ok,false);assert.equal(result.status,'SETUP_REQUIRED');assert.equal(result.keyVerified,false);assert.equal(e.getFetch(),undefined);
  e.ctx.setupJournal();result=e.ctx.verifyRegisteredKey();assert.equal(result.status,'MISSING_KEY');assert.equal(result.keyVerified,false);assert.equal(e.getFetch(),undefined);assert.equal(Object.keys(e.sheets).length,3);
});

test('registered-key 503 response remains unconfirmed and skips PDF, temporary writes and any fake success',()=>{
  const e=environment();e.ctx.setupJournal();const rowsBefore=preservedRows(e);const requests=fullVerificationService(e,{connectionStatus:503});
  const result=e.ctx.verifyRegisteredKey();assert.equal(result.ok,false);assert.equal(result.keyVerified,false);assert.equal(result.status,'HTTP_503');assert.ok(requests.length>=1);assert.ok(requests.every(request=>!request.isPdf));assert.equal(result.checks.some(check=>check.label==='합성 PDF 실제 인식'),false);assert.equal(Object.keys(e.sheets).length,3);assert.equal(preservedRows(e),rowsBefore);
});

test('registered-key PDF mismatch preserves successful key verification but skips all sheet writes',()=>{
  const e=environment();e.ctx.setupJournal();const rowsBefore=preservedRows(e);fullVerificationService(e,{badPdf:true});
  const result=e.ctx.verifyRegisteredKey();assert.equal(result.ok,false);assert.equal(result.keyVerified,true);assert.equal(result.status,'SAMPLE_CHECK_FAILED');assert.equal(result.checks.find(check=>check.label==='합성 PDF 실제 인식').passed,false);assert.equal(Object.keys(e.sheets).length,3);assert.equal(preservedRows(e),rowsBefore);
});

test('registered-key temporary write failure cleans its tab and never changes user records',()=>{
  const e=environment();e.ctx.setupJournal();save(e);const rowsBefore=preservedRows(e);fullVerificationService(e);const insert=e.book.insertSheet.bind(e.book);e.book.insertSheet=name=>{const sheet=insert(name);const range=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{const r=range(...args);r.setValues=()=>{throw new Error('registered-fixture-credential raw write failure');};return r;};return sheet;};
  const result=e.ctx.verifyRegisteredKey();assert.equal(result.ok,false);assert.equal(result.keyVerified,true);assert.equal(result.status,'SHEET_CHECK_FAILED');assert.equal(result.checks.find(check=>check.label==='생성한 임시 시트 정리').passed,true);assert.equal(Object.keys(e.sheets).length,3);assert.equal(preservedRows(e),rowsBefore);assert.equal(JSON.stringify(result).includes('registered-fixture-credential'),false);
});

test('registered-key temporary readback mismatch is a failed check and still cleans the new tab',()=>{
  const e=environment();e.ctx.setupJournal();fullVerificationService(e);const insert=e.book.insertSheet.bind(e.book);e.book.insertSheet=name=>{const sheet=insert(name);const range=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{const r=range(...args);const read=r.getValues.bind(r);r.getValues=()=>{const values=read();if(args[0]===1&&args[1]===1&&args[2]===2&&args[3]===6)values[1][4]=String(values[1][4]);return values;};return r;};return sheet;};
  const result=e.ctx.verifyRegisteredKey();assert.equal(result.ok,false);assert.equal(result.status,'SHEET_READBACK_MISMATCH');assert.equal(result.checks.find(check=>check.label==='임시 시트 쓰기·읽기 일치').passed,false);assert.equal(Object.keys(e.sheets).length,3);
});

test('registered-key cleanup failure reports the exact temporary tab and never calls the check a full success',()=>{
  const e=environment();e.ctx.setupJournal();save(e);const rowsBefore=preservedRows(e);fullVerificationService(e);e.book.deleteSheet=()=>{throw new Error('deletion denied');};
  const result=e.ctx.verifyRegisteredKey();assert.equal(result.ok,false);assert.equal(result.keyVerified,true);assert.equal(result.status,'CLEANUP_FAILED');assert.match(result.cleanupNeeded,/^_마당_연동점검_/);assert.ok(e.book.getSheetByName(result.cleanupNeeded));assert.equal(result.checks.find(check=>check.label==='생성한 임시 시트 정리').passed,false);assert.equal(preservedRows(e),rowsBefore);
});

test('registered-key cleanup is verified by reading sheet membership after deletion',()=>{
  const e=environment();e.ctx.setupJournal();fullVerificationService(e);e.book.deleteSheet=()=>{};
  const result=e.ctx.verifyRegisteredKey();assert.equal(result.ok,false);assert.equal(result.status,'CLEANUP_FAILED');assert.match(result.cleanupNeeded,/^_마당_연동점검_/);assert.ok(e.book.getSheetByName(result.cleanupNeeded));
});

test('registered-key temporary name collision preserves the pre-existing tab without attempting deletion',()=>{
  const e=environment();e.ctx.setupJournal();fullVerificationService(e);e.ctx.Utilities.getUuid=()=> 'collision';const existing=e.book.insertSheet('_마당_연동점검_collision');existing.appendRow(['user data']);const before=JSON.stringify(existing.rows);let deleted=false;e.book.deleteSheet=()=>{deleted=true;};
  const result=e.ctx.verifyRegisteredKey();assert.equal(result.ok,false);assert.equal(result.status,'TEMP_NAME_CONFLICT');assert.equal(deleted,false);assert.equal(JSON.stringify(existing.rows),before);
});
