/* Cursor interaction (M2): grass that sways, leaves shaken from tree tops,
 * ripples on water, animals that startle or show a heart, and a cat that
 * follows the cursor. Input is the cursor in map px (from the mac host or
 * from mouse events in the browser preview). */
window.SDV = window.SDV || {};
SDV.interact = (() => {
  'use strict';

  const rand = (a, b) => a + Math.random() * (b - a);
  const BUDGET = 3;           // at most this many animals reacting at once
  const FAST = 260;           // map px/s — a swipe that startles animals
  const STILL = 14;           // map px/s — the cursor counts as resting
  const DWELL = 1.2;          // s resting on an animal before a heart

  let TILE = 16, cfg = null;
  const cursor = { x: 0, y: 0, on: false, speed: 0, still: 0, lastMove: -1e9, hist: [] };
  let grass = [], water = new Set(), canopy = new Set();
  const leaves = [], ripples = [];
  let rippleCool = 0;
  const canopyCool = new Map();

  // ---------- setup ----------
  function init(config, map, tile, extra = {}) {
    cfg = config; TILE = tile;
    water.clear(); canopy.clear(); leaves.length = 0; ripples.length = 0;
    grass = (config.grass || []).concat(extra.grass || [])
      .map(([tx, ty, v, jx = 0, jy = 0]) => ({ x: tx * TILE + 8 + jx, y: (ty + 1) * TILE + jy, v: v || 0, shake: 0, phase: rand(0, 6) }));
    for (const k of extra.canopy || []) canopy.add(k);
    const waterIdx = map.tilesheets.map(t => new Set(t.water || []));
    for (const layer of map.layers) {
      layer.tiles.forEach((row, y) => row.forEach((t, x) => {
        if (!t) return;
        const first = t.a ? t.a[0] : t;
        if (layer.id === 'Back' && waterIdx[first.s] && waterIdx[first.s].has(first.i)) water.add(y * 1000 + x);
        if (layer.id === 'Front' || layer.id === 'AlwaysFront') canopy.add(y * 1000 + x);
      }));
    }
    cat.init(config.cat);
  }

  // ---------- cursor ----------
  // covered: the cursor is over an app window, not the bare desktop
  function setCursor(p, nowS, covered) {
    if (!p) { cursor.on = false; cursor.hist.length = 0; return; }
    cursor.covered = Boolean(covered);
    cursor.hist.push({ x: p.x, y: p.y, t: nowS });
    while (cursor.hist.length > 2 && nowS - cursor.hist[0].t > 0.25) cursor.hist.shift();
    const moved = !cursor.on || Math.hypot(p.x - cursor.x, p.y - cursor.y) > 0.5;
    cursor.x = p.x; cursor.y = p.y; cursor.on = true;
    if (moved) cursor.lastMove = nowS;
  }
  function measure(nowS) {
    const h = cursor.hist;
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1];
      const dt = Math.max(0.03, b.t - a.t);
      cursor.speed = nowS - b.t > 0.3 ? 0 : Math.hypot(b.x - a.x, b.y - a.y) / dt;
    } else cursor.speed = 0;
  }
  const tileAt = (x, y) => Math.floor(y / TILE) * 1000 + Math.floor(x / TILE);

  // ---------- update ----------
  function update(dt, nowS, ctx) {
    measure(nowS);
    const moving = cursor.on && cursor.speed > 6;
    cursor.still = cursor.on && cursor.speed < STILL ? cursor.still + dt : 0;

    // grass: brushed by the cursor
    for (const g of grass) {
      if (moving && Math.abs(cursor.x - g.x) < 9 && cursor.y > g.y - 20 && cursor.y < g.y + 2) {
        g.shake = Math.min(1, g.shake + 0.5 + cursor.speed / 400);
      }
      g.shake = Math.max(0, g.shake - dt * 0.9);
      g.phase += dt * 18;
    }

    // tree tops: a moving cursor shakes leaves loose
    if (moving && cursor.speed > 40) {
      const k = tileAt(cursor.x, cursor.y);
      if (canopy.has(k) && (canopyCool.get(k) || 0) < nowS && leaves.length < 40) {
        canopyCool.set(k, nowS + 1.2);
        const n = 1 + Math.round(Math.random() * (cursor.speed > 200 ? 3 : 1));
        const colors = leafColors(ctx.season);
        for (let i = 0; i < n; i++) {
          leaves.push({ x: cursor.x + rand(-6, 6), y: cursor.y + rand(-4, 4), vy: rand(10, 18), p: rand(0, 6),
            life: rand(1.6, 2.6), c: colors[Math.floor(Math.random() * colors.length)], w: Math.random() < 0.5 ? 3 : 4 });
        }
      }
    }
    for (let i = leaves.length - 1; i >= 0; i--) {
      const l = leaves[i];
      l.life -= dt; l.p += dt * 4; l.y += l.vy * dt; l.x += Math.sin(l.p) * 14 * dt;
      if (l.life <= 0) leaves.splice(i, 1);
    }

    // water: rings follow a moving cursor
    rippleCool -= dt;
    if (moving && rippleCool <= 0 && water.has(tileAt(cursor.x, cursor.y)) && ripples.length < 12) {
      ripples.push({ x: cursor.x, y: cursor.y, t: 0 });
      rippleCool = 0.18;
    }
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].t += dt; if (ripples[i].t > 0.9) ripples.splice(i, 1); }

    // animals: a fast swipe startles, a resting cursor gets a heart
    if (cursor.on && ctx.animals) {
      const A = ctx.animals;
      let room = BUDGET - A.busy();
      for (const a of A.outside()) {
        if (room <= 0) break;
        if (a.cooldown > 0 || a.emote) continue;
        if (cursor.speed > FAST && A.hit(a, cursor.x, cursor.y, 10)) { A.startle(a, cursor.x, cursor.y); room--; }
        else if (cursor.still > DWELL && A.hit(a, cursor.x, cursor.y, 4)) { A.pet(a, cursor.x, cursor.y); room--; }
      }
    }

    cat.update(dt, nowS, ctx);
  }

  function leafColors(season) {
    return {
      spring: ['#f7b6d2', '#fbd3e4', '#7fbf3f'], summer: ['#6fae3a', '#8cc84b', '#4f8f2c'],
      fall: ['#d9692b', '#e9a23b', '#b8452a'], winter: ['#e8f0ff', '#ffffff'],
    }[season] || ['#7fbf3f'];
  }

  // ---------- the pet ----------
  // A cat or a dog (six of each in the game; or none). Rests by the porch;
  // follows a moving cursor around the yard; sits or naps beside it when it
  // rests; sleeps by the door at night. Dogs are a bit quicker and keener.
  const PETS = [
    ['cat0', '橘猫'], ['cat1', '灰猫'], ['cat2', '黄猫'], ['cat3', '白猫'], ['cat4', '黑猫'], ['cat5', '紫猫'],
    ['dog0', '黄狗'], ['dog1', '牧羊犬'], ['dog2', '金毛'], ['dog3', '黑白花狗'], ['dog4', '棕狗'], ['dog5', '紫狗'],
  ];
  let petId = 'cat0';
  const cat = (() => {
    const c = { x: 0, y: 0, dir: 'down', state: 'sit', t: 0, timer: 3, home: null, area: null, target: null, still: 0 };
    const F = { down: [0, 1, 2, 3], right: [4, 5, 6, 7], up: [8, 9, 10, 11], left: [12, 13, 14, 15] };
    // sheet frames for resting poses: [sit, sit-blink, lie a, lie b, sleep a, sleep b]
    const POSE = { cat: [17, 18, 26, 27, 28, 29], dog: [24, 25, 28, 28, 28, 29] };
    const isDog = () => petId.startsWith('dog');
    const NEAR = 18;
    let SPEED = 26, FOLLOW = 150;

    function init(conf) {
      if (!conf) return;
      c.home = { x: conf.home[0], y: conf.home[1] };
      c.area = conf.area;
      c.x = c.home.x; c.y = c.home.y;
    }
    const clamp = p => ({
      x: Math.max(c.area.x, Math.min(c.area.x + c.area.w, p.x)),
      y: Math.max(c.area.y, Math.min(c.area.y + c.area.h, p.y)),
    });
    function walk(dt, to, speed) {
      const dx = to.x - c.x, dy = to.y - c.y, d = Math.hypot(dx, dy);
      if (d < 1) return true;
      const s = Math.min(d, speed * dt);
      c.x += (dx / d) * s; c.y += (dy / d) * s;
      c.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      return false;
    }
    // A spot just right of (or, if that's water or a wall, left of) the resting cursor,
    // about where the edge of a desktop icon is.
    function besideCursor() {
      const solid = (x, y) => SDV.layout && SDV.layout.isSolid && SDV.layout.isSolid(Math.floor(x / TILE), Math.floor(y / TILE));
      for (const dx of [24, -24, 0]) {
        const spot = { x: cursor.x + dx, y: cursor.y + 16 };
        if (!solid(spot.x, spot.y)) return spot;
      }
      return { x: cursor.x, y: cursor.y };
    }
    function update(dt, nowS, ctx) {
      if (!c.home || petId === 'none') return;
      SPEED = isDog() ? 34 : 26; FOLLOW = isDog() ? 175 : 150;
      c.t += dt;
      const night = ctx.lamps > 0.6;
      // The cursor has come to rest on the bare desktop (likely on an icon): trot over and sit beside it.
      const resting = cursor.on && !cursor.covered && !night && nowS - cursor.lastMove > 0.7;
      if (resting) {
        const spot = besideCursor();
        const far = Math.hypot(spot.x - c.x, spot.y - c.y);
        if (far > 2) {
          c.state = 'walk';
          walk(dt, spot, SPEED * (far > 40 ? (isDog() ? 2.4 : 2) : 1));
          c.still = 0;
        } else {
          if (c.state === 'walk') { c.state = 'sit'; c.dir = 'down'; }
          c.still += dt;
          if (c.still > 12 && c.state === 'sit') c.state = 'lie';
        }
        c.timer = 8;
        return;
      }
      const near = cursor.on && Math.hypot(cursor.x - c.x, cursor.y - c.y) < FOLLOW;
      const interested = near && nowS - cursor.lastMove < 4 && !night;

      if (interested) {
        // walk to a spot just short of the cursor
        const dx = cursor.x - c.x, dy = cursor.y - c.y, d = Math.hypot(dx, dy) || 1;
        if (d > NEAR + 4 && cursor.speed > STILL) {
          c.state = 'walk';
          walk(dt, clamp({ x: cursor.x - (dx / d) * NEAR, y: cursor.y - (dy / d) * NEAR }), SPEED * (d > 60 ? 1.6 : 1));
          c.still = 0;
        } else {
          c.still += dt;
          if (c.state === 'walk') c.state = 'sit';
          if (c.still > 5 && c.state === 'sit') c.state = 'lie';
        }
        c.timer = 6;
        return;
      }
      // not interested: after a while, go home and sit or nap
      c.timer -= dt;
      if (c.timer > 0 && c.state !== 'walk') return;
      const at = Math.hypot(c.x - c.home.x, c.y - c.home.y) < 2;
      if (!at) { c.state = 'walk'; if (walk(dt, c.home, SPEED)) { c.state = 'sit'; c.dir = 'down'; } }
      else if (c.state === 'walk') { c.state = 'sit'; c.dir = 'down'; c.timer = 8; }
      else if (night || ctx.wet) { c.state = 'sleep'; }
      else if (c.state === 'sit' && c.timer < -20) { c.state = 'lie'; }
    }
    function sprite(images) {
      const img = images['pet_' + petId];
      if (!img || !c.home) return null;
      const P = POSE[isDog() ? 'dog' : 'cat'];
      let f;
      if (c.state === 'walk') f = F[c.dir][Math.floor(c.t * (isDog() ? 10 : 8)) % 4];
      else if (c.state === 'sit') f = P[Math.floor(c.t / 3) % 7 === 0 ? 1 : 0];
      else if (c.state === 'lie') f = P[2 + (Math.floor(c.t / 1.2) % 2)];
      else f = P[4 + (Math.floor(c.t / 1.6) % 2)]; // sleep, breathing
      const x = Math.round(c.x - 16), y = Math.round(c.y - 30);
      return { y: c.y, draw(g) { g.drawImage(img, (f % 4) * 32, Math.floor(f / 4) * 32, 32, 32, x, y, 32, 32); } };
    }
    return { init, update, sprite, state: c };
  })();

  // ---------- drawing ----------
  const GRASS_ROW = { spring: 0, summer: 20, fall: 40, winter: 80 };
  function sprites(images, season, view) {
    const out = [];
    const img = images.grass;
    if (img) {
      const sy = GRASS_ROW[season] ?? 0;
      const x0 = (view.x0 - 1) * TILE, x1 = (view.x1 + 1) * TILE, y0 = (view.y0 - 1) * TILE, y1 = (view.y1 + 2) * TILE;
      for (const g of grass) {
        if (g.x < x0 || g.x > x1 || g.y < y0 || g.y > y1) continue;
        out.push({
          y: g.y,
          draw(ctx) {
            const angle = g.shake > 0 ? Math.sin(g.phase) * g.shake * 0.28 : 0;
            if (angle) {
              ctx.save();
              ctx.translate(g.x, g.y);
              ctx.rotate(angle);
              ctx.drawImage(img, g.v * 15, sy, 15, 20, -7.5, -20, 15, 20);
              ctx.restore();
            } else ctx.drawImage(img, g.v * 15, sy, 15, 20, g.x - 7.5, g.y - 20, 15, 20);
          },
        });
      }
    }
    const c = cat.sprite(images);
    if (c) out.push(c);
    return out;
  }
  // Ripples sit on the water, under everything else.
  function drawGround(ctx) {
    ctx.lineWidth = 1;
    for (const r of ripples) {
      const k = r.t / 0.9;
      ctx.strokeStyle = `rgba(230, 245, 255, ${0.7 * (1 - k)})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 2 + k * 9, 1 + k * 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Falling leaves, above the tree tops.
  function drawAbove(ctx) {
    for (const l of leaves) {
      ctx.globalAlpha = Math.min(1, l.life * 1.5);
      ctx.fillStyle = l.c;
      ctx.fillRect(Math.round(l.x), Math.round(l.y), l.w, 3);
    }
    ctx.globalAlpha = 1;
  }

  const recentlyActive = nowS => cursor.on && nowS - cursor.lastMove < 2;

  function setPet(id) { petId = id === 'none' || PETS.some(p => p[0] === id) ? id : 'cat0'; }

  return { PETS, setPet, pet: () => petId, init, setCursor, update, sprites, drawGround, drawAbove, recentlyActive, cursor, cat: cat.state };
})();
