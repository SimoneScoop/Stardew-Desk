/* Stone paths, wooden fences and lamp-posts — plus the route finder that both the
 * automatic paths and the visiting villagers walk on.
 *
 * Until you draw your own (in the layout editor), paths, fences and lamps are worked
 * out from where the buildings stand: a stone path from the farmhouse door to the
 * barn, coop and stable, a lamp-post by each door that lights up at night, and a
 * fence around the cows' paddock with gaps where the path runs through and on the
 * side facing the barn door. Move a building and the automatic ones follow. */
window.SDV = window.SDV || {};
SDV.paths = (() => {
  'use strict';

  let TILE = 16, cfg = null, map = null, W = 80, H = 65;
  let paths = new Set(), fences = new Set(), lamps = new Set();
  let auto = { paths: true, fences: true, lamps: true };
  const key = (x, y) => y * 1000 + x;
  const unkey = k => [k % 1000, Math.floor(k / 1000)];

  // Sheets: TerrainFeatures/Flooring (4×4 blocks of 16 px tiles; block 1 = stone floor),
  // LooseSprites/Fence1 (16×32 pieces, 3 per row), TileSheets/Craftables (152 wood lamp-post).
  const FLOOR = 1;
  const LAMP = 152;

  // ---------- what can go where ----------
  const inMap = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
  function underBuilding(x, y, layout) {
    for (const n of SDV.layout.names) {
      const f = SDV.layout.footprint(n, layout);
      if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return true;
    }
    for (const n of SDV.layout.small) {
      const f = SDV.layout.propFootprint(cfg, n);
      if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return true;
    }
    return false;
  }
  const inField = (x, y) => SDV.decor.fieldRects().some(f => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
  // Open ground: not water, cliff, building, field or a placed object.
  function open(x, y, layout) {
    return inMap(x, y) && !SDV.layout.isSolid(x, y) && !underBuilding(x, y, layout) && !inField(x, y) && !SDV.decor.objectAt(x, y, 'none');
  }
  // Can `kind` ('path' | 'fence' | 'lamp') go on (x, y)? Returns null or the reason.
  function problem(kind, x, y, layout) {
    if (!inMap(x, y)) return '超出农场范围';
    if (SDV.layout.isSolid(x, y)) return '这里有水或障碍';
    if (underBuilding(x, y, layout)) return '这里有建筑';
    if (inField(x, y)) return '这里是作物田';
    if (SDV.decor.objectAt(x, y, 'none')) return '这里有小物件';
    const k = key(x, y);
    if (kind !== 'path' && paths.has(k)) return '这里是路';
    if (kind !== 'fence' && fences.has(k)) return '这里是围栏';
    if (kind !== 'lamp' && lamps.has(k)) return '这里有路灯';
    return null;
  }

  // ---------- route finding (A*, 4 directions, a small cost for each turn) ----------
  function route(sources, goal, opt) {
    const passable = opt.passable, cost = opt.cost || (() => 1), turn = opt.turn ?? 0.6;
    const N = W * H * 5;
    const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
    const heap = [];
    const push = (n, f) => {
      heap.push([f, n]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const id = (x, y, d) => (y * W + x) * 5 + d;   // d: 0–3 direction we came in, 4 = start
    const h = (x, y) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]);
    for (const [x, y] of sources) { const n = id(x, y, 4); g[n] = 0; push(n, h(x, y)); }
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    let found = -1, guard = 0;
    while (heap.length && guard++ < 60000) {
      const [, n] = pop();
      const d = n % 5, c = (n - d) / 5, x = c % W, y = (c - x) / W;
      if (x === goal[0] && y === goal[1]) { found = n; break; }
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (!(nx === goal[0] && ny === goal[1]) && !passable(nx, ny)) continue;
        const ng = g[n] + cost(nx, ny) + (d !== 4 && d !== k ? turn : 0);
        const m = id(nx, ny, k);
        if (ng < g[m]) { g[m] = ng; from[m] = n; push(m, ng + h(nx, ny)); }
      }
    }
    if (found < 0) return null;
    const out = [];
    for (let n = found; n >= 0; n = from[n]) { const c = Math.floor(n / 5); out.push([c % W, Math.floor(c / W)]); }
    return out.reverse();
  }

  // ---------- automatic layout ----------
  // The tile just outside each building's door (or the stable's open front).
  function doors() {
    const P = cfg.props, t = v => Math.floor(v / TILE);
    const out = [];
    if (P.house) out.push({ name: 'house', at: [t(P.house.x) + 6, t(P.house.y + P.house.src[3])] });
    if (P.barn) out.push({ name: 'barn', at: [t(P.barn.x + P.barn.door.x) + 1, t(P.barn.y + P.barn.src[3])] });
    if (P.coop) out.push({ name: 'coop', at: [t(P.coop.x + P.coop.door.x), t(P.coop.y + P.coop.src[3])] });
    if (P.stable) out.push({ name: 'stable', at: [t(P.stable.x) + 1, t(P.stable.y + P.stable.src[3])] });
    return out;
  }
  function nearestOpen([x, y], layout) {
    for (let r = 0; r < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && open(x + dx, y + dy, layout)) return [x + dx, y + dy];
    }
    return null;
  }
  function autoPaths(layout) {
    const trees = new Set(SDV.decor.treeList().map(t => key(t.x, t.y)));
    const ds = doors().map(d => ({ ...d, at: nearestOpen(d.at, layout) })).filter(d => d.at);
    const house = ds.find(d => d.name === 'house') || ds[0];
    if (!house) return new Set();
    const set = new Set([key(...house.at)]);
    const rest = ds.filter(d => d !== house)
      .sort((a, b) => (Math.abs(a.at[0] - house.at[0]) + Math.abs(a.at[1] - house.at[1])) - (Math.abs(b.at[0] - house.at[0]) + Math.abs(b.at[1] - house.at[1])));
    for (const d of rest) {
      const r = route([...set].map(unkey), d.at, {
        passable: (x, y) => open(x, y, layout),
        cost: (x, y) => (set.has(key(x, y)) ? 0.3 : 1) + (trees.has(key(x, y)) ? 8 : 0),
      });
      if (r) r.forEach(([x, y]) => set.add(key(x, y)));
    }
    return set;
  }
  function autoLamps(layout) {
    const out = new Set();
    for (const d of doors()) {
      const at = nearestOpen(d.at, layout);
      if (!at) continue;
      const [x, y] = at;
      const spot = [[x - 1, y], [x + 1, y], [x - 1, y + 1], [x + 1, y + 1]]
        .find(([a, b]) => open(a, b, layout) && !paths.has(key(a, b)) && !out.has(key(a, b)));
      if (spot) out.add(key(...spot));
    }
    return out;
  }
  // A ring around the cow paddock, open where a path crosses and on the barn's side.
  function autoFences(layout) {
    const pen = cfg.pens && cfg.pens.cow, out = new Set();
    if (!pen) return out;
    const x0 = Math.floor(pen.x / TILE) - 1, x1 = Math.ceil((pen.x + pen.w) / TILE);
    const y0 = Math.floor(pen.y / TILE) - 1, y1 = Math.ceil((pen.y + pen.h) / TILE);
    const ring = [];
    for (let x = x0; x <= x1; x++) ring.push([x, y0], [x, y1]);
    for (let y = y0 + 1; y < y1; y++) ring.push([x0, y], [x1, y]);
    const barn = doors().find(d => d.name === 'barn');
    const gate = new Set();
    if (barn) {
      // the two ring tiles nearest the barn door stay open, so the cows can get out
      ring.slice().sort((a, b) => Math.hypot(a[0] - barn.at[0], a[1] - barn.at[1]) - Math.hypot(b[0] - barn.at[0], b[1] - barn.at[1]))
        .slice(0, 2).forEach(([x, y]) => gate.add(key(x, y)));
    }
    for (const [x, y] of ring) {
      const k = key(x, y);
      if (gate.has(k) || paths.has(k) || lamps.has(k) || !open(x, y, layout)) continue;
      out.add(k);
    }
    // stubs of one or two posts left between gaps look like leftovers: drop them
    const seen = new Set();
    for (const k of [...out]) {
      if (seen.has(k)) continue;
      const part = [], todo = [k];
      seen.add(k);
      while (todo.length) {
        const c = todo.pop(); part.push(c);
        const [x, y] = unkey(c);
        for (const n of [key(x + 1, y), key(x - 1, y), key(x, y + 1), key(x, y - 1)]) if (out.has(n) && !seen.has(n)) { seen.add(n); todo.push(n); }
      }
      if (part.length < 3) part.forEach(c => out.delete(c));
    }
    return out;
  }

  // ---------- build ----------
  const toSet = list => new Set((list || []).map(([x, y]) => key(x, y)));
  function build(config, m, tile, layout) {
    cfg = config; map = m; TILE = tile;
    W = map.layers[0].w; H = map.layers[0].h;
    auto = { paths: !Array.isArray(layout.paths), fences: !Array.isArray(layout.fences), lamps: !Array.isArray(layout.lamps) };
    paths = new Set(); fences = new Set(); lamps = new Set();
    paths = auto.paths ? autoPaths(layout) : toSet(layout.paths);
    lamps = auto.lamps ? autoLamps(layout) : toSet(layout.lamps);
    fences = auto.fences ? autoFences(layout) : toSet(layout.fences);
    // saved pieces that a building or field has since moved onto are left out (and come back if it moves away)
    const keep = s => new Set([...s].filter(k => { const [x, y] = unkey(k); return inMap(x, y) && !SDV.layout.isSolid(x, y) && !underBuilding(x, y, layout) && !inField(x, y) && !SDV.decor.objectAt(x, y, 'none'); }));
    paths = keep(paths); fences = keep(fences); lamps = keep(lamps);
  }
  // Everything this module occupies, for the decor to clear trees and weeds off.
  const tiles = () => [...paths, ...fences, ...lamps].map(unkey);
  // The current pieces as plain lists, for saving.
  const lists = () => ({ paths: [...paths].map(unkey), fences: [...fences].map(unkey), lamps: [...lamps].map(unkey) });
  const has = (kind, x, y) => ({ path: paths, fence: fences, lamp: lamps })[kind].has(key(x, y));
  const isPath = (x, y) => paths.has(key(x, y));
  const blocksWalk = (x, y) => fences.has(key(x, y)) || lamps.has(key(x, y));

  // ---------- drawing ----------
  // Stone floor auto-tiling: which of the 16 pieces of the 4×4 block fits the neighbours.
  const PIECE = {
    0: [0, 0], 4: [0, 1], 5: [0, 2], 1: [0, 3],          // alone, vertical strip
    2: [1, 3], 10: [2, 3], 8: [3, 3],                    // horizontal strip
    6: [1, 0], 14: [2, 0], 12: [3, 0],                   // top row of an area
    7: [1, 1], 15: [2, 1], 13: [3, 1],                   // middle
    3: [1, 2], 11: [2, 2], 9: [3, 2],                    // bottom
  };
  function drawGround(ctx, images, season, view) {
    const img = season === 'winter' ? images.flooring_winter || images.flooring : images.flooring;
    if (!img) return;
    const bx = (FLOOR % 4) * 64, by = Math.floor(FLOOR / 4) * 64;
    for (const k of paths) {
      const [x, y] = unkey(k);
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      const m = (paths.has(key(x, y - 1)) ? 1 : 0) | (paths.has(key(x + 1, y)) ? 2 : 0) | (paths.has(key(x, y + 1)) ? 4 : 0) | (paths.has(key(x - 1, y)) ? 8 : 0);
      const [c, r] = PIECE[m];
      ctx.drawImage(img, bx + c * 16, by + r * 16, 16, 16, x * TILE, y * TILE, 16, 16);
    }
  }
  // Fence piece by neighbours: the knob on top shows when the fence carries on north.
  function fencePiece(x, y) {
    const n = fences.has(key(x, y - 1)), e = fences.has(key(x + 1, y)), w = fences.has(key(x - 1, y));
    if (n) return e && w ? 7 : e ? 6 : w ? 8 : 3;
    return e && w ? 7 : e ? 0 : w ? 2 : 5;
  }
  function sprites(images, season, view) {
    const out = [];
    const vis = (x, y) => x >= view.x0 - 1 && x <= view.x1 + 1 && y >= view.y0 - 1 && y <= view.y1 + 2;
    const fimg = images.fence_wood, cimg = images.craftables;
    if (fimg) for (const k of fences) {
      const [x, y] = unkey(k);
      if (!vis(x, y)) continue;
      const p = fencePiece(x, y), sx = (p % 3) * 16, sy = Math.floor(p / 3) * 32;
      out.push({ y: (y + 1) * TILE - 1, draw(g) { g.drawImage(fimg, sx, sy, 16, 32, x * TILE, y * TILE - 16, 16, 32); } });
    }
    if (cimg) for (const k of lamps) {
      const [x, y] = unkey(k);
      if (!vis(x, y)) continue;
      out.push({ y: (y + 1) * TILE - 1, draw(g) { g.drawImage(cimg, (LAMP % 8) * 16, Math.floor(LAMP / 8) * 32, 16, 32, x * TILE, y * TILE - 16, 16, 32); } });
    }
    return out;
  }
  // Night-time glow from the lamp heads (map px, like CONFIG.lights).
  const lights = () => [...lamps].map(k => { const [x, y] = unkey(k); return { x: x * TILE + 8, y: y * TILE - 10, r: 30 }; });

  // ---------- editing ----------
  // Paint or erase one tile; returns null or why it can't go there. The first edit of
  // a kind turns its automatic layout into a saved one the user can keep editing.
  function paint(tool, x, y, layout) {
    const k = key(x, y);
    if (tool === 'erase') {
      const hit = paths.has(k) || fences.has(k) || lamps.has(k);
      paths.delete(k); fences.delete(k); lamps.delete(k);
      return hit ? null : '这里没有可以擦掉的';
    }
    const why = problem(tool, x, y, layout);
    if (why) return why;
    ({ path: paths, fence: fences, lamp: lamps })[tool].add(k);
    return null;
  }

  return { build, route, problem, paint, tiles, lists, has, isPath, blocksWalk, drawGround, sprites, lights, isAuto: () => ({ ...auto }), counts: () => ({ paths: paths.size, fences: fences.size, lamps: lamps.size }) };
})();
