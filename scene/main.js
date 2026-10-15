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
  };

  const SEASONS = ['spring', 'summer', 'fall', 'winter'];
  const SEASON_ZH = { spring: '春', summer: '夏', fall: '秋', winter: '冬' };
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
  const wanted = (n, season) => {
    const ss = SEASON_OF(n);
    if (ss) return ss === season || (n === 'flooring_winter' && season === 'winter');
    if (n === 'hoedirt_snow') return season === 'winter';
    if (n.startsWith('pet_')) return EDITOR || n === `pet_${state.pet}`;
    return true;
  };
  let imageSeason = null, seasonLoading = null;
  function loadSeason(season) {
    if (seasonLoading && seasonLoading.season === season) return seasonLoading.promise;
    const promise = Promise.all(DATA.images.filter(n => wanted(n, season)).map(load)).then(() => {
      imageSeason = season;
      seasonLoading = null;
      for (const n of Object.keys(images)) if (!wanted(n, season)) delete images[n];
    });
    seasonLoading = { season, promise };
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
  const map = DATA.map;
  const TILE = map.tilesheets[0]?.tw || 16;
  const layers = map.layers.filter(l => !CONFIG.hiddenLayers.includes(l.id));
  const mapW = layers[0].w * TILE, mapH = layers[0].h * TILE;
  const UNDER = ['Back', 'Buildings'];   // drawn below props and animals
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
    W = Math.round(innerWidth * dpr);
    H = Math.round(innerHeight * dpr);
    canvas.width = W; canvas.height = H;
  }

  function camera() {
    if (SAVER) return SDV.saver.camera(W, H, CONFIG.saver.cols);
    if (state.view === 'full') {
      const scale = Math.min(W / mapW, H / mapH);
      return { scale, x: -(W / scale - mapW) / 2, y: -(H / scale - mapH) / 2 };
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
  function propSprite(p) {
    const [sx, sy, sw, sh] = p.src;
    return { y: p.y + sh, draw(g) { const img = images[p.img]; if (img) g.drawImage(img, sx, sy, sw, sh, p.x, p.y, sw, sh); } };
  }
  function drawDoor(g, home, open) {
    const img = images[home.img];
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
  function drawBoard(cam, dt) {
    const b = P.board;
    if (!b || !SDV.board.shown()) return;
    const bw = b.src[2], bh = b.src[3];
    const sx = (b.x - cam.x) * cam.scale, sy = (b.y - cam.y) * cam.scale, sw = bw * cam.scale;
    if (sx + sw < 0 || sx > W || sy + sw < 0 || sy > H) { boardRect(null); return; }   // board out of view
    const c = state.cursor;
    const overBoard = Boolean(c && c.x >= b.x && c.x < b.x + bw && c.y >= b.y && c.y < b.y + bh);
    const cursor = c ? { x: (c.x - cam.x) * cam.scale, y: (c.y - cam.y) * cam.scale } : null;
    SDV.board.draw(ctx, { anchor: { x: sx + sw / 2, y: sy + 1 * cam.scale, h: bh * cam.scale }, cursor, overBoard, dt, k: dpr, W, H, images, cur: CUR });
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
  SDV.board.onToggle(b => { if (DESKTOP) post({ type: 'board', value: b }); else { if (!HOST) store.set('board', b); notify('board', b); } });

  // ---------- frame ----------
  let lastT = performance.now();
  let current = { sky: null, weather: null, season: 'spring', date: new Date() };

  function frame(nowMs) {
    const dt = Math.min(0.25, (nowMs - lastT) / 1000);
    lastT = nowMs;

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
    const sprites = [P.house, P.coop, P.barn, P.stable, P.mailbox, P.bin, SDV.board.shown() && P.board].filter(Boolean).map(propSprite)
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

    if (!SAVER && !state.editLayout) drawBoard(cam, dt); else boardRect(null);
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
    if (state.view === 'full' && !state.editLayout) {
      const r = state.drag ? dragRect() : frameRect();
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 2 * lw * dpr;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
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
      const hf = !state.moving && !state.tool && state.hover && state.hover.type === 'field' && state.hover.index !== 'focus' && SDV.decor.fieldRects().find(f => f.index === state.hover.index);
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
  function frameRect() {
    const TW = state.target ? state.target.w : W, TH = state.target ? state.target.h : H;
    const scale = Math.max(1, Math.round(TW / (state.cols * TILE)));
    const w = TW / scale, h = TH / scale;
    const x = Math.max(0, Math.min(mapW - w, state.frame.cx - w / 2));
    const y = Math.max(0, Math.min(mapH - h, state.frame.cy - h / 2));
    return { x, y, w, h, scale };
  }
  function dragRect() {
    const { a, b } = state.drag;
    const TW = state.target ? state.target.w : W, TH = state.target ? state.target.h : H;
    const w = Math.max(Math.abs(b.x - a.x), TILE * 8);
    const h = w * TH / TW;
    return { x: Math.min(a.x, b.x), y: a.y <= b.y ? a.y : a.y - h, w, h };
  }

  // ---------- panel ----------
  const pad = n => String(n).padStart(2, '0');
  function updateInfo() {
    const { sky, weather, season, date } = current;
    if (!sky) return;
    const cam = camera();
    const lines = [
      `${pad(date.getHours())}:${pad(date.getMinutes())} · ${sky.phase} · 太阳高度 ${Math.round(sky.alt)}°${state.timeOverride == null ? '' : '（模拟）'}`,
      `季节：${SEASON_ZH[season]}${state.seasonMode === 'auto' ? '（跟随真实月份）' : '（手动）'}`,
      `天气：${SDV.weather.label(weather)}（${weather.source}）`,
      `动物：${SDV.animals.summary()}`,
      ...(SDV.decor.summary(date, season) ? [`作物：${SDV.decor.summary(date, season)}`] : []),
      (() => {
        const r = frameRect();  // what the desktop shows
        return `桌面构图：放大 ${r.scale}× · 一屏约 ${Math.round(r.w / TILE)}×${Math.round(r.h / TILE)} 格`;
      })(),
    ];
    if (state.hoverTile) lines.push(`光标所在格：(${state.hoverTile.x}, ${state.hoverTile.y})`);
    if (state.note && performance.now() < state.note.until) lines.push(state.note.text);
    if (state.mail) lines.push(`信箱：${state.mail} 个新文件（鼠标在信箱上停一秒算已读）`);
    const left = SDV.focus.remaining();
    if (left != null) lines.push(`专注中：还剩 ${left} 分钟`);
    const T = SDV.focus.tally();
    if (T.n) lines.push(`今天专注收获：${T.n} 次`);
    const v = SDV.villagers.current();
    if (v) lines.push(`${v.name}${v.what}`);
    if (state.editLayout) lines.push(state.moving && state.moving.problem
      ? `放不下：${state.moving.problem}`
      : state.tool ? `画${{ path: '石板路', fence: '围栏', lamp: '路灯', erase: '：橡皮擦' }[state.tool]}：在地图上点或拖；再点一次按钮回到拖动模式`
        : '布置中：建筑、田、树、稻草人、木牌、箱子、信箱、公告板都能拖；点田角上的 × 删掉这块田；红框表示放不下');
    else if (state.view === 'full') lines.push('在地图上拖出一个框，设为新的构图');
    lines.push(EDITOR ? '这里的改动会同步到桌面 · G 网格 · 1–4 季节' : 'H 隐藏面板 · G 网格 · 1–4 季节');
    info.textContent = lines.join('\n');
  }

  // ---------- input ----------
  function toMap(e) {
    const cam = camera();
    return { x: cam.x + (e.clientX * dpr) / cam.scale, y: cam.y + (e.clientY * dpr) / cam.scale };
  }
  canvas.addEventListener('mousemove', e => {
    const p = toMap(e);
    state.hoverTile = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
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
        const h = state.hover, f = h && h.type === 'field' && SDV.decor.fieldRects().find(x => x.index === h.index);
        onBadge = Boolean(f && inBox(p, deleteBadge(f)));
        if (!onBadge) state.hover = pickAt(p);
      }
      canvas.style.cursor = state.moving ? 'grabbing' : onBadge ? 'pointer' : state.hover ? 'grab' : 'default';
      return;
    }
    if (state.drag) state.drag.b = p;
    state.cursor = p;
    if (state.view === 'frame') SDV.interact.setCursor(p, performance.now() / 1000);
  });
  canvas.addEventListener('mouseleave', () => { state.hoverTile = null; state.cursor = null; SDV.interact.setCursor(null); });
  canvas.addEventListener('mousedown', e => {
    if (!state.editLayout && SDV.board.click(e.clientX * dpr, e.clientY * dpr)) return;   // a to-do on the open notice
    const p = toMap(e);
    if (state.editLayout) {
      const h = state.hover;
      if (state.tool) { startPaint(p); return; }
      if (h && h.type === 'field' && h.index !== 'focus') {
        const f = SDV.decor.fieldRects().find(x => x.index === h.index);
        if (f && inBox(p, deleteBadge(f))) { deleteField(h.index); return; }
      }
      const item = pickAt(p);
      if (item) state.moving = { ...item, start: p, before: JSON.parse(JSON.stringify(state.layout)), problem: null };
      return;
    }
    if (state.view !== 'full') return;
    state.drag = { a: p, b: p };
  });
  window.addEventListener('mouseup', () => {
    if (state.painting) { endPaint(); return; }
    if (state.moving) { dropItem(); return; }
    if (!state.drag) return;
    const r = dragRect();
    state.drag = null;
    setFrame({ cx: Math.round(r.x + r.w / 2), cy: Math.round(r.y + r.h / 2), cols: Math.max(8, Math.round(r.w / TILE)) });
    notify('frame', { cx: state.frame.cx, cy: state.frame.cy, cols: state.cols });
    setView('frame');
  });

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
    state.frame = { cx: f.cx, cy: f.cy };
    state.cols = f.cols || state.cols;
    store.set('frame', state.frame);
    store.set('cols', state.cols);
  }
  // ---------- moving buildings, fields and trees ----------
  // What's under the cursor in layout mode: the front-most building or tree, else a field.
  function pickAt(p) {
    const hits = [];
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
  const footprints = () => SDV.layout.names.map(n => ({ n, ...SDV.layout.footprint(n, state.layout) }));

  function fieldProblem(index) {
    const r = SDV.decor.fieldRects().find(f => f.index === index);
    return r ? rectProblem(r, index) : null;
  }
  // Can a field stand on rectangle r? (index: the field itself, ignored in the checks)
  function rectProblem(r, index) {
    if (!SDV.layout.inMap(r.x, r.y) || !SDV.layout.inMap(r.x + r.w - 1, r.y + r.h - 1)) return '超出农场范围';
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (SDV.layout.isSolid(x, y)) return '这里有水或障碍';
    for (const f of footprints()) if (rectsOverlap(r, f)) return `和${SDV.layout.label(f.n)}重叠`;
    for (const f of SDV.decor.fieldRects()) if (f.index !== index && rectsOverlap(r, f)) return '和别的作物田重叠';
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (SDV.decor.objectAt(x, y, index)) return '压到了小物件';
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
        if (Object.values(CONFIG.props).some(pr => rectsOverlap(px, { x: pr.x - TILE, y: pr.y - TILE, w: pr.src[2] + 2 * TILE, h: pr.src[3] + 2 * TILE }))) continue;
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
    if (!SDV.layout.inMap(x, y)) return '超出农场范围';
    if (SDV.layout.isSolid(x, y)) return '这里有水或障碍';
    for (const f of footprints()) if (rectsOverlap({ x, y, w: 1, h: 1 }, f)) return `和${SDV.layout.label(f.n)}重叠`;
    for (const f of SDV.decor.fieldRects()) if (rectsOverlap({ x, y, w: 1, h: 1 }, { x: f.x - 1, y: f.y - 1, w: f.w + 2, h: f.h + 2 })) return '离作物田太近';
    if (SDV.decor.takenFor(m.id, x, y)) return '这里已经有东西了';
    return null;
  }

  // Small objects (scarecrow, sign, keg, chest…): anywhere on open ground, fields included.
  function objectProblem(m, x, y) {
    if (!SDV.layout.inMap(x, y)) return '超出农场范围';
    if (SDV.layout.isSolid(x, y)) return '这里有水或障碍';
    for (const f of footprints()) if (rectsOverlap({ x, y, w: 1, h: 1 }, f)) return `和${SDV.layout.label(f.n)}重叠`;
    for (const n of SDV.layout.small) if (rectsOverlap({ x, y, w: 1, h: 1 }, SDV.layout.propFootprint(CONFIG, n))) return `和${SDV.layout.label(n)}重叠`;
    if (SDV.decor.takenFor(null, x, y) && !(m.cur[0] === x && m.cur[1] === y)) return '这里已经有东西了';
    // as in the game, the only thing worth standing among the crops is a scarecrow
    const inField = SDV.decor.fieldRects().some(f => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
    if (inField && m.kind !== 'scarecrow') return '作物田里只放稻草人（洒水器会自动布好）';
    return null;
  }
  // The mailbox and shipping bin: open ground, not on a field.
  function propProblem(name) {
    const f = SDV.layout.propFootprint(CONFIG, name);
    if (!SDV.layout.inMap(f.x, f.y) || !SDV.layout.inMap(f.x + f.w - 1, f.y)) return '超出农场范围';
    for (let x = f.x; x < f.x + f.w; x++) if (SDV.layout.isSolid(x, f.y)) return '这里有水或障碍';
    for (const b of footprints()) if (rectsOverlap(f, b)) return `和${SDV.layout.label(b.n)}重叠`;
    for (const n of SDV.layout.small) if (n !== name && rectsOverlap(f, SDV.layout.propFootprint(CONFIG, n))) return `和${SDV.layout.label(n)}重叠`;
    for (const fd of SDV.decor.fieldRects()) if (rectsOverlap(f, fd)) return '压到了作物田';
    for (let x = f.x; x < f.x + f.w; x++) if (SDV.decor.takenFor(null, x, f.y)) return '这里已经有东西了';
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
    if (why) { if (tool !== 'erase') flash(`放不下：${why}`); return; }
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

  function syncDecorMoves() {
    const L = state.layout;
    CONFIG.decorMoves = { fields: L.fields || {}, trees: L.trees || {}, objects: L.objects || {}, removed: L.fieldsRemoved || [], added: L.fieldsAdded || [], focus: L.focusPlot || null };
  }
  function setLayout(offsets) {
    state.layout = offsets || {};
    store.set('layout', state.layout);
    SDV.layout.apply(CONFIG, state.layout);
    syncDecorMoves();
    rebuildWorld();
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
    const grass = (BASE_GRASS || []).filter(([x, y]) => !SDV.decor.isBlocked(x, y));
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
    pressed('[data-view]', b => b.dataset.view === state.view);
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
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
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
    flash('路、围栏和路灯恢复成自动：跟着建筑走');
  });
  document.getElementById('field-add').addEventListener('click', () => {
    if (!state.editLayout) setEditLayout(true);
    if (!addField()) flash('附近没有空地放新的田了，先挪开一些东西再试');
  });
  // One button per pet, showing its sitting sprite.
  function buildPetButtons() {
    const row = document.getElementById('pets');
    if (!row || row.childElementCount) return;
    for (const [id, name] of SDV.interact.PETS.concat([['none', '不养']])) {
      const b = document.createElement('button');
      b.dataset.pet = id; b.title = name; b.className = 'pet';
      const img = images['pet_' + id];
      if (img) {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const f = id.startsWith('dog') ? 24 : 17;
        c.getContext('2d').drawImage(img, (f % 4) * 32, Math.floor(f / 4) * 32, 32, 32, 0, 0, 32, 32);
        b.appendChild(c);
      } else b.textContent = name;
      b.addEventListener('click', () => { setPet(id); notify('pet', id); });
      row.appendChild(b);
    }
    syncButtons();
  }
  document.getElementById('layout-reset').addEventListener('click', () => { setLayout({}); notify('layout', {}); });
  // Tabs: 场景 / 布置 / 公告板 (the panel was getting long). Leaving 布置 ends layout mode.
  function setTab(t) {
    if (!document.querySelector(`[data-pane="${t}"]`)) t = 'scene';
    document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('on', p.dataset.pane === t));
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === t)));
    if (t !== 'layout' && state.editLayout) setEditLayout(false);
    info.style.display = t === 'board' ? 'none' : '';
    store.set('tab', t);
  }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  setTab(store.get('tab', 'scene'));
  window.addEventListener('keydown', e => {
    if (e.target === timeRange || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'h' || e.key === 'H') document.getElementById('panel').classList.toggle('hidden');
    else if (e.key === 'g' || e.key === 'G') { state.grid = !state.grid; syncButtons(); }
    else if ('1234'.includes(e.key)) { setSeason(SEASONS[Number(e.key) - 1]); notify('season', SEASONS[Number(e.key) - 1]); }
    else if (e.key === '0') { setSeason('auto'); notify('season', 'auto'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.editLayout && !state.moving && state.hover && state.hover.type === 'field') deleteField(state.hover.index);
  });
  window.addEventListener('resize', resize);

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
      text: `${pad(date.getHours())}:${pad(date.getMinutes())} ${sky.phase} · ${SEASON_ZH[season]} · ${SDV.weather.label(weather)}`,
      detail: `天气来源：${weather.source} · 动物 ${SDV.animals.summary()}`,
    });
  }
  SDV.host = {
    cursor(x, y, covered) {
      if (x == null) { state.hoverTile = null; state.cursor = null; SDV.interact.setCursor(null); return; }
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
      postStatus();
    },
    mail(n) { state.mail = Math.max(0, Number(n) || 0); },
    focus(f) { SDV.focus.set(f); },
    visit(id) { return SDV.villagers.visit(id); },
    setTarget(w, h) { state.target = w && h ? { w, h } : null; },
    click(x, y) { SDV.board.click(x * dpr, y * dpr); },
    openBoard() { document.getElementById('panel').classList.remove('hidden'); setTab('board'); SDV.board.openPanel(true); },
  };

  resize();
  setView(DESKTOP || SAVER ? 'frame' : state.view);
  syncButtons();
  if (DESKTOP || SAVER) document.getElementById('panel').classList.add('hidden');   // the desktop scene shows no panel
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
    SDV.interact.init({ ...CONFIG, grass: BASE_GRASS.filter(([x, y]) => !SDV.decor.isBlocked(x, y)) }, map, TILE,
      { grass: SDV.decor.grassSpots(), canopy: SDV.decor.canopyTiles() });
    startLoop();
    post({ type: 'hello', lat: CONFIG.location.lat, lon: CONFIG.location.lon, refreshMinutes: CONFIG.weather.refreshMinutes });
  });
})();
