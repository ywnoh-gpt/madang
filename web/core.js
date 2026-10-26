(function (root) {
  'use strict';
  const fields = {
    court:'법원', caseNumber:'사건번호', itemNumber:'물건번호', address:'주소', propertyType:'유형', area:'면적(㎡)',
    auctionDate:'매각기일', appraisal:'감정가', minimumPrice:'최저가', failedAuctions:'유찰 횟수',
    forecastDate:'예상 작성일', predictedPrice:'예상 낙찰가', virtualBid:'가상 입찰가', rationale:'판단 근거·특징',
    marketPrice:'예상 시세', extraCosts:'추가 비용 합계', targetProfit:'목표 이익', memoUrl:'상세 메모 링크',
    saleResult:'매각 결과', actualPrice:'실제 낙찰가', bidderCount:'입찰자 수', reviewNote:'복기 메모', sourceUrl:'출처 링크'
  };
  const extractionKeys = ['court','caseNumber','itemNumber','address','propertyType','area','auctionDate','appraisal','minimumPrice','failedAuctions','saleResult','actualPrice','bidderCount'];
  const moneyKeys = ['appraisal','minimumPrice','predictedPrice','virtualBid','marketPrice','extraCosts','targetProfit','actualPrice'];
  const results = ['미확인','낙찰','유찰','변경','연기','취하','기각'];
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function text(value,max=4000) {
    const s=value==null?'':String(value).trim();
    if(s.length>max) throw new Error('입력 내용이 너무 깁니다.');
    return s;
  }
  function amount(value,label='금액') {
    if(value==null || value==='') return null;
    if(typeof value==='number') {
      if(Number.isSafeInteger(value)&&value>=0) return value;
      throw new Error(label+'는 0 이상의 정수 원 단위로 입력하세요.');
    }
    const s=text(value).replace(/^(?:KRW|[₩￦])\s*/i,'').replace(/\s*(?:KRW|[₩￦])$/i,'').replace(/,/g,'').replace(/\s+/g,'').replace(/원$/,'');
    if(/^\d+$/.test(s)&&Number.isSafeInteger(Number(s))) return Number(s);
    if(/^(?:\d+(?:\.\d+)?억)?(?:\d+(?:\.\d+)?만)?(?:\d+)?$/.test(s)&&/[억만]/.test(s)) {
      let total=0;
      s.replace(/(\d+(?:\.\d+)?)(억|만)|([0-9]+)$/g,(_,n,u,tail)=>{
        if(tail) total+=Number(tail);
        else {
          const digits=u==='억'?8:4, parts=n.split('.'), fraction=(parts[1]||'').replace(/0+$/,'');
          if(fraction.length>digits) total=NaN;
          else total+=Number(parts[0])*10**digits+Number((fraction+'00000000').slice(0,digits));
        }
        return '';
      });
      if(Number.isSafeInteger(total)&&total>=0) return total;
    }
    throw new Error(label+' 금액을 확인하세요. 예: 123000000, 1억 2300만원.');
  }
  function date(value,label) {
    const s=text(value);
    if(!s) return '';
    const d=new Date(s+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s) throw new Error(label+' 날짜를 확인하세요.');
    return s;
  }
  function url(value) {
    const s=text(value,2000);
    if(!s) return '';
    let parsed;
    try { parsed=new URL(s); } catch { throw new Error('링크는 http 또는 https 주소로 입력하세요.'); }
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password) throw new Error('링크는 http 또는 https 주소로 입력하세요.');
    return s;
  }
  function normalize(input,required=true) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('입력 형식을 확인하세요.');
    const r={};
    for(const key of Object.keys(fields)) r[key]=text(input[key],['rationale','reviewNote'].includes(key)?4000:2000);
    for(const key of moneyKeys) r[key]=amount(input[key],fields[key]);
    for(const key of ['failedAuctions','bidderCount']) {
      const s=text(input[key]).replace(/,/g,'');
      if(s&&!/^\d+$/.test(s)) throw new Error(fields[key]+'는 0 이상의 정수로 입력하세요.');
      r[key]=s?Number(s):null;
      if(r[key]>1000000) throw new Error(fields[key]+' 값을 확인하세요.');
    }
    const area=text(input.area).replace(/,/g,'');
    r.area=area?Number(area):null;
    if(area&&(!Number.isFinite(r.area)||r.area<=0)) throw new Error('면적은 양수 숫자로 입력하세요.');
    for(const key of ['auctionDate','forecastDate']) r[key]=date(input[key],fields[key]);
    for(const key of ['memoUrl','sourceUrl']) r[key]=url(input[key]);
    r.saleResult=r.saleResult||'미확인';
    if(/^unknown$/i.test(r.saleResult)) r.saleResult='미확인';
    if(!results.includes(r.saleResult)) throw new Error('매각 결과를 확인하세요.');
    if(required&&!['court','caseNumber','itemNumber','auctionDate'].every(k=>r[k])) throw new Error('법원·사건번호·물건번호·매각기일을 입력하세요.');
    if(r.saleResult==='낙찰'&&!(r.actualPrice>0)) throw new Error('낙찰 결과에는 실제 낙찰가가 필요합니다.');
    r.beforeResultConfirmed=input.beforeResultConfirmed===true;
    return r;
  }
  function identity(r) { return ['court','caseNumber','itemNumber','auctionDate'].map(k=>text(r[k]).replace(/\s+/g,'').toLowerCase()).join('|'); }
  function hasResult(r) { return r.saleResult==='낙찰'||(r.actualPrice!=null&&r.actualPrice!==''); }
  function checkPrediction(r,extraction,correctionReason='',corrected=false) {
    if(!r.beforeResultConfirmed) return;
    if(!r.forecastDate||r.forecastDate>today()||r.forecastDate>r.auctionDate) throw new Error('예상 작성일은 오늘과 매각기일 이후일 수 없습니다.');
    if(hasResult(r)) throw new Error('이미 낙찰 결과가 있는 기록은 사전 예측으로 저장할 수 없습니다.');
    if(extraction&&hasResult(extraction.fields)&&(!corrected||!text(correctionReason))) throw new Error('인식 자료에 낙찰 결과가 있습니다. 오독이라면 결과 오독 확인과 수정 사유를 남겨 주세요.');
  }
  function derive(r,duplicate=false) {
    const has=k=>typeof r[k]==='number'&&Number.isFinite(r[k]);
    const upperLimit=['marketPrice','extraCosts','targetProfit'].every(has)?r.marketPrice-r.extraCosts-r.targetProfit:null;
    const validDates=Boolean(r.forecastDate&&r.auctionDate&&r.forecastDate<=today()&&r.forecastDate<=r.auctionDate);
    const evaluable=!duplicate&&validDates&&['court','caseNumber','itemNumber'].every(k=>r[k])&&r.beforeResultConfirmed===true&&r.saleResult==='낙찰'&&has('predictedPrice')&&r.predictedPrice>0&&has('actualPrice')&&r.actualPrice>0;
    const predictionError=evaluable?(r.predictedPrice-r.actualPrice)/r.actualPrice:null;
    const compare=(a,b)=>a<b?'미만':a===b?'동액':'초과';
    const validBid=has('virtualBid')&&r.virtualBid>0;
    const minimumComparison=validBid&&has('minimumPrice')?'최저가 '+compare(r.virtualBid,r.minimumPrice):'미입력';
    const actualComparison=validBid&&r.saleResult==='낙찰'&&has('actualPrice')&&r.actualPrice>0?'실제 낙찰가 '+compare(r.virtualBid,r.actualPrice):'결과 대기';
    const upperLimitComparison=validBid&&upperLimit!==null?'상한가 '+compare(r.virtualBid,upperLimit):'미입력';
    const bidOutcome=!validBid?'가상 입찰가 미입력':has('minimumPrice')&&r.virtualBid<r.minimumPrice?'최저가 미달':r.saleResult!=='낙찰'||!(r.actualPrice>0)?'결과 대기':r.virtualBid===r.actualPrice?'낙찰가 동액 · 낙찰 여부 불확정':r.virtualBid>r.actualPrice?'낙찰가 초과 · 모의 비교상 유리':'낙찰가 미달';
    return {...r,upperLimit,evaluable,predictionError,absoluteError:evaluable?Math.abs(predictionError):null,minimumComparison,actualComparison,upperLimitComparison,bidOutcome};
  }
  function allDerived(records) {
    const counts=new Map();
    records.forEach(r=>counts.set(identity(r),(counts.get(identity(r))||0)+1));
    return records.map(r=>derive(r,counts.get(identity(r))>1));
  }
  function metrics(records) {
    const rows=allDerived(records).filter(r=>r.evaluable), n=rows.length, near=rows.filter(r=>r.absoluteError<=0.05).length;
    return {evaluableCount:n,meanAbsoluteError:n?rows.reduce((s,r)=>s+r.absoluteError,0)/n:null,meanPredictionError:n?rows.reduce((s,r)=>s+r.predictionError,0)/n:null,withinFivePercentCount:near,withinFivePercentRatio:n?near/n:null};
  }
  function csvParse(source) {
    const input=source.replace(/^\uFEFF/,''), rows=[], row=[];
    let value='',quoted=false;
    for(let i=0;i<input.length;i++) {
      const c=input[i];
      if(quoted) {
        if(c==='"'&&input[i+1]==='"') {value+='"'; i++;}
        else if(c==='"') quoted=false;
        else value+=c;
      } else if(c==='"'&&value==='') quoted=true;
      else if(c===',') {row.push(value);value='';}
      else if(c==='\n'||c==='\r') {
        if(c==='\r'&&input[i+1]==='\n') i++;
        row.push(value);rows.push(row.splice(0));value='';
      } else value+=c;
    }
    if(quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
    if(value||row.length) {row.push(value);rows.push(row);}
    return rows;
  }
  function recordsFromCsv(source) {
    const rows=csvParse(source), headerIndex=rows.findIndex(row=>row.includes('사건번호')&&row.includes('매각기일'));
    if(headerIndex<0) throw new Error('사건번호·매각기일 열이 있는 기록 시트 CSV를 선택하세요.');
    const headers=rows[headerIndex], mapping={...fields,recordId:'기록 ID',createdAt:'최초 저장 시각',beforeResultConfirmed:'결과 확인 전 예측'};
    return rows.slice(headerIndex+1).filter(row=>row.some(v=>v.trim())).map((row,i)=>{
      const item={};
      for(const [key,label] of Object.entries(mapping)) {
        const index=headers.indexOf(label);
        if(index>=0) item[key]=row[index]||'';
      }
      item.beforeResultConfirmed=/^(true|참)$/i.test(item.beforeResultConfirmed||'');
      try { return {...normalize(item),recordId:text(item.recordId,100),createdAt:text(item.createdAt,100)}; }
      catch(error) { throw new Error('CSV '+(headerIndex+i+2)+'행: '+error.message); }
    });
  }
  function csvExport(records) {
    const keys=Object.keys(fields), quote=value=>'"'+String(value==null?'':value).replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
    const rows=[keys.map(k=>fields[k]).concat(['결과 확인 전 예측','내 입찰 상한가','예측 오차율'])];
    allDerived(records).forEach(r=>rows.push(keys.map(k=>r[k]).concat([r.beforeResultConfirmed,r.upperLimit,r.predictionError])));
    return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
  }
  const api={fields,extractionKeys,moneyKeys,results,today,text,amount,date,url,normalize,identity,hasResult,checkPrediction,derive,allDerived,metrics,csvParse,recordsFromCsv,csvExport};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.MadangCore=api;
})(globalThis);
