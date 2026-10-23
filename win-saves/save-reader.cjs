'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {XMLParser, XMLValidator} = require('fast-xml-parser');
const parser = new XMLParser({ignoreAttributes:false, removeNSPrefix:true, parseTagValue:false, parseAttributeValue:false, processEntities:false, trimValues:true});
const arr = v => v == null || v === '' ? [] : Array.isArray(v) ? v : [v];
const num = (v,d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
const yes = v => v === true || v === 'true' || v?.boolean === 'true';
const str = (v,d='') => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : v?.string && typeof v.string==='string' ? v.string : d;
const type = v => str(v?.['@_type']);
const dictionary = v => arr(v?.item);
const at = v => ({x:num(v?.X),y:num(v?.Y)});
const pos = e => at(e.key?.Vector2);
const FARM_MAPS = {'0':['Farm','标准农场'],'1':['Farm_Fishing','河流农场'],'2':['Farm_Foraging','森林农场'],'3':['Farm_Mining','山顶农场'],'4':['Farm_Combat','荒野农场'],'5':['Farm_FourCorners','四角农场'],'6':['Farm_Island','海滩农场'],'MeadowlandsFarm':['Farm_Ranching','草原农场']};
function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持含 DTD 或外部实体的存档');
  const valid = XMLValidator.validate(text); if(valid!==true) throw new Error('存档尚未写完或 XML 无效：'+valid.err.msg);
  return parser.parse(text);
}
function parseSave(text, id, modified) {
  const s = parseXml(text).SaveGame; if(!s?.player) throw new Error('没有找到有效的星露谷存档');
  const farm = arr(s.locations?.GameLocation).find(l=>str(l.name)==='Farm'); if(!farm) throw new Error('存档中没有农场场景');
  const farmType = str(s.whichFarm,'0'); const spec=FARM_MAPS[farmType];
  if(!spec) throw new Error('暂不支持这个自定义农场地图：'+farmType);
  const animals=[];
  function animalList(container,home) { for(const e of dictionary(container)) {
    const a=e.value?.FarmAnimal; if(!a)continue;
    animals.push({id:str(a.myID),name:str(a.name),type:str(a.type),age:num(a.age),speed:num(a.Speed??a.speed,2),home,position:at(a.Position),outside:!home});
  }}
  const buildings=arr(farm.buildings?.Building).map((b,i)=>{
    const out={id:str(b.id,String(i)),type:str(b.buildingType),x:num(b.tileX),y:num(b.tileY),w:num(b.tilesWide,1),h:num(b.tilesHigh,1),construction:num(b.daysOfConstructionLeft),doorOpen:yes(b.animalDoorOpen),skin:str(b.skinId),paint:b.buildingPaintColor};
    animalList(b.indoors?.animals,out.id); return out;
  }); animalList(farm.animals,null);
  const terrain=dictionary(farm.terrainFeatures).map(e=>{
    const t=e.value?.TerrainFeature || {}; const out={...pos(e),type:type(t)};
    if(out.type==='HoeDirt') {out.watered=num(t.state)===1; if(t.crop && !t.crop['@_nil']) { const c=t.crop; out.crop={row:num(c.rowInSpriteSheet),phase:num(c.currentPhase),phaseDays:arr(c.phaseDays?.int).map(Number),day:num(c.dayOfCurrentPhase),fullGrown:yes(c.fullGrown),dead:yes(c.dead),flip:yes(c.flip),colored:yes(c.programColored),color:c.tintColor,forage:yes(c.forageCrop),forageKind:str(c.whichForageCrop),raised:yes(c.raisedSeeds),texture:str(c.overrideTexturePath).replace(/\\/g,'/'),harvest:str(c.indexOfHarvest),seed:str(c.seedIndex),phaseToShow:num(c.phaseToShow,-1)}; }}
    if(out.type==='Tree') Object.assign(out,{kind:str(t.treeType),stage:num(t.growthStage),stump:yes(t.stump),flip:yes(t.flipped),moss:yes(t.hasMoss),health:num(t.health,10)});
    if(out.type==='FruitTree') Object.assign(out,{kind:str(t.treeId||t.treeType),stage:num(t.growthStage),stump:yes(t.stump),flip:yes(t.flipped)});
    if(out.type==='Flooring')out.floor=num(t.whichFloor);
    if(out.type==='Grass') Object.assign(out,{kind:num(t.grassType),weeds:num(t.numberOfWeeds,1),offset:num(t.grassSourceOffset)});
    return out;
  });
  const objects=dictionary(farm.objects).map(e=>{const o=e.value?.Object||{};return {...pos(e),type:type(o),name:str(o.name),id:str(o.itemId),index:num(o.parentSheetIndex,-1),big:yes(o.bigCraftable),ready:yes(o.readyForHarvest),fence:!!o.whichType||type(o)==='Fence',fenceType:num(o.whichType,1),gate:yes(o.isGate),gatePosition:num(o.gatePosition),color:o.color||o.chestColor,flip:yes(o.flipped)};});
  const clumps=arr(farm.resourceClumps?.ResourceClump).map(c=>({...at(c.tile),index:num(c.parentSheetIndex),w:num(c.width,2),h:num(c.height,2)}));
  const pets=arr(farm.characters?.NPC).filter(c=>['Pet','Cat','Dog','Horse'].includes(type(c))).map(c=>({type:type(c),name:str(c.name),breed:num(c.whichBreed),petType:str(c.petType,'Cat'),speed:num(c.Speed??c.speed,2),position:at(c.Position)}));
  return {id,modified,version:str(s.gameVersion),player:str(s.player.name),farmName:str(s.player.farmName),farmType,mapName:spec[0],mapLabel:spec[1],year:num(s.year),day:num(s.dayOfMonth),season:str(s.currentSeason,'spring'),houseUpgrade:num(s.player.houseUpgradeLevel),greenhouse:yes(farm.greenhouseUnlocked),raining:yes(s.isRaining),snowing:yes(s.isSnowing),buildings,animals,terrain,objects,clumps,pets,counts:{buildings:buildings.length,animals:animals.length,objects:objects.length,crops:terrain.filter(t=>t.crop).length,trees:terrain.filter(t=>['Tree','FruitTree'].includes(t.type)).length,paths:terrain.filter(t=>t.type==='Flooring').length},warnings:[]};
}
function savePath(root,id) { if(typeof id!=='string'||path.basename(id)!==id||id==='.'||id==='..')throw new Error('无效的存档编号');const file=path.join(root,id,id);const real=fs.realpathSync(file);if(!real.startsWith(fs.realpathSync(root)+path.sep))throw new Error('存档路径不在允许的文件夹中');return real; }
function loadSave(root,id) { const file=savePath(root,id);const before=fs.statSync(file); if(before.size>100*1024*1024)throw new Error('存档过大，超过 100 MB');const text=fs.readFileSync(file,'utf8');const after=fs.statSync(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('游戏正在保存，请稍后重试');return parseSave(text,id,after.mtime.toISOString()); }
function listSaves(root) { if(!fs.existsSync(root))return [];return fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>{try{const file=savePath(root,d.name);const st=fs.statSync(file);let p={};const info=path.join(path.dirname(file),'SaveGameInfo');if(fs.existsSync(info))p=parseXml(fs.readFileSync(info,'utf8')).Farmer||{};return {id:d.name,player:str(p.name,d.name),farmName:str(p.farmName),modified:st.mtime.toISOString(),date:p.dateStringForSaveGame?str(p.dateStringForSaveGame):''};}catch{return null;}}).filter(Boolean).sort((a,b)=>b.modified.localeCompare(a.modified)); }
module.exports={parseSave,parseXml,loadSave,listSaves,savePath,FARM_MAPS};
