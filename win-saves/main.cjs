'use strict';
// Select the independent entry before any game/save module is loaded.
let independentEntry=process.argv.includes('--standalone')||process.argv.includes('--standalone-test');
if(!independentEntry&&!process.argv.includes('--save-mode')&&!process.argv.includes('--self-test')){try{independentEntry=JSON.parse(require('node:fs').readFileSync(require('node:path').join(process.env.APPDATA,'Stardew Desk Saves/settings.json'),'utf8')).sceneMode==='standalone';}catch{}}
if(independentEntry){require('./standalone-main.cjs');return;}
const {app,BrowserWindow,ipcMain,Menu,Tray,protocol,net,screen,powerMonitor,nativeImage,dialog}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {listSaves,loadSave,savePath}=require('./save-reader.cjs');const {Assets}=require('./assets.cjs');const W=require('./winapi.cjs');
const SELFTEST=process.argv.includes('--self-test');
const APP='Stardew Desk 存档版';app.setName(APP);app.setAppUserModelId('local.stardewdesk.saves');
app.setPath('userData',path.join(app.getPath('appData'),SELFTEST?'Stardew Desk Saves Test':'Stardew Desk Saves'));
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-renderer-backgrounding');
protocol.registerSchemesAsPrivileged(['farm','sdv'].map(scheme=>({scheme,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}})));
if(!app.requestSingleInstanceLock()){app.quit();return;}
if(process.argv.includes('--handoff-standalone')){app.quit();return;}
const support=app.getPath('userData');fs.mkdirSync(support,{recursive:true});
const saveRoot=SELFTEST&&process.env.FARM_TEST_SAVE_ROOT?fs.realpathSync(process.env.FARM_TEST_SAVE_ROOT):path.join(app.getPath('appData'),'StardewValley','Saves');
const configPath=path.join(support,'settings.json');let config={selected:null,mode:'auto',quality:15,weather:'save',daylight:'real',animate:true,city:'杭州',lat:30.27,lon:120.15,frames:{}};
try{Object.assign(config,JSON.parse(fs.readFileSync(configPath,'utf8')));}catch{}
function log(s){fs.appendFileSync(path.join(support,'app.log'),new Date().toISOString()+' '+s+'\n');}
const friendship=new (require('./npc-friendship.cjs').Friendship)(path.join(support,'npc-friendship.json'),{memory:SELFTEST});
if(process.argv.includes('--save-mode'))config.sceneMode='save';
function persist(){if(SELFTEST)return;fs.writeFileSync(configPath+'.tmp',JSON.stringify(config,null,2));fs.renameSync(configPath+'.tmp',configPath);}
let editor=null,tray=null,desktop=[],saver=[],assets=null,active=null,lastFingerprint='',observedFingerprint='',stableSince=0,loading=false,quitting=false,locked=false,weather=null;
let currentPayload=null;
let legacy=null;
const appWindows=new Set();
const chestHost=require('./chest-host.cjs')({active:()=>active,config:()=>config,persist,webPrefs,track,desktop:()=>desktop,locked:()=>locked,testing:SELFTEST,log});
function webPrefs(){return {preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,...(SELFTEST?{offscreen:true}:{})};}
function track(win){const wc=win.webContents;appWindows.add(wc);wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-navigate',(e,u)=>{if(!u.startsWith('farm://app/'))e.preventDefault();});win.on('closed',()=>appWindows.delete(wc));wc.on('console-message',(_e,...args)=>{if(SELFTEST)log('renderer '+JSON.stringify(args));});wc.on('render-process-gone',(_e,details)=>log('renderer gone '+JSON.stringify(details)));}
function broadcast(channel,data,exclude=null){for(const wc of appWindows)if(wc!==exclude&&!wc.isDestroyed())wc.send(channel,data);}
function editorWindow(){if(editor&&!editor.isDestroyed()){editor.show();editor.focus();return editor;}editor=new BrowserWindow({title:APP+' · 我的农场',width:1260,height:850,minWidth:900,minHeight:620,show:!SELFTEST,backgroundColor:'#201a13',autoHideMenuBar:true,webPreferences:webPrefs()});track(editor);editor.setMenu(null);editor.loadURL('farm://app/index.html');editor.on('close',e=>{if(!quitting&&!SELFTEST){e.preventDefault();editor.hide();}});return editor;}
function physical(bounds){const r=screen.dipToScreenRect(null,bounds);return {x:r.x,y:r.y,w:r.width,h:r.height};}
function stopDesktop(){for(const s of desktop)if(!s.win.isDestroyed())s.win.destroy();desktop=[];}
function buildDesktop(){legacy?.stop();config.sceneMode='save';persist();stopDesktop();for(const d of screen.getAllDisplays()){const win=new BrowserWindow({...d.bounds,title:APP+' · 桌面',show:false,frame:false,skipTaskbar:true,focusable:false,resizable:false,hasShadow:false,backgroundColor:'#201a13',webPreferences:webPrefs()});track(win);win.setIgnoreMouseEvents(true);const s={win,attach:null,display:d};desktop.push(s);win.once('ready-to-show',()=>{win.showInactive();try{s.attach=W.attach(win,physical(d.bounds),config.mode);log('桌面已挂载 '+JSON.stringify(s.attach));}catch(e){log('桌面挂载失败 '+e.message);}});win.loadURL('farm://app/index.html?desktop=1');} menu();}
function stopSaver(){for(const w of saver)if(!w.isDestroyed())w.destroy();saver=[];}
function startSaver(){if(saver.length||!active||locked)return;for(const d of screen.getAllDisplays()){const w=new BrowserWindow({...d.bounds,title:APP+' · 屏保',show:false,frame:false,alwaysOnTop:true,skipTaskbar:true,backgroundColor:'#201a13',webPreferences:webPrefs()});track(w);saver.push(w);w.once('ready-to-show',()=>w.showInactive());w.webContents.on('before-input-event',stopSaver);w.loadURL('farm://app/index.html?saver=1');} }
function openStandalone(){const {AssetPack}=require('./standalone-pack.cjs');new AssetPack(path.join(process.resourcesPath,'standalone-pack'));config.sceneMode='standalone';persist();const args=app.isPackaged?['--standalone']:[app.getAppPath(),'--standalone'];require('node:child_process').spawn(process.execPath,args,{detached:true,stdio:'ignore',windowsHide:true}).unref();quitting=true;app.quit();}
function menu(){if(!tray)return;tray.setContextMenu(Menu.buildFromTemplate([{label:APP,enabled:false},{label:active?active.farmName+'农场 · '+active.player:'尚未选择存档',enabled:false},{type:'separator'},{label:'选择存档 / 打开设置',click:editorWindow},{label:'独立自定义农场（无需游戏）',click:()=>{try{openStandalone();}catch(e){dialog.showErrorBox(APP,'请先放入独立素材包。'+e.message);}}},{label:'打开快捷方式箱',click:()=>chestHost.open('desktop-default')},{label:'原版全部功能',submenu:legacy?legacy.menu():[]},{label:'自定义农场 / 自由布置',click:()=>openStandalone()},{label:'切换到独立自定义桌面',click:()=>openStandalone()},{label:'重新读取当前存档',click:()=>refresh(true).catch(e=>log(e.message))},{label:'显示存档桌面农场',click:buildDesktop},{label:'暂停桌面显示',click:stopDesktop},{label:'桌面显示方式',submenu:[['auto','自动'],['nolayer','兼容模式']].map(([mode,label])=>({label,type:'radio',checked:config.mode===mode,click:()=>{config.mode=mode;persist();buildDesktop();}}))},{label:'预览存档屏保',click:startSaver},{type:'separator'},{label:'退出存档版',click:()=>{quitting=true;app.quit();}}]));}
async function locateContent(){let c;try{c=JSON.parse(fs.readFileSync(path.join(app.getPath('appData'),'Stardew Desk/settings.json'),'utf8')).contentDir;}catch{}for(const p of [config.contentDir,c,'D:/steam/steamapps/common/Stardew Valley/Content','C:/Program Files (x86)/Steam/steamapps/common/Stardew Valley/Content'])if(p&&fs.existsSync(path.join(p,'Maps/Farm.xnb')))return p;return null;}
function fingerprint(id){const st=fs.statSync(savePath(saveRoot,id));return st.size+':'+st.mtimeMs;}
async function getFarm(id){const model=loadSave(saveRoot,id);if(config.visualSeason&&config.visualSeason!=='save'){model.savedSeason=model.season;model.season=config.visualSeason==='auto'?['spring','summer','fall','winter'][Math.floor(((new Date().getMonth()+10)%12)/3)]:config.visualSeason;}const data=await assets.prepare(model);return {...data,npcState:friendship.snapshot(id)};}
async function select(id,exclude=null){const payload=await getFarm(id);config.selected=id;active=payload.model;currentPayload=payload;lastFingerprint=fingerprint(id);persist();menu();broadcast('farm-changed',payload,exclude);log('存档载入 '+id+' '+JSON.stringify(active.counts));return payload;}
async function refresh(force=false){if(loading||!config.selected||!assets)return;loading=true;try{const fp=fingerprint(config.selected);if(!force&&fp===lastFingerprint)return;await select(config.selected);}catch(e){log('保留上一次画面，读取暂缓 '+e.message);broadcast('status',{error:'存档正在保存或读取失败，暂时保留上一次画面。'+e.message});}finally{loading=false;}}
function checkFiles(){if(!active||loading)return;try{const fp=fingerprint(config.selected);if(fp===lastFingerprint)return;if(fp!==observedFingerprint){observedFingerprint=fp;stableSince=Date.now();return;}if(Date.now()-stableSince>1500)return refresh();}catch(e){log('存档检查 '+e.message);}}
async function updateWeather(){try{const url=`https://api.open-meteo.com/v1/forecast?latitude=${config.lat}&longitude=${config.lon}&current=weather_code,precipitation,wind_speed_10m`;const res=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!res.ok)throw Error('HTTP '+res.status);const data=await res.json();weather={...data.current,at:Date.now()};broadcast('weather-changed',weather);}catch(e){log('天气暂不可用 '+e.message);}}
function validateSender(e){if(!appWindows.has(e.sender)||!e.senderFrame?.url.startsWith('farm://app/'))throw new Error('未授权的窗口');}
ipcMain.handle('farm-api',async(e,action,value)=>{validateSender(e);switch(action){
 case 'standalone-open':openStandalone();return true;
 case 'game-font':return assets?(await require('./game-font.cjs').prepare(assets)).info:null;
 case 'init':return {saves:listSaves(saveRoot),config,payload:currentPayload,weather,contentReady:!!assets,original:legacy?.state()};
 case 'npc-social':{if(!active||value?.saveId!==active.id)throw Error('当前农场已切换，请重新打开对话');const result=friendship.reward(active.id,value.id,value.action,value.gift);broadcast('npc-state',result.state);return result;}
 case 'npc-command':{if(value?.kind!=='invite'||!require('./ui/npc-roster.js').some(v=>v.id===value.id))throw Error('无效的访客');broadcast('npc-command',value);return true;}
 case 'original':{if(!value||typeof value.kind!=='string')throw Error('无效的设置');if(value.kind==='open'){openStandalone();return true;}return legacy.command(value.kind,value.value);}
 case 'visual':{if(['save','auto','spring','summer','fall','winter'].includes(value?.season)&&config.visualSeason!==value.season){config.visualSeason=value.season;persist();await refresh(true);}return true;}
 case 'chest-open':case 'shortcut-list':case 'shortcut-launch':case 'shortcut-order':case 'interactive-regions':return chestHost.handle(e,action,value);
 case 'load':if(!assets)throw Error('请先选择游戏 Content 文件夹');return select(value,e.sender);
 case 'rescan':return listSaves(saveRoot);
 case 'apply':if(!active)throw Error('请先载入存档');buildDesktop();return true;
 case 'settings':{if(value&&typeof value==='object'){for(const k of ['weather','daylight','quality','animate'])if(k in value){const v=value[k];if(k==='weather'&&!['save','live','sunny','cloudy','rain','storm','snow','fog','windy'].includes(v))continue;if(k==='daylight'&&!['real','day','night'].includes(v))continue;if(k==='quality'&&![10,15,30].includes(v))continue;if(k==='animate'&&typeof v!=='boolean')continue;config[k]=v;}persist();broadcast('settings-changed',config);}return config;}
 case 'frame':if(active&&value&&['x','y','zoom'].every(k=>Number.isFinite(value[k]))){config.frames[active.id]={x:value.x,y:value.y,zoom:Math.max(0.5,Math.min(6,value.zoom)),view:value.view==='full'?'full':'cover'};persist();broadcast('settings-changed',config);}return true;
 case 'city':{const name=String(value||'').trim().slice(0,80);if(!name)throw Error('请输入城市');const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(name)+'&count=1&language=zh',{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('城市查询失败');const data=await response.json();const first=data.results?.[0];if(!first)throw Error('未找到城市，可试城市英文名称');Object.assign(config,{city:first.name,lat:first.latitude,lon:first.longitude});persist();await updateWeather();broadcast('settings-changed',config);return config.city;}
 case 'choose-content':{const r=await dialog.showOpenDialog(editor,{title:'选择星露谷的 Content 文件夹或游戏安装文件夹',properties:['openDirectory']});if(r.canceled)return false;let p=r.filePaths[0];if(fs.existsSync(path.join(p,'Content')))p=path.join(p,'Content');if(!fs.existsSync(path.join(p,'Maps/Farm.xnb')))throw Error('这个位置没有找到游戏素材');config.contentDir=p;assets=new Assets(p,path.join(support,'assets'),{portraitModDir:config.portraitModDir});persist();return true;}
 case 'saver-stop':stopSaver();return true;
 default:throw Error('不支持的操作');
}});
async function selftest(win){
 const report={saves:[],errors:[]};
 const output=process.env.FARM_TEST_OUTPUT||path.join(support,'test-output');fs.mkdirSync(output,{recursive:true});
 await win.webContents.executeJavaScript('window.farmTest.ready');
 for(const entry of listSaves(saveRoot)){
  try{
   const before=fs.readFileSync(savePath(saveRoot,entry.id));
   const result=await win.webContents.executeJavaScript(`window.farmTest.load(${JSON.stringify(entry.id)})`);
   if(result.unbackedAnimatedGround)throw Error('动画地块底图缺失');
   if(!result.renderedSprites||result.missingBuildingTextures.length||result.loading||result.displayedName==='你的农场')throw Error('场景未完整建立');
   result.animation=await win.webContents.executeJavaScript('window.farmTest.animationFrames()');if(result.animation.checked<224||result.animation.opaqueGutter)throw Error('动画帧裁切边缘异常');
   await new Promise(r=>setTimeout(r,600));report.saves.push(result);
   const png=await win.webContents.capturePage();fs.writeFileSync(path.join(output,entry.id+'.png'),png.toPNG());
   const display=screen.getPrimaryDisplay();win.setContentSize(display.bounds.width,display.bounds.height);
   const wallpaper=await win.webContents.executeJavaScript('window.farmTest.wallpaperPreview()');
   const cam=wallpaper.camera,mw=wallpaper.mapSize[0]*16,mh=wallpaper.mapSize[1]*16;
   if(cam.x<-.001||cam.y<-.001||cam.x+cam.viewWidth>mw+.001||cam.y+cam.viewHeight>mh+.001)throw Error('壁纸取景越过地图边界');
   await new Promise(r=>setTimeout(r,350));fs.writeFileSync(path.join(output,entry.id+'-desktop.png'),(await win.webContents.capturePage()).toPNG());
   result.wallpaper={viewport:wallpaper.viewport,camera:cam,fullCoverage:true};result.npcExit=await win.webContents.executeJavaScript('window.farmTest.checkExit()');if(!result.npcExit.removed||result.npcExit.start.phase!=='leaving')throw Error('当前农场没有可通行的离场路线');
   await win.webContents.executeJavaScript('window.farmTest.restorePreview()');win.setContentSize(1260,820);
   if(!before.equals(fs.readFileSync(savePath(saveRoot,entry.id))))throw Error('存档被修改');
  }catch(e){report.errors.push(e.stack);}
 }
 try{
  const key=chestHost.chests()[0]?.key||'desktop-default',items=await chestHost.list(key);
  const box=new BrowserWindow({width:920,height:600,show:false,webPreferences:webPrefs()});track(box);
  await box.loadURL('farm://app/chest.html?key='+encodeURIComponent(key));await box.webContents.executeJavaScript('window.chestTest.ready');
  report.npc=await win.webContents.executeJavaScript('window.farmTest.npc()');if(report.npc.roster!==14||report.npc.images!==14||report.npc.portraits!==14||(config.portraitModDir&&Object.keys(report.npc.portraitSources||{}).length!==14)||report.npc.follow!=='follow'||report.npc.activity!=='hobby'||!report.npc.font||report.npc.missingGlyphs.length)throw Error('NPC互动、头像或游戏字体未完整载入');await new Promise(r=>setTimeout(r,1900));fs.writeFileSync(path.join(output,'npc-interactions.png'),(await win.webContents.capturePage()).toPNG());
  report.npc.departure=await win.webContents.executeJavaScript('window.farmTest.npcDepart()');if(!report.npc.departure.removed||report.npc.departure.start.phase!=='leaving'||report.npc.departure.maxStep>3.01)throw Error('NPC离场路径错误');
  report.chest=await box.webContents.executeJavaScript('({items:window.chestTest.diagnostics().items,slots:window.chestTest.diagnostics().slots})');
  if(report.chest.items!==items.items.length||report.chest.slots!==36)throw Error('快捷箱格子未正确载入');
  fs.writeFileSync(path.join(output,'shortcut-chest.png'),(await box.webContents.capturePage()).toPNG());box.destroy();
  const focused=legacy.command('focus',25);if(!focused.focus?.start||focused.focus.dur!==1500)throw Error('原版专注计时失败');legacy.command('focusCancel');
  const board=legacy.state().board;board.todos=[{id:'test-todo',text:'测试待办',done:false}];legacy.command('boardSet',board);legacy.command('boardAction',{kind:'todo',value:'test-todo'});if(!legacy.state().board.todos[0].done)throw Error('公告板勾选失败');
  if(require('./legacy/winapi.js')!==W)throw Error('原版与存档版未共用窗口接口');W.windowRects(new Set());
  report.original={menuItems:legacy.menu().items.length,focus:true,board:true,sharedWin32:true,startupEnabled:app.getLoginItemSettings().openAtLogin};
  const classic=new BrowserWindow({width:1100,height:700,show:false,webPreferences:{...webPrefs(),preload:path.join(__dirname,'legacy/preload.js'),additionalArguments:['--sdv-role=editor']}});
  await classic.loadURL('sdv://app/index.html');await classic.webContents.executeJavaScript('window.GameFont.ready');await new Promise(r=>setTimeout(r,600));
  const hasScene=await classic.webContents.executeJavaScript('!!(window.SDV_DATA?.map&&window.SDV?.host&&window.SDV?.board&&window.SDV?.critters&&window.SDV?.villagers)');
  if(!hasScene)throw Error('原版完整场景未载入');report.original.completeScene=true;fs.writeFileSync(path.join(output,'original-farm.png'),(await classic.webContents.capturePage()).toPNG());classic.destroy();
 }catch(e){report.errors.push(e.stack);}
 // Mutating integration checks run only against an explicitly supplied fixture directory.
 if(process.env.FARM_TEST_SAVE_ROOT){try{
  const file=savePath(saveRoot,active.id),original=fs.readFileSync(file,'utf8'),oldDay=active.day;
  fs.writeFileSync(file,'<SaveGame>');await refresh(true);
  if(active.day!==oldDay)throw Error('不完整存档覆盖了已载入画面');
  const changed=original.replace(/<dayOfMonth>\d+<\/dayOfMonth>/,'<dayOfMonth>'+(oldDay===28?27:oldDay+1)+'</dayOfMonth>');
  fs.writeFileSync(file,changed);checkFiles();await new Promise(r=>setTimeout(r,1700));await checkFiles();
  if(active.day===oldDay)throw Error('保存后自动刷新失败');
  await new Promise(r=>setTimeout(r,350));const diag=await win.webContents.executeJavaScript('window.farmTest.diagnostics()');
  if(diag.day!==active.day)throw Error('新存档没有同步到画面');
  report.autoRefresh={pass:true,incompleteSaveKeptPrevious:true,oldDay,newDay:active.day};
  fs.writeFileSync(file,original);
 }catch(e){report.errors.push(e.stack);}}
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));quitting=true;app.exit(report.errors.length?1:0);
}
app.on('second-instance',(_e,args)=>{if(args.includes('--handoff-standalone')){quitting=true;app.quit();}else editorWindow();});app.on('window-all-closed',()=>{});app.on('before-quit',()=>{quitting=true;stopSaver();stopDesktop();});
process.on('uncaughtException',e=>log('异常 '+e.stack));
const legacySupport=path.join(support,'original');fs.mkdirSync(legacySupport,{recursive:true});
const originalSupport=path.join(app.getPath('appData'),'Stardew Desk');
if(!fs.existsSync(path.join(legacySupport,'settings.json'))&&fs.existsSync(path.join(originalSupport,'settings.json')))fs.copyFileSync(path.join(originalSupport,'settings.json'),path.join(legacySupport,'settings.json'));
if(!fs.existsSync(path.join(legacySupport,'scene/data/version.txt'))&&fs.existsSync(path.join(originalSupport,'scene/data')))fs.cpSync(path.join(originalSupport,'scene/data'),path.join(legacySupport,'scene/data'),{recursive:true});
legacy=require('./legacy/host.cjs')({font:async()=>assets?{...await require('./game-font.cjs').prepare(assets),cache:assets.cache}:null,support:legacySupport,testing:SELFTEST,season:()=>active?.season,send:js=>{for(const wc of appWindows)if(!wc.isDestroyed())wc.executeJavaScript('if(window.SDV?.host){'+js+'}').catch(()=>{});},changed:s=>{broadcast('original-state',s);menu();},activateOriginal:()=>{stopDesktop();config.sceneMode='original';persist();},startSaver,isSaver:()=>saver.length>0});
if(!SELFTEST)setInterval(()=>{try{broadcast('original-state',legacy.state());}catch(e){log(e.message);}},1000);
app.whenReady().then(async()=>{
 protocol.handle('farm',async req=>{const u=new URL(req.url);let file;const rel=decodeURIComponent(u.pathname);if(u.hostname!=='app')return new Response('Forbidden',{status:403});if(rel==='/game-font.ttf'){if(!assets)return new Response('No game assets',{status:404});file=(await require('./game-font.cjs').prepare(assets)).file;}else if(/^\/assets\/[a-f0-9]{64}\.png$/.test(rel))file=path.join(support,rel);else if(/^\/original-img\/[a-zA-Z0-9_]+\.png$/.test(rel))file=path.join(legacySupport,'scene/data/img',path.basename(rel));else if(['/index.html','/renderer.js','/styles.css','/sky.js','/sprite-frames.js','/grass-motion.js','/motion-camera.js','/sprite-layout.js','/building-layout.js','/npc-roster.js','/npc-visitors.js','/npc-personality.js','/npc-navigation.js','/game-font.js','/chest.html','/chest.js','/chest.css','/board.js','/focus.js','/critters.js','/original-features.js','/villagers.js','/weather.js'].includes(rel))file=path.join(__dirname,'ui',rel);else return new Response('Not found',{status:404});return net.fetch(pathToFileURL(file).href);});
 const content=await locateContent();if(content)assets=new Assets(content,path.join(support,'assets'),{portraitModDir:config.portraitModDir});
 if(!SELFTEST){tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'icon.png')).resize({width:24,height:24}));tray.setToolTip(APP);tray.on('click',editorWindow);menu();const saves=listSaves(saveRoot);if(!config.selected&&saves[0])config.selected=saves[0].id;if(config.selected&&assets)try{await select(config.selected);}catch(e){log(e.message);}if(active){if(config.sceneMode==='original')legacy.activate();else buildDesktop();}updateWeather();}
 const win=editorWindow();if(SELFTEST)win.webContents.once('did-finish-load',()=>selftest(win));
 if(!SELFTEST){setInterval(checkFiles,2500);setInterval(updateWeather,30*60*1000);setInterval(()=>{for(const s of desktop)try{if(s.attach&&!W.attached(s.attach)){s.attach=W.attach(s.win,physical(s.display.bounds),config.mode);}}catch(e){log(e.message);}},5000);screen.on('display-metrics-changed',()=>{if(desktop.length)buildDesktop();});powerMonitor.on('lock-screen',()=>{locked=true;broadcast('paused',true);stopSaver();});powerMonitor.on('unlock-screen',()=>{locked=false;broadcast('paused',false);});powerMonitor.on('suspend',()=>broadcast('paused',true));powerMonitor.on('resume',()=>broadcast('paused',false));}
}).catch(e=>{log(e.stack);app.exit(1);});

