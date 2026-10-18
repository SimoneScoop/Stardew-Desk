'use strict';
const fs=require('node:fs'); const path=require('node:path'); const vm=require('node:vm'); const crypto=require('node:crypto');
const XNB=require('./lib/xnb.js');
const sandbox={window:{},TextDecoder,DataView,Uint8Array}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'lib/tbin.js'),'utf8'),sandbox);
const TBIN=sandbox.window.SDV_TBIN;
class Assets {
 constructor(content,cache,options={}){this.content=fs.realpathSync(content);this.cache=cache;this.portraitModDir=options.portraitModDir;fs.mkdirSync(cache,{recursive:true});this.maps=new Map();this.pending=new Map();}
 file(rel){const file=path.resolve(this.content,rel+'.xnb');if(!file.startsWith(this.content+path.sep))throw new Error('不允许的素材路径');const real=fs.realpathSync(file);if(!real.startsWith(this.content+path.sep))throw new Error('素材路径越界');return real;}
 unpack(rel){const b=fs.readFileSync(this.file(rel));return XNB.bufferToContents(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
 async texture(rel){if(this.pending.has(rel))return this.pending.get(rel);const job=(async()=>{try{const file=this.file(rel);const stat=fs.statSync(file);const key=crypto.createHash('sha256').update(file+':'+stat.size+':'+stat.mtimeMs).digest('hex')+'.png';const dest=path.join(this.cache,key);if(!fs.existsSync(dest)){const r=this.unpack(rel);if(r.type!=='Texture2D')throw new Error('不是纹理');fs.writeFileSync(dest,Buffer.from(await r.content.arrayBuffer()));}const b=fs.readFileSync(dest);return {url:'farm://app/assets/'+key,w:b.readUInt32BE(16),h:b.readUInt32BE(20)};}catch{return null;}})();this.pending.set(rel,job);return job;}
 async map(name){if(this.maps.has(name))return this.maps.get(name);const r=this.unpack('Maps/'+name);const m=TBIN.parseTbin(new Uint8Array(await r.content.arrayBuffer()));const job={id:m.id,properties:m.properties,layers:m.layers.filter(l=>!['Paths','AlwaysFront2'].includes(l.id)).map(l=>({id:l.id,w:l.size.x,h:l.size.y,tiles:l.tiles})),sheets:m.tilesheets};this.maps.set(name,job);return job;}
 async prepare(model){const map=await this.map(model.mapName);const requested=new Set(['LooseSprites/Cursors','TileSheets/crops','TileSheets/Craftables','Maps/springobjects','TerrainFeatures/Flooring','TerrainFeatures/hoeDirt','TerrainFeatures/hoeDirtSnow','TerrainFeatures/grass','Buildings/Mailbox','TerrainFeatures/fruitTrees','TileSheets/fruitTrees','TileSheets/Bushes','TileSheets/resourceClumps']);
 for(const npc of require('./ui/npc-roster.js')){requested.add('Characters/'+npc.asset);requested.add('Portraits/'+npc.asset);}for(const t of model.terrain)if(t.crop?.texture)requested.add(t.crop.texture);
 const season=model.season;
 const sheets=map.sheets.map(t=>{let rel=t.imageSource.replace(/\\/g,'/').replace(/\.png$/i,'');if(!rel.includes('/'))rel='Maps/'+rel;rel=rel.replace(/(spring|summer|fall|winter)_/i,season+'_');requested.add(rel);return {...t,asset:rel};});
 for(const b of model.buildings)requested.add('Buildings/'+(b.type==='Farmhouse'?'houses':b.type));
 for(const t of model.terrain){if(t.type==='Tree'){let rel=treeAsset(t.kind,season);requested.add(rel);}if(t.type==='Flooring'&&season==='winter')requested.add('TerrainFeatures/Flooring_winter');}
 for(const o of model.objects)if(o.fence)requested.add('LooseSprites/Fence'+o.fenceType);
 for(const a of model.animals){requested.add('Animals/'+a.type);if(a.age<5)requested.add('Animals/Baby'+a.type);}
 for(const p of model.pets)requested.add(p.type==='Horse'?'Animals/horse':'Animals/'+(p.petType.toLowerCase()==='dog'?'dog':'cat')+(p.breed||''));
 const images={};for(const rel of requested){const img=await this.texture(rel);if(img)images[rel]=img;}
 const portraitSources={};if(this.portraitModDir){try{const pack=new (require('./portrait-pack.cjs').PortraitPack)(this.portraitModDir,this.cache);for(const npc of require('./ui/npc-roster.js')){try{const portrait=pack.resolve(npc.asset,season);if(portrait){images['Portraits/'+npc.asset]=portrait.image;portraitSources[npc.id]=portrait.source;}}catch{model.warnings.push(npc.zh+'的模组肖像暂不可用，保留游戏肖像');}}}catch{model.warnings.push('肖像模组目录暂不可用，保留游戏肖像');}}
 for(const b of model.buildings)if(!images['Buildings/'+(b.type==='Farmhouse'?'houses':b.type)])model.warnings.push('建筑外观未支持：'+b.type);
 const custom=model.objects.filter(o=>o.index<0).length;if(custom)model.warnings.push(custom+' 个模组物品暂以标记显示');
 if(model.buildings.some(b=>b.skin))model.warnings.push('建筑皮肤使用原版外观');
 let npcAnimations={};try{const b=fs.readFileSync(this.file('Data/animationDescriptions')),data=XNB.bufferToXnb(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).content;for(const p of Object.values(require('./ui/npc-personality.js').profiles)){if(p.animation&&typeof data[p.animation]==='string')npcAnimations[p.animation]=data[p.animation].split('/')[1].trim().split(/\s+/).map(Number).filter(Number.isInteger);}}catch{}
 return {model,map:{...map,sheets},images,npcAnimations,portraitSources};
 }
}
function treeAsset(kind,s){if(kind==='7')return 'TerrainFeatures/mushroom_tree';if(kind==='6')return 'TerrainFeatures/tree_palm';if(kind==='9')return 'TerrainFeatures/tree_palm2';if(kind==='12')return 'TerrainFeatures/mystic_tree';const k=['1','2','3','8'].includes(kind)?kind:'1';return 'TerrainFeatures/tree'+k+'_'+(k==='3'&&s==='summer'?'spring':s);}
module.exports={Assets,treeAsset};
