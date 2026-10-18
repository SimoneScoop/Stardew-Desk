/* Live weather (Open-Meteo), seasonal fallback, and weather particles. */
window.SDV = window.SDV || {};
SDV.weather = (() => {
  'use strict';

  const LABEL = { sunny: '晴', cloudy: '阴', fog: '雾', rain: '雨', storm: '雷雨', snow: '雪', windy: '大风' };
  // How much each weather darkens the scene (multiplied with the sky colour).
  const DIM = {
    sunny: [255, 255, 255], windy: [255, 255, 255], cloudy: [218, 218, 228], fog: [226, 229, 236],
    rain: [158, 170, 200], storm: [124, 130, 165], snow: [218, 223, 238],
  };

  // ---------- live data ----------
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('sdv.weatherLive') || 'null'); } catch { return null; } },
    set(v) { try { localStorage.setItem('sdv.weatherLive', JSON.stringify(v)); } catch { /* ignore */ } },
  };
  let live = store.get();          // {code, precip, wind, at}
  let lastAttempt = 0, failures = 0, cfg = null, loc = null;

  function fetchNow() {
    lastAttempt = Date.now();
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${loc.lat}&longitude=${loc.lon}`
      + '&current=weather_code,precipitation,wind_speed_10m&timezone=auto';
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(j => {
        const c = j.current || {};
        live = { code: c.weather_code, precip: c.precipitation || 0, wind: c.wind_speed_10m || 0, at: Date.now() };
        store.set(live);
        failures = 0;
      })
      .catch(err => { failures++; console.warn('天气获取失败', err.message); });
  }

  function setLive(l) {
    live = { code: l.code, precip: l.precip || 0, wind: l.wind || 0, at: l.at || Date.now() };
    store.set(live);
  }

  function start(config, location, opts = {}) {
    cfg = config; loc = location;
    if (opts.fetch === false) return;   // the mac app fetches and pushes setLive()
    if (!live || Date.now() - live.at > cfg.refreshMinutes * 60e3) fetchNow();
    setInterval(() => {
      // Back off 5 → 10 → 20 → 30 min after failures; otherwise every refreshMinutes.
      const wait = failures ? Math.min(cfg.refreshMinutes, 5 * 2 ** (failures - 1)) : cfg.refreshMinutes;
      if (Date.now() - lastAttempt >= wait * 60e3) fetchNow();
    }, 60e3);
  }

  // WMO weather code → scene weather.
  function fromLive(l) {
    const c = l.code;
    let type = 'sunny', heavy = false;
    if (c <= 1) type = 'sunny';
    else if (c <= 3) type = 'cloudy';
    else if (c === 45 || c === 48) type = 'fog';
    else if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) { type = 'rain'; heavy = c === 65 || c === 82 || l.precip > 4; }
    else if ((c >= 71 && c <= 77) || c === 85 || c === 86) { type = 'snow'; heavy = c === 75 || c === 86; }
    else if (c >= 95) { type = 'storm'; heavy = true; }
    const windy = l.wind >= cfg.windyKmh;
    return { type, heavy, windy, wind: l.wind };
  }

  // Deterministic "today's weather" when offline, weighted by season.
  function randomFor(date, season) {
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    let h = 2166136261;
    for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const r = ((h >>> 0) % 1000) / 1000;
    const table = {
      spring: [['rain', 0.2], ['windy', 0.25], ['cloudy', 0.15]],
      summer: [['storm', 0.06], ['rain', 0.14], ['cloudy', 0.1]],
      fall: [['rain', 0.18], ['windy', 0.3], ['cloudy', 0.15]],
      winter: [['snow', 0.35], ['cloudy', 0.2]],
    }[season];
    let acc = 0;
    for (const [type, p] of table) {
      acc += p;
      if (r < acc) return { type: type === 'windy' ? 'sunny' : type, heavy: false, windy: type === 'windy', wind: 0 };
    }
    return { type: 'sunny', heavy: false, windy: false, wind: 0 };
  }

  function current(date, season, override) {
    if (override) {
      const w = override === 'windy'
        ? { type: 'sunny', heavy: false, windy: true, wind: 30 }
        : { type: override, heavy: override === 'storm', windy: override === 'storm', wind: 0 };
      return { ...w, source: '手动' };
    }
    const fresh = live && Date.now() - live.at < cfg.offlineAfterHours * 3600e3;
    if (fresh) {
      const t = new Date(live.at);
      const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      return { ...fromLive(live), source: `实时 · ${hhmm} 更新` };
    }
    return { ...randomFor(date, season), source: '离线 · 按季节随机' };
  }

  function label(w) {
    let s = LABEL[w.type];
    if (w.type === 'rain' && w.heavy) s = '大雨';
    if (w.type === 'snow' && w.heavy) s = '大雪';
    if (w.windy && w.type !== 'storm') s += '，有风';
    return s;
  }

  // ---------- particles (view space, map px) ----------
  const ps = { rain: [], snow: [], debris: [], fog: [], flash: 0, nextBolt: 8 };
  let lastKey = '';
  const rand = (a, b) => a + Math.random() * (b - a);

  function reset(w, season, vw, vh) {
    const area = vw * vh;
    const rainN = w.type === 'rain' || w.type === 'storm' ? Math.round(area / (w.heavy ? 260 : 600)) : 0;
    const snowN = w.type === 'snow' ? Math.round(area / (w.heavy ? 180 : 420)) : 0;
    const leafy = (season === 'spring' || season === 'fall') && (w.type === 'sunny' || w.type === 'cloudy');
    const debrisN = leafy ? (w.windy ? 34 : 7) : (w.windy && season === 'summer' ? 14 : 0);
    ps.rain = Array.from({ length: rainN }, () => ({ x: rand(0, vw), y: rand(0, vh), v: rand(230, 320), l: rand(7, 12) }));
    ps.snow = Array.from({ length: snowN }, () => ({ x: rand(0, vw), y: rand(0, vh), v: rand(12, 26), p: rand(0, 6.28), s: Math.random() < 0.3 ? 2 : 1 }));
    const colors = {
      spring: ['#f7b6d2', '#fbd3e4', '#ffffff'], fall: ['#d9692b', '#e9a23b', '#b8452a'], summer: ['#6fae3a', '#8cc84b'],
    }[season] || ['#ffffff'];
    ps.debris = Array.from({ length: debrisN }, () => ({
      x: rand(0, vw), y: rand(0, vh), vx: rand(18, 34) * (w.windy ? 1.6 : 0.7), vy: rand(6, 14), p: rand(0, 6.28),
      c: colors[Math.floor(Math.random() * colors.length)], w: Math.random() < 0.5 ? 2 : 3,
    }));
    ps.fog = w.type === 'fog' ? Array.from({ length: 5 }, () => ({ x: rand(0, vw), y: rand(0, vh), r: rand(90, 160), v: rand(3, 7) })) : [];
  }

  function update(dt, w, season, vw, vh) {
    const key = `${w.type}|${w.heavy}|${w.windy}|${season}|${Math.round(vw / 50)}|${Math.round(vh / 50)}`;
    if (key !== lastKey) { reset(w, season, vw, vh); lastKey = key; }
    const slant = w.windy ? 0.45 : 0.18;
    for (const d of ps.rain) {
      d.y += d.v * dt; d.x -= d.v * slant * dt;
      if (d.y > vh) { d.y = -d.l; d.x = rand(0, vw + vh * slant); }
      if (d.x < -10) d.x += vw + 10;
    }
    for (const f of ps.snow) {
      f.y += f.v * dt; f.p += dt * 1.3; f.x += Math.sin(f.p) * 6 * dt + (w.windy ? 10 * dt : 0);
      if (f.y > vh) { f.y = -2; f.x = rand(0, vw); }
      if (f.x > vw) f.x -= vw;
    }
    for (const l of ps.debris) {
      l.p += dt * 3; l.x += l.vx * dt; l.y += (l.vy + Math.sin(l.p) * 10) * dt;
      if (l.x > vw + 4 || l.y > vh + 4) { l.x = rand(-40, vw * 0.6); l.y = -4; }
    }
    for (const b of ps.fog) { b.x += b.v * dt; if (b.x - b.r > vw) b.x = -b.r; }
    if (w.type === 'storm') {
      ps.nextBolt -= dt;
      if (ps.nextBolt <= 0) { ps.flash = 1; ps.nextBolt = rand(7, 20); ps.double = Math.random() < 0.5; }
    }
    if (ps.flash > 0) {
      ps.flash -= dt * 3;
      if (ps.flash <= 0 && ps.double) { ps.double = false; ps.flash = 0.7; }
    }
  }

  // Drawn before the day/night tint, so particles darken with the scene.
  function drawParticles(ctx, cam) {
    const ox = cam.x, oy = cam.y;
    ctx.fillStyle = 'rgba(170, 200, 255, 0.75)';
    for (const d of ps.rain) {
      const x = Math.round(ox + d.x), y = Math.round(oy + d.y);
      ctx.fillRect(x, y, 1, Math.round(d.l * 0.5));
      ctx.fillRect(x - 1, y + Math.round(d.l * 0.5), 1, Math.round(d.l * 0.5));
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (const f of ps.snow) ctx.fillRect(Math.round(ox + f.x), Math.round(oy + f.y), f.s, f.s);
    for (const l of ps.debris) {
      ctx.fillStyle = l.c;
      ctx.fillRect(Math.round(ox + l.x), Math.round(oy + l.y), l.w, 2);
    }
  }

  // Drawn after the tint.
  function drawOverlay(ctx, cam, vw, vh) {
    if (ps.fog.length) {
      ctx.fillStyle = 'rgba(232, 236, 244, 0.26)';
      ctx.fillRect(cam.x, cam.y, vw, vh);
      for (const b of ps.fog) {
        const g = ctx.createRadialGradient(cam.x + b.x, cam.y + b.y, 0, cam.x + b.x, cam.y + b.y, b.r);
        g.addColorStop(0, 'rgba(240, 243, 250, 0.32)');
        g.addColorStop(1, 'rgba(240, 243, 250, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(cam.x + b.x - b.r, cam.y + b.y - b.r, b.r * 2, b.r * 2);
      }
    }
    if (ps.flash > 0) {
      ctx.fillStyle = `rgba(235, 240, 255, ${Math.min(0.75, ps.flash * 0.75)})`;
      ctx.fillRect(cam.x, cam.y, vw, vh);
    }
  }

  return { start, setLive, current, label, update, drawParticles, drawOverlay, DIM, fetchNow };
})();
