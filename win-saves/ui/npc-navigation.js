(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FarmNPCNavigation=api;})(globalThis,()=>{
 function exits(properties={},width,height){const found=[],parts=String(properties.Warp||'').trim().split(/\s+/);for(let i=0;i+4<parts.length;i+=5){const x=Number(parts[i]),y=Number(parts[i+1]);if(y<=0&&x>0&&x<width-1)found.push({side:'north',entry:[x,0],target:[x,1]});else if(x<=0&&y>0&&y<height-1)found.push({side:'west',entry:[0,y],target:[1,y]});}
  if(!found.some(e=>e.side==='north')&&properties.BackwoodsEntry){const [x]=String(properties.BackwoodsEntry).split(/\s+/).map(Number);if(x>0&&x<width-1)found.push({side:'north',entry:[x,0],target:[x,1]});}
  return found.filter((e,i)=>found.findIndex(a=>a.side===e.side&&a.entry.join(',')===e.entry.join(','))===i);
 }
 // Dijkstra: use real floor paths when available, while avoiding crops and obstacles.
 function route(start,end,{width,height,passable,cost=()=>1}){if(!end||!passable(...end))return null;const key=p=>p[0]+p[1]*width,heap=[],dist=new Map([[key(start),0]]),prev=new Map();
  function push(item){let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p].d<=item.d)break;heap[i]=heap[p];i=p;}heap[i]=item;}
  function pop(){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].d<heap[c].d)c++;if(heap[c].d>=last.d)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;}
  push({p:start,d:0});let count=0;while(heap.length&&count++<width*height*5){const {p,d}=pop(),k=key(p);if(d!==dist.get(k))continue;if(p[0]===end[0]&&p[1]===end[1]){const out=[p];let at=p;while(key(at)!==key(start)){at=prev.get(key(at));if(!at)return null;out.push(at);}return out.reverse();}for(const [dx,dy] of [[0,-1],[-1,0],[1,0],[0,1]]){const n=[p[0]+dx,p[1]+dy];if(n[0]<0||n[1]<0||n[0]>=width||n[1]>=height||!passable(...n))continue;const nd=d+Math.max(.1,Number(cost(...n))||1),nk=key(n);if(nd<(dist.get(nk)??Infinity)){dist.set(nk,nd);prev.set(nk,p);push({p:n,d:nd});}}}return null;
 }
 return {exits,route};
});
