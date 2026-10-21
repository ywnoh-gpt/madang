/* Test-only Google bridge: real Code.gs, in-memory Google services, fixture LLM. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {createRuntime} = require('./gas_runtime.cjs');
const runtime = createRuntime();
runtime.props.GEMINI_API_KEY = 'mock-test-key-not-a-credential';
runtime.setFetch({status:200,body:{candidates:[{content:{parts:[{text:JSON.stringify({
  fields:{court:'서울중앙지방법원',caseNumber:'2026타경123',itemNumber:'1',address:'서울시 합성 테스트 물건',propertyType:'근린시설',area:'84.5',auctionDate:'2026-11-10',appraisal:'2억원',minimumPrice:'1억 2300만원',failedAuctions:'1',saleResult:'미확인',actualPrice:null,bidderCount:null,predictedPrice:'999999999'},
  confidence:{court:'high',caseNumber:'high',itemNumber:'medium',minimumPrice:'low',propertyType:'high'},warnings:['자료별 매각기일과 최저가 단위를 원본과 대조하세요.']
})}]}}]}});
const bridge = `
window.google = {script:{run: runner()}};
function runner(success, failure) {
  return new Proxy({}, {get: function(_, method) {
    if (method === 'withSuccessHandler') return function(fn) {return runner(fn, failure);};
    if (method === 'withFailureHandler') return function(fn) {return runner(success, fn);};
    return function() {
      fetch('/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method:method,args:Array.from(arguments)})})
        .then(function(r){return r.json();}).then(function(r){if(r.error) throw new Error(r.error); if(success) success(r.result);})
        .catch(function(e){if(failure) failure(e); else console.error(e);});
    };
  }});
}`;
const allowed = new Set(['setupJournal','getAppState','extractDocuments','extractScreenshot','saveReviewedRecord','updateResult','refreshJournal']);
const server = http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'&&req.url==='/'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const html=fs.readFileSync(path.resolve(__dirname,'../../apps-script/Index.html'),'utf8');
    return res.end(html.replace('</head>','<script>'+bridge+'</script></head>'));
  }
  if(req.method==='GET'&&req.url==='/inspect'){
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify({state:runtime.ctx.getAppState(),audit:runtime.sheets['마당 변경 이력']?.rows,archived:runtime.getArchiveCount()}));
  }
  if(req.method==='POST'&&req.url==='/rpc'){
    res.setHeader('Content-Type','application/json');
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>20*1024*1024)throw new Error('Test request too large');}
      const {method,args}=JSON.parse(body);if(!allowed.has(method))throw new Error('Unknown RPC');
      res.end(JSON.stringify({result:runtime.ctx[method](...args)}));
    }catch(error){res.end(JSON.stringify({error:error.message}));}
    return;
  }
  res.statusCode=404;res.end('Not found');
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
