/* Movable buildings: the farmhouse, coop, barn and stable can be dragged around the
 * farm (in the settings window). A layout is a tile offset per building; the
 * things that belong to a building move with it: mailbox, shipping bin, window
 * lights and the cat's spot follow the house, the chicken pen follows the coop
 * and the cow pen follows the barn. */
window.SDV = window.SDV || {};
SDV.layout = (() => {
  'use strict';
  const tr = (...a) => (window.SDV_I18N ? SDV_I18N.L(...a) : a[0]);

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
    // (init runs again when the farm map changes: only the ground is read anew)
    if (!BASE) BASE = JSON.parse(JSON.stringify({ props: config.props, lights: config.lights, pens: config.pens, cat: config.cat }));
    solid.clear(); water.clear();
    const waterIdx = m.tilesheets.map(t => new Set(t.water || []));
    const back = m.layers.find(l => l.id === 'Back');
    const builds = m.layers.filter(l => l.id === 'Buildings' || l.id === 'Buildings2');
    for (let y = 0; y < back.h; y++) {
      for (let x = 0; x < back.w; x++) {
        const b = back.tiles[y][x];
        const f = b && (b.a ? b.a[0] : b);
        if (f && waterIdx[f.s] && waterIdx[f.s].has(f.i)) { solid.add(key(x, y)); water.add(key(x, y)); }
        if (builds.some(l => l.tiles[y] && l.tiles[y][x])) solid.add(key(x, y));
      }
    }
  }

  // Other buildings a layout can hold (most come from importing a save): drawn as they
  // stand, draggable and removable, but nothing lives in them. Footprints in tiles; the
  // sprite stands on the footprint's bottom edge, as in the game. img: the picture read
  // from the game (setup.js), base: what to draw when an older read lacks it.
  const T = (name, img, src, w, h, more) => ({ name, img, src, fp: { w, h }, ...(more || {}) });
  const CABIN = { leveled: 80 };    // three upgrade levels side by side, 80 px each
  const TYPES = {
    coop: T('鸡舍', 'coop', [0, 0, 96, 112], 6, 3),
    coop_big: T('大鸡舍', 'coop_big', [0, 0, 96, 112], 6, 3, { base: 'coop' }),
    coop_deluxe: T('豪华鸡舍', 'coop_deluxe', [0, 0, 96, 112], 6, 3, { base: 'coop' }),
    barn: T('畜棚', 'barn', [0, 0, 112, 112], 7, 4),
    barn_big: T('大畜棚', 'barn_big', [0, 0, 112, 112], 7, 4, { base: 'barn' }),
    barn_deluxe: T('豪华畜棚', 'barn_deluxe', [0, 0, 112, 112], 7, 4, { base: 'barn' }),
    stable: T('马厩', 'stable', [0, 0, 64, 96], 4, 2),
    bin: T('出货箱', 'shipping_bin', [0, 0, 32, 32], 2, 1),
    silo: T('筒仓', 'b_silo', [0, 0, 48, 128], 3, 3),
    well: T('水井', 'b_well', [0, 0, 48, 80], 3, 3),
    shed: T('棚屋', 'b_shed', [0, 0, 112, 128], 7, 3),
    bigshed: T('大棚屋', 'b_bigshed', [0, 0, 112, 128], 7, 3, { base: 'b_shed' }),
    slimehutch: T('史莱姆屋', 'b_slimehutch', [0, 0, 112, 112], 7, 4),
    mill: T('磨坊', 'b_mill', [0, 0, 64, 128], 4, 2),
    goldclock: T('黄金时钟', 'b_goldclock', [0, 0, 48, 80], 3, 2),
    obelisk_earth: T('地之图腾柱', 'b_obelisk_earth', [0, 0, 48, 128], 3, 2),
    obelisk_water: T('水之图腾柱', 'b_obelisk_water', [0, 0, 48, 128], 3, 2),
    obelisk_desert: T('沙漠图腾柱', 'b_obelisk_desert', [0, 0, 48, 128], 3, 2),
    obelisk_island: T('岛屿图腾柱', 'b_obelisk_island', [0, 0, 48, 128], 3, 2),
    junimohut: T('祝尼魔小屋', 'b_junimohut', [0, 0, 48, 64], 3, 2, { seasonal: 48 }),
    fishpond: T('鱼塘', 'b_fishpond', [0, 0, 80, 80], 5, 5, { ground: true }),
    greenhouse: T('温室', 'b_greenhouse', [0, 160, 112, 160], 7, 6),
    greenhouse_ruin: T('温室（待修复）', 'b_greenhouse', [0, 0, 112, 160], 7, 6),
    cabin_log: T('小木屋', 'b_cabin_log', [0, 0, 80, 112], 5, 3, CABIN),
    cabin_plank: T('木板小屋', 'b_cabin_plank', [0, 0, 80, 112], 5, 3, CABIN),
    cabin_stone: T('石头小屋', 'b_cabin_stone', [0, 0, 80, 112], 5, 3, CABIN),
    cabin_rustic: T('乡村小屋', 'b_cabin_rustic', [0, 0, 80, 112], 5, 3, { ...CABIN, base: 'b_cabin_log' }),
    cabin_neighbor: T('邻居小屋', 'b_cabin_neighbor', [0, 0, 80, 112], 5, 3, { ...CABIN, base: 'b_cabin_plank' }),
    cabin_trailer: T('拖车小屋', 'b_cabin_trailer', [0, 0, 80, 112], 5, 3, { ...CABIN, base: 'b_cabin_plank' }),
    cabin_beach: T('海滨小屋', 'b_cabin_beach', [0, 0, 80, 112], 5, 3, { ...CABIN, base: 'b_cabin_plank' }),
  };
  // The extras on the farm as props (same shape as config.props, plus fp, type, i).
  function extraProps(offsets) {
    return ((offsets && offsets.extras) || []).map((e, i) => {
      const t = TYPES[e.t];
      if (!t) return null;
      const lv = t.leveled ? Math.max(0, Math.min(2, e.level | 0)) : 0;
      const src = [t.src[0] + lv * (t.leveled || 0), t.src[1], t.src[2], t.src[3]];
      return { type: e.t, i, img: t.img, base: t.base, src, seasonal: t.seasonal, ground: t.ground,
        x: e.x * TILE, y: (e.y + t.fp.h) * TILE - src[3], fp: { x: e.x, y: e.y, w: t.fp.w, h: t.fp.h } };
    }).filter(Boolean);
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
    // (a building near the edge of the farm keeps its pen on the farm)
    const mw = map.layers[0].w * TILE, mh = map.layers[0].h * TILE;
    for (const q of Object.values(config.pens)) {
      q.x = Math.max(TILE * 2, Math.min(mw - TILE * 2 - q.w, q.x));
      q.y = Math.max(TILE * 3, Math.min(mh - TILE * 2 - q.h, q.y));
    }
    if (config.cat && BASE.cat) config.cat.home = [BASE.cat.home[0] + h[0] * TILE, BASE.cat.home[1] + h[1] * TILE];
    // the look of the house (upgrade level) and of the coop and barn (big, deluxe)
    const lv = Math.max(0, Math.min(2, (offsets && offsets.houseLevel) | 0));
    P.house.src = [B.house.src[0], B.house.src[1] + lv * B.house.src[3], B.house.src[2], B.house.src[3]];
    const kind = (name, k) => { P[name].img = TYPES[k] && k.startsWith(name) ? TYPES[k].img : B[name].img; P[name].base = B[name].img; };
    kind('coop', offsets && offsets.coopKind); kind('barn', offsets && offsets.barnKind);
    config.extraProps = extraProps(offsets);
  }

  function footprint(name, offsets) {
    const f = MOVABLE[name].fp, d = off(offsets, name);
    return { x: f.x + d[0], y: f.y + d[1], w: f.w, h: f.h };
  }
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // Every building's ground, the four movable ones and the extras: [{x, y, w, h, id, label}]
  function footprints(offsets) {
    const out = Object.keys(MOVABLE).map(n => ({ ...footprint(n, offsets), id: n, label: MOVABLE[n].name }));
    for (const p of extraProps(offsets)) out.push({ ...p.fp, id: 'x' + p.i, label: TYPES[p.type].name });
    return out;
  }

  // Can a building stand on f? self: its own id in footprints(). null if yes, else the reason.
  function rectProblem(f, self, offsets, fields) {
    if (f.x < 1 || f.y < 2 || f.x + f.w > map.layers[0].w - 1 || f.y + f.h > map.layers[0].h - 1) return tr('超出农场范围');
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) if (solid.has(key(x, y))) return tr('这里有水或障碍');
    for (const o of footprints(offsets)) if (o.id !== self && overlap(f, o)) return tr('和{0}重叠', tr(o.label));
    for (const fd of fields || []) if (overlap(f, fd)) return tr('压到了作物田');
    return null;
  }
  // Can `name` stand where `offsets` puts it? Returns null if yes, else the reason.
  const problem = (name, offsets, fields) => rectProblem(footprint(name, offsets), name, offsets, fields);
  // The same for extra building i.
  function extraProblem(i, offsets, fields) {
    const p = extraProps(offsets).find(q => q.i === i);
    return p ? rectProblem(p.fp, 'x' + i, offsets, fields) : null;
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
  // The extra building under a map-px point (sprite rectangle), front-most first.
  function hitExtra(config, px, py) {
    const list = (config.extraProps || []).filter(p => px >= p.x && px < p.x + p.src[2] && py >= p.y && py < p.y + p.src[3]);
    list.sort((a, b) => (b.y + b.src[3]) - (a.y + a.src[3]));
    return list[0] || null;
  }

  return { init, apply, offsets: () => last, isWater: (x, y) => water.has(key(x, y)), footprint, footprints, propFootprint, problem, extraProblem, rectProblem, hit, hitExtra, isSolid, inMap,
    names: Object.keys(MOVABLE), small: Object.keys(SMALL), TYPES, MOVABLE, label: n => (MOVABLE[n] || {}).name || SMALL[n] || (TYPES[n] || {}).name };
})();
