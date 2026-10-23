const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Navigation=require('../ui/npc-navigation.js');
function scene({west=false,blocked=false}={}){let obstructed=blocked;const ctx={window:{FarmNPCs:require('../ui/npc-roster.js'),FarmNPCPersonality:require('../ui/npc-personality.js'),FarmNPCNavigation:Navigation},SDV:{layout:{isSolid:(x,y)=>x===10||obstructed&&y===2},decor:{objectAt:()=>false,fieldRects:()=>[],treeList:()=>[]},paths:{isPath:(x,y)=>x===6},interact:{cursor:{on:true,x:130,y:140,lastMove:999}}}};ctx.window.SDV=ctx.SDV;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ui/npc-visitors.js'),'utf8'),ctx);const n=ctx.SDV.villagers;n.init({farm:'A',width:30,height:25,props:{house:{x:32,y:32,src:[0,0,64,48]}},exits:[{side:'north',entry:[6,0],target:[6,1]},...(west?[{side:'west',entry:[0,8],target:[1,8]}]:[])],edgePassable:()=>true,animations:{abigail_flute:[16,17,18,19]}},16);return {n,ctx,unblock:()=>obstructed=false};}
const tick=(n,count)=>{for(let i=0;i<count;i++)n.update(.1,i*.1,{weather:'storm',season:'fall'});};
test('three visitor slots, cursor following and a farm reload retain their behavior',()=>{
 const {n,ctx}=scene();assert.equal(n.visit('abigail'),true);n.visit('robin');n.visit('sam');assert.equal(n.visit('harvey'),false);assert.equal(n.list().length,3);n.act('follow','abigail');const x=n.current().x;tick(n,15);assert.ok(n.current().x>x);ctx.SDV.interact.cursor.x=400;tick(n,25);assert.ok(n.current().x<160);n.init({width:30,height:25,props:{}},16);assert.equal(n.list().length,0);
});
test('goodbye keeps a visible walker until it reaches a north or west exit',()=>{
 for(const west of [false,true]){const {n}=scene({west});n.visit('abigail');const before=n.current();assert.equal(n.act('bye','abigail'),true);assert.equal(n.list().length,1);assert.equal(n.list()[0].phase,'leaving');assert.equal(n.list()[0].exit,west?'west':'north');tick(n,10);assert.equal(n.list().length,1);assert.ok(Math.hypot(n.list()[0].x-before.x,n.list()[0].y-before.y)>0);tick(n,150);assert.equal(n.list().length,0);}
});
test('blocked exits wait and retry instead of teleporting or crossing the obstruction',()=>{
 const {n,unblock}=scene({blocked:true});n.visit('abigail');n.act('bye');assert.equal(n.list()[0].phase,'exit-wait');const start=n.list()[0];tick(n,100);assert.equal(n.list()[0].y,start.y);unblock();tick(n,210);assert.equal(n.list().length,0);
});
test('a chosen hobby uses nonwalking game frames, and hopping returns to ground level',()=>{
 const {n}=scene();n.visit('abigail');n.act('action-hobby');assert.equal(n.current().action,'hobby');tick(n,3);assert.equal(n.current().moving,false);const fake={v:{id:'abigail'},dir:0,moving:false,action:{kind:'hobby',t:.3,duration:8,frames:[16,17,18,19]}};assert.ok(n.pose(fake,{height:448}).frame>=16);n.act('action-hop');assert.equal(n.current().action,'hop');tick(n,20);assert.equal(n.current().action,null);assert.equal(n.act('action-look'),false);n.visit('robin');assert.equal(n.act('action-hobby'),false);assert.equal(n.current().action,null);
});
test('route prefers a longer connected path and only accepts real north/west map warps',()=>{
 const path=Navigation.route([1,3],[7,3],{width:10,height:7,passable:()=>true,cost:(x,y)=>y===2||x===1||x===7?.1:1});assert.ok(path.some(p=>p[1]===2));
 const exits=Navigation.exits({Warp:'63 -1 Backwoods 1 1 -1 20 Backwoods 1 1 100 20 Bus 1 1'},100,75);assert.equal(exits.length,2);assert.deepEqual(exits.map(e=>e.side),['north','west']);
});
