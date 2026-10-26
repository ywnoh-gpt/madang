'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="styles.css">',()=>'<style>\n'+fs.readFileSync(path.join(root,'web/styles.css'),'utf8')+'\n</style>');
for(const file of ['core.js','storage.js','gemini.js','app.js']) {
  const source=fs.readFileSync(path.join(root,'web',file),'utf8');
  new (require('node:vm').Script)(source,{filename:file});
  html=html.replace('<script src="'+file+'"></script>',()=>'<script>\n'+source.replace(/<\/script/gi,'<\\/script')+'\n</script>');
}
fs.writeFileSync(path.join(root,'index.html'),html);
console.log('Built standalone index.html ('+Buffer.byteLength(html)+' bytes); no external UI dependencies.');
