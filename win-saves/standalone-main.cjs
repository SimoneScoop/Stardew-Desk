/* Independent entry point. No save reader, XNB reader or game-content discovery. */
'use strict';
const {app,BrowserWindow,Menu,Tray,protocol,net,nativeImage,dialog,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawn}=require('node:child_process');
const TEST=process.argv.includes('--standalone-test'),APP='Stardew Desk 自定义版';
app.setName(APP);app.setAppUserModelId('local.stardewdesk.custom');
const testProfile=TEST&&process.argv.find(a=>a.startsWith('--test-profile='))?.slice(15);if(testProfile)fs.mkdirSync(testProfile,{recursive:true});
app.setPath('userData',testProfile||path.join(app.getPath('appData'),TEST?'Stardew Desk Custom Test':'Stardew Desk Custom'));
protocol.registerSchemesAsPrivileged(['farm','sdv'].map(scheme=>({scheme,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}})));
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-renderer-backgrounding');
if(!app.requestSingleInstanceLock()){app.quit();return;}
const support=app.getPath('userData'),legacySupport=path.join(support,'scene-state');fs.mkdirSync(support,{recursive:true});
const blocked=[];
// Test-only deny list proves the independent process never reads an installed game or saves.
if(TEST){const denied=['D:/steam/steamapps/common/Stardew Valley',path.join(app.getPath('appData'),'StardewValley','Saves')].map(p=>path.resolve(p).toLowerCase());
 for(const method of ['readFileSync','openSync','statSync','lstatSync','readdirSync','existsSync','realpathSync','accessSync']){const original=fs[method];const wrap=function(p,...args){if(typeof p==='string'){const target=path.resolve(p).toLowerCase();if(denied.some(d=>target===d||target.startsWith(d+path.sep))){blocked.push({method,path:p});throw Error('独立模式访问了游戏或存档：'+p);}}return original.call(fs,p,...args);};Object.assign(wrap,original);fs[method]=wrap;}
}
const {AssetPack}=require('./standalone-pack.cjs'),settingsFile=path.join(support,'settings.json');let settings={};try{settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));}catch{}
function persist(){if(!TEST)fs.writeFileSync(settingsFile,JSON.stringify(settings,null,2));}
function log(message){fs.appendFileSync(path.join(support,'app.log'),new Date().toISOString()+' '+message+'\n');}
const option=name=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
let pack=null;for(const root of [option('--asset-pack'),settings.assetPack,path.join(process.resourcesPath,'standalone-pack')].filter(Boolean)){try{pack=new AssetPack(root);break;}catch(e){log('素材包 '+e.message);}}
if(pack){pack.install(legacySupport);settings.assetPack=pack.root;persist();}
if(!TEST&&!fs.existsSync(path.join(legacySupport,'settings.json'))){try{const previous=JSON.parse(fs.readFileSync(path.join(app.getPath('appData'),'Stardew Desk Saves/original/settings.json'),'utf8')),initial={};for(const key of ['layout','frame','season','weather','quality','pet','board','music','musicVolume','saverMinutes','mailWatch','location'])if(key in previous)initial[key]=previous[key];fs.mkdirSync(legacySupport,{recursive:true});fs.writeFileSync(path.join(legacySupport,'settings.json'),JSON.stringify(initial,null,2));}catch{}}
let legacy=null,tray=null,quitting=false;const tracked=new Set();
function prefs(){return {preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false};}
function track(win){const wc=win.webContents;tracked.add(wc);wc.setWindowOpenHandler(()=>({action:'deny'}));win.on('closed',()=>tracked.delete(wc));}
const chest=require('./chest-host.cjs')({active:()=>null,config:()=>settings,persist,webPrefs:prefs,track,desktop:()=>[],locked:()=>false,testing:TEST,log});
async function choosePack(){const result=await dialog.showOpenDialog({title:'选择已解压的独立素材包文件夹',properties:['openDirectory']});if(result.canceled)return;const next=new AssetPack(result.filePaths[0]);next.install(legacySupport);pack=next;settings.assetPack=pack.root;persist();legacy.reload();legacy.activate();legacy.open();menu();}
async function exportPack(){if(!pack)throw Error('请先导入独立素材包');const result=await dialog.showOpenDialog({title:'选择素材包导出位置',properties:['openDirectory','createDirectory']});if(result.canceled)return;const target=path.join(result.filePaths[0],'Stardew-Desk-独立素材包-'+Date.now());pack.exportTo(target);await dialog.showMessageBox({type:'info',message:'素材包已导出',detail:target});}
async function sceneFile(importing){const result=importing?await dialog.showOpenDialog({title:'导入自定义场景',filters:[{name:'自定义场景',extensions:['json']}],properties:['openFile']}):await dialog.showSaveDialog({title:'导出自定义场景',defaultPath:'我的自定义农场.json',filters:[{name:'自定义场景',extensions:['json']}]});if(result.canceled)return;const file=importing?result.filePaths[0]:result.filePath;if(importing){if(fs.statSync(file).size>1024*1024)throw Error('场景文件过大');const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.format!=='stardew-desk-scene'||data.version!==1||!data.layout||Array.isArray(data.layout)||typeof data.layout!=='object')throw Error('不是有效的场景文件');legacy.command('layout',data.layout);}else fs.writeFileSync(file,JSON.stringify({format:'stardew-desk-scene',version:1,layout:legacy.state().layout},null,2));}
function guarded(fn){return ()=>Promise.resolve().then(fn).catch(e=>{log(e.stack||e);dialog.showErrorBox(APP,e.message);});}
function returnToSave(){const args=app.isPackaged?['--save-mode']:[app.getAppPath(),'--save-mode'];spawn(process.execPath,args,{detached:true,stdio:'ignore',windowsHide:true}).unref();quitting=true;app.quit();}
function menu(){if(!tray)return;tray.setContextMenu(Menu.buildFromTemplate([{label:APP+' · 独立素材包',enabled:false},{label:'自由布置场景',click:()=>legacy.open()},{label:'显示自定义桌面',click:()=>legacy.activate()},{label:'暂停桌面显示',click:()=>legacy.stop()},{label:'打开快捷方式箱',click:()=>chest.open('desktop-default')},{type:'separator'},{label:'场景与工具',submenu:legacy.menu()},{label:'场景文件',submenu:[{label:'导出当前场景…',click:guarded(()=>sceneFile(false))},{label:'导入场景…',click:guarded(()=>sceneFile(true))}]},{label:'独立素材包',submenu:[{label:'导出素材包…',click:guarded(exportPack)},{label:'导入 / 更换素材包…',click:guarded(choosePack)}]},{type:'separator'},{label:'切回存档模式',click:returnToSave},{label:'退出自定义版',click:()=>{quitting=true;app.quit();}}]));}
legacy=require('./legacy/host.cjs')({support:legacySupport,testing:TEST,independent:true,title:APP,font:async()=>pack?.font()||null,choosePack:guarded(choosePack),season:()=>null,send:()=>{},changed:menu,activateOriginal:()=>{},startSaver:()=>{},isSaver:()=>false});
ipcMain.handle('farm-api',async(e,action,value)=>{if(!tracked.has(e.sender)||!e.senderFrame?.url.startsWith('farm://app/'))throw Error('未授权的窗口');if(action==='game-font')return pack?.font().info||null;return chest.handle(e,action,value);});
app.on('second-instance',(_e,args)=>{if(args.includes('--stop-standalone')){quitting=true;app.quit();}else legacy.open();});
app.on('before-quit',()=>{quitting=true;legacy.stop();chest.close();});app.on('window-all-closed',()=>{});
async function test(){const output=process.env.STANDALONE_TEST_OUTPUT||path.join(support,'test-output');fs.mkdirSync(output,{recursive:true});const report={errors:[],blockedReads:blocked};
 try{if(!pack)throw Error('未找到独立素材包');const font=pack.font(),win=new BrowserWindow({width:1200,height:780,show:false,webPreferences:{preload:path.join(__dirname,'legacy/preload.js'),contextIsolation:true,sandbox:true,additionalArguments:['--sdv-role=editor'],offscreen:true}});await win.loadURL('sdv://app/index.html?t=12&w=sunny&s=fall');await win.webContents.executeJavaScript('window.GameFont.ready');await new Promise(r=>setTimeout(r,1000));
 report.scene=await win.webContents.executeJavaScript(`(()=>{const before=SDV.layout.offsets();SDV.host.apply('layout',{house:[-1,0]});const moved=SDV.layout.offsets().house;document.getElementById('layout-edit').click();document.querySelector('[data-tab="layout"]').click();return {map:!!SDV_DATA.map,images:SDV_DATA.images.length,font:GameFont.info(),buildings:SDV.layout.names,tools:[...document.querySelectorAll('[data-tool]')].map(b=>b.dataset.tool),moved,layoutMode:document.getElementById('layout-edit').getAttribute('aria-pressed')};})()`);
 if(!report.scene.map||report.scene.images<60||report.scene.moved?.[0]!==-1||!report.scene.font?.glyphs||report.scene.tools.length<4)throw Error('自定义场景或布置工具未载入');await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(output,'custom-editor.png'),(await win.webContents.capturePage()).toPNG());
 legacy.command('layout',{house:[-1,0]});if(legacy.state().layout.house[0]!==-1)throw Error('场景布局未保存');legacy.command('layout',{});const focus=legacy.command('focus',25);if(!focus.focus?.start)throw Error('专注计时未载入');legacy.command('focusCancel');report.scene.layoutPersists=true;
 const shortcuts=await chest.list('desktop-default');report.shortcuts=shortcuts.items.length;report.pack={files:pack.manifest.files.length,images:pack.scene.images.length,music:pack.manifest.files.filter(e=>e.path.startsWith('music/')).length,fontGlyphs:font.info.chars.length};
 const sw=new BrowserWindow({width:920,height:600,show:false,webPreferences:prefs()});track(sw);await sw.loadURL('farm://app/chest.html?key=desktop-default');await sw.webContents.executeJavaScript('window.chestTest.ready');report.chest=await sw.webContents.executeJavaScript('window.chestTest.diagnostics()');if(report.chest.items!==report.shortcuts)throw Error('快捷箱未正确载入');sw.destroy();win.destroy();if(blocked.length)throw Error('独立模式仍访问游戏路径');
 }catch(e){report.errors.push(e.stack||String(e));}fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));app.exit(report.errors.length?1:0);
}
app.whenReady().then(async()=>{
 protocol.handle('farm',async req=>{const u=new URL(req.url),rel=decodeURIComponent(u.pathname);if(u.hostname!=='app')return new Response('Forbidden',{status:403});let file;
 if(rel==='/game-font.ttf')file=pack?.font().file;else if(/^\/assets\/[a-f\d]{64}\.png$/.test(rel))file=pack&&path.join(pack.root,'font',path.basename(rel));else if(['/chest.html','/chest.js','/chest.css','/game-font.js'].includes(rel))file=path.join(__dirname,'ui',rel);return file?net.fetch(pathToFileURL(file).href):new Response('Not found',{status:404});});
 if(TEST){await test();return;}
 tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'icon.png')).resize({width:24,height:24}));tray.setToolTip(APP);tray.on('click',()=>legacy.open());menu();if(pack){
  // Retire an already running save-mode process before showing this desktop.
  const args=app.isPackaged?['--save-mode','--handoff-standalone']:[app.getAppPath(),'--save-mode','--handoff-standalone'];spawn(process.execPath,args,{detached:true,stdio:'ignore',windowsHide:true}).unref();
  const preference=path.join(app.getPath('appData'),'Stardew Desk Saves/settings.json');try{const data=JSON.parse(fs.readFileSync(preference,'utf8'));data.sceneMode='standalone';fs.writeFileSync(preference,JSON.stringify(data,null,2));}catch{}
  legacy.activate();legacy.open();log('独立模式启动：'+pack.root);
 }else await choosePack();
}).catch(e=>{log(e.stack);if(!TEST)dialog.showErrorBox(APP,e.message);app.exit(1);});
