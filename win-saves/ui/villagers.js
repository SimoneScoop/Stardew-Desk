/* Now and then a villager drops by: walks in from the edge of the farm (the road to
 * town on the east, the forest to the south, the mountain to the north), along the
 * stone path where there is one, stops at their spot for a little while, and goes
 * home again. Rest the cursor on them and they stop to say hello (a heart).
 *   Lewis  — checks the mailbox          Robin — has a look at one of the buildings
 *   Pierre — peeks into the shipping bin Emily — admires a field
 *   Willy  — goes down to the pond       Linus — evenings, looks around the bin */
window.SDV = window.SDV || {};
SDV.villagers = (() => {
  'use strict';

  let TILE = 16, cfg = null;
  let walker = null;
  let timer = 150;                        // seconds until the next visit
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const ROSTER = [
    { id: 'lewis', zh: '刘易斯镇长', from: 'east', to: 'mailbox', hours: [9, 17], what: '来看看信箱' },
    { id: 'robin', zh: '罗宾', from: 'east', to: 'building', hours: [9, 17], what: '来看看你的房子' },
    { id: 'pierre', zh: '皮埃尔', from: 'east', to: 'bin', hours: [9, 17], what: '来看出货箱' },
    { id: 'emily', zh: '艾米丽', from: 'east', to: 'field', hours: [10, 18], what: '来看庄稼' },
    { id: 'willy', zh: '威利', from: 'south', to: 'pond', hours: [8, 16], what: '去池塘边看看' },
    { id: 'linus', zh: '莱纳斯', from: 'north', to: 'bin', hours: [17, 21], what: '路过农场' },
  ];
  // Where the farm meets the rest of the valley (from the map's warps).
  const ENTRANCE = { east: [78, 16], south: [41, 63], north: [40, 2] };
  const SPEED = 34;                       // map px per second, an easy stroll

  function init(config, tile) { cfg = config; TILE = tile; }

  // ---------- routes ----------
  function walkable(x, y) {
    if (SDV.layout.isSolid(x, y)) return false;
    const L = SDV.layout.offsets();
    for (const n of SDV.layout.names) { const f = SDV.layout.footprint(n, L); if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return false; }
    for (const n of SDV.layout.small) { const f = SDV.layout.propFootprint(cfg, n); if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return false; }
    if (SDV.decor.fieldRects().some(f => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h)) return false;
    if (SDV.decor.objectAt(x, y, 'none') || SDV.paths.blocksWalk(x, y)) return false;
    return !SDV.decor.treeList().some(t => t.x === x && t.y === y);
  }
  function route(from, to) {
    return SDV.paths.route([from], to, { passable: walkable, cost: (x, y) => (SDV.paths.isPath(x, y) ? 0.5 : 1), turn: 0.3 });
  }
  function nearestWalkable([x, y]) {
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && walkable(x + dx, y + dy)) return [x + dx, y + dy];
    }
    return null;
  }
  function targetFor(v) {
    const P = cfg.props, t = n => Math.floor(n / TILE);
    if (v.to === 'mailbox' && P.mailbox) return [t(P.mailbox.x), t(P.mailbox.y + 32)];
    if (v.to === 'bin' && P.bin) return [t(P.bin.x), t(P.bin.y + 32)];
    if (v.to === 'building') {
      const b = pick(['house', 'barn', 'coop', 'stable'].filter(n => P[n]));
      const p = P[b];
      return [t(p.x + p.src[2] / 2), t(p.y + p.src[3]) + 1];
    }
    if (v.to === 'field') {
      const f = pick(SDV.decor.fieldRects());
      return f ? [f.x + Math.floor(f.w / 2), f.y + f.h + 1] : null;
    }
    if (v.to === 'pond') {
      // the land tile next to water closest to the farmhouse
      const home = P.house ? [t(P.house.x) + 6, t(P.house.y + P.house.src[3])] : [64, 17];
      let best = null;
      for (let y = 4; y < 60; y++) for (let x = 2; x < 78; x++) {
        if (SDV.layout.isWater(x, y) || !walkable(x, y)) continue;
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => SDV.layout.isWater(x + a, y + b))) continue;
        const d = Math.abs(x - home[0]) + Math.abs(y - home[1]);
        if (!best || d < best.d) best = { x, y, d };
      }
      return best && [best.x, best.y];
    }
    return null;
  }

  // ---------- visits ----------
  function start(v) {
    const from = nearestWalkable(ENTRANCE[v.from]);
    const goal = targetFor(v) && nearestWalkable(targetFor(v));
    if (!from || !goal) return false;
    const path = route(from, goal);
    if (!path || path.length < 2) return false;
    const [x, y] = path[0];
    walker = { v, path, i: 0, x: x * TILE + 8, y: y * TILE + 12, dir: 3, t: 0, phase: 'go', stay: rand(8, 15), from, emote: null, greeted: false };
    return true;
  }
  function eligible(hour, weather) {
    if (weather === 'storm') return [];
    return ROSTER.filter(v => hour >= v.hours[0] && hour < v.hours[1]);
  }

  function update(dt, nowS, ctx) {
    if (!cfg) return;
    if (!walker) {
      timer -= dt;
      if (timer <= 0) {
        const who = eligible(ctx.hour, ctx.weather);
        if (who.length) start(pick(who));
        timer = rand(360, 900);
      }
      return;
    }
    const w = walker;
    w.t += dt;
    if (w.emote) { w.emote.t += dt; if (w.emote.t > 2.2) w.emote = null; }
    // say hello when the cursor rests on them
    const cur = SDV.interact && SDV.interact.cursor;
    const onMe = cur && cur.on && Math.abs(cur.x - w.x) < 10 && cur.y > w.y - 30 && cur.y < w.y + 2 && nowS - cur.lastMove > 0.5;
    w.paused = Boolean(onMe);
    if (onMe) {
      w.dir = 0;
      if (!w.greeted) { w.greeted = true; w.emote = { id: 'heart', t: 0 }; }
      return;
    }
    if (w.phase === 'stay') {
      w.stay -= dt;
      if (w.stay <= 0) {
        const back = route([Math.floor(w.x / TILE), Math.floor(w.y / TILE)], w.from);
        if (!back) { walker = null; return; }
        w.path = back; w.i = 0; w.phase = 'back';
      }
      return;
    }
    // walk along the path, tile centre to tile centre
    let step = SPEED * dt;
    while (step > 0 && w.i < w.path.length - 1) {
      const [nx, ny] = w.path[w.i + 1];
      const tx = nx * TILE + 8, ty = ny * TILE + 12;
      const dx = tx - w.x, dy = ty - w.y, d = Math.hypot(dx, dy);
      w.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 0 : 2);
      if (d <= step) { w.x = tx; w.y = ty; w.i++; step -= d; }
      else { w.x += dx / d * step; w.y += dy / d * step; step = 0; }
    }
    if (w.i >= w.path.length - 1) {
      if (w.phase === 'go') { w.phase = 'stay'; w.dir = 2; w.greeted = false; }
      else walker = null;
    }
  }

  // ---------- drawing ----------
  function sprites(images) {
    const w = walker;
    if (!w) return [];
    const img = images['npc_' + w.v.id];
    if (!img) return [];
    const moving = w.phase !== 'stay' && !w.paused;
    const f = w.dir * 4 + (moving ? Math.floor(w.t * 6) % 4 : 0);
    const x = Math.round(w.x) - 8, y = Math.round(w.y) - 30;
    return [{ y: w.y, draw(g) { g.drawImage(img, (f % 4) * 16, Math.floor(f / 4) * 32, 16, 32, x, y, 16, 32); } }];
  }
  function emotes(images) {
    const w = walker, img = images.emotes;
    if (!w || !w.emote || !img) return;
    return {
      draw(g) {
        const t = w.emote.t;
        let f;
        if (t < 0.24) f = Math.min(3, Math.floor(t / 0.06));
        else if (t < 1.96) f = 20 + (Math.floor((t - 0.24) / 0.15) % 4);
        else f = 3 - Math.min(3, Math.floor((t - 1.96) / 0.06));
        g.drawImage(img, (f % 4) * 16, Math.floor(f / 4) * 16, 16, 16, Math.round(w.x) - 8, Math.round(w.y) - 46, 16, 16);
      },
    };
  }
  const current = () => walker && { name: walker.v.zh, what: walker.v.what, phase: walker.phase, x: walker.x, y: walker.y };
  // For tests and the settings window: send someone now.
  function visit(id) { const v = ROSTER.find(r => r.id === id) || pick(ROSTER); walker = null; return start(v); }

  return { init, update, sprites, emotes, current, visit, roster: ROSTER };
})();
