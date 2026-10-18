/* Shared renderer math; no game files or desktop APIs are accessed here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FarmMotion=api;})(globalThis,function(){
  'use strict';
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  // Save positions/speeds use 64px game tiles; our textures use 16px tiles.
  // Convert a normal 60Hz game movement tick into texture pixels per second.
  function pixelsPerSecond(speed=2){return clamp(Number.isFinite(Number(speed))?Number(speed):2,0,12)*60/4;}
  function advanceAnimal(a,dt,canWalk){
    let distance=0;const startX=a.x,startY=a.y;
    const vx=a.dx||0,vy=a.dy||0,total=Math.hypot(vx,vy)*Math.max(0,dt);
    const steps=Math.max(1,Math.ceil(total/2));
    for(let i=0;i<steps&&total>0;i++){
      const x=a.x+vx*dt/steps,y=a.y+vy*dt/steps;
      if(!canWalk(x,y)||Math.hypot(x-a.homeX,y-a.homeY)>(a.roamRadius||96)){a.dx=a.dy=0;break;}
      distance+=Math.hypot(x-a.x,y-a.y);a.x=x;a.y=y;
    }
    a.walking=distance>1e-6;
    if(a.walking){const dx=a.x-startX,dy=a.y-startY;a.dir=Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?2:0);}
    a.walkDistance=a.walking?(a.walkDistance||0)+distance:0;
    return distance;
  }
  function animalPose(a){
    const small=/Chicken|Duck|Rabbit|Dinosaur/i.test(a.kind);
    const pet=['Pet','Cat','Dog'].includes(a.kind);
    // Roughly one ground tile per walk cycle for birds, a longer stride for livestock.
    const stride=small?4.5:pet?4:6;
    const frame=a.walking?(a.kind==='Horse'?1+Math.floor((a.walkDistance||0)/stride)%6:Math.floor((a.walkDistance||0)/stride)%4):0;
    let row,flip=false;
    // The simulation uses 0=up, 1=right, 2=down, 3=left.
    if(small){const flipped=a.kind==='Dinosaur';row=({0:2,1:1,2:0,3:flipped?1:3})[a.dir];flip=flipped&&a.dir===3;}
    // Horse has seven columns: idle + six strides. Row 3 is a grazing pose.
    else if(a.kind==='Horse'){row=({0:2,1:1,2:0,3:1})[a.dir];flip=a.dir===3;}
    else if(pet)row=({0:2,1:1,2:0,3:3})[a.dir];
    else {row=({0:2,1:1,2:0,3:1})[a.dir];flip=a.dir===3;}
    if(a.grazing!=null&&!pet&&a.kind!=='Horse'){const base=small?(a.kind==='Dinosaur'?5:6):4;return {frame:Math.min(3,Math.floor(a.grazing/.1)),row:base,flip:false};}
    return {frame,row,flip};
  }
  function cameraView(width,height,mapWidth,mapHeight,camera,options={}){
    const cover=Math.max(width/mapWidth,height/mapHeight);
    const contain=Math.min(width/mapWidth,height/mapHeight);
    const fill=options.desktop||camera.view!=='full';
    const requested=Number.isFinite(camera.zoom)?camera.zoom:1;
    const scale=(fill?cover:contain)*Math.max(fill?1:.5,requested);
    const viewWidth=width/scale,viewHeight=height/scale;
    const centerX=(Number.isFinite(camera.x)?camera.x:mapWidth/2)+(options.offsetX||0);
    const centerY=(Number.isFinite(camera.y)?camera.y:mapHeight/2)+(options.offsetY||0);
    const x=viewWidth>=mapWidth?(mapWidth-viewWidth)/2:clamp(centerX-viewWidth/2,0,mapWidth-viewWidth);
    const y=viewHeight>=mapHeight?(mapHeight-viewHeight)/2:clamp(centerY-viewHeight/2,0,mapHeight-viewHeight);
    return {scale,x,y,viewWidth,viewHeight,fill};
  }
  return {pixelsPerSecond,advanceAnimal,animalPose,cameraView};
});
