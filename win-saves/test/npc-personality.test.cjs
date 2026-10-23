const test=require('node:test'),assert=require('node:assert/strict');
const {profiles,gifts,dialogue}=require('../ui/npc-personality.js'),roster=require('../ui/npc-roster.js');
test('all fourteen visitors have distinct lines, a gift preference and a contextual warm response',()=>{
 const intros=new Set();for(const n of roster){const p=profiles[n.id];assert.ok(p&&p.talk.length>=3&&p.rain&&p.warm&&p.bye&&p.activity);assert.ok(Object.hasOwn(gifts,p.favorite));intros.add(dialogue(n.id,'greet'));assert.equal(dialogue(n.id,'greet',{points:1200}),p.warm);assert.equal(dialogue(n.id,'talk',{weather:'rain',index:0}),p.rain);assert.equal(dialogue(n.id,'bye'),p.bye);}assert.equal(intros.size,14);assert.match(dialogue('shane','greet'),/没打算待很久/);assert.match(dialogue('sam','activity'),/吉他/);assert.match(dialogue('penny','activity'),/书/);
});
