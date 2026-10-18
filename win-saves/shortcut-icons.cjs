'use strict';
const {spawn}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');
// Fixed code reads shortcut metadata only; file names arrive as JSON on stdin.
const script=`$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $links=([Console]::In.ReadToEnd() | ConvertFrom-Json); $ws=New-Object -ComObject WScript.Shell; $result=@{}; foreach($link in $links){try{$s=$ws.CreateShortcut([string]$link);$result[[string]$link]=@{target=$s.TargetPath;icon=$s.IconLocation}}catch{}}; $result | ConvertTo-Json -Depth 3 -Compress`;
function linkMetadata(files){return new Promise(resolve=>{if(!files.length||process.platform!=='win32'){resolve({});return;}const exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');const p=spawn(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});let out='';const timer=setTimeout(()=>{p.kill();resolve({});},10000);p.stdout.setEncoding('utf8');p.stdout.on('data',s=>out+=s);p.on('error',()=>{clearTimeout(timer);resolve({});});p.on('close',()=>{clearTimeout(timer);try{resolve(JSON.parse(out.replace(/^\uFEFF/,'')));}catch{resolve({});}});p.stdin.end(JSON.stringify(files));});}
function expand(p){return p.replace(/%([^%]+)%/g,(m,k)=>process.env[k]||process.env[Object.keys(process.env).find(n=>n.toLowerCase()===k.toLowerCase())]||m);}
function iconLocation(value,index=0){
 let file=String(value||'').trim();if(!file)return null;
 const suffix=/,\s*(-?\d+)\s*$/.exec(file);if(suffix){index=Number(suffix[1]);file=file.slice(0,suffix.index).trim();}
 if(file.startsWith('"')&&file.endsWith('"'))file=file.slice(1,-1);
 if(!Number.isInteger(index)||index < -2147483648||index>2147483647)index=0;
 return file?{file:expand(file),index}:null;
}
function shortcutText(bytes){
 if(bytes[0]===0xff&&bytes[1]===0xfe)return bytes.subarray(2).toString('utf16le');
 if(bytes[0]===0xfe&&bytes[1]===0xff){const copy=Buffer.from(bytes.subarray(2));if(copy.length%2)return '';return copy.swap16().toString('utf16le');}
 return bytes.toString('utf8').replace(/^\uFEFF/,'');
}
function iconCandidates(item,metadata={}){
 let candidates=[];
 if(item.extension==='.lnk'){const m=metadata[item.file]||{};candidates=[iconLocation(m.icon),iconLocation(m.target)];}
 else if(item.extension==='.url'||item.extension==='.website'){try{const raw=shortcutText(fs.readFileSync(item.file));candidates=[iconLocation(/^\s*IconFile\s*=(.+)$/im.exec(raw)?.[1],Number(/^\s*IconIndex\s*=\s*(-?\d+)/im.exec(raw)?.[1]||0))];}catch{}}
 const seen=new Set();return candidates.filter(c=>{if(!c)return false;const key=c.file.toLowerCase()+','+c.index;if(seen.has(key))return false;seen.add(key);try{return fs.statSync(c.file).isFile();}catch{return false;}});
}
function iconSource(item,metadata){return iconCandidates(item,metadata)[0]?.file||item.file;}
// Extract the image resource itself. getFileIcon('app.ico') returns the ICO
// file-type association on Windows, which can be a blank sheet of paper.
function extractShortcutIcons(items,metadata){return new Promise(resolve=>{
 if(process.platform!=='win32'||!items.length){resolve({});return;}
 const requests=items.map(item=>({key:item.file,sources:iconCandidates(item,metadata)})).filter(item=>item.sources.length);
 if(!requests.length){resolve({});return;}
 const exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const code=fs.readFileSync(path.join(__dirname,'shortcut-icons.ps1'),'utf8');
 const child=spawn(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
 let output='',finished=false;function finish(result){if(finished)return;finished=true;clearTimeout(timer);resolve(result);}
 const timer=setTimeout(()=>{child.kill();finish({});},15000);
 child.stdout.setEncoding('utf8');child.stdout.on('data',text=>{output+=text;if(output.length>16*1024*1024){child.kill();finish({});}});
 child.on('error',()=>finish({}));child.stdin.on('error',()=>{});
 child.on('close',()=>{try{const parsed=JSON.parse(output.replace(/^\uFEFF/,''));finish(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{});}catch{finish({});}});
 child.stdin.end(JSON.stringify(requests));
});}
module.exports={linkMetadata,iconSource,iconLocation,iconCandidates,shortcutText,extractShortcutIcons};
