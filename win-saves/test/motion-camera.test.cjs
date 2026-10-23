const test=require('node:test');const assert=require('node:assert/strict');
const {pixelsPerSecond,advanceAnimal,animalPose,cameraView}=require('../ui/motion-camera.js');
test('animal displacement and walking pose agree across 10/15/30/60 fps',()=>{
 const results=[10,15,30,60].map(fps=>{const a={kind:'White Chicken',x:0,y:0,homeX:0,homeY:0,dx:pixelsPerSecond(2),dy:0,dir:1};for(let i=0;i<fps;i++)advanceAnimal(a,1/fps,()=>true);return {x:a.x,pose:animalPose(a)};});
 for(const r of results){assert.ok(Math.abs(r.x-30)<1e-7);assert.deepEqual(r.pose,results[0].pose);}
});
test('idle animals use a resting frame and blocked movement cannot animate in place',()=>{
 const a={kind:'Brown Cow',x:0,y:0,homeX:0,homeY:0,dx:30,dy:0,dir:1,walkDistance:7};
 advanceAnimal(a,.1,()=>false);assert.equal(a.x,0);assert.equal(a.walking,false);assert.equal(animalPose(a).frame,0);
 a.dx=0;advanceAnimal(a,.2,()=>true);assert.equal(animalPose(a).frame,0);
});
test('moving animals stop before crossing an obstacle even at a low frame rate',()=>{
 const a={x:0,y:0,homeX:0,homeY:0,dx:60,dy:0};advanceAnimal(a,.2,x=>x<5);assert.ok(a.x<5);assert.equal(a.dx,0);
});
test('cows and pets use the correct up/down sprite rows',()=>{
 for(const kind of ['Brown Cow','Pet','Horse']){assert.equal(animalPose({kind,dir:2}).row,0);assert.equal(animalPose({kind,dir:0}).row,2);}
 assert.equal(animalPose({kind:'White Chicken',dir:2}).row,0);
});

test('all four walking directions stay out of grazing rows for poultry and livestock',()=>{
 for(const kind of ['White Chicken','Duck','Rabbit','Dinosaur','Brown Cow'])for(let dir=0;dir<4;dir++){
  const p=animalPose({kind,dir,walking:true,walkDistance:17});assert.ok(p.row<4);
  if(kind==='Dinosaur'&&dir===3){assert.equal(p.row,1);assert.equal(p.flip,true);}
 }
});

test('grazing plays the game eating frames rather than the walking cycle',()=>{
 for(const [kind,row]of [['White Chicken',6],['Duck',6],['Dinosaur',5],['Brown Cow',4]]){
  for(let frame=0;frame<4;frame++)assert.deepEqual(animalPose({kind,dir:3,grazing:frame*.1+.01}),{row,frame,flip:false});
  assert.equal(animalPose({kind,dir:2,grazing:null}).row,0);
 }
 assert.equal(animalPose({kind:'Horse',dir:2,grazing:0}).row,0);
});
test('desktop fills landscape, ultrawide and portrait screens with either farm map',()=>{
 for(const [width,height] of [[1920,1080],[2560,1440],[3440,1440],[1080,1920],[3840,2160]])for(const [mw,mh] of [[1600,1200],[1280,1040]])for(const zoom of [.5,1,1.8])for(const center of [-1000,0,2000]){
  const c=cameraView(width,height,mw,mh,{x:center,y:center,zoom,view:'full'},{desktop:true,offsetX:90,offsetY:70});
  assert.ok(c.x>=-1e-8&&c.y>=-1e-8);assert.ok(c.x+c.viewWidth<=mw+1e-8&&c.y+c.viewHeight<=mh+1e-8);
  assert.ok(mw*c.scale>=width-1e-8&&mh*c.scale>=height-1e-8);
 }
});
test('full-map preview still fits the complete map',()=>{
 const c=cameraView(1200,800,1280,1040,{x:640,y:520,zoom:1,view:'full'});
 assert.ok(c.viewWidth>=1280&&c.viewHeight>=1040);assert.equal(c.fill,false);
});
