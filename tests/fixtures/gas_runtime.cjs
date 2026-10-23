const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
function environment() {
  class MockDate extends Date {constructor(...args){super(...(args.length?args:['2026-10-22T03:00:00Z']));}static now(){return new Date('2026-10-22T03:00:00Z').getTime();}}
  class Range {
    constructor(sheet,r,c,n=1,m=1){Object.assign(this,{sheet,r,c,n,m});}
    getValues(){return Array.from({length:this.n},(_,i)=>Array.from({length:this.m},(_,j)=>this.sheet.rows[this.r+i-1]?.[this.c+j-1]??''));}
    getValue(){return this.getValues()[0][0];}
    setValues(data){for(let i=0;i<this.n;i++){this.sheet.rows[this.r+i-1]??=[];for(let j=0;j<this.m;j++){let v=data[i][j];this.sheet.rows[this.r+i-1][this.c+j-1]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v;}}return this;}
    setValue(v){return this.setValues([[v]]);}
    setBackground(){return this;}setFontColor(){return this;}setFontWeight(){return this;}setNumberFormat(){return this;}
  }
  class Sheet {
    constructor(name){this.name=name;this.rows=[];this.columns=26;}
    getRange(r,c,n=1,m=1){if(c+m-1>this.columns)throw new Error('range columns out of bounds');return new Range(this,r,c,n,m);}getMaxColumns(){return this.columns;}insertColumnsAfter(_,count){this.columns+=count;}getLastRow(){return this.rows.length;}
    appendRow(row){this.rows.push(row.map(v=>typeof v==='string'&&v.startsWith("'")?v.slice(1):v));return this;}
    setFrozenRows(){}getSheetId(){return 123;}
  }
  const sheets={};const props={};const userProps={};const cache={};let uuid=0;let lockHeld=false;let fetchOptions;let fetchResult;let active=true;let archives=0;let trashed=0;
  const propertyService=store=>({getProperty:k=>store[k]??null,setProperty(k,v){store[k]=v;return this;}});
  const book={getSheetByName:n=>sheets[n]??null,insertSheet(n){return sheets[n]=new Sheet(n);},deleteSheet(sheet){assert.equal(sheets[sheet.name],sheet);delete sheets[sheet.name];},getId:()=> 'book-id',getUrl:()=> 'https://docs.google.com/spreadsheets/d/book-id/edit'};
  const context={console,Date:MockDate,Number,JSON,Object,Array,String,Boolean,Math,RegExp,isFinite,isNaN,
    SpreadsheetApp:{getActiveSpreadsheet:()=>active?book:null,openById:id=>{assert.equal(id,'book-id');return book;},flush(){}},
    PropertiesService:{getScriptProperties:()=>propertyService(props),getUserProperties:()=>propertyService(userProps)},
    LockService:{getScriptLock:()=>({tryLock(){if(lockHeld)return false;lockHeld=true;return true;},releaseLock(){lockHeld=false;}})},
    CacheService:{getUserCache:()=>({put(k,v){cache[k]=v;},get:k=>cache[k]??null})},
    Utilities:{getUuid:()=>`record-${++uuid}`,sleep(){},base64Decode:v=>[...Buffer.from(v,'base64')],base64Encode:v=>Buffer.from(v).toString('base64'),computeDigest:(_,bytes)=>[...crypto.createHash('sha256').update(Buffer.from(bytes)).digest()],DigestAlgorithm:{SHA_256:'sha256'},newBlob:(...args)=>args,formatDate:date=>date.toISOString().slice(0,10)},
    UrlFetchApp:{fetch(url,options){fetchOptions={url,...options};return {getResponseCode:()=>fetchResult?.status??200,getContentText:()=>JSON.stringify(fetchResult?.body??{candidates:[{content:{parts:[{text:JSON.stringify({fields:{court:'서울중앙지방법원',caseNumber:'2026타경123',itemNumber:'1',auctionDate:'2026-11-10',minimumPrice:'1억 2300만원',predictedPrice:'999999999'},confidence:{court:'high'},warnings:['최저가 단위를 확인하세요.']})}]}}]})};}},
    DriveApp:{createFolder:()=>({getId:()=> 'folder-id',createFile(){archives++;return {getUrl:()=> 'https://drive.google.com/file/d/image-id/view',setTrashed(v){if(v)trashed++;}};}}),getFolderById:()=>({createFile(){archives++;return {getUrl:()=> 'https://drive.google.com/file/d/image-id/view',setTrashed(v){if(v)trashed++;}};}})}
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../apps-script/Code.gs'),'utf8'),context);
  return {ctx:context,sheets,props,cache,book,setActive:v=>active=v,setFetch:v=>fetchResult=v,getFetch:()=>fetchOptions,getArchiveCount:()=>archives,getTrashCount:()=>trashed,holdLock:()=>lockHeld=true};
}

module.exports={createRuntime:environment};
