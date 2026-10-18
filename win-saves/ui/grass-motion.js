/* Grass anchors, blade depths and collision shake follow the local game renderer. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FarmGrass=api;})(globalThis,function(){
 'use strict';
 const key=(x,y)=>x+','+y;
 function create(terrain,season,sourceY){
  const tiles=new Map(),active=new Set();let contacts=new Map();
  for(const t of terrain.filter(t=>t.type==='Grass')){
   let seed=(t.x*73856093^t.y*19349663^Number(t.kind)*83492791)>>>0;
   const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   const blades=[];for(let i=0;i<Math.min(Math.max(t.weeds,0),4);i++){
    const sx=Math.floor(random()*3)*15,jx=Math.floor(random()*5)-2,jy=Math.floor(random()*5)-2;
    const x=t.x*16+i%2*8+jx+6.5,y=t.y*16+Math.floor(i/2)*8+jy+10;
    blades.push({sx,sy:sourceY(t.kind,season),x,y,z:y-1+x/10000,flip:random()<.5,divisor:1+random()});
   }
   tiles.set(key(t.x,t.y),{x:t.x,y:t.y,blades,rotation:0,max:0,rate:Math.PI/80,left:false});
  }
  function update(dt,actors){
   const nextContacts=new Map();
   for(const a of actors){if(!a.walking&&!a.moving)continue;const footY=a.y+(a.kind?8:0);
    const actor=a.id||a,touching=new Set();nextContacts.set(actor,touching);
    for(let y=Math.floor((footY-6)/16);y<=Math.floor((footY+6)/16);y++)for(let x=Math.floor((a.x-6)/16);x<=Math.floor((a.x+6)/16);x++){
     const tileKey=key(x,y),t=tiles.get(tileKey);if(!t?.blades.length)continue;touching.add(tileKey);
     // Staying in one tile must not restart the bend each time its timer expires.
     if(contacts.get(actor)?.has(tileKey)||t.max>0)continue;
     t.max=Math.PI/8;t.rotation=0;t.left=a.x>x*16+8;active.add(t);
    }
   }
   contacts=nextContacts;
   const ticks=Math.max(0,Math.min(dt,.2))*60,steps=Math.max(1,Math.ceil(ticks)),step=ticks/steps;
   for(const t of active){for(let i=0;i<steps;i++){
    if(t.max>0){t.rotation+=(t.left?-1:1)*t.rate*step;
     // Reverse at the boundary in the direction of travel. An absolute-value
     // check flips back prematurely while returning from the opposite boundary.
     if(t.left?t.rotation<=-t.max:t.rotation>=t.max)t.left=!t.left;
     t.max=Math.max(0,t.max-Math.PI/350*step);}
    else t.rotation*=Math.pow(.5,step);
   }if(t.max===0&&Math.abs(t.rotation)<.01){t.rotation=0;active.delete(t);}}
  }
  let cachedImage=null,cachedSprites=[];
  function sprites(image,frames){if(!image)return [];if(cachedImage===image)return cachedSprites;const out=[];
   for(const t of tiles.values())for(const b of t.blades)out.push({x:b.x-20,y:b.y-24,sw:40,sh:40,z:b.z,label:'草丛',draw(g){g.save();g.translate(b.x,b.y);g.rotate(t.rotation/b.divisor);frames.draw(g,image,b.sx,b.sy,15,20,-7.5,-17.5,b.flip,false);g.restore();}});
   cachedImage=image;cachedSprites=out;return out;
  }
  return {update,sprites,has:(x,y)=>!!tiles.get(key(Math.floor(x/16),Math.floor(y/16)))?.blades.length,tiles:()=>[...tiles.values()],count:tiles.size};
 }
 return {create};
});

