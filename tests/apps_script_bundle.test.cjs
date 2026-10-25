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
  runtime.ctx.HtmlService={createHtmlOutput:html=>({html,getContent(){return this.html;},setTitle(title){this.title=title;return this;},setWidth(width){this.width=width;return this;},setHeight(height){this.height=height;return this;}})};
  const output=runtime.ctx.doGet();
  assert.equal(output.html,fs.readFileSync('apps-script/Index.html','utf8'));
  assert.match(output.html,/application\/pdf/);
  assert.match(output.html,/id="archiveDocuments"/);
  assert.doesNotMatch(bundle,/createHtmlOutputFromFile/);
  assert.equal(runtime.ctx.setupJournal().configured,true);
  assert.equal(runtime.ctx.getAppState().apiKeyConfigured,false);
  const opened={};runtime.ctx.SpreadsheetApp.getUi=()=>({showModalDialog(view,title){opened.dialog={view,title};},showSidebar(view){opened.sidebar=view;}});
  runtime.ctx.showJournalDialog();assert.equal(opened.dialog.view.width,1100);assert.equal(opened.dialog.view.height,800);assert.match(opened.dialog.view.html,/data-host-mode="dialog"/);
  runtime.ctx.showSidebar();assert.match(opened.dialog.view.html,/data-host-mode="dialog"/);
  runtime.ctx.showNarrowSidebar();assert.match(opened.sidebar.html,/data-host-mode="sidebar"/);
});

test('manifest declares the integration scopes and private owner-only deployment',()=>{
  const manifest=JSON.parse(fs.readFileSync('apps-script/appsscript.json','utf8'));
  assert.equal(manifest.timeZone,'Asia/Seoul');
  assert.equal(manifest.webapp.access,'MYSELF');
  assert.equal(manifest.webapp.executeAs,'USER_DEPLOYING');
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'));
});
