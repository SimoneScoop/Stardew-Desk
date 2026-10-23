const test=require('node:test'),assert=require('node:assert/strict');
const {crop,grass,tree,dirt}=require('../ui/sprite-layout.js');
const {advanceAnimal,animalPose}=require('../ui/motion-camera.js');
test('horse directions follow actual displacement and never use grazing as a walk row',()=>{
 for(const [dx,dy,dir,row,flip] of [[30,0,1,1,false],[-30,0,3,1,true],[0,-30,0,2,false],[0,30,2,0,false]]){
  const a={kind:'Horse',x:0,y:0,homeX:0,homeY:0,dx,dy,dir:(dir+2)%4};advanceAnimal(a,.1,()=>true);assert.equal(a.dir,dir);assert.deepEqual(animalPose(a),{frame:1,row,flip});
  for(let i=0;i<30;i++){advanceAnimal(a,.05,()=>true);assert.ok(animalPose(a).frame>=1&&animalPose(a).frame<=6);}
 }
});
test('wild seed display phases, seed variants, regrowth and dead crops use the game rectangles',()=>{
 const c={row:3,phase:2,phaseToShow:-1,fullGrown:false};assert.equal(crop(c,2,4,'fall').sx,176);
 assert.equal(crop({...c,phaseToShow:5},2,4,'fall').sx,224);
 assert.equal(crop({...c,phase:0},2,4,'fall').sx,128);
 assert.equal(crop({...c,fullGrown:true,day:3},2,4,'fall').sx,240);
 assert.deepEqual(crop({...c,dead:true},2,4,'fall'),{sx:224,sy:384,w:16,h:32});
});
test('moss and mushroom tree parts stay on their own atlas cells; seasonal grass uses complete bands',()=>{
 assert.deepEqual(tree({stage:5,moss:true,stump:false}).map(p=>p.rect),[[128,96,16,32],[96,0,48,96]]);
 assert.equal(tree({stage:5,stump:true}).length,1);
 assert.equal(tree({stage:3,kind:'7'})[0].rect[3],32);
 assert.equal(grass(1,'fall'),40);assert.equal(grass(7,'fall'),200);assert.equal(grass(7,'winter'),220);
});
test('isolated dirt and partly watered plots select separate dry and wet borders',()=>{
 assert.deepEqual(dirt(0,null),[[0,0,16,16]]);
 assert.deepEqual(dirt(15,0),[[32,16,16,16],[64,0,16,16]]);
 assert.deepEqual(dirt(15,15),[[32,16,16,16],[96,16,16,16]]);
});
