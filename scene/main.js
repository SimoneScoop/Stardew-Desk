/* Stardew Desk — scene renderer.
 * Map + props + animals, day/night tint, lamps, weather, cursor interaction.
 * Runs in three places: a browser (preview), the desktop scene of the mac app
 * (SDV_HOST = 'mac', not clickable) and the app's settings window
 * (SDV_HOST = 'editor', clickable; changes are sent to the desktop).
 * Classic scripts only, so index.html opens straight from Finder.
 * URL overrides for testing: ?t=18.5&w=rain&s=fall&view=full */
(() => {
  'use strict';

  const CONFIG = SDV.config;
  const I18N = window.SDV_I18N;
  const tr = (...a) => (I18N ? I18N.L(...a) : a[0]);
  const tlist = a => (I18N ? I18N.list(a) : a.join('、'));
  const DATA = window.SDV_DATA;
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('info');

  if (!DATA) {
    document.getElementById('missing').style.display = 'grid';
    document.getElementById('panel').classList.add('hidden');
    return;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('sdv.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('sdv.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const qs = new URLSearchParams(location.search);
  const HOST = Boolean(window.SDV_HOST);   // set by the mac app before the page loads
  const DESKTOP = window.SDV_HOST === 'mac';
  const EDITOR = window.SDV_HOST === 'editor';
  const SAVER = window.SDV_HOST === 'saver';

  const state = {
    seasonMode: qs.get('s') || store.get('season', 'auto'),
    view: qs.get('view') || store.get('view', 'frame'),
    timeOverride: qs.has('t') ? Number(qs.get('t')) : null,   // hours, not persisted
    weatherOverride: qs.get('w') || null,                     // not persisted
    grid: false,
    frame: store.get('frame', CONFIG.frame),
    cols: store.get('cols', CONFIG.targetCols),
    hoverTile: null,
    drag: null,
    target: null,   // desktop size in device px (settings window only), {w, h}
    layout: store.get('layout', {}),   // building offsets in tiles: {house: [dx, dy], …}
    editLayout: false,                 // "布置" mode in the settings window / browser
    moving: null,                      // thing being dragged: building, field or tree
    hover: null,                       // thing under the cursor in layout mode
    pet: store.get('pet', CONFIG.pet || 'cat0'),
    mail: 0,                           // new files the app noticed on the Desktop / in Downloads
    mailHover: 0,                      // seconds the cursor has rested on the mailbox
    tool: null,                        // layout painting: 'path' | 'fence' | 'lamp' | 'erase'
    painting: null,                    // {kinds: Set, last: 'x,y'} while a paint stroke is on
    paintHover: null,                  // tile under the cursor with a paint tool: {x, y, why}   // 'cat0'…'cat5', 'dog0'…'dog5' or 'none'
    follow: false,                     // 镜头跟随鼠标 (desktop)
    cursorScreen: null,                // the cursor across the screen, -1…1 from the middle
    pan: { x: 0, y: 0 },               // how far the view has leaned toward it, map px
    roam: false,                       // (v1.2 drafts: 漫游全图; kept only so old settings read)
    lock: false,                       // 锁定大小: the desktop view keeps its zoom
    boxDrag: null,                     // dragging the desktop's view box on the full map (视野 tab)
    ecam: null,                        // the settings window's own zoom while arranging: {s, cx, cy}
  };
  { const f = store.get('frame', null); if (f) { state.roam = Boolean(f.roam); state.lock = Boolean(f.lock); } }

  const SEASONS = ['spring', 'summer', 'fall', 'winter'];
  const SEASON_ZH = { spring: '春', summer: '夏', fall: '秋', winter: '冬' };
  const seasonName = s => tr(SEASON_ZH[s] || s);
  const realSeason = d => SEASONS[Math.floor(((d.getMonth() + 10) % 12) / 3)]; // Mar–May = spring

  function worldDate() {
    const now = new Date();
    if (state.timeOverride == null) return now;
    const d = new Date(now);
    const h = state.timeOverride;
    d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    return d;
  }
  const seasonOf = d => (state.seasonMode === 'auto' ? realSeason(d) : state.seasonMode);

  // ---------- images ----------
  // Only what the current season needs is kept in memory: the other seasons' map
  // sheets and trees are loaded when the season changes, and dropped again. On the
  // desktop only the chosen pet is loaded (the settings window shows all of them).
  const images = {};
  const loading = new Map();
  function load(name) {
    if (images[name] || !DATA.images.includes(name)) return Promise.resolve();
    if (!loading.has(name)) {
      loading.set(name, new Promise(res => {
        const img = new Image();
        img.onload = () => { images[name] = img; loading.delete(name); res(); };
        img.onerror = () => { console.warn('missing image', name); loading.delete(name); res(); };
        img.src = `data/img/${name}.png`;
      }));
    }
    return loading.get(name);
  }
  const SEASON_OF = n => { const m = n.match(/^(spring|summer|fall|winter)_|_(spring|summer|fall|winter)$/); return m ? m[1] || m[2] : null; };
  // Map tilesheets: only the ones the current farm map uses.
  const ALL_SHEETS = new Set((DATA.farms || []).flatMap(f => f.sheets || []));
  let mapSheets = new Set();
  const wanted = (n, season) => {
    if (ALL_SHEETS.has(n) && !mapSheets.has(n)) return false;
    const ss = SEASON_OF(n);
    if (ss) return ss === season || (n === 'flooring_winter' && season === 'winter');
    if (n === 'hoedirt_snow') return season === 'winter';
    if (n.startsWith('pet_')) return EDITOR || n === `pet_${state.pet}`;
    return true;
  };
  let imageSeason = null, seasonLoading = null;
  function loadSeason(season) {
    if (seasonLoading && seasonLoading.season === season && seasonLoading.farm === farmKey) return seasonLoading.promise;
    const farm = farmKey;
    const promise = Promise.all(DATA.images.filter(n => wanted(n, season)).map(load)).then(() => {
      if (farm !== farmKey) return;                 // the farm changed meanwhile: that load goes on
      imageSeason = season;
      seasonLoading = null;
      for (const n of Object.keys(images)) if (!wanted(n, season)) delete images[n];
    });
    seasonLoading = { season, farm, promise };
    return promise;
  }
  // (the old cursors sheet was full size; new data keeps only the corner we use)
  const CUR = (DATA.crops && DATA.crops.cursors) || [0, 0];

  // Soft warm glow used for lamps (drawn with "lighter").
  const glow = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 196, 110, 0.85)');
    grad.addColorStop(0.35, 'rgba(255, 170, 80, 0.35)');
    grad.addColorStop(1, 'rgba(255, 150, 60, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  })();

  // ---------- map ----------
  // The farm map: the standard farm comes with farm.js; the other farm types (河边、森林…)
  // are read by the setup too and loaded from data/maps/<key>.js when a layout asks for one.
  let map = DATA.map, farmKey = 'standard';
  const TILE = map.tilesheets[0]?.tw || 16;
  let layers = map.layers.filter(l => !CONFIG.hiddenLayers.includes(l.id));
  let mapW = layers[0].w * TILE, mapH = layers[0].h * TILE;
  const UNDER = ['Back', 'Back2', 'Buildings', 'Buildings2'];   // drawn below props and animals
  const sheetNames = m => new Set(m.tilesheets.flatMap(ts => (ts.seasonal ? SEASONS.map(s => `${s}_${ts.image}`) : [ts.image])));
  mapSheets = sheetNames(map);
  // The Farm map puts the upper fence tiles on Front, which this renderer draws over every prop.
  // Treat them as Buildings so farm buildings render over the fence instead of the other way around.
  const MAP_FENCE_TILES = new Set([358, 359, 360, 361, 409]);

  function sheetImage(sheetIdx, s) {
    const ts = map.tilesheets[sheetIdx];
    if (!ts) return null;
    return images[ts.seasonal ? `${s}_${ts.image}` : ts.image] || null;
  }
  function drawTile(g, t, s, dx, dy) {
    const ts = map.tilesheets[t.s];
    const img = sheetImage(t.s, s);
    if (!ts || !img) return;
    const col = t.i % ts.cols, row = Math.floor(t.i / ts.cols);
    const sx = ts.margin.x + col * (ts.tw + ts.spacing.x);
    const sy = ts.margin.y + row * (ts.th + ts.spacing.y);
    g.drawImage(img, sx, sy, ts.tw, ts.th, dx, dy, ts.tw, ts.th);
  }

  let baked = null;
  // The map is baked into two canvases (ground + buildings below everything, the rest
  // above) instead of one per layer. Animated tiles (water) are drawn each frame, and
  // any later-layer tile sitting on one is drawn again on top of it.
  function bake(s) {
    const groups = [layers.filter(l => UNDER.includes(l.id)), layers.filter(l => !UNDER.includes(l.id))];
    const frontFenceTiles = [];
    const out = groups.map(group => {
      const c = document.createElement('canvas');
      c.width = mapW; c.height = mapH;
      const g = c.getContext('2d');
      const anim = [];
      group.forEach((layer, li) => layer.tiles.forEach((row, y) => row.forEach((t, x) => {
        if (!t) return;
        const sheet = map.tilesheets[t.s];
        if (layer.id === 'Front' && sheet?.image === 'outdoorsTileSheet' && MAP_FENCE_TILES.has(t.i)) {
          frontFenceTiles.push({ x, y, t });
          return;
        }
        if (t.a) anim.push({ x, y, t, li });
        else drawTile(g, t, s, x * TILE, y * TILE);
      })));
      for (const a of anim) a.above = group.slice(a.li + 1).map(l => l.tiles[a.y][a.x]).filter(t => t && !t.a);
      return { canvas: c, anim };
    });
    // Treat the map's upper fence row like Buildings so movable buildings draw over it.
    const under = out[0].canvas.getContext('2d');
    frontFenceTiles.forEach(({ x, y, t }) => drawTile(under, t, s, x * TILE, y * TILE));
    if (baked) baked.groups.forEach(gr => { gr.canvas.width = gr.canvas.height = 0; });   // let the old ones go now
    baked = { season: s, groups: out };
  }

  // ---------- view ----------
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();     // the settings window keeps the panel beside the farm
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
  }
  // A mouse event in device px inside the canvas.
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  }

  const fitScale = () => Math.min(W / mapW, H / mapH);
  function camera() {
    if (SAVER) return SDV.saver.camera(W, H, CONFIG.saver.cols);
    if (state.view === 'full' || (state.ecam && state.ecam.full)) {
      const scale = fitScale();
      return { scale, x: -(W / scale - mapW) / 2, y: -(H / scale - mapH) / 2 };
    }
    if (state.ecam) {
      // the settings window zoomed in while arranging: free of the desktop's framing
      const sc = state.ecam.s, vw = W / sc, vh = H / sc;
      const cx = vw >= mapW ? mapW / 2 : Math.max(vw / 2, Math.min(mapW - vw / 2, state.ecam.cx));
      const cy = vh >= mapH ? mapH / 2 : Math.max(vh / 2, Math.min(mapH - vh / 2, state.ecam.cy));
      state.ecam.cx = cx; state.ecam.cy = cy;
      return { scale: sc, x: cx - vw / 2, y: cy - vh / 2 };
    }
    const r = frameRect();
    if (state.target) {
      // Settings window: fit the desktop's exact view into this window.
      const scale = Math.min(W / r.w, H / r.h);
      return { scale, x: r.x - (W / scale - r.w) / 2, y: r.y - (H / scale - r.h) / 2 };
    }
    return { scale: r.scale, x: Math.round(r.x), y: Math.round(r.y) };
  }

  // ---------- props ----------
  const P = CONFIG.props;
  // The picture of a prop: its own, or the plain one when the game data read before
  // the variants (big coop, deluxe barn…) were added.
  const imageOf = p => images[p.img] || (p.base && images[p.base]) || null;
  function propSprite(p, season) {
    let [sx, sy, sw, sh] = p.src;
    if (p.seasonal) sx += p.seasonal * Math.max(0, SEASONS.indexOf(season));
    return {
      y: p.ground ? p.y : p.y + sh,
      draw(g) {
        const img = imageOf(p);
        if (!img) return;
        if (sy + sh > img.height) sy = 0;                  // (an older read kept only the first house)
        if (sx + sw > img.width) sx = 0;
        if (p.type === 'fishpond') { g.fillStyle = '#3f8fc4'; g.fillRect(p.x + 8, p.y + 8, sw - 16, sh - 16); g.fillStyle = '#6fb6e0'; g.fillRect(p.x + 8, p.y + 8, sw - 16, 3); }
        g.drawImage(img, sx, sy, sw, sh, p.x, p.y, sw, sh);
      },
    };
  }
  function drawDoor(g, home, open) {
    const img = imageOf(home);
    if (!img) return;
    const d = home.door;
    const [sx, sy, sw, sh] = open ? d.open : d.closed;
    for (let yy = 0; yy < d.h; yy += sh) g.drawImage(img, sx, sy, sw, sh, home.x + d.x, home.y + d.y + yy, sw, sh);
  }

  // ---------- mailbox ----------
  // New files waiting: a letter bubble bobs over the mailbox, as in the game.
  // Resting the cursor on the mailbox for a moment counts as reading it.
  function drawMail(g, nowMs, dt) {
    const mb = P.mailbox, cur = images.cursors;
    if (!state.mail || !mb || !cur) { state.mailHover = 0; return; }
    const bob = Math.round(Math.sin(nowMs / 250) * 1.5);
    const bx = mb.x, by = mb.y - 22 + bob;
    g.save();
    g.globalAlpha = 0.85;
    g.drawImage(cur, 141 - CUR[0], 465 - CUR[1], 20, 24, bx - 2, by, 20, 24);
    g.globalAlpha = 1;
    g.drawImage(cur, 189 - CUR[0], 423 - CUR[1], 15, 13, bx, by + 6, 15, 13);
    g.restore();
    const c = state.cursor;
    const over = c && c.x >= bx - 4 && c.x < bx + 22 && c.y >= by - 2 && c.y < mb.y + mb.src[3];
    state.mailHover = over ? state.mailHover + dt : 0;
    if (state.mailHover > 1) { state.mail = 0; state.mailHover = 0; post({ type: 'mailRead' }); }
  }

  // ---------- a ticked to-do's note flies into the shipping bin ----------
  const flying = [];
  // A little paper note, 8×10, in the board's paper colours.
  function drawNote(g, x, y, tilt) {
    g.save();
    g.translate(x + 4, y + 5); g.rotate(tilt); g.translate(-4, -5);
    g.fillStyle = '#5b3a22'; g.fillRect(-1, -1, 10, 12);
    g.fillStyle = '#fbe7c0'; g.fillRect(0, 0, 8, 10);
    g.fillStyle = '#d6b98a'; g.fillRect(0, 9, 8, 1);
    g.fillStyle = '#a08060'; g.fillRect(1, 3, 6, 1); g.fillRect(1, 5, 5, 1); g.fillRect(1, 7, 6, 1);
    g.fillStyle = '#4caf3a'; g.fillRect(5, 0, 2, 2);
    g.restore();
  }
  function launchNote() {
    const b = P.board, bin = P.bin;
    if (!b || !bin || !SDV.board.shown()) return;
    flying.push({ t0: performance.now(), from: { x: b.x + b.src[2] / 2 - 4, y: b.y + 4 }, to: { x: bin.x + 12, y: bin.y + 6 } });
  }
  function drawFlying(g, nowMs) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], dist = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);
      const dur = 700 + dist * 2.2, k = (nowMs - f.t0) / dur;
      if (k >= 1) { flying.splice(i, 1); state.focusPop = nowMs; continue; }      // landed: the bin shows today's tally
      const e = k < 0 ? 0 : k;
      const x = f.from.x + (f.to.x - f.from.x) * e;
      const y = f.from.y + (f.to.y - f.from.y) * e - Math.sin(Math.PI * e) * (30 + dist * 0.25);
      drawNote(g, Math.round(x), Math.round(y), Math.sin(e * Math.PI * 4) * 0.35);
    }
  }
  SDV.board.onTicked(() => launchNote());

  // ---------- focus tally ----------
  // Today's focus harvest floats over the shipping bin for a minute after each session,
  // and whenever the cursor rests on the bin.
  function drawTally(g, nowMs, season) {
    const T = SDV.focus.tally(), bin = P.bin, crops = images.crops, cur = images.cursors;
    if (!(T.n || T.notes) || !bin || !crops || !cur) return;
    const c = state.cursor;
    const over = c && c.x >= bin.x - 4 && c.x < bin.x + 36 && c.y >= bin.y - 24 && c.y < bin.y + 32;
    const fresh = state.focusPop && nowMs - state.focusPop < 60000;
    if (!over && !fresh) return;
    const bob = Math.round(Math.sin(nowMs / 250) * 1.5);
    const bx = bin.x + 6, by = bin.y - 24 + bob;
    // today's shipping: the focus harvest (crop icon) and the finished to-dos (a note)
    const items = [];
    if (T.n) { const icon = SDV.decor.cropIcon(T.last || SDV.focus.cropFor(season)); if (icon) items.push({ draw: (x, y) => g.drawImage(crops, icon.sx, icon.sy + 16, 16, 16, x, y, 16, 16), n: T.n }); }
    if (T.notes) items.push({ draw: (x, y) => drawNote(g, x + 4, y + 3, 0), n: T.notes });
    g.save();
    g.font = 'bold 7px -apple-system, "PingFang SC", sans-serif';
    g.lineWidth = 2; g.strokeStyle = '#3a2414'; g.fillStyle = '#fbe7c0';
    items.forEach((it, i) => {
      const y = by - i * 20;
      g.globalAlpha = 0.85;
      g.drawImage(cur, 141 - CUR[0], 465 - CUR[1], 20, 24, bx - 2, y, 20, 24);
      g.globalAlpha = 1;
      it.draw(bx, y + 2);
      const txt = `×${it.n}`;
      g.strokeText(txt, bx + 19, y + 12); g.fillText(txt, bx + 19, y + 12);
    });
    g.restore();
  }

  // ---------- bulletin board ----------
  // The board is a prop on the farm; its notice (countdown, earnings, to-dos) is drawn
  // over everything in screen px so it stays sharp and readable at night.
  function drawBoard(cam, dt, nowMs) {
    const b = P.board, c = state.cursor;
    const cursor = c ? { x: (c.x - cam.x) * cam.scale, y: (c.y - cam.y) * cam.scale } : null;
    let anchor = null, overBoard = false;
    if (b && SDV.board.shown()) {
      const bw = b.src[2], bh = b.src[3];
      const sx = (b.x - cam.x) * cam.scale, sy = (b.y - cam.y) * cam.scale, sw = bw * cam.scale;
      if (!(sx + sw < 0 || sx > W || sy + sw < 0 || sy > H)) {          // off view: only a reminder, at the top
        anchor = { x: sx + sw / 2, y: sy + 1 * cam.scale, h: bh * cam.scale };
        overBoard = Boolean(c && c.x >= b.x && c.x < b.x + bw && c.y >= b.y && c.y < b.y + bh);
      }
    }
    SDV.board.draw(ctx, { anchor, cursor, overBoard, dt, k: dpr, W, H, images, cur: CUR, nowMs });
    boardRect(SDV.board.rect());
  }
  // On the desktop the scene can't be clicked; while the notice is open the app puts an
  // invisible click catcher over it (above the desktop icons) and passes clicks back.
  let lastBoardRect = 'none';
  function boardRect(r) {
    if (!DESKTOP) return;
    const css = r ? { x: Math.round(r.x / dpr), y: Math.round(r.y / dpr), w: Math.round(r.w / dpr), h: Math.round(r.h / dpr) } : null;
    const key = JSON.stringify(css);
    if (key === lastBoardRect) return;
    lastBoardRect = key;
    post({ type: 'boardRect', rect: css });
  }
  // A to-do ticked on the notice: tell the app (desktop, settings window) or keep it (browser).
  // "＋ 添加待办" on the notice: the app's little box on the desktop, the board tab here.
  SDV.board.onAdd(() => {
    if (DESKTOP) post({ type: 'boardAdd' });
    else { setPanel(true); setTab('board'); SDV.board.openPanel(true); }
  });
  SDV.board.onToggle(b => { if (DESKTOP) post({ type: 'board', value: b }); else { if (!HOST) store.set('board', b); notify('board', b); } });

  // ---------- frame ----------
  let lastT = performance.now();
  let current = { sky: null, weather: null, season: 'spring', date: new Date() };

  function frame(nowMs) {
    const dt = Math.min(0.25, (nowMs - lastT) / 1000);
    lastT = nowMs;
    easePan(dt);
    edgePan(dt);

    const date = worldDate();
    const s = seasonOf(date);
    const sky = SDV.sky.at(date, CONFIG.location);
    const weather = SDV.weather.current(date, s, state.weatherOverride);
    const wet = weather.type === 'rain' || weather.type === 'storm' || weather.type === 'snow';
    const outdoorOK = sky.alt > 1 && !wet && s !== 'winter';
    current = { sky, weather, season: s, date, outdoorOK };

    const cam = camera();
    const vw = W / cam.scale, vh = H / cam.scale;
    const rainy = weather.type === 'rain' || weather.type === 'storm';
    SDV.critters.update(dt, nowMs / 1000, {
      view: { x: cam.x, y: cam.y, w: vw, h: vh }, season: s,
      day: sky.alt > 2 && sky.lamps < 0.3, night: sky.lamps > 0.6, rain: rainy, snow: weather.type === 'snow',
    });
    SDV.villagers.update(dt, nowMs / 1000, { hour: date.getHours() + date.getMinutes() / 60, weather: weather.type });
    if (SDV.focus.justFinished()) state.focusPop = nowMs;
    if (SAVER) SDV.saver.update(dt);
    SDV.animals.update(dt, outdoorOK);
    SDV.interact.update(dt, nowMs / 1000, { season: s, animals: SDV.animals, lamps: sky.lamps, wet });
    SDV.weather.update(dt, weather, s, vw, vh);

    if (imageSeason !== s) loadSeason(s);
    else if (!baked || baked.season !== s) bake(s);
    if (!baked) return;                       // first season still loading
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#1d1410';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(cam.scale, 0, 0, cam.scale, -cam.x * cam.scale, -cam.y * cam.scale);

    const vx0 = Math.floor(cam.x / TILE) - 1, vy0 = Math.floor(cam.y / TILE) - 1;
    const vx1 = Math.ceil((cam.x + vw) / TILE) + 1, vy1 = Math.ceil((cam.y + vh) / TILE) + 1;
    const view = { x0: vx0, y0: vy0, x1: vx1, y1: vy1 };
    const animMs = Date.now();
    const drawGroup = gr => {
      ctx.drawImage(gr.canvas, 0, 0);
      for (const { x, y, t, above } of gr.anim) {
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        drawTile(ctx, t.a[Math.floor(animMs / t.ms) % t.a.length], baked.season, x * TILE, y * TILE);
        for (const u of above) drawTile(ctx, u, baked.season, x * TILE, y * TILE);
      }
    };

    // 1. ground, ripples on the water, then the buildings layer
    drawGroup(baked.groups[0]);
    SDV.paths.drawGround(ctx, images, s, view);
    SDV.decor.drawGround(ctx, images, s, rainy);
    SDV.interact.drawGround(ctx);
    // 2. animal doors (behind the animals standing in them)
    drawDoor(ctx, P.coop, SDV.animals.anyOutside('coop'));
    drawDoor(ctx, P.barn, SDV.animals.anyOutside('barn'));
    // 3. props and animals, sorted by their feet
    images.board = SDV.board.image(new Date(), images, s);
    const sprites = [P.house, P.coop, P.barn, P.stable, P.mailbox, P.bin, SDV.board.shown() && P.board].filter(Boolean).concat(CONFIG.extraProps || []).map(p => propSprite(p, s))
      .concat(SDV.animals.sprites(images), SDV.interact.sprites(images, s, view), SDV.decor.sprites(images, s, date, view),
        SDV.paths.sprites(images, s, view), SDV.critters.sprites(images), SDV.villagers.sprites(images));
    sprites.sort((a, b) => a.y - b.y).forEach(sp => sp.draw(ctx));
    // 4. tree tops, roofs and the rest
    drawGroup(baked.groups[1]);
    // 5. leaves shaken loose, emote bubbles, rain / snow / petals
    SDV.interact.drawAbove(ctx);
    SDV.critters.drawAbove(ctx, images);
    SDV.animals.emotes(images).forEach(e => e.draw(ctx));
    const ve = SDV.villagers.emotes(images);
    if (ve) ve.draw(ctx);
    drawMail(ctx, nowMs, dt);
    drawTally(ctx, nowMs, s);
    drawFlying(ctx, nowMs);
    SDV.weather.drawParticles(ctx, cam);
    // 6. day/night tint × weather dimming
    // Weather dimming fades out at night so rainy nights stay readable.
    const dim = (SDV.weather.DIM[weather.type] || [255, 255, 255]).map(v => v + (255 - v) * sky.lamps * 0.7);
    const tint = sky.tint.map((v, i) => Math.round((v * dim[i]) / 255));
    if (tint.some(v => v < 255)) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${tint.join(',')})`;
      ctx.fillRect(cam.x, cam.y, vw, vh);
    }
    // 7. lamps
    const lamp = Math.max(sky.lamps, wet || weather.type === 'cloudy' ? 0.25 * (1 - sky.lamps) + sky.lamps : 0);
    if (lamp > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, lamp);
      for (const l of CONFIG.lights.concat(SDV.paths.lights())) ctx.drawImage(glow, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      ctx.globalAlpha = 1;
    }
    // fireflies shine through the dark
    ctx.globalCompositeOperation = 'lighter';
    SDV.critters.drawGlow(ctx, glow);
    ctx.globalCompositeOperation = 'source-over';
    // 8. fog and lightning
    SDV.weather.drawOverlay(ctx, cam, vw, vh);

    if (!SAVER && !state.editLayout && state.view !== 'full') drawBoard(cam, dt, nowMs); else boardRect(null);
    if (SAVER) SDV.saver.drawHud(ctx, images, W, date, s, weather);
    else if (state.grid || state.view === 'full' || state.editLayout) drawOverlay(cam);
  }

  function drawOverlay(cam) {
    const lw = 1 / cam.scale;
    if (state.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let x = 0; x <= mapW; x += TILE) { ctx.moveTo(x, 0); ctx.lineTo(x, mapH); }
      for (let y = 0; y <= mapH; y += TILE) { ctx.moveTo(0, y); ctx.lineTo(mapW, y); }
      ctx.stroke();
    }
    if (state.view === 'full' && !state.editLayout) drawFrameBox(cam);
    if (state.editLayout) {
      // building footprints and fields get dashed outlines; the hovered tree a box
      // around its trunk; whatever is being dragged is green (fits) or red (doesn't)
      ctx.lineWidth = 2 * lw * dpr;
      const same = (a, b) => a && b && a.type === b.type && a.name === b.name && a.index === b.index && a.id === b.id;
      const box = (r, item) => {
        const m = same(state.moving, item), h = !state.moving && same(state.hover, item);
        const bad = m && state.moving.problem;
        ctx.setLineDash(m ? [] : [4 * lw * dpr, 3 * lw * dpr]);
        ctx.strokeStyle = m ? (bad ? '#ff5a4e' : '#7dff7a') : h ? '#f2c14e' : 'rgba(255,255,255,0.85)';
        ctx.fillStyle = m ? (bad ? 'rgba(255,90,78,0.25)' : 'rgba(125,255,122,0.2)') : h ? 'rgba(242,193,78,0.18)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
        ctx.strokeRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      };
      for (const name of SDV.layout.names) box(SDV.layout.footprint(name, state.layout), { type: 'building', name });
      for (const p of CONFIG.extraProps || []) box(p.fp, { type: 'extra', index: p.i });
      for (const f of SDV.decor.fieldRects()) box(f, { type: 'field', index: f.index });
      // trees, small objects, the mailbox and the bin only get a box while hovered or dragged
      const SMALLT = ['tree', 'object', 'prop'];
      const t = state.moving && SMALLT.includes(state.moving.type) ? state.moving : !state.moving && state.hover && SMALLT.includes(state.hover.type) ? state.hover : null;
      if (t) {
        const r = t.type === 'prop' ? SDV.layout.propFootprint(CONFIG, t.name) : t.cur && { x: t.cur[0], y: t.cur[1], w: 1, h: 1 };
        if (r) box(r, { type: t.type, id: t.id, name: t.name });
      }
      ctx.setLineDash([]);
      // the tile a paint tool would touch
      const ph = state.tool && state.paintHover;
      if (ph) {
        ctx.fillStyle = ph.why ? 'rgba(255,90,78,0.35)' : 'rgba(125,255,122,0.3)';
        ctx.strokeStyle = ph.why ? '#ff5a4e' : '#7dff7a';
        ctx.fillRect(ph.x * TILE, ph.y * TILE, TILE, TILE);
        ctx.strokeRect(ph.x * TILE, ph.y * TILE, TILE, TILE);
      }
      // the hovered field gets a × to delete it
      const hf = !state.moving && !state.tool && state.hover && hoveredRemovable();
      if (hf) {
        const b = deleteBadge(hf), on = state.layoutCursor && inBox(state.layoutCursor, b);
        ctx.fillStyle = on ? '#ff5a4e' : '#b8342a';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(b.x + 3, b.y + 3); ctx.lineTo(b.x + b.w - 3, b.y + b.h - 3);
        ctx.moveTo(b.x + b.w - 3, b.y + 3); ctx.lineTo(b.x + 3, b.y + b.h - 3);
        ctx.stroke();
      }
    }
  }

  // The composition as the desktop shows it, in map px.
  const targetSize = () => ({ TW: state.target ? state.target.w : W, TH: state.target ? state.target.h : H });
  // Whole-pixel zooms the desktop can use: the whole map at least fills the screen, and a
  // screen shows at least 8 tiles across.
  function zoomRange() {
    const { TW, TH } = targetSize();
    const lo = Math.max(1, Math.ceil(Math.max(TW / mapW, TH / mapH) - 1e-6));
    return { lo, hi: Math.max(lo, Math.floor(TW / (8 * TILE))) };
  }
  const colsFor = sc => Math.round((targetSize().TW / (TILE * sc)) * 100) / 100;
  function frameRect(f) {
    f = f || state.frame;
    const { TW, TH } = targetSize();
    const zr = zoomRange();
    const scale = Math.max(zr.lo, Math.min(zr.hi, Math.round(TW / ((f.cols || state.cols) * TILE))));
    const w = TW / scale, h = TH / scale;
    const x = Math.max(0, Math.min(mapW - w, f.cx + state.pan.x - w / 2));
    const y = Math.max(0, Math.min(mapH - h, f.cy + state.pan.y - h / 2));
    return { x, y, w, h, scale };
  }
  // 镜头跟随鼠标: only while the cursor rests at an edge of the screen does the desktop view
  // drift that way, slowly, until it meets the edge of the map; away from the edges it stays
  // where it got to. Off unless the user turns it on (then the view glides back to the gold
  // box); the settings window and the screensaver keep their own framing.
  const EDGE = 0.95;                       // the outer 2.5% of the screen on each side
  const EDGE_SPEED = 5;                    // tiles a second, at the very edge
  const EDGE_WAIT = 0.35;                  // s at the edge before it starts (passing by doesn't count)
  const edge = { vx: 0, vy: 0, dwell: 0 };
  function easePan(dt) {
    if (!(state.follow && DESKTOP)) {
      edge.vx = edge.vy = edge.dwell = 0;
      const e = 1 - Math.exp(-dt * 3);
      state.pan.x -= state.pan.x * e;
      state.pan.y -= state.pan.y * e;
      if (Math.abs(state.pan.x) < 0.05) state.pan.x = 0;
      if (Math.abs(state.pan.y) < 0.05) state.pan.y = 0;
      return;
    }
    const c = state.cursorScreen;
    const push = v => (Math.abs(v) <= EDGE ? 0 : Math.sign(v) * (0.45 + 0.55 * Math.min(1, (Math.abs(v) - EDGE) / (1 - EDGE))));
    let px = c ? push(c.x) : 0, py = c ? push(c.y) : 0;
    edge.dwell = px || py ? edge.dwell + dt : 0;
    if (edge.dwell < EDGE_WAIT) px = py = 0;
    const e = 1 - Math.exp(-dt * 4);           // ease in and out of the drift
    edge.vx += (px * EDGE_SPEED * TILE - edge.vx) * e;
    edge.vy += (py * EDGE_SPEED * TILE - edge.vy) * e;
    if (Math.abs(edge.vx) < 0.5 && !px) edge.vx = 0;
    if (Math.abs(edge.vy) < 0.5 && !py) edge.vy = 0;
    state.pan.x += edge.vx * dt;
    state.pan.y += edge.vy * dt;
    // stop at the map's edge (and don't pile up beyond it)
    const r = frameRect(), f = state.frame;
    const lim = (v, center, size, total, axis) => {
      const lo = size / 2 - center, hi = total - size / 2 - center;
      const a = Math.min(lo, hi), b = Math.max(lo, hi);
      if (v < a || v > b) { if (axis === 'x') edge.vx = 0; else edge.vy = 0; }
      return Math.max(a, Math.min(b, v));
    };
    state.pan.x = lim(state.pan.x, f.cx, r.w, mapW, 'x');
    state.pan.y = lim(state.pan.y, f.cy, r.h, mapH, 'y');
  }
  // ---------- the desktop's view box (视野 tab) ----------
  // On the full map the desktop's view is a gold box: drag it to move it, drag a corner
  // (or turn the wheel) to zoom, click elsewhere to bring it there.
  const HANDLE = 7;                        // corner handle half-size, CSS px
  function boxHit(p, cam) {
    const r = frameRect();
    const tol = (HANDLE + 3) * dpr / cam.scale;
    if (!state.lock) {
      for (const [cx, cy, corner] of [[r.x, r.y, 'nw'], [r.x + r.w, r.y, 'ne'], [r.x, r.y + r.h, 'sw'], [r.x + r.w, r.y + r.h, 'se']]) {
        if (Math.abs(p.x - cx) <= tol && Math.abs(p.y - cy) <= tol) return corner;
      }
    }
    return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h ? 'move' : null;
  }
  function frameFromBox(cx, cy, scale) {
    const zr = zoomRange();
    const sc = Math.max(zr.lo, Math.min(zr.hi, scale));
    return { ...state.frame, cx: Math.round(cx), cy: Math.round(cy), cols: colsFor(sc) };
  }
  function boxDragMove(p) {
    const d = state.boxDrag, f0 = d.frame;
    if (d.mode === 'move') {
      const nf = { ...f0, cx: f0.cx + (p.x - d.start.x), cy: f0.cy + (p.y - d.start.y) };
      // keep the centre where the box can really be (frameRect clamps the box to the map)
      const r = frameRect(nf);
      setFrameLive({ ...nf, cx: Math.round(r.x + r.w / 2), cy: Math.round(r.y + r.h / 2) });
      return;
    }
    // a corner: the opposite corner stays put, the box keeps the screen's shape and snaps to whole zooms
    const { TW, TH } = targetSize();
    const ax = d.mode.includes('w') ? d.rect.x + d.rect.w : d.rect.x, ay = d.mode.includes('n') ? d.rect.y + d.rect.h : d.rect.y;
    const w = Math.max(Math.abs(p.x - ax), Math.abs(p.y - ay) * TW / TH, TILE * 8);
    const sc = Math.round(TW / w);
    const zr = zoomRange(), s2 = Math.max(zr.lo, Math.min(zr.hi, sc));
    const bw = TW / s2, bh = TH / s2;
    const cx = d.mode.includes('w') ? ax - bw / 2 : ax + bw / 2, cy = d.mode.includes('n') ? ay - bh / 2 : ay + bh / 2;
    setFrameLive(frameFromBox(cx, cy, s2));
  }
  function setFrameLive(f) { state.frame = { cx: f.cx, cy: f.cy }; state.cols = f.cols || state.cols; }
  function commitFrame() {
    setFrame({ cx: state.frame.cx, cy: state.frame.cy, cols: state.cols });
    notify('frame', frameValue());
    syncButtons();
  }
  const frameValue = () => ({ cx: state.frame.cx, cy: state.frame.cy, cols: state.cols, roam: state.roam, lock: state.lock });
  function zoomBy(step) {
    if (state.lock) { flash(tr('视野大小已锁定：先取消「锁定大小」再缩放')); return; }
    const r = frameRect(), zr = zoomRange();
    const sc = Math.max(zr.lo, Math.min(zr.hi, r.scale + step));
    if (sc === r.scale) { flash(tr(step > 0 ? '已经放到最大了' : '已经是能看到的最大范围了')); return; }
    setFrameLive(frameFromBox(r.x + r.w / 2, r.y + r.h / 2, sc));
    const r2 = frameRect();
    setFrameLive({ cx: Math.round(r2.x + r2.w / 2), cy: Math.round(r2.y + r2.h / 2), cols: state.cols });
    commitFrame();
  }
  // Drawn in screen px over the full map: the rest of the farm dimmed, the box, its corners and a tag.
  function drawFrameBox(cam) {
    const r = frameRect();
    const X = x => (x - cam.x) * cam.scale, Y = y => (y - cam.y) * cam.scale;
    const x0 = Math.round(X(r.x)), y0 = Math.round(Y(r.y)), x1 = Math.round(X(r.x + r.w)), y1 = Math.round(Y(r.y + r.h));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(20, 12, 6, 0.55)';
    ctx.fillRect(0, 0, W, y0); ctx.fillRect(0, y1, W, H - y1); ctx.fillRect(0, y0, x0, y1 - y0); ctx.fillRect(x1, y0, W - x1, y1 - y0);
    const lw = Math.max(2, Math.round(2.5 * dpr));
    ctx.lineWidth = lw; ctx.strokeStyle = '#3a2414'; ctx.strokeRect(x0 - lw, y0 - lw, x1 - x0 + 2 * lw, y1 - y0 + 2 * lw);
    ctx.strokeStyle = state.boxDrag ? '#fff3a8' : '#f2c14e'; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (!state.lock) {
      const hs = HANDLE * dpr;
      for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        ctx.fillStyle = '#3a2414'; ctx.fillRect(cx - hs - dpr, cy - hs - dpr, 2 * hs + 2 * dpr, 2 * hs + 2 * dpr);
        ctx.fillStyle = '#f2c14e'; ctx.fillRect(cx - hs, cy - hs, 2 * hs, 2 * hs);
      }
    }
    // the tag on the box
    const tag = tr('桌面显示范围 · {0}×{1} 格', Math.round(r.w / TILE), Math.round(r.h / TILE)) + (state.lock ? tr(' · 已锁定大小') : '');
    ctx.font = `600 ${12 * dpr}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(tag).width + 14 * dpr, th = 22 * dpr;
    let ty = y0 - th - 4 * dpr;
    if (ty < 4 * dpr) ty = y0 + 6 * dpr;
    const tx = Math.max(4 * dpr, Math.min(W - tw - 4 * dpr, x0));
    ctx.fillStyle = '#f2c14e'; ctx.fillRect(tx, ty, tw, th);
    ctx.fillStyle = '#3a2414'; ctx.fillText(tag, tx + 7 * dpr, ty + th / 2 + 0.5 * dpr);
    ctx.restore();
  }

  // ---------- panel ----------
  const pad = n => String(n).padStart(2, '0');
  function updateInfo() {
    const { sky, weather, season, date } = current;
    if (!sky) return;
    const cam = camera();
    const lines = [
      tr('{0}:{1} · {2} · 太阳高度 {3}°', pad(date.getHours()), pad(date.getMinutes()), tr(sky.phase), Math.round(sky.alt)) + (state.timeOverride == null ? '' : tr('（模拟）')),
      tr('季节：{0}', seasonName(season)) + tr(state.seasonMode === 'auto' ? '（跟随真实月份）' : '（手动）'),
      tr('天气：{0}（{1}）', SDV.weather.label(weather), SDV.weather.sourceLabel ? SDV.weather.sourceLabel(weather) : weather.source),
      tr('动物：{0}', SDV.animals.summary()),
      ...(SDV.decor.summary(date, season) ? [tr('作物：{0}', SDV.decor.summary(date, season))] : []),
      (() => {
        const r = frameRect();  // what the desktop shows
        return tr('桌面构图：放大 {0}× · 一屏约 {1}×{2} 格', r.scale, Math.round(r.w / TILE), Math.round(r.h / TILE));
      })(),
    ];
    if (state.hoverTile) lines.push(tr('光标所在格：({0}, {1})', state.hoverTile.x, state.hoverTile.y));
    if (state.note && performance.now() < state.note.until) lines.push(state.note.text);
    if (state.mail) lines.push(tr('信箱：{0} 个新文件（鼠标在信箱上停一秒算已读）', state.mail));
    const left = SDV.focus.remaining();
    if (left != null) lines.push(tr('专注中：还剩 {0} 分钟', left));
    const T = SDV.focus.tally();
    if (T.n) lines.push(tr('今天专注收获：{0} 次', T.n));
    const v = SDV.villagers.current();
    if (v) lines.push(tr('{0}{1}', tr(v.name), tr(v.what)));
    if (state.editLayout) lines.push(state.moving && state.moving.problem
      ? tr('放不下：{0}', tr(state.moving.problem))
      : state.tool ? tr({ path: '画石板路：在地图上点或拖；再点一次按钮回到拖动模式', fence: '画围栏：在地图上点或拖；再点一次按钮回到拖动模式', lamp: '画路灯：在地图上点或拖；再点一次按钮回到拖动模式', erase: '橡皮擦：在地图上点或拖；再点一次按钮回到拖动模式' }[state.tool])
        : tr('布置中：建筑、田、树、稻草人、木牌、箱子、信箱、公告板都能拖；点田或其他建筑角上的 × 删掉；红框表示放不下'));
    else if (state.view === 'full') lines.push(tr('拖黄框换位置，拖四个角或滚轮放大缩小；改动马上同步到桌面'));
    lines.push(tr(EDITOR ? '这里的改动会同步到桌面 · G 网格 · 1–4 季节' : 'H 隐藏面板 · G 网格 · 1–4 季节'));
    info.textContent = lines.join('\n');
  }

  // ---------- input ----------
  function toMap(e) {
    const cam = camera();
    const p = canvasPoint(e);
    return { x: cam.x + p.x / cam.scale, y: cam.y + p.y / cam.scale };
  }
  canvas.addEventListener('mousemove', e => {
    const p = toMap(e);
    state.hoverTile = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
    state.canvasCursor = canvasPoint(e);
    if (state.grab) {                       // dragging the ground: the zoomed view follows the hand
      const cp = canvasPoint(e), cam = camera();
      state.ecam.cx = state.grab.cx - (cp.x - state.grab.at.x) / cam.scale;
      state.ecam.cy = state.grab.cy - (cp.y - state.grab.at.y) / cam.scale;
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (state.view === 'full' && !state.editLayout) {
      if (state.boxDrag) boxDragMove(p);
      const hit = state.boxDrag ? state.boxDrag.mode : boxHit(p, camera());
      canvas.style.cursor = !hit ? 'pointer' : hit === 'move' ? (state.boxDrag ? 'grabbing' : 'grab') : hit === 'nw' || hit === 'se' ? 'nwse-resize' : 'nesw-resize';
      return;
    }
    if (state.editLayout) {
      state.layoutCursor = p;
      if (state.tool) {
        const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
        if (state.painting) paintAt(tx, ty);
        state.paintHover = { x: tx, y: ty, why: state.tool === 'erase' ? null : SDV.paths.problem(state.tool, tx, ty, state.layout) };
        canvas.style.cursor = 'crosshair';
        return;
      }
      let onBadge = false;
      if (state.moving) dragItem(p);
      else {
        // keep the hovered field while the cursor is on its × (a tree may overlap the corner)
        const f = hoveredRemovable();
        onBadge = Boolean(f && inBox(p, deleteBadge(f)));
        if (!onBadge) state.hover = pickAt(p);
      }
      canvas.style.cursor = state.moving ? 'grabbing' : onBadge ? 'pointer' : state.hover ? 'grab' : state.ecam && !state.ecam.full ? 'move' : 'default';
      return;
    }
    canvas.style.cursor = state.ecam && !state.ecam.full ? 'move' : '';
    state.cursor = p;
    if (state.view === 'frame') SDV.interact.setCursor(p, performance.now() / 1000);
  });
  let wheelAcc = 0;
  canvas.addEventListener('wheel', e => {
    const p = canvasPoint(e);
    if (!state.editLayout && state.view !== 'full' && SDV.board.wheel(p.x, p.y, e.deltaY)) { e.preventDefault(); return; }
    // the wheel zooms: the desktop's view box on the full map, or the arranging view
    const tab = currentTab();
    if (!(state.view === 'full' && tab === 'view') && tab !== 'layout') return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 60) return;
    const step = wheelAcc > 0 ? -1 : 1;
    wheelAcc = 0;
    if (tab === 'view') zoomBy(step);
    else editZoom(step, p);
  }, { passive: false });
  canvas.addEventListener('mouseleave', () => { state.hoverTile = null; state.cursor = null; state.canvasCursor = null; SDV.interact.setCursor(null); });
  canvas.addEventListener('mousedown', e => {
    const cp = canvasPoint(e);
    if (!state.editLayout && SDV.board.click(cp.x, cp.y)) return;   // a to-do on the open notice
    const p = toMap(e);
    if (state.editLayout) {
      const h = state.hover;
      if (state.tool) { startPaint(p); return; }
      const rf = hoveredRemovable();
      if (rf && inBox(p, deleteBadge(rf))) {
        if (h.type === 'extra') deleteExtra(h.index);
        else if (h.type === 'tree' || h.type === 'object') removeHovered(h);
        else deleteField(h.index);
        return;
      }
      const item = pickAt(p);
      if (item) { state.moving = { ...item, start: p, before: JSON.parse(JSON.stringify(state.layout)), problem: null }; return; }
    }
    if (state.view === 'full') {
      let mode = boxHit(p, camera());
      if (!mode) {                          // a click beside the box brings the box there
        setFrameLive({ cx: Math.round(p.x), cy: Math.round(p.y), cols: state.cols });
        const r2 = frameRect();
        setFrameLive({ cx: Math.round(r2.x + r2.w / 2), cy: Math.round(r2.y + r2.h / 2), cols: state.cols });
        mode = 'move';
      }
      state.boxDrag = { mode, start: p, frame: { ...state.frame, cols: state.cols }, rect: frameRect() };
      return;
    }
    // zoomed in while arranging: drag the ground to look around
    if (state.ecam && !state.ecam.full) state.grab = { at: cp, cx: state.ecam.cx, cy: state.ecam.cy };
  });
  window.addEventListener('mouseup', () => {
    if (state.grab) { state.grab = null; return; }
    if (state.painting) { endPaint(); return; }
    if (state.moving) { dropItem(); return; }
    if (state.boxDrag) { state.boxDrag = null; commitFrame(); }
  });

  // ---------- the settings window's own zoom (布置) ----------
  // 放大 / 缩小 while arranging; once zoomed in the view stays at that size and looks
  // further when the cursor rests near an edge of the window (or drag the ground).
  function editZoom(step, at) {
    const cam = camera();
    const fit = fitScale();
    const levels = [];
    for (let sc = Math.max(1, Math.ceil(fit + 0.01)); sc <= 8 * dpr; sc++) levels.push(sc);
    const sc = step > 0 ? levels.find(v => v > cam.scale + 0.01) : levels.slice().reverse().find(v => v < cam.scale - 0.01);
    if (sc == null) {
      if (step < 0) { state.ecam = { full: true }; syncButtons(); return; }
      flash(tr('已经放到最大了')); return;
    }
    // zoom about the cursor (or the middle of the window)
    const p = at || { x: W / 2, y: H / 2 };
    const mx = cam.x + p.x / cam.scale, my = cam.y + p.y / cam.scale;
    state.ecam = { s: sc, cx: mx - p.x / sc + W / sc / 2, cy: my - p.y / sc + H / sc / 2 };
    syncButtons();
  }
  function setEditView(v) {
    if (v === 'desk') state.ecam = null;
    else if (v === 'full') state.ecam = { full: true };
    syncButtons();
  }
  // resting the cursor near an edge of the zoomed view scrolls the map that way
  let edgeFor = 0;
  function edgePan(dt) {
    const c = state.canvasCursor;
    if (!state.ecam || state.ecam.full || !c || state.grab || state.painting) { edgeFor = 0; return; }
    const band = 56 * dpr;
    const vx = c.x < band ? -(1 - c.x / band) : c.x > W - band ? 1 - (W - c.x) / band : 0;
    const vy = c.y < band ? -(1 - c.y / band) : c.y > H - band ? 1 - (H - c.y) / band : 0;
    if (!vx && !vy) { edgeFor = 0; return; }
    edgeFor += dt;
    if (edgeFor < 0.25) return;
    const speed = 900 * dpr / state.ecam.s;   // map px per second at the very edge
    state.ecam.cx += vx * speed * dt; state.ecam.cy += vy * speed * dt;
    if (state.moving) dragItem({ x: camera().x + c.x / state.ecam.s, y: camera().y + c.y / state.ecam.s });
  }

  function setPanel(on) {
    const p = document.getElementById('panel'), b = document.getElementById('panel-show');
    p.classList.toggle('hidden', !on);
    if (b) b.hidden = on;
    resize();
    placeTip(currentTab() === 'view' && !DESKTOP && !SAVER);
  }
  document.getElementById('panel-hide').addEventListener('click', () => setPanel(false));
  document.getElementById('panel-show').addEventListener('click', () => setPanel(true));

  const timeRange = document.getElementById('time');
  function flash(text) { state.note = { text, until: performance.now() + 4000 }; updateInfo(); }
  function setPet(id) {
    SDV.interact.setPet(id); state.pet = SDV.interact.pet(); store.set('pet', state.pet); syncButtons();
    load(`pet_${state.pet}`).then(() => { if (!EDITOR) for (const n of Object.keys(images)) if (n.startsWith('pet_') && n !== `pet_${state.pet}`) delete images[n]; });
  }
  function setSeason(m) { state.seasonMode = m; store.set('season', m); syncButtons(); }
  function setView(v) { state.view = v; store.set('view', v); canvas.classList.toggle('picking', v === 'full'); syncButtons(); }
  function setWeather(w) { state.weatherOverride = w === 'live' ? null : w; syncButtons(); }
  function setTime(h) { state.timeOverride = h; syncButtons(); }
  function setFrame(f) {
    if (DESKTOP && state.frame && (f.cx !== state.frame.cx || f.cy !== state.frame.cy || (f.cols && f.cols !== state.cols))) state.pan = { x: 0, y: 0 };   // a new box: start from it
    state.frame = { cx: f.cx, cy: f.cy };
    state.cols = f.cols || state.cols;
    if (f.roam != null) state.roam = Boolean(f.roam);
    if (f.lock != null) state.lock = Boolean(f.lock);
    store.set('frame', { ...state.frame, roam: state.roam, lock: state.lock });
    store.set('cols', state.cols);
    syncButtons();
  }
  // ---------- moving buildings, fields and trees ----------
  // What's under the cursor in layout mode: the front-most building or tree, else a field.
  function pickAt(p) {
    const hits = [];
    const x = SDV.layout.hitExtra(CONFIG, p.x, p.y);
    if (x) hits.push({ type: 'extra', index: x.i, z: x.ground ? x.y : x.y + x.src[3] });
    for (const name of SDV.layout.names) {
      const pr = CONFIG.props[name];
      if (p.x >= pr.x && p.x < pr.x + pr.src[2] && p.y >= pr.y && p.y < pr.y + pr.src[3]) hits.push({ type: 'building', name, z: pr.y + pr.src[3] });
    }
    for (const name of SDV.layout.small) {
      const pr = CONFIG.props[name];
      if (p.x >= pr.x && p.x < pr.x + pr.src[2] && p.y >= pr.y && p.y < pr.y + pr.src[3]) hits.push({ type: 'prop', name, z: pr.y + pr.src[3] });
    }
    const t = SDV.decor.treeAt(p.x, p.y);
    if (t) hits.push({ type: 'tree', id: t.id, cur: [t.x, t.y], z: (t.y + 1) * TILE });
    const o = SDV.decor.objectHit(p.x, p.y);
    if (o) hits.push({ type: 'object', id: o.id, kind: o.type, cur: [o.x, o.y], z: (o.y + 1) * TILE + 1 });
    if (hits.length) return hits.sort((a, b) => b.z - a.z)[0];
    const f = SDV.decor.fieldAt(p.x, p.y);
    return f ? { type: 'field', index: f.index, focusFrom: f.index === 'focus' ? [f.x, f.y] : null } : null;
  }
  const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const footprints = () => SDV.layout.footprints(state.layout);
  // What the × deletes while hovered: a field (not the focus plot) or an extra building.
  function hoveredRemovable() {
    const h = state.hover;
    if (h && h.type === 'field' && h.index !== 'focus') return SDV.decor.fieldRects().find(f => f.index === h.index) || null;
    if (h && h.type === 'extra') { const p = (CONFIG.extraProps || []).find(q => q.i === h.index); return p ? p.fp : null; }
    if (h && (h.type === 'tree' || h.type === 'object') && h.cur) return { x: h.cur[0], y: h.cur[1], w: 1, h: 1 };
    return null;
  }
  // The × on a hovered tree or small object: take it off the farm (and keep it off).
  function removeHovered(h) {
    const L = JSON.parse(JSON.stringify(state.layout));
    const key = h.type === 'tree' ? 'treesRemoved' : 'objectsRemoved';
    L[key] = [...new Set([...(L[key] || []), h.id])];
    if (h.type === 'tree' && L.trees) delete L.trees[h.id];
    if (h.type === 'object' && L.objects) delete L.objects[h.id];
    state.hover = null;
    setLayout(L);
    notify('layout', state.layout);
  }

  function fieldProblem(index) {
    const r = SDV.decor.fieldRects().find(f => f.index === index);
    return r ? rectProblem(r, index) : null;
  }
  // Can a field stand on rectangle r? (index: the field itself, ignored in the checks)
  function rectProblem(r, index) {
    if (!SDV.layout.inMap(r.x, r.y) || !SDV.layout.inMap(r.x + r.w - 1, r.y + r.h - 1)) return tr('超出农场范围');
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (SDV.layout.isSolid(x, y)) return tr('这里有水或障碍');
    for (const f of footprints()) if (rectsOverlap(r, f)) return tr('和{0}重叠', tr(f.label));
    for (const f of SDV.decor.fieldRects()) if (f.index !== index && rectsOverlap(r, f)) return tr('和别的作物田重叠');
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (SDV.decor.objectAt(x, y, index)) return tr('压到了小物件');
    return null;
  }

  // ---------- adding and deleting fields ----------
  // The little × in a hovered field's top-right corner (map px).
  const deleteBadge = f => ({ x: (f.x + f.w) * TILE - 13, y: f.y * TILE + 1, w: 12, h: 12 });
  const inBox = (p, b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h;
  function deleteField(index) {
    const L = JSON.parse(JSON.stringify(state.layout));
    if (typeof index === 'string' && index[0] === 'a') {
      const k = Number(index.slice(1));
      L.fieldsAdded = (L.fieldsAdded || []).filter((_, i) => i !== k);
    } else {
      L.fieldsRemoved = [...new Set([...(L.fieldsRemoved || []), index])];
      if (L.fields) delete L.fields[index];
    }
    state.hover = null;
    setLayout(L);
    notify('layout', state.layout);
  }
  function deleteExtra(i) {
    const L = JSON.parse(JSON.stringify(state.layout));
    L.extras = (L.extras || []).filter((_, k) => k !== i);
    state.hover = null;
    setLayout(L);
    notify('layout', state.layout);
  }
  // A new 5×4 field on the nearest free spot to the middle of the view.
  function addField() {
    const v = camera(), sc = v.scale;
    const cx = Math.floor((v.x + canvas.width / sc / 2) / TILE), cy = Math.floor((v.y + canvas.height / sc / 2) / TILE);
    const w = 5, h = 4;
    for (let rad = 0; rad < 30; rad++) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const r = { x: cx + dx - 2, y: cy + dy - 2, w, h };
        // keep a tile of space around it too, like the default fields
        if (rectProblem(r, null) || rectProblem({ x: r.x - 1, y: r.y - 1, w: w + 2, h: h + 2 }, null)) continue;
        // and not where the chickens and cows graze
        const px = { x: r.x * TILE, y: r.y * TILE, w: w * TILE, h: h * TILE };
        if (Object.values(CONFIG.pens).some(pen => rectsOverlap(px, pen))) continue;
        // nor hidden behind a roof
        if (Object.values(CONFIG.props).concat(CONFIG.extraProps || []).some(pr => rectsOverlap(px, { x: pr.x - TILE, y: pr.y - TILE, w: pr.src[2] + 2 * TILE, h: pr.src[3] + 2 * TILE }))) continue;
        const L = JSON.parse(JSON.stringify(state.layout));
        L.fieldsAdded = [...(L.fieldsAdded || []), { ...r, kind: (L.fieldsAdded || []).length }];
        setLayout(L);
        notify('layout', state.layout);
        return true;
      }
    }
    return false;
  }
  function treeProblem(m, x, y) {
    if (!SDV.layout.inMap(x, y)) return tr('超出农场范围');
    if (SDV.layout.isSolid(x, y)) return tr('这里有水或障碍');
    for (const f of footprints()) if (rectsOverlap({ x, y, w: 1, h: 1 }, f)) return tr('和{0}重叠', tr(f.label));
    for (const f of SDV.decor.fieldRects()) if (rectsOverlap({ x, y, w: 1, h: 1 }, { x: f.x - 1, y: f.y - 1, w: f.w + 2, h: f.h + 2 })) return tr('离作物田太近');
    if (SDV.decor.takenFor(m.id, x, y)) return tr('这里已经有东西了');
    return null;
  }

  // Small objects (scarecrow, sign, keg, chest…): anywhere on open ground, fields included.
  function objectProblem(m, x, y) {
    if (!SDV.layout.inMap(x, y)) return tr('超出农场范围');
    if (SDV.layout.isSolid(x, y)) return tr('这里有水或障碍');
    for (const f of footprints()) if (rectsOverlap({ x, y, w: 1, h: 1 }, f)) return tr('和{0}重叠', tr(f.label));
    for (const n of SDV.layout.small) if (rectsOverlap({ x, y, w: 1, h: 1 }, SDV.layout.propFootprint(CONFIG, n))) return tr('和{0}重叠', tr(SDV.layout.label(n)));
    if (SDV.decor.takenFor(null, x, y) && !(m.cur[0] === x && m.cur[1] === y)) return tr('这里已经有东西了');
    // as in the game, the only thing worth standing among the crops is a scarecrow
    const inField = SDV.decor.fieldRects().some(f => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
    if (inField && m.kind !== 'scarecrow') return tr('作物田里只放稻草人（洒水器会自动布好）');
    return null;
  }
  // The mailbox and shipping bin: open ground, not on a field.
  function propProblem(name) {
    const f = SDV.layout.propFootprint(CONFIG, name);
    if (!SDV.layout.inMap(f.x, f.y) || !SDV.layout.inMap(f.x + f.w - 1, f.y)) return tr('超出农场范围');
    for (let x = f.x; x < f.x + f.w; x++) if (SDV.layout.isSolid(x, f.y)) return tr('这里有水或障碍');
    for (const b of footprints()) if (rectsOverlap(f, b)) return tr('和{0}重叠', tr(b.label));
    for (const n of SDV.layout.small) if (n !== name && rectsOverlap(f, SDV.layout.propFootprint(CONFIG, n))) return tr('和{0}重叠', tr(SDV.layout.label(n)));
    for (const fd of SDV.decor.fieldRects()) if (rectsOverlap(f, fd)) return tr('压到了作物田');
    for (let x = f.x; x < f.x + f.w; x++) if (SDV.decor.takenFor(null, x, f.y)) return tr('这里已经有东西了');
    return null;
  }

  function dragItem(p) {
    const m = state.moving;
    const dx = Math.round((p.x - m.start.x) / TILE), dy = Math.round((p.y - m.start.y) / TILE);
    const B = m.before;
    if (m.type === 'building') {
      const from = B[m.name] || [0, 0];
      state.layout = { ...state.layout, [m.name]: [from[0] + dx, from[1] + dy] };
      m.problem = SDV.layout.problem(m.name, state.layout, SDV.decor.fieldRects());
      SDV.layout.apply(CONFIG, state.layout);          // the sprite follows the cursor
    } else if (m.type === 'field' && m.index === 'focus') {
      const from = B.focusPlot || m.focusFrom;
      state.layout = { ...state.layout, focusPlot: [from[0] + dx, from[1] + dy] };
      syncDecorMoves();
      SDV.decor.init(CONFIG, map, TILE);
      m.problem = fieldProblem('focus');
    } else if (m.type === 'field' && typeof m.index === 'string') {
      const k = Number(m.index.slice(1)), a = B.fieldsAdded[k];
      const added = state.layout.fieldsAdded.slice();
      added[k] = { ...a, x: a.x + dx, y: a.y + dy };
      state.layout = { ...state.layout, fieldsAdded: added };
      syncDecorMoves();
      SDV.decor.init(CONFIG, map, TILE);
      m.problem = fieldProblem(m.index);
    } else if (m.type === 'field') {
      const from = (B.fields || {})[m.index] || [0, 0];
      state.layout = { ...state.layout, fields: { ...(state.layout.fields || {}), [m.index]: [from[0] + dx, from[1] + dy] } };
      syncDecorMoves();
      SDV.decor.init(CONFIG, map, TILE);
      m.problem = fieldProblem(m.index);
    } else if (m.type === 'tree') {
      if (!m.home) m.home = m.cur.slice();
      const nx = m.home[0] + dx, ny = m.home[1] + dy;
      if (m.dragged && m.cur[0] === nx && m.cur[1] === ny) return;
      m.dragged = true;
      m.problem = treeProblem(m, nx, ny);
      m.cur = [nx, ny];
      state.layout = { ...state.layout, trees: { ...(state.layout.trees || {}), [m.id]: [nx, ny] } };
      syncDecorMoves();
      SDV.decor.init(CONFIG, map, TILE);
    } else if (m.type === 'object') {
      if (!m.home) m.home = m.cur.slice();
      const nx = m.home[0] + dx, ny = m.home[1] + dy;
      if (m.dragged && m.cur[0] === nx && m.cur[1] === ny) return;
      m.dragged = true;
      m.problem = objectProblem(m, nx, ny);
      m.cur = [nx, ny];
      state.layout = { ...state.layout, objects: { ...(state.layout.objects || {}), [m.id]: [nx, ny] } };
      syncDecorMoves();
      SDV.decor.init(CONFIG, map, TILE);
    } else if (m.type === 'extra') {
      const e = (B.extras || [])[m.index];
      if (!e) return;
      const extras = state.layout.extras.slice();
      extras[m.index] = { ...e, x: e.x + dx, y: e.y + dy };
      state.layout = { ...state.layout, extras };
      SDV.layout.apply(CONFIG, state.layout);
      m.problem = SDV.layout.extraProblem(m.index, state.layout, SDV.decor.fieldRects());
    } else if (m.type === 'prop') {
      const from = B[m.name] || [0, 0];
      state.layout = { ...state.layout, [m.name]: [from[0] + dx, from[1] + dy] };
      SDV.layout.apply(CONFIG, state.layout);
      m.problem = propProblem(m.name);
    }
  }
  function dropItem() {
    const m = state.moving;
    state.moving = null;
    if (m.problem) state.layout = m.before;            // doesn't fit: snap back
    setLayout(state.layout);
    if (!m.problem) notify('layout', state.layout);
  }

  // ---------- importing a layout from a save ----------
  // The app reads the save (scene/savefile.js) and hands over what it found; here it
  // becomes an ordinary layout: buildings where the save has them, as far as this farm
  // (the standard map) has room. Afterwards everything can be dragged as usual.
  const SAVE_TYPES = {
    'Coop': 'coop', 'Big Coop': 'coop_big', 'Deluxe Coop': 'coop_deluxe',
    'Barn': 'barn', 'Big Barn': 'barn_big', 'Deluxe Barn': 'barn_deluxe',
    'Stable': 'stable', 'Shipping Bin': 'bin', 'Silo': 'silo', 'Well': 'well', 'Shed': 'shed', 'Big Shed': 'bigshed',
    'Slime Hutch': 'slimehutch', 'Mill': 'mill', 'Gold Clock': 'goldclock', 'Junimo Hut': 'junimohut', 'Fish Pond': 'fishpond',
    'Earth Obelisk': 'obelisk_earth', 'Water Obelisk': 'obelisk_water', 'Desert Obelisk': 'obelisk_desert', 'Island Obelisk': 'obelisk_island',
    'Log Cabin': 'cabin_log', 'Plank Cabin': 'cabin_plank', 'Stone Cabin': 'cabin_stone', 'Rustic Cabin': 'cabin_rustic',
    'Neighbor Cabin': 'cabin_neighbor', 'Trailer Cabin': 'cabin_trailer', 'Beach Cabin': 'cabin_beach',
  };
  const SAVE_ZH = { 'Pet Bowl': '宠物碗', 'Farmhouse': '农舍' };
  const FARM_ZH = ['标准农场', '河边农场', '森林农场', '山顶农场', '荒野农场', '四角农场', '海滩农场', '草原农场'];
  const ANIMAL_ZH = { 'Duck': '鸭子', 'Rabbit': '兔子', 'Pig': '猪', 'Goat': '山羊', 'Sheep': '绵羊', 'Dinosaur': '恐龙', 'Ostrich': '鸵鸟',
    'Void Chicken': '虚空鸡', 'Golden Chicken': '金鸡', 'Blue Chicken': '蓝鸡' };
  // Where the four movable buildings stand by default, as the save counts it (top-left of the footprint).
  const SAVE_HOME = { house: [59, 12], coop: [46, 13], barn: [45, 22], stable: [73, 17] };
  const TIER = k => (/_deluxe$/.test(k) ? 3 : /_big$/.test(k) ? 2 : 1);

  function spiral(maxR, fn) {
    for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const v = fn(dx, dy);
      if (v) return v;
    }
    return null;
  }

  function layoutFromSave(save) {
    const L = { extras: [], fieldsRemoved: [] };
    const R = { placed: [], kept: [], moved: [], skipped: [], notDrawn: {}, animalsNot: {} };
    const placed = [];                                   // footprints already standing
    const fits = (f, extra) => {
      if (!SDV.layout.inMap(f.x, f.y) || !SDV.layout.inMap(f.x + f.w - 1, f.y + f.h - 1)) return false;
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) if (SDV.layout.isSolid(x, y)) return false;
      return !placed.concat(extra || []).some(o => rectsOverlap(f, o));
    };
    const B = save.buildings || [];
    const movable = {};
    const extras = [];
    const pick = (name, list) => {
      list.sort((a, b) => TIER(b.k) - TIER(a.k) || animalCount(b) - animalCount(a));
      if (list.length) movable[name] = list[0];
      list.slice(1).forEach(b => extras.push(b));
    };
    const animalCount = b => Object.values(b.animals || {}).reduce((a, n) => a + n, 0);
    const coops = [], barns = [], stables = [], bins = [];
    for (const b of B) {
      let k = SAVE_TYPES[b.type];
      if (b.type === 'Farmhouse') { movable.house = { ...b, k: 'house' }; continue; }
      if (b.type === 'Cabin') k = SAVE_TYPES[b.skin] || 'cabin_log';
      if (b.type === 'Greenhouse') k = save.greenhouseUnlocked === false ? 'greenhouse_ruin' : 'greenhouse';
      if (!k) { if (b.type !== 'Pet Bowl') R.notDrawn[b.type] = (R.notDrawn[b.type] || 0) + 1; continue; }
      const it = { ...b, k };
      if (k.startsWith('coop')) coops.push(it); else if (k.startsWith('barn')) barns.push(it);
      else if (k === 'stable') stables.push(it); else if (k === 'bin') bins.push(it); else extras.push(it);
    }
    pick('coop', coops); pick('barn', barns); pick('stable', stables);
    // the four movable buildings first, then the rest
    for (const name of ['house', 'coop', 'barn', 'stable']) {
      const b = movable[name];
      if (!b) continue;
      const d = [b.x - SAVE_HOME[name][0], b.y - SAVE_HOME[name][1]];
      const f = SDV.layout.footprint(name, { [name]: d });
      if (fits(f)) { L[name] = d; placed.push(f); R.placed.push((SDV.layout.TYPES[b.k] || {}).name || SDV.layout.label(name)); }
      else { delete movable[name]; R.skipped.push(SDV.layout.label(name)); }
      if (name === 'coop' && b.k !== 'coop') L.coopKind = b.k;
      if (name === 'barn' && b.k !== 'barn') L.barnKind = b.k;
    }
    for (const b of extras) {
      const t = SDV.layout.TYPES[b.k];
      const f = { x: b.x, y: b.y, w: t.fp.w, h: t.fp.h };
      if (!fits(f)) { R.skipped.push(t.name); continue; }
      placed.push(f);
      L.extras.push({ t: b.k, x: b.x, y: b.y, ...(t.leveled && b.level ? { level: Math.min(2, b.level) } : {}) });
      R.placed.push(t.name);
    }
    // a movable building the save doesn't have stays put, or steps aside for one it has
    for (const name of ['coop', 'barn', 'stable']) {
      if (movable[name]) continue;
      const base = SDV.layout.footprint(name, {});
      const d = spiral(30, (dx, dy) => (fits({ ...base, x: base.x + dx, y: base.y + dy }, fieldRectsBase()) ? [dx, dy] : null));
      if (d && (d[0] || d[1])) { L[name] = d; R.moved.push(SDV.layout.label(name)); }
      else if (!d) R.moved.push(SDV.layout.label(name));
      placed.push({ ...base, x: base.x + (d ? d[0] : 0), y: base.y + (d ? d[1] : 0) });
      if (name !== 'stable') R.kept.push(SDV.layout.label(name));
    }
    L.houseLevel = Math.max(0, Math.min(2, save.houseLevel | 0));
    // the shipping bin (it follows the house; the save says where it really is)
    SDV.layout.apply(CONFIG, L);
    if (bins.length) {
      const at = SDV.layout.propFootprint(CONFIG, 'bin');
      const d = [bins[0].x - at.x, bins[0].y - at.y];
      const f = { x: bins[0].x, y: bins[0].y, w: at.w, h: 1 };
      if (fits(f)) { L.bin = d; placed.push(f); }
      bins.slice(1).forEach(b => { const g = { x: b.x, y: b.y, w: 2, h: 1 }; if (fits(g)) { placed.push(g); L.extras.push({ t: 'bin', x: b.x, y: b.y }); } });
    }
    SDV.layout.apply(CONFIG, L);
    // the default fields under the new buildings go; the rest stay
    (CONFIG.decor.fields || []).forEach((fd, i) => {
      const g = { x: fd.x - 1, y: fd.y - 1, w: fd.w + 2, h: fd.h + 2 };
      if (placed.some(o => rectsOverlap(g, o))) L.fieldsRemoved.push(i);
    });
    // the board and the mailbox step aside if a building now stands on them
    for (const name of ['board', 'mailbox']) {
      const at = SDV.layout.propFootprint(CONFIG, name);
      if (fits(at)) continue;
      const cur = L[name] || [0, 0];
      const d = spiral(20, (dx, dy) => (fits({ ...at, x: at.x + dx, y: at.y + dy }, fieldRectsKept(L)) ? [dx, dy] : null));
      if (d) { L[name] = [cur[0] + d[0], cur[1] + d[1]]; SDV.layout.apply(CONFIG, L); }
    }
    // chickens and cows (the kinds this farm can draw), as many as fit in the yard
    const tally = {};
    for (const b of B) for (const [t, n] of Object.entries(b.animals || {})) tally[t] = (tally[t] || 0) + n;
    for (const [t, n] of Object.entries(save.outsideAnimals || {})) tally[t] = (tally[t] || 0) + n;
    const take = (pairs, cap) => {
      const total = pairs.reduce((a, [, n]) => a + n, 0), out = [];
      if (!total) return out;
      const keep = Math.min(cap, total);
      pairs.forEach(([img, n], i) => { const c = i === pairs.length - 1 ? keep - out.length : Math.round(n * keep / total); for (let k = 0; k < c && out.length < keep; k++) out.push(img); });
      return out;
    };
    const chickens = take([['chicken_white', tally['White Chicken'] || 0], ['chicken_brown', tally['Brown Chicken'] || 0]], 8);
    const cows = take([['cow_white', tally['White Cow'] || 0], ['cow_brown', tally['Brown Cow'] || 0]], 6);
    // mix the colours so they don't walk out in two blocks
    const mix = list => list.map((img, i) => [img, (i * 7919) % 101]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
    L.animals = mix(chickens).map(img => ({ kind: 'chicken', img })).concat(mix(cows).map(img => ({ kind: 'cow', img })));
    for (const [t, n] of Object.entries(tally)) if (!/^(White|Brown) (Chicken|Cow)$/.test(t)) R.animalsNot[t] = n;
    R.chickens = chickens.length; R.cows = cows.length;
    R.chickensAll = (tally['White Chicken'] || 0) + (tally['Brown Chicken'] || 0);
    R.cowsAll = (tally['White Cow'] || 0) + (tally['Brown Cow'] || 0);
    if (!L.extras.length) delete L.extras;
    if (!L.fieldsRemoved.length) delete L.fieldsRemoved;
    L.from = { farm: save.farmName || '', at: Date.now() };
    return { layout: L, report: R, placed };
  }
  const fieldRectsBase = () => (CONFIG.decor.fields || []).map(f => ({ x: f.x - 1, y: f.y - 1, w: f.w + 2, h: f.h + 2 }));
  const fieldRectsKept = L => (CONFIG.decor.fields || []).filter((_, i) => !(L.fieldsRemoved || []).includes(i)).map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h }));

  // A frame that shows the house, the coop, the barn and the shipping bin together.
  function frameAround(rects) {
    if (!rects.length) return null;
    const x0 = Math.min(...rects.map(r => r.x)) - 3, y0 = Math.min(...rects.map(r => r.y)) - 4;
    const x1 = Math.max(...rects.map(r => r.x + r.w)) + 3, y1 = Math.max(...rects.map(r => r.y + r.h)) + 3;
    const TW = state.target ? state.target.w : W, TH = state.target ? state.target.h : H;
    const aspect = TW / Math.max(1, TH);
    const need = Math.ceil(Math.max(x1 - x0, (y1 - y0) * aspect));
    const cols = Math.max(8, Math.min(layers[0].w, Math.max(state.cols, need)));
    return { cx: Math.round((x0 + x1) / 2 * TILE), cy: Math.round((y0 + y1) / 2 * TILE), cols };
  }

  function petFromSave(p) {
    if (!p || !p.type) return null;
    const t = String(p.type).toLowerCase();
    if (t !== 'cat' && t !== 'dog') return null;
    return t + Math.max(0, Math.min(5, p.breed | 0));
  }

  function importSave(msg) {
    const note = document.getElementById('import-note');
    if (!msg || msg.error) { if (note) note.textContent = msg && msg.error ? msg.error : ''; if (msg && msg.error) flash(msg.error); return; }
    const save = msg.save;
    // the save's farm type: lay it out on that map (when this computer has it)
    const wf = Number(save.whichFarm);
    const want = save.whichFarm != null && FARMS[wf] ? FARMS[wf].key : 'standard';
    if (want !== farmKey && !msg.mapTried) {
      loadFarmMap(want).then(m => {
        if (m) { switching = null; useMap(want, m); }
        importSave({ ...msg, mapTried: true });
      });
      return;
    }
    backupLayout('导入「{0}」之前', save.farmName || '存档');
    const { layout, report: R, placed } = layoutFromSave(save);
    if (farmKey !== 'standard') layout.farm = farmKey;
    setLayout(layout);
    notify('layout', state.layout);
    const pet = petFromSave(save.pet);
    if (pet) { setPet(pet); notify('pet', pet); }
    const core = ['house', 'coop', 'barn', 'stable'].map(n => SDV.layout.footprint(n, state.layout)).concat([SDV.layout.propFootprint(CONFIG, 'bin')]);
    const fr = frameAround(core);
    if (fr) { setFrame(fr); notify('frame', fr); }
    // what happened, in words
    const count = list => { const m = {}; list.forEach(n => { m[n] = (m[n] || 0) + 1; }); return tlist(Object.entries(m).map(([n, c]) => (c > 1 ? `${tr(n)}×${c}` : tr(n)))); };
    const lines = [tr('已按「{0}」农场{1}摆好：{2}', save.farmName || tr('存档'), save.name ? tr('（{0}）', save.name) : '', count(R.placed) || tr('没有能放的建筑'))];
    if (save.whichFarm != null && want !== farmKey) lines.push(tr('存档是{0}，这台电脑上还没读取这张地图，先按标准农场的地形摆放（重新读取游戏画面后再导入一次就对了）。', tr(FARM_ZH[wf] || '自定义地图的农场')));
    else if (save.whichFarm != null && FARMS[wf]) lines.push(tr('地图：{0}', tr(FARMS[wf].name)));
    if (R.skipped.length) lines.push(tr('这里的地形放不下：{0}', count(R.skipped)));
    const nd = Object.keys(R.notDrawn);
    if (nd.length) lines.push(tr('还画不了：{0}', tlist(nd.map(n => (I18N && I18N.get() === 'en' ? n : SAVE_ZH[n] || n) + (R.notDrawn[n] > 1 ? `×${R.notDrawn[n]}` : '')))));
    if (R.kept.length) lines.push(tr('存档里没有{0}，桌面上的保留着（可以拖走或保持原样）', tlist(R.kept.map(n => tr(n)))));
    const an = [];
    if (R.chickensAll) an.push(R.chickens < R.chickensAll ? tr('鸡 {0} 只（存档 {1} 只，院子只放得下这么多）', R.chickens, R.chickensAll) : tr('鸡 {0} 只', R.chickens));
    if (R.cowsAll) an.push(R.cows < R.cowsAll ? tr('奶牛 {0} 头（存档 {1} 头）', R.cows, R.cowsAll) : tr('奶牛 {0} 头', R.cows));
    lines.push(an.length ? tr('动物：{0}', an.join(tr('，'))) : tr('动物：存档里没有鸡和奶牛'));
    const na = Object.keys(R.animalsNot);
    if (na.length) lines.push(tr('还画不了的动物：{0}', tlist(na.map(t => (I18N && I18N.get() === 'en' ? t : ANIMAL_ZH[t] || t) + ' ' + R.animalsNot[t]))));
    if (pet) lines.push(tr(pet.startsWith('cat') ? '宠物：换成了存档里的猫{0}' : '宠物：换成了存档里的狗{0}', save.pet.name ? tr('「{0}」', save.pet.name) : ''));
    lines.push(tr('导入前的布局已自动存进下面的「我的布局」，想回去点「套用」就行。'));
    if (note) note.textContent = lines.join('\n');
    flash(tr('已从存档导入布局'));
    if (!state.editLayout) setEditLayout(true);
    renderSlots();
    return { layout, report: R, placed };
  }

  // ---------- my layouts: named copies, and automatic backups ----------
  // The layout itself is saved by the app on every change (it survives quitting and
  // restarting). These are extra copies to switch between; importing a save, resetting
  // or switching first keeps a backup of what was there.
  const MAX_SLOTS = 12, MAX_AUTO = 3;
  state.layouts = HOST ? [] : store.get('layouts', []);
  const isEmptyLayout = L => !L || !Object.keys(L).length;
  function setLayouts(list, quiet) {
    state.layouts = Array.isArray(list) ? list.filter(x => x && x.layout && typeof x.name === 'string') : [];
    if (!HOST) store.set('layouts', state.layouts);
    if (!quiet) notify('layouts', state.layouts);
    renderSlots();
  }
  function saveSlot(name, layout, auto, why) {
    const snap = JSON.parse(JSON.stringify(layout || {}));
    let list = state.layouts.slice();
    if (auto) {
      if (isEmptyLayout(snap)) return;                                            // nothing to lose
      if (list.some(x => JSON.stringify(x.layout) === JSON.stringify(snap))) return;   // already kept
      list.unshift({ id: newSlotId(), name, at: Date.now(), auto: true, layout: snap, ...(why ? { why } : {}) });
      const autos = list.filter(x => x.auto);
      if (autos.length > MAX_AUTO) list = list.filter(x => !x.auto || autos.indexOf(x) < MAX_AUTO);
    } else {
      list = list.filter(x => x.auto || x.name !== name);                          // same name: replace it
      list.unshift({ id: newSlotId(), name, at: Date.now(), layout: snap });
      const mine = list.filter(x => !x.auto);
      if (mine.length > MAX_SLOTS) list = list.filter(x => x.auto || mine.indexOf(x) < MAX_SLOTS);
    }
    setLayouts(list);
  }
  const newSlotId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  // An automatic backup keeps why it was made as a phrase and its words, so it reads right in either language.
  function backupLayout(key, ...args) {
    const fill = (k, a) => k.replace(/\{(\d+)\}/g, (m, i) => a[i]);
    saveSlot(fill(key, args), state.layout, true, { k: key, a: args });
  }
  const backupName = (x) => (x.why ? tr(x.why.k, ...x.why.a.map(v => tr(v))) : x.name);
  function useSlot(id) {
    const x = state.layouts.find(q => q.id === id);
    if (!x) return;
    backupLayout('套用「{0}」之前', x.name);
    setLayout(JSON.parse(JSON.stringify(x.layout)));
    notify('layout', state.layout);
    flash(tr('已套用「{0}」', x.name));
  }
  function deleteSlot(id) { setLayouts(state.layouts.filter(q => q.id !== id)); }
  const when = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function renderSlots() {
    const ul = document.getElementById('slot-list');
    if (!ul) return;
    ul.innerHTML = '';
    for (const x of state.layouts) {
      const li = document.createElement('li');
      li.dataset.id = x.id;
      const sp = document.createElement('span');
      sp.textContent = x.auto ? backupName(x) : x.name;
      sp.title = (x.auto ? tr('自动备份 · ') : '') + when(x.at);
      if (x.auto) sp.className = 'auto';
      const t = document.createElement('small'); t.textContent = when(x.at);
      const use = document.createElement('button'); use.className = 'use'; use.textContent = tr('套用');
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '×'; del.title = tr('删掉这份');
      li.append(sp, t, use, del);
      ul.appendChild(li);
    }
    if (!state.layouts.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = tr('还没有存过布局'); ul.appendChild(li); }
  }
  function bindSlots() {
    const $ = id => document.getElementById(id);
    if (!$('slot-list')) return;
    const save = () => {
      const name = ($('slot-name').value || '').trim().slice(0, 20) || tr('我的布局 {0}', when(Date.now()));
      saveSlot(name, state.layout, false);
      $('slot-name').value = '';
      flash(tr('已存下「{0}」', name));
    };
    $('slot-save').addEventListener('click', save);
    $('slot-name').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });
    $('slot-list').addEventListener('click', e => {
      const li = e.target.closest('[data-id]');
      if (!li) return;
      if (e.target.matches('.use')) useSlot(li.dataset.id);
      else if (e.target.matches('.del')) deleteSlot(li.dataset.id);
    });
    $('import-save').addEventListener('click', () => {
      if (HOST) { post({ type: 'importSave' }); return; }
      $('import-file').click();                              // browser preview: pick the save file
    });
    $('import-file').addEventListener('change', async () => {
      const f = $('import-file').files[0];
      $('import-file').value = '';
      if (!f) return;
      try { importSave({ save: SDV_SAVE.parse(await f.text()) }); }
      catch (err) { importSave({ error: tr('读不了这个文件：{0}', tr(err.message || String(err))) }); }
    });
    renderSlots();
  }
  // ---------- painting paths, fences and lamp-posts ----------
  function startPaint(p) {
    state.painting = { kinds: new Set(), last: null, why: null };
    paintAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
  }
  function paintAt(x, y) {
    const st = state.painting;
    if (!st || st.last === `${x},${y}`) return;
    st.last = `${x},${y}`;
    const tool = state.tool;
    const kinds = tool === 'erase' ? ['path', 'fence', 'lamp'].filter(k => SDV.paths.has(k, x, y)) : [tool];
    const why = SDV.paths.paint(tool, x, y, state.layout);
    if (why) { if (tool !== 'erase') flash(tr('放不下：{0}', tr(why))); return; }
    kinds.forEach(k => st.kinds.add(k));
  }
  function endPaint() {
    const st = state.painting;
    state.painting = null;
    if (!st || !st.kinds.size) return;
    // save only the kinds this stroke touched; the others keep following the buildings
    const lists = SDV.paths.lists(), L = { ...state.layout };
    for (const k of st.kinds) L[{ path: 'paths', fence: 'fences', lamp: 'lamps' }[k]] = lists[{ path: 'paths', fence: 'fences', lamp: 'lamps' }[k]];
    setLayout(L);
    notify('layout', state.layout);
  }
  function setTool(t) {
    state.tool = state.tool === t ? null : t;
    if (state.tool && !state.editLayout) setEditLayout(true);
    state.paintHover = null;
    syncButtons();
  }

  const DEFAULT_ANIMALS = CONFIG.animals.slice();
  function syncDecorMoves() {
    const L = state.layout;
    CONFIG.decorMoves = { fields: L.fields || {}, trees: L.trees || {}, objects: L.objects || {}, removed: L.fieldsRemoved || [], added: L.fieldsAdded || [], focus: L.focusPlot || null,
      treesRemoved: L.treesRemoved || [], objectsRemoved: L.objectsRemoved || [] };
    // a layout imported from a save brings its own chickens and cows
    const A = Array.isArray(L.animals) ? L.animals.filter(a => a && (a.kind === 'chicken' || a.kind === 'cow') && typeof a.img === 'string') : null;
    CONFIG.animals = A || DEFAULT_ANIMALS;
  }
  function setLayout(offsets) {
    state.layout = offsets || {};
    store.set('layout', state.layout);
    // a layout belongs to a farm map: change the ground first if it's another one
    if (farmOf(state.layout) !== farmKey) { switchFarm(farmOf(state.layout)); return; }
    applyLayoutNow();
  }
  function applyLayoutNow() {
    SDV.layout.apply(CONFIG, state.layout);
    syncDecorMoves();
    rebuildWorld();
  }

  // ---------- farm maps (标准、河边、森林、山顶、荒野、四角、海滩、草原) ----------
  const FARMS = DATA.farms && DATA.farms.length ? DATA.farms : [{ key: 'standard', name: '标准农场' }];
  const farmInfo = k => FARMS.find(f => f.key === k);
  const farmOf = L => (L && L.farm && farmInfo(L.farm) ? L.farm : 'standard');
  const mapLoads = {};
  function loadFarmMap(key) {
    if (key === 'standard') return Promise.resolve(DATA.map);
    if (!farmInfo(key)) return Promise.resolve(null);
    const have = window.SDV_MAPS && window.SDV_MAPS[key];
    if (have) return Promise.resolve(have);
    if (!mapLoads[key]) {
      mapLoads[key] = new Promise(res => {
        const sc = document.createElement('script');
        sc.src = `data/maps/${key}.js`;
        sc.onload = () => res((window.SDV_MAPS || {})[key] || null);
        sc.onerror = () => { delete mapLoads[key]; res(null); };
        document.head.appendChild(sc);
      });
    }
    return mapLoads[key];
  }
  // How far the game moved the farmhouse on this map (only the meadowlands farm does).
  function houseShift(m) {
    const e = String((m.properties || {}).FarmHouseEntry || '').trim().split(/\s+/).map(Number);
    return e.length === 2 && e.every(Number.isFinite) ? [e[0] - 64, e[1] - 15] : [0, 0];
  }
  const BASE_CLEARED = { ...CONFIG.decor.clearedZone };
  const BASE_TOUR = CONFIG.saver.tour.slice();
  let farmGrass = null;                 // the yard's grass tufts, moved with the house
  // Put another farm map under everything. The caller re-applies the layout afterwards.
  function useMap(key, m) {
    farmKey = key; map = m;
    layers = map.layers.filter(l => !CONFIG.hiddenLayers.includes(l.id));
    mapW = layers[0].w * TILE; mapH = layers[0].h * TILE;
    mapSheets = sheetNames(map);
    if (baked) baked.groups.forEach(gr => { gr.canvas.width = gr.canvas.height = 0; });
    baked = null; imageSeason = null; seasonLoading = null;
    SDV.layout.init(CONFIG, map, TILE);
    SDV.villagers.setMap(map);
    const [sx, sy] = houseShift(map), W = layers[0].w, H = layers[0].h;
    CONFIG.decor.clearedZone = { ...BASE_CLEARED, x: BASE_CLEARED.x + sx, y: BASE_CLEARED.y + sy };
    farmGrass = BASE_GRASS.map(([x, y, v]) => [x + sx, y + sy, v]).filter(([x, y]) => SDV.layout.inMap(x, y) && !SDV.layout.isSolid(x, y));
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    CONFIG.saver.tour = BASE_TOUR.map(([x, y, hold]) => [cl(x + sx, 10, W - 10), cl(y + sy, 8, H - 8), hold]);
    SDV.saver.init(CONFIG, TILE, mapW, mapH);
    SDV.critters.init(TILE);
  }
  let switching = null;
  function switchFarm(key, then) {
    switching = key;
    loadFarmMap(key).then(m => {
      if (switching !== key) return;
      switching = null;
      if (!m) {
        flash(tr('这台电脑上还没有这张农场地图：叶子菜单 → 更多 →「重新读取游戏画面…」读取一次就有了'));
        state.layout = { ...state.layout, farm: farmKey === 'standard' ? undefined : farmKey };
      } else useMap(key, m);
      applyLayoutNow();
      syncButtons();
      if (then) then(Boolean(m));
    });
  }
  // A starting layout for a farm map: the house where the game puts it there, everything
  // else as near its usual spot as the ground allows (or left out when nothing fits).
  function layoutForFarm(key) {
    const [sx, sy] = houseShift(map);
    const L = key === 'standard' ? {} : { farm: key };
    const taken = [];
    const grow = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
    const blocked = r => {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!SDV.layout.inMap(x, y) || SDV.layout.isSolid(x, y)) return true;
      return false;
    };
    const ok = (r, pad) => !blocked(r) && !taken.some(o => rectsOverlap(grow(r, pad), o));
    const find = (r, pad, maxR) => spiral(maxR || 24, (dx, dy) => (ok({ ...r, x: r.x + dx, y: r.y + dy }, pad) ? [dx, dy] : null));
    if (sx || sy) L.house = [sx, sy];
    taken.push(SDV.layout.footprint('house', L));
    SDV.layout.apply(CONFIG, L);
    for (const n of ['mailbox', 'bin']) taken.push(SDV.layout.propFootprint(CONFIG, n));
    for (const name of ['coop', 'barn', 'stable']) {
      const base = SDV.layout.footprint(name, { [name]: [sx, sy] });
      const d = find(base, 1) || find(base, 0, 40);
      if (!d) continue;
      L[name] = [sx + d[0], sy + d[1]];
      taken.push(SDV.layout.footprint(name, L));
    }
    SDV.layout.apply(CONFIG, L);
    {
      const b = SDV.layout.propFootprint(CONFIG, 'board');
      const d = find({ ...b, x: b.x + sx, y: b.y + sy }, 0, 20);
      if (d && (sx + d[0] || sy + d[1])) L.board = [sx + d[0], sy + d[1]];
      if (d) taken.push({ ...b, x: b.x + sx + d[0], y: b.y + sy + d[1] });
    }
    const fieldsBase = CONFIG.decor.fields || [];
    fieldsBase.forEach((f, i) => {
      const d = find({ x: f.x + sx, y: f.y + sy, w: f.w, h: f.h }, 1, 18);
      if (!d) { (L.fieldsRemoved = L.fieldsRemoved || []).push(i); return; }
      const m = [sx + d[0], sy + d[1]];
      if (m[0] || m[1]) (L.fields = L.fields || {})[i] = m;
      taken.push(grow({ x: f.x + m[0], y: f.y + m[1], w: f.w, h: f.h }, 1));
    });
    // the bee houses, kegs and the chest that don't belong to a field
    const owner = o => fieldsBase.findIndex(f => o.x >= f.x - 2 && o.x <= f.x + f.w + 1 && o.y >= f.y - 2 && o.y <= f.y + f.h + 1);
    (CONFIG.decor.objects || []).forEach((o, id) => {
      if (o.type === 'sprinkler' || owner(o) >= 0) return;
      const r = { x: o.x + sx, y: o.y + sy, w: 1, h: 1 };
      if (!ok(r, 0)) { (L.objectsRemoved = L.objectsRemoved || []).push(id); return; }
      if (sx || sy) (L.objects = L.objects || {})[id] = [r.x, r.y];
      taken.push(r);
    });
    if (sx || sy) (CONFIG.decor.extraTrees || []).forEach((t, i) => { (L.trees = L.trees || {})[`e${i}`] = [t[0] + sx, t[1] + sy]; });
    return L;
  }
  // 换地图: back up what's there, lay the new farm out, and frame its yard.
  function pickFarm(key) {
    if (key === farmKey && farmOf(state.layout) === key) return;
    const info = farmInfo(key);
    if (!info) return;
    backupLayout('换成{0}之前', info.name);
    loadFarmMap(key).then(m => {
      if (!m) { flash(tr('这台电脑上还没有这张农场地图：叶子菜单 → 更多 →「重新读取游戏画面…」读取一次就有了')); return; }
      switching = null;
      useMap(key, m);
      setLayout(layoutForFarm(key));
      notify('layout', state.layout);
      const core = ['house', 'coop', 'barn', 'stable'].map(n => SDV.layout.footprint(n, state.layout)).concat([SDV.layout.propFootprint(CONFIG, 'bin')]);
      const fr = frameAround(core);
      if (fr) { setFrame({ ...state.frame, ...fr }); notify('frame', state.frame); }
      const note = document.getElementById('import-note'); if (note) note.textContent = '';
      flash(tr('换成了{0}；之前的布局在「我的布局」里有备份', tr(info.name)));
      syncButtons();
    });
  }
  // Re-place everything that depends on where the buildings are.
  // Decor first (fields, objects, trees), then paths / fences / lamps around it, and
  // whatever stands on those gives way.
  function buildGround() {
    SDV.decor.init(CONFIG, map, TILE);
    SDV.paths.build(CONFIG, map, TILE, state.layout);
    SDV.decor.clearTiles(SDV.paths.tiles());
  }
  function rebuildWorld() {
    buildGround();
    const grass = (farmGrass || BASE_GRASS || []).filter(([x, y]) => !SDV.decor.isBlocked(x, y));
    SDV.interact.init({ ...CONFIG, grass }, map, TILE, { grass: SDV.decor.grassSpots(), canopy: SDV.decor.canopyTiles() });
    const d = worldDate(), s = seasonOf(d);
    const w = SDV.weather.current(d, s, state.weatherOverride);
    const wet = w.type === 'rain' || w.type === 'storm' || w.type === 'snow';
    SDV.animals.init(CONFIG, SDV.sky.at(d, CONFIG.location).alt > 1 && !wet && s !== 'winter');
  }
  const BASE_GRASS = CONFIG.grass.slice();
  function setEditLayout(on) {
    state.editLayout = on;
    if (!on) { state.tool = null; state.painting = null; state.paintHover = null; }
    state.moving = null;
    canvas.style.cursor = '';
    SDV.interact.setCursor(null);
    syncButtons();
  }

  // Settings window → app → desktop scenes.
  function notify(key, value) { if (EDITOR) post({ type: 'setting', key, value }); }
  function syncButtons() {
    const pressed = (sel, fn) => document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(fn(b))));
    pressed('[data-season]', b => b.dataset.season === state.seasonMode);
    const mode = state.follow ? 'edge' : 'off';
    pressed('[data-follow]', b => b.dataset.follow === mode);
    const fh = document.getElementById('follow-hint');
    if (fh) fh.textContent = tr({ off: '桌面上的农场一直停在黄框这里。',
      edge: '鼠标移到屏幕四周边缘停一下，视野就慢慢往那边移，到农场边上为止；鼠标离开边缘，画面就停在那里。大小按上面定好的来。' }[mode]);
    const lock = document.getElementById('frame-lock');
    if (lock) lock.checked = state.lock;
    const zl = document.getElementById('zoom-label');
    if (zl && W > 1) { const r = frameRect(), zr = zoomRange(); zl.textContent = tr('一屏 {0}×{1} 格', Math.round(r.w / TILE), Math.round(r.h / TILE));
      document.getElementById('zoom-in').disabled = state.lock || r.scale >= zr.hi; document.getElementById('zoom-out').disabled = state.lock || r.scale <= zr.lo; }
    pressed('[data-farm]', b => b.dataset.farm === (switching || farmKey));
    pressed('[data-ev]', b => (b.dataset.ev === 'full' ? Boolean(state.ecam && state.ecam.full) : !state.ecam));
    pressed('[data-weather]', b => (b.dataset.weather === 'live' ? state.weatherOverride == null : b.dataset.weather === state.weatherOverride));
    document.getElementById('time-live').setAttribute('aria-pressed', String(state.timeOverride == null));
    document.getElementById('grid').setAttribute('aria-pressed', String(state.grid));
    document.getElementById('layout-edit').setAttribute('aria-pressed', String(state.editLayout));
    pressed('[data-pet]', b => b.dataset.pet === state.pet);
    pressed('[data-tool]', b => b.dataset.tool === state.tool);
    if (state.timeOverride != null) timeRange.value = state.timeOverride;
    else { const d = new Date(); timeRange.value = d.getHours() + d.getMinutes() / 60; }
  }
  document.querySelectorAll('[data-season]').forEach(b => b.addEventListener('click', () => { setSeason(b.dataset.season); notify('season', b.dataset.season); }));
  // 视野: zoom, lock, follow mode, reset
  document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1));
  document.getElementById('zoom-out').addEventListener('click', () => zoomBy(-1));
  document.getElementById('frame-lock').addEventListener('change', e => { state.lock = e.target.checked; commitFrame(); });
  document.querySelectorAll('[data-follow]').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.follow;
    state.follow = m !== 'off';
    state.roam = false;
    if (!HOST) store.set('follow', state.follow);
    notify('follow', state.follow);
    commitFrame();
  }));
  const homeFrame = () => frameAround(['house', 'coop', 'barn', 'stable'].map(n => SDV.layout.footprint(n, state.layout)).concat([SDV.layout.propFootprint(CONFIG, 'bin')]));
  document.getElementById('frame-home').addEventListener('click', () => { const f = homeFrame(); if (f) { setFrameLive({ cx: f.cx, cy: f.cy, cols: state.lock ? state.cols : f.cols }); commitFrame(); } });
  document.getElementById('frame-reset').addEventListener('click', () => {
    const [sx, sy] = houseShift(map);
    state.lock = false;
    setFrameLive({ cx: CONFIG.frame.cx + sx * TILE, cy: CONFIG.frame.cy + sy * TILE, cols: CONFIG.targetCols });
    commitFrame();
    flash(tr('视野恢复成默认的样子'));
  });
  document.getElementById('go-view').addEventListener('click', () => setTab('view'));
  // 布置: the farm maps, and the window's own zoom
  (() => {
    const box = document.getElementById('farm-list');
    for (const f of FARMS) {
      const b = document.createElement('button');
      b.dataset.farm = f.key; b.dataset.zh = f.name.replace('农场', ''); b.dataset.zhTitle = f.name;
      b.textContent = tr(b.dataset.zh); b.title = tr(f.name);
      b.addEventListener('click', () => pickFarm(f.key));
      box.appendChild(b);
    }
    if (FARMS.length < 2) {
      const h = document.createElement('div'); h.className = 'hint';
      h.textContent = '其他地图（河边、森林、山顶、荒野、四角、海滩、草原）要先在叶子菜单 → 更多 →「重新读取游戏画面…」读一次。';
      h.dataset.i18n = 'text';
      box.after(h);
    }
  })();
  document.getElementById('ez-in').addEventListener('click', () => editZoom(1));
  document.getElementById('ez-out').addEventListener('click', () => editZoom(-1));
  document.querySelectorAll('[data-ev]').forEach(b => b.addEventListener('click', () => setEditView(b.dataset.ev)));
  document.querySelectorAll('[data-weather]').forEach(b => b.addEventListener('click', () => { setWeather(b.dataset.weather); notify('weather', b.dataset.weather); }));
  document.getElementById('time-live').addEventListener('click', () => { setTime(null); notify('time', null); });
  timeRange.addEventListener('input', () => { setTime(Number(timeRange.value)); notify('time', Number(timeRange.value)); });
  document.getElementById('grid').addEventListener('click', () => { state.grid = !state.grid; syncButtons(); });
  document.getElementById('layout-edit').addEventListener('click', () => setEditLayout(!state.editLayout));
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  document.getElementById('paths-auto').addEventListener('click', () => {
    const L = { ...state.layout };
    delete L.paths; delete L.fences; delete L.lamps;
    setLayout(L);
    notify('layout', state.layout);
    flash(tr('路、围栏和路灯恢复成自动：跟着建筑走'));
  });
  document.getElementById('field-add').addEventListener('click', () => {
    if (!state.editLayout) setEditLayout(true);
    if (!addField()) flash(tr('附近没有空地放新的田了，先挪开一些东西再试'));
  });
  // One button per pet, showing its sitting sprite.
  function buildPetButtons() {
    const row = document.getElementById('pets');
    if (!row || row.childElementCount) return;
    for (const [id, name] of SDV.interact.PETS.concat([['none', '不养']])) {
      const b = document.createElement('button');
      b.dataset.pet = id; b.title = tr(name); b.dataset.zhTitle = name; b.className = 'pet';
      const img = images['pet_' + id];
      if (img) {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const f = id.startsWith('dog') ? 24 : 17;
        c.getContext('2d').drawImage(img, (f % 4) * 32, Math.floor(f / 4) * 32, 32, 32, 0, 0, 32, 32);
        b.appendChild(c);
      } else { b.textContent = tr(name); b.dataset.zh = name; }
      b.addEventListener('click', () => { setPet(id); notify('pet', id); });
      row.appendChild(b);
    }
    syncButtons();
  }
  document.getElementById('layout-reset').addEventListener('click', () => {
    backupLayout('恢复默认之前');
    setLayout({}); notify('layout', {});
    const note = document.getElementById('import-note'); if (note) note.textContent = '';
    flash(tr('已恢复默认布局；之前的布局在「我的布局」里有备份'));
  });
  bindSlots();
  // Tabs: 场景 / 布置 / 公告板 (the panel was getting long). Leaving 布置 ends layout mode.
  function setTab(t) {
    if (!document.querySelector(`[data-pane="${t}"]`)) t = 'scene';
    document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('on', p.dataset.pane === t));
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === t)));
    if (t !== 'layout' && state.editLayout) setEditLayout(false);
    if (!DESKTOP && !SAVER) {
      if (t !== 'layout') state.ecam = null;
      setView(t === 'view' ? 'full' : 'frame');
      if (t === 'view') { store.set('viewSeen', true); const c = document.getElementById('view-callout'); if (c) c.hidden = true; }
      placeTip(t === 'view');
    }
    info.style.display = t === 'board' || t === 'music' ? 'none' : '';
    store.set('tab', t);
    syncButtons();
  }
  const currentTab = () => store.get('tab', 'scene');
  // the tip over the map while the 视野 tab is open
  function placeTip(on) {
    const tip = document.getElementById('view-tip');
    if (!tip) return;
    tip.hidden = !on;
    if (on) { const r = canvas.getBoundingClientRect(); tip.style.left = `${r.left + r.width / 2}px`; }
  }
  if (store.get('viewSeen', false)) { const c = document.getElementById('view-callout'); if (c) c.hidden = true; }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  setTab(store.get('tab', 'scene'));
  window.addEventListener('keydown', e => {
    if (e.target === timeRange || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'h' || e.key === 'H') setPanel(document.getElementById('panel').classList.contains('hidden'));
    else if (e.key === 'g' || e.key === 'G') { state.grid = !state.grid; syncButtons(); }
    else if ('1234'.includes(e.key)) { setSeason(SEASONS[Number(e.key) - 1]); notify('season', SEASONS[Number(e.key) - 1]); }
    else if (e.key === '0') { setSeason('auto'); notify('season', 'auto'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.editLayout && !state.moving && state.hover && state.hover.type === 'field') deleteField(state.hover.index);
  });
  window.addEventListener('resize', () => { resize(); placeTip(currentTab() === 'view' && !DESKTOP && !SAVER); syncButtons(); });

  // ---------- 音乐: when, how loud, and which of the game's tracks ----------
  // The app plays the music; this page only says what's wanted (and shows what's on).
  const ML = window.SDV_MUSIC;
  const mstate = { music: 'off', volume: 'mid', pick: { mode: 'season', list: [], order: 'shuffle' }, now: null, preparing: [], status: '', season: null };
  const ZH_SEASON = { spring: '春', summer: '夏', fall: '秋', winter: '冬' };
  const trackTitle = t => (I18N && I18N.get() === 'en' ? t.en : t.zh);
  function musicSeason() { return mstate.season || seasonOf(worldDate()); }
  function setMusicPick(p) {
    const order = ML ? ML.tracks.map(t => t.id) : [];
    p.list = [...new Set(p.list)].filter(id => order.includes(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    mstate.pick = p;
    if (!HOST) store.set('musicPick', p);
    notify('musicPick', p);
    renderMusic();
  }
  function buildMusicList() {
    const box = document.getElementById('music-list');
    if (!box || !ML || box.childElementCount) return;
    for (const g of ML.groups) {
      const h = document.createElement('div'); h.className = 'grp'; h.textContent = g; h.dataset.i18n = 'text'; box.appendChild(h);
      for (const t of ML.tracks.filter(x => x.group === g)) {
        const row = document.createElement('div'); row.className = 'trk'; row.dataset.id = t.id; row.dataset.noi18n = '';
        const lab = document.createElement('label');
        const cb = document.createElement('input'); cb.type = 'checkbox';
        const sp = document.createElement('span'); sp.className = 'tname';
        lab.append(cb, sp);
        const sm = document.createElement('small');
        const pl = document.createElement('button'); pl.className = 'play'; pl.textContent = '▶'; pl.title = tr('试听');
        row.append(lab, sm, pl);
        box.appendChild(row);
      }
    }
    box.addEventListener('change', e => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const p = { ...mstate.pick, list: mstate.pick.list.filter(id => id !== row.dataset.id) };
      if (e.target.checked) { p.list.push(row.dataset.id); if (p.mode !== 'list') { p.mode = 'list'; flash(tr('已切到「我的歌单」：只放勾上的歌')); } }
      setMusicPick(p);
    });
    box.addEventListener('click', e => {
      if (!e.target.matches('.play')) return;
      const id = e.target.closest('[data-id]').dataset.id;
      if (!HOST) { flash(tr('在 App 里才会出声：这里是浏览器预览')); return; }
      if (mstate.now === id) post({ type: 'musicStop' }); else post({ type: 'musicPlay', id });
    });
  }
  function renderMusic() {
    if (!document.getElementById('music-list')) return;
    buildMusicList();
    const P = mstate.pick, list = new Set(P.list);
    const pressed = (sel, fn) => document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(fn(b))));
    pressed('[data-music]', b => b.dataset.music === mstate.music);
    pressed('[data-mvol]', b => b.dataset.mvol === mstate.volume);
    pressed('[data-mmode]', b => b.dataset.mmode === P.mode);
    pressed('[data-morder]', b => b.dataset.morder === P.order);
    const zh = seasonName(musicSeason());
    document.getElementById('mmode-hint').textContent = P.mode === 'list'
      ? (P.list.length ? tr(P.order === 'order' ? '只放下面勾上的 {0} 首，按顺序一首接一首，每首之间停几秒。' : '只放下面勾上的 {0} 首，随机播放，每首之间停几秒。', P.list.length) : tr('还没勾歌：先在下面勾几首（现在先按季节放）。'))
      : tr('和游戏里一样：现在是{0}天，就放{0}天的三首，一首放完安静一会儿再放下一首。', zh);
    const now = document.getElementById('music-now');
    const nowTxt = mstate.now && ML && ML.byId[mstate.now] ? `♪ ${trackTitle(ML.byId[mstate.now])}` : (mstate.status ? tr(mstate.status) : tr(mstate.music === 'off' ? '背景音乐关着（▶ 可以单独试听一首）' : '没有在放'));
    now.textContent = nowTxt; now.title = nowTxt; now.classList.toggle('on', Boolean(mstate.now));
    document.getElementById('music-next').disabled = !HOST || mstate.music === 'off' && !mstate.now;
    document.querySelectorAll('#music-list [data-id]').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('input').checked = list.has(id);
      row.classList.toggle('now', mstate.now === id);
      row.querySelector('.play').textContent = mstate.now === id ? '■' : '▶';
      row.querySelector('.play').title = tr(mstate.now === id ? '停下' : '试听');
      row.querySelector('small').textContent = mstate.preparing.includes(id) ? tr('取出中…') : '';
      const t = ML.byId[id], sp = row.querySelector('.tname');
      sp.textContent = trackTitle(t); sp.title = I18N && I18N.get() === 'en' ? t.zh : t.en;
    });
  }
  (() => {
    if (!document.getElementById('music-list')) return;
    if (!HOST) mstate.pick = { ...mstate.pick, ...store.get('musicPick', {}) };
    document.querySelectorAll('[data-music]').forEach(b => b.addEventListener('click', () => { mstate.music = b.dataset.music; notify('music', mstate.music); renderMusic(); }));
    document.querySelectorAll('[data-mvol]').forEach(b => b.addEventListener('click', () => { mstate.volume = b.dataset.mvol; notify('musicVolume', mstate.volume); renderMusic(); }));
    document.querySelectorAll('[data-mmode]').forEach(b => b.addEventListener('click', () => setMusicPick({ ...mstate.pick, mode: b.dataset.mmode })));
    document.querySelectorAll('[data-morder]').forEach(b => b.addEventListener('click', () => setMusicPick({ ...mstate.pick, order: b.dataset.morder })));
    document.getElementById('music-next').addEventListener('click', () => post({ type: 'musicNext' }));
    document.getElementById('mlist-all').addEventListener('click', () => setMusicPick({ ...mstate.pick, mode: 'list', list: ML.tracks.map(t => t.id) }));
    document.getElementById('mlist-none').addEventListener('click', () => setMusicPick({ ...mstate.pick, mode: 'season', list: [] }));
    document.getElementById('mlist-season').addEventListener('click', () => setMusicPick({ ...mstate.pick, mode: 'list', list: ML.seasons[musicSeason()].slice() }));
    renderMusic();
  })();

  // ---------- 语言 / Language ----------
  // The page is written in Chinese; in English every piece of text with a translation is
  // swapped (and swapped back), and everything the scripts draw asks I18N as it goes.
  const translateDom = root => I18N && I18N.dom(root);
  function applyLang(l) {
    if (!I18N) return;
    I18N.set(l);
    document.documentElement.lang = I18N.get() === 'en' ? 'en' : 'zh-CN';
    document.title = I18N.get() === 'en' ? 'Stardew Desk' : '星露谷桌面';
    translateDom(document.body);
    document.querySelectorAll('[data-farm]').forEach(b => { b.textContent = tr(b.dataset.zh); b.title = tr(b.dataset.zhTitle); });
    document.querySelectorAll('[data-pet]').forEach(b => { if (b.dataset.zhTitle) b.title = tr(b.dataset.zhTitle); if (b.dataset.zh) b.textContent = tr(b.dataset.zh); });
    document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === I18N.get())));
    renderSlots(); renderMusic(); SDV.board.refresh && SDV.board.refresh(); syncButtons(); updateInfo();
    placeTip(currentTab() === 'view' && !DESKTOP && !SAVER);
  }
  document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => {
    if (!HOST) store.set('lang', b.dataset.lang);
    applyLang(b.dataset.lang);
    notify('lang', b.dataset.lang);
  }));
  // the browser preview remembers its own choice; the apps send theirs
  if (I18N && !HOST) applyLang(I18N.resolve(store.get('lang', 'auto'), navigator.language));

  // ---------- loop ----------
  let last = 0, lastInfo = 0, lastStatus = 0, running = false, fps = CONFIG.fps;
  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    if (document.hidden) { lastT = now; return; }
    // While the cursor is playing with the scene, run smoother (unless the host throttled us hard).
    const want = fps > 8 && SDV.interact.recentlyActive(now / 1000) ? Math.max(fps, 24) : fps;
    if (now - last < 1000 / want - 1) return;
    last = now;
    frame(now);
    if (now - lastInfo > 500) { updateInfo(); if (!DESKTOP && !SAVER) SDV.board.previewLine(); lastInfo = now; }
    if (DESKTOP && now - lastStatus > 2000) { postStatus(); lastStatus = now; }
  }
  function startLoop() {
    if (running) return;
    running = true;
    lastT = performance.now();
    requestAnimationFrame(tick);
  }

  // ---------- desktop host bridge (mac/ app) ----------
  // The host calls SDV.host.* through evaluateJavaScript and listens on
  // window.webkit.messageHandlers.sdv for messages from the page.
  function post(msg) {
    try { window.webkit.messageHandlers.sdv.postMessage(msg); } catch { /* not in the app */ }
  }
  function postStatus() {
    // Works before the first frame and while paused: compute what the scene would show.
    const date = worldDate();
    const season = seasonOf(date);
    const sky = SDV.sky.at(date, CONFIG.location);
    const weather = SDV.weather.current(date, season, state.weatherOverride);
    post({
      type: 'status',
      text: `${pad(date.getHours())}:${pad(date.getMinutes())} ${tr(sky.phase)} · ${seasonName(season)} · ${SDV.weather.label(weather)}`,
      detail: tr('天气来源：{0} · 动物 {1}', SDV.weather.sourceLabel ? SDV.weather.sourceLabel(weather) : weather.source, SDV.animals.summary()),
    });
  }
  SDV.host = {
    cursor(x, y, covered) {
      if (x == null) { state.hoverTile = null; state.cursor = null; state.cursorScreen = null; SDV.interact.setCursor(null); return; }
      const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
      const cl = v => Math.max(-1, Math.min(1, v));
      state.cursorScreen = { x: cl((x / cw - 0.5) * 2), y: cl((y / ch - 0.5) * 2) };
      state.cursorCovered = Boolean(covered);
      const p = toMap({ clientX: x, clientY: y });
      state.cursor = p;
      SDV.interact.setCursor(p, performance.now() / 1000, Boolean(covered));
      state.hoverTile = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
    },
    setFps(n) {
      if (n > 0) { fps = n; startLoop(); } else running = false;
      postStatus();
    },
    setSeason(m) { setSeason(m || 'auto'); },
    setWeather(w) { setWeather(w || 'live'); },
    setLiveWeather(l) { SDV.weather.setLive(l); postStatus(); },
    // A setting changed in the settings window (or restored by the app at start).
    apply(key, value) {
      if (key === 'season') setSeason(value || 'auto');
      else if (key === 'weather') setWeather(value || 'live');
      else if (key === 'time') setTime(value == null ? null : Number(value));
      else if (key === 'frame' && value && value.cx != null) setFrame(value);
      else if (key === 'layout') setLayout(value || {});
      else if (key === 'pet') setPet(value || 'cat0');
      else if (key === 'board') { SDV.board.set(value); if (!HOST) store.set('board', value); }
      else if (key === 'location' && value && typeof value.lat === 'number') CONFIG.location = { ...CONFIG.location, lat: value.lat, lon: value.lon, name: value.name };
      else if (key === 'layouts') setLayouts(value || [], true);
      else if (key === 'follow') { state.follow = Boolean(value); if (!HOST) store.set('follow', state.follow); }
      else if (key === 'lang' && value) applyLang(value);
      else if (key === 'musicState' && value) { Object.assign(mstate, value, { pick: value.pick || mstate.pick, preparing: value.preparing || [] }); renderMusic(); }
      postStatus();
    },
    mail(n) { state.mail = Math.max(0, Number(n) || 0); },
    focus(f) { SDV.focus.set(f); },
    visit(id) { return SDV.villagers.visit(id); },
    setTarget(w, h) { state.target = w && h ? { w, h } : null; syncButtons(); },
    click(x, y) { SDV.board.click(x * dpr, y * dpr); },
    importSave(msg) { return importSave(msg); },
    // a to-do came due: the farm says so, whatever the system notification did
    remind(text, id) { SDV.board.remind(text, id); },
    wheel(x, y, dy) { SDV.board.wheel(x * dpr, y * dpr, dy); },
    openBoard() { setPanel(true); setTab('board'); SDV.board.openPanel(true); },
    openTab(t) { setPanel(true); setTab(t); },
  };

  resize();
  setView(DESKTOP || SAVER ? 'frame' : state.view);
  syncButtons();
  if (DESKTOP || SAVER) { document.getElementById('panel').classList.add('hidden'); document.getElementById('panel-show').hidden = true; }   // the desktop scene shows no panel
  resize();
  SDV.weather.start(CONFIG.weather, CONFIG.location, { fetch: !HOST });
  loadSeason(seasonOf(worldDate())).then(() => {
    const d = worldDate();
    const s = seasonOf(d);
    const w = SDV.weather.current(d, s, state.weatherOverride);
    const wet = w.type === 'rain' || w.type === 'storm' || w.type === 'snow';
    SDV.layout.init(CONFIG, map, TILE);
    SDV.layout.apply(CONFIG, state.layout);
    syncDecorMoves();
    SDV.interact.setPet(state.pet);
    buildPetButtons();
    if (!HOST) SDV.board.set(store.get('board', null));        // browser preview keeps it here; the app sends its own
    if (!DESKTOP && !SAVER) SDV.board.bindPanel(b => { if (!HOST) store.set('board', b); notify('board', b); });
    SDV.animals.init(CONFIG, SDV.sky.at(d, CONFIG.location).alt > 1 && !wet && s !== 'winter');
    buildGround();
    SDV.critters.init(TILE);
    SDV.villagers.init(CONFIG, TILE);
    SDV.saver.init(CONFIG, TILE, mapW, mapH);
    SDV.interact.init({ ...CONFIG, grass: (farmGrass || BASE_GRASS).filter(([x, y]) => !SDV.decor.isBlocked(x, y)) }, map, TILE,
      { grass: SDV.decor.grassSpots(), canopy: SDV.decor.canopyTiles() });
    if (farmOf(state.layout) !== farmKey) switchFarm(farmOf(state.layout));
    startLoop();
    post({ type: 'hello', lat: CONFIG.location.lat, lon: CONFIG.location.lon, refreshMinutes: CONFIG.weather.refreshMinutes });
  });
})();
