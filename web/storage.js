(function(root) {
  'use strict';
  const C=root.MadangCore;
  const DB_NAME='madang-journal', VERSION=1;
  let db;
  function request(req) { return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }
  function done(tx) { return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('저장 작업이 취소되었습니다.'));tx.onerror=()=>{};}); }
  async function open() {
    if(!root.indexedDB) throw new Error('이 브라우저에서는 기록 저장 기능을 사용할 수 없습니다. Chrome 또는 Edge에서 열어 주세요.');
    const req=root.indexedDB.open(DB_NAME,VERSION);
    req.onupgradeneeded=()=>{
      const instance=req.result;
      const records=instance.createObjectStore('records',{keyPath:'recordId'});
      records.createIndex('identity','identityKey',{unique:true});
      instance.createObjectStore('history',{keyPath:'id'});
      instance.createObjectStore('meta');
    };
    db=await request(req);
    db.onversionchange=()=>db.close();
  }
  async function read(store,key) {
    const tx=db.transaction(store,'readonly'), completed=done(tx);
    const result=await request(key===undefined?tx.objectStore(store).getAll():tx.objectStore(store).get(key));
    await completed;
    return result;
  }
  async function meta(key,value) {
    if(arguments.length===1) return read('meta',key);
    const tx=db.transaction('meta','readwrite'), completed=done(tx);
    if(value===undefined) tx.objectStore('meta').delete(key);
    else tx.objectStore('meta').put(value,key);
    await completed;
  }
  function uuid() { return root.crypto.randomUUID(); }
  function event(recordId,action,before,after,reason='') {
    const snapshot=value=>value&&Array.isArray(value.sources)?{...value,sources:value.sources.map(({dataUrl,...metadata})=>metadata)}:value;
    return {id:uuid(),recordId,at:new Date().toISOString(),action,before:snapshot(before),after:snapshot(after),reason};
  }
  async function save(input,extraction,sources,options={}) {
    const normalized=C.normalize(input);
    C.checkPrediction(normalized,extraction,options.reason,options.corrected);
    const record={...normalized,recordId:uuid(),createdAt:new Date().toISOString(),identityKey:C.identity(normalized),sources,
      extraction:extraction?structuredClone(extraction):null,correctionReason:C.text(options.reason),resultVisibilityCorrected:options.corrected===true};
    const tx=db.transaction(['records','history','meta'],'readwrite'), completed=done(tx);
    tx.objectStore('records').add(record);
    tx.objectStore('history').add(event(record.recordId,'최초 기록',extraction||null,record,record.correctionReason));
    tx.objectStore('meta').delete('draft');
    try { await completed; }
    catch(error) {
      if(error.name==='ConstraintError') throw new Error('같은 법원·사건번호·물건번호·매각기일이 이미 있습니다. 결과는 기존 기록에서 입력하고, 다음 기일은 새 행으로 추가하세요.');
      throw error;
    }
    return record;
  }
  async function updateResult(id,patch) {
    const allowed=['saleResult','actualPrice','bidderCount','reviewNote'];
    if(Object.keys(patch).some(k=>!allowed.includes(k))) throw new Error('최초 예측은 보존됩니다. 결과·복기 항목만 수정할 수 있습니다.');
    const tx=db.transaction(['records','history'],'readwrite'), completed=done(tx);
    // Handle validation inside the request callback so the write stays in one transaction.
    let validationError;
    const req=tx.objectStore('records').get(id);
    req.onsuccess=()=>{
      try {
        const before=req.result;
        if(!before) throw new Error('기록을 찾지 못했습니다.');
        const values=C.normalize({...before,...patch});
        const after={...before,updatedAt:new Date().toISOString()};
        allowed.forEach(k=>after[k]=values[k]);
        tx.objectStore('records').put(after);
        tx.objectStore('history').add(event(id,'결과·복기 수정',before,after,'사용자 결과 확인'));
      } catch(error) { validationError=error;tx.abort(); }
    };
    try {await completed;} catch(error) {throw validationError||error;}
  }
  async function backup() {
    const tx=db.transaction(['records','history'],'readonly'), completed=done(tx);
    const records=request(tx.objectStore('records').getAll()), history=request(tx.objectStore('history').getAll());
    const data={format:'madang-html-journal',version:1,exportedAt:new Date().toISOString(),records:await records,history:await history};
    await completed;
    return data;
  }
  function cleanRecord(input) {
    const normalized=C.normalize(input);
    const sources=Array.isArray(input.sources)?input.sources:[];
    if(sources.length>3) throw new Error('기록당 원본 자료는 최대 3개입니다.');
    const cleaned=sources.map(s=>{
      const result={name:C.text(s.name,500),mimeType:C.text(s.mimeType,100),hash:C.text(s.hash,100)};
      if(!['image/png','image/jpeg','image/webp','application/pdf'].includes(result.mimeType)) throw new Error('백업의 원본 MIME 형식을 확인하세요.');
      if(s.dataUrl) {
        if(typeof s.dataUrl!=='string'||s.dataUrl.length>12*1024*1024||!s.dataUrl.startsWith('data:'+result.mimeType+';base64,')) throw new Error('백업의 원본 자료 형식을 확인하세요.');
        const encoded=s.dataUrl.split(',')[1];
        if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)||encoded.length%4!==0) throw new Error('백업의 원본 파일 인코딩을 확인하세요.');
        let head;
        try {head=root.atob(encoded.slice(0,32));} catch {throw new Error('백업의 원본 파일 인코딩을 확인하세요.');}
        const valid=result.mimeType==='application/pdf'?head.startsWith('%PDF-'):result.mimeType==='image/png'?head.startsWith('\x89PNG\r\n\x1a\n'):result.mimeType==='image/jpeg'?head.startsWith('\xff\xd8\xff'):head.startsWith('RIFF')&&head.slice(8,12)==='WEBP';
        const size=encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
        if(!valid||size>(result.mimeType==='application/pdf'?8:5)*1024*1024) throw new Error('백업의 원본 파일 내용·크기를 확인하세요.');
        result.dataUrl=s.dataUrl;
      }
      return result;
    });
    // Imported history/extraction is inert JSON, never interpreted as code or markup.
    return {...normalized,recordId:C.text(input.recordId,100)||uuid(),createdAt:C.text(input.createdAt,100)||new Date().toISOString(),
      identityKey:C.identity(normalized),sources:cleaned,extraction:input.extraction&&typeof input.extraction==='object'?input.extraction:null,
      correctionReason:C.text(input.correctionReason),resultVisibilityCorrected:input.resultVisibilityCorrected===true,updatedAt:C.text(input.updatedAt,100)};
  }
  function prepareImport(data) {
    if(!data||data.format!=='madang-html-journal'||data.version!==1||!Array.isArray(data.records)||!Array.isArray(data.history)) throw new Error('마당 JSON 백업 파일이 아닙니다.');
    if(data.records.length>10000||data.history.length>100000) throw new Error('백업의 기록 수가 너무 많습니다.');
    const records=data.records.map(cleanRecord), ids=new Set(), keys=new Set();
    records.forEach(r=>{
      if(ids.has(r.recordId)||keys.has(r.identityKey)) throw new Error('백업 안에 중복된 기록이 있습니다.');
      ids.add(r.recordId);keys.add(r.identityKey);
    });
    const history=data.history.map(h=>({id:C.text(h.id,100)||uuid(),recordId:C.text(h.recordId,100),at:C.text(h.at,100),action:C.text(h.action,200),reason:C.text(h.reason),before:h.before??null,after:h.after??null}));
    return {records,history};
  }
  async function merge(data) {
    const incoming=prepareImport(data), tx=db.transaction(['records','history'],'readwrite'), completed=done(tx);
    const req=tx.objectStore('records').getAll();
    let added=0, skipped=0, failure;
    req.onsuccess=()=>{
      try {
        const existing=req.result, byId=new Map(existing.map(r=>[r.recordId,r])), byKey=new Map(existing.map(r=>[r.identityKey,r]));
        const importedIds=new Set();
        // Compare all conflicts before scheduling any writes. Imports never overwrite predictions/results.
        for(const r of incoming.records) {
          const old=byId.get(r.recordId)||byKey.get(r.identityKey);
          if(old) {
            if(JSON.stringify(C.normalize(old))!==JSON.stringify(C.normalize(r))) throw new Error('기존 기록과 내용이 다른 항목이 있습니다: '+r.caseNumber+' / '+r.auctionDate+'. 자동으로 덮어쓰지 않았습니다.');
            skipped++;
          } else {
            tx.objectStore('records').add(r);importedIds.add(r.recordId);added++;
            tx.objectStore('history').add(event(r.recordId,'백업·CSV 가져오기',null,r,'사용자 파일 가져오기'));
          }
        }
        for(const h of incoming.history) if(importedIds.has(h.recordId)) tx.objectStore('history').add({...h,id:uuid()});
      } catch(error) {failure=error;tx.abort();}
    };
    try {await completed;} catch(error) {throw failure||error;}
    return {added,skipped};
  }
  root.MadangStore={open,meta,save,updateResult,backup,merge,records:()=>read('records'),history:()=>read('history')};
})(globalThis);
