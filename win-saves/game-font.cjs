'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {XMLParser}=require('fast-xml-parser'),{PNG}=require('pngjs'),opentype=require('opentype.js');
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:''});
async function prepare(assets){if(assets.gameFontPromise)return assets.gameFontPromise;assets.gameFontPromise=(async()=>{
 const fnt=path.join(assets.content,'Fonts','Chinese.fnt'),xml=fs.readFileSync(fnt,'utf8'),data=parser.parse(xml).font,pages=Array.isArray(data.pages.page)?data.pages.page:[data.pages.page],chars=Array.isArray(data.chars.char)?data.chars.char:[data.chars.char],pageInfo=[],pagePixels=[];
 for(const page of pages){const rel='Fonts/'+String(page.file).replace(/\.png$/i,''),image=await assets.texture(rel);if(!image)throw Error('游戏中文字库页缺失：'+rel);pageInfo[page.id]=image;pagePixels[page.id]=path.join(assets.cache,path.basename(image.url));}
 const advances=chars.filter(c=>+c.id>=0x4e00&&+c.id<=0x9fff).map(c=>+c.xadvance).sort((a,b)=>a-b),em=advances[Math.floor(advances.length/2)]||Number(data.info.size);
 const key=crypto.createHash('sha256').update('bm-outline-v2:'+xml+JSON.stringify(pageInfo)).digest('hex'),file=path.join(assets.cache,'font-'+key+'.ttf');
 if(!fs.existsSync(file)){
  const sheets=pagePixels.map(p=>PNG.sync.read(fs.readFileSync(p))),scale=32,base=Number(data.common.base),glyphs=[new opentype.Glyph({name:'.notdef',advanceWidth:512,path:new opentype.Path()})];
  for(const char of chars){const unicode=Number(char.id);if(unicode<32&&unicode!==9)continue;const p=new opentype.Path(),sheet=sheets[char.page];for(let y=0;y<Number(char.height);y++){let start=-1;for(let x=0;x<=Number(char.width);x++){const opaque=x<Number(char.width)&&sheet.data[((Number(char.y)+y)*sheet.width+Number(char.x)+x)*4+3]>=96;if(opaque&&start<0)start=x;if(!opaque&&start>=0){const x1=(Number(char.xoffset)+start)*scale,x2=(Number(char.xoffset)+x)*scale,top=(base-Number(char.yoffset)-y)*scale,bottom=top-scale;p.moveTo(x1,bottom);p.lineTo(x1,top);p.lineTo(x2,top);p.lineTo(x2,bottom);p.close();start=-1;}}}
   glyphs.push(new opentype.Glyph({name:'uni'+unicode.toString(16).toUpperCase(),unicode,advanceWidth:Math.max(0,Number(char.xadvance))*scale,path:p}));
  }
  const font=new opentype.Font({familyName:'StardewGame',styleName:'Regular',unitsPerEm:em*scale,ascender:base*scale,descender:-(Number(data.common.lineHeight)-base)*scale,glyphs});fs.writeFileSync(file+'.tmp',Buffer.from(font.toArrayBuffer()));fs.renameSync(file+'.tmp',file);
 }
 return {file,info:{face:data.info.face,size:em,base:Number(data.common.base),lineHeight:Number(data.common.lineHeight),pages:pageInfo,chars:chars.map(c=>[+c.id,+c.x,+c.y,+c.width,+c.height,+c.xoffset,+c.yoffset,+c.xadvance,+c.page]),url:'farm://app/game-font.ttf'}};
})();return assets.gameFontPromise;}
module.exports={prepare};
