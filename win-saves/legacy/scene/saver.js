/* Screensaver mode: the camera tours the farm, and the in-game clock box
 * (date, weather, season, time, dial hand) sits in the top-right corner. */
window.SDV = window.SDV || {};
SDV.saver = (() => {
  'use strict';

  let TILE = 16, stops = [], speed = 12, mapW = 0, mapH = 0;
  const cam = { x: 0, y: 0, i: 0, from: null, to: null, t: 0, legT: 1, hold: 0 };

  function init(config, tile, mw, mh) {
    TILE = tile; mapW = mw; mapH = mh;
    const s = config.saver || {};
    speed = s.speed || 12;
    stops = (s.tour || [[64, 15, 8]]).map(([x, y, hold]) => ({ x: x * TILE + 8, y: y * TILE + 8, hold: hold || 8 }));
    cam.i = 0;
    cam.x = stops[0].x; cam.y = stops[0].y;
    cam.hold = stops[0].hold;
    cam.from = null;
  }

  const ease = t => t * t * (3 - 2 * t);
  function update(dt) {
    if (!stops.length) return;
    if (cam.from) {
      cam.t += dt;
      const k = ease(Math.min(1, cam.t / cam.legT));
      cam.x = cam.from.x + (cam.to.x - cam.from.x) * k;
      cam.y = cam.from.y + (cam.to.y - cam.from.y) * k;
      if (cam.t >= cam.legT) { cam.from = null; cam.hold = cam.to.hold; }
    } else {
      cam.hold -= dt;
      if (cam.hold <= 0) {
        const next = stops[(cam.i + 1) % stops.length];
        cam.i = (cam.i + 1) % stops.length;
        cam.from = { x: cam.x, y: cam.y };
        cam.to = next;
        cam.t = 0;
        cam.legT = Math.max(4, Math.hypot(next.x - cam.x, next.y - cam.y) / speed);
      }
    }
  }

  // Camera for a W×H canvas at an integer scale; positions snap to device pixels
  // so the slow pan stays smooth and the pixels stay crisp.
  function camera(W, H, cols) {
    const scale = Math.max(1, Math.round(W / (cols * TILE)));
    const vw = W / scale, vh = H / scale;
    let x = Math.max(0, Math.min(mapW - vw, cam.x - vw / 2));
    let y = Math.max(0, Math.min(mapH - vh, cam.y - vh / 2));
    x = Math.round(x * scale) / scale;
    y = Math.round(y * scale) / scale;
    return { scale, x, y };
  }

  // ---------- the clock box (LooseSprites/Cursors) ----------
  const BOX = [333, 431, 71, 43];
  const HAND = [324, 477, 7, 19];
  const WEATHER_ICON = { sunny: 341, cloudy: 341, fog: 365, rain: 365, storm: 377, snow: 413 };
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const SEASON_ROW = { spring: 0, summer: 1, fall: 2, winter: 3 };

  function drawHud(ctx, images, W, date, season, weather) {
    const img = images.cursors;
    if (!img) return;
    // new data keeps only a corner of the Cursors sheet; coordinates below are the game's
    const [CX, CY] = (window.SDV_DATA && SDV_DATA.crops && SDV_DATA.crops.cursors) || [0, 0];
    const k = Math.max(3, Math.round(W / 560));          // box pixel size in device px
    const bw = BOX[2] * k, margin = 12 * k / 3;
    const ox = W - bw - margin, oy = margin;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, BOX[0] - CX, BOX[1] - CY, BOX[2], BOX[3], ox, oy, BOX[2] * k, BOX[3] * k);

    // weather and season icons in their slots
    let wx = WEATHER_ICON[weather.type] ?? 341;
    if (weather.windy && weather.type === 'sunny') wx = season === 'fall' ? 401 : 353;
    ctx.drawImage(img, wx - CX, 421 - CY, 12, 8, ox + 29 * k, oy + 17 * k, 12 * k, 8 * k);
    ctx.drawImage(img, 406 - CX, 441 + SEASON_ROW[season] * 8 - CY, 12, 8, ox + 53 * k, oy + 17 * k, 12 * k, 8 * k);

    // dial hand: points left at 6:00, right at 2:00 the next morning
    const mins = (date.getHours() * 60 + date.getMinutes() - 360 + 1440) % 1440;
    const frac = Math.min(1, mins / (20 * 60));
    ctx.translate(ox + 22 * k, oy + 22 * k);
    ctx.rotate(-Math.PI / 2 + Math.PI * frac);
    ctx.drawImage(img, HAND[0] - CX, HAND[1] - CY, HAND[2], HAND[3], -3.5 * k, -17 * k, HAND[2] * k, HAND[3] * k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // date and time in the two bars
    ctx.fillStyle = '#56160c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(7.2 * k)}px -apple-system, "PingFang SC", sans-serif`;
    const cx = ox + 47 * k;
    ctx.fillText(`${WEEK[date.getDay()]}. ${date.getDate()}`, cx, oy + 8.5 * k);
    const h = date.getHours(), m = date.getMinutes();
    const h12 = ((h + 11) % 12) + 1;
    ctx.fillText(`${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`, cx, oy + 35.5 * k);
    ctx.restore();
  }

  return { init, update, camera, drawHud };
})();
