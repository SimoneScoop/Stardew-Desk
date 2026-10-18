/* Farm dressing: crop fields that grow day by day, trees, weeds, stones,
 * branches, grass and a few craftables (scarecrows, bee houses, kegs…).
 * Trees, grass and debris come from the map's own "Paths" layer — the spots
 * where a new game scatters them — so the farm looks the way the game does.
 * Everything is deterministic (seeded), so it looks the same every launch. */
window.SDV = window.SDV || {};
SDV.decor = (() => {
  'use strict';

  let TILE = 16, cfg = null;
  let trees = [], debris = [], fields = [], objects = [], grass = [];
  const blocked = new Set();          // tiles taken by buildings, fields, props
  const occupied = new Set();         // field tiles holding a sprinkler or scarecrow
  const key = (x, y) => y * 1000 + x;

  // mulberry32 — small seeded RNG
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const inRect = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  // Crops, straight from the game's Data/Crops: sprite row in TileSheets/crops (two
  // crops per 256 px row, 8 frames of 16×32 each), days in each growth phase, days to
  // regrow after a harvest (-1: harvested once, then replanted) and growing seasons.
  // Frames: 0/1 seed, phase n → frame n + 1, ripe → phases + 1; a regrowing crop shows
  // frame 6 when ripe and 7 while it regrows.
  const CROPS = {
    parsnip:     { row: 0,  days: [1, 1, 1, 1],    regrow: -1, seasons: ['spring'] },
    cauliflower: { row: 2,  days: [1, 2, 4, 4, 1], regrow: -1, seasons: ['spring'] },
    potato:      { row: 3,  days: [1, 1, 1, 2, 1], regrow: -1, seasons: ['spring'] },
    kale:        { row: 5,  days: [1, 2, 2, 1],    regrow: -1, seasons: ['spring'] },
    melon:       { row: 7,  days: [1, 2, 3, 3, 3], regrow: -1, seasons: ['summer'] },
    tomato:      { row: 8,  days: [2, 2, 2, 2, 3], regrow: 4,  seasons: ['summer'] },
    blueberry:   { row: 9,  days: [1, 3, 3, 4, 2], regrow: 4,  seasons: ['summer'] },
    corn:        { row: 15, days: [2, 3, 3, 3, 3], regrow: 4,  seasons: ['summer', 'fall'] },
    eggplant:    { row: 16, days: [1, 1, 1, 1, 1], regrow: 5,  seasons: ['fall'] },
    pumpkin:     { row: 18, days: [1, 2, 3, 4, 3], regrow: -1, seasons: ['fall'] },
    cranberry:   { row: 21, days: [1, 2, 1, 1, 2], regrow: 5,  seasons: ['fall'] },
    powdermelon: { row: 51, days: [1, 1, 1, 2, 2], regrow: -1, seasons: ['winter'] },
  };
  for (const c of Object.values(CROPS)) c.total = c.days.reduce((a, b) => a + b, 0);
  const RIPE_DAYS = 2;     // a ripe crop waits this long for the farmer to harvest it
  const CROP_ZH = {
    parsnip: '防风草', cauliflower: '花椰菜', potato: '土豆', kale: '甘蓝', melon: '甜瓜', tomato: '番茄',
    blueberry: '蓝莓', corn: '玉米', eggplant: '茄子', pumpkin: '南瓜', cranberry: '蔓越莓',
  };
  // Map/springobjects indices.
  const DEBRIS = {
    weeds: { spring: [674, 675], summer: [676, 677], fall: [678, 679], winter: [313, 314] },
    stone: [343, 450], twig: [294, 295],
  };
  // TileSheets/Craftables indices (16×32 each, 8 per row).
  const CRAFT = { scarecrow: 8, beehouse: 10, keg: 12, jar: 15, sign: 37, chest: 130 };
  // Sprinklers (Maps/springobjects): quality waters the 8 tiles around it, iridium the 24.
  const SPRINKLERS = { sprinkler: { r: 0, idx: 599 }, quality: { r: 1, idx: 621 }, iridium: { r: 2, idx: 645 } };
  const SCARECROW_RADIUS = 9;   // a scarecrow keeps crows off crops closer than this (tiles)

  function init(config, map, tile) {
    cfg = config; TILE = tile;
    // start clean: init runs again whenever something is moved
    trees = []; debris = []; grass = []; blocked.clear(); occupied.clear();
    const d = config.decor || {};
    // {fields: {i: [dx, dy]}, trees: {id: [x, y]}, removed: [i], added: [{x, y, w, h, kind}]}
    const moves = config.decorMoves || {};
    const fieldMoves = moves.fields || {}, treeMoves = moves.trees || {}, objectMoves = moves.objects || {};
    const removed = new Set((moves.removed || []).map(Number));
    const cleared = d.clearedZone || { x: 0, y: 0, w: 0, h: 0 };
    // one small RNG per spot, so moving something never reshuffles the rest of the farm
    const spotRand = (x, y, salt) => rng(((d.seed || 7) * 2654435761 + key(x, y) * 40503 + (salt || 0)) >>> 0);

    // tiles already used by buildings and props
    for (const p of Object.values(config.props)) {
      const [, , sw, sh] = p.src;
      const x0 = Math.floor(p.x / TILE), x1 = Math.ceil((p.x + sw) / TILE);
      const y0 = Math.floor((p.y + sh) / TILE) - Math.max(1, Math.round(sh / TILE / 2)), y1 = Math.ceil((p.y + sh) / TILE);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) blocked.add(key(x, y));
    }
    const underBuilding = new Set(blocked);

    // fields, moved by their offsets; sprinklers inside and scarecrows / signs right
    // next to a field belong to it and move with it
    const baseFields = d.fields || [];
    const owner = o => baseFields.findIndex(f => o.x >= f.x - 2 && o.x <= f.x + f.w + 1 && o.y >= f.y - 2 && o.y <= f.y + f.h + 1);
    fields = baseFields.map((f, i) => {
      const m = fieldMoves[i] || [0, 0];
      return { ...f, index: i, x: f.x + m[0], y: f.y + m[1] };
    }).filter(f => !removed.has(f.index));
    // fields the user added borrow the crops of one of the default fields
    (moves.added || []).forEach((a, k) => {
      const like = baseFields[(a.kind ?? k) % Math.max(1, baseFields.length)] || {};
      fields.push({ x: a.x, y: a.y, w: a.w, h: a.h, crops: like.crops, offset: (k * 4 + 2) % 14, index: `a${k}` });
    });
    for (const f of fields) for (let y = f.y - 1; y <= f.y + f.h; y++) for (let x = f.x - 1; x <= f.x + f.w; x++) blocked.add(key(x, y));
    // (sprinklers in config are placeholders kept so the other objects keep their numbers;
    // the real ones are worked out per field below)
    objects = (d.objects || []).map((o, id) => {
      // an object the user dragged stays where they put it, whatever its field does
      if (objectMoves[id]) return { ...o, id, owner: -1, x: objectMoves[id][0], y: objectMoves[id][1] };
      const i = owner(o), m = i >= 0 ? (fieldMoves[i] || [0, 0]) : [0, 0];
      return { ...o, id, owner: i, x: o.x + m[0], y: o.y + m[1], gone: i >= 0 && removed.has(i) };
    }).filter(o => o.type !== 'sprinkler' && !o.gone && !underBuilding.has(key(o.x, o.y)));   // a deleted field takes its scarecrow along; objects under a building are hidden
    for (const o of objects) { blocked.add(key(o.x, o.y)); occupied.add(key(o.x, o.y)); }
    placeFocusPlot(config, moves.focus, underBuilding, map);
    waterAndGuardFields(underBuilding, map);

    const buildingsLayer = map.layers.find(l => l.id === 'Buildings');
    const solid = (x, y) => Boolean(buildingsLayer && buildingsLayer.tiles[y] && buildingsLayer.tiles[y][x]);
    const placeTree = (id, x, y, kind, flip) => {
      if (blocked.has(key(x, y)) || solid(x, y)) return false;
      trees.push({ id, x, y, kind, flip });
      blocked.add(key(x, y));
      return true;
    };
    // a moved tree whose new spot got taken (say a building moved onto it) goes back home
    const movedOk = new Set();

    // trees the user moved go first, so they keep their spot
    const paths = map.layers.find(l => l.id === 'Paths');
    const markers = [];
    if (paths) paths.tiles.forEach((row, y) => row.forEach((t, x) => { if (t && !t.a) markers.push({ x, y, i: t.i }); }));
    const TREE = { 9: 1, 10: 2, 11: 3 };
    const extra = (d.extraTrees || []).map((t, i) => ({ id: `e${i}`, x: t[0], y: t[1], kind: t[2] || 1 }));
    for (const m of markers) {
      const id = `m${m.x},${m.y}`;
      if (TREE[m.i] && treeMoves[id] && placeTree(id, treeMoves[id][0], treeMoves[id][1], TREE[m.i], spotRand(m.x, m.y, 1)() < 0.5)) movedOk.add(id);
    }
    for (const t of extra) if (treeMoves[t.id] && placeTree(t.id, treeMoves[t.id][0], treeMoves[t.id][1], t.kind, spotRand(t.x, t.y, 1)() < 0.5)) movedOk.add(t.id);

    // everything else from the map's spawn markers
    for (const m of markers) {
      const r = spotRand(m.x, m.y);
      const roll = r();
      const id = `m${m.x},${m.y}`;
      if (TREE[m.i]) {
        if (movedOk.has(id)) continue;
        if (!inRect(m.x, m.y, cleared) && roll < (d.treeDensity ?? 1)) placeTree(id, m.x, m.y, TREE[m.i], spotRand(m.x, m.y, 1)() < 0.5);
        continue;
      }
      if (blocked.has(key(m.x, m.y)) || solid(m.x, m.y)) continue;
      const inYard = inRect(m.x, m.y, cleared);
      if (m.i === 22) {
        // jitter a little so tufts don't line up on the tile grid
        if (roll < (inYard ? d.yardGrass ?? 0.35 : d.wildGrass ?? 0.85)) grass.push([m.x, m.y, Math.floor(r() * 3), Math.round(r() * 8 - 4), Math.round(r() * 6 - 3)]);
      } else if (m.i === 13 || m.i === 14 || m.i === 15) {
        if (!inYard && roll < (d.debrisDensity ?? 0.45)) {
          debris.push({ x: m.x, y: m.y, kind: m.i === 13 ? 'weeds' : m.i === 14 ? 'stone' : 'twig', v: Math.floor(r() * 2) });
          blocked.add(key(m.x, m.y));
        }
      }
    }
    for (const t of extra) if (!movedOk.has(t.id)) placeTree(t.id, t.x, t.y, t.kind, spotRand(t.x, t.y, 1)() < 0.5);
  }

  // ---------- the focus plot ----------
  // A 3×3 bed for the focus timer (a quality sprinkler in the middle, eight crops round
  // it). It sits where the user dragged it, or on the nearest free spot to the shipping bin.
  function placeFocusPlot(config, at, underBuilding, map) {
    const buildingsLayer = map.layers.find(l => l.id === 'Buildings');
    const solid = (x, y) => Boolean(buildingsLayer && buildingsLayer.tiles[y] && buildingsLayer.tiles[y][x]);
    const W = map.layers[0].w, H = map.layers[0].h;
    const sprite = (x, y) => Object.values(config.props).some(p => x * TILE + 16 > p.x && x * TILE < p.x + p.src[2] && y * TILE + 16 > p.y && y * TILE < p.y + p.src[3]);
    const pen = (x, y) => Object.values(config.pens || {}).some(p => x * TILE + 16 > p.x && x * TILE < p.x + p.w && y * TILE + 16 > p.y && y * TILE < p.y + p.h);
    let spot = at;
    if (!spot) {
      const bin = config.props.bin, cx = Math.floor((bin ? bin.x : 64 * TILE) / TILE), cy = Math.floor((bin ? bin.y + 32 : 18 * TILE) / TILE) + 2;
      const fits = (x0, y0) => {
        for (let y = y0 - 1; y <= y0 + 3; y++) for (let x = x0 - 1; x <= x0 + 3; x++) {
          if (x < 1 || y < 2 || x >= W - 1 || y >= H - 1 || blocked.has(key(x, y)) || solid(x, y) || underBuilding.has(key(x, y)) || sprite(x, y) || pen(x, y)) return false;
        }
        return true;
      };
      search: for (let r = 0; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (fits(cx + dx - 1, cy + dy - 1)) { spot = [cx + dx - 1, cy + dy - 1]; break search; }
      }
    }
    if (!spot) return;
    const f = { x: spot[0], y: spot[1], w: 3, h: 3, index: 'focus', focus: true };
    fields.push(f);
    for (let y = f.y - 1; y <= f.y + f.h; y++) for (let x = f.x - 1; x <= f.x + f.w; x++) blocked.add(key(x, y));
  }

  // Paths, fences and lamp-posts claim their tiles: trees, weeds and grass make way.
  function clearTiles(list) {
    const ks = new Set(list.map(([x, y]) => key(x, y)));
    trees = trees.filter(t => !ks.has(key(t.x, t.y)));
    debris = debris.filter(d => !ks.has(key(d.x, d.y)));
    grass = grass.filter(g => !ks.has(key(g[0], g[1])));
    for (const k of ks) blocked.add(k);
  }

  // ---------- sprinklers and scarecrows ----------
  // Spread n = ceil(L / (2r + 1)) sprinklers evenly along a side of length L so every
  // tile is within r of one; fall back to packing from the start if rounding leaves a gap.
  function centers(L, r) {
    const span = 2 * r + 1, k = Math.max(1, Math.ceil(L / span));
    let c = [];
    for (let i = 0; i < k; i++) c.push(Math.min(L - 1, Math.max(0, Math.round((i + 0.5) * L / k - 0.5))));
    const ok = cs => [...Array(L).keys()].every(t => cs.some(x => Math.abs(t - x) <= r));
    if (!ok(c)) { c = []; for (let x = r; ; x += span) { c.push(Math.min(x, L - 1)); if (x + r >= L - 1) break; } }
    return c;
  }
  // As in the game: every crop tile gets watered each morning. Pick the sprinkler that
  // needs the fewest pieces (quality on a tie), then make sure a scarecrow reaches every
  // crop; fields nobody guards get one of their own next to them.
  function waterAndGuardFields(underBuilding, map) {
    const buildingsLayer = map.layers.find(l => l.id === 'Buildings');
    const solid = (x, y) => Boolean(buildingsLayer && buildingsLayer.tiles[y] && buildingsLayer.tiles[y][x]);
    const free = (x, y) => !occupied.has(key(x, y)) && !underBuilding.has(key(x, y)) && !solid(x, y);
    for (const f of fields) {
      let best = null;
      for (const type of ['quality', 'iridium']) {
        const r = SPRINKLERS[type].r, xs = centers(f.w, r), ys = centers(f.h, r);
        if (!best || xs.length * ys.length < best.xs.length * best.ys.length) best = { type, xs, ys };
      }
      let k = 0;
      for (const cy of best.ys) for (const cx of best.xs) {
        // a scarecrow the user put on that very tile: use the nearest free tile instead
        const spots = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [f.x + cx + a, f.y + cy + b])
          .filter(([x, y]) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h && free(x, y));
        if (!spots.length) continue;
        const [x, y] = spots[0];
        objects.push({ type: best.type, x, y, id: `s${f.index}-${k++}`, owner: f.index, auto: true });
        occupied.add(key(x, y)); blocked.add(key(x, y));
      }
      f.watered = true;
    }
    const crows = () => objects.filter(o => o.type === 'scarecrow');
    for (const f of fields) {
      const guarded = (x, y) => crows().some(s => Math.hypot(s.x - x, s.y - y) < SCARECROW_RADIUS);
      let all = true;
      for (let y = f.y; y < f.y + f.h && all; y++) for (let x = f.x; x < f.x + f.w; x++) if (!occupied.has(key(x, y)) && !guarded(x, y)) { all = false; break; }
      if (all) continue;
      const mx = f.x + Math.floor(f.w / 2), my = f.y + Math.floor(f.h / 2);
      const spot = [[f.x + f.w, my], [f.x - 1, my], [mx, f.y + f.h], [mx, f.y - 1]].find(([x, y]) => free(x, y));
      if (!spot) continue;
      objects.push({ type: 'scarecrow', x: spot[0], y: spot[1], id: `c${f.index}`, owner: f.index, auto: true });
      occupied.add(key(spot[0], spot[1])); blocked.add(key(spot[0], spot[1]));
    }
  }

  // ---------- for the layout editor ----------
  // Front-most tree whose canopy covers a map-px point.
  function treeAt(px, py) {
    let best = null;
    for (const t of trees) {
      const x0 = t.x * TILE - 16, y0 = t.y * TILE - 80;
      if (px >= x0 && px < x0 + 48 && py >= y0 && py < y0 + 96 && (!best || t.y > best.y)) best = t;
    }
    return best;
  }
  function fieldAt(px, py) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    return fields.find(f => inRect(tx, ty, f)) || null;
  }
  // Is (x, y) taken by another tree or a small object? (debris and grass make way)
  const takenFor = (id, x, y) => trees.some(t => t.id !== id && t.x === x && t.y === y) || objects.some(o => o.x === x && o.y === y);
  // A small object (keg, beehouse, scarecrow…) on (x, y) that doesn't belong to field `except`.
  const objectAt = (x, y, except) => objects.some(o => o.x === x && o.y === y && o.owner !== except);
  // Front-most small object whose sprite covers a map-px point.
  function objectHit(px, py) {
    let best = null;
    for (const o of objects) {
      if (o.auto) continue;            // sprinklers and helper scarecrows follow their field
      const tall = !SPRINKLERS[o.type];
      const x0 = o.x * TILE, y0 = (o.y - (tall ? 1 : 0)) * TILE, h = tall ? 32 : 16;
      if (px >= x0 && px < x0 + 16 && py >= y0 && py < y0 + h && (!best || o.y > best.y)) best = o;
    }
    return best;
  }
  const OBJ_ZH = { scarecrow: '稻草人', sprinkler: '洒水器', quality: '优质洒水器', iridium: '铱制洒水器', sign: '木牌', beehouse: '蜂房', keg: '小桶', jar: '罐头瓶', chest: '箱子' };
  const objectName = t => OBJ_ZH[t] || '物件';
  const treeList = () => trees.map(t => ({ id: t.id, x: t.x, y: t.y }));

  // Tile keys covered by tree canopies, so the cursor can shake leaves loose.
  function canopyTiles() {
    const out = [];
    for (const t of trees) for (let y = t.y - 5; y <= t.y - 1; y++) for (let x = t.x - 1; x <= t.x + 1; x++) out.push(key(x, y));
    return out;
  }
  function grassSpots() { return grass; }

  // ---------- crops ----------
  // Seasons follow the real calendar (Mar–May spring …), so a field is sown on the first
  // day of its season plus its offset, and a crop that carries on into the next season
  // (corn, summer → fall) keeps growing instead of being replanted.
  const DAY = 86400000;
  const dayNo = d => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY);
  const SEASON_START = { spring: 2, summer: 5, fall: 8, winter: 11 };
  const ORDER = ['spring', 'summer', 'fall', 'winter'];
  function seasonStart(date, season) {
    let y = date.getFullYear();
    if (season === 'winter' && date.getMonth() < 2) y -= 1;
    return dayNo(new Date(y, SEASON_START[season], 1));
  }
  // {frame, phase, ripe, regrowing, sown} for a field's crop on a date, or null before it's sown.
  function cropState(f, name, date, season) {
    const crop = CROPS[name];
    let start = seasonStart(date, season), s = season;
    for (let n = 0; n < 3; n++) {      // walk back while the same crop was growing the season before
      const prev = ORDER[(ORDER.indexOf(s) + 3) % 4];
      if (!(f.crops && f.crops[prev] === name && crop.seasons.includes(prev))) break;
      start -= 91; s = prev;
    }
    const k = dayNo(date) - (start + (f.offset || 0));
    if (k < 0) return null;
    const grow = d => {                // day d of growing → phase
      let acc = 0;
      for (let i = 0; i < crop.days.length; i++) { acc += crop.days[i]; if (d < acc) return i; }
      return crop.days.length;
    };
    if (crop.regrow < 0) {
      const d = k % (crop.total + RIPE_DAYS);    // harvested when ripe a while, replanted the same day
      const phase = grow(d);
      return { phase, ripe: phase >= crop.days.length, regrowing: false };
    }
    if (k < crop.total) return { phase: grow(k), ripe: false, regrowing: false };
    const j = (k - crop.total) % (RIPE_DAYS + crop.regrow);
    return { phase: crop.days.length, ripe: j < RIPE_DAYS, regrowing: j >= RIPE_DAYS };
  }
  function cropFrame(st, crop, x, y) {
    if (st.regrowing) return 7;
    if (st.ripe) return crop.regrow < 0 ? crop.days.length + 1 : 6;
    if (st.phase === 0) return (x + y) % 2;     // seeds: two variants, like the game
    return st.phase + 1;
  }
  const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

  // ---------- drawing ----------
  // Tilled soil, in the ground pass (under everything that stands).
  // Sprinklers water every morning, so sprinkled soil stays dark all day; rain waters
  // everything. In winter sprinklers stay off and the soil is snowed over.
  function drawGround(ctx, images, season, rain) {
    const img = season === 'winter' ? images.hoedirt_snow : images.hoedirt;
    if (!img) return;
    for (const f of fields) {
      const ox = season !== 'winter' && (rain || f.watered) ? 64 : 0;  // watered soil is the second block
      for (let y = f.y; y < f.y + f.h; y++) {
        for (let x = f.x; x < f.x + f.w; x++) {
          const N = y > f.y, S = y < f.y + f.h - 1, W = x > f.x, E = x < f.x + f.w - 1;
          let c, r;
          if (!W && !E && !N && !S) { c = 0; r = 0; }
          else if (!W && !E) { c = 0; r = N && S ? 2 : N ? 3 : 1; }
          else if (!N && !S) { r = 3; c = W && E ? 2 : W ? 3 : 1; }
          else { c = W ? (E ? 2 : 3) : 1; r = N ? (S ? 1 : 2) : 0; }
          ctx.drawImage(img, ox + c * 16, r * 16, 16, 16, x * TILE, y * TILE, 16, 16);
        }
      }
    }
  }

  // Standing things for the y-sorted pass. view = {x0,y0,x1,y1} in tiles, for culling.
  function sprites(images, season, date, view) {
    const out = [];
    const vis = (x, y, pad) => x >= view.x0 - pad && x <= view.x1 + pad && y >= view.y0 - pad && y <= view.y1 + pad + 6;

    // crops
    const crops = images.crops;
    if (crops) {
      for (const f of fields) {
        let name, crop, st;
        if (f.focus) {
          // the focus plot grows on the timer, in any season (powdermelon in winter)
          st = SDV.focus && SDV.focus.state(season);
          if (!st) continue;
          name = st.name; crop = CROPS[name];
          if (!crop) continue;
        } else {
          if (season === 'winter') continue;
          name = f.crops && f.crops[season];
          crop = CROPS[name];
          if (!crop || !crop.seasons.includes(season)) continue;
          st = cropState(f, name, date, season);
          if (!st) continue;                        // not sown yet this season
        }
        for (let y = f.y; y < f.y + f.h; y++) {
          for (let x = f.x; x < f.x + f.w; x++) {
            if (!vis(x, y, 1) || occupied.has(key(x, y))) continue;
            const frame = cropFrame(st, crop, x, y);
            const sx = (crop.row % 2) * 128 + frame * 16, sy = Math.floor(crop.row / 2) * 32;
            const flip = hash(x, y) & 1;
            const dx = x * TILE, dy = y * TILE - 16;
            out.push({ y: (y + 1) * TILE - 2, draw(g) { drawMaybeFlipped(g, crops, sx, sy, 16, 32, dx, dy, flip); } });
          }
        }
      }
    }

    // trees: stump + canopy
    for (const t of trees) {
      if (!vis(t.x, t.y, 2)) continue;
      const img = images[`tree${t.kind}_${season}`];
      if (!img) continue;
      const bx = t.x * TILE, by = t.y * TILE;
      out.push({
        y: by + TILE - 1,
        draw(g) {
          g.drawImage(img, 32, 96, 16, 32, bx, by - 16, 16, 32);                 // stump
          drawMaybeFlipped(g, img, 0, 0, 48, 96, bx - 16, by - 80, t.flip);       // canopy
        },
      });
    }

    // weeds, stones, branches
    const so = images.springobjects;
    if (so) {
      for (const d of debris) {
        if (!vis(d.x, d.y, 1)) continue;
        if (d.kind === 'weeds' && season === 'winter' && d.v) continue;   // thinner in winter
        const list = d.kind === 'weeds' ? DEBRIS.weeds[season] : DEBRIS[d.kind];
        const n = list[d.v % list.length];
        const dx = d.x * TILE, dy = d.y * TILE;
        out.push({ y: dy + TILE - 1, draw(g) { g.drawImage(so, (n % 24) * 16, Math.floor(n / 24) * 16, 16, 16, dx, dy, 16, 16); } });
      }
    }

    // craftables and sprinklers
    const cr = images.craftables;
    for (const o of objects) {
      if (!vis(o.x, o.y, 1)) continue;
      const dx = o.x * TILE, dy = o.y * TILE;
      if (SPRINKLERS[o.type]) {
        if (!so) continue;
        const n = SPRINKLERS[o.type].idx;
        out.push({ y: dy + 4, draw(g) { g.drawImage(so, (n % 24) * 16, Math.floor(n / 24) * 16, 16, 16, dx, dy, 16, 16); } });
      } else if (cr && CRAFT[o.type] != null) {
        const n = CRAFT[o.type];
        out.push({ y: dy + TILE - 1, draw(g) { g.drawImage(cr, (n % 8) * 16, Math.floor(n / 8) * 32, 16, 32, dx, dy - 16, 16, 32); } });
      }
    }
    return out;
  }

  function drawMaybeFlipped(g, img, sx, sy, sw, sh, dx, dy, flip) {
    if (!flip) { g.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh); return; }
    g.save();
    g.translate(dx + sw, dy);
    g.scale(-1, 1);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    g.restore();
  }

  function summary(date, season) {
    const parts = [];
    for (const f of fields) {
      if (f.focus) continue;
      const name = f.crops && f.crops[season];
      const crop = CROPS[name];
      if (!crop || !crop.seasons.includes(season)) continue;
      const st = cropState(f, name, date, season);
      parts.push(`${CROP_ZH[name]}${!st ? '待播种' : st.regrowing ? '再生中' : st.ripe ? '成熟' : st.phase === 0 ? '刚播种' : ` ${st.phase}/${crop.days.length}`}`);
    }
    return parts.join('，');
  }

  const isBlocked = (x, y) => blocked.has(key(x, y));
  const fieldRects = () => fields.map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h, index: f.index, focus: Boolean(f.focus) }));
  // The ripe-crop frame of a crop, for little pictures (the shipping-bin tally).
  const cropIcon = name => { const c = CROPS[name]; return c && { sx: (c.row % 2) * 128 + (c.regrow < 0 ? c.days.length + 1 : 6) * 16, sy: Math.floor(c.row / 2) * 32 }; };

  return { init, clearTiles, cropIcon, isBlocked, takenFor, objectAt, objectHit, objectName, fieldRects, treeAt, fieldAt, treeList, sprites, drawGround, canopyTiles, grassSpots, summary, counts: () => ({ trees: trees.length, debris: debris.length, grass: grass.length }) };
})();
