/* Rectangles/anchors checked against the locally installed 1.6 game renderer. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FarmSprites=api;})(globalThis,()=>{
 function crop(c,x,y,season){const number=x*7+y*11;let row=c.row;if(c.harvest==='771')row+=season==='fall'?1:season==='winter'?2:0;
  if(c.dead)return {sx:192+number%4*16,sy:384,w:16,h:32};
  const phase=c.phaseToShow>=0?c.phaseToShow:c.phase,frame=c.fullGrown?(c.day<=0?6:7):phase+1-(phase===0&&number%2===0?1:0);
  return {sx:Math.min(240,(row%2)*128+frame*16),sy:Math.floor(row/2)*32,w:16,h:32};
 }
 function grass(kind,season){const s=['spring','summer','fall','winter'].indexOf(season);return kind===1?[0,20,40,80][s]:kind===7?[160,180,200,220][s]:({2:60,3:80,4:100})[kind]??(kind+1)*20;}
 function tree(t){if(t.stage<5){const r=t.stage===0?[32,128,16,16]:t.stage===1?[0,128,16,16]:t.stage===2?[16,128,16,16]:[0,96,16,32];return [{rect:r,dx:0,dy:16-r[3]}];}
  const moss=t.moss?96:0,out=[{rect:[32+moss,96,16,32],dx:0,dy:-16}];if(!t.stump)out.push({rect:[moss,0,48,96],dx:-16,dy:-80});return out;
 }
 const dirtGuide=[0,12,13,9,4,8,1,5,15,11,14,10,3,7,2,6];
 function dirt(mask,wetMask){const dry=dirtGuide[mask],out=[[dry%4*16,Math.floor(dry/4)*16,16,16]];if(wetMask!==null){const wet=dirtGuide[wetMask];out.push([64+wet%4*16,Math.floor(wet/4)*16,16,16]);}return out;}
 return {crop,grass,tree,dirt};
});
