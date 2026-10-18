'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Assets}=require('../assets.cjs'),{AssetPack}=require('../standalone-pack.cjs');
const option=name=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
async function main(){
 const content=option('--content'),destination=option('--output');
 if(!content||!destination)throw Error('Usage: npm run pack:assets -- --content="C:/game/Content" --output="C:/LocalAssets/NewPack" [--scene-cache="C:/cache/scene/data"]');
 if(!process.env.APPDATA)throw Error('This exporter requires the Windows APPDATA directory.');
 const support=path.join(process.env.APPDATA,'Stardew Desk Saves');
 const scene=option('--scene-cache')||path.join(support,'original/scene/data');
 if(!fs.existsSync(path.join(scene,'farm.js'))||!fs.existsSync(path.join(scene,'img')))throw Error('Open the original scene in save mode first, or specify --scene-cache containing farm.js and img/.');
 if(fs.existsSync(destination))throw Error('Output directory already exists; choose a new directory.');
 const assets=new Assets(content,path.join(support,'assets'));
 const font=await require('../game-font.cjs').prepare(assets),music=path.join(support,'original/music');
 const bank=path.join(content,'XACT/Wave Bank.xwb');
 if(fs.existsSync(bank))require('../legacy/wavebank.js').extract(bank,music,[['spring1',93],['spring2',91],['spring3',92],['summer1',122],['summer2',123],['summer3',115],['fall1',121],['fall2',119],['fall3',120],['winter1',126],['winter2',124],['winter3',125],['sfx_tick',5],['sfx_offwork',326]],console.log);
 const pack=AssetPack.build({sceneFile:path.join(scene,'farm.js'),imageDir:path.join(scene,'img'),font:{...font,cache:assets.cache},musicDir:music,destination:path.resolve(destination)});
 console.log('Exported local asset pack: '+pack.root+' ('+pack.manifest.files.length+' files). Keep this pack outside the repository.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
