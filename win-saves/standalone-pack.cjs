'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FORMAT='stardew-desk-assets',VERSION=1;
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const allowed=p=>p==='scene/farm.json'||p==='font/info.json'||/^scene\/img\/[\w-]+\.png$/.test(p)||/^font\/(?:font-)?[a-f\d-]+\.(png|ttf)$/.test(p)||/^music\/[a-z\d_]+\.wav$/.test(p);
function sceneData(data){
 if(!data||!Array.isArray(data.images)||!data.images.length||data.images.some(n=>typeof n!=='string'||!/^\w[\w-]*$/.test(n))||!Array.isArray(data.map?.layers)||!data.map.layers.length)throw Error('素材包地图无效');
 for(const l of data.map.layers)if(!Number.isInteger(l.w)||!Number.isInteger(l.h)||l.w<1||l.h<1||l.w>512||l.h>512||!Array.isArray(l.tiles)||l.tiles.length!==l.h)throw Error('素材包地图尺寸无效');
 return data;
}
class AssetPack{
 constructor(root){
  this.root=fs.realpathSync(root);const file=path.join(this.root,'manifest.json');if(fs.statSync(file).size>1024*1024)throw Error('素材包清单过大');
  const m=JSON.parse(fs.readFileSync(file,'utf8'));if(m.format!==FORMAT||m.version!==VERSION||!Array.isArray(m.files)||m.files.length<4||m.files.length>1000)throw Error('不支持的独立素材包');
  const seen=new Set();let total=0;
  for(const e of m.files){if(!allowed(e.path)||seen.has(e.path)||!Number.isSafeInteger(e.size)||e.size<1||e.size>128*1024*1024||!/^[a-f\d]{64}$/.test(e.sha256))throw Error('素材包文件清单无效');seen.add(e.path);total+=e.size;if(total>1024*1024*1024)throw Error('素材包过大');const b=fs.readFileSync(this.file(e.path));if(b.length!==e.size||digest(b)!==e.sha256)throw Error('素材包文件不完整：'+e.path);}
  this.manifest=m;this.entries=seen;this.id=digest(Buffer.from(JSON.stringify(m)));
  if(!seen.has('scene/farm.json')||!seen.has('font/info.json'))throw Error('素材包缺少地图或字体');
  this.scene=sceneData(JSON.parse(fs.readFileSync(this.file('scene/farm.json'),'utf8')));
  for(const n of this.scene.images)if(!seen.has('scene/img/'+n+'.png'))throw Error('素材包缺少贴图：'+n);
  this.fontInfo=JSON.parse(fs.readFileSync(this.file('font/info.json'),'utf8'));
  const f=this.fontInfo;if(!Array.isArray(f.pages)||!f.pages.length||!Array.isArray(f.chars)||!f.chars.length||!Number.isFinite(f.size)||f.size<1||!seen.has('font/'+f.ttf))throw Error('素材包字体无效');
  for(const page of f.pages)if(!/^[a-f\d]{64}\.png$/.test(page.file)||!seen.has('font/'+page.file))throw Error('素材包字库页缺失');
 }
 file(rel){if(!allowed(rel))throw Error('素材包路径无效');const p=fs.realpathSync(path.resolve(this.root,rel));if(!p.startsWith(this.root+path.sep))throw Error('素材包路径越界');return p;}
 font(){const {ttf,...info}=this.fontInfo;return {file:this.file('font/'+ttf),cache:path.join(this.root,'font'),info:{...info,url:'farm://app/game-font.ttf',pages:info.pages.map(({file,...p})=>({...p,url:'farm://app/assets/'+file}))}};}
 install(support){
  const scene=path.join(support,'scene/data'),music=path.join(support,'music');fs.mkdirSync(path.join(scene,'img'),{recursive:true});fs.mkdirSync(music,{recursive:true});
  const stamp=path.join(scene,'standalone-id.txt');if(fs.existsSync(stamp)&&fs.readFileSync(stamp,'utf8')===this.id&&this.scene.images.every(n=>fs.existsSync(path.join(scene,'img',n+'.png')))&&fs.existsSync(path.join(scene,'farm.js')))return;
  for(const e of this.manifest.files){if(e.path.startsWith('scene/img/'))fs.copyFileSync(this.file(e.path),path.join(scene,'img',path.basename(e.path)));if(e.path.startsWith('music/'))fs.copyFileSync(this.file(e.path),path.join(music,path.basename(e.path)));}
  fs.writeFileSync(path.join(scene,'farm.js'),'window.SDV_DATA = '+JSON.stringify(this.scene)+';\n');fs.writeFileSync(path.join(scene,'version.txt'),String(this.scene.version||7));fs.writeFileSync(stamp,this.id);
 }
 exportTo(destination){if(fs.existsSync(destination))throw Error('目标文件夹已存在，请选择新位置');fs.mkdirSync(destination,{recursive:true});for(const e of this.manifest.files){const dst=path.join(destination,e.path);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(this.file(e.path),dst);}fs.copyFileSync(path.join(this.root,'manifest.json'),path.join(destination,'manifest.json'));return destination;}
 static build({sceneFile,imageDir,font,musicDir,destination}){
  const raw=fs.readFileSync(sceneFile,'utf8').trim(),prefix='window.SDV_DATA = ';if(!raw.startsWith(prefix)||!raw.endsWith(';'))throw Error('缓存地图格式无效');const scene=sceneData(JSON.parse(raw.slice(prefix.length,-1)));
  if(fs.existsSync(destination))throw Error('目标素材包已存在');fs.mkdirSync(destination,{recursive:true});
  const files=[];function put(rel,bytes){if(!allowed(rel))throw Error('不支持的素材路径');const dst=path.join(destination,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,bytes);files.push({path:rel,size:bytes.length,sha256:digest(bytes)});}
  put('scene/farm.json',Buffer.from(JSON.stringify(scene)));for(const n of scene.images)put('scene/img/'+n+'.png',fs.readFileSync(path.join(imageDir,n+'.png')));
  const ttf=path.basename(font.file),pages=font.info.pages.map(p=>{const file=path.basename(p.url);put('font/'+file,fs.readFileSync(path.join(font.cache,file)));const {url,...rest}=p;return {...rest,file};});const {url,...info}=font.info;
  put('font/'+ttf,fs.readFileSync(font.file));put('font/info.json',Buffer.from(JSON.stringify({...info,pages,ttf})));
  if(musicDir&&fs.existsSync(musicDir))for(const name of fs.readdirSync(musicDir).filter(n=>/^[a-z\d_]+\.wav$/.test(n)))put('music/'+name,fs.readFileSync(path.join(musicDir,name)));
  const manifest={format:FORMAT,version:VERSION,name:'Stardew Desk 独立素材包',files:files.sort((a,b)=>a.path.localeCompare(b.path))};fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2));return new AssetPack(destination);
 }
}
module.exports={AssetPack};

