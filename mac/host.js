// Stardew Desk — macOS host written in JavaScript for Automation (JXA).
// Needs nothing beyond macOS itself: no Xcode, no command line tools.
//
// Puts the web scene on every display, above the wallpaper and below the
// desktop icons, and drives it from a menu bar item.
//
//   Install:  sh mac/install.sh          (packs this file into ~/Applications/Stardew Desk.app)
//   Debug:    osascript -l JavaScript mac/host.js "$PWD/scene"   (errors print to the terminal; Ctrl-C quits)

ObjC.import('Cocoa');
ObjC.import('WebKit');
ObjC.import('CoreGraphics');
ObjC.import('ServiceManagement');
ObjC.import('AVFoundation');

var APP_NAME = 'Stardew Desk';
// In JXA a JS `null` passed where Cocoa expects an object arrives as NSNull, not nil.
// $() is the real nil.
var NIL = $();
function noop() {}
var DEBUG = false;
var sceneDir = null;          // where the scene runs from: code copied from the app + data/ from setup
var codeDir = null;           // the scene code shipped inside the app (or the project folder when debugging)
var musicScript = null;       // musicx.js
var SUPPORT = $.NSHomeDirectory().js + '/Library/Application Support/Stardew Desk';
var DATA_VERSION = '9';       // must match scene/setup.js
var setup = null;             // first-run window: {win, wv, ucc, tried}
var scenes = [];           // {screen, frame, win, wv, ready, fps, cursor}
var coverage = [];         // per scene, 0..1
var windowRects = [];      // ordinary app windows (Quartz coords), refreshed with coverage
var screensAsleep = false;
var locked = false;
var sceneStatus = '';
var sceneDetail = '';
var target = null;         // ObjC object receiving timers, menu actions, notifications
var handler = null;        // WKScriptMessageHandler
var statusItem = null;
var cursorTimer = null;
var cursorInterval = 0;
var editor = null;         // settings window: {win, wv, ucc, ready}
var todoWin = null;        // the add-a-to-do box: {win, wv, ucc, ready}
var saver = null;          // running screensaver: {views: [...], prevApp, started, lastIdle, alpha, closing}
var saverBlockedUntil = 0; // don't re-check for video playback every second
var timeOverride = null;   // simulated hour from the settings window (not saved)
var weather = { lat: 30.27, lon: 120.15, refresh: 30 * 60, configured: false, task: null, failures: 0, lastAttempt: 0, latest: null };

// ---------- logging ----------
var LOG_PATH = $.NSHomeDirectory().js + '/Library/Logs/StardewDesk.log';
function log(msg) {
  var line = new Date().toISOString() + ' ' + msg + '\n';
  if (DEBUG) console.log(msg);
  try {
    var fm = $.NSFileManager.defaultManager;
    if (!fm.fileExistsAtPath(LOG_PATH)) $('').writeToFileAtomicallyEncodingError(LOG_PATH, true, $.NSUTF8StringEncoding, null);
    var h = $.NSFileHandle.fileHandleForWritingAtPath(LOG_PATH);
    h.seekToEndOfFile;
    h.writeData($(line).dataUsingEncoding($.NSUTF8StringEncoding));
    h.closeFile;
  } catch (e) { /* ignore */ }
}
function guard(name, fn) {
  return function () {
    try { return fn.apply(null, arguments); } catch (e) { log('错误 [' + name + ']: ' + e + (e && e.line ? ' @' + e.line : '')); }
  };
}
// NSAlert.runModal called synchronously from inside a menu item's own click handler
// (the status-bar menu is still tearing down its tracking session at that instant) is a
// fragile pattern on recent macOS/Apple Silicon — it can crash instead of just showing
// the alert. Scheduling the call one runloop tick later, after the menu has fully
// closed, avoids it.
var pendingModal = null;
function deferModal(fn) {
  pendingModal = fn;
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(0.05, target, 'runDeferred:', NIL, false);
}

// ---------- settings (NSUserDefaults) ----------
var defaults = $.NSUserDefaults.standardUserDefaults;
function getStr(key, fallback) {
  var v = defaults.stringForKey(key);
  return v && !v.isNil() ? v.js : fallback;
}
function setStr(key, v) { defaults.setObjectForKey($(v), key); }
// Write the settings to disk now (macOS batches them; before quitting or reinstalling,
// and after a layout change, we don't want to rely on that).
function flushSettings() { try { defaults.synchronize; } catch (e) { /* ignore */ } }
function getBool(key, fallback) {
  return defaults.objectForKey(key).isNil() ? fallback : defaults.boolForKey(key);
}
function setBool(key, v) { defaults.setBoolForKey(v, key); }

var PETS = [['cat0', '橘猫'], ['cat1', '灰猫'], ['cat2', '黄猫'], ['cat3', '白猫'], ['cat4', '黑猫'], ['cat5', '紫猫'],
  ['dog0', '黄狗'], ['dog1', '牧羊犬'], ['dog2', '金毛'], ['dog3', '黑白花狗'], ['dog4', '棕狗'], ['dog5', '紫狗'], ['none', '不养']];
var MUSIC_VOL = { low: 0.12, mid: 0.25, high: 0.45 };

// ---------- 语言 / Language ----------
// scene/i18n.js + i18n-en.js, shared with the pages: L('下班 {0}', t) is the line in the
// chosen language. S.lang: 'auto' (the Mac's language), 'zh' or 'en'.
var i18nCache = null;
function i18n() {
  if (i18nCache || !codeDir) return i18nCache;
  try {
    i18nCache = eval('(function () {' + readText(codeDir + '/i18n.js') + '\n' + (readText(codeDir + '/i18n-en.js') || '') + '\n;return SDV_I18N; })()');
    i18nCache.set(curLang());
  } catch (e) { log('读不了语言文件：' + e); }
  return i18nCache;
}
function systemLang() { try { return $.NSLocale.preferredLanguages.firstObject.js; } catch (e) { return 'zh'; } }
function curLang() { var p = S.lang; return p === 'zh' || p === 'en' ? p : (/^zh/i.test(systemLang()) ? 'zh' : 'en'); }
function L(k) {
  var x = i18n(), a = Array.prototype.slice.call(arguments, 1);
  if (x) return x.L.apply(null, arguments);
  return String(k).replace(/\{(\d+)\}/g, function (m, i) { return a[Number(i)] == null ? '' : String(a[Number(i)]); });
}
function setLang(pref) {
  S.lang = pref === 'zh' || pref === 'en' ? pref : 'auto';
  if (i18n()) i18nCache.set(curLang());
  var js = 'SDV.host.apply("lang",' + JSON.stringify(curLang()) + ')';
  callAll(js); editorCall(js);
  if (saver) saver.views.forEach(function (v) { if (v.ready) v.wv.evaluateJavaScriptCompletionHandler($(js), noop); });
  if (editor) editor.win.title = $(L('{0} 设置', APP_NAME));
  music.status = ''; pushMusicState();
}
var QUALITY = { eco: { fps: 10, title: '省电（10 fps）' }, balanced: { fps: 15, title: '平衡（15 fps）' }, smooth: { fps: 30, title: '流畅（30 fps）' } };
function reduceMotion() {
  try { return $.NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion; } catch (e) { return false; }
}
var S = {
  get paused() { return getBool('paused', reduceMotion()); },
  set paused(v) { setBool('paused', v); },
  get quality() { var q = getStr('quality', 'balanced'); return QUALITY[q] ? q : 'balanced'; },
  set quality(v) { setStr('quality', v); },
  get season() { return getStr('season', 'auto'); },
  set season(v) { setStr('season', v); },
  get weather() { return getStr('weather', 'live'); },
  set weather(v) { setStr('weather', v); },
  // integerForKey comes back from the ObjC bridge as a wrapped object, not a JS number:
  // it prints as "0" but !value is false, so 关闭 (0) never stopped the idle check.
  get saverMinutes() { var v = defaults.objectForKey('saverMinutes'); return v.isNil() ? 5 : Number(ObjC.unwrap(defaults.integerForKey('saverMinutes'))) || 0; },
  set saverMinutes(v) { defaults.setIntegerForKey(v, 'saverMinutes'); },
  get focus() { try { return JSON.parse(getStr('focus', 'null')); } catch (e) { return null; } },
  set focus(v) { setStr('focus', JSON.stringify(v || null)); },
  get focusLog() { try { return JSON.parse(getStr('focusLog', 'null')); } catch (e) { return null; } },
  set focusLog(v) { setStr('focusLog', JSON.stringify(v || null)); },
  get mailWatch() { return getBool('mailWatch', true); },
  set mailWatch(v) { setBool('mailWatch', v); },
  get location() { try { return JSON.parse(getStr('location', 'null')); } catch (e) { return null; } },
  set location(v) { setStr('location', JSON.stringify(v || null)); },
  get contentDir() { return getStr('contentDir', null); },
  set contentDir(v) { setStr('contentDir', v || ''); },
  get music() { var m = getStr('music', 'off'); return m === 'always' || m === 'saver' ? m : 'off'; },
  set music(v) { setStr('music', v); },
  get lang() { var v = getStr('lang', 'auto'); return v === 'zh' || v === 'en' ? v : 'auto'; },
  set lang(v) { setStr('lang', v); flushSettings(); },
  get musicVolume() { var v = getStr('musicVolume', 'mid'); return MUSIC_VOL[v] ? v : 'mid'; },
  // which tracks: {mode: 'season' | 'list', list: [ids], order: 'shuffle' | 'order'}
  get musicPick() { try { return normalizePick(JSON.parse(getStr('musicPick', 'null'))); } catch (e) { return normalizePick(null); } },
  set musicPick(v) { setStr('musicPick', JSON.stringify(normalizePick(v))); flushSettings(); },
  set musicVolume(v) { setStr('musicVolume', v); },
  get pet() { return getStr('pet', 'cat0'); },
  set pet(v) { setStr('pet', v); },
  // 镜头跟随鼠标: the desktop view leans toward the cursor
  get follow() { return getBool('follow', false); },
  set follow(v) { setBool('follow', v); flushSettings(); },
  get layout() { try { return JSON.parse(getStr('layout', '{}')) || {}; } catch (e) { return {}; } },
  set layout(v) { setStr('layout', JSON.stringify(v || {})); flushSettings(); },
  // 我的布局: named copies of layouts and automatic backups (kept by the settings page)
  get layouts() { try { var v = JSON.parse(getStr('layouts', '[]')); return Array.isArray(v) ? v : []; } catch (e) { return []; } },
  set layouts(v) { setStr('layouts', JSON.stringify(Array.isArray(v) ? v : [])); flushSettings(); },
  get board() { try { return JSON.parse(getStr('board', 'null')); } catch (e) { return null; } },
  set board(v) { setStr('board', JSON.stringify(v || null)); },
  get frame() { try { return JSON.parse(getStr('frame', 'null')); } catch (e) { return null; } },
  set frame(v) { setStr('frame', JSON.stringify(v)); },
};

// ---------- scene windows ----------
function desktopLevel() {
  try {
    var lv = $.CGWindowLevelForKey(2); // kCGDesktopWindowLevelKey
    if (typeof lv === 'number') return lv + 1;
  } catch (e) { /* fall through */ }
  return -2147483628 + 1; // kCGMinimumWindowLevel + 20, + 1
}

function makeScene(screen) {
  var f = screen.frame;
  var screenKey = [f.origin.x, f.origin.y, f.size.width, f.size.height, screen.backingScaleFactor].join(',');
  var rect = $.NSMakeRect(f.origin.x, f.origin.y, f.size.width, f.size.height);
  var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(rect, 0, 2, false);
  win.level = desktopLevel();
  // canJoinAllSpaces | stationary | ignoresCycle | fullScreenNone
  win.collectionBehavior = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 9);
  win.ignoresMouseEvents = true;
  win.opaque = true;
  win.hasShadow = false;
  win.releasedWhenClosed = false;
  win.backgroundColor = $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.11, 0.08, 0.06, 1);

  var web = makeWebView(f.size.width, f.size.height, 'mac');
  win.contentView = web.wv;
  win.setFrameDisplay(rect, false);
  win.orderFrontRegardless;

  return {
    screen: screen,
    screenKey: screenKey,
    frame: { x: f.origin.x, y: f.origin.y, w: f.size.width, h: f.size.height },
    win: win, wv: web.wv, ucc: web.ucc, ready: false, fps: -1, cursor: 'init',
  };
}

// A web view showing the scene. role: 'mac' (desktop) or 'editor' (settings window).
function makeWebView(w, h, role, page) {
  var ucc = $.WKUserContentController.alloc.init;
  ucc.addUserScript($.WKUserScript.alloc.initWithSourceInjectionTimeForMainFrameOnly($("window.SDV_HOST = '" + role + "';"), 0, true));
  ucc.addScriptMessageHandlerName(handler, 'sdv');
  var cfg = $.WKWebViewConfiguration.alloc.init;
  cfg.userContentController = ucc;
  try { cfg.preferences.setValueForKey($.NSNumber.numberWithBool(true), 'allowFileAccessFromFileURLs'); } catch (e) { log('allowFileAccessFromFileURLs 不可用: ' + e); }
  var wv = $.WKWebView.alloc.initWithFrameConfiguration($.NSMakeRect(0, 0, w, h), cfg);
  wv.autoresizingMask = 2 | 16; // width | height
  wv.loadFileURLAllowingReadAccessToURL($.NSURL.fileURLWithPath(sceneDir + '/' + (page || 'index.html')), $.NSURL.fileURLWithPath(sceneDir));
  return { wv: wv, ucc: ucc };
}

// ---------- settings window ----------
// An ordinary window with the same scene: its panel can be clicked, and every
// change (season, weather, time, composition) is passed on to the desktop.
function openEditor() {
  var app = $.NSApplication.sharedApplication;
  if (!editor) {
    var main = $.NSScreen.mainScreen;
    var sf = main.frame, vf = main.visibleFrame;
    var cw = Math.min(vf.size.width * 0.72, (vf.size.height - 60) * sf.size.width / sf.size.height);
    var ch = cw * sf.size.height / sf.size.width;
    var rect = $.NSMakeRect(0, 0, cw, ch);
    // titled | closable | miniaturizable | resizable
    var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(rect, 1 | 2 | 4 | 8, 2, false);
    win.title = $(L('{0} 设置', APP_NAME));
    win.releasedWhenClosed = false;
    win.contentAspectRatio = $.NSMakeSize(sf.size.width, sf.size.height);
    var web = makeWebView(cw, ch, 'editor');
    win.contentView = web.wv;
    win.center;
    editor = { win: win, wv: web.wv, ucc: web.ucc, ready: false, screen: main };
  }
  app.activateIgnoringOtherApps(true);
  editor.win.makeKeyAndOrderFront(NIL);
}

function editorCall(js) {
  if (editor && editor.ready) editor.wv.evaluateJavaScriptCompletionHandler($(js), noop);
}

// Save a setting changed in the settings window and pass it to the desktop scenes.
function applySetting(key, value) {
  if (key === 'season') S.season = value || 'auto';
  else if (key === 'weather') S.weather = value || 'live';
  else if (key === 'frame') S.frame = value;
  else if (key === 'layout') S.layout = value;
  else if (key === 'pet') S.pet = value || 'cat0';
  else if (key === 'time') timeOverride = value == null ? null : value;
  else if (key === 'board') { boardTicked(S.board, value); S.board = value; }
  else if (key === 'layouts') { S.layouts = value; return; }   // only the settings page shows them
  else if (key === 'follow') S.follow = Boolean(value);
  else if (key === 'music') { S.music = value === 'always' || value === 'saver' ? value : 'off'; music.gapUntil = 0; music.failed = {}; musicTick(); pushMusicState(); return; }
  else if (key === 'musicVolume') { if (MUSIC_VOL[value]) { S.musicVolume = value; if (music.player) music.player.volume = MUSIC_VOL[value]; } pushMusicState(); return; }
  else if (key === 'lang') { setLang(value); return; }
  else if (key === 'musicPick') { S.musicPick = value; music.gapUntil = 0; musicTick(); pushMusicState(); return; }
  else return;
  callAll('SDV.host.apply(' + JSON.stringify(key) + ',' + JSON.stringify(value == null ? null : value) + ')');
}

// Everything a freshly loaded scene needs to match the others.
function settingsScript() {
  var js = [
    'SDV.host.apply("lang",' + JSON.stringify(curLang()) + ')',
    'SDV.host.apply("season",' + JSON.stringify(S.season) + ')',
    'SDV.host.apply("weather",' + JSON.stringify(S.weather) + ')',
    'SDV.host.apply("time",' + JSON.stringify(timeOverride) + ')',
  ];
  if (S.frame) js.push('SDV.host.apply("frame",' + JSON.stringify(S.frame) + ')');
  var al = autoLocation();
  if (al) js.push('SDV.host.apply("location",' + JSON.stringify(al) + ')');
  js.push('SDV.host.apply("layout",' + JSON.stringify(S.layout) + ')');
  js.push('SDV.host.apply("layouts",' + JSON.stringify(S.layouts) + ')');
  js.push('SDV.host.apply("follow",' + JSON.stringify(S.follow) + ')');
  js.push('SDV.host.apply("musicState",' + JSON.stringify(musicState()) + ')');
  js.push('SDV.host.apply("pet",' + JSON.stringify(S.pet) + ')');
  js.push('SDV.host.apply("board",' + JSON.stringify(S.board) + ')');
  js.push('SDV.host.mail(' + Math.max(0, mail.lastCount) + ')');
  js.push('SDV.host.focus(' + JSON.stringify(focusPayload()) + ')');
  if (weather.latest) js.push('SDV.host.setLiveWeather(' + JSON.stringify(weather.latest) + ')');
  return js.join(';');
}

function closeScene(s) {
  try { s.ucc.removeScriptMessageHandlerForName('sdv'); } catch (e) { /* ignore */ }
  s.win.orderOut(NIL);
  s.win.close;
}

function buildScenes() {
  var list = $.NSScreen.screens.js;
  var keys = list.map(function (screen) {
    var f = screen.frame;
    return [f.origin.x, f.origin.y, f.size.width, f.size.height, screen.backingScaleFactor].join(',');
  });
  // AppKit can send screen-parameter notifications during desktop/window transitions.
  // Recreating every WKWebView for a duplicate notification flashes the desktop and
  // reinitializes transient scene state (including animal positions), even if no display changed.
  if (scenes.length === list.length && scenes.every(function (s, i) { return s.screenKey === keys[i]; })) {
    log('屏幕参数通知：显示器布局未变化，保留现有场景');
    return;
  }
  hideCatcher();
  scenes.forEach(closeScene);
  scenes = list.map(makeScene);
  coverage = scenes.map(function () { return 0; });
  log('场景窗口：' + scenes.length + ' 块屏幕');
}

function call(s, js) {
  if (!s.ready) return;
  s.wv.evaluateJavaScriptCompletionHandler($(js), noop); // a JS function bridges to the completion block
}
function callAll(js) { scenes.forEach(function (s) { call(s, js); }); }

function setFps(s, fps, reason) {
  if (fps <= 0 && catcher && catcher.scene === s) hideCatcher();
  if (!s.ready || fps === s.fps) return;
  log('场景渲染频率变化：' + s.fps + ' → ' + fps + ' FPS' + (reason ? '（' + reason + '）' : ''));
  s.fps = fps;
  call(s, 'SDV.host.setFps(' + fps + ')');
}

function pushSettings(s) {
  call(s, settingsScript());
  s.fps = -1;
  applyPolicy();
}

function onMessage(wv, body) {
  if (setup && setup.wv.isEqual(wv)) { onSetupMessage(body || {}); return; }
  if (todoWin && todoWin.wv.isEqual(wv)) { onTodoMessage(body); return; }
  if (saver) {
    for (var j = 0; j < saver.views.length; j++) {
      var v = saver.views[j];
      if (!v.wv.isEqual(wv)) continue;
      if (body && body.type === 'hello') {
        v.ready = true;
        v.wv.evaluateJavaScriptCompletionHandler($(settingsScript() + ';SDV.host.setFps(30)'), noop);
      }
      return;
    }
  }
  if (editor && editor.wv.isEqual(wv)) {
    if (body && body.type === 'hello') {
      editor.ready = true;
      var f = editor.screen.frame, k = editor.screen.backingScaleFactor;
      editorCall('SDV.host.setTarget(' + Math.round(f.size.width * k) + ',' + Math.round(f.size.height * k) + ');' + settingsScript());
      if (boardPanelWanted) { boardPanelWanted = false; editorCall('SDV.host.openBoard()'); }
      if (musicPanelWanted) { musicPanelWanted = false; editorCall('SDV.host.openTab("music")'); }
      music.status = '';
    } else if (body && body.type === 'setting') {
      applySetting(body.key, body.value);
    } else if (body && body.type === 'mailRead') {
      markMailRead();
    } else if (body && body.type === 'importSave') {
      later(importSaveDialog);
    } else if (body && body.type === 'musicPlay') {
      musicPlay(String(body.id || ''));
    } else if (body && body.type === 'musicNext') {
      musicNext();
    } else if (body && body.type === 'musicStop') {
      music.request = null; if (S.music !== 'off') { music.gapUntil = Date.now() + 60000; } musicStop(true);
    }
    return;
  }
  var s = null;
  for (var i = 0; i < scenes.length; i++) if (scenes[i].wv.isEqual(wv)) s = scenes[i];
  if (!s || !body) return;
  if (body.type === 'hello') {
    s.ready = true;
    var loc = autoLocation();
    if (loc) { body.lat = loc.lat; body.lon = loc.lon; }
    if (typeof body.lat === 'number' && typeof body.lon === 'number') {
      var changed = !weather.configured || body.lat !== weather.lat || body.lon !== weather.lon;
      weather.lat = body.lat; weather.lon = body.lon;
      weather.refresh = (body.refreshMinutes || 30) * 60;
      weather.configured = true;
      if (changed) { weather.lastAttempt = 0; weatherTick(); }
    }
    pushSettings(s);
    log('场景就绪');
  } else if (body.type === 'status') {
    sceneStatus = body.text || '';
    sceneDetail = body.detail || '';
  } else if (body.type === 'mailRead') {
    markMailRead();
  } else if (body.type === 'boardRect') {
    setCatcher(s, body.rect || null);
  } else if (body.type === 'board') {
    setBoard(body.value);               // a to-do ticked on the desktop
  } else if (body.type === 'boardAdd') {
    hideCatcher();
    later(function () { addTodoDialog(); });    // "＋ 添加待办" on the notice
  }
}

// Run fn once the current event is handled (a dialog shouldn't open from inside a web
// view's message callback).
var laterQueue = [];
function later(fn) {
  laterQueue.push(fn);
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(0.05, target, 'later:', NIL, false);
}
function runLater() {
  var q = laterQueue; laterQueue = [];
  q.forEach(function (fn) { guard('later', fn)(); });
}

// ---------- click catcher for the bulletin board ----------
// The scene sits below the desktop icons, and Finder takes every click on the bare
// desktop. While the board's notice is open, an invisible panel just above the icons
// (still below every normal window) covers the notice; clicks on it go to the scene.
// It's non-activating, so whatever app you're in keeps the focus.
var catcher = null;
function catcherLevel() {
  try { var lv = $.CGWindowLevelForKey(18); if (typeof lv === 'number') return lv + 1; } catch (e) { /* fall through */ }
  return -2147483603 + 1;             // kCGDesktopIconWindowLevel + 1
}
function setCatcher(s, r) {
  if (!r || !r.w || !r.h || S.paused || !clickViewClass) { hideCatcher(); return; }
  var f = s.frame;
  var rect = $.NSMakeRect(f.x + r.x, f.y + f.h - r.y - r.h, r.w, r.h);
  if (!catcher) {
    var win = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(rect, 1 << 7, 2, false);   // borderless, non-activating
    win.level = catcherLevel();
    win.collectionBehavior = (1 << 0) | (1 << 4) | (1 << 6);
    win.opaque = false;
    win.hasShadow = false;
    win.releasedWhenClosed = false;
    win.hidesOnDeactivate = false;
    win.backgroundColor = $.NSColor.colorWithCalibratedWhiteAlpha(0, 0.01);   // all but invisible, yet it takes the click
    win.ignoresMouseEvents = false;
    if (clickViewClass) win.contentView = $[clickViewClass].alloc.initWithFrame($.NSMakeRect(0, 0, r.w, r.h));
    catcher = { win: win };
  }
  catcher.scene = s;
  catcher.rect = r;
  catcher.win.setFrameDisplay(rect, false);
  catcher.win.orderFrontRegardless;
}
function hideCatcher() {
  if (catcher && catcher.rect) { catcher.win.orderOut(NIL); catcher.rect = null; }
}
var lastScrollAt = 0;
function catcherScroll(ev) {
  if (!catcher || !catcher.rect) return;
  var dy = Number(ev.scrollingDeltaY) || 0;
  if (!dy) return;
  var now = Date.now();
  if (now - lastScrollAt < 110) return;        // one row per flick, not per pixel
  lastScrollAt = now;
  var p = ev.locationInWindow, r = catcher.rect;
  call(catcher.scene, 'SDV.host.wheel(' + Math.round(r.x + p.x) + ',' + Math.round(r.y + r.h - p.y) + ',' + (dy > 0 ? -1 : 1) + ')');
}
function catcherClick(ev) {
  if (!catcher || !catcher.rect) return;
  var p = ev.locationInWindow, r = catcher.rect;
  call(catcher.scene, 'SDV.host.click(' + Math.round(r.x + p.x) + ',' + Math.round(r.y + r.h - p.y) + ')');
}

// ---------- mailbox: new files on the Desktop / in Downloads ----------
// Only names are compared, nothing is opened. The first look at each folder asks
// macOS for permission (once); if it's refused, the reminder quietly stays off.
var mail = { known: {}, fresh: [], blocked: {}, lastCount: -1 };
var MAIL_DIRS = { desktop: 'Desktop', downloads: 'Downloads' };
var MAIL_EXPIRE = 6 * 3600;   // a new file stops counting as new after six hours
function listDir(rel) {
  var path = $.NSHomeDirectory().js + '/' + rel;
  var arr = $.NSFileManager.defaultManager.contentsOfDirectoryAtPathError($(path), NIL);
  if (!arr || arr.isNil()) return null;
  return ObjC.deepUnwrap(arr).filter(function (n) {
    return n[0] !== '.' && !/\.(crdownload|download|part|tmp)$/i.test(n) && n !== 'Icon\r';
  });
}
function mailTick() {
  if (!S.mailWatch) { if (mail.lastCount !== 0) pushMail(0); return; }
  var now = Date.now() / 1000;
  Object.keys(MAIL_DIRS).forEach(function (k) {
    var names = listDir(MAIL_DIRS[k]);
    if (!names) { mail.blocked[k] = true; return; }
    mail.blocked[k] = false;
    var set = {};
    names.forEach(function (n) { set[n] = true; });
    if (!mail.known[k]) { mail.known[k] = set; return; }        // first look: everything already there is old news
    names.forEach(function (n) { if (!mail.known[k][n]) mail.fresh.push({ dir: k, name: n, t: now }); });
    mail.known[k] = set;
  });
  // gone (moved into a folder, deleted) or old enough: no longer new
  mail.fresh = mail.fresh.filter(function (f) { return mail.known[f.dir] && mail.known[f.dir][f.name] && now - f.t < MAIL_EXPIRE; });
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
// A focus timer from the menu. The scenes grow a crop on the focus plot over the
// minutes; when time is up the crop is ripe, a notification says so, and today's
// tally goes up. The timer lives here so it survives the scenes reloading.
var FOCUS_CROP = { spring: ['cauliflower', '花椰菜'], summer: ['melon', '甜瓜'], fall: ['pumpkin', '南瓜'], winter: ['powdermelon', '霜瓜'] };
var CROP_ZH = { cauliflower: '花椰菜', melon: '甜瓜', pumpkin: '南瓜', powdermelon: '霜瓜' };
function currentSeason() {
  if (S.season && S.season !== 'auto') return S.season;
  return ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'][new Date().getMonth()];
}
function todayKey() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function todayLog() {
  var LG = S.focusLog;
  return LG && LG.day === todayKey() ? LG : { day: todayKey(), n: 0, last: null, crops: {} };
}
function focusPayload() {
  var f = S.focus || {}, o = {};
  Object.keys(f).forEach(function (k) { o[k] = f[k]; });
  o.log = todayLog();
  return o;
}
function pushFocus() {
  var js = 'SDV.host.focus(' + JSON.stringify(focusPayload()) + ')';
  callAll(js);
  editorCall(js);
}
function startFocus(minutes) {
  var c = FOCUS_CROP[currentSeason()] || FOCUS_CROP.fall;
  S.focus = { start: Date.now() / 1000, dur: minutes * 60, crop: c[0], cropZh: c[1] };
  pushFocus();
}
function giveUpFocus() { S.focus = null; pushFocus(); }
function focusTick() {
  var f = S.focus;
  if (!f) return;
  var now = Date.now() / 1000;
  if (!f.done && now >= f.start + f.dur) {
    f.done = true; f.doneAt = now; S.focus = f;
    var LG = todayLog();
    LG.n += 1; LG.last = f.crop; LG.crops[f.crop] = (LG.crops[f.crop] || 0) + 1;
    S.focusLog = LG;
    notifyUser('专注完成', L('收获了一个{0} · 今天第 {1} 次', L(f.cropZh), LG.n));
    pushFocus();
  } else if (f.done && now - f.doneAt > 600) {
    S.focus = null;          // shipped
    pushFocus();
  }
}
function notifyUser(title, text, silent) {
  try {
    var a = Application.currentApplication();
    a.includeStandardAdditions = true;
    a.displayNotification(L(text), silent ? { withTitle: L(title) } : { withTitle: L(title), soundName: 'Glass' });
  } catch (e) { log('通知失败：' + e); }
}
function focusSummary() {
  var T = todayLog();
  var parts = Object.keys(T.crops).map(function (k) { return L('{0} 个{1}', T.crops[k], L(CROP_ZH[k] || k)); });
  if (T.notes) parts.push(L('{0} 张做完的待办', T.notes));
  return parts.join(curLang() === 'en' ? ', ' : '、');
}
function shippedToday() { var LG = todayLog(); return LG.n + (LG.notes || 0); }

// ---------- bulletin board: to-dos and the countdown to the end of the day ----------
// The scenes draw the board (scene/board.js); the data lives here so the menu can tick
// to-dos off and the end-of-day notification fires even while the scenes are paused.
var boardPanelWanted = false, musicPanelWanted = false;
function boardData() {
  var b = S.board || {};
  b.todos = b.todos || [];
  b.pay = b.pay || { daily: 0, start: '09:00', end: '18:00', lunch: false, lunchStart: '12:00', lunchEnd: '13:30', days: [1, 2, 3, 4, 5] };
  if (b.payOn == null) b.payOn = false;
  return b;
}
function setBoard(b) {
  boardTicked(S.board, b);
  S.board = b;
  var js = 'SDV.host.apply("board",' + JSON.stringify(b) + ')';
  callAll(js);
  editorCall(js);
}
function hm(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
// Same sums as scene/board.js: where today's working day stands, or null.
function boardPay(b, d) {
  if (!b.payOn) return null;
  var p = b.pay, s = hm(p.start), e = hm(p.end);
  if (s == null || e == null || e <= s) return null;
  var daily = Math.max(0, Number(p.daily) || 0);
  var o = b.today, work = o && o.day === todayKey() ? o.mode === 'work' : (p.days || []).indexOf(d.getDay()) >= 0;
  if (!work) return { status: 'rest', daily: daily, scheduled: (p.days || []).indexOf(d.getDay()) >= 0 };
  var ls = hm(p.lunchStart), le = hm(p.lunchEnd);
  var lunch = p.lunch && ls != null && le != null && ls > s && le > ls && le < e;
  var paid = e - s - (lunch ? le - ls : 0);
  var m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  var cl = function (v, a, z) { return Math.max(a, Math.min(z, v)); };
  var worked = cl(m, s, e) - s - (lunch ? cl(m, ls, le) - ls : 0);
  var status = m < s ? 'before' : m >= e ? 'after' : lunch && m >= ls && m < le ? 'lunch' : 'work';
  return { status: status, daily: daily, earned: daily * worked / paid, toEnd: (e - m) * 60, sinceEnd: (m - e) * 60, toStart: (s - m) * 60,
    scheduled: (p.days || []).indexOf(d.getDay()) >= 0 };
}
function boardTodos(b) {
  var t = todayKey();
  return b.todos.filter(function (x) { return !x.done || x.doneDay === t; });
}
function yuan(v) { return L('{0}金', Math.floor(v + 1e-9)); }   // whole gold, as the game shows money
function hmLeft(sec) { sec = Math.max(0, Math.ceil(sec / 60)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
// Every few seconds: drop yesterday's finished to-dos, and say when the day is done.
function boardTick() {
  var b = S.board;
  if (!b) return;
  var t = todayKey();
  var keep = (b.todos || []).filter(function (x) { return !x.done || x.doneDay === t; });
  var changed = keep.length !== (b.todos || []).length;
  if (b.today && b.today.day !== t) { b.today = null; changed = true; }
  b.todos = keep;
  if (todoReminders(b)) changed = true;
  if (changed) setBoard(b);
  var P = boardPay(boardData(), new Date());
  if (P && P.status === 'after' && b.remind !== false && P.sinceEnd < 1800 && getStr('boardNotified', '') !== t) {
    setStr('boardNotified', t);
    var left = boardTodos(b).filter(function (x) { return !x.done; }).length;
    var rang = playSfx('offwork', b);
    notifyUser('下班啦', (b.showMoney !== false && P.daily ? L('今天挣了 {0}，', yuan(P.daily)) : '') + (left ? L('还有 {0} 件待办留到明天', left) : L('辛苦了')), rang);
  }
}
// A to-do ticked off (anywhere: desktop, menu, settings window): the game's coin
// "ding", and its note goes into the shipping bin, counted with today's harvest.
// Unticking takes it back out.
function boardTicked(before, after) {
  var was = {}, plus = 0, minus = 0;
  ((before && before.todos) || []).forEach(function (t) { was[t.id] = Boolean(t.done); });
  ((after && after.todos) || []).forEach(function (t) {
    if (!(t.id in was)) return;
    if (t.done && !was[t.id]) plus++;
    else if (!t.done && was[t.id]) minus++;
  });
  if (!plus && !minus) return;
  var LG = todayLog();
  LG.notes = Math.max(0, (LG.notes || 0) + plus - minus);
  S.focusLog = LG;
  pushFocus();
  if (plus) playSfx('tick', after);
}
// Leaf menu → 公告板 → 添加待办…, or「＋ 添加待办」on the desktop board: a small box,
// Return adds it. Ticking「到点提醒」(or touching the time) sets a reminder.
var todoCheck = null;
function defaultTodoAt() { var d = new Date(Date.now() + 20 * 60000); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15); return d.getTime(); }
// The box is a small page (scene/todo.html) in the bulletin board's own look; the
// native alert below stays as the fallback.
function addTodoDialog() {
  try { openTodoWindow(); } catch (e) { log('添加待办窗口打不开，改用系统对话框：' + e); addTodoAlert(); }
}
function openTodoWindow() {
  var app = $.NSApplication.sharedApplication;
  app.activateIgnoringOtherApps(true);
  if (todoWin) { todoWin.win.makeKeyAndOrderFront(NIL); return; }
  var w = 440, h = 310;
  // titled | closable | full-size content: a real window that takes the keyboard, with the
  // title bar made see-through and its buttons hidden so only the wood shows
  var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, w, h), 1 | 2 | (1 << 15), 2, false);
  win.title = $(L('添加待办'));
  win.titlebarAppearsTransparent = true;
  win.titleVisibility = 1;
  win.movableByWindowBackground = true;
  win.releasedWhenClosed = false;
  win.opaque = false;
  win.backgroundColor = $.NSColor.clearColor;
  win.level = 3;                               // above the other windows, like the alert was
  for (var b = 0; b < 3; b++) { try { win.standardWindowButton(b).hidden = true; } catch (e) { /* ignore */ } }
  var web = makeWebView(w, h, 'todo', 'todo.html');
  try { web.wv.setValueForKey($.NSNumber.numberWithBool(false), 'drawsBackground'); } catch (e) { /* ignore */ }
  win.contentView = web.wv;
  win.center;
  todoWin = { win: win, wv: web.wv, ucc: web.ucc, ready: false };
  win.makeKeyAndOrderFront(NIL);
}
function closeTodoWindow() {
  var t = todoWin;
  todoWin = null;
  if (!t) return;
  try { t.ucc.removeScriptMessageHandlerForName('sdv'); } catch (e) { /* ignore */ }
  t.win.orderOut(NIL);
  t.win.close;
}
function onTodoMessage(body) {
  if (!body) return;
  if (body.type === 'hello') {
    todoWin.ready = true;
    todoWin.wv.evaluateJavaScriptCompletionHandler($('SDV_TODO.init(' + JSON.stringify({ lang: curLang(), at: defaultTodoAt() }) + ')'), noop);
  } else if (body.type === 'todoAdd') {
    var text = String(body.text || '').trim().slice(0, 40);
    later(closeTodoWindow);
    if (text) addTodo(text, Number(body.at) || null);
  } else if (body.type === 'todoCancel') {
    later(closeTodoWindow);
  }
}
function addTodo(text, at) {
  var b = boardData();
  var t = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: text, done: false };
  if (at && at > 0) t.at = at;
  b.todos.push(t);
  setBoard(b);
  log('添加待办「' + text + '」' + (t.at ? '，' + new Date(t.at).toString() + ' 提醒' : ''));
}
function addTodoAlert() {
  var app = $.NSApplication.sharedApplication;
  app.activateIgnoringOtherApps(true);
  var alert = $.NSAlert.alloc.init;
  alert.messageText = $(L('添加待办'));
  alert.informativeText = $(L('写一件要做的事，回车添加。\n要提醒的话勾上「到点提醒」，再选个时间。'));
  alert.addButtonWithTitle($(L('添加')));
  alert.addButtonWithTitle($(L('取消')));
  var box = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 300, 62));
  var tf = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 36, 300, 24));
  tf.placeholderString = $(L('比如：回复邮件'));
  box.addSubview(tf);
  var cb = null, dp = null, tt = null;
  try {
    cb = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 4, 96, 22));
    cb.setButtonType(3);                       // a checkbox
    cb.title = $(L('到点提醒'));
    box.addSubview(cb);
    dp = $.NSDatePicker.alloc.initWithFrame($.NSMakeRect(100, 2, 200, 26));
    dp.datePickerStyle = 0;                    // text field with stepper
    dp.datePickerElements = 0x00e0 | 0x000c;   // year-month-day, hour-minute
    dp.dateValue = $.NSDate.dateWithTimeIntervalSince1970(defaultTodoAt() / 1000);
    todoCheck = cb;
    try { dp.target = target; dp.action = 'todoTimeChanged:'; } catch (e) { /* the checkbox alone will do */ }
    box.addSubview(dp);
  } catch (e) {
    log('时间选择器不可用，改用文字输入：' + e);
    dp = null; cb = null;
    tt = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 2, 300, 24));
    tt.placeholderString = $(L('提醒时间（可不填），比如 15:30 或 明天 9:00'));
    box.addSubview(tt);
  }
  alert.accessoryView = box;
  alert.window.initialFirstResponder = tf;
  var resp = Number(alert.runModal);
  todoCheck = null;
  var text = String(ObjC.unwrap(tf.stringValue) || '').trim().slice(0, 40);
  if (resp === 1001 || !text) return;
  var at = null;
  if (cb && dp && Number(cb.state) === 1) at = Math.round(Number(dp.dateValue.timeIntervalSince1970) * 1000);
  else if (tt) at = parseTodoTime(String(ObjC.unwrap(tt.stringValue) || ''));
  addTodo(text, at);
}
// "15:30", "明天 9:00", "9点半" → ms, or null.
function parseTodoTime(s) {
  s = s.trim();
  if (!s) return null;
  var m = /(\d{1,2})\s*(?:[:：点]\s*(\d{1,2}|半)?|(?=\s*(?:am|pm)))/i.exec(s);
  if (!m) return null;
  var d = new Date();
  if (/明天|tomorrow/i.test(s)) d.setDate(d.getDate() + 1);
  else if (/后天/.test(s)) d.setDate(d.getDate() + 2);
  var h = Number(m[1]), mi = m[2] === '半' ? 30 : Number(m[2] || 0);
  if (/下午|晚上|pm/i.test(s) && h < 12) h += 12;
  if (/am/i.test(s) && h === 12) h = 0;
  d.setHours(h, mi, 0, 0);
  if (!/明天|后天|tomorrow/i.test(s) && d.getTime() < Date.now() - 60000) d.setDate(d.getDate() + 1);   // already past today: tomorrow
  return d.getTime();
}
// A to-do's time, short: "15:00", "明天 9:00", "10/23 9:00".
function todoTimeLabel(at) {
  var d = new Date(at), n = new Date();
  var hm = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  var days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  return days === 0 ? hm : days === 1 ? L('明天 {0}', hm) : days === -1 ? L('昨天 {0}', hm) : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}
// Every few seconds (boardTick): a to-do whose time has come gets its notification once.
// One missed while the Mac slept or the app was closed still comes, saying so; one more
// than a day late is let go quietly.
function todoReminders(b) {
  var now = Date.now(), changed = false;
  (b.todos || []).forEach(function (t) {
    if (!t.at || t.done || t.reminded || t.at > now) return;
    t.reminded = true; changed = true;
    var late = now - t.at;
    if (late > 864e5) return;
    var rang = playSfx('tick', b);
    notifyUser('⏰ 待办提醒', t.text + (late > 10 * 60000 ? L('（原定 {0}，刚才没能提醒）', todoTimeLabel(t.at)) : ''), rang);
    // macOS quietly drops notifications from an app that isn't allowed to send them, so
    // the farm shows its own slip over the board as well — that one always arrives.
    var js = 'SDV.host.remind(' + JSON.stringify(t.text) + ',' + JSON.stringify(t.id) + ')';
    callAll(js);
    editorCall(js);
    log('待办提醒：' + t.text);
  });
  return changed;
}

// ---------- sound effects from the game ----------
// "coin" (wave 5) when a to-do is ticked, "harvest" (wave 326) when the working day ends.
// Taken out of the game's wave bank once (same as the music), then played by the app.
var SFX = { tick: 5, offwork: 326 };
var sfx = { task: null, tried: false, players: {} };
function sfxFile(name) { return MUSIC_DIR + '/sfx_' + name + '.m4a'; }
function sfxOn(b) { return ((b || S.board || {}).sound) !== false; }
function prepareSfx() {
  if (sfx.task || sfx.tried) return;
  var xwb = S.contentDir ? S.contentDir + '/XACT/Wave Bank.xwb' : null;
  if (!xwb || !exists(xwb) || !musicScript) return;
  sfx.tried = true;
  mkdirs(MUSIC_DIR);
  var args = ['-c', '/usr/bin/osascript -l JavaScript "$0" "$@" >> "$HOME/Library/Logs/StardewDesk.log" 2>&1', musicScript, xwb, MUSIC_DIR];
  Object.keys(SFX).forEach(function (k) { args.push('sfx_' + k + ':' + SFX[k]); });
  var task = $.NSTask.alloc.init;
  task.launchPath = '/bin/sh';
  task.arguments = $(args);
  task.launch;
  sfx.task = task;
}
function sfxTick() {
  if (sfx.task && !sfx.task.isRunning) sfx.task = null;
  if (sfxOn() && !sfx.tried && Object.keys(SFX).some(function (k) { return !exists(sfxFile(k)); })) prepareSfx();
}
function playSfx(name, b) {
  if (!sfxOn(b)) return false;
  if (!exists(sfxFile(name))) { prepareSfx(); return false; }
  var p = sfx.players[name];
  if (!p) {
    p = $.AVAudioPlayer.alloc.initWithContentsOfURLError($.NSURL.fileURLWithPath($(sfxFile(name))), null);
    if (!p || p.isNil()) return false;
    sfx.players[name] = p;
  }
  p.volume = name === 'tick' ? 0.55 : 0.7;
  p.currentTime = 0;
  p.play;
  return true;
}

function boardMenu(menu) {
  var b = boardData(), P = boardPay(b, new Date()), list = boardTodos(b);
  var open = list.filter(function (x) { return !x.done; }).length;
  var title = L('公告板');
  if (P && P.status === 'work') title += L(' · 还有 {0} 下班', hmLeft(P.toEnd));
  else if (P && P.status === 'lunch') title += L(' · 午休中');
  else if (P && P.status === 'after') title += L(' · 下班啦');
  else if (P && P.status === 'rest') title += L(' · 今天休息');
  else if (open) title += L(' · 待办 {0}', open);
  var sub = $.NSMenu.alloc.initWithTitle($(L('公告板')));
  sub.autoenablesItems = false;
  if (!list.length) addItem(sub, '今天还没有待办');
  list.slice().sort(function (a, c) { return Number(Boolean(a.done)) - Number(Boolean(c.done)); }).slice(0, 12).forEach(function (x) {
    addItem(sub, (x.at ? '⏰' + todoTimeLabel(x.at) + ' ' : '') + x.text, 'menuAction:', 'todo:' + x.id, x.done);
  });
  if (P) {
    sub.addItem($.NSMenuItem.separatorItem);
    if (P.status !== 'rest' && b.showMoney !== false && P.daily) addItem(sub, L('今日已挣 {0} / {1}', yuan(P.status === 'after' ? P.daily : P.earned), yuan(P.daily)));
    if (P.status === 'work') addItem(sub, L('下班倒计时 {0}', hmLeft(P.toEnd)));
    else if (P.status === 'before') addItem(sub, L('还没上班 · {0} 后开始', hmLeft(P.toStart)));
    if (b.today && b.today.day === todayKey()) addItem(sub, '今天恢复平常安排', 'menuAction:', 'boardDay:auto');
    else if (P.scheduled) addItem(sub, '今天请假 / 调休（不算工资）', 'menuAction:', 'boardDay:off');
    else addItem(sub, '今天调休要上班', 'menuAction:', 'boardDay:work');
  }
  sub.addItem($.NSMenuItem.separatorItem);
  addItem(sub, '添加待办…', 'menuAction:', 'boardAdd');
  addItem(sub, '音效（打勾「叮」、下班收获声）', 'menuAction:', 'boardSound', sfxOn(b));
  addItem(sub, '设置上下班时间…', 'menuAction:', 'boardEdit');
  var item = addItem(menu, title, 'noop:');
  item.enabled = true; item.submenu = sub;
}
function boardAction(kind, val) {
  var b = boardData();
  if (kind === 'todo') {
    b.todos.forEach(function (x) { if (x.id === val) { x.done = !x.done; x.doneDay = x.done ? todayKey() : undefined; } });
    setBoard(b);
  } else if (kind === 'boardDay') {
    b.today = val === 'auto' ? null : { day: todayKey(), mode: val };
    setBoard(b);
  } else if (kind === 'boardAdd') {
    deferModal(addTodoDialog);
  } else if (kind === 'boardSound') {
    b.sound = !sfxOn(b);
    setBoard(b);
    if (b.sound) { sfx.tried = false; playSfx('tick', b); }
  } else if (kind === 'boardEdit') {
    var ready = editor && editor.ready;
    openEditor();
    if (ready) editorCall('SDV.host.openBoard()'); else boardPanelWanted = true;
  }
}

// ---------- the folder the scene runs from ----------
// The app carries only its own code. The pictures come from the user's copy of the
// game (first-run setup) and live in ~/Library/Application Support/Stardew Desk,
// next to a fresh copy of the code made at every launch.
var fm = $.NSFileManager.defaultManager;
function exists(path) { return fm.fileExistsAtPath($(path)); }
function mkdirs(path) { fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(path), true, $(), null); }
function readText(path) {
  var t = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null);
  return t && !t.isNil() ? t.js : null;
}
function prepareRunDir() {
  mkdirs(sceneDir + '/data/img');
  var items = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError($(codeDir), null)) || [];
  items.forEach(function (name) {
    if (name === 'data' || name[0] === '.') return;
    var dst = sceneDir + '/' + name;
    if (exists(dst)) fm.removeItemAtPathError($(dst), null);
    fm.copyItemAtPathToPathError($(codeDir + '/' + name), $(dst), null);
  });
}
function dataReady() {
  return exists(sceneDir + '/data/farm.js') && (readText(sceneDir + '/data/version.txt') || '').trim() === DATA_VERSION;
}

// ---------- where the weather comes from ----------
// No city picker: the weather and the sun follow the Mac's time zone, mapped to a big
// city in it. China's single time zone (and anything not listed) keeps the scene's
// default, Hangzhou (scene/config.js).
var TZ_CITY = {
  'Asia/Hong_Kong': [22.32, 114.17], 'Asia/Macau': [22.2, 113.55], 'Asia/Taipei': [25.03, 121.56],
  'Asia/Tokyo': [35.68, 139.69], 'Asia/Seoul': [37.57, 126.98], 'Asia/Singapore': [1.35, 103.82],
  'Asia/Bangkok': [13.75, 100.5], 'Asia/Kolkata': [28.61, 77.21], 'Asia/Dubai': [25.2, 55.27],
  'Europe/London': [51.51, -0.13], 'Europe/Paris': [48.86, 2.35], 'Europe/Berlin': [52.52, 13.4],
  'Europe/Madrid': [40.42, -3.7], 'Europe/Rome': [41.9, 12.5], 'Europe/Amsterdam': [52.37, 4.9],
  'America/New_York': [40.71, -74.01], 'America/Toronto': [43.65, -79.38], 'America/Chicago': [41.88, -87.63],
  'America/Denver': [39.74, -104.99], 'America/Los_Angeles': [34.05, -118.24], 'America/Vancouver': [49.28, -123.12],
  'Australia/Sydney': [-33.87, 151.21], 'Australia/Melbourne': [-37.81, 144.96], 'Pacific/Auckland': [-36.85, 174.76],
};
function autoLocation() {
  if (S.location) return S.location;      // chosen in 天气 › 更换城市…
  try {
    var c = TZ_CITY[$.NSTimeZone.localTimeZone.name.js];
    return c ? { lat: c[0], lon: c[1] } : null;
  } catch (e) { return null; }
}

// ---------- the weather city, typed in by the user ----------
// Leaf menu → 天气 → 更换城市…. Common Chinese cities are built in (no network needed);
// anything else goes to Open-Meteo's free place-name search (no API key).
var DEFAULT_LOC = { name: '杭州', lat: 30.27, lon: 120.15 };   // same as scene/config.js
var CN_CITIES = {
  '北京': [39.90, 116.41], '上海': [31.23, 121.47], '天津': [39.13, 117.20], '重庆': [29.56, 106.55],
  '广州': [23.13, 113.26], '深圳': [22.54, 114.06], '珠海': [22.27, 113.58], '佛山': [23.02, 113.12],
  '东莞': [23.02, 113.75], '中山': [22.52, 113.39], '惠州': [23.11, 114.42], '汕头': [23.35, 116.68],
  '杭州': [30.27, 120.15], '宁波': [29.87, 121.55], '温州': [28.00, 120.67], '绍兴': [30.00, 120.58],
  '嘉兴': [30.75, 120.76], '湖州': [30.89, 120.09], '金华': [29.08, 119.65], '义乌': [29.31, 120.08],
  '台州': [28.66, 121.42], '舟山': [29.99, 122.21], '丽水': [28.45, 119.92], '衢州': [28.97, 118.87],
  '南京': [32.06, 118.80], '苏州': [31.30, 120.59], '无锡': [31.49, 120.31], '常州': [31.81, 119.97],
  '南通': [31.98, 120.89], '扬州': [32.39, 119.41], '镇江': [32.19, 119.43], '徐州': [34.21, 117.28],
  '盐城': [33.35, 120.16], '泰州': [32.46, 119.92], '淮安': [33.61, 119.02], '连云港': [34.60, 119.22],
  '合肥': [31.82, 117.23], '芜湖': [31.35, 118.43], '黄山': [29.71, 118.34], '福州': [26.07, 119.30],
  '厦门': [24.48, 118.09], '泉州': [24.87, 118.68], '南昌': [28.68, 115.86], '九江': [29.71, 116.00],
  '赣州': [25.83, 114.93], '景德镇': [29.27, 117.18], '济南': [36.65, 117.12], '青岛': [36.07, 120.38],
  '烟台': [37.46, 121.45], '威海': [37.51, 122.12], '潍坊': [36.71, 119.16], '临沂': [35.10, 118.36],
  '淄博': [36.81, 118.05], '郑州': [34.75, 113.62], '洛阳': [34.62, 112.45], '武汉': [30.59, 114.31],
  '宜昌': [30.69, 111.29], '襄阳': [32.01, 112.12], '长沙': [28.23, 112.94], '株洲': [27.83, 113.13],
  '张家界': [29.12, 110.48], '南宁': [22.82, 108.37], '桂林': [25.27, 110.29], '柳州': [24.33, 109.41],
  '海口': [20.04, 110.20], '三亚': [18.25, 109.51], '成都': [30.57, 104.07], '绵阳': [31.47, 104.68],
  '贵阳': [26.65, 106.63], '遵义': [27.73, 106.93], '昆明': [25.04, 102.71], '大理': [25.61, 100.27],
  '丽江': [26.86, 100.23], '拉萨': [29.65, 91.12], '西安': [34.34, 108.94], '兰州': [36.06, 103.83],
  '西宁': [36.62, 101.78], '银川': [38.49, 106.23], '乌鲁木齐': [43.83, 87.62], '喀什': [39.47, 75.99],
  '伊宁': [43.92, 81.32], '阿勒泰': [47.84, 88.14], '呼和浩特': [40.84, 111.75], '包头': [40.66, 109.84],
  '石家庄': [38.04, 114.51], '保定': [38.87, 115.46], '唐山': [39.63, 118.18], '秦皇岛': [39.94, 119.60],
  '太原': [37.87, 112.55], '沈阳': [41.81, 123.43], '大连': [38.91, 121.61], '长春': [43.82, 125.32],
  '吉林': [43.84, 126.55], '延吉': [42.89, 129.51], '哈尔滨': [45.80, 126.53], '香港': [22.32, 114.17],
  '澳门': [22.20, 113.55], '台北': [25.03, 121.56], '高雄': [22.63, 120.30],
  // common cities abroad, by their Chinese names (the place-name search mostly knows English names)
  '东京': [35.68, 139.69], '大阪': [34.69, 135.50], '京都': [35.01, 135.77], '札幌': [43.06, 141.35],
  '福冈': [33.59, 130.40], '冲绳': [26.21, 127.68], '首尔': [37.57, 126.98], '釜山': [35.18, 129.08],
  '济州': [33.50, 126.53], '新加坡': [1.35, 103.82], '曼谷': [13.75, 100.50], '清迈': [18.79, 98.98],
  '普吉': [7.88, 98.39], '吉隆坡': [3.14, 101.69], '雅加达': [-6.21, 106.85], '巴厘岛': [-8.65, 115.22],
  '马尼拉': [14.60, 120.98], '河内': [21.03, 105.85], '胡志明市': [10.82, 106.63], '岘港': [16.05, 108.20],
  '金边': [11.56, 104.92], '新德里': [28.61, 77.21], '孟买': [19.08, 72.88], '迪拜': [25.20, 55.27],
  '伊斯坦布尔': [41.01, 28.98], '开罗': [30.04, 31.24], '伦敦': [51.51, -0.13], '曼彻斯特': [53.48, -2.24],
  '爱丁堡': [55.95, -3.19], '巴黎': [48.86, 2.35], '柏林': [52.52, 13.40], '慕尼黑': [48.14, 11.58],
  '法兰克福': [50.11, 8.68], '阿姆斯特丹': [52.37, 4.90], '布鲁塞尔': [50.85, 4.35], '苏黎世': [47.38, 8.54],
  '日内瓦': [46.20, 6.14], '维也纳': [48.21, 16.37], '布拉格': [50.08, 14.44], '罗马': [41.90, 12.50],
  '米兰': [45.46, 9.19], '威尼斯': [45.44, 12.32], '佛罗伦萨': [43.77, 11.26], '马德里': [40.42, -3.70],
  '巴塞罗那': [41.39, 2.17], '里斯本': [38.72, -9.14], '雅典': [37.98, 23.73], '哥本哈根': [55.68, 12.57],
  '斯德哥尔摩': [59.33, 18.07], '奥斯陆': [59.91, 10.75], '赫尔辛基': [60.17, 24.94], '雷克雅未克': [64.15, -21.94],
  '莫斯科': [55.76, 37.62], '纽约': [40.71, -74.01], '波士顿': [42.36, -71.06], '华盛顿': [38.91, -77.04],
  '芝加哥': [41.88, -87.63], '洛杉矶': [34.05, -118.24], '旧金山': [37.77, -122.42], '西雅图': [47.61, -122.33],
  '拉斯维加斯': [36.17, -115.14], '迈阿密': [25.76, -80.19], '夏威夷': [21.31, -157.86], '檀香山': [21.31, -157.86],
  '多伦多': [43.65, -79.38], '温哥华': [49.28, -123.12], '蒙特利尔': [45.50, -73.57], '墨西哥城': [19.43, -99.13],
  '悉尼': [-33.87, 151.21], '墨尔本': [-37.81, 144.96], '布里斯班': [-27.47, 153.03], '珀斯': [-31.95, 115.86],
  '奥克兰': [-36.85, 174.76], '惠灵顿': [-41.29, 174.78], '皇后镇': [-45.03, 168.66],
};
function currentLocation() { return autoLocation() || DEFAULT_LOC; }
function locationLabel() {
  if (S.location && S.location.name) return S.location.name;
  return L(autoLocation() ? '跟随时区自动' : '杭州（默认）');
}
function setLocation(loc) {
  log('设置天气城市：' + JSON.stringify(loc));
  S.location = loc;
  var cur = currentLocation();
  var js = 'SDV.host.apply("location",' + JSON.stringify(cur) + ')';
  callAll(js);
  editorCall(js);
  weather.lat = cur.lat; weather.lon = cur.lon;
  weather.configured = true;
  weather.failures = 0;
  weather.lastAttempt = 0;           // fetch the new city's weather right away
  weatherTick();
  log('天气城市：' + (loc ? loc.name + ' ' + loc.lat + ',' + loc.lon : '跟随时区'));
}
function infoAlert(title, text) {
  var alert = $.NSAlert.alloc.init;
  alert.messageText = $(L(title));
  alert.informativeText = $(L(text));
  alert.addButtonWithTitle($(L('好')));
  alert.runModal;
}
// Open-Meteo place-name search. Returns a list, or null when the network failed.
function geocode(name) {
  var tmp = $.NSTemporaryDirectory().js + 'stardewdesk-geo.json';
  fm.removeItemAtPathError($(tmp), null);
  var url = 'https://geocoding-api.open-meteo.com/v1/search?count=10&language=' + curLang() + '&format=json&name=' + encodeURIComponent(name);
  var t = $.NSTask.alloc.init;
  t.launchPath = '/usr/bin/curl';
  t.arguments = $(['-sS', '-m', '10', '-o', tmp, url]);
  t.launch;
  t.waitUntilExit;
  if (t.terminationStatus !== 0) return null;
  var text = $.NSString.stringWithContentsOfFileEncodingError(tmp, $.NSUTF8StringEncoding, null);
  try { return JSON.parse(text.js).results || []; } catch (e) { return null; }
}
function chooseCity(list) {
  var alert = $.NSAlert.alloc.init;
  alert.messageText = $(L('找到好几个，选一个'));
  alert.addButtonWithTitle($(L('确定')));
  alert.addButtonWithTitle($(L('取消')));
  var pop = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, 320, 26), false);
  list.forEach(function (r, i) {
    var label = [r.name, r.admin1, r.country].filter(function (x) { return x; }).join(' · ');
    pop.addItemWithTitle($((i + 1) + '. ' + label));   // numbered, so same-named places stay separate
  });
  alert.accessoryView = pop;
  if (Number(alert.runModal) === 1001) return null;
  return list[Number(pop.indexOfSelectedItem)] || null;
}
function cityDialog() {
  var app = $.NSApplication.sharedApplication;
  app.activateIgnoringOtherApps(true);
  var alert = $.NSAlert.alloc.init;
  alert.messageText = $(L('天气跟着哪个城市？'));
  alert.informativeText = $(L('输入城市名，比如：北京、苏州、成都。\n国外城市也可以用英文，比如 Tokyo、London。'));
  alert.addButtonWithTitle($(L('确定')));
  alert.addButtonWithTitle($(L('取消')));
  var tf = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 0, 280, 24));
  tf.placeholderString = $(L('城市名'));
  if (S.location && S.location.name) tf.stringValue = $(S.location.name);
  alert.accessoryView = tf;
  alert.window.initialFirstResponder = tf;
  var resp = Number(alert.runModal);
  var text = String(ObjC.unwrap(tf.stringValue) || '').trim().slice(0, 40);
  log('更换城市：按钮 ' + resp + '，输入「' + text + '」');
  if (resp === 1001 || !text) return;          // 1001 = 取消 (the second button)
  var key = text.replace(/\s+/g, '').replace(/(市|县|区|特别行政区)$/, '');
  if (CN_CITIES[key]) { setLocation({ name: key, lat: CN_CITIES[key][0], lon: CN_CITIES[key][1] }); cityDone(); return; }
  var res = geocode(text);
  if (res === null) { infoAlert('没连上网络', '这个城市要联网查一下位置，请检查网络后再试。'); return; }
  if (!res.length) { infoAlert(L('没找到「{0}」', text), '换个写法试试：去掉「市」「县」，或者用拼音、英文。'); return; }
  // biggest places first, so「伦敦」lists London, UK before the small towns named after it
  res.sort(function (a, b) { return (b.population || 0) - (a.population || 0); });
  var pick = res.length > 1 ? chooseCity(res) : res[0];
  if (!pick) return;
  setLocation({ name: pick.name, lat: Math.round(pick.latitude * 100) / 100, lon: Math.round(pick.longitude * 100) / 100 });
  cityDone();
}
// ---------- 从存档导入布局 ----------
// The settings page asks; we list the saves on this Mac, the user picks one, and the
// page gets what scene/savefile.js read from it (buildings, animals, pet). Read-only.
var saveReader = null;
function saveApi() {
  if (saveReader) return saveReader;
  var src = readText(codeDir + '/savefile.js');
  if (!src) throw new Error('找不到 savefile.js');
  saveReader = (new Function(src + '\nreturn SDV_SAVE;'))();
  return saveReader;
}
function savesDir() { return $.NSHomeDirectory().js + '/.config/StardewValley/Saves'; }
var SEASON_ZH = { spring: '春', summer: '夏', fall: '秋', winter: '冬' };
function listSaves() {
  var dir = savesDir();
  var names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError($(dir), null)) || [];
  var out = [];
  names.forEach(function (n) {
    if (n[0] === '.') return;
    var file = dir + '/' + n + '/' + n;
    if (!exists(file)) return;
    var info = null;
    try { info = saveApi().info(readText(dir + '/' + n + '/SaveGameInfo') || ''); } catch (e) { info = null; }
    var when = 0;
    try { var at = fm.attributesOfItemAtPathError($(file), null); when = at && !at.isNil() ? Number(at.fileModificationDate.timeIntervalSince1970) : 0; } catch (e) { /* ignore */ }
    var label = info && info.farmName ? L('{0}农场', info.farmName) + (info.name ? L('（{0}）', info.name) : '') : n.replace(/_\d+$/, '');
    if (info && info.year) label += L(' · 第 {0} 年{1}{2}', info.year, L(SEASON_ZH[info.season] || ''), info.day ? L(' {0} 日', info.day) : '');
    out.push({ file: file, label: label, when: when });
  });
  out.sort(function (a, b) { return b.when - a.when; });   // the one played last first
  return out;
}
function importSaveDialog() {
  var app = $.NSApplication.sharedApplication;
  app.activateIgnoringOtherApps(true);
  var list = [];
  try { list = listSaves(); } catch (e) { log('列出存档失败：' + e); }
  var alert = $.NSAlert.alloc.init;
  alert.messageText = $(L('从存档导入布局'));
  var pop = null;
  if (list.length) {
    alert.informativeText = $(L('选一个存档。只读取，不会改动存档。\n导入会替换现在的布局；现在的布局会先自动备份到「我的布局」。'));
    alert.addButtonWithTitle($(L('导入')));
    alert.addButtonWithTitle($(L('取消')));
    alert.addButtonWithTitle($(L('选择其他文件…')));
    pop = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, 340, 26), false);
    list.forEach(function (x, i) { pop.addItemWithTitle($((i + 1) + '. ' + x.label)); });
    alert.accessoryView = pop;
  } else {
    alert.informativeText = $(L('在 ~/.config/StardewValley/Saves 里没找到存档。\n存档在别处的话，可以手动选择存档文件（存档文件夹里和文件夹同名的那个文件）。'));
    alert.addButtonWithTitle($(L('选择存档文件…')));
    alert.addButtonWithTitle($(L('取消')));
  }
  var resp = Number(alert.runModal);
  var file = null;
  if (list.length && resp === 1000) file = list[Number(pop.indexOfSelectedItem)].file;
  else if ((list.length && resp === 1002) || (!list.length && resp === 1000)) file = chooseSaveFile();
  if (!file) return;
  log('从存档导入布局：' + file);
  var msg;
  try {
    var text = readText(file);
    if (!text) throw new Error(L('读不出这个文件'));
    msg = { save: saveApi().parse(text) };
    log('存档「' + msg.save.farmName + '」：' + msg.save.buildings.length + ' 座建筑');
  } catch (e) {
    log('读取存档失败：' + e);
    msg = { error: L('读不了这个存档：{0}', L(e && e.message ? e.message : String(e))) };
  }
  editorCall('SDV.host.importSave(' + JSON.stringify(msg) + ')');
  if (editor) editor.win.makeKeyAndOrderFront(NIL);
}
function chooseSaveFile() {
  var panel = $.NSOpenPanel.openPanel;
  panel.canChooseFiles = true;
  panel.canChooseDirectories = false;
  panel.allowsMultipleSelection = false;
  panel.message = $(L('选择星露谷的存档文件（存档文件夹里和文件夹同名、没有后缀的那个）'));
  var dir = savesDir();
  if (exists(dir)) panel.directoryURL = $.NSURL.fileURLWithPath($(dir));
  if (Number(panel.runModal) !== 1) return null;
  return ObjC.unwrap(panel.URL.path);
}

function cityDone() {
  infoAlert(L('天气已切换到「{0}」', S.location.name), '日出日落马上按新城市计算，实时天气几秒后更新。\n菜单 天气 › 所在城市 里可以看到当前城市。');
}

// ---------- first-run setup ----------
function looksLikeContent(dir) { return Boolean(dir) && exists(dir + '/Maps/Farm.xnb'); }
function findContent() {
  var home = $.NSHomeDirectory().js;
  var cands = [];
  if (S.contentDir) cands.push(S.contentDir);
  var steam = home + '/Library/Application Support/Steam/steamapps';
  cands.push(steam + '/common/Stardew Valley/Contents/Resources/Content');
  // Steam libraries on other drives
  var vdf = readText(steam + '/libraryfolders.vdf') || '';
  var re = /"path"\s+"([^"]+)"/g, m;
  while ((m = re.exec(vdf))) cands.push(m[1] + '/steamapps/common/Stardew Valley/Contents/Resources/Content');
  cands.push('/Applications/Stardew Valley.app/Contents/Resources/Content');
  cands.push(home + '/Applications/Stardew Valley.app/Contents/Resources/Content');
  var pd = projectDir();
  if (pd) cands.push(pd + '/game-content/Content');
  for (var i = 0; i < cands.length; i++) if (looksLikeContent(cands[i])) return cands[i];
  return null;
}
function resolveContent(picked) {
  var tries = [picked, picked + '/Content', picked + '/Contents/Resources/Content', picked + '/Stardew Valley.app/Contents/Resources/Content',
    picked + '/Resources/Content'];
  for (var i = 0; i < tries.length; i++) if (looksLikeContent(tries[i])) return tries[i];
  return null;
}
function openSetup(mode) {
  if (setup) closeSetup();             // start afresh (it may have been closed half way)
  var rect = $.NSMakeRect(0, 0, 560, 470);
  var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(rect, 1 | 2, 2, false);
  win.title = $(L('欢迎使用 {0}', APP_NAME));
  win.releasedWhenClosed = false;
  var web = makeWebView(560, 470, 'setup', 'setup.html');
  win.contentView = web.wv;
  win.center;
  setup = { win: win, wv: web.wv, ucc: web.ucc, mode: mode, tried: false };
  $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
  win.makeKeyAndOrderFront(NIL);
}
function closeSetup() {
  if (!setup) return;
  try { setup.ucc.removeScriptMessageHandlerForName('sdv'); } catch (e) { /* ignore */ }
  setup.win.orderOut(NIL);
  setup.win.close;
  setup = null;
}
function setupCall(js) { if (setup) setup.wv.evaluateJavaScriptCompletionHandler($(js), noop); }
function sendSetupStart() {
  var c = findContent();
  if (!c) { setupCall('SDV_SETUP.start(' + JSON.stringify({ content: null, tried: setup.tried, lang: curLang() }) + ')'); return; }
  S.contentDir = c;
  var files = ObjC.deepUnwrap(fm.subpathsOfDirectoryAtPathError($(c), null)) || [];
  files = files.filter(function (f) { return /\.xnb$/i.test(f); });
  log('游戏素材：' + c + '（' + files.length + ' 个文件）');
  setupCall('SDV_SETUP.start(' + JSON.stringify({ content: c, files: files, music: S.music, lang: curLang() }) + ')');
}
function onSetupMessage(m) {
  if (m.type === 'hello') sendSetupStart();
  else if (m.type === 'choose') {
    var panel = $.NSOpenPanel.openPanel;
    panel.canChooseFiles = true;
    panel.canChooseDirectories = true;
    panel.allowsMultipleSelection = false;
    panel.treatsFilePackagesAsDirectories = false;
    panel.message = $(L('选择 Stardew Valley（游戏本身，或它所在的文件夹）'));
    if (panel.runModal === 1) {
      var picked = panel.URL.path.js, c = resolveContent(picked);
      setup.tried = true;
      if (c) S.contentDir = c;
    }
    sendSetupStart();
  } else if (m.type === 'read') {
    var d = $.NSData.dataWithContentsOfFile($(S.contentDir + '/' + m.path));
    var b64 = d && !d.isNil() ? d.base64EncodedStringWithOptions(0).js : null;
    setupCall('SDV_SETUP.file(' + Number(m.id) + ',' + (b64 ? '"' + b64 + '"' : 'null') + ')');
  } else if (m.type === 'write') {
    if (!/^[\w\-]+(\/[\w\-]+)*\.(png|js|txt)$/.test(m.path || '')) { log('拒绝写入 ' + m.path); return; }
    var path = sceneDir + '/data/' + m.path;
    mkdirs(path.slice(0, path.lastIndexOf('/')));
    $.NSData.alloc.initWithBase64EncodedStringOptions($(m.b64), 0).writeToFileAtomically($(path), true);
  } else if (m.type === 'finish') {
    if (m.music) S.music = m.music;
    closeSetup();
    if (scenes.length) reloadScenes(); else buildScenes();
    log('初次设置完成');
    musicTick();
  }
}
function reloadScenes() {
  scenes.forEach(function (s) { s.ready = false; s.fps = -1; s.wv.reload; });
  if (editor) { editor.ready = false; editor.wv.reload; }
}

// ---------- background music ----------
// The game's own tracks (scene/music.js lists them: cue → wave number in the game's wave
// bank). By default the three of the current season play, like the game; or the user's
// own playlist from the settings window. A track is turned into a small AAC file by
// musicx.js in the background the first time it's wanted; then AVAudioPlayer plays it,
// with a quiet minute or so between tracks (a few seconds in a playlist).
var MUSIC_FALLBACK = {
  spring: [['spring1', 93], ['spring2', 91], ['spring3', 92]],
  summer: [['summer1', 122], ['summer2', 123], ['summer3', 115]],
  fall: [['fall1', 121], ['fall2', 119], ['fall3', 120]],
  winter: [['winter1', 126], ['winter2', 124], ['winter3', 125]],
};
var musicLibCache = null;
function musicLib() {
  if (musicLibCache) return musicLibCache;
  try {
    var t = readText(codeDir + '/music.js');
    if (t) musicLibCache = eval('(function () {' + t + '\n;return SDV_MUSIC; })()');
  } catch (e) { log('读不了曲目表：' + e); }
  return musicLibCache;
}
function normalizePick(v) {
  var o = v && typeof v === 'object' ? v : {};
  return { mode: o.mode === 'list' ? 'list' : 'season', list: Array.isArray(o.list) ? o.list.filter(function (x) { return typeof x === 'string'; }).slice(0, 80) : [],
    order: o.order === 'order' ? 'order' : 'shuffle' };
}
function trackName(id) { var ML = musicLib(), t = ML && ML.byId[id]; return t ? (curLang() === 'en' ? t.en : t.zh) : id; }
// The tracks to choose from now: [[id, wave]]
function musicPool() {
  var ML = musicLib(), P = S.musicPick;
  if (ML && P.mode === 'list') {
    var list = P.list.map(function (id) { return ML.byId[id]; }).filter(Boolean).map(function (t) { return [t.id, t.wave]; });
    if (list.length) return { key: 'list', tracks: list };
  }
  var season = currentSeason();
  var ids = ML ? ML.seasons[season].map(function (id) { return [id, ML.byId[id].wave]; }) : MUSIC_FALLBACK[season];
  return { key: season, tracks: ids };
}
var MUSIC_DIR = SUPPORT + '/music';
var music = { player: null, key: null, last: null, gapUntil: 0, stopAt: 0, task: null, preparing: null, failed: {}, request: null, status: '' };
function musicFile(name) { return MUSIC_DIR + '/' + name + '.m4a'; }
function musicWanted() {
  if (locked || screensAsleep) return false;
  if (S.music === 'always') return !S.paused;
  if (S.music === 'saver') return Boolean(saver);
  return false;
}
function prepareTracks(tracks, label) {
  var xwb = S.contentDir ? S.contentDir + '/XACT/Wave Bank.xwb' : null;
  if (!xwb || !exists(xwb) || !musicScript) { tracks.forEach(function (t) { music.failed[t[0]] = '找不到游戏的音乐文件'; }); return; }
  mkdirs(MUSIC_DIR);
  var args = ['-c', '/usr/bin/osascript -l JavaScript "$0" "$@" >> "$HOME/Library/Logs/StardewDesk.log" 2>&1', musicScript, xwb, MUSIC_DIR];
  tracks.forEach(function (t) { args.push(t[0] + ':' + t[1]); });
  var task = $.NSTask.alloc.init;
  task.launchPath = '/bin/sh';
  task.arguments = $(args);
  task.launch;
  music.task = task;
  music.preparing = { label: label, ids: tracks.map(function (t) { return t[0]; }) };
  log('准备配乐：' + label);
}
function musicStop(fade) {
  var p = music.player;
  if (!p) return;
  if (fade) { p.setVolumeFadeDuration(0, 1.5); music.stopAt = Date.now() + 1600; }
  else { p.stop; music.player = null; music.stopAt = 0; }
}
// What plays next: a track asked for in the settings window, else the next in the pool.
function nextTrack(pool) {
  var all = pool.tracks;
  if (music.request) {
    var ML = musicLib(), t = ML && ML.byId[music.request];
    if (t) return [t.id, t.wave];
    music.request = null;
  }
  if (!all.length) return null;
  if (S.musicPick.order === 'order' && pool.key === 'list') {
    var i = all.findIndex(function (t) { return t[0] === music.last; });
    return all[(i + 1) % all.length];
  }
  var choices = all.filter(function (t) { return t[0] !== music.last && !music.failed[t[0]]; });
  if (!choices.length) choices = all.filter(function (t) { return !music.failed[t[0]]; });
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
}
function musicTick() {
  if (music.task && !music.task.isRunning) {
    if (music.task.terminationStatus !== 0 && music.preparing) music.preparing.ids.forEach(function (id) { if (!exists(musicFile(id))) music.failed[id] = '配乐准备失败，详情见日志'; });
    music.task = null; music.preparing = null;
  }
  if (music.stopAt && Date.now() >= music.stopAt) musicStop(false);
  var want = musicWanted() || Boolean(music.request) || Boolean(music.preview && music.player && !music.stopAt);
  if (!want) { if (music.player && !music.stopAt) musicStop(true); pushMusicState(); return; }
  var pool = musicPool();
  if (music.player) {
    if (music.stopAt) return;
    if (music.request || music.key !== pool.key) { musicStop(true); return; }   // asked for another / a new season: fade out
    music.player.volume = MUSIC_VOL[S.musicVolume];
    if (!music.player.isPlaying) {
      music.player = null; music.preview = false;
      music.gapUntil = Date.now() + (pool.key === 'list' ? 3 + Math.random() * 5 : 20 + Math.random() * 40) * 1000;
      pushMusicState();
    }
    return;
  }
  if (Date.now() < music.gapUntil && !music.request) { pushMusicState(); return; }
  var pick = nextTrack(pool);
  if (!pick) { pushMusicState(); return; }
  if (!exists(musicFile(pick[0]))) {
    if (!music.task && !music.failed[pick[0]]) prepareTracks([pick], trackName(pick[0]));
    if (music.failed[pick[0]]) { if (music.request === pick[0]) music.request = null; music.last = pick[0]; }
    pushMusicState();
    return;
  }
  var p = $.AVAudioPlayer.alloc.initWithContentsOfURLError($.NSURL.fileURLWithPath($(musicFile(pick[0]))), null);
  music.request = null;
  if (!p || p.isNil()) { log('播放失败：' + pick[0]); music.failed[pick[0]] = '播放失败'; music.gapUntil = Date.now() + 5000; return; }
  p.volume = 0;
  p.prepareToPlay;
  p.play;
  p.setVolumeFadeDuration(MUSIC_VOL[S.musicVolume], 3);
  music.player = p; music.key = pool.key; music.last = pick[0];
  log('播放 ' + pick[0]);
  pushMusicState();
}
function musicStatus() {
  var zh = L({ spring: '春', summer: '夏', fall: '秋', winter: '冬' }[currentSeason()]);
  if (S.music === 'off' && !music.player) return null;
  if (music.preparing) return L('正在从游戏里取出「{0}」…', trackName(music.preparing.ids[0]));
  if (music.player && !music.stopAt) return L('正在播放：{0}', trackName(music.last));
  var pool = musicPool(), bad = pool.tracks.filter(function (t) { return music.failed[t[0]]; });
  if (bad.length && bad.length === pool.tracks.length) return L(music.failed[bad[0][0]]);
  if (S.music === 'saver') return pool.key === 'list' ? L('屏保时播放我的歌单') : L('屏保时播放{0}天的配乐', zh);
  return L('配乐间歇中');
}
// The settings window's 音乐 page: what's set and what's playing.
function musicState() {
  return { music: S.music, volume: S.musicVolume, pick: S.musicPick, now: music.player && !music.stopAt ? music.last : null,
    preparing: music.preparing ? music.preparing.ids : [], status: musicStatus() || '', season: currentSeason() };
}
function pushMusicState() {
  var st = JSON.stringify(musicState());
  if (st === music.status) return;
  music.status = st;
  editorCall('SDV.host.apply("musicState",' + st + ')');
}
function musicPlay(id) {
  var ML = musicLib();
  if (!ML || !ML.byId[id]) return;
  music.request = id; music.gapUntil = 0;
  music.preview = !musicWanted();                 // 试听 while the music is off: just this track
  if (music.failed[id]) delete music.failed[id];
  musicTick();
}
function musicNext() {
  var pool = musicPool(), n = null;
  music.request = null;
  if (music.player) { music.gapUntil = 0; n = nextTrack(pool); }
  else n = nextTrack(pool);
  if (n) musicPlay(n[0]);
}

// ---------- policy: when to render, how fast ----------
function lowPower() {
  try { return Boolean($.NSProcessInfo.processInfo.isLowPowerModeEnabled); } catch (e) { return false; }
}
function stopReason() {
  if (saver) return '屏保运行中';
  if (S.paused) return '已暂停';
  if (lowPower()) return '低电量模式，已停止';
  if (locked) return '锁屏中，已停止';
  if (screensAsleep) return '屏幕休眠，已停止';
  return null;
}
function fpsFor(i) {
  if (stopReason()) return 0;
  var c = coverage[i] || 0;
  var q = QUALITY[S.quality].fps;
  if (c > 0.97) return 0;
  if (c > 0.6) return Math.min(8, q);
  return q;
}
// Why fpsFor(i) returned what it did, for the log — fpsFor alone can't tell a saver
// pause from a window-coverage pause from a low-power pause, and they all look the
// same on screen (the farm freezes), so this is what makes a repeat flicker diagnosable.
function fpsReason(i) {
  var r = stopReason();
  if (r) return r;
  var c = coverage[i] || 0;
  if (c > 0.97) return '窗口遮挡 ' + Math.round(c * 100) + '%，已停止渲染';
  if (c > 0.6) return '窗口遮挡 ' + Math.round(c * 100) + '%，降帧';
  return null;
}
function applyPolicy() {
  scenes.forEach(function (s, i) { setFps(s, fpsFor(i), fpsReason(i)); });
  restartCursorTimer();
}

// Fraction of each display covered by ordinary app windows, sampled on a grid.
function updateCoverage() {
  var info = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
  var me = $.NSProcessInfo.processInfo.processIdentifier;
  var primaryH = $.NSScreen.screens.js[0].frame.size.height;
  var rects = [];
  info.forEach(function (w) {
    if (w.kCGWindowLayer !== 0) return;
    if (w.kCGWindowOwnerPID === me) return;
    if (typeof w.kCGWindowAlpha === 'number' && w.kCGWindowAlpha < 0.05) return;
    var b = w.kCGWindowBounds;
    if (b) rects.push({ x: b.X, y: b.Y, w: b.Width, h: b.Height });
  });
  windowRects = rects;
  scenes.forEach(function (s, i) {
    var f = s.frame;
    var sx = f.x, sy = primaryH - (f.y + f.h); // to Quartz (top-left) coords
    var cols = 48, rows = 30, covered = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var px = sx + (c + 0.5) * f.w / cols, py = sy + (r + 0.5) * f.h / rows;
        for (var k = 0; k < rects.length; k++) {
          var q = rects[k];
          if (px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h) { covered++; break; }
        }
      }
    }
    coverage[i] = covered / (cols * rows);
  });
  applyPolicy();
}

// ---------- cursor ----------
function cursorTick() {
  var p = $.NSEvent.mouseLocation;
  var qy = $.NSScreen.screens.js[0].frame.size.height - p.y;   // Quartz (top-left) y
  // is the cursor over a window, or over the bare desktop?
  var covered = windowRects.some(function (q) { return p.x >= q.x && p.x < q.x + q.w && qy >= q.y && qy < q.y + q.h; });
  scenes.forEach(function (s) {
    var f = s.frame, key = null;
    if (p.x >= f.x && p.x < f.x + f.w && p.y >= f.y && p.y < f.y + f.h) {
      key = Math.round(p.x - f.x) + ',' + Math.round(f.y + f.h - p.y) + ',' + (covered ? 1 : 0);
    }
    if (key === s.cursor) return;
    s.cursor = key;
    call(s, key ? 'SDV.host.cursor(' + key + ')' : 'SDV.host.cursor(null)');
  });
}
function restartCursorTimer() {
  var max = 0;
  scenes.forEach(function (s, i) { max = Math.max(max, fpsFor(i)); });
  var interval = max > 0 ? 1 / Math.min(max, 20) : 0;
  if (interval === cursorInterval) return;
  if (cursorTimer) { cursorTimer.invalidate; cursorTimer = null; }
  cursorInterval = interval;
  if (interval > 0) cursorTimer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(interval, target, 'cursorTick:', NIL, true);
}

// ---------- weather (curl runs in the background, read on the next tick) ----------
var WEATHER_TMP = $.NSTemporaryDirectory().js + 'stardewdesk-weather.json';
function weatherLoad() {
  var saved = getStr('weatherLive', null);
  if (saved) { try { weather.latest = JSON.parse(saved); } catch (e) { /* ignore */ } }
}
function weatherFetch() {
  weather.lastAttempt = Date.now();
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + weather.lat + '&longitude=' + weather.lon
    + '&current=weather_code,precipitation,wind_speed_10m&timezone=auto';
  var t = $.NSTask.alloc.init;
  t.launchPath = '/usr/bin/curl';
  t.arguments = $(['-sS', '-m', '20', '-o', WEATHER_TMP, url]);
  t.launch;
  weather.task = t;
}
function weatherCollect() {
  var t = weather.task;
  if (!t || t.isRunning) return;
  weather.task = null;
  var ok = false;
  if (t.terminationStatus === 0) {
    var text = $.NSString.stringWithContentsOfFileEncodingError(WEATHER_TMP, $.NSUTF8StringEncoding, null);
    try {
      var cur = JSON.parse(text.js).current;
      if (cur && typeof cur.weather_code === 'number') {
        weather.latest = { code: cur.weather_code, precip: cur.precipitation || 0, wind: cur.wind_speed_10m || 0, at: Date.now() };
        setStr('weatherLive', JSON.stringify(weather.latest));
        callAll('SDV.host.setLiveWeather(' + JSON.stringify(weather.latest) + ')');
        editorCall('SDV.host.setLiveWeather(' + JSON.stringify(weather.latest) + ')');
        ok = true;
      }
    } catch (e) { /* bad json */ }
  }
  if (ok) { weather.failures = 0; log('天气已更新：' + JSON.stringify(weather.latest)); }
  else { weather.failures++; log('天气获取失败（第 ' + weather.failures + ' 次）'); }
}
function weatherTick() {
  weatherCollect();
  if (!weather.configured || weather.task) return;
  var wait = weather.failures > 0 ? Math.min(weather.refresh, 5 * 60 * Math.pow(2, weather.failures - 1)) : weather.refresh;
  var age = Date.now() - (weather.latest ? weather.latest.at : 0);
  var since = Date.now() - weather.lastAttempt;
  if (since >= wait * 1000 && (weather.failures > 0 || age >= weather.refresh * 1000 || weather.lastAttempt === 0)) weatherFetch();
}

// ---------- screensaver ----------
// Seconds since the last keyboard / mouse / trackpad input.
var idleViaCG = true, ioregAt = 0, ioregIdle = 0;
function idleSeconds() {
  if (idleViaCG) {
    try {
      var v = $.CGEventSourceSecondsSinceLastEventType(0, 4294967295); // combined session, any input
      if (typeof v === 'number' && v >= 0) return v;
    } catch (e) { /* fall back below */ }
    idleViaCG = false;
    log('改用 ioreg 读取闲置时间');
  }
  // ioreg is slower: sample at most every 0.3 s and extrapolate in between.
  var now = Date.now();
  if (now - ioregAt > 300) {
    var out = runSync('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4']);
    var m = /"HIDIdleTime" = (\d+)/.exec(out || '');
    ioregIdle = m ? Number(m[1]) / 1e9 : 0;
    ioregAt = now;
    return ioregIdle;
  }
  return ioregIdle + (now - ioregAt) / 1000;
}

// The project folder this copy was installed from (written by install.sh), or null.
function projectDir() {
  try {
    var v = $.NSBundle.mainBundle.objectForInfoDictionaryKey('SDVProjectDir');
    return v && !v.isNil() ? v.js : null;
  } catch (e) { return null; }
}
// Reinstall from the project folder, the same as running mac/install.sh: the script
// quits this app, rebuilds it and opens the new one. It runs detached so it outlives us.
function updateFromProject() {
  var dir = projectDir();
  if (!dir) return;
  flushSettings();
  var q = function (s) { return "'" + s.replace(/'/g, "'\\''") + "'"; };
  var logFile = $.NSHomeDirectory().js + '/Library/Logs/StardewDesk-install.log';
  var t = $.NSTask.alloc.init;
  t.launchPath = '/bin/sh';
  t.arguments = $(['-c', 'cd ' + q(dir) + ' && nohup sh mac/install.sh > ' + q(logFile) + ' 2>&1 &']);
  t.launch;
  log('从 ' + dir + ' 重新安装');
}

function runSync(path, args) {
  try {
    var t = $.NSTask.alloc.init;
    t.launchPath = path;
    t.arguments = $(args);
    var pipe = $.NSPipe.pipe;
    t.standardOutput = pipe;
    t.standardError = $.NSPipe.pipe;
    t.launch;
    var data = pipe.fileHandleForReading.readDataToEndOfFile;
    t.waitUntilExit;
    return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
  } catch (e) { return ''; }
}

// A video or a call keeps the display awake: don't start the screensaver over it.
function displayHeldAwake() {
  var out = runSync('/usr/bin/pmset', ['-g', 'assertions']);
  var m = /PreventUserIdleDisplaySleep\s+(\d+)/.exec(out || '');
  return Boolean(m && Number(m[1]) > 0);
}

function startSaver(preview) {
  if (saver) return;
  var app = $.NSApplication.sharedApplication;
  var prev = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  saver = { views: [], prevApp: prev, started: Date.now(), lastIdle: idleSeconds(), alpha: 0, closing: false, preview: preview };
  $.NSScreen.screens.js.forEach(function (screen) {
    var f = screen.frame;
    var rect = $.NSMakeRect(f.origin.x, f.origin.y, f.size.width, f.size.height);
    var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(rect, 0, 2, false);
    win.level = 1000;                                   // NSScreenSaverWindowLevel: above the menu bar and Dock
    win.collectionBehavior = (1 << 0) | (1 << 4) | (1 << 8); // all spaces, stationary, full-screen auxiliary
    win.opaque = true;
    win.hasShadow = false;
    win.releasedWhenClosed = false;
    win.backgroundColor = $.NSColor.blackColor;
    win.alphaValue = 0;
    var web = makeWebView(f.size.width, f.size.height, 'saver');
    win.contentView = web.wv;
    win.setFrameDisplay(rect, false);
    win.orderFrontRegardless;
    saver.views.push({ win: win, wv: web.wv, ucc: web.ucc, ready: false });
  });
  app.activateIgnoringOtherApps(true);   // keys and clicks land here, not in the app underneath
  $.NSCursor.hide;
  applyPolicy();
  log('屏保开始' + (preview ? '（预览）' : ''));
}

function stopSaver() {
  if (!saver || saver.closing) return;
  saver.closing = true;
}

function finishSaver() {
  var s = saver;
  saver = null;
  // idleSeconds() can report a stray high reading moments after real input resets it
  // (seen on real hardware as the saver closing and reopening two or three times in
  // under 15s). A closed saver gets a short grace period before the idle check is
  // trusted again, so one bad reading can't immediately reopen it.
  saverBlockedUntil = Math.max(saverBlockedUntil, Date.now() + 10000);
  s.views.forEach(function (v) {
    try { v.ucc.removeScriptMessageHandlerForName('sdv'); } catch (e) { /* ignore */ }
    v.win.orderOut(NIL);
    v.win.close;
  });
  $.NSCursor.unhide;
  try { if (s.prevApp && !s.prevApp.isNil()) s.prevApp.activateWithOptions(2); } catch (e) { /* ignore */ }
  applyPolicy();
  log('屏保结束');
}

// Runs every 1/20 s: fades, and watches for input while the saver is up;
// once a second otherwise, to decide when to start.
var saverClock = 0;
function saverTick() {
  if (saver) {
    var idle = idleSeconds();
    var age = (Date.now() - saver.started) / 1000;
    if (!saver.closing && age > 1.5 && idle < saver.lastIdle - 0.2) {
      log('屏保：检测到输入（闲置 ' + saver.lastIdle.toFixed(1) + 's → ' + idle.toFixed(1) + 's），关闭');
      stopSaver();
    }
    saver.lastIdle = idle;
    if (locked || screensAsleep || !S.saverMinutes) stopSaver();   // the setting can turn off mid-show
    var step = saver.closing ? -0.2 : 0.05;
    saver.alpha = Math.max(0, Math.min(1, saver.alpha + step));
    saver.views.forEach(function (v) { v.win.alphaValue = saver.alpha; });
    if (saver.closing && saver.alpha <= 0) finishSaver();
    return;
  }
  saverClock++;
  if (saverClock % 20) return;          // the rest runs once a second
  var minutes = S.saverMinutes;
  if (!(minutes > 0) || locked || screensAsleep || S.paused) return;
  var idle = idleSeconds();
  if (idle < minutes * 60) return;
  if (Date.now() < saverBlockedUntil) return;
  if (displayHeldAwake()) { saverBlockedUntil = Date.now() + 60000; return; }
  log('屏保：自动触发（设置 ' + minutes + ' 分钟，闲置 ' + idle.toFixed(1) + 's）');
  startSaver(false);
}

// ---------- login item ----------
function loginEnabled() {
  try { return $.SMAppService.mainAppService.status === 1; } catch (e) { return false; } // SMAppServiceStatusEnabled
}
function setLogin(on) {
  try {
    var svc = $.SMAppService.mainAppService;
    var ok = on ? svc.registerAndReturnError(null) : svc.unregisterAndReturnError(null);
    log('登录项' + (on ? '注册' : '取消') + (ok ? '成功' : '失败'));
  } catch (e) { log('登录项不可用: ' + e); }
}

// ---------- menu ----------
function addItem(menu, title, action, value, state) {
  var item = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($(L(title)), action || 'noop:', $(''));
  item.target = target;
  if (value != null) item.representedObject = $(value);
  if (state) item.state = 1;
  if (!action) item.enabled = false;
  menu.addItem(item);
  return item;
}
function addSubmenu(menu, title, prefix, options, selected) {
  var item = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($(L(title)), 'noop:', $(''));
  item.target = target;
  var sub = $.NSMenu.alloc.initWithTitle($(L(title)));
  sub.autoenablesItems = false;
  options.forEach(function (o) { addItem(sub, o[1], 'menuAction:', prefix + ':' + o[0], o[0] === selected); });
  item.submenu = sub;
  menu.addItem(item);
  return sub;
}
// Kept short: everyday things at the top level, the rest one level down.
function rebuildMenu(menu) {
  menu.removeAllItems;
  addSubmenu(menu, '季节', 'season', [['auto', '跟随真实月份'], ['spring', '春'], ['summer', '夏'], ['fall', '秋'], ['winter', '冬']], S.season);
  var ws = addSubmenu(menu, '天气', 'weather', [['live', '实时天气'], ['sunny', '晴'], ['cloudy', '阴'], ['rain', '雨'], ['storm', '雷雨'],
    ['snow', '雪'], ['fog', '雾'], ['windy', '大风']], S.weather);
  ws.addItem($.NSMenuItem.separatorItem);
  addItem(ws, L('所在城市：{0}', locationLabel()));
  addItem(ws, '更换城市…', 'menuAction:', 'city:set');
  if (S.location) addItem(ws, '改回跟随时区自动', 'menuAction:', 'city:auto');
  addSubmenu(menu, '宠物', 'pet', PETS, S.pet);

  var sv = addSubmenu(menu, '屏保', 'saver', [['0', '关闭'], ['3', '闲置 3 分钟后'], ['5', '闲置 5 分钟后'], ['10', '闲置 10 分钟后'], ['15', '闲置 15 分钟后']], String(S.saverMinutes));
  sv.addItem($.NSMenuItem.separatorItem);
  addItem(sv, '立即预览', 'menuAction:', 'saverNow');

  var mu = addSubmenu(menu, '背景音乐', 'music', [['off', '关闭'], ['always', '一直播放'], ['saver', '只在屏保时播放']], S.music);
  if (S.music !== 'off') {
    mu.addItem($.NSMenuItem.separatorItem);
    var pk = S.musicPick;
    addItem(mu, '跟随季节（游戏里这个季节的三首）', 'menuAction:', 'musicMode:season', pk.mode !== 'list');
    addItem(mu, pk.list.length ? L('我的歌单（{0} 首）', pk.list.length) : '我的歌单（还没选歌）', 'menuAction:', 'musicMode:list', pk.mode === 'list');
    addItem(mu, '选歌…', 'menuAction:', 'musicPick');
    addItem(mu, '下一首', 'menuAction:', 'musicNext');
    mu.addItem($.NSMenuItem.separatorItem);
    [['low', '音量：小'], ['mid', '音量：中'], ['high', '音量：大']].forEach(function (o) { addItem(mu, o[1], 'menuAction:', 'musicVol:' + o[0], o[0] === S.musicVolume); });
    var ms = musicStatus();
    if (ms) { mu.addItem($.NSMenuItem.separatorItem); addItem(mu, ms); }
  }

  var fo = S.focus;
  if (fo && !fo.done) {
    var left = Math.max(1, Math.ceil((fo.start + fo.dur - Date.now() / 1000) / 60));
    var fs = $.NSMenu.alloc.initWithTitle($(L('专注')));
    fs.autoenablesItems = false;
    addItem(fs, L('{0}正在长，还剩 {1} 分钟', L(fo.cropZh), left));
    addItem(fs, '放弃这次专注', 'menuAction:', 'focusStop');
    var fi = addItem(menu, L('专注中 · 还剩 {0} 分钟', left), 'noop:');
    fi.enabled = true; fi.submenu = fs;
  } else {
    var fm2 = addSubmenu(menu, '开始专注种田', 'focus', [['25', '25 分钟'], ['50', '50 分钟']], '');
    if (shippedToday()) { fm2.addItem($.NSMenuItem.separatorItem); addItem(fm2, L('今天出货：{0}', focusSummary())); }
  }
  boardMenu(menu);
  if (S.mailWatch && mail.fresh.length) addItem(menu, L('信箱里有 {0} 个新文件 · 标记为已读', mail.fresh.length), 'menuAction:', 'mailRead');
  if (timeOverride != null) addItem(menu, L('恢复实时时间（现在是模拟的 {0}）', Math.floor(timeOverride) + ':' + ('0' + Math.round((timeOverride % 1) * 60)).slice(-2)), 'menuAction:', 'realtime');

  menu.addItem($.NSMenuItem.separatorItem);
  addItem(menu, S.paused ? '继续' : '暂停', 'menuAction:', 'pause');
  addItem(menu, '打开设置窗口…', 'menuAction:', 'editor');
  var more = addSubmenu(menu, '更多', 'quality', Object.keys(QUALITY).map(function (k) { return [k, L('画质：{0}', L(QUALITY[k].title))]; }), S.quality);
  more.addItem($.NSMenuItem.separatorItem);
  addItem(more, '新文件提醒（信箱）', 'menuAction:', 'mailWatch', S.mailWatch);
  if (S.mailWatch && (mail.blocked.desktop || mail.blocked.downloads)) {
    addItem(more, L('信箱看不到{0}：去系统设置 › 隐私与安全性 › 文件与文件夹里允许', [mail.blocked.desktop ? L('桌面') : '', mail.blocked.downloads ? L('下载') : ''].filter(Boolean).join(L('和'))));
  }
  addItem(more, '镜头跟随鼠标（鼠标移到屏幕边缘时移动）', 'menuAction:', 'follow', S.follow);
  addItem(more, '登录时启动', 'menuAction:', 'login', loginEnabled());
  addSubmenu(more, '语言 / Language', 'lang', [['auto', '跟随系统 / System'], ['zh', '中文'], ['en', 'English']], S.lang);
  more.addItem($.NSMenuItem.separatorItem);
  addItem(more, '重新加载场景', 'menuAction:', 'reload');
  addItem(more, '重新读取游戏画面…', 'menuAction:', 'resetup');
  if (projectDir()) addItem(more, '更新到最新版本（重新安装）', 'menuAction:', 'update');
  menu.addItem($.NSMenuItem.separatorItem);
  addItem(menu, L('退出 {0}', APP_NAME), 'menuAction:', 'quit');
}
function menuAction(sender) {
  var v = sender.representedObject.js;
  var parts = v.split(':'), kind = parts[0], val = parts[1];
  if (kind === 'season' || kind === 'weather' || kind === 'pet') {
    applySetting(kind, val);
    editorCall('SDV.host.apply(' + JSON.stringify(kind) + ',' + JSON.stringify(val) + ')');
  }
  else if (kind === 'editor') { openEditor(); }
  else if (kind === 'lang') { setLang(val); }
  else if (kind === 'city') { if (val === 'auto') setLocation(null); else deferModal(cityDialog); }
  else if (kind === 'realtime') { applySetting('time', null); editorCall('SDV.host.apply("time",null)'); }
  else if (kind === 'quality') { S.quality = val; applyPolicy(); }
  else if (kind === 'saver') { S.saverMinutes = Number(val); if (saver) stopSaver(); }
  else if (kind === 'saverNow') { startSaver(true); }
  else if (kind === 'focus') { startFocus(Number(val) || 25); }
  else if (kind === 'focusStop') { giveUpFocus(); }
  else if (kind === 'todo' || kind === 'boardDay' || kind === 'boardEdit' || kind === 'boardAdd' || kind === 'boardSound') { boardAction(kind, val); }
  else if (kind === 'mailWatch') { S.mailWatch = !S.mailWatch; mail.known = {}; mail.fresh = []; mailTick(); }
  else if (kind === 'mailRead') { markMailRead(); }
  else if (kind === 'pause') { S.paused = !S.paused; applyPolicy(); }
  else if (kind === 'update') { updateFromProject(); }
  else if (kind === 'reload') { reloadScenes(); }
  else if (kind === 'music') { S.music = val; music.gapUntil = 0; music.failed = {}; musicTick(); pushMusicState(); }
  else if (kind === 'musicVol') { S.musicVolume = val; if (music.player) music.player.volume = MUSIC_VOL[val]; pushMusicState(); }
  else if (kind === 'musicMode') {
    var mp = S.musicPick;
    if (val === 'list' && !mp.list.length) { var rdy = editor && editor.ready; openEditor(); if (rdy) editorCall('SDV.host.openTab("music")'); else musicPanelWanted = true; return; }
    mp.mode = val; S.musicPick = mp; music.gapUntil = 0; musicTick(); pushMusicState();
  }
  else if (kind === 'musicNext') { musicNext(); }
  else if (kind === 'musicPick') { var r2 = editor && editor.ready; openEditor(); if (r2) editorCall('SDV.host.openTab("music")'); else musicPanelWanted = true; }
  else if (kind === 'resetup') { openSetup('full'); }
  else if (kind === 'follow') { applySetting('follow', !S.follow); editorCall('SDV.host.apply("follow",' + JSON.stringify(S.follow) + ')'); }
  else if (kind === 'login') { setLogin(!loginEnabled()); }
  else if (kind === 'quit') { flushSettings(); $.NSApplication.sharedApplication.terminate(NIL); }
}

// ---------- ObjC glue ----------
// No `protocols:` here — the runtime cannot look these protocols up by name from JXA,
// and AppKit / WebKit only need the methods to exist.
ObjC.registerSubclass({
  name: 'SDVTarget',
  superclass: 'NSObject',
  methods: {
    'noop:': { types: ['void', ['id']], implementation: function () {} },
    'later:': { types: ['void', ['id']], implementation: guard('later', function () { runLater(); }) },
    'todoTimeChanged:': { types: ['void', ['id']], implementation: function () { if (todoCheck) todoCheck.state = 1; } },
    'musicTick:': { types: ['void', ['id']], implementation: guard('music', function () { musicTick(); sfxTick(); }) },
    'focusTick:': { types: ['void', ['id']], implementation: guard('focus', function () { focusTick(); boardTick(); }) },
    'mailTick:': { types: ['void', ['id']], implementation: guard('mail', function () { mailTick(); }) },
    'cursorTick:': { types: ['void', ['id']], implementation: guard('cursor', function () { cursorTick(); }) },
    'coverageTick:': { types: ['void', ['id']], implementation: guard('coverage', function () { updateCoverage(); }) },
    'weatherTick:': { types: ['void', ['id']], implementation: guard('weather', function () { weatherTick(); }) },
    'saverTick:': { types: ['void', ['id']], implementation: guard('saver', function () { saverTick(); }) },
    'runDeferred:': { types: ['void', ['id']], implementation: guard('deferred', function () { var fn = pendingModal; pendingModal = null; if (fn) fn(); }) },
    'menuAction:': { types: ['void', ['id']], implementation: guard('menu', function (sender) { menuAction(sender); }) },
    'menuNeedsUpdate:': { types: ['void', ['id']], implementation: guard('menuUpdate', function (menu) { rebuildMenu(menu); }) },
    'screensChanged:': { types: ['void', ['id']], implementation: guard('screens', function () { log('收到显示器参数变更通知'); buildScenes(); }) },
    'powerChanged:': { types: ['void', ['id']], implementation: guard('power', function () { log('电源状态变化：低电量模式 ' + (lowPower() ? '开' : '关')); applyPolicy(); }) },
    'slept:': { types: ['void', ['id']], implementation: guard('sleep', function () { screensAsleep = true; applyPolicy(); }) },
    'woke:': { types: ['void', ['id']], implementation: guard('wake', function () { screensAsleep = false; applyPolicy(); }) },
    'locked:': { types: ['void', ['id']], implementation: guard('lock', function () { locked = true; applyPolicy(); }) },
    'unlocked:': { types: ['void', ['id']], implementation: guard('unlock', function () { locked = false; applyPolicy(); }) },
  },
});
var clickViewClass = null;    // the view inside the click catcher
(function () {
  var down = { types: ['void', ['id']], implementation: guard('click', function (ev) { catcherClick(ev); }) };
  var wheel = { types: ['void', ['id']], implementation: guard('scroll', function (ev) { catcherScroll(ev); }) };
  try {
    // take the very first click, even though this app is never the active one
    ObjC.registerSubclass({ name: 'SDVClickView', superclass: 'NSView', methods: {
      'mouseDown:': down, 'scrollWheel:': wheel, 'acceptsFirstMouse:': { types: ['bool', ['id']], implementation: function () { return true; } } } });
    clickViewClass = 'SDVClickView';
  } catch (e) {
    log('点击视图（带 acceptsFirstMouse）注册失败：' + e);
    try { ObjC.registerSubclass({ name: 'SDVClickViewPlain', superclass: 'NSView', methods: { 'mouseDown:': down, 'scrollWheel:': wheel } }); clickViewClass = 'SDVClickViewPlain'; } catch (e2) { log('点击视图注册失败：' + e2); }
  }
})();
ObjC.registerSubclass({
  name: 'SDVMessageHandler',
  superclass: 'NSObject',
  methods: {
    'userContentController:didReceiveScriptMessage:': {
      types: ['void', ['id', 'id']],
      implementation: guard('message', function (ucc, msg) { onMessage(msg.webView, ObjC.deepUnwrap(msg.body)); }),
    },
  },
});

function start() {
  target = $.SDVTarget.alloc.init;
  handler = $.SDVMessageHandler.alloc.init;

  statusItem = $.NSStatusBar.systemStatusBar.statusItemWithLength(-2); // square
  var img = $.NSImage.imageWithSystemSymbolNameAccessibilityDescription($('leaf.fill'), $(APP_NAME));
  if (img && !img.isNil()) { img.setTemplate(true); statusItem.button.image = img; } else statusItem.button.title = $('🌾');
  var menu = $.NSMenu.alloc.initWithTitle($(APP_NAME));
  menu.autoenablesItems = false;
  menu.delegate = target;
  statusItem.menu = menu;

  weatherLoad();
  var al = autoLocation();
  if (al) { weather.lat = al.lat; weather.lon = al.lon; }
  prepareRunDir();
  if (dataReady()) buildScenes();
  else openSetup('full');            // first run: read the pictures from the game, then the scenes start

  var nc = $.NSNotificationCenter.defaultCenter;
  nc.addObserverSelectorNameObject(target, 'screensChanged:', $('NSApplicationDidChangeScreenParametersNotification'), NIL);
  nc.addObserverSelectorNameObject(target, 'powerChanged:', $('NSProcessInfoPowerStateDidChangeNotification'), NIL);
  var ws = $.NSWorkspace.sharedWorkspace.notificationCenter;
  ws.addObserverSelectorNameObject(target, 'slept:', $('NSWorkspaceScreensDidSleepNotification'), NIL);
  ws.addObserverSelectorNameObject(target, 'woke:', $('NSWorkspaceScreensDidWakeNotification'), NIL);
  var dnc = $.NSDistributedNotificationCenter.defaultCenter;
  dnc.addObserverSelectorNameObject(target, 'locked:', $('com.apple.screenIsLocked'), NIL);
  dnc.addObserverSelectorNameObject(target, 'unlocked:', $('com.apple.screenIsUnlocked'), NIL);

  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(2, target, 'coverageTick:', NIL, true);
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(15, target, 'weatherTick:', NIL, true);
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(10, target, 'mailTick:', NIL, true);
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(5, target, 'focusTick:', NIL, true);
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(2, target, 'musicTick:', NIL, true);
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(0.05, target, 'saverTick:', NIL, true);
  updateCoverage();

  if (!DEBUG && !getBool('loginItemSetUp', false)) { setBool('loginItemSetUp', true); setLogin(true); }
  log('Stardew Desk 已启动，代码 ' + codeDir + '，运行目录 ' + sceneDir);
}

// Applet: run() is called once at launch; the stay-open applet keeps the app alive.
// Command line: pass the scene folder; we start our own run loop.
function run(argv) {
  if (argv && argv.length && argv[0] === '--unregister') {
    setLogin(false);
    return;
  }
  sceneDir = SUPPORT + '/scene';
  if (argv && argv.length) {
    DEBUG = true;
    codeDir = argv[0];
    musicScript = argv[0] + '/../mac/musicx.js';
    var app = $.NSApplication.sharedApplication;
    app.setActivationPolicy(1); // accessory
    guard('start', start)();
    app.run;
    return;
  }
  codeDir = $.NSBundle.mainBundle.resourcePath.js + '/scene';
  musicScript = $.NSBundle.mainBundle.resourcePath.js + '/musicx.js';
  guard('start', start)();
}
