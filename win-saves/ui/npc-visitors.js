/* Desktop visitors: personality, local friendship, real sprite activities and routed exits. */
window.SDV=window.SDV||{};
SDV.villagers=(()=>{
 'use strict';
 const roster=window.FarmNPCs,P=window.FarmNPCPersonality,Nav=window.FarmNPCNavigation;
 let cfg=null,TILE=16,walkers=[],timer=25,selected=null,line='',lineAge=0,buttons=[],panel=null,menu='',context={},relations={},notice='',noticeTime=0;
 const random=(a,b)=>a+Math.random()*(b-a),pick=a=>a[Math.floor(Math.random()*a.length)],tileOf=w=>[Math.floor(w.x/TILE),Math.floor((w.y-4)/TILE)];
 const departing=w=>['leaving','exiting','exit-wait'].includes(w.phase);
 const profile=id=>P.profiles[id],points=id=>relations[id]?.points||0;
 function say(text){line=text;lineAge=0;}
 function notify(text){notice=text;noticeTime=5;}
 function setFriendship(state){relations=state?.relationships||{};}
 function init(config,tile){cfg=config;TILE=tile;walkers=[];timer=25;selected=null;line='';buttons=[];panel=null;menu='';notice='';setFriendship(config.friendship);}
 function walkable(x,y){return x>=1&&y>=1&&x<cfg.width-1&&y<cfg.height-1&&!SDV.layout.isSolid(x,y)&&!SDV.decor.objectAt(x,y)&&!SDV.decor.fieldRects().some(f=>x>=f.x&&x<f.x+f.w&&y>=f.y&&y<f.y+f.h)&&!SDV.decor.treeList().some(t=>t.x===x&&t.y===y);}
 function near(x,y,radius=10){x=Math.floor(x);y=Math.floor(y);for(let r=0;r<=radius;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(Math.max(Math.abs(dx),Math.abs(dy))===r&&walkable(x+dx,y+dy))return [x+dx,y+dy];return null;}
 function route(from,to){return Nav.route(from,to,{width:cfg.width,height:cfg.height,passable:walkable,cost:(x,y)=>SDV.paths.isPath?.(x,y) ? .55 : 1});}
 function pathTo(w,target,phase){const path=target&&route(tileOf(w),target);if(!path)return false;w.path=path;w.i=0;w.phase=phase;return true;}
 function home(){const h=cfg.props.house;return near(h?h.x/TILE+h.src[2]/TILE/2:cfg.width/2,h?(h.y+h.src[3])/TILE+3:cfg.height/2);}
 function wander(w){w.action=null;const [x,y]=tileOf(w);for(let i=0;i<12;i++){const target=near(x+Math.round(random(-9,9)),y+Math.round(random(-7,7)),2);if(target&&pathTo(w,target,'walk')&&w.path.length>1)return true;}w.phase='rest';w.rest=4;return false;}
 function visit(id,{automatic=false}={}){if(!cfg)return false;const v=roster.find(n=>n.id===id);if(!v||cfg.available&&!cfg.available.includes(id))return false;let w=walkers.find(w=>w.v.id===id);if(w){if(departing(w)){notify(v.zh+'正在离开，稍后再邀请吧。');return false;}if(!automatic){selected=id;menu='';say(P.dialogue(id,'greet',{points:points(id)}));}return true;}if(walkers.length>=3){notify('最多同时接待 3 位访客，请等一位走出农场后再邀请。');return false;}const from=home();if(!from)return false;
  w={v,x:from[0]*TILE+8,y:from[1]*TILE+12,dir:0,distance:0,moving:false,phase:'rest',rest:random(3,7),life:300,emote:2,path:[],i:0,repath:0,action:null,chats:0,expression:0};walkers.push(w);if(!automatic){selected=id;menu='';say(P.dialogue(id,'greet',{points:points(id)}));}return true;
 }
 function active(){return walkers.find(w=>w.v.id===selected);}
 function social(w,kind,gift){if(!cfg.onSocial)return;const farm=cfg.farm;Promise.resolve(cfg.onSocial(w.v.id,kind,gift)).then(result=>{if(cfg.farm!==farm)return;if(result?.state)setFriendship(result.state);notify(result?.gained?w.v.zh+' 好感 +'+result.gained:'今天这项互动已经增加过好感啦。');}).catch(e=>{if(cfg.farm===farm)notify('好感未保存：'+e.message);});}
 function exitOptions(w){const found=[];for(const exit of cfg.exits||[]){if(cfg.edgePassable&&!cfg.edgePassable(...exit.entry))continue;const path=route(tileOf(w),exit.target);if(path)found.push({...exit,path});}return found.sort((a,b)=>a.path.length-b.path.length);}
 function depart(w){w.action=null;w.moving=false;w.exit=exitOptions(w)[0];if(w.exit){w.path=w.exit.path;w.i=0;w.phase='leaving';notify(w.v.zh+'正沿'+(w.exit.side==='north'?'上方':'左侧')+'小路离开。');}else{w.phase='exit-wait';w.retry=5;notify('通往上方和左侧的路暂时不通，'+w.v.zh+'会等路通后离开。');}if(selected===w.v.id){selected=null;menu='';buttons=[];panel=null;}return !!w.exit;}
 function activity(w,kind='hobby'){const frames=cfg.animations?.[profile(w.v.id).animation];if(!['hobby','hop'].includes(kind)||kind==='hobby'&&!frames?.length)return false;w.moving=false;w.phase='rest';w.rest=10;w.path=[];w.dir=0;w.action={kind,t:0,duration:kind==='hop'?1.6:8,frames:kind==='hobby'?frames:[0]};if(kind==='hop')w.emote=2;return true;}
 function act(kind,id){if(id)selected=id;const w=active();if(!w)return false;if(departing(w)&&kind!=='close')return false;w.emote=1.5;menu='';
  if(kind==='greet'){w.expression=points(w.v.id)>=250?1:0;say(P.dialogue(w.v.id,'greet',{points:points(w.v.id)}));w.phase='rest';w.rest=8;w.action=null;social(w,'greet');}
  else if(kind==='talk'){w.chats++;w.expression=points(w.v.id)>=750?1:0;say(P.dialogue(w.v.id,'talk',{points:points(w.v.id),weather:context.weather,index:w.chats-1}));w.phase='rest';w.rest=10;w.action=null;social(w,'talk');}
  else if(kind==='gift'){menu='gifts';say('选一份桌面小礼物送给'+w.v.zh+'。这些礼物不消耗游戏里的物品。');}
  else if(kind.startsWith('gift-')){const gift=kind.slice(5);if(!Object.hasOwn(P.gifts,gift))return false;w.expression=1;say(P.dialogue(w.v.id,'gift',{gift}));activity(w,'hop');social(w,'gift',gift);}
  else if(kind==='activity'){menu='actions';say('想和'+w.v.zh+'一起做点什么？');}
  else if(kind.startsWith('action-')){const action=kind.slice(7);if(!activity(w,action))return false;say(action==='hobby'?P.dialogue(w.v.id,'activity'):'（'+w.v.zh+'开心地轻轻跳了一下。）');}
  else if(kind==='follow'){w.action=null;w.phase='follow';w.path=[];w.i=0;w.repath=0;say('（'+w.v.zh+'准备和你同行。把鼠标移到可通行的小路上。）');}
  else if(kind==='wander'){wander(w);say('（'+w.v.zh+'准备在农场里四处看看。）');}
  else if(kind==='bye'){const farewell=P.dialogue(w.v.id,'bye');depart(w);notify(w.v.zh+'：'+farewell);}
  else if(kind==='close'){selected=null;menu='';buttons=[];panel=null;}
  else return false;return true;
 }
 function move(w,dt){let step=30*dt;while(step>0&&w.i<w.path.length-1){const [nx,ny]=w.path[w.i+1];if(!walkable(nx,ny)){w.path=[];return false;}const dx=nx*TILE+8-w.x,dy=ny*TILE+12-w.y,d=Math.hypot(dx,dy);if(d<1e-6){w.i++;continue;}w.dir=Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?0:2);const used=Math.min(step,d),px=w.x+dx/d*used,py=w.y+dy/d*used;if(!walkable(Math.floor(px/TILE),Math.floor((py-4)/TILE))){w.path=[];return false;}w.x=px;w.y=py;w.distance+=used;w.moving=true;step-=used;if(used===d)w.i++;}return true;}
 function remove(w){walkers=walkers.filter(a=>a!==w);if(selected===w.v.id)selected=null;}
 function update(dt,now,ctx){if(!cfg)return;dt=Math.max(0,Math.min(.12,dt));context=ctx;lineAge+=dt;noticeTime=Math.max(0,noticeTime-dt);timer-=dt;
  if(timer<=0){const eligible=roster.filter(v=>(!cfg.available||cfg.available.includes(v.id))&&!walkers.some(w=>w.v.id===v.id));if(walkers.length<3&&ctx.weather!=='storm'&&eligible.length)visit(pick(eligible).id,{automatic:true});timer=random(90,140);}
  for(const w of [...walkers]){w.moving=false;w.emote=Math.max(0,w.emote-dt);w.life-=dt;w.repath-=dt;
   if(w.phase==='exit-wait'){w.retry-=dt;if(w.retry<=0)depart(w);continue;}
   if(w.phase==='exiting'){const north=w.exit.side==='north';w.dir=north?2:3;w.moving=true;w.distance+=30*dt;if(north)w.y-=30*dt;else w.x-=30*dt;if(north?w.y<-6:w.x<-10)remove(w);continue;}
   if(w.phase==='leaving'){if(!move(w,dt)){depart(w);continue;}if(w.i>=w.path.length-1)w.phase='exiting';continue;}
   if(w.action){w.action.t+=dt;if(w.action.t>=w.action.duration)w.action=null;else continue;}
   if(w.life<=0&&w.v.id!==selected&&w.phase!=='follow'){depart(w);continue;}
   if(w.v.id===selected&&w.phase==='rest'){w.dir=0;continue;}
   const cur=SDV.interact?.cursor,hover=cur?.on&&Math.abs(cur.x-w.x)<11&&cur.y>w.y-30&&cur.y<w.y+3&&now-cur.lastMove>.5;
   if(hover&&w.phase!=='follow'){w.dir=0;continue;}
   if(w.phase==='follow'){if(!cur?.on||Math.hypot(cur.x-w.x,cur.y-w.y)<24){w.path=[];continue;}if(w.repath<=0){w.repath=.8;if(!pathTo(w,near(cur.x/TILE,cur.y/TILE,3),'follow'))w.path=[];}}
   else if(w.phase==='rest'){w.rest-=dt;if(w.rest<=0&&!(Math.random()<.35&&activity(w,'hobby')))wander(w);continue;}
   if(!move(w,dt)){if(w.phase==='follow')w.repath=0;else{w.phase='rest';w.rest=2;}continue;}
   if(w.phase==='walk'&&w.i>=w.path.length-1){w.phase='rest';w.rest=random(4,10);}
  }
 }
 function pose(w,img){let frame=w.dir*4+(w.moving?Math.floor(w.distance/5)%4:0),lift=0;if(w.action){const a=w.action;if(a.kind==='hop'){frame=0;lift=Math.abs(Math.sin(a.t/a.duration*Math.PI*2))*7;}else frame=a.frames[Math.floor(a.t*7)%a.frames.length];}if((Math.floor(frame/4)+1)*32>img.height)frame=0;return {frame,lift};}
 function sprites(images){return walkers.flatMap(w=>{const img=images['npc_'+w.v.id];if(!img)return [];const {frame,lift}=pose(w,img);return [{x:w.x-8,y:w.y,z:w.y,label:w.v.zh,draw(g){g.save();g.fillStyle='#33261938';g.beginPath();g.ellipse(w.x,w.y+1,6,2,0,0,Math.PI*2);g.fill();SpriteFrames.draw(g,img,(frame%4)*16,Math.floor(frame/4)*32,16,32,Math.round(w.x)-8,Math.round(w.y)-30-Math.round(lift));g.restore();}}];});}
 function heart(g,x,y,size,fill){const mask=['0110110','1111111','1111111','0111110','0011100','0001000'];g.fillStyle=fill;for(let j=0;j<mask.length;j++)for(let i=0;i<7;i++)if(mask[j][i]==='1')g.fillRect(Math.round(x+i*size),Math.round(y+j*size),Math.ceil(size),Math.ceil(size));}
 function emotes(){return {draw(g){for(const w of walkers)if(w.emote>0)heart(g,w.x-4,w.y-40,.9,'#ee6578');}};}
 function box(g,img,x,y,width,height,k){if(!img){g.fillStyle='#f6cd87';g.fillRect(x,y,width,height);g.strokeStyle='#8b441e';g.lineWidth=6*k;g.strokeRect(x,y,width,height);return;}const q=k*.5,ix=x+44*q,iy=y+28*q,bw=width-72*q,bh=height-72*q;const draw=(sx,sy,sw,sh,dx,dy,dw,dh)=>g.drawImage(img,sx,sy,sw,sh,Math.round(dx),Math.round(dy),Math.round(dw),Math.round(dh));
  draw(306,320,16,16,ix,iy,bw,bh);draw(275,313,1,6,ix,iy-20*q,bw,24*q);draw(275,328,1,8,ix+12*q,iy+bh,bw-20*q,32*q);draw(264,325,8,1,ix-32*q,iy+24*q,32*q,bh-28*q);draw(293,324,7,1,ix+bw,iy,28*q,bh);draw(261,311,14,13,ix-44*q,iy-28*q,56*q,52*q);draw(291,311,12,11,ix+bw-8*q,iy-28*q,48*q,44*q);draw(291,326,12,12,ix+bw-8*q,iy+bh-8*q,48*q,48*q);draw(261,327,14,11,ix-44*q,iy+bh-4*q,56*q,44*q);
 }
 function drawPanel(g,c,W,H,ratio,images={}){buttons=[];panel=null;const w=active(),k=ratio;if(!w){if(noticeTime>0){g.save();g.font=`${12*k}px Microsoft YaHei`;const textWidth=Math.min(W-40*k,g.measureText(notice).width+32*k);g.fillStyle='#3d271de8';g.fillRect((W-textWidth)/2,H-80*k,textWidth,34*k);g.fillStyle='#ffe4ab';g.textAlign='center';g.fillText(notice,W/2,H-58*k);g.restore();}return;}
  const width=Math.min(790*k,W-24*k),compact=width<620*k,height=(compact?290:244)*k,x=(W-width)/2,y=H-height-20*k;panel={key:'npc-panel',x,y,w:width,h:height};g.save();g.imageSmoothingEnabled=false;g.fillStyle='#20120e40';g.fillRect(x+5*k,y+6*k,width,height);box(g,images.dialogue,x,y,width,height,k);
  const portrait=images['portrait_'+w.v.id],portraitSize=(compact?80:104)*k,portraitScale=portraitSize/64;
  // Frame, 64px portrait aperture and nameplate share the original atlas scale.
  const frameX=x+width-20*k-115*portraitScale,frameY=y+15*k,portraitX=frameX+25*portraitScale,portraitY=frameY+8*portraitScale,textX=x+26*k,textWidth=frameX-textX-20*k;
  if(images.dialogue)g.drawImage(images.dialogue,583,411,115,97,frameX,frameY,115*portraitScale,97*portraitScale);
  if(portrait){const expression=w.expression||0,cols=Math.floor(portrait.width/64),f=(Math.floor(expression/cols)+1)*64<=portrait.height?expression:0;g.drawImage(portrait,f%cols*64,Math.floor(f/cols)*64,64,64,portraitX,portraitY,portraitSize,portraitSize);}
  g.save();g.fillStyle='#5a2d17';g.textAlign='center';g.textBaseline='middle';g.font=`bold ${compact?13*k:16*k}px Microsoft YaHei`;g.fillText(w.v.zh,frameX+57.5*portraitScale,frameY+86.5*portraitScale,100*portraitScale);g.restore();
  g.textAlign='left';g.font=`${(compact?15:18)*k}px Microsoft YaHei`;const displayed=line.slice(0,Math.floor(lineAge*35)+1);let row='',yy=y+38*k;for(const char of displayed){if(g.measureText(row+char).width>textWidth){g.fillText(row,textX,yy);row='';yy+=27*k;}row+=char;}g.fillText(row,textX,yy);
  const score=points(w.v.id),heartSize=1.5*k,heartsY=y+(compact?143:137)*k;for(let i=0;i<10;i++){heart(g,textX+i*15*k,heartsY,heartSize,'#b58a64');if(score>(i*250)){g.save();g.beginPath();g.rect(textX+i*15*k,heartsY,11*k*Math.min(1,(score-i*250)/250),10*k);g.clip();heart(g,textX+i*15*k,heartsY,heartSize,'#d74454');g.restore();}}
  const tier=score>=2000?'知心朋友':score>=1250?'亲近':score>=500?'熟悉':score>=250?'朋友':'初识';g.font=`${11*k}px Microsoft YaHei`;g.fillStyle='#7b4d2a';g.fillText('桌面好感 · '+tier+'  '+score+' / 2500',textX+160*k,heartsY+9*k);
  g.font=`${11*k}px Microsoft YaHei`;g.fillText(noticeTime>0?notice:'问好 +20 · 聊天 +20 · 送礼 +60～80；每项每天一次',textX,y+(compact?173:166)*k);
  let actions=menu==='gifts'?[...Object.entries(P.gifts).map(([id,label])=>['gift-'+id,label]),['back','返回']]:menu==='actions'?[...(cfg.animations?.[profile(w.v.id).animation]?.length?[['action-hobby',profile(w.v.id).activity]]:[]),['action-hop','开心跳跃'],['back','返回']]:[['greet','问好'],['talk','聊天'],['gift','送礼'],['activity','动作'],['follow','跟随鼠标'],['wander','自由走动'],['bye','告别'],['close','收起']];
  const cols=compact?Math.min(4,actions.length):actions.length,bw=(width-44*k)/cols,bh=29*k,startY=y+(compact?190:186)*k;
  actions.forEach(([action,label],i)=>{const r={key:'npc-action:'+action,action,x:x+22*k+i%cols*bw,y:startY+Math.floor(i/cols)*34*k,w:bw-4*k,h:bh};buttons.push(r);g.fillStyle='#8b4b24';g.fillRect(r.x,r.y,r.w,r.h);g.fillStyle='#e9b76d';g.fillRect(r.x+2*k,r.y+2*k,r.w-4*k,r.h-4*k);g.fillStyle='#ffdfa1';g.fillRect(r.x+3*k,r.y+3*k,r.w-6*k,2*k);g.fillStyle='#613819';g.font=`${12*k}px Microsoft YaHei`;g.textAlign='center';g.fillText(label,r.x+r.w/2,r.y+19*k);});g.restore();
 }
 function regions(c,ratio){const convert=r=>({...r,type:'npc',x:r.x/ratio,y:r.y/ratio,w:r.w/ratio,h:r.h/ratio});return buttons.map(convert).concat(panel?[convert(panel)]:[],walkers.filter(w=>!departing(w)).map(w=>({key:'npc:'+w.v.id,type:'npc',x:(w.x-11-c.x)*c.scale/ratio,y:(w.y-32-c.y)*c.scale/ratio,w:22*c.scale/ratio,h:35*c.scale/ratio})));}
 function click(x,y,c){const button=buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(button){if(button.action==='back'){menu='';}else act(button.action);return true;}if(panel&&x>=panel.x&&x<panel.x+panel.w&&y>=panel.y&&y<panel.y+panel.h){lineAge=999;return true;}const wx=c.x+x/c.scale,wy=c.y+y/c.scale,w=[...walkers].reverse().find(w=>!departing(w)&&Math.abs(wx-w.x)<11&&wy>=w.y-32&&wy<w.y+3);if(!w)return false;selected=w.v.id;menu='';say(P.dialogue(w.v.id,'greet',{points:points(w.v.id)}));if(w.phase!=='follow'){w.phase='rest';w.action=null;}w.rest=10;w.emote=1.5;return true;}
 function describe(w){return {id:w.v.id,name:w.v.zh,phase:w.phase,x:w.x,y:w.y,moving:w.moving,action:w.action?.kind||null,points:points(w.v.id),exit:w.exit?.side||null};}
 function current(){const w=active()||walkers[0];return w?{...describe(w),count:walkers.length,line}:null;}
 return {init,update,sprites,emotes,visit,act,current,roster,drawPanel,regions,click,setFriendship,list:()=>walkers.map(describe),dialogue:()=>({line,menu,notice}),pose};
})();
