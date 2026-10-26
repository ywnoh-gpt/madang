'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../web/core.js');
const base={court:'서울중앙지방법원',caseNumber:'2026타경123',itemNumber:'1',auctionDate:'2026-10-01',forecastDate:'2026-09-20',predictedPrice:105000000,virtualBid:100000000,marketPrice:150000000,extraCosts:10000000,targetProfit:20000000,minimumPrice:90000000,beforeResultConfirmed:true,saleResult:'낙찰',actualPrice:100000000};
test('single HTML artifact embeds the current source without external UI dependencies',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  for(const file of ['core.js','storage.js','gemini.js','app.js']) assert(html.includes(fs.readFileSync(require.resolve('../web/'+file),'utf8').replace(/<\/script/gi,'<\\/script')));
  assert(!html.includes('<script src='));assert(!html.includes('href="styles.css"'));
  assert(html.includes('connect-src https://generativelanguage.googleapis.com'));
});
test('standalone journal distinguishes accuracy, ties and profitability',()=>{
  const r=C.derive(C.normalize(base));
  assert.equal(r.upperLimit,120000000);assert.equal(r.predictionError,.05);assert.equal(r.absoluteError,.05);
  assert.equal(r.actualComparison,'실제 낙찰가 동액');assert.match(r.bidOutcome,/불확정/);
  assert.equal(C.metrics([C.normalize(base)]).withinFivePercentRatio,1);
  assert.equal(C.derive(C.normalize({...base,virtualBid:80000000})).bidOutcome,'최저가 미달');
  assert.equal(C.derive(C.normalize({...base,extraCosts:90000000,targetProfit:90000000})).upperLimit,-30000000);
});
test('duplicate, post-result, future and missing predictions do not inflate accuracy',()=>{
  assert.equal(C.metrics([C.normalize(base),C.normalize({...base,court:'서울 중앙 지방 법원'})]).evaluableCount,0);
  for(const patch of [{beforeResultConfirmed:false},{predictedPrice:0},{forecastDate:'2099-01-01'},{forecastDate:''},{saleResult:'유찰',actualPrice:null}]) assert.equal(C.metrics([C.normalize({...base,...patch})]).evaluableCount,0);
  assert.equal(C.metrics([]).meanAbsoluteError,null);
});
test('forecasts cannot claim prior-result status after seeing source results without an audited correction',()=>{
  const r=C.normalize({...base,saleResult:'미확인',actualPrice:null});
  assert.throws(()=>C.checkPrediction(C.normalize(base)),/낙찰 결과/);
  const source={fields:{saleResult:'낙찰',actualPrice:'1억원'}};
  assert.throws(()=>C.checkPrediction(r,source),/오독/);
  assert.throws(()=>C.checkPrediction(r,source,'',true),/오독/);
  assert.doesNotThrow(()=>C.checkPrediction(r,source,'최저가를 낙찰가로 오독',true));
});
test('strict Korean won parsing and field validation reject malformed data',()=>{
  for(const [value,expected] of [['1억 2300만원',123000000],['KRW 140,000,000',140000000],['₩ 90000000',90000000],['0.00000001억',1]]) assert.equal(C.amount(value),expected);
  for(const value of ['USD 100','1~2억','1.1원','1.00001만','-1','Infinity']) assert.throws(()=>C.amount(value));
  assert.throws(()=>C.normalize({...base,auctionDate:'2026-02-30'}),/날짜/);
  assert.throws(()=>C.normalize({...base,bidderCount:'2.2'}),/정수/);
  assert.throws(()=>C.url('javascript:alert(1)'),/링크/);
});
test('existing Google Sheets two-row header CSV migrates with booleans and quoted newlines',()=>{
  const csv='madang-journal-v1,,,,,,,,\r\n법원,사건번호,물건번호,매각기일,예상 작성일,예상 낙찰가,매각 결과,실제 낙찰가,결과 확인 전 예측,판단 근거·특징\r\n서울중앙지방법원,2026타경123,1,2026-10-01,2026-09-20,105000000,낙찰,100000000,TRUE,"첫 줄\n두 번째, 줄"';
  const [r]=C.recordsFromCsv(csv);
  assert.equal(r.beforeResultConfirmed,true);assert.equal(r.predictedPrice,105000000);assert.equal(r.rationale,'첫 줄\n두 번째, 줄');
  assert.equal(C.metrics([r]).withinFivePercentCount,1);
  assert.throws(()=>C.recordsFromCsv('hello,world'),/CSV/);
});
test('CSV export escapes formula cells and round-trips values',()=>{
  const data=C.csvExport([C.normalize({...base,rationale:'=HYPERLINK("https://example.com")'})]);
  assert.match(data,/'=HYPERLINK/);
  const [r]=C.recordsFromCsv(data);assert.equal(r.predictedPrice,105000000);assert.equal(r.beforeResultConfirmed,true);
});
test('browser AI transport uses header keys, one call, model guard, safe errors and JSON-only extraction',async()=>{
  const calls=[];
  const sandbox={MadangCore:C,AbortController,setTimeout,clearTimeout,console,fetch:async(url,options)=>{calls.push({url,options});return {ok:false,status:503,json:async()=>({error:{message:'busy secret-test-key https://example.com/private'}})};}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('../web/gemini.js'),'utf8'),sandbox);
  await assert.rejects(sandbox.MadangAI.check('secret-test-key','gemini-flash-lite-latest'),error=>error.message.includes('503')&&!error.message.includes('secret-test-key')&&!error.message.includes('https://example.com'));
  assert.equal(calls.length,1);assert.equal(calls[0].options.headers['x-goog-api-key'],'secret-test-key');assert(!calls[0].url.includes('secret'));
  await assert.rejects(sandbox.MadangAI.check('secret-test-key','gemini-2.5-flash-preview-tts'),/문서용/);assert.equal(calls.length,1);
  sandbox.fetch=async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"madang_connection_ok":true}'}]}}]})});
  assert.match(await sandbox.MadangAI.check('secret-test-key','gemini-flash-lite-latest'),/실제 Gemini 응답/);
});
