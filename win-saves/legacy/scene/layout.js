/* Movable buildings: the farmhouse, coop, barn and stable can be dragged around the
 * farm (in the settings window). A layout is a tile offset per building; the
 * things that belong to a building move with it: mailbox, shipping bin, window
 * lights and the cat's spot follow the house, the chicken pen follows the coop
 * and the cow pen follows the barn. */
window.SDV = window.SDV || {};
SDV.layout = (() => {
  'use strict';

  let TILE = 16, map = null, BASE = null;
  const solid = new Set();
  const water = new Set();     // the water tiles among them (pond, river)     // map tiles nothing can be built on (cliffs, water, trees on the border…)
  const key = (x, y) => y * 1000 + x;

  // Default footprints (tiles) — the ground each building stands on.
  const MOVABLE = {
    house: { name: '农舍', fp: { x: 59, y: 13, w: 9, h: 4 } },
    coop: { name: '鸡舍', fp: { x: 46, y: 13, w: 6, h: 3 } },
    barn: { name: '畜棚', fp: { x: 45, y: 22, w: 7, h: 4 } },
    stable: { name: '马厩', fp: { x: 73, y: 17, w: 4, h: 2 } },
  };

  function init(config, m, tile) {
    TILE = tile; map = m;
    // Remember the untouched positions once; every layout is applied on top of them.
    BASE = JSON.parse(JSON.stringify({ props: config.props, lights: config.lights, pens: config.pens, cat: config.cat }));
    const waterIdx = m.tilesheets.map(t => new Set(t.water || []));
    const back = m.layers.find(l => l.id === 'Back');
    const build = m.layers.find(l => l.id === 'Buildings');
    for (let y = 0; y < back.h; y++) {
      for (let x = 0; x < back.w; x++) {
        const b = back.tiles[y][x];
        const f = b && (b.a ? b.a[0] : b);
        if (f && waterIdx[f.s] && waterIdx[f.s].has(f.i)) { solid.add(key(x, y)); water.add(key(x, y)); }
        if (build && build.tiles[y] && build.tiles[y][x]) solid.add(key(x, y));
      }
    }
  }

  const off = (o, name) => (o && o[name]) || [0, 0];
  // Small props that can be nudged on their own (offsets on top of the house's).
  const SMALL = { mailbox: '信箱', bin: '出货箱', board: '公告板' };
  // Ground tiles a prop stands on: the bottom row of its sprite.
  function propFootprint(config, name) {
    const p = config.props[name];
    if (!p) return { x: -99, y: -99, w: 0, h: 0 };            // (a prop removed from config.js)
    const [, , sw, sh] = p.src;
    const x0 = Math.floor(p.x / TILE), x1 = Math.ceil((p.x + sw) / TILE);
    return { x: x0, y: Math.ceil((p.y + sh) / TILE) - 1, w: x1 - x0, h: 1 };
  }

  // Move props, lights, pens and the cat's spot to match the offsets.
  let last = {};               // the offsets applied most recently
  function apply(config, offsets) {
    if (!BASE) return;
    last = offsets || {};
    const P = config.props, B = BASE.props;
    const place = (name, d) => { P[name].x = B[name].x + d[0] * TILE; P[name].y = B[name].y + d[1] * TILE; };
    const h = off(offsets, 'house'), c = off(offsets, 'coop'), b = off(offsets, 'barn');
    // the mailbox and shipping bin follow the house, plus any nudge of their own
    const plus = (a, b) => [a[0] + b[0], a[1] + b[1]];
    place('house', h); place('mailbox', plus(h, off(offsets, 'mailbox'))); place('bin', plus(h, off(offsets, 'bin')));
    place('coop', c);
    place('barn', b);
    place('stable', off(offsets, 'stable'));
    if (P.board && B.board) place('board', off(offsets, 'board'));   // stands on its own
    config.lights.forEach((l, i) => {
      const base = BASE.lights[i];
      const d = base.of === 'coop' ? c : h;
      l.x = base.x + d[0] * TILE; l.y = base.y + d[1] * TILE;
    });
    const pen = (kind, d) => { config.pens[kind].x = BASE.pens[kind].x + d[0] * TILE; config.pens[kind].y = BASE.pens[kind].y + d[1] * TILE; };
    pen('chicken', c); pen('cow', b);
    if (config.cat && BASE.cat) config.cat.home = [BASE.cat.home[0] + h[0] * TILE, BASE.cat.home[1] + h[1] * TILE];
  }

  function footprint(name, offsets) {
    const f = MOVABLE[name].fp, d = off(offsets, name);
    return { x: f.x + d[0], y: f.y + d[1], w: f.w, h: f.h };
  }
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // Can `name` stand where `offsets` puts it? Returns null if yes, else the reason.
  function problem(name, offsets, fields) {
    const f = footprint(name, offsets);
    if (f.x < 1 || f.y < 2 || f.x + f.w > map.layers[0].w - 1 || f.y + f.h > map.layers[0].h - 1) return '超出农场范围';
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) if (solid.has(key(x, y))) return '这里有水或障碍';
    for (const other of Object.keys(MOVABLE)) {
      if (other !== name && overlap(f, footprint(other, offsets))) return `和${MOVABLE[other].name}重叠`;
    }
    for (const fd of fields || []) if (overlap(f, fd)) return '压到了作物田';
    return null;
  }

  // Which building is under a map-px point (sprite rectangle), topmost first.
  function hit(config, px, py) {
    const order = Object.keys(MOVABLE).sort((a, b) => (config.props[b].y + config.props[b].src[3]) - (config.props[a].y + config.props[a].src[3]));
    for (const name of order) {
      const p = config.props[name];
      if (px >= p.x && px < p.x + p.src[2] && py >= p.y && py < p.y + p.src[3]) return name;
    }
    return null;
  }

  const isSolid = (x, y) => solid.has(key(x, y));
  const inMap = (x, y) => x >= 1 && y >= 2 && x < map.layers[0].w - 1 && y < map.layers[0].h - 1;
  return { init, apply, offsets: () => last, isWater: (x, y) => water.has(key(x, y)), footprint, propFootprint, problem, hit, isSolid, inMap, names: Object.keys(MOVABLE), small: Object.keys(SMALL), label: n => (MOVABLE[n] || {}).name || SMALL[n] };
})();
