'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRuntime}=require('./fixtures/gas_runtime.cjs');

const documentModels=[
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-pro-latest'
];
const specializedModels=[
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
  'gemini-3.8-flash-tts',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-lite-image',
  'gemini-flash-native-audio',
  'gemini-flash-live',
  'gemini-2.5-flash-computer-use-preview',
  'gemini-3.1-pro-preview-customtools',
  'gemini-robotics-er-2-preview',
  'gemini-3.5-transcribe',
  'gemini-nano-banana-2.1',
  'gemini-flash-deep-research',
  'gemini-flash-antigravity',
  'gemini-2.5-flash-thinking',
  'gemma-4-31b-it',
  'lyria-3.5',
  'unknown-model'
];

test('ordinary Gemini Flash, Flash-Lite and Pro models are document candidates',()=>{
  const e=createRuntime();
  for(const id of documentModels)assert.equal(e.ctx.isDocumentModel_(id),true,id);
});

test('specialized generation capability does not imply document/JSON compatibility',()=>{
  const e=createRuntime();
  for(const id of specializedModels)assert.equal(e.ctx.isDocumentModel_(id),false,id);
  for(const value of [null,undefined,{},'','models/gemini-2.5-flash','https://example.com/model']){
    assert.equal(e.ctx.isDocumentModel_(value),false,String(value));
  }
});

test('the model picker excludes TTS and other specialized models even when they advertise generateContent',()=>{
  const e=createRuntime();e.ctx.saveApiKey('document-model-fixture-not-real');
  const ids=[...documentModels,...specializedModels];
  e.setFetch({status:200,body:{models:[
    ...ids.map(id=>({name:'models/'+id,displayName:id,supportedGenerationMethods:['generateContent']})),
    {name:'models/gemini-2.5-flash',displayName:'No generation method',supportedGenerationMethods:['embedContent']},
    {name:'models/gemini-2.5-pro',displayName:'Malformed methods',supportedGenerationMethods:'generateContent'},
    null
  ]}});
  const report=e.ctx.verifyRegisteredKey();
  assert.equal(report.ok,true);assert.equal(report.keyAcceptedForModelList,true);assert.equal(report.keyVerified,false);
  assert.deepEqual(Array.from(report.models,model=>model.id),documentModels);
  assert.equal(JSON.stringify(report).includes('document-model-fixture-not-real'),false);
});

test('rejected model changes preserve the previously saved document model',()=>{
  const e=createRuntime();e.ctx.setModel('gemini-2.5-flash');
  for(const model of specializedModels){
    assert.throws(()=>e.ctx.setModel(model),/문서|음성|지원/,model);
    assert.equal(e.props.GEMINI_MODEL,'gemini-2.5-flash');
  }
  assert.equal(e.getFetch(),undefined);
});

test('an existing TTS setting fails before any paid request and the report identifies the selected model',()=>{
  const e=createRuntime();e.ctx.saveApiKey('document-model-fixture-not-real');
  e.props.GEMINI_MODEL='gemini-2.5-flash-preview-tts';let calls=0;
  e.ctx.UrlFetchApp.fetch=()=>{calls++;throw new Error('must not be called');};
  assert.throws(
    ()=>e.ctx.requestGeminiJson_([{text:'fixture'}],{type:'OBJECT',properties:{}}),
    error=>error.diagnosticCode==='UNSUPPORTED_DOCUMENT_MODEL'
  );
  const report=e.ctx.checkGeminiConnection();
  assert.equal(report.ok,false);assert.equal(report.keyVerified,false);
  assert.equal(report.scope,'api_generation');assert.equal(report.status,'UNSUPPORTED_DOCUMENT_MODEL');
  assert.equal(report.model,'gemini-2.5-flash-preview-tts');
  assert.equal(calls,0);assert.equal(JSON.stringify(report).includes('document-model-fixture-not-real'),false);
});
