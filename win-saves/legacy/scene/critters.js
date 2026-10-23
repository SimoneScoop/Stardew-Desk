/* Little wildlife from TileSheets/critters, by season, time of day and weather:
 *   butterflies — spring and summer days, flutter about and away from the cursor
 *   birds       — a small flock lands to peck now and then; a cursor coming close sends them off
 *   fireflies   — summer nights, drifting glows
 *   frogs       — rainy spring and summer days at the water's edge; hop into the water if disturbed
 *   squirrels   — now and then one dashes from tree to tree (not in winter)
 * Only the part of the farm on screen is populated. */
window.SDV = window.SDV || {};
SDV.critters = (() => {
  'use strict';

  let TILE = 16;
  let list = [];
  let birdTimer = 15, squirrelTimer = 40;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  // critters.png: 20 columns of 16 px, or 10 columns of 32 px
  const f16 = n => [(n % 20) * 16, Math.floor(n / 20) * 16];
  const f32 = n => [(n % 10) * 32, Math.floor(n / 10) * 32];

  const BUTTERFLIES = [128, 132, 136, 148, 152, 156];
  const BIRDS = { spring: [25, 45], summer: [25, 45], fall: [25, 135], winter: [135, 125] };
  const FROG = 280, SQUIRREL = 60;

  function init(tile) { TILE = tile; list = []; }

  // ---------- where things may stand ----------
  const tileOf = v => Math.floor(v / TILE);
  function groundOK(px, py) {
    const x = tileOf(px), y = tileOf(py);
    if (!SDV.layout || SDV.layout.isSolid(x, y)) return false;
    if (SDV.decor && SDV.decor.objectAt(x, y, 'none')) return false;
    if (SDV.paths && SDV.paths.blocksWalk(x, y)) return false;
    for (const n of SDV.layout.names) {
      const f = SDV.layout.footprint(n, SDV.layout.offsets());
      if (x >= f.x - 0 && x < f.x + f.w && y >= f.y - 2 && y < f.y + f.h) return false;
    }
    return !(SDV.decor && SDV.decor.treeList().some(t => Math.abs(t.x - x) <= 1 && t.y - y >= 0 && t.y - y <= 2));
  }
  function randomGround(view, tries = 30) {
    for (let i = 0; i < tries; i++) {
      const x = rand(view.x + 24, view.x + view.w - 24), y = rand(view.y + 32, view.y + view.h - 16);
      if (groundOK(x, y)) return { x, y };
    }
    return null;
  }
  // a point just off the visible area, on the side nearest to (x, y) or a random one
  function offscreen(view, x, y) {
    const side = x != null ? [x - view.x, view.x + view.w - x, y - view.y, view.y + view.h - y].reduce((m, d, i, a) => (d < a[m] ? i : m), 0) : Math.floor(Math.random() * 4);
    if (side === 0) return { x: view.x - 40, y: rand(view.y, view.y + view.h) };
    if (side === 1) return { x: view.x + view.w + 40, y: rand(view.y, view.y + view.h) };
    if (side === 2) return { x: rand(view.x, view.x + view.w), y: view.y - 50 };
    return { x: rand(view.x, view.x + view.w), y: view.y + view.h + 30 };
  }
  const outside = (c, view, m = 60) => c.x < view.x - m || c.x > view.x + view.w + m || c.y - (c.z || 0) < view.y - m - 40 || c.y > view.y + view.h + m;

  // ---------- spawning ----------
  function spawnButterfly(view) {
    const p = randomGround(view, 10) || { x: rand(view.x, view.x + view.w), y: rand(view.y, view.y + view.h) };
    list.push({ kind: 'butterfly', base: pick(BUTTERFLIES), x: p.x, y: p.y, z: rand(10, 26), vx: 0, vy: 0, t: rand(0, 5), life: rand(40, 120), goal: null });
  }
  function spawnFlock(view, season) {
    const spot = randomGround(view);
    if (!spot) return;
    const base = pick(BIRDS[season] || BIRDS.spring), from = offscreen(view);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const land = { x: spot.x + rand(-20, 20), y: spot.y + rand(-10, 10) };
      if (!groundOK(land.x, land.y)) continue;
      list.push({ kind: 'bird', base, state: 'in', x: from.x + rand(-20, 20), y: from.y + rand(-10, 10), z: 60, land, t: rand(0, 1), timer: rand(25, 80), act: 0, flip: land.x > from.x });
    }
  }
  function spawnFirefly(view) {
    list.push({ kind: 'firefly', x: rand(view.x, view.x + view.w), y: rand(view.y, view.y + view.h), z: rand(4, 18), vx: rand(-6, 6), vy: rand(-4, 4), t: rand(0, 6), life: rand(30, 90) });
  }
  function spawnFrog(view) {
    // a land tile right next to water, on screen
    const spots = [];
    for (let y = tileOf(view.y) + 1; y < tileOf(view.y + view.h); y++) {
      for (let x = tileOf(view.x) + 1; x < tileOf(view.x + view.w); x++) {
        if (SDV.layout.isWater(x, y) || SDV.layout.isSolid(x, y)) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => SDV.layout.isWater(x + a, y + b))) spots.push([x, y]);
      }
    }
    if (!spots.length) return;
    const [x, y] = pick(spots);
    list.push({ kind: 'frog', base: pick([FROG, FROG + 20]), x: x * TILE + 8, y: y * TILE + 12, state: 'sit', t: 0, hop: null, timer: rand(3, 9), life: rand(60, 180), alpha: 1, flip: Math.random() < 0.5 });
  }
  function spawnSquirrel(view) {
    const trees = SDV.decor.treeList().filter(t => t.x * TILE > view.x && t.x * TILE < view.x + view.w && t.y * TILE > view.y && t.y * TILE < view.y + view.h + 16);
    if (trees.length < 1) return;
    const a = pick(trees), others = trees.filter(t => t !== a);
    const goal = others.length ? (b => ({ x: b.x * TILE + 8, y: b.y * TILE + 14 }))(pick(others)) : offscreen(view, a.x * TILE, a.y * TILE);
    list.push({ kind: 'squirrel', x: a.x * TILE + 8, y: a.y * TILE + 14, goal, t: 0, paused: false, pauseAt: rand(0.35, 0.65), dist0: 0, state: 'run' });
    const s = list[list.length - 1];
    s.dist0 = Math.hypot(goal.x - s.x, goal.y - s.y);
  }

  // ---------- update ----------
  function update(dt, nowS, ctx) {
    const { view, season, day, night, rain, snow } = ctx;
    const cur = (SDV.interact && SDV.interact.cursor) || { on: false };
    const near = (c, r) => cur.on && Math.hypot(cur.x - c.x, cur.y - (c.y - (c.z || 0))) < r;
    const stirring = cur.on && nowS - (cur.lastMove || -1e9) < 1;

    const count = k => list.filter(c => c.kind === k && !c.leaving).length;
    const fair = day && !rain && !snow;
    // butterflies
    const wantB = (season === 'spring' || season === 'summer') && fair ? 4 : 0;
    if (count('butterfly') < wantB && Math.random() < dt * 0.4) spawnButterfly(view);
    // birds
    if (day && !rain) {
      birdTimer -= dt;
      if (birdTimer <= 0) { if (!list.some(c => c.kind === 'bird')) spawnFlock(view, season); birdTimer = rand(45, 120); }
    }
    // fireflies
    const wantF = season === 'summer' && night && !rain ? 10 : 0;
    if (count('firefly') < wantF && Math.random() < dt * 2) spawnFirefly(view);
    // frogs
    const wantR = (season === 'spring' || season === 'summer') && rain ? 3 : 0;
    if (count('frog') < wantR && Math.random() < dt * 0.3) spawnFrog(view);
    // squirrels
    if (season !== 'winter' && fair) {
      squirrelTimer -= dt;
      if (squirrelTimer <= 0) { spawnSquirrel(view); squirrelTimer = rand(60, 150); }
    }

    let flockFlees = false;
    for (const c of list) {
      c.t += dt;
      if (c.kind === 'butterfly') {
        c.life -= dt;
        if (c.life < 0 || !wantB) c.leaving = true;
        if (!c.goal || Math.hypot(c.goal.x - c.x, c.goal.y - c.y) < 6) c.goal = c.leaving ? offscreen(view, c.x, c.y) : { x: c.x + rand(-60, 60), y: c.y + rand(-40, 40) };
        let ax = (c.goal.x - c.x), ay = (c.goal.y - c.y);
        const d = Math.hypot(ax, ay) || 1;
        let speed = c.leaving ? 30 : 16;
        if (near(c, 30)) { ax = c.x - cur.x; ay = c.y - cur.y; speed = 50; c.goal = null; }
        const dd = Math.hypot(ax, ay) || 1;
        c.vx += ((ax / dd) * speed - c.vx) * Math.min(1, dt * 2);
        c.vy += ((ay / dd) * speed - c.vy) * Math.min(1, dt * 2);
        c.x += c.vx * dt + Math.sin(c.t * 3) * 0.3; c.y += c.vy * dt;
        c.z = 16 + Math.sin(c.t * 2.2) * 6;
        if (c.leaving && outside(c, view)) c.dead = true;
        void d;
      } else if (c.kind === 'bird') {
        if (c.state === 'in') {
          const dx = c.land.x - c.x, dy = c.land.y - c.y, d = Math.hypot(dx, dy);
          if (d < 3) { c.state = 'ground'; c.z = 0; c.x = c.land.x; c.y = c.land.y; }
          else { const s = Math.min(d, 70 * dt); c.x += dx / d * s; c.y += dy / d * s; c.z = Math.min(60, d * 0.5); c.flip = dx > 0; }
        } else if (c.state === 'ground') {
          c.timer -= dt;
          if (near(c, 56) && stirring) flockFlees = true;
          if (c.timer < 0) c.state = 'flee';
          c.act -= dt;
          if (c.act <= 0) {
            // stand, peck a few times, or hop a little
            const r = Math.random();
            c.pose = r < 0.4 ? 'peck' : r < 0.7 ? 'stand' : 'hop';
            c.act = rand(0.8, 2.5);
            if (c.pose === 'hop') {
              const nx = c.x + rand(-10, 10), ny = c.y + rand(-4, 4);
              if (groundOK(nx, ny)) { c.flip = nx > c.x; c.hopFrom = { x: c.x, y: c.y }; c.hopTo = { x: nx, y: ny }; c.hopT = 0; }
            }
          }
          if (c.hopTo) {
            c.hopT += dt / 0.3;
            const k = Math.min(1, c.hopT);
            c.x = c.hopFrom.x + (c.hopTo.x - c.hopFrom.x) * k; c.y = c.hopFrom.y + (c.hopTo.y - c.hopFrom.y) * k;
            c.z = Math.sin(k * Math.PI) * 4;
            if (k >= 1) { c.hopTo = null; c.z = 0; }
          }
        } else if (c.state === 'flee') {
          if (!c.away) { const o = cur.on ? cur : { x: c.x - 1, y: c.y }; const dx = c.x - o.x || 1, d = Math.abs(dx); c.away = { vx: (dx / d) * rand(70, 100), vy: rand(-30, -10) }; c.flip = c.away.vx > 0; }
          c.x += c.away.vx * dt; c.y += c.away.vy * dt * 0.3; c.z += 45 * dt;
          if (outside(c, view)) c.dead = true;
        }
      } else if (c.kind === 'firefly') {
        c.life -= dt;
        if (c.life < 0 || !wantF) c.leaving = true;
        c.vx += rand(-8, 8) * dt; c.vy += rand(-6, 6) * dt;
        c.vx = Math.max(-8, Math.min(8, c.vx)); c.vy = Math.max(-6, Math.min(6, c.vy));
        if (near(c, 20)) { c.vx += (c.x - cur.x) * dt * 2; c.vy += (c.y - cur.y) * dt * 2; }
        c.x += c.vx * dt; c.y += c.vy * dt;
        c.glow = 0.5 + 0.5 * Math.sin(c.t * 2.4);
        if (c.leaving) { c.fade = (c.fade ?? 1) - dt * 0.5; if (c.fade <= 0) c.dead = true; }
      } else if (c.kind === 'frog') {
        c.life -= dt;
        if (c.state === 'sit') {
          c.timer -= dt;
          if (near(c, 36) && stirring) {
            // splash: hop towards the water and vanish
            const x = tileOf(c.x), y = tileOf(c.y);
            const w = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) => SDV.layout.isWater(x + a, y + b)) || [0, 1];
            c.hop = { fx: c.x, fy: c.y, tx: c.x + w[0] * 14, ty: c.y + w[1] * 14, t: 0, gone: true };
            c.flip = w[0] < 0; c.state = 'hop';
          } else if (c.timer < 0 || c.life < 0 || !wantR) {
            if (c.life < 0 || !wantR) { c.state = 'fade'; }
            else {
              const tx = c.x + rand(-14, 14), ty = c.y + rand(-6, 6);
              if (groundOK(tx, ty) && [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].some(([a, b]) => SDV.layout.isWater(tileOf(tx) + a, tileOf(ty) + b))) {
                c.hop = { fx: c.x, fy: c.y, tx, ty, t: 0 }; c.flip = tx < c.x; c.state = 'hop';
              }
              c.timer = rand(3, 9);
            }
          }
        } else if (c.state === 'hop') {
          c.hop.t += dt / 0.45;
          const k = Math.min(1, c.hop.t);
          c.x = c.hop.fx + (c.hop.tx - c.hop.fx) * k; c.y = c.hop.fy + (c.hop.ty - c.hop.fy) * k;
          if (k >= 1) { if (c.hop.gone) c.state = 'fade'; else c.state = 'sit'; c.hop = null; }
        } else if (c.state === 'fade') {
          c.alpha -= dt * 2;
          if (c.alpha <= 0) c.dead = true;
        }
      } else if (c.kind === 'squirrel') {
        const dx = c.goal.x - c.x, dy = c.goal.y - c.y, d = Math.hypot(dx, dy);
        if (c.state === 'pause') {
          c.pauseT -= dt;
          if (c.pauseT <= 0 || near(c, 40)) c.state = 'run';
        } else {
          if (!c.paused && d < c.dist0 * (1 - c.pauseAt)) { c.paused = true; c.state = 'pause'; c.pauseT = rand(1.5, 3.5); continue; }
          const speed = near(c, 50) ? 110 : 75;
          if (d < 3) c.dead = true;
          else { const s = Math.min(d, speed * dt); c.x += dx / d * s; c.y += dy / d * s; c.flip = dx < 0; }
        }
      }
    }
    if (flockFlees) list.forEach(c => { if (c.kind === 'bird' && c.state === 'ground') c.state = 'flee'; });
    list = list.filter(c => !c.dead);
  }

  // ---------- drawing ----------
  // Ground-bound critters, for the y-sorted pass.
  function sprites(images) {
    const img = images.critters;
    if (!img) return [];
    const out = [];
    for (const c of list) {
      if (c.kind === 'bird' && c.state === 'ground') {
        let f = c.base;
        if (c.hopTo) f = c.base + 2;
        else if (c.pose === 'peck') f = c.base + 3 + (Math.floor(c.t * 5) % 2);
        else if (c.pose === 'stand') f = c.base + (Math.floor(c.t * 1.5) % 2);
        const [sx, sy] = f32(f), x = Math.round(c.x), y = Math.round(c.y - c.z);
        out.push({ y: c.y, draw(g) { draw(g, img, sx, sy, 32, 32, x - 16, y - 28, c.flip); } });
      } else if (c.kind === 'frog') {
        const f = c.state === 'hop' ? c.base + [1, 2, 2, 3][Math.min(3, Math.floor(c.hop.t * 4))] : c.base;
        const [sx, sy] = f16(f), x = Math.round(c.x), y = Math.round(c.y);
        out.push({ y: c.y, draw(g) { g.save(); g.globalAlpha = Math.max(0, c.alpha); draw(g, img, sx, sy, 16, 16, x - 8, y - 14, c.flip); g.restore(); } });
      } else if (c.kind === 'squirrel') {
        const f = c.state === 'pause' ? SQUIRREL + (Math.floor(c.t * 3) % 2) : SQUIRREL + 4 + (Math.floor(c.t * 12) % 3);
        const [sx, sy] = f32(f), x = Math.round(c.x), y = Math.round(c.y);
        out.push({ y: c.y, draw(g) { draw(g, img, sx, sy, 32, 32, x - 16, y - 28, c.flip); } });
      }
    }
    return out;
  }
  // Things in the air (above trees and roofs).
  function drawAbove(g, images) {
    const img = images.critters;
    if (!img) return;
    for (const c of list) {
      if (c.kind === 'butterfly') {
        const flap = [0, 1, 2, 3, 2, 1][Math.floor(c.t * 10) % 6];
        const [sx, sy] = f16(c.base + flap);
        const x = Math.round(c.x), y = Math.round(c.y - c.z);
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x - 2, Math.round(c.y), 4, 1);
        draw(g, img, sx, sy, 16, 16, x - 8, y - 8, c.vx < 0);
      } else if (c.kind === 'bird' && c.state !== 'ground') {
        const f = c.base + 6 + [0, 1, 2, 1][Math.floor(c.t * 10) % 4];
        const [sx, sy] = f32(f);
        draw(g, img, sx, sy, 32, 32, Math.round(c.x) - 16, Math.round(c.y - c.z) - 28, c.flip);
      }
    }
  }
  // Fireflies glow through the night tint (call after it, with 'lighter').
  function drawGlow(g, glow) {
    for (const c of list) {
      if (c.kind !== 'firefly') continue;
      const a = (c.glow ?? 0.5) * (c.fade ?? 1);
      if (a <= 0.02) continue;
      const x = c.x, y = c.y - c.z;
      g.globalAlpha = a * 0.9;
      g.drawImage(glow, x - 10, y - 10, 20, 20);
      g.globalAlpha = Math.min(1, a * 1.4);
      g.fillStyle = '#e8ff8a';
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    g.globalAlpha = 1;
  }
  function draw(g, img, sx, sy, sw, sh, dx, dy, flip) {
    if (!flip) { g.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh); return; }
    g.save();
    g.translate(dx + sw, dy);
    g.scale(-1, 1);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    g.restore();
  }

  const counts = () => list.reduce((m, c) => (m[c.kind] = (m[c.kind] || 0) + 1, m), {});
  // For tests: make something happen now.
  function force(kind, view, season) {
    if (kind === 'bird') spawnFlock(view, season || 'spring');
    else if (kind === 'butterfly') spawnButterfly(view);
    else if (kind === 'firefly') spawnFirefly(view);
    else if (kind === 'frog') spawnFrog(view);
    else if (kind === 'squirrel') spawnSquirrel(view);
  }
  return { init, update, sprites, drawAbove, drawGlow, counts, force, list: () => list };
})();
