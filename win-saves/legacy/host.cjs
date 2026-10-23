module.exports=function(bridge){
// Stardew Desk — Windows host (Electron). The same scene as the Mac app (../scene),
// put on every display above the wallpaper and below the desktop icons, driven from a
// leaf icon in the notification area. Mirrors mac/host.js feature for feature:
// settings window, first-run setup, live weather (+ city), screensaver, bulletin board,
// focus farming, mailbox, the game's music and sound effects, start with Windows.
//
//   Run from source:   cd win && npm install && npm start
//   Build:             cd win && npm run dist     (→ dist/Stardew-Desk-win.zip)
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor, dialog, protocol, net, Notification, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const W = require('./winapi');
const CITIES = require('./cities');
const wavebank = require('./wavebank');

const APP_NAME = bridge.title || 'Stardew Desk';
const DATA_VERSION = '7';                       // must match scene/setup.js
const WIN = process.platform === 'win32';

// Name and instance ownership are managed by the save-edition host.

// The farm sits behind other windows by design; don't let Chromium decide it's hidden and stop drawing.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');



const SUPPORT = bridge.support;        // %APPDATA%\Stardew Desk
const sceneDir = path.join(SUPPORT, 'scene');   // code copied from the app + data/ from setup
const codeDir = path.join(__dirname, 'scene');
const MUSIC_DIR = path.join(SUPPORT, 'music');
const LOG_PATH = path.join(SUPPORT, 'StardewDesk.log');
const PRELOAD = path.join(__dirname, 'preload.js');
const UI_PRELOAD = path.join(__dirname, 'ui-preload.js');

let scenes = [];          // {display, win, wc, ready, fps, cursor, attach}
let coverage = [];
let windowRects = [];
let editor = null;        // {win, wc, ready, display}
let setup = null;         // {win, wc, tried}
let saver = null;         // {views:[{win, wc, ready}], started, lastIdle, lastCursor, alpha, closing, preview}
let tray = null;
let audioWin = null;
let locked = false, asleep = false, quitting = false;
let timeOverride = null;
let sceneStatus = '';
const weather = { lat: 30.27, lon: 120.15, refresh: 30 * 60, configured: false, busy: false, failures: 0, lastAttempt: 0, latest: null };

// ---------- logging ----------
function log(msg) {
  const line = new Date().toISOString() + ' ' + msg + '\n';
  if (!app.isPackaged) process.stdout.write(line);
  try { fs.mkdirSync(SUPPORT, { recursive: true }); fs.appendFileSync(LOG_PATH, line); } catch { /* ignore */ }
}
function guard(name, fn) {
  return function (...args) {
    try { const r = fn.apply(null, args); if (r && r.catch) r.catch(e => log('错误 [' + name + ']: ' + (e && e.stack || e))); return r; }
    catch (e) { log('错误 [' + name + ']: ' + (e && e.stack || e)); }
  };
}
process.on('uncaughtException', e => log('未处理的错误：' + (e && e.stack || e)));

// ---------- settings (a JSON file next to the data) ----------
const SETTINGS_PATH = path.join(SUPPORT, 'settings.json');
let store = {};
try { store = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) || {}; } catch { store = {}; }
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(SUPPORT, { recursive: true }); fs.writeFileSync(SETTINGS_PATH + '.tmp', JSON.stringify(store, null, 1)); fs.renameSync(SETTINGS_PATH + '.tmp', SETTINGS_PATH); }
    catch (e) { log('设置保存失败：' + e); }
  }, 200);
}
const get = (k, d) => (k in store ? store[k] : d);
const set = (k, v) => { store[k] = v; saveSettings(); };

const PETS = [['cat0', '橘猫'], ['cat1', '灰猫'], ['cat2', '黄猫'], ['cat3', '白猫'], ['cat4', '黑猫'], ['cat5', '紫猫'],
  ['dog0', '黄狗'], ['dog1', '牧羊犬'], ['dog2', '金毛'], ['dog3', '黑白花狗'], ['dog4', '棕狗'], ['dog5', '紫狗'], ['none', '不养']];
const MUSIC_VOL = { low: 0.12, mid: 0.25, high: 0.45 };
const QUALITY = { eco: { fps: 10, title: '省电（10 fps）' }, balanced: { fps: 15, title: '平衡（15 fps）' }, smooth: { fps: 30, title: '流畅（30 fps）' } };
const S = {
  get paused() { return get('paused', false); }, set paused(v) { set('paused', v); },
  get quality() { const q = get('quality', 'balanced'); return QUALITY[q] ? q : 'balanced'; }, set quality(v) { set('quality', v); },
  get season() { return get('season', 'auto'); }, set season(v) { set('season', v); },
  get weather() { return get('weather', 'live'); }, set weather(v) { set('weather', v); },
  get saverMinutes() { return get('saverMinutes', 5); }, set saverMinutes(v) { set('saverMinutes', v); },
  get focus() { return get('focus', null); }, set focus(v) { set('focus', v || null); },
  get focusLog() { return get('focusLog', null); }, set focusLog(v) { set('focusLog', v || null); },
  get mailWatch() { return get('mailWatch', true); }, set mailWatch(v) { set('mailWatch', v); },
  get location() { return get('location', null); }, set location(v) { set('location', v || null); },
  get contentDir() { return get('contentDir', null); }, set contentDir(v) { set('contentDir', v || null); },
  get music() { const m = get('music', 'off'); return m === 'always' || m === 'saver' ? m : 'off'; }, set music(v) { set('music', v); },
  get musicVolume() { const v = get('musicVolume', 'mid'); return MUSIC_VOL[v] ? v : 'mid'; }, set musicVolume(v) { set('musicVolume', v); },
  get pet() { return get('pet', 'cat0'); }, set pet(v) { set('pet', v); },
  get layout() { return get('layout', {}) || {}; }, set layout(v) { set('layout', v || {}); },
  get board() { return get('board', null); }, set board(v) { set('board', v || null); },
  get frame() { return get('frame', null); }, set frame(v) { set('frame', v); },
  get desktopMode() { const m = get('desktopMode', 'auto'); return ['auto', 'nolayer', 'window'].includes(m) ? m : 'auto'; },
  set desktopMode(v) { set('desktopMode', v); },
};

// ---------- the scene folder, served as sdv://app/… ----------
// A real origin (not file://) so canvas reads and fetches inside the scene just work.
// The parent registers sdv:// before app readiness.
function serveScene() {
  protocol.handle('sdv', async req => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    if(rel==='sprite-frames.js')return net.fetch(pathToFileURL(path.join(__dirname,'../ui/sprite-frames.js')).toString());
    if(rel==='game-font.js')return net.fetch(pathToFileURL(path.join(__dirname,'../ui/game-font.js')).toString());
    if(rel==='game-font.json'||rel==='game-font.ttf'||/^font-pages\/[a-f0-9]{64}\.png$/.test(rel)){
      const font=await bridge.font();if(!font)return new Response('null',{headers:{'Content-Type':'application/json'}});
      if(rel==='game-font.json')return new Response(JSON.stringify({...font.info,url:'sdv://app/game-font.ttf',pages:font.info.pages.map(p=>({...p,url:p.url.replace('farm://app/assets/','sdv://app/font-pages/')}))}),{headers:{'Content-Type':'application/json'}});
      const target=rel==='game-font.ttf'?font.file:path.join(font.cache,path.basename(rel)),response=await net.fetch(pathToFileURL(target).toString());return new Response(await response.arrayBuffer(),{headers:{'Content-Type':rel.endsWith('.ttf')?'font/ttf':'image/png','Access-Control-Allow-Origin':'*'}});
    }
    const file = path.normalize(path.join(sceneDir, rel));
    if (!file.startsWith(path.normalize(sceneDir + path.sep))) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === 'data' || name[0] === '.') continue;
    const s = path.join(src, name), d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
function prepareRunDir() {
  fs.mkdirSync(path.join(sceneDir, 'data', 'img'), { recursive: true });
  copyDir(codeDir, sceneDir);
}
function dataReady() {
  try {
    return fs.existsSync(path.join(sceneDir, 'data', 'farm.js'))
      && fs.readFileSync(path.join(sceneDir, 'data', 'version.txt'), 'utf8').trim() === DATA_VERSION;
  } catch { return false; }
}

// ---------- talking to pages ----------
function run(wc, js) { if (wc && !wc.isDestroyed()) wc.executeJavaScript(js, true).catch(() => {}); }
function call(s, js) { if (s.ready) run(s.wc, js); }
function callAll(js) { scenes.forEach(s => call(s, js)); bridge.send(js); }
function editorCall(js) { if (editor && editor.ready) run(editor.wc, js); }
function webPrefs(role, extra) {
  return Object.assign({ preload: PRELOAD, additionalArguments: ['--sdv-role=' + role], contextIsolation: true, sandbox: true,
    backgroundThrottling: false, spellcheck: false }, extra || {});
}
const ownHwnds = new Set();
function remember(win) { if (WIN) { try { ownHwnds.add(W.hwndOf(win)); } catch { /* fine */ } } }
function forget(win) { if (WIN) { try { ownHwnds.delete(W.hwndOf(win)); } catch { /* fine */ } } }

ipcMain.on('sdv', guard('message', (e, body) => onMessage(e.sender, body || {})));

// ---------- desktop scenes ----------
function physRect(b) {
  if (!WIN) return { x: b.x, y: b.y, w: b.width, h: b.height };
  const r = screen.dipToScreenRect(null, b);
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}
function makeScene(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, show: false, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false,
    backgroundColor: '#1c140f', title: APP_NAME, webPreferences: webPrefs('mac'),
  });
  const s = { display, displayKey: displayKey(display), win, wc: win.webContents, ready: false, fps: -1, cursor: 'init', attach: null };
  win.once('ready-to-show', guard('attach', () => {
    win.showInactive();
    s.attach = W.attach(win, physRect(b), S.desktopMode);
    if (WIN) log('桌面层：' + (s.attach ? s.attach.mode : '失败，窗口留在普通层'));
    remember(win);
  }));
  win.on('closed', () => forget(win));
  win.loadURL('sdv://app/index.html');
  return s;
}
function closeScene(s) { try { forget(s.win); s.win.destroy(); } catch { /* gone */ } }
function buildScenes() {
  bridge.activateOriginal();
  hideCatcher();
  scenes.forEach(closeScene);
  scenes = screen.getAllDisplays().map(makeScene);
  coverage = scenes.map(() => 0);
  log('场景窗口：' + scenes.length + ' 块屏幕');
}
function displayKey(d) { const b = d.bounds; return [d.id, b.x, b.y, b.width, b.height, d.scaleFactor].join(','); }
let rebuildTimer = null;
// Windows fires display-metrics-changed for things that don't move the farm at all (the taskbar
// showing or hiding, the work area changing, window transitions). Rebuilding every scene then
// flashes the desktop and resets the animals, so only rebuild when the displays really changed.
// force: always rebuild (waking from sleep).
function rebuildSoon(force) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(guard('rebuild', () => {
    if (!dataReady()) return;
    if (force !== true) {
      const keys = screen.getAllDisplays().map(displayKey);
      if (scenes.length === keys.length && scenes.every((s, i) => s.displayKey === keys[i])) {
        log('显示器参数通知：布局未变化，保留现有场景');
        return;
      }
    }
    buildScenes();
  }), 800);
}
// Explorer restarted (or the desktop changed under us): put the farm back.
function checkAttached() {
  if (!WIN) return;
  if (scenes.some(s => s.attach && !W.attached(s.attach))) { log('桌面层丢失，重新放回'); buildScenes(); }
}

function setFps(s, fps) {
  if (fps <= 0 && catcher.scene === s) hideCatcher();
  if (!s.ready || fps === s.fps) return;
  s.fps = fps;
  call(s, 'SDV.host.setFps(' + fps + ')');
}

// ---------- the settings everything shares ----------
function applySetting(key, value) {
  if (key === 'season') S.season = value || 'auto';
  else if (key === 'weather') S.weather = value || 'live';
  else if (key === 'frame') S.frame = value;
  else if (key === 'layout') S.layout = value;
  else if (key === 'pet') S.pet = value || 'cat0';
  else if (key === 'time') timeOverride = value == null ? null : value;
  else if (key === 'board') { boardTicked(S.board, value); S.board = value; }
  else return;
  callAll('SDV.host.apply(' + JSON.stringify(key) + ',' + JSON.stringify(value == null ? null : value) + ')');
}
function settingsScript() {
  const js = [
    'SDV.host.apply("season",' + JSON.stringify(S.season) + ')',
    'SDV.host.apply("weather",' + JSON.stringify(S.weather) + ')',
    'SDV.host.apply("time",' + JSON.stringify(timeOverride) + ')',
  ];
  if (S.frame) js.push('SDV.host.apply("frame",' + JSON.stringify(S.frame) + ')');
  const al = autoLocation();
  if (al) js.push('SDV.host.apply("location",' + JSON.stringify(al) + ')');
  js.push('SDV.host.apply("layout",' + JSON.stringify(S.layout) + ')');
  js.push('SDV.host.apply("pet",' + JSON.stringify(S.pet) + ')');
  js.push('SDV.host.apply("board",' + JSON.stringify(S.board) + ')');
  js.push('SDV.host.mail(' + Math.max(0, mail.lastCount) + ')');
  js.push('SDV.host.focus(' + JSON.stringify(focusPayload()) + ')');
  if (weather.latest) js.push('SDV.host.setLiveWeather(' + JSON.stringify(weather.latest) + ')');
  return js.join(';');
}
function pushSettings(s) { call(s, settingsScript()); s.fps = -1; applyPolicy(); }

function onMessage(wc, body) {
  if (setup && setup.wc === wc) { onSetupMessage(body); return; }
  if (saver) {
    const v = saver.views.find(x => x.wc === wc);
    if (v) {
      if (body.type === 'hello') { v.ready = true; run(v.wc, settingsScript() + ';SDV.host.setFps(30)'); }
      return;
    }
  }
  if (editor && editor.wc === wc) {
    if (body.type === 'hello') {
      editor.ready = true;
      const d = editor.display, k = d.scaleFactor;
      editorCall('SDV.host.setTarget(' + Math.round(d.bounds.width * k) + ',' + Math.round(d.bounds.height * k) + ');' + settingsScript());
      if (boardPanelWanted) { boardPanelWanted = false; editorCall('SDV.host.openBoard()'); }
    } else if (body.type === 'setting') applySetting(body.key, body.value);
    else if (body.type === 'mailRead') markMailRead();
    return;
  }
  const s = scenes.find(x => x.wc === wc);
  if (!s) return;
  if (body.type === 'hello') {
    s.ready = true;
    const loc = autoLocation();
    if (loc) { body.lat = loc.lat; body.lon = loc.lon; }
    if (typeof body.lat === 'number' && typeof body.lon === 'number') {
      const changed = !weather.configured || body.lat !== weather.lat || body.lon !== weather.lon;
      weather.lat = body.lat; weather.lon = body.lon;
      weather.refresh = (body.refreshMinutes || 30) * 60;
      weather.configured = true;
      if (changed) { weather.lastAttempt = 0; weatherTick(); }
    }
    pushSettings(s);
    log('场景就绪');
  } else if (body.type === 'status') sceneStatus = body.text || '';
  else if (body.type === 'mailRead') markMailRead();
  else if (body.type === 'boardRect') setCatcher(s, body.rect || null);
  else if (body.type === 'board') setBoard(body.value);
}

// ---------- settings window ----------
function openEditor() {
  if (!editor || editor.win.isDestroyed()) {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = d.workArea, sw = d.bounds.width, sh = d.bounds.height;
    const cw = Math.round(Math.min(wa.width * 0.72, (wa.height - 60) * sw / sh));
    const ch = Math.round(cw * sh / sw);
    const win = new BrowserWindow({ width: cw, height: ch, useContentSize: true, title: APP_NAME + ' 设置', show: false,
      backgroundColor: '#1c140f', autoHideMenuBar: true, icon: appIcon(), webPreferences: webPrefs('editor') });
    win.setMenu(null);
    win.setAspectRatio(sw / sh);
    editor = { win, wc: win.webContents, ready: false, display: d };
    win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
    win.on('closed', () => { forget(win); editor = null; });
    win.once('ready-to-show', () => { win.center(); win.show(); remember(win); });
    if(bridge.independent)win.webContents.on('did-finish-load',()=>run(win.webContents,"document.querySelector('#panel h1').textContent='自定义农场 · 独立模式'"));
    win.loadURL('sdv://app/index.html');
    return;
  }
  editor.win.show();
  editor.win.focus();
}

// ---------- the bulletin board: clicks on the open notice ----------
// The farm is below the desktop icons and gets no clicks. While the notice is open,
// we watch the left mouse button: a press over the notice (and over the bare desktop,
// not over some window) becomes a click in the scene. The desktop still sees the click
// too, which only deselects icons.
const catcher = { scene: null, rect: null, timer: null, wasDown: false };
function setCatcher(s, r) {
  if (!r || !r.w || !r.h || S.paused || !WIN) { hideCatcher(); return; }
  catcher.scene = s; catcher.rect = r;
  if (!catcher.timer) catcher.timer = setInterval(guard('click', catcherTick), 30);
}
function hideCatcher() {
  if (catcher.timer) clearInterval(catcher.timer);
  catcher.timer = null; catcher.rect = null; catcher.scene = null;
}
function catcherTick() {
  const down = W.mouseDown();
  if (down && !catcher.wasDown && catcher.rect && catcher.scene) {
    const p = screen.getCursorScreenPoint(), b = catcher.scene.display.bounds, r = catcher.rect;
    const x = p.x - b.x, y = p.y - b.y;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      const ph = screen.dipToScreenPoint(p);
      if (!W.coveredAt(ph.x, ph.y, ownHwnds)) call(catcher.scene, 'SDV.host.click(' + Math.round(x) + ',' + Math.round(y) + ')');
    }
  }
  catcher.wasDown = down;
}

// ---------- mailbox: new files on the Desktop / in Downloads ----------
const mail = { known: {}, fresh: [], blocked: {}, lastCount: -1 };
const MAIL_EXPIRE = 6 * 3600;
function mailDirs() { return { desktop: app.getPath('desktop'), downloads: app.getPath('downloads') }; }
function listDir(dir) {
  try {
    return fs.readdirSync(dir).filter(n => n[0] !== '.' && n[0] !== '~' && !/^desktop\.ini$/i.test(n)
      && !/\.(crdownload|download|part|partial|tmp)$/i.test(n));
  } catch { return null; }
}
function mailTick() {
  if (!S.mailWatch) { if (mail.lastCount !== 0) pushMail(0); return; }
  const now = Date.now() / 1000, dirs = mailDirs();
  Object.keys(dirs).forEach(k => {
    const names = listDir(dirs[k]);
    if (!names) { mail.blocked[k] = true; return; }
    mail.blocked[k] = false;
    const setOf = {};
    names.forEach(n => { setOf[n] = true; });
    if (!mail.known[k]) { mail.known[k] = setOf; return; }
    names.forEach(n => { if (!mail.known[k][n]) mail.fresh.push({ dir: k, name: n, t: now }); });
    mail.known[k] = setOf;
  });
  mail.fresh = mail.fresh.filter(f => mail.known[f.dir] && mail.known[f.dir][f.name] && now - f.t < MAIL_EXPIRE);
  pushMail(mail.fresh.length);
}
function pushMail(n) {
  if (n === mail.lastCount) return;
  mail.lastCount = n;
  callAll('SDV.host.mail(' + n + ')');
  editorCall('SDV.host.mail(' + n + ')');
}
function markMailRead() { mail.fresh = []; pushMail(0); }

// ---------- focus farming ----------
const FOCUS_CROP = { spring: ['cauliflower', '花椰菜'], summer: ['melon', '甜瓜'], fall: ['pumpkin', '南瓜'], winter: ['powdermelon', '霜瓜'] };
const CROP_ZH = { cauliflower: '花椰菜', melon: '甜瓜', pumpkin: '南瓜', powdermelon: '霜瓜' };
function currentSeason() {
  if (!scenes.length && bridge.season()) return bridge.season();
  if (S.season && S.season !== 'auto') return S.season;
  return ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'][new Date().getMonth()];
}
function todayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function todayLog() { const L = S.focusLog; return L && L.day === todayKey() ? L : { day: todayKey(), n: 0, last: null, crops: {} }; }
function focusPayload() { const o = Object.assign({}, S.focus || {}); o.log = todayLog(); return o; }
function pushFocus() { const js = 'SDV.host.focus(' + JSON.stringify(focusPayload()) + ')'; callAll(js); editorCall(js); }
function startFocus(minutes) {
  const c = FOCUS_CROP[currentSeason()] || FOCUS_CROP.fall;
  S.focus = { start: Date.now() / 1000, dur: minutes * 60, crop: c[0], cropZh: c[1] };
  pushFocus();
}
function giveUpFocus() { S.focus = null; pushFocus(); }
function focusTick() {
  const f = S.focus;
  if (!f) return;
  const now = Date.now() / 1000;
  if (!f.done && now >= f.start + f.dur) {
    f.done = true; f.doneAt = now; S.focus = f;
    const L = todayLog();
    L.n += 1; L.last = f.crop; L.crops[f.crop] = (L.crops[f.crop] || 0) + 1;
    S.focusLog = L;
    notifyUser('专注完成', '收获了一个' + f.cropZh + ' · 今天第 ' + L.n + ' 次');
    pushFocus();
  } else if (f.done && now - f.doneAt > 600) { S.focus = null; pushFocus(); }
}
function notifyUser(title, text, silent) {
  if (bridge.testing) return;
  try { if (Notification.isSupported()) new Notification({ title, body: text, silent: Boolean(silent), icon: appIcon() }).show(); }
  catch (e) { log('通知失败：' + e); }
}
function focusSummary() {
  const L = todayLog();
  const parts = Object.keys(L.crops).map(k => L.crops[k] + ' 个' + (CROP_ZH[k] || k));
  if (L.notes) parts.push(L.notes + ' 张做完的待办');
  return parts.join('、');
}
function shippedToday() { const L = todayLog(); return L.n + (L.notes || 0); }

// ---------- bulletin board: to-dos and the countdown to the end of the day ----------
let boardPanelWanted = false;
function boardData() {
  const b = S.board || {};
  b.todos = b.todos || [];
  b.pay = b.pay || { daily: 0, start: '09:00', end: '18:00', lunch: false, lunchStart: '12:00', lunchEnd: '13:30', days: [1, 2, 3, 4, 5] };
  if (b.payOn == null) b.payOn = false;
  return b;
}
function setBoard(b) {
  boardTicked(S.board, b);
  S.board = b;
  const js = 'SDV.host.apply("board",' + JSON.stringify(b) + ')';
  callAll(js); editorCall(js);
}
function hm(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function boardPay(b, d) {
  if (!b.payOn) return null;
  const p = b.pay, s = hm(p.start), e = hm(p.end);
  if (s == null || e == null || e <= s) return null;
  const daily = Math.max(0, Number(p.daily) || 0);
  const o = b.today, work = o && o.day === todayKey() ? o.mode === 'work' : (p.days || []).indexOf(d.getDay()) >= 0;
  if (!work) return { status: 'rest', daily, scheduled: (p.days || []).indexOf(d.getDay()) >= 0 };
  const ls = hm(p.lunchStart), le = hm(p.lunchEnd);
  const lunch = p.lunch && ls != null && le != null && ls > s && le > ls && le < e;
  const paid = e - s - (lunch ? le - ls : 0);
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const cl = (v, a, z) => Math.max(a, Math.min(z, v));
  const worked = cl(m, s, e) - s - (lunch ? cl(m, ls, le) - ls : 0);
  const status = m < s ? 'before' : m >= e ? 'after' : lunch && m >= ls && m < le ? 'lunch' : 'work';
  return { status, daily, earned: daily * worked / paid, toEnd: (e - m) * 60, sinceEnd: (m - e) * 60, toStart: (s - m) * 60,
    scheduled: (p.days || []).indexOf(d.getDay()) >= 0 };
}
function boardTodos(b) { const t = todayKey(); return b.todos.filter(x => !x.done || x.doneDay === t); }
function yuan(v) { return Math.floor(v + 1e-9) + '金'; }
function hmLeft(sec) { sec = Math.max(0, Math.ceil(sec / 60)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
function boardTick() {
  const b = S.board;
  if (!b) return;
  const t = todayKey();
  const keep = (b.todos || []).filter(x => !x.done || x.doneDay === t);
  let changed = keep.length !== (b.todos || []).length;
  if (b.today && b.today.day !== t) { b.today = null; changed = true; }
  if (changed) { b.todos = keep; setBoard(b); }
  const P = boardPay(boardData(), new Date());
  if (P && P.status === 'after' && b.remind !== false && P.sinceEnd < 1800 && get('boardNotified', '') !== t) {
    set('boardNotified', t);
    const left = boardTodos(b).filter(x => !x.done).length;
    const rang = playSfx('offwork', b);
    notifyUser('下班啦', (b.showMoney !== false && P.daily ? '今天挣了 ' + yuan(P.daily) + '，' : '') + (left ? '还有 ' + left + ' 件待办留到明天' : '辛苦了'), rang);
  }
}
function boardTicked(before, after) {
  const was = {};
  let plus = 0, minus = 0;
  ((before && before.todos) || []).forEach(t => { was[t.id] = Boolean(t.done); });
  ((after && after.todos) || []).forEach(t => {
    if (!(t.id in was)) return;
    if (t.done && !was[t.id]) plus++;
    else if (!t.done && was[t.id]) minus++;
  });
  if (!plus && !minus) return;
  const L = todayLog();
  L.notes = Math.max(0, (L.notes || 0) + plus - minus);
  S.focusLog = L;
  pushFocus();
  if (plus) playSfx('tick', after);
}
async function addTodoDialog() {
  const text = await promptText({ title: '添加今日待办', message: '写一件今天要做的事，回车添加。', placeholder: '比如：回复邮件', ok: '添加' });
  const t = (text || '').trim().slice(0, 40);
  if (!t) return;
  const b = boardData();
  b.todos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, done: false });
  setBoard(b);
}
function boardAction(kind, val) {
  const b = boardData();
  if (kind === 'todo') {
    b.todos.forEach(x => { if (x.id === val) { x.done = !x.done; x.doneDay = x.done ? todayKey() : undefined; } });
    setBoard(b);
  } else if (kind === 'boardDay') { b.today = val === 'auto' ? null : { day: todayKey(), mode: val }; setBoard(b); }
  else if (kind === 'boardAdd') addTodoDialog();
  else if (kind === 'boardSound') { b.sound = !sfxOn(b); setBoard(b); if (b.sound) { sfx.tried = false; playSfx('tick', b); } }
  else if (kind === 'boardEdit') {
    const ready = editor && editor.ready;
    openEditor();
    if (ready) editorCall('SDV.host.openBoard()'); else boardPanelWanted = true;
  }
}

// ---------- small dialogs ----------
function promptText(opts) {
  return new Promise(resolve => {
    const win = new BrowserWindow({ width: 400, height: 210, useContentSize: true, resizable: false, minimizable: false, maximizable: false,
      title: opts.title || APP_NAME, show: false, autoHideMenuBar: true, alwaysOnTop: true, icon: appIcon(),
      webPreferences: { preload: UI_PRELOAD, contextIsolation: true, sandbox: true } });
    win.setMenu(null);
    let done = false;
    const finish = v => { if (done) return; done = true; ipcMain.removeListener('prompt:done', onDone); if (!win.isDestroyed()) win.destroy(); resolve(v); };
    const onDone = (e, v) => { if (e.sender === win.webContents) finish(v); };
    ipcMain.on('prompt:done', onDone);
    win.on('closed', () => finish(null));
    win.webContents.once('did-finish-load', () => { win.webContents.send('prompt:init', opts); win.show(); win.focus(); });
    win.loadFile(path.join(__dirname, 'prompt.html'));
  });
}
async function infoAlert(title, text) {
  await dialog.showMessageBox({ type: 'info', title: APP_NAME, message: title, detail: text, buttons: ['好'], noLink: true });
}

// ---------- the weather city ----------
function autoLocation() {
  if (S.location) return S.location;
  try {
    const c = CITIES.TZ_CITY[Intl.DateTimeFormat().resolvedOptions().timeZone];
    return c ? { lat: c[0], lon: c[1] } : null;
  } catch { return null; }
}
function currentLocation() { return autoLocation() || CITIES.DEFAULT_LOC; }
function locationLabel() {
  if (S.location && S.location.name) return S.location.name;
  return autoLocation() ? '跟随时区自动' : '杭州（默认）';
}
function setLocation(loc) {
  log('设置天气城市：' + JSON.stringify(loc));
  S.location = loc;
  const cur = currentLocation();
  const js = 'SDV.host.apply("location",' + JSON.stringify(cur) + ')';
  callAll(js); editorCall(js);
  weather.lat = cur.lat; weather.lon = cur.lon;
  weather.configured = true; weather.failures = 0; weather.lastAttempt = 0;
  weatherTick();
}
async function geocode(name) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?count=10&language=zh&format=json&name=' + encodeURIComponent(name);
  try {
    const r = await net.fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j.results || [];
  } catch { return null; }
}
async function chooseCity(list) {
  const buttons = list.map((r, i) => (i + 1) + '. ' + [r.name, r.admin1, r.country].filter(Boolean).join(' · '));
  buttons.push('取消');
  // noLink: false → Windows lists the choices as a column of command links
  const res = await dialog.showMessageBox({ type: 'question', title: APP_NAME, message: '找到好几个，选一个', buttons, cancelId: buttons.length - 1, noLink: false });
  return res.response < list.length ? list[res.response] : null;
}
async function cityDialog() {
  const text = await promptText({ title: '天气跟着哪个城市？', message: '输入城市名，比如：北京、苏州、成都。\n国外城市也可以用英文，比如 Tokyo、London。',
    placeholder: '城市名', value: S.location && S.location.name ? S.location.name : '' });
  const t = (text || '').trim().slice(0, 40);
  log('更换城市：输入「' + t + '」');
  if (!t) return;
  const hit = CITIES.lookup(t);
  if (hit) { setLocation(hit); return cityDone(); }
  const res = await geocode(t);
  if (res === null) return infoAlert('没连上网络', '这个城市要联网查一下位置，请检查网络后再试。');
  if (!res.length) return infoAlert('没找到「' + t + '」', '换个写法试试：去掉「市」「县」，或者用拼音、英文。');
  res.sort((a, b) => (b.population || 0) - (a.population || 0));
  const pick = res.length > 1 ? await chooseCity(res) : res[0];
  if (!pick) return;
  setLocation({ name: pick.name, lat: Math.round(pick.latitude * 100) / 100, lon: Math.round(pick.longitude * 100) / 100 });
  return cityDone();
}
function cityDone() {
  return infoAlert('天气已切换到「' + S.location.name + '」', '日出日落马上按新城市计算，实时天气几秒后更新。\n菜单 天气 › 所在城市 里可以看到当前城市。');
}

// ---------- weather ----------
function weatherLoad() { const w = get('weatherLive', null); if (w) weather.latest = w; }
async function weatherFetch() {
  weather.lastAttempt = Date.now();
  weather.busy = true;
  let ok = false;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + weather.lat + '&longitude=' + weather.lon
      + '&current=weather_code,precipitation,wind_speed_10m&timezone=auto';
    const r = await net.fetch(url, { signal: AbortSignal.timeout(20000) });
    const cur = r.ok ? (await r.json()).current : null;
    if (cur && typeof cur.weather_code === 'number') {
      weather.latest = { code: cur.weather_code, precip: cur.precipitation || 0, wind: cur.wind_speed_10m || 0, at: Date.now() };
      set('weatherLive', weather.latest);
      const js = 'SDV.host.setLiveWeather(' + JSON.stringify(weather.latest) + ')';
      callAll(js); editorCall(js);
      ok = true;
    }
  } catch { /* offline */ }
  weather.busy = false;
  if (ok) { weather.failures = 0; log('天气已更新：' + JSON.stringify(weather.latest)); }
  else { weather.failures++; log('天气获取失败（第 ' + weather.failures + ' 次）'); }
}
function weatherTick() {
  if (!weather.configured || weather.busy) return;
  const wait = weather.failures > 0 ? Math.min(weather.refresh, 5 * 60 * Math.pow(2, weather.failures - 1)) : weather.refresh;
  const age = Date.now() - (weather.latest ? weather.latest.at : 0);
  const since = Date.now() - weather.lastAttempt;
  if (since >= wait * 1000 && (weather.failures > 0 || age >= weather.refresh * 1000 || weather.lastAttempt === 0)) weatherFetch();
}

// ---------- first-run setup: read the pictures from the user's game ----------
function looksLikeContent(dir) { return Boolean(dir) && fs.existsSync(path.join(dir, 'Maps', 'Farm.xnb')); }
function regQuery(key, value) {
  return new Promise(resolve => {
    if (!WIN) return resolve(null);
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (err, out) => {
      const m = !err && /REG_\w+\s+(.+)\s*$/m.exec(out || '');
      resolve(m ? m[1].trim() : null);
    });
  });
}
async function findContent() {
  const cands = [];
  if (S.contentDir) cands.push(S.contentDir);
  if (WIN) {
    const steamRoots = [];
    const reg = (await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath')) || (await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'));
    if (reg) steamRoots.push(reg.replace(/\//g, '\\'));
    steamRoots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
    for (const root of steamRoots) {
      cands.push(path.join(root, 'steamapps', 'common', 'Stardew Valley', 'Content'));
      try {
        const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) cands.push(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'Stardew Valley', 'Content'));
      } catch { /* no Steam here */ }
    }
    for (const drive of 'CDEFGH') {
      cands.push(drive + ':\\SteamLibrary\\steamapps\\common\\Stardew Valley\\Content');
      cands.push(drive + ':\\XboxGames\\Stardew Valley\\Content\\Content');
      cands.push(drive + ':\\GOG Games\\Stardew Valley\\Content');
    }
    cands.push('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Stardew Valley\\Content');
    cands.push('C:\\Program Files\\ModifiableWindowsApps\\Stardew Valley\\Content');
  } else {
    const home = app.getPath('home');
    cands.push(path.join(home, '.local/share/Steam/steamapps/common/Stardew Valley/Content'));
    cands.push(path.join(home, 'Library/Application Support/Steam/steamapps/common/Stardew Valley/Contents/Resources/Content'));
  }
  if (process.env.SDV_CONTENT) cands.unshift(process.env.SDV_CONTENT);   // for testing
  return cands.find(looksLikeContent) || null;
}
function resolveContent(picked) {
  const tries = [picked, path.join(picked, 'Content'), path.join(picked, 'Content', 'Content'),
    path.join(picked, 'Stardew Valley', 'Content'), path.join(picked, 'Contents', 'Resources', 'Content')];
  return tries.find(looksLikeContent) || null;
}
function listXnb(root) {
  const out = [];
  const walk = rel => {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(r);
      else if (/\.xnb$/i.test(ent.name)) out.push(r);
    }
  };
  walk('');
  return out;
}
function openSetup() {
  if(bridge.independent){bridge.choosePack?.();return;}
  if (setup) closeSetup();
  const win = new BrowserWindow({ width: 560, height: 470, useContentSize: true, resizable: false, maximizable: false,
    title: '欢迎使用 ' + APP_NAME, show: false, autoHideMenuBar: true, icon: appIcon(), webPreferences: webPrefs('setup') });
  win.setMenu(null);
  setup = { win, wc: win.webContents, tried: false };
  win.on('closed', () => { if (setup && setup.win === win) setup = null; if (!dataReady() && !scenes.length && !quitting) log('设置窗口关了，还没读取游戏画面'); });
  win.once('ready-to-show', () => { win.center(); win.show(); });
  win.loadURL('sdv://app/setup.html');
}
function closeSetup() { if (!setup) return; const w = setup.win; setup = null; if (!w.isDestroyed()) w.destroy(); }
function setupCall(js) { if (setup) run(setup.wc, js); }
async function sendSetupStart() {
  const c = await findContent();
  if (!setup) return;
  if (!c) { setupCall('SDV_SETUP.start(' + JSON.stringify({ content: null, tried: setup.tried }) + ')'); return; }
  S.contentDir = c;
  const files = listXnb(c);
  log('游戏素材：' + c + '（' + files.length + ' 个文件）');
  setupCall('SDV_SETUP.start(' + JSON.stringify({ content: c, files, music: S.music }) + ')');
}
async function onSetupMessage(m) {
  if (m.type === 'hello') sendSetupStart();
  else if (m.type === 'choose') {
    const r = await dialog.showOpenDialog(setup ? setup.win : undefined, {
      title: '选择 Stardew Valley 所在的文件夹', properties: ['openDirectory'],
      message: '选择星露谷物语的安装文件夹（里面有 Content 文件夹）',
    });
    if (!setup) return;
    if (!r.canceled && r.filePaths[0]) { setup.tried = true; const c = resolveContent(r.filePaths[0]); if (c) S.contentDir = c; }
    sendSetupStart();
  } else if (m.type === 'read') {
    let b64 = null;
    try {
      const file = path.normalize(path.join(S.contentDir, m.path));
      if (file.startsWith(path.normalize(S.contentDir))) b64 = fs.readFileSync(file).toString('base64');
    } catch { /* missing */ }
    setupCall('SDV_SETUP.file(' + Number(m.id) + ',' + (b64 ? '"' + b64 + '"' : 'null') + ')');
  } else if (m.type === 'write') {
    if (!/^[\w\-]+(\/[\w\-]+)*\.(png|js|txt)$/.test(m.path || '')) { log('拒绝写入 ' + m.path); return; }
    const file = path.join(sceneDir, 'data', ...m.path.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(m.b64, 'base64'));
  } else if (m.type === 'finish') {
    if (m.music) S.music = m.music;
    closeSetup();
    if (scenes.length) reloadScenes(); else buildScenes();
    log('初次设置完成');
    musicTick();
  }
}
function reloadScenes() {
  scenes.forEach(s => { s.ready = false; s.fps = -1; s.wc.reload(); });
  if (editor) { editor.ready = false; editor.wc.reload(); }
}

// ---------- music and sound effects ----------
// The game's own tracks, taken out of its wave bank the first time they're wanted, and
// played by a hidden window (audio.html) a track at a time with a quiet gap between.
const MUSIC = {
  spring: [['spring1', 93], ['spring2', 91], ['spring3', 92]],
  summer: [['summer1', 122], ['summer2', 123], ['summer3', 115]],
  fall: [['fall1', 121], ['fall2', 119], ['fall3', 120]],
  winter: [['winter1', 126], ['winter2', 124], ['winter3', 125]],
};
const SFX = { tick: 5, offwork: 326 };
const music = { playing: null, season: null, last: null, gapUntil: 0, stopAt: 0, failed: {}, preparing: null };
const sfx = { tried: false, sent: {} };
function musicFile(name) { return path.join(MUSIC_DIR, name + '.wav'); }
function waveBank() { if(bridge.independent)return null;return S.contentDir ? path.join(S.contentDir, 'XACT', 'Wave Bank.xwb') : null; }
function audioWindow() {
  if (audioWin && !audioWin.isDestroyed()) return audioWin;
  audioWin = new BrowserWindow({ show: false, width: 200, height: 100, skipTaskbar: true,
    webPreferences: { preload: UI_PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  audioWin.loadFile(path.join(__dirname, 'audio.html'));
  sfx.sent = {};
  return audioWin;
}
function audioSend(channel, data) {
  const w = audioWindow();
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => w.webContents.send(channel, data));
  else w.webContents.send(channel, data);
}
ipcMain.on('audio:ended', (e, m) => { if (music.playing === m.name) { music.playing = null; music.gapUntil = Date.now() + (20 + Math.random() * 40) * 1000; } });
ipcMain.on('audio:error', (e, m) => { log('播放失败：' + m.name + ' ' + m.message); if (music.playing === m.name) { music.playing = null; music.gapUntil = Date.now() + 60000; } });
function extractTracks(tracks, label) {
  const xwb = waveBank();
  if (!xwb || !fs.existsSync(xwb)) return null;
  try { return wavebank.extract(xwb, MUSIC_DIR, tracks, log); }
  catch (e) { log(label + '准备失败：' + e); return null; }
}
function sfxOn(b) { return ((b || S.board || {}).sound) !== false; }
function playSfx(name, b) {
  if (bridge.testing) return false;
  if (!sfxOn(b)) return false;
  if (!fs.existsSync(musicFile('sfx_' + name))) {
    if (sfx.tried) return false;
    sfx.tried = true;
    if (!extractTracks(Object.keys(SFX).map(k => ['sfx_' + k, SFX[k]]), '音效')) return false;
  }
  const msg = { name, volume: name === 'tick' ? 0.55 : 0.7 };
  if (!sfx.sent[name]) { try { msg.bytes = fs.readFileSync(musicFile('sfx_' + name)); sfx.sent[name] = true; } catch { return false; } }
  audioSend('audio:sfx', msg);
  return true;
}
function musicWanted() {
  if (bridge.testing) return false;
  if (locked || asleep) return false;
  if (S.music === 'always') return !S.paused;
  if (S.music === 'saver') return Boolean(saver) || bridge.isSaver();
  return false;
}
function musicStop(fade) {
  if (!music.playing) return;
  if (fade) { audioSend('audio:volume', { volume: 0, seconds: 1.5 }); music.stopAt = Date.now() + 1600; }
  else { audioSend('audio:stop'); music.playing = null; music.stopAt = 0; }
}
function musicTick() {
  if (music.stopAt && Date.now() >= music.stopAt) musicStop(false);
  if (!musicWanted()) { if (music.playing && !music.stopAt) musicStop(true); return; }
  const season = currentSeason();
  let ready = MUSIC[season].filter(t => fs.existsSync(musicFile(t[0])));
  if (ready.length < 3 && !music.failed[season]) {
    music.preparing = season;
    const done = extractTracks(MUSIC[season], season + ' 配乐');
    music.preparing = null;
    if (!done) { music.failed[season] = waveBank() ? '配乐准备失败，详情见日志' : '找不到游戏的音乐文件'; }
    ready = MUSIC[season].filter(t => fs.existsSync(musicFile(t[0])));
  }
  if (music.playing) {
    if (music.stopAt) return;
    if (music.season !== season) { musicStop(true); return; }
    return;
  }
  if (Date.now() < music.gapUntil || !ready.length) return;
  const choices = ready.filter(t => t[0] !== music.last);
  const list = choices.length ? choices : ready;
  const pick = list[Math.floor(Math.random() * list.length)];
  let bytes;
  try { bytes = fs.readFileSync(musicFile(pick[0])); } catch { music.gapUntil = Date.now() + 60000; return; }
  audioSend('audio:music', { name: pick[0], bytes, volume: MUSIC_VOL[S.musicVolume], fadeIn: 3 });
  music.playing = pick[0]; music.season = season; music.last = pick[0];
  log('播放 ' + pick[0]);
}
function musicStatus() {
  const season = currentSeason(), zh = { spring: '春', summer: '夏', fall: '秋', winter: '冬' }[season];
  if (S.music === 'off') return null;
  if (music.preparing) return '正在从游戏里取出' + zh + '天的配乐…';
  if (music.failed[season]) return music.failed[season];
  if (music.playing && !music.stopAt) return '正在播放：' + zh + ' · 第 ' + music.last.slice(-1) + ' 首';
  return S.music === 'saver' ? '屏保时播放' + zh + '天的配乐' : '配乐间歇中';
}

// ---------- policy: when to render, how fast ----------
function stopReason() {
  if (saver) return '屏保运行中';
  if (S.paused) return '已暂停';
  if (locked) return '锁屏中，已停止';
  if (asleep) return '睡眠中，已停止';
  return null;
}
function fpsFor(i) {
  if (stopReason()) return 0;
  const c = coverage[i] || 0, q = QUALITY[S.quality].fps;
  if (c > 0.97) return 0;
  if (c > 0.6) return Math.min(8, q);
  return q;
}
function applyPolicy() { scenes.forEach((s, i) => setFps(s, fpsFor(i))); restartCursorTimer(); }
function updateCoverage() {
  if (!WIN) { applyPolicy(); return; }
  const rects = W.windowRects(ownHwnds).map(r => {
    const d = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h });
    return { x: d.x, y: d.y, w: d.width, h: d.height, cls: r.cls };
  });
  windowRects = rects;
  scenes.forEach((s, i) => {
    const f = s.display.bounds, cols = 48, rows = 30;
    let covered = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const px = f.x + (c + 0.5) * f.width / cols, py = f.y + (r + 0.5) * f.height / rows;
      if (rects.some(q => px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h)) covered++;
    }
    const was = coverage[i] || 0;
    coverage[i] = covered / (cols * rows);
    if (coverage[i] > 0.97 && was <= 0.97) {   // the farm stops drawing: say what's covering it (helps when it's an invisible overlay)
      const big = rects.filter(q => q.w * q.h > f.width * f.height * 0.5).map(q => q.cls).join(', ');
      log('屏幕 ' + (i + 1) + ' 被窗口盖住，暂停绘制：' + big);
    }
  });
  applyPolicy();
}

// ---------- cursor: the pet comes to sit by it ----------
let cursorTimer = null, cursorInterval = 0;
function cursorTick() {
  const p = screen.getCursorScreenPoint();
  let covered = false;
  if (WIN) { const ph = screen.dipToScreenPoint(p); covered = W.coveredAt(ph.x, ph.y, ownHwnds); }
  else covered = windowRects.some(q => p.x >= q.x && p.x < q.x + q.w && p.y >= q.y && p.y < q.y + q.h);
  scenes.forEach(s => {
    const b = s.display.bounds;
    let key = null;
    if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) key = (p.x - b.x) + ',' + (p.y - b.y) + ',' + (covered ? 1 : 0);
    if (key === s.cursor) return;
    s.cursor = key;
    call(s, key ? 'SDV.host.cursor(' + key + ')' : 'SDV.host.cursor(null)');
  });
}
function restartCursorTimer() {
  let max = 0;
  scenes.forEach((s, i) => { max = Math.max(max, fpsFor(i)); });
  const interval = max > 0 ? Math.round(1000 / Math.min(max, 20)) : 0;
  if (interval === cursorInterval) return;
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = null;
  cursorInterval = interval;
  if (interval > 0) cursorTimer = setInterval(guard('cursor', cursorTick), interval);
}

// ---------- screensaver ----------
function idleSeconds() { return powerMonitor.getSystemIdleTime(); }
function startSaver(preview) {
  if (!scenes.length) { bridge.startSaver(); return; }
  if (saver) return;
  saver = { views: [], started: Date.now(), lastIdle: idleSeconds(), lastCursor: screen.getCursorScreenPoint(), alpha: 0, closing: false, preview };
  screen.getAllDisplays().forEach(d => {
    const b = d.bounds;
    const win = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, show: false, skipTaskbar: true,
      resizable: false, movable: false, alwaysOnTop: true, fullscreenable: false, backgroundColor: '#000000', hasShadow: false,
      webPreferences: webPrefs('saver') });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setOpacity(0);
    const v = { win, wc: win.webContents, ready: false };
    win.webContents.on('did-finish-load', () => win.webContents.insertCSS('*{cursor:none !important}'));
    win.webContents.on('before-input-event', () => stopSaver());
    win.once('ready-to-show', () => { win.showInactive(); win.setBounds(b); remember(win); });
    win.loadURL('sdv://app/index.html');
    saver.views.push(v);
  });
  if (saver.views[0]) setTimeout(() => { if (saver && saver.views[0] && !saver.views[0].win.isDestroyed()) saver.views[0].win.focus(); }, 400);
  applyPolicy();
  log('屏保开始' + (preview ? '（预览）' : ''));
}
function stopSaver() { if (saver && !saver.closing) saver.closing = true; }
function finishSaver() {
  const s = saver;
  saver = null;
  s.views.forEach(v => { forget(v.win); if (!v.win.isDestroyed()) v.win.destroy(); });
  applyPolicy();
  log('屏保结束');
}
let saverClock = 0;
function saverTick() {
  if (saver) {
    const idle = idleSeconds(), age = (Date.now() - saver.started) / 1000, p = screen.getCursorScreenPoint();
    if (!saver.closing && age > 1.5 && (idle < saver.lastIdle || Math.abs(p.x - saver.lastCursor.x) + Math.abs(p.y - saver.lastCursor.y) > 3)) stopSaver();
    saver.lastIdle = idle;
    if (age <= 1.5) saver.lastCursor = p;
    if (locked || asleep) stopSaver();
    saver.alpha = Math.max(0, Math.min(1, saver.alpha + (saver.closing ? -0.2 : 0.05)));
    saver.views.forEach(v => { if (!v.win.isDestroyed()) v.win.setOpacity(saver.alpha); });
    if (saver.closing && saver.alpha <= 0) finishSaver();
    return;
  }
  saverClock++;
  if (saverClock % 20) return;
  const minutes = S.saverMinutes;
  if (!minutes || locked || asleep || S.paused || !scenes.length) return;
  if (idleSeconds() < minutes * 60) return;
  if (WIN && screen.getAllDisplays().some(d => W.foregroundFullscreen(physRect(d.bounds), ownHwnds))) return;   // a video or a game
  startSaver(false);
}

// ---------- start with Windows ----------
function loginEnabled() { try { return app.getLoginItemSettings().openAtLogin; } catch { return false; } }
function setLogin(on) {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: on }); log('开机启动' + (on ? '已打开' : '已关闭')); } catch (e) { log('开机启动设置失败：' + e); }
}

// ---------- the leaf menu ----------
function appIcon() { return path.join(__dirname, 'icon.png'); }
function radio(label, checked, click) { return { label, type: 'checkbox', checked: Boolean(checked), click: guard('menu', click) }; }
function item(label, click, extra) { return Object.assign({ label, click: click ? guard('menu', click) : undefined, enabled: Boolean(click) }, extra || {}); }
const sep = { type: 'separator' };
function setAndTell(kind, val) { applySetting(kind, val); editorCall('SDV.host.apply(' + JSON.stringify(kind) + ',' + JSON.stringify(val) + ')'); }
function boardMenu() {
  const b = boardData(), P = boardPay(b, new Date()), list = boardTodos(b);
  const open = list.filter(x => !x.done).length;
  let title = '公告板';
  if (P && P.status === 'work') title += ' · 还有 ' + hmLeft(P.toEnd) + ' 下班';
  else if (P && P.status === 'lunch') title += ' · 午休中';
  else if (P && P.status === 'after') title += ' · 下班啦';
  else if (P && P.status === 'rest') title += ' · 今天休息';
  else if (open) title += ' · 待办 ' + open;
  const sub = [];
  if (!list.length) sub.push(item('今天还没有待办'));
  list.slice().sort((a, c) => Number(Boolean(a.done)) - Number(Boolean(c.done))).slice(0, 12)
    .forEach(x => sub.push(radio(x.text, x.done, () => boardAction('todo', x.id))));
  if (P) {
    sub.push(sep);
    if (P.status !== 'rest' && b.showMoney !== false && P.daily) sub.push(item('今日已挣 ' + yuan(P.status === 'after' ? P.daily : P.earned) + ' / ' + yuan(P.daily)));
    if (P.status === 'work') sub.push(item('下班倒计时 ' + hmLeft(P.toEnd)));
    else if (P.status === 'before') sub.push(item('还没上班 · ' + hmLeft(P.toStart) + ' 后开始'));
    if (b.today && b.today.day === todayKey()) sub.push(item('今天恢复平常安排', () => boardAction('boardDay', 'auto')));
    else if (P.scheduled) sub.push(item('今天请假 / 调休（不算工资）', () => boardAction('boardDay', 'off')));
    else sub.push(item('今天调休要上班', () => boardAction('boardDay', 'work')));
  }
  sub.push(sep);
  sub.push(item('添加待办…', () => boardAction('boardAdd')));
  sub.push(radio('音效（打勾「叮」、下班收获声）', sfxOn(b), () => boardAction('boardSound')));
  sub.push(item('设置上下班时间…', () => boardAction('boardEdit')));
  return { label: title, submenu: sub };
}
function buildMenu() {
  const T = [];
  T.push({ label: '季节', submenu: [['auto', '跟随真实月份'], ['spring', '春'], ['summer', '夏'], ['fall', '秋'], ['winter', '冬']]
    .map(o => radio(o[1], o[0] === S.season, () => setAndTell('season', o[0]))) });
  const wsub = [['live', '实时天气'], ['sunny', '晴'], ['cloudy', '阴'], ['rain', '雨'], ['storm', '雷雨'], ['snow', '雪'], ['fog', '雾'], ['windy', '大风']]
    .map(o => radio(o[1], o[0] === S.weather, () => setAndTell('weather', o[0])));
  wsub.push(sep, item('所在城市：' + locationLabel()), item('更换城市…', () => cityDialog()));
  if (S.location) wsub.push(item('改回跟随时区自动', () => setLocation(null)));
  T.push({ label: '天气', submenu: wsub });
  T.push({ label: '宠物', submenu: PETS.map(o => radio(o[1], o[0] === S.pet, () => setAndTell('pet', o[0]))) });
  const sv = [['0', '关闭'], ['3', '闲置 3 分钟后'], ['5', '闲置 5 分钟后'], ['10', '闲置 10 分钟后'], ['15', '闲置 15 分钟后']]
    .map(o => radio(o[1], Number(o[0]) === S.saverMinutes, () => { S.saverMinutes = Number(o[0]); }));
  sv.push(sep, item('立即预览', () => startSaver(true)));
  T.push({ label: '屏保', submenu: sv });
  const mu = [['off', '关闭'], ['always', '一直播放'], ['saver', '只在屏保时播放']]
    .map(o => radio(o[1], o[0] === S.music, () => { S.music = o[0]; music.gapUntil = 0; music.failed = {}; musicTick(); }));
  if (S.music !== 'off') {
    mu.push(sep);
    [['low', '音量：小'], ['mid', '音量：中'], ['high', '音量：大']].forEach(o => mu.push(radio(o[1], o[0] === S.musicVolume, () => {
      S.musicVolume = o[0]; if (music.playing) audioSend('audio:volume', { volume: MUSIC_VOL[o[0]], seconds: 0.4 });
    })));
    const ms = musicStatus();
    if (ms) mu.push(sep, item(ms));
  }
  T.push({ label: '背景音乐', submenu: mu });
  const fo = S.focus;
  if (fo && !fo.done) {
    const left = Math.max(1, Math.ceil((fo.start + fo.dur - Date.now() / 1000) / 60));
    T.push({ label: '专注中 · 还剩 ' + left + ' 分钟', submenu: [item(fo.cropZh + '正在长，还剩 ' + left + ' 分钟'), item('放弃这次专注', giveUpFocus)] });
  } else {
    const fs2 = [item('25 分钟', () => startFocus(25)), item('50 分钟', () => startFocus(50))];
    if (shippedToday()) fs2.push(sep, item('今天出货：' + focusSummary()));
    T.push({ label: '开始专注种田', submenu: fs2 });
  }
  T.push(boardMenu());
  if (S.mailWatch && mail.fresh.length) T.push(item('信箱里有 ' + mail.fresh.length + ' 个新文件 · 标记为已读', markMailRead));
  if (timeOverride != null) T.push(item('恢复实时时间（现在是模拟的 ' + Math.floor(timeOverride) + ':' + ('0' + Math.round((timeOverride % 1) * 60)).slice(-2) + '）',
    () => setAndTell('time', null)));
  T.push(sep);
  T.push(item(S.paused ? '继续' : '暂停', () => { S.paused = !S.paused; applyPolicy(); }));
  T.push(item('打开设置窗口…', openEditor));
  const more = Object.keys(QUALITY).map(k => radio('画质：' + QUALITY[k].title, k === S.quality, () => { S.quality = k; applyPolicy(); }));
  more.push(sep, radio('新文件提醒（信箱）', S.mailWatch, () => { S.mailWatch = !S.mailWatch; mail.known = {}; mail.fresh = []; mailTick(); }));
  more.push(radio('开机时启动', loginEnabled(), () => setLogin(!loginEnabled())));
  if (WIN) more.push(sep, { label: '桌面显示方式', submenu: [['auto', '自动（推荐）'], ['nolayer', '兼容模式（农场黑屏或不显示时试试）'], ['window', '普通窗口（会盖住桌面图标）']]
    .map(o => radio(o[1], o[0] === S.desktopMode, () => { S.desktopMode = o[0]; log('桌面显示方式：' + o[0]); buildScenes(); })) });
  more.push(sep, item('重新加载场景', () => { buildScenes(); }), item(bridge.independent?'更换独立素材包…':'重新读取游戏画面…', openSetup));
  more.push(sep, item('打开日志文件夹', () => shell.openPath(SUPPORT)));
  T.push({ label: '更多', submenu: more });
  T.push(sep);
  T.push(item('退出 ' + APP_NAME, () => { quitting = true; app.quit(); }));
  return Menu.buildFromTemplate(T);
}
function trayStatus() { const r = stopReason(); return APP_NAME + (r ? ' · ' + r : ''); }
function makeTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip(APP_NAME);
  const show = guard('tray', () => { tray.setToolTip(trayStatus()); tray.popUpContextMenu(buildMenu()); });
  tray.on('click', show);
  tray.on('right-click', show);
}

// ---------- start ----------

app.on('window-all-closed', () => { /* keep running in the notification area */ });
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(guard('start', async () => {
  serveScene();
  // One tray belongs to the combined app.
  weatherLoad();
  const al = autoLocation();
  if (al) { weather.lat = al.lat; weather.lon = al.lon; }
  prepareRunDir();
  if (!dataReady() && !bridge.testing && !bridge.independent) openSetup();

  screen.on('display-added', () => { if(scenes.length) rebuildSoon(); });
  screen.on('display-removed', () => { if(scenes.length) rebuildSoon(); });
  screen.on('display-metrics-changed', (e, d, changed) => { log('显示器参数变化：' + (changed || []).join('/')); if(scenes.length) rebuildSoon(); });
  powerMonitor.on('lock-screen', () => { locked = true; applyPolicy(); });
  powerMonitor.on('unlock-screen', () => { locked = false; applyPolicy(); });
  powerMonitor.on('suspend', () => { asleep = true; applyPolicy(); });
  powerMonitor.on('resume', () => { asleep = false; applyPolicy(); weather.lastAttempt = 0; if(scenes.length) rebuildSoon(true); });

  setInterval(guard('coverage', () => { updateCoverage(); checkAttached(); }), 2000);
  setInterval(guard('weather', weatherTick), 15000);
  setInterval(guard('mail', mailTick), 10000);
  setInterval(guard('focus', () => { focusTick(); boardTick(); }), 5000);
  setInterval(guard('music', musicTick), 2000);
  setInterval(guard('saver', saverTick), 50);
  updateCoverage();

  // Preserve the parent app's startup preference.
  log('Stardew Desk 已启动（Windows 版），代码 ' + codeDir + '，运行目录 ' + sceneDir);
  // automated tests only (never set in the shipped app)
  if (process.env.SDV_TEST && !app.isPackaged) global.SDV_TEST_HOOKS = { S, buildMenu, openEditor, addTodoDialog, cityDialog, setLocation,
    startSaver, stopSaver, musicTick, playSfx, boardData, settingsScript, get scenes() { return scenes; }, get saver() { return saver; }, music, MUSIC_DIR };
}));

function snapshot(){return {layout:S.layout,season:S.season,weather:S.weather,pet:S.pet,focus:focusPayload(),board:boardData(),music:S.music,musicVolume:S.musicVolume,musicStatus:musicStatus(),saverMinutes:S.saverMinutes,mail:Math.max(0,mail.lastCount),mailWatch:S.mailWatch,paused:S.paused,quality:S.quality};}
return {
 menu:buildMenu, open:openEditor, activate:buildScenes,
 reload(){prepareRunDir();scenes.forEach(s=>s.wc.reload());if(editor)editor.wc.reload();},
 stop(){hideCatcher();scenes.forEach(closeScene);scenes=[];if(saver)stopSaver();},
 state:snapshot, settingsScript,
 command(kind,value){
  if(kind==='layout'&&value&&typeof value==='object'&&!Array.isArray(value)){if(JSON.stringify(value).length>1024*1024)throw Error('布局过大');applySetting('layout',value);editorCall('SDV.host.apply("layout",'+JSON.stringify(value)+')');}
  else if(kind==='focus'){if(![25,50].includes(value))throw Error('无效的专注时长');startFocus(value);}
  else if(kind==='focusCancel')giveUpFocus();
  else if(kind==='boardSet')setBoard(value);
  else if(kind==='boardAction'){if(!['todo','boardEdit','boardSound','boardDay'].includes(value?.kind))throw Error('无效的公告板操作');boardAction(value.kind,value.value);}
  else if(kind==='music'&&['off','always','saver'].includes(value)){S.music=value;music.gapUntil=0;music.failed={};musicTick();}
  else if(kind==='musicVolume'&&['low','mid','high'].includes(value)){S.musicVolume=value;if(music.playing)audioSend('audio:volume',{volume:MUSIC_VOL[value],seconds:.4});}
  else if(kind==='saverMinutes'&&[0,3,5,10,15].includes(Number(value)))S.saverMinutes=Number(value);
  else if(kind==='mailWatch'){S.mailWatch=!!value;mailTick();}
  else if(kind==='paused'){S.paused=!!value;applyPolicy();}
  else if(['season','weather','pet','time'].includes(kind))setAndTell(kind,value);
  else throw Error('不支持的原版设置');
  bridge.changed(snapshot());return snapshot();
 }
};

};
