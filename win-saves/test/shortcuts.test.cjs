const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {scanShortcuts,resolveShortcut,ordered,chests}=require('../shortcuts.cjs');
test('scan includes only desktop shortcuts, deduplicates roots and never launches files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stardew-shortcuts-'));for(const n of ['工具.lnk','网页.url','说明.txt','secret.exe'])fs.writeFileSync(path.join(root,n),'fixture');
 const items=scanShortcuts([root,root]);assert.equal(items.length,2);assert.ok(items.every(i=>['.lnk','.url'].includes(i.extension)));assert.equal(resolveShortcut([root],items[0].id).file,items[0].file);assert.throws(()=>resolveShortcut([root],'../../secret.exe'));const reversed=ordered(items,items.map(i=>i.id).reverse());assert.equal(reversed[0].id,items[1].id);fs.rmSync(root,{recursive:true});
});
test('each save chest has a separate stable inventory key',()=>{const model={id:'farm1',objects:[{type:'Chest',name:'Chest',x:2,y:3},{type:'Object',name:'Keg',x:4,y:5},{type:'Chest',name:'Stone Chest',x:6,y:7}]};const boxes=chests(model);assert.equal(boxes.length,2);assert.deepEqual(boxes.map(c=>c.key),['farm1:2,3','farm1:6,7']);});
