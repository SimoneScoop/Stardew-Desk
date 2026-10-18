'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EXTENSIONS=new Set(['.lnk','.url','.appref-ms','.website']);
function scanShortcuts(roots){
 const result=[];const seen=new Set();
 for(const root of roots){if(!root||!fs.existsSync(root))continue;for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  if(!entry.isFile()||!EXTENSIONS.has(path.extname(entry.name).toLowerCase()))continue;
  const file=path.join(root,entry.name),identity=file.toLowerCase();if(seen.has(identity))continue;seen.add(identity);
  result.push({id:crypto.createHash('sha256').update(identity).digest('hex'),name:entry.name.replace(/\.(lnk|url|appref-ms|website)$/i,''),file,extension:path.extname(entry.name).toLowerCase()});
 }}return result.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
function resolveShortcut(roots,id){const item=scanShortcuts(roots).find(x=>x.id===id);if(!item)throw Error('这个快捷方式已被移动或删除，请刷新箱子');return item;}
function ordered(items,order){const ranks=new Map((Array.isArray(order)?order:[]).map((id,i)=>[id,i]));return [...items].sort((a,b)=>(ranks.get(a.id)??1e9)-(ranks.get(b.id)??1e9));}
function isChest(o){return o.type==='Chest'||/^(Stone )?Chest$/.test(o.name);}
function chestKey(model,o){return model.id+':'+o.x+','+o.y;}
function chests(model){return (model?.objects||[]).filter(isChest).map((o,i)=>({key:chestKey(model,o),x:o.x,y:o.y,name:'快捷箱 '+(i+1)}));}
module.exports={scanShortcuts,resolveShortcut,ordered,isChest,chestKey,chests};
