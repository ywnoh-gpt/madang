(async function() {
  'use strict';
  const C=MadangCore, S=MadangStore, AI=MadangAI, $=id=>document.getElementById(id);
  const state={records:[],history:[],sources:[],extraction:null,previewIndex:0,selected:null,busy:false,dirty:false};
  let previewUrl, draftTimer, draftQueue=Promise.resolve();
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('madang-records'):null;
  const money=value=>value==null?'—':new Intl.NumberFormat('ko-KR').format(value)+'원';
  const percent=(value,signed=false)=>value==null?'—':(signed&&value>0?'+':'')+(value*100).toFixed(1)+'%';
  function el(tag,text,className) { const node=document.createElement(tag);if(text!=null) node.textContent=text;if(className) node.className=className;return node; }
  function message(id,text,error=false) { $(id).textContent=text;$(id).classList.toggle('error',error);$(id).hidden=!text; }
  function report(error,id='globalMessage') {
    const text=error?.name==='QuotaExceededError'?'브라우저 저장 공간이 부족합니다. 기존 기록을 백업하고 저장 공간을 확보하세요. 이번 저장이 완료됐는지 목록에서 확인하세요.':error?.message||'작업을 완료하지 못했습니다.';
    message(id,text,true);
  }
  function view(name) {
    if(!['records','editor','settings','guide'].includes(name)) name='records';
    document.querySelectorAll('.view').forEach(node=>node.hidden=node.id!=='view-'+name);
    document.querySelectorAll('.nav').forEach(node=>node.classList.toggle('active',node.dataset.view===name));
    history.replaceState(null,'','#'+name);
    window.scrollTo({top:0,behavior:'instant'});
  }
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>view(button.dataset.view)));
  document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();view('records');});
  function field(key,prefix='') {
    const label=el('label',null,'field'), required=['court','caseNumber','itemNumber','auctionDate'].includes(key)&&!prefix;
    label.append(el('span',C.fields[key]+(required?' *':'')));
    const input=el(['rationale','reviewNote'].includes(key)?'textarea':key==='saleResult'?'select':'input');
    input.id=prefix+key;input.name=key;
    if(input.tagName==='INPUT') {
      input.type=['auctionDate','forecastDate'].includes(key)?'date':key.endsWith('Url')?'url':'text';
      input.maxLength=2000;
      if(C.moneyKeys.includes(key)||['area','failedAuctions','bidderCount'].includes(key)) input.inputMode='decimal';
    }
    if(input.tagName==='TEXTAREA') input.maxLength=4000;
    if(key==='saleResult') C.results.forEach(v=>{const option=el('option',v);option.value=v;input.append(option);});
    if(required) input.required=true;
    if(['address','rationale','reviewNote','memoUrl','sourceUrl'].includes(key)) label.classList.add('wide');
    if(key==='itemNumber') {input.placeholder='例: 1';input.title='같은 사건 안에서 매각 물건을 구분하는 번호입니다.';}
    label.append(input);
    if(C.extractionKeys.includes(key)&&!prefix) {const confidence=el('small');confidence.id='confidence_'+key;label.append(confidence);}
    return label;
  }
  const groups={propertyFields:['court','caseNumber','itemNumber','address','propertyType','area','auctionDate','appraisal','minimumPrice','failedAuctions'],predictionFields:['forecastDate','predictedPrice','virtualBid','marketPrice','extraCosts','targetProfit','rationale','memoUrl'],initialResultFields:['saleResult','actualPrice','bidderCount','reviewNote','sourceUrl']};
  Object.entries(groups).forEach(([id,keys])=>keys.forEach(key=>$(id).append(field(key))));
  ['saleResult','actualPrice','bidderCount','reviewNote'].forEach(k=>$('resultFields').append(field(k,'update_')));
  $('forecastDate').value=C.today();
  function values() { return Object.fromEntries(Object.keys(C.fields).map(k=>[k,$(k).value]).concat([['beforeResultConfirmed',$('beforeResult').checked]])); }
  function writeValues(input) { for(const k of Object.keys(C.fields)) $(k).value=input[k]??(k==='saleResult'?'미확인':'');$('beforeResult').checked=input.beforeResultConfirmed===true;updateLimit(); }
  function updateLimit() {
    try {
      const keys=['marketPrice','extraCosts','targetProfit'], amounts=keys.map(k=>C.amount($(k).value,C.fields[k]));
      $('upperLimit').textContent=amounts.some(v=>v===null)?'—':money(amounts[0]-amounts[1]-amounts[2]);
    } catch {$('upperLimit').textContent='금액 확인 필요';}
  }
  function currentDraft() {return {fields:values(),sources:state.sources,extraction:state.extraction,archive:$('archiveSources').checked,corrected:$('resultCorrected').checked,reason:$('correctionReason').value};}
  function queueDraft() {
    clearTimeout(draftTimer);
    state.dirty=true;
    $('draftStatus').textContent='임시 저장 중…';
    draftTimer=setTimeout(()=>{
      const draft=currentDraft();
      draftQueue=draftQueue.catch(()=>{}).then(()=>S.meta('draft',draft));
      draftQueue.then(()=>{$('draftStatus').textContent='이 브라우저에 임시 저장됨';},()=>{$('draftStatus').textContent='임시 저장 실패 · 입력을 보관하고 백업해 주세요.';});
    },400);
  }
  $('recordForm').addEventListener('input',event=>{
    if(event.target.id!=='reviewed') $('reviewed').checked=false;
    updateLimit();queueDraft();
  });
  function busy(value) {
    state.busy=value;
    for(const id of ['saveButton','extractButton','fileInput','resetDraft','saveModel','modelsButton','checkApi','forgetKey','updateResultButton','nextRound','importButton']) $(id).disabled=value;
    $('extractButton').disabled=value||state.sources.length===0;
    $('recordForm').querySelectorAll('input,textarea,select').forEach(input=>input.disabled=value);
    $('fileList').querySelectorAll('button').forEach(button=>button.disabled=value);
  }
  function showConfidence() {
    for(const key of C.extractionKeys) {
      const input=$(key), label=input.closest('label'), confidence=state.extraction?.confidence?.[key];
      label.classList.toggle('needs-review',Boolean(confidence&&confidence!=='high'));
      $('confidence_'+key).textContent=confidence?({high:'AI 인식 · 원본 대조 필요',medium:'AI 인식 · 확인 필요',low:'AI 인식 불확실 · 수정 필요',unknown:'자료에서 확인하지 못함'})[confidence]:'';
    }
    const warnings=state.extraction?.warnings||[];
    $('warnings').replaceChildren(...warnings.map(w=>el('li',w)));
    $('warnings').hidden=!warnings.length;
    $('extractionDetail').hidden=!state.extraction;
    $('extractionRaw').textContent=state.extraction?JSON.stringify(state.extraction,null,2):'';
  }
  function sourceBlob(source) {
    const binary=atob(source.dataUrl.split(',')[1]), bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    return new Blob([bytes],{type:source.mimeType});
  }
  function renderPreview() {
    if(previewUrl) {URL.revokeObjectURL(previewUrl);previewUrl=null;}
    $('previewTabs').replaceChildren();$('fileList').replaceChildren();
    $('previewCount').textContent=state.sources.length?state.sources.length+'개 자료':'자료 없음';
    state.sources.forEach((source,i)=>{
      const button=el('button',source.name,i===state.previewIndex?'active':'');
      button.type='button';button.addEventListener('click',()=>{state.previewIndex=i;renderPreview();});
      $('previewTabs').append(button);
      const row=el('div'), remove=el('button','제거');remove.disabled=state.busy;
      remove.addEventListener('click',()=>{state.sources.splice(i,1);state.previewIndex=0;state.extraction=null;$('reviewed').checked=false;showConfidence();renderPreview();queueDraft();});
      row.append(el('span',source.name),remove);$('fileList').append(row);
    });
    const source=state.sources[state.previewIndex];
    if(!source) {
      $('preview').className='preview-empty';
      $('preview').replaceChildren(el('span','▤'),el('p','자료를 올리면 이곳에서 볼 수 있어요.'),el('small','물건 상세 화면 캡처 또는 PDF를 올려 주세요.'));
    } else {
      $('preview').className='';
      const node=el(source.mimeType==='application/pdf'?'iframe':'img');
      node.className=source.mimeType==='application/pdf'?'preview-frame':'preview-image';
      previewUrl=URL.createObjectURL(sourceBlob(source));node.src=previewUrl+(source.mimeType==='application/pdf'?'#navpanes=0&view=FitH':'');
      // Chromium's native PDF viewer cannot run in a sandboxed iframe. The Blob
      // has a validated PDF signature and a fixed application/pdf MIME type.
      if(node.tagName==='IFRAME') node.title=source.name;
      else node.alt=source.name;
      const open=el('a','원본을 새 창에서 크게 보기 ↗');open.href=previewUrl;open.target='_blank';open.rel='noopener noreferrer';
      const note=el('p',null,'hint');note.append(open);
      $('preview').replaceChildren(node,note);
    }
    $('extractButton').disabled=state.busy||state.sources.length===0;
  }
  async function selectFiles(files) {
    if(state.busy) return;
    busy(true);
    try {
      const next=await AI.readFiles(Array.from(files));
      state.sources=next;state.previewIndex=0;state.extraction=null;$('reviewed').checked=false;
      showConfidence();renderPreview();queueDraft();message('extractMessage','자료를 준비했습니다. AI로 읽거나 원본을 보며 직접 입력하세요.');
    } catch(error) {report(error,'extractMessage');}
    finally {busy(false);$('fileInput').value='';}
  }
  $('fileInput').addEventListener('change',event=>selectFiles(event.target.files));
  for(const type of ['dragover','dragleave','drop']) $('dropzone').addEventListener(type,event=>{
    event.preventDefault();$('dropzone').classList.toggle('dragover',type==='dragover');
    if(type==='drop') selectFiles(event.dataTransfer.files);
  });
  $('extractButton').addEventListener('click',async()=>{
    if(state.busy) return;
    busy(true);message('extractMessage','자료를 읽고 있습니다. 중복 요청하지 마세요.');
    try {
      const extraction=await AI.extract($('apiKey').value.trim(),$('model').value.trim(),state.sources);
      state.extraction=extraction;
      C.extractionKeys.forEach(k=>$(k).value=extraction.fields[k]??(k==='saleResult'?'미확인':''));
      if(/^unknown$/i.test($('saleResult').value)) $('saleResult').value='미확인';
      // A select cannot display an unknown option. Show it as a warning instead of accepting it.
      if(!$('saleResult').value) {$('saleResult').value='미확인';extraction.warnings.push('매각 결과 인식값을 확인하세요: '+extraction.fields.saleResult);}
      if(C.hasResult(extraction.fields)) $('initialResult').open=true;
      $('reviewed').checked=false;$('resultCorrected').checked=false;
      showConfidence();queueDraft();message('extractMessage','인식했습니다. 원본과 나란히 확인한 뒤 빠진 항목과 오독을 수정하세요.');
    } catch(error) {report(error,'extractMessage');}
    finally {busy(false);}
  });
  async function refresh() {
    [state.records,state.history]=await Promise.all([S.records(),S.history()]);
    renderRecords();
  }
  function renderRecords() {
    const records=C.allDerived(state.records), m=C.metrics(state.records);
    $('navCount').textContent=records.length;$('recordCount').textContent=records.length+'건';
    $('metricCount').replaceChildren(document.createTextNode(m.evaluableCount),el('span','건'));
    $('metricAbsolute').textContent=percent(m.meanAbsoluteError);$('metricSigned').textContent=percent(m.meanPredictionError,true);
    $('metricNear').replaceChildren(document.createTextNode(m.withinFivePercentCount),el('span','건'));
    $('metricRatio').textContent=m.evaluableCount?'평가 기록의 '+percent(m.withinFivePercentRatio):'평가 기록 없음';
    const query=$('search').value.trim().toLowerCase(), filter=$('resultFilter').value;
    const filtered=records.filter(r=>(!filter||r.saleResult===filter)&&[r.court,r.caseNumber,r.address,r.itemNumber].join(' ').toLowerCase().includes(query));
    filtered.sort((a,b)=>$('sort').value==='auctionDate'?a.auctionDate.localeCompare(b.auctionDate):b.createdAt.localeCompare(a.createdAt));
    $('recordsBody').replaceChildren();
    for(const record of filtered) {
      const row=el('tr'), title=el('td');
      title.append(el('strong',record.address||record.propertyType||record.court),el('small',record.caseNumber+' · 물건 '+record.itemNumber+' · '+record.court));row.append(title);
      for(const value of [record.auctionDate,money(record.predictedPrice),money(record.virtualBid),money(record.actualPrice)]) row.append(el('td',value));
      row.append(el('td',percent(record.predictionError,true),record.predictionError>0?'positive':record.predictionError<0?'negative':''));
      const result=el('td');result.append(el('span',record.saleResult,'tag'+(record.saleResult==='낙찰'?' sold':'')));row.append(result);
      const actions=el('td'), button=el('button','상세·복기');button.addEventListener('click',()=>openDetail(record.recordId));actions.append(button);row.append(actions);$('recordsBody').append(row);
    }
    $('emptyState').hidden=records.length>0;$('noSearch').hidden=records.length===0||filtered.length>0;
  }
  ['search','resultFilter','sort'].forEach(id=>$(id).addEventListener('input',renderRecords));
  function resetForm() {
    clearTimeout(draftTimer);state.sources=[];state.extraction=null;state.previewIndex=0;state.dirty=false;
    $('recordForm').reset();$('forecastDate').value=C.today();$('initialResult').open=false;$('reviewed').checked=false;
    showConfidence();renderPreview();updateLimit();message('extractMessage','');message('saveMessage','');
    $('draftStatus').textContent='입력 내용은 이 브라우저에 임시 저장됩니다.';
  }
  $('resetDraft').addEventListener('click',async()=>{
    if(!confirm('현재 입력 중인 내용과 임시 저장을 지울까요? 저장된 기록은 유지됩니다.')) return;
    clearTimeout(draftTimer);await draftQueue.catch(()=>{});await S.meta('draft',undefined);resetForm();
  });
  $('recordForm').addEventListener('submit',async event=>{
    event.preventDefault();if(state.busy) return;
    if(!$('reviewed').checked) return message('saveMessage','원본과 입력값 대조를 먼저 확인해 주세요.',true);
    busy(true);clearTimeout(draftTimer);
    try {
      await draftQueue.catch(()=>{});
      const sources=state.sources.map(source=>$('archiveSources').checked?{...source}:Object.fromEntries(Object.entries(source).filter(([k])=>k!=='dataUrl')));
      await S.save(values(),state.extraction,sources,{reason:$('correctionReason').value,corrected:$('resultCorrected').checked});
      resetForm();await refresh();channel?.postMessage('changed');view('records');message('globalMessage','기록을 저장했습니다. 결과가 나오면 ‘상세·복기’에서 입력하세요.');
    } catch(error) {report(error,'saveMessage');}
    finally {busy(false);}
  });
  function download(content,type,name) {
    const blob=content instanceof Blob?content:new Blob([content],{type}), link=el('a');
    const url=URL.createObjectURL(blob);link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function exportBackup() {
    try {const data=await S.backup();download(JSON.stringify(data,null,2),'application/json','madang-backup-'+C.today()+'.json');message('globalMessage','JSON 백업 파일을 내려받았습니다. 다운로드 폴더에서 확인해 주세요.');}
    catch(error) {report(error);}
  }
  $('backupButton').addEventListener('click',exportBackup);$('settingsBackup').addEventListener('click',exportBackup);
  $('csvButton').addEventListener('click',()=>download(C.csvExport(state.records),'text/csv;charset=utf-8','madang-records-'+C.today()+'.csv'));
  $('importButton').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file||state.busy) return;
    busy(true);
    try {
      if(file.size>256*1024*1024) throw new Error('가져올 파일은 256MB 이하여야 합니다.');
      const source=await file.text();
      const data=/\.csv$/i.test(file.name)?{format:'madang-html-journal',version:1,records:C.recordsFromCsv(source),history:[]}:JSON.parse(source);
      // Validate the entire file before asking to write it.
      if(!data||!Array.isArray(data.records)) throw new Error('기록 파일 형식을 확인하세요.');
      if(!confirm(data.records.length+'건을 가져올까요? 기존 기록은 덮어쓰지 않습니다.')) return;
      const result=await S.merge(data);await refresh();channel?.postMessage('changed');
      message('globalMessage',result.added+'건을 가져왔습니다. 동일한 기존 기록 '+result.skipped+'건은 건너뛰었습니다.');
    } catch(error) {report(error);}
    finally {busy(false);event.target.value='';}
  });
  function openDetail(id) {
    const record=C.allDerived(state.records).find(r=>r.recordId===id);if(!record) return;
    state.selected=id;$('detailTitle').textContent=record.caseNumber+' · 물건 '+record.itemNumber;
    const content=$('detailContent');content.replaceChildren();
    const details=el('dl',null,'detail-grid');
    for(const [key,label] of Object.entries(C.fields)) {
      const cell=el('div',null,['address','rationale','reviewNote','memoUrl','sourceUrl'].includes(key)?'wide':'');
      cell.append(el('dt',label));const value=el('dd');
      if(key.endsWith('Url')&&record[key]) {const link=el('a',record[key]);link.href=C.url(record[key]);link.target='_blank';link.rel='noopener noreferrer';value.append(link);}
      else value.textContent=C.moneyKeys.includes(key)?money(record[key]):record[key]??'—';
      cell.append(value);details.append(cell);
    }
    content.append(details);
    const comparisons=el('div',null,'detail-comparisons');
    for(const value of ['입찰 상한가 '+money(record.upperLimit),record.minimumComparison,record.actualComparison,record.upperLimitComparison,record.bidOutcome,record.evaluable?'평가 포함 · 오차 '+percent(record.predictionError,true):'성과 평가 제외']) comparisons.append(el('span',value,'tag'));
    content.append(comparisons,el('p','저장 시각: '+record.createdAt+' · 결과 확인 전 예측: '+(record.beforeResultConfirmed?'예':'아니오'),'hint'));
    if(record.sources?.length) {
      const sources=el('div',null,'detail-sources');sources.append(el('b','보관 자료'));
      for(const source of record.sources) {
        const row=el('div');row.append(el('span',source.name+' '));
        if(source.dataUrl) {const button=el('button','원본 내려받기');button.type='button';button.addEventListener('click',()=>download(sourceBlob(source),source.mimeType,source.name));row.append(button);}
        else row.append(el('small','파일 미보관 · 파일명과 해시만 저장됨'));
        sources.append(row);
      }
      content.append(sources);
    }
    ['saleResult','actualPrice','bidderCount','reviewNote'].forEach(k=>$('update_'+k).value=record[k]??'');
    $('historyContent').textContent=JSON.stringify(state.history.filter(h=>h.recordId===id).sort((a,b)=>a.at.localeCompare(b.at)),null,2);
    message('resultMessage','');$('historyDetails').open=false;
    if(!$('detailDialog').open) $('detailDialog').showModal();
  }
  function confirmResultClose() {
    const record=state.records.find(r=>r.recordId===state.selected);
    const changed=record&&['saleResult','actualPrice','bidderCount','reviewNote'].some(k=>String(record[k]??'')!==$('update_'+k).value);
    return !changed||confirm('저장하지 않은 결과·복기 입력을 닫을까요?');
  }
  $('closeDetail').addEventListener('click',()=>{if(!state.busy&&confirmResultClose()) $('detailDialog').close();});
  $('detailDialog').addEventListener('cancel',event=>{if(state.busy||!confirmResultClose()) event.preventDefault();});
  $('resultForm').addEventListener('submit',async event=>{
    event.preventDefault();if(state.busy) return;busy(true);
    try {
      await S.updateResult(state.selected,Object.fromEntries(['saleResult','actualPrice','bidderCount','reviewNote'].map(k=>[k,$('update_'+k).value])));
      await refresh();channel?.postMessage('changed');$('detailDialog').close();message('globalMessage','결과와 복기를 저장했습니다. 최초 예측과 수정 전 결과는 보존했습니다.');
    } catch(error) {report(error,'resultMessage');}
    finally {busy(false);}
  });
  $('nextRound').addEventListener('click',async()=>{
    if(!confirmResultClose()) return;
    if(state.dirty&&!confirm('현재 작성 중인 새 기록을 다음 기일 입력으로 바꿀까요?')) return;
    const record=state.records.find(r=>r.recordId===state.selected);if(!record) return;
    await draftQueue.catch(()=>{});resetForm();
    const copy={...record,auctionDate:'',forecastDate:C.today(),saleResult:'미확인',actualPrice:null,bidderCount:null,reviewNote:'',beforeResultConfirmed:false,predictedPrice:null,virtualBid:null};
    writeValues(copy);$('detailDialog').close();view('editor');queueDraft();$('auctionDate').focus();message('extractMessage','기존 물건 정보를 복사했습니다. 새 매각기일·최저가·유찰 횟수를 확인하고, 이번 기일의 예측을 새로 작성하세요.');
  });
  $('saveModel').addEventListener('click',async()=>{
    try {const model=$('model').value.trim();if(!AI.isModel(model)) throw new Error('문서 인식용 Gemini Flash·Flash-Lite·Pro 모델 ID를 입력하세요.');await S.meta('model',model);message('apiMessage','모델을 저장했습니다: '+model);}
    catch(error) {report(error,'apiMessage');}
  });
  async function apiAction(action) {
    if(state.busy) return;busy(true);message('apiMessage','Google에 요청 중입니다. 중복 요청하지 마세요.');
    try {
      const key=$('apiKey').value.trim(), model=$('model').value.trim();
      if(action==='check') message('apiMessage',await AI.check(key,model));
      else {const models=await AI.listModels(key);$('modelOptions').replaceChildren(...models.map(id=>{const option=el('option');option.value=id;return option;}));message('apiMessage',models.length?'사용 가능한 문서용 모델 목록을 조회했습니다. 모델 입력란에서 선택해 저장하세요.\n'+models.join('\n'):'모델 목록에서 문서용 모델을 찾지 못했습니다.');}
    } catch(error) {report(error,'apiMessage');}
    finally {busy(false);}
  }
  $('checkApi').addEventListener('click',()=>apiAction('check'));$('modelsButton').addEventListener('click',()=>apiAction('models'));
  $('forgetKey').addEventListener('click',()=>{$('apiKey').value='';message('apiMessage','이 창에서 API 키를 지웠습니다.');});
  $('persistButton').addEventListener('click',async()=>{
    try {const granted=await navigator.storage?.persist?.();$('storageStatus').textContent=granted?'브라우저에서 저장 공간 유지 요청을 허용했습니다. 직접 사이트 데이터를 지우는 경우에는 삭제되므로 백업도 필요합니다.':'이 브라우저에서 유지 요청을 허용하지 않았습니다. JSON 백업을 주기적으로 저장해 주세요.';}
    catch(error) {report(error);}
  });
  channel?.addEventListener('message',()=>refresh().catch(report));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') refresh().catch(report);});
  window.addEventListener('beforeunload',event=>{if(state.busy||state.dirty) {event.preventDefault();event.returnValue='';}});
  try {
    await S.open();await refresh();
    $('model').value=await S.meta('model')||'gemini-flash-lite-latest';
    const draft=await S.meta('draft');
    if(draft) {
      writeValues(draft.fields||{});state.sources=draft.sources||[];state.extraction=draft.extraction||null;
      $('archiveSources').checked=draft.archive!==false;$('resultCorrected').checked=draft.corrected===true;$('correctionReason').value=draft.reason||'';
      state.dirty=true;$('reviewed').checked=false;showConfidence();renderPreview();
      $('draftStatus').textContent='이전 임시 입력을 복원했습니다. 원본 대조를 다시 확인해 주세요.';
    }
    view(location.hash.slice(1));
    $('storageStatus').textContent='현재 브라우저의 저장 공간을 사용합니다. JSON 백업에 API 키는 포함하지 않습니다.';
  } catch(error) {report(error);busy(true);}
})();
