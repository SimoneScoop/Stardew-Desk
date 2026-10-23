'use strict';
const fs=require('node:fs'),path=require('node:path');
const roster=require('./ui/npc-roster.js'),{profiles,gifts}=require('./ui/npc-personality.js');
const allowed=new Set(roster.map(n=>n.id));
function localDay(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
class Friendship {
 constructor(file,{memory=false,clock=()=>new Date()}={}){this.file=file;this.memory=memory;this.clock=clock;this.data={version:1,farms:{}};if(!memory&&fs.existsSync(file)){const loaded=JSON.parse(fs.readFileSync(file,'utf8'));if(loaded?.version!==1||!loaded.farms||typeof loaded.farms!=='object')throw Error('好感数据格式无效');this.data=loaded;}}
 snapshot(farm){const source=this.data.farms[farm]||{},out={};for(const id of allowed){const entry=source[id]||{};out[id]={points:Math.max(0,Math.min(2500,Number(entry.points)||0)),daily:entry.daily||{}};}return {farm,relationships:out};}
 reward(farm,id,action,gift){if(typeof farm!=='string'||!farm||farm.length>200||!allowed.has(id)||!['greet','talk','gift'].includes(action)||action==='gift'&&!Object.hasOwn(gifts,gift))throw Error('无效的好感互动');
  const relationships=this.snapshot(farm).relationships,entry=relationships[id],day=localDay(this.clock());let gained=0;
  if(entry.daily[action]!==day){gained=action==='gift'?(profiles[id].favorite===gift?80:60):20;const before=entry.points;entry.points=Math.min(2500,before+gained);gained=entry.points-before;entry.daily[action]=day;const next=JSON.parse(JSON.stringify(this.data));if(!Object.hasOwn(next.farms,farm))Object.defineProperty(next.farms,farm,{value:{},writable:true,enumerable:true,configurable:true});next.farms[farm]=relationships;
   if(!this.memory){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2));fs.renameSync(temp,this.file);}this.data=next;
  }
  return {state:this.snapshot(farm),id,action,gained,already:gained===0,day};
 }
}
module.exports={Friendship,localDay};
