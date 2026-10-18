/* Farm animals: a small state machine per animal.
 * inside → exiting → (idle ⇄ wander / eat) → returning → inside */
window.SDV = window.SDV || {};
SDV.animals = (() => {
  'use strict';

  const r4 = a => [a, a + 1, a + 2, a + 3];
  // Frame numbers read off the sprite sheets (4 frames per row).
  const KINDS = {
    chicken: {
      fw: 16, fh: 16, speed: 14, flee: 4, home: 'coop',
      walk: { down: r4(0), right: r4(4), up: r4(8), left: r4(12) },
      eat: { left: { f: r4(24), fps: 10 }, right: { f: r4(24), fps: 10 } },
    },
    cow: {
      fw: 32, fh: 32, speed: 10, flee: 1.8, home: 'barn',
      walk: { down: r4(0), right: r4(4), up: r4(8), left: { f: r4(4), flip: true } },
      eat: {
        down: { f: [12, 13], fps: 1.5 }, right: { f: [14], fps: 1 },
        left: { f: [14], fps: 1, flip: true }, up: { f: [15], fps: 1 },
      },
    },
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  let list = [];
  let homes = {};
  let pens = {};

  function doorPoint(home) {
    const d = home.door;
    return { x: home.x + d.x + d.w / 2, y: home.y + d.y + d.h - 2 };
  }
  function exitPoint(home) {
    const p = doorPoint(home);
    return { x: p.x, y: p.y + 14 };
  }
  function penPoint(kind) {
    const p = pens[kind];
    return { x: rand(p.x, p.x + p.w), y: rand(p.y, p.y + p.h) };
  }

  function init(config, outdoorNow) {
    homes = { coop: config.props.coop, barn: config.props.barn };
    pens = config.pens;
    list = config.animals.map(a => {
      const k = KINDS[a.kind];
      const out = outdoorNow;
      const p = out ? penPoint(a.kind) : doorPoint(homes[k.home]);
      return {
        kind: a.kind, img: a.img, k, x: p.x, y: p.y, dir: 'down',
        state: out ? 'idle' : 'inside', timer: rand(0, 3), t: rand(0, 10),
        path: [], delay: rand(2, 40), backDelay: null, emote: null, cooldown: 0,
      };
    });
  }

  const facing = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));

  function walkTo(a, dt) {
    const target = a.path[0];
    const dx = target.x - a.x, dy = target.y - a.y;
    const dist = Math.hypot(dx, dy);
    const step = a.k.speed * (a.state === 'flee' ? a.k.flee : 1) * dt;
    if (dist <= step) { a.x = target.x; a.y = target.y; a.path.shift(); return a.path.length === 0; }
    a.x += (dx / dist) * step; a.y += (dy / dist) * step;
    a.dir = facing(dx, dy);
    return false;
  }

  function update(dt, outdoorOK) {
    for (const a of list) {
      a.t += dt;
      const home = homes[a.k.home];
      if (!outdoorOK && a.state !== 'inside' && a.state !== 'returning') {
        if (a.backDelay == null) a.backDelay = rand(0, 12);
        a.backDelay -= dt;
        if (a.backDelay <= 0) {
          a.state = 'returning';
          a.path = [exitPoint(home), doorPoint(home)];
          a.backDelay = null;
        }
      }
      switch (a.state) {
        case 'inside':
          if (outdoorOK) {
            a.delay -= dt;
            if (a.delay <= 0) {
              Object.assign(a, doorPoint(home));
              a.state = 'exiting';
              a.path = [exitPoint(home)];
            }
          }
          break;
        case 'exiting':
          if (walkTo(a, dt)) { a.state = 'idle'; a.timer = rand(0.5, 2); }
          break;
        case 'idle':
          a.timer -= dt;
          if (a.timer <= 0) {
            const r = Math.random();
            if (r < 0.55) { a.state = 'wander'; a.path = [penPoint(a.kind)]; }
            else if (r < 0.85) {
              a.state = 'eat'; a.timer = rand(2, 6);
              if (a.kind === 'chicken' && (a.dir === 'up' || a.dir === 'down')) a.dir = Math.random() < 0.5 ? 'left' : 'right';
            } else { a.timer = rand(1, 4); }
          }
          break;
        case 'wander':
          if (walkTo(a, dt)) { a.state = 'idle'; a.timer = rand(1, 5); }
          break;
        case 'eat':
          a.timer -= dt;
          if (a.timer <= 0) { a.state = 'idle'; a.timer = rand(1, 3); }
          break;
        case 'returning':
          if (walkTo(a, dt)) { a.state = 'inside'; a.delay = rand(2, 40); }
          break;
        case 'flee':
          if (walkTo(a, dt)) { a.state = 'idle'; a.timer = rand(1, 3); }
          break;
        case 'look':
          a.timer -= dt;
          if (a.timer <= 0) { a.state = 'idle'; a.timer = rand(0.5, 2); }
          break;
      }
      if (a.emote) { a.emote.t += dt; if (a.emote.t > 2.2) a.emote = null; }
      if (a.cooldown > 0) a.cooldown -= dt;
    }
  }

  // ---------- reactions to the cursor ----------
  const OUT = new Set(['idle', 'wander', 'eat', 'flee', 'look']);
  function outside() { return list.filter(a => OUT.has(a.state)); }
  function busy() { return list.filter(a => a.emote || a.state === 'flee').length; }
  const clampPen = (kind, p) => {
    const r = pens[kind];
    return { x: Math.max(r.x, Math.min(r.x + r.w, p.x)), y: Math.max(r.y, Math.min(r.y + r.h, p.y)) };
  };
  // Startled by a fast swipe: run away from the cursor, with a "!".
  function startle(a, cx, cy) {
    let dx = a.x - cx, dy = a.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const reach = a.kind === 'chicken' ? 48 : 24;
    a.path = [clampPen(a.kind, { x: a.x + dx * reach + rand(-8, 8), y: a.y + dy * reach + rand(-8, 8) })];
    a.state = 'flee';
    a.emote = { id: 'alert', t: 0 };
    a.cooldown = 4;
  }
  // The cursor rested on it: stop, look at the cursor, show a heart.
  function pet(a, cx, cy) {
    a.state = 'look';
    a.timer = 2.5;
    a.dir = a.kind === 'chicken'
      ? (cx < a.x ? 'left' : 'right')
      : facing(cx - a.x, cy - (a.y - a.k.fh / 2));
    a.emote = { id: 'heart', t: 0 };
    a.cooldown = 8;
  }
  // Cursor hit-test against the animal's body (map px).
  function hit(a, cx, cy, pad) {
    const k = a.k;
    return cx >= a.x - k.fw / 2 - pad && cx <= a.x + k.fw / 2 + pad && cy >= a.y - k.fh - pad && cy <= a.y + pad;
  }

  // Emote bubbles, drawn above everything else in the scene.
  const EMOTE_ROW = { heart: 20, alert: 16 };
  function emotes(images) {
    const img = images.emotes;
    if (!img) return [];
    return list.filter(a => a.emote && a.state !== 'inside').map(a => ({
      draw(ctx) {
        const t = a.emote.t;
        let f;
        if (t < 0.24) f = Math.min(3, Math.floor(t / 0.06));                    // bubble pops up
        else if (t < 1.96) f = EMOTE_ROW[a.emote.id] + (Math.floor((t - 0.24) / 0.15) % 4);
        else f = 3 - Math.min(3, Math.floor((t - 1.96) / 0.06));               // and shrinks away
        const x = Math.round(a.x - 8), y = Math.round(a.y - a.k.fh - 14);
        ctx.drawImage(img, (f % 4) * 16, Math.floor(f / 4) * 16, 16, 16, x, y, 16, 16);
      },
    }));
  }

  function anyOutside(homeName) {
    return list.some(a => a.k.home === homeName && a.state !== 'inside');
  }

  // Sprites for the y-sorted pass: {y, draw(ctx)}.
  function sprites(images) {
    const out = [];
    for (const a of list) {
      if (a.state === 'inside') continue;
      const img = images[a.img];
      if (!img) continue;
      const k = a.k;
      let anim, fps = a.state === 'flee' ? 12 : 6;
      const moving = a.state === 'wander' || a.state === 'exiting' || a.state === 'returning' || a.state === 'flee';
      if (a.state === 'eat' && k.eat[a.dir]) { anim = k.eat[a.dir]; fps = anim.fps; }
      else anim = k.walk[a.dir];
      const frames = Array.isArray(anim) ? anim : anim.f;
      const flip = !Array.isArray(anim) && anim.flip;
      const idx = moving || a.state === 'eat' ? frames[Math.floor(a.t * fps) % frames.length] : frames[0];
      const sx = (idx % 4) * k.fw, sy = Math.floor(idx / 4) * k.fh;
      const x = Math.round(a.x - k.fw / 2), y = Math.round(a.y - k.fh + 2);
      out.push({
        y: a.y,
        draw(ctx) {
          SpriteFrames.draw(ctx,img,sx,sy,k.fw,k.fh,x,y,flip);
        },
      });
    }
    return out;
  }

  function summary() {
    const out = list.filter(a => a.state !== 'inside').length;
    return `${out}/${list.length} 只在外面`;
  }

  return { init, update, sprites, emotes, anyOutside, summary, outside, busy, startle, pet, hit };
})();
