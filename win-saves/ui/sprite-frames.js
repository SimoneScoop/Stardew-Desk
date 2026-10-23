/* Isolate atlas frames before camera scaling so neighbouring rows cannot bleed in. */
(function(root){
 'use strict';
 const images=new WeakMap();
 function frame(image,sx,sy,w,h){
  if(!image||sx<0||sy<0||w<1||h<1||sx+w>image.width||sy+h>image.height)return null;
  let cache=images.get(image);if(!cache){cache=new Map();images.set(image,cache);}
  const key=[sx,sy,w,h].join(',');if(cache.has(key))return cache.get(key);
  const canvas=document.createElement('canvas');canvas.width=w+4;canvas.height=h+4;
  const g=canvas.getContext('2d');g.imageSmoothingEnabled=false;
  // Copy at integer coordinates and native resolution, with a transparent gutter.
  g.drawImage(image,sx,sy,w,h,2,2,w,h);cache.set(key,canvas);return canvas;
 }
 function draw(g,image,sx,sy,w,h,x,y,flip=false,snap=true){
  const isolated=frame(image,sx,sy,w,h);if(!isolated)return;
  g.save();g.imageSmoothingEnabled=false;g.translate((snap?Math.round(x):x)+(flip?w:0),snap?Math.round(y):y);
  if(flip)g.scale(-1,1);g.drawImage(isolated,-2,-2);g.restore();
 }
 root.SpriteFrames={frame,draw};
})(globalThis);
