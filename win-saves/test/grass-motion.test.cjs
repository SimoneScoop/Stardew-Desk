const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../ui/grass-motion.js'),{grass}=require('../ui/sprite-layout.js');
const patch=()=>create([{type:'Grass',x:5,y:5,weeds:4,kind:1}],'fall',grass);
test('grass has separate foreground/background blades instead of a flat ground layer',()=>{
 const p=patch(),blades=p.tiles()[0].blades;assert.equal(blades.length,4);
 const middle=5*16+14;assert.ok(blades.some(b=>b.z<middle));assert.ok(blades.some(b=>b.z>middle));
 assert.ok(blades.every(b=>b.sy===40));assert.equal(p.has(88,88),true);assert.equal(p.has(40,40),false);
});
test('walking through grass bends it locally, then it settles without continued contact',()=>{
 const p=patch(),t=p.tiles()[0];p.update(.1,[{x:88,y:86,walking:false}]);assert.equal(t.rotation,0);
 p.update(.1,[{x:88,y:86,walking:true}]);assert.notEqual(t.rotation,0);assert.ok(Math.abs(t.rotation)<.5);
 for(let i=0;i<30;i++)p.update(.1,[]);assert.equal(t.rotation,0);assert.equal(t.max,0);
 const far=patch();far.update(.1,[{x:200,y:200,moving:true}]);assert.equal(far.tiles()[0].rotation,0);
});
test('NPC movement also disturbs grass and a reload resets transient animation',()=>{
 const p=patch();p.update(.1,[{x:88,y:86,moving:true}]);assert.notEqual(p.tiles()[0].rotation,0);assert.equal(patch().tiles()[0].rotation,0);
});

test('a sustained contact settles once and a later reentry can bend the grass again',()=>{
 const p=patch(),animal={id:'cow-1',kind:'Brown Cow',x:88,y:80,walking:true};
 p.update(.1,[animal]);assert.notEqual(p.tiles()[0].rotation,0);
 for(let i=0;i<30;i++)p.update(.1,[animal]);assert.equal(p.tiles()[0].rotation,0);
 p.update(.1,[]);p.update(.1,[animal]);assert.notEqual(p.tiles()[0].rotation,0);
});

test('the return swing crosses the neutral position without alternating at one edge',()=>{
 const p=patch(),values=[];p.update(1/60,[{x:88,y:86,moving:true}]);
 for(let i=0;i<35;i++){p.update(1/60,[]);values.push(p.tiles()[0].rotation);}
 assert.ok(values.some(v=>v<-.15));assert.ok(values.some(v=>v>.1));
});
