'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRuntime}=require('./fixtures/gas_runtime.cjs');

test('single-file installation embeds the current UI and runs setup without an HTML file',()=>{
  const runtime=createRuntime();
  const bundle=fs.readFileSync('dist/Madang.gs','utf8');
  vm.runInContext(bundle,runtime.ctx);
  runtime.ctx.HtmlService={createHtmlOutput:html=>({setTitle:title=>({html,title})})};
  const output=runtime.ctx.doGet();
  assert.equal(output.html,fs.readFileSync('apps-script/Index.html','utf8'));
  assert.match(output.html,/application\/pdf/);
  assert.match(output.html,/id="archiveDocuments"/);
  assert.doesNotMatch(bundle,/createHtmlOutputFromFile/);
  assert.equal(runtime.ctx.setupJournal().configured,true);
  assert.equal(runtime.ctx.getAppState().apiKeyConfigured,false);
});

test('manifest declares the integration scopes and private owner-only deployment',()=>{
  const manifest=JSON.parse(fs.readFileSync('apps-script/appsscript.json','utf8'));
  assert.equal(manifest.timeZone,'Asia/Seoul');
  assert.equal(manifest.webapp.access,'MYSELF');
  assert.equal(manifest.webapp.executeAs,'USER_DEPLOYING');
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'));
});
