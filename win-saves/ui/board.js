/* The bulletin board: today's to-dos and the countdown to the end of the working day.
 *
 * A wooden board stands on the farm (movable like the mailbox) with one paper note
 * per open to-do. A slip above it always shows the countdown — and, if a daily pay is
 * set, what today has earned so far; resting the cursor on the board opens the full
 * notice: progress, countdown and the to-do list.
 *
 * The desktop scene can't be clicked (clicks belong to the desktop icons), so to-dos
 * and pay are edited in the settings window (panel below) or ticked off from the leaf
 * menu. The app keeps the data; nothing leaves the Mac.
 *
 * Data: {todos: [{id, text, done, doneDay}], pay: {daily, start, end, lunch, lunchStart,
 *        lunchEnd, days: [0–6]}, show, showMoney, remind, today: {day, mode: 'work'|'off'}} */
window.SDV = window.SDV || {};
SDV.board = (() => {
  'use strict';

  const DEFAULT = {
    todos: [],
    pay: { daily: 0, start: '09:00', end: '18:00', lunch: false, lunchStart: '12:00', lunchEnd: '13:30', days: [1, 2, 3, 4, 5] },
    show: true, showMoney: true, remind: true, today: null,
  };
  let B = normalize(null);

  function normalize(v) {
    const o = v && typeof v === 'object' ? v : {};
    const pay = { ...DEFAULT.pay, ...(o.pay || {}) };
    if (!Array.isArray(pay.days)) pay.days = DEFAULT.pay.days.slice();
    return {
      todos: Array.isArray(o.todos) ? o.todos.filter(t => t && t.id && typeof t.text === 'string') : [],
      pay,
      show: o.show !== false, showMoney: o.showMoney !== false, remind: o.remind !== false, sound: o.sound !== false,
      today: o.today && o.today.day ? o.today : null,
      payOn: o.payOn != null ? Boolean(o.payOn) : Boolean(o.pay),   // countdown wanted at all
    };
  }
  function set(v) { B = normalize(v); spriteKey = ''; renderPanel(); checkTicks(); }
  // Notice to-dos that just got ticked (here or elsewhere) so the scene can send their
  // note flying into the shipping bin. The first data we get is only remembered.
  let doneBefore = null, onTicked = () => {};
  function checkTicks() {
    const now = {};
    for (const t of B.todos) now[t.id] = Boolean(t.done);
    if (doneBefore) for (const id of Object.keys(now)) if (now[id] && doneBefore[id] === false) onTicked(id);
    doneBefore = now;
  }
  const get = () => JSON.parse(JSON.stringify(B));

  // ---------- time and pay ----------
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;   // same as the app's
  const WEEK = '日一二三四五六';
  const mins = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const hms = sec => { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`; };
  const money = v => `${Math.floor(v + 1e-9)}金`;          // whole gold, the way the game shows money

  function workday(date) {
    const o = B.today;
    if (o && o.day === dayKey(date)) return o.mode === 'work';
    return B.pay.days.includes(date.getDay());
  }
  // Where today's working day stands. null when no countdown is set up.
  function pay(date) {
    if (!B.payOn) return null;
    const p = B.pay, s = mins(p.start), e = mins(p.end);
    if (s == null || e == null || e <= s) return null;
    const daily = Math.max(0, Number(p.daily) || 0);
    if (!workday(date)) return { status: 'rest', daily };
    const ls = mins(p.lunchStart), le = mins(p.lunchEnd);
    const lunch = Boolean(p.lunch) && ls != null && le != null && ls > s && le > ls && le < e;
    const paid = e - s - (lunch ? le - ls : 0);
    const m = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000;
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const worked = cl(m, s, e) - s - (lunch ? cl(m, ls, le) - ls : 0);
    const status = m < s ? 'before' : m >= e ? 'after' : lunch && m >= ls && m < le ? 'lunch' : 'work';
    return {
      status, daily, progress: worked / paid, earned: (daily * worked) / paid,
      toEnd: (e - m) * 60, toStart: (s - m) * 60, toLunchEnd: lunch ? (le - m) * 60 : 0, sinceEnd: (m - e) * 60, lunchEnd: p.lunchEnd,
    };
  }
  const todos = date => B.todos.filter(t => !t.done || t.doneDay === dayKey(date));
  const openCount = date => todos(date).filter(t => !t.done).length;

  // ---------- the board itself (original pixel art, 32×32) ----------
  let sprite = null;
  // The board on the farm, 40×30. Its face is the cork bulletin board from the front of
  // Pierre's shop (the town tilesheet of the season); legs and top beam are drawn here in
  // the game's wood colours, with snow on the beam in winter. Without the game picture it
  // falls back to a hand-drawn board with one note per open to-do.
  const BW = 40, BH = 30;
  let spriteKey = '';
  function image(date, images, season) {
    const face = images && images[`board_${season}`];
    const n = Math.min(3, openCount(date)) || (pay(date) ? 1 : 0);
    const key = face ? `game-${season}` : `own-${n}`;
    if (key === spriteKey && sprite) return sprite;
    spriteKey = key;
    sprite = sprite || document.createElement('canvas');
    sprite.width = BW; sprite.height = BH;
    const g = sprite.getContext('2d');
    g.clearRect(0, 0, BW, BH);
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    if (face) {
      R(4, BH - 1, 32, 1, 'rgba(0,0,0,0.2)');
      for (const x of [6, 31]) { R(x - 1, 21, 5, 8, '#3d1f0f'); R(x, 21, 3, 8, '#6b3b1f'); R(x, 21, 1, 8, '#9a5a2a'); }
      g.drawImage(face, 0, 0, 36, 20, 2, 3, 36, 20);
      R(0, 0, BW, 4, '#3d1f0f'); R(1, 1, BW - 2, 2, '#7a4422'); R(1, 1, BW - 2, 1, '#a8622c');
      if (season === 'winter') { R(1, 0, BW - 2, 1, '#f4f9ff'); R(0, 1, BW, 1, '#dce8f5'); R(4, -1 + 1, 9, 1, '#ffffff'); R(22, 0, 12, 1, '#ffffff'); }
      return sprite;
    }
    g.save(); g.translate(4, -2);
    const W2 = 32;
    // posts
    for (const x of [5, 24]) { R(x - 1, 16, 5, 15, '#2b1a0e'); R(x, 16, 3, 14, '#6b4226'); R(x, 16, 1, 14, '#8a5a33'); }
    // board
    R(1, 4, 30, 18, '#2b1a0e');
    R(2, 5, 28, 16, '#8a5a33');
    R(3, 6, 26, 14, '#b07a45');
    for (let y = 9; y < 20; y += 4) R(3, y, 26, 1, '#96643a');
    // cap
    R(0, 2, W2, 3, '#2b1a0e');
    R(1, 3, 30, 1, '#6b4226');
    // notes, one per open to-do (the timetable when there are none)
    const NOTES = [[5, 8, 7, 9, '#d94a3a'], [14, 7, 6, 10, '#3a7bd9'], [22, 9, 5, 8, '#3aa84a']];
    NOTES.slice(0, n).forEach(([x, y, w, h, pin]) => {
      R(x, y, w, h, '#fbe7c0');
      R(x, y + h - 1, w, 1, '#d6b98a');
      for (let ly = y + 3; ly < y + h - 2; ly += 2) R(x + 1, ly, w - 2 - ((ly / 2) % 2), 1, '#b39a76');
      R(x + Math.floor(w / 2), y - 1, 1, 2, pin);
    });
    g.restore();
    return sprite;
  }

  // ---------- the notice drawn over the scene (screen px) ----------
  const C = { paper: '#f7e2b5', edge: '#5b3a22', line: '#c47a2c', ink: '#3a2414', dim: '#8a6a48', gold: '#a8661a', green: '#5daa3c', bar: '#e2c48e' };
  let hoverFor = 0, outFor = 0, open = false, lastRect = null;
  let hits = [];             // to-do rows on screen (device px) while the notice is open: [{x, y, w, h, id}]
  let onToggle = () => {};

  function compactLines(date) {
    const P = pay(date), n = openCount(date);
    const L = [];
    if (P) {
      if (P.status === 'rest') L.push('今天休息 🌿');
      else if (P.status === 'before') L.push(`距上班 ${hms(P.toStart)}`);
      else if (P.status === 'after') { L.push('下班啦！'); if (B.showMoney && P.daily) L.push(`今日 ${money(P.daily)} 到手`); }
      else {
        if (B.showMoney && P.daily) L.push(`已挣 ${money(P.earned)}`);
        L.push(P.status === 'lunch' ? `午休中 · ${P.lunchEnd} 继续` : `下班 ${hms(P.toEnd)}`);
      }
    } else if (n) L.push(`待办 ${n} 项`);
    return L;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function paper(g, x, y, w, h, k) {
    roundRect(g, x, y, w, h, 4 * k);
    g.fillStyle = C.edge; g.fill();
    roundRect(g, x + 2.5 * k, y + 2.5 * k, w - 5 * k, h - 5 * k, 2.5 * k);
    g.fillStyle = C.paper; g.fill();
    g.strokeStyle = C.line; g.lineWidth = 1 * k;
    roundRect(g, x + 4.5 * k, y + 4.5 * k, w - 9 * k, h - 9 * k, 1.5 * k);
    g.stroke();
  }
  const font = (px, k, bold) => `${bold ? '600 ' : ''}${px * k}px -apple-system, "PingFang SC", sans-serif`;

  // anchor: the board's top-centre on screen; cursor: {x, y} on screen or null; k: device px per CSS px
  function draw(g, opts) {
    const { anchor, cursor, overBoard, dt, k, W, H } = opts;
    const date = new Date();
    hits = [];
    if (!B.show) { lastRect = null; open = false; return; }
    const inPanel = cursor && lastRect && open && cursor.x >= lastRect.x && cursor.x < lastRect.x + lastRect.w && cursor.y >= lastRect.y && cursor.y < lastRect.y + lastRect.h;
    if (overBoard || inPanel) { hoverFor += dt; outFor = 0; } else { outFor += dt; hoverFor = 0; }
    if (!open && hoverFor > 0.35) open = true;
    if (open && outFor > 0.6) open = false;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.textBaseline = 'middle';
    g.imageSmoothingEnabled = false;
    const look = gameLook(opts.images, opts.cur);
    if (open) lastRect = look.orders ? drawBoardNotice(g, date, anchor, k, W, H, look, cursor) : drawFull(g, date, anchor, k, W, H, cursor);
    else lastRect = look.paper || look.box ? drawSlip(g, date, anchor, k, W, H, look) : drawCompact(g, date, anchor, k, W, H);
    g.restore();
  }
  // The open notice on screen (device px), for the app's click catcher; null when closed.
  const rect = () => (open && lastRect ? { ...lastRect } : null);
  // A click on the notice (device px): ticks the to-do under it. True if one changed.
  function click(x, y) {
    const h = hits.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    if (!h) return false;
    const t = B.todos.find(x => x.id === h.id);
    if (!t) return false;
    t.done = !t.done;
    t.doneDay = t.done ? dayKey(new Date()) : undefined;
    spriteKey = '';
    renderPanel();
    checkTicks();
    onToggle(get());
    return true;
  }

  // ---------- the game's own look (pieces read from the player's copy of the game) ----------
  // LooseSprites/SpecialOrdersBoard: the wooden board with two taped notes (0, 0, 338, 198).
  // LooseSprites/Cursors: the cream text box (384, 373, 18×18, 6 px corners) and the
  // options checkbox (227 / 236, 425, 9×9). Text in the game's ink with its tan shadow.
  const INK = '#221122', SHADOW = 'rgba(206,156,95,0.85)', DIM = '#7d5a3c', GOLD = '#8a4b12';
  function gameLook(images, cur) {
    const c = images && images.cursors, o = images && images.orders;
    const cx = cur ? cur[0] : 0, cy = cur ? cur[1] : 0;
    const inCrop = (x, y, w, h) => c && x - cx >= 0 && y - cy >= 0 && x - cx + w <= c.width && y - cy + h <= c.height;
    return {
      cursors: c, cx, cy, orders: o || null,
      box: inCrop(384, 373, 18, 18),
      check: inCrop(227, 425, 9, 9),
      moneyBox: inCrop(340, 474, 65, 15),       // the gold counter under the clock
      coin: inCrop(193, 373, 9, 10),            // the shop's gold coin
      digits: inCrop(286, 430, 5, 80) ? tinted(c, 286 - cx, 430 - cy) : null,   // its digits, 9 at the top … 0 at the bottom
      paper: o ? paperOf(o) : null,
    };
  }
  // The game draws the money digits white-on-transparent tinted Color.Maroon.
  let tintCache = null;
  function tinted(img, sx, sy) {
    if (tintCache && tintCache.img === img) return tintCache.c;
    const c = document.createElement('canvas');
    c.width = 5; c.height = 80;
    const g = c.getContext('2d');
    g.drawImage(img, sx, sy, 5, 80, 0, 0, 5, 80);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(128,0,0)'; g.fillRect(0, 0, 5, 80);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, sx, sy, 5, 80, 0, 0, 5, 80);
    tintCache = { img, c };
    return c;
  }
  // The left note of the special-orders board (with its tape), lifted off the wood: a
  // paper the slip is cut from. Wood and the board's dark edges become transparent.
  let paperCache = null;
  const PAPER = [13, 12, 149, 173];                       // x, y, w, h in the board texture
  function paperOf(img) {
    if (paperCache && paperCache.img === img) return paperCache.c;
    const [x, y, w, h] = PAPER;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const r = a[i], gg = a[i + 1], b = a[i + 2];
      const bright = r > 205 && gg > 170;
      const grey = Math.abs(r - gg) < 22 && Math.abs(gg - b) < 40 && r > 120;     // tape
      if (!bright && !grey) a[i + 3] = 0;
    }
    g.putImageData(d, 0, 0);
    paperCache = { img, c };
    return c;
  }
  // 9-slice of that paper: the corners (with the tape) stay whole.
  function paperBox(g, L, x, y, w, h, s) {
    const img = L.paper, [, , pw, ph] = PAPER, c = 26, C = c * s;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    const mw = pw - 2 * c, mh = ph - 2 * c;
    const cols = [[0, c, x, C], [c, mw, x + C, w - 2 * C], [pw - c, c, x + w - C, C]];
    const rows = [[0, c, y, C], [c, mh, y + C, h - 2 * C], [ph - c, c, y + h - C, C]];
    for (const [sx, sw, dx, dw] of cols) for (const [sy, sh, dy, dh] of rows) if (dw > 0 && dh > 0) g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  // The gold counter: the box from the HUD and right-aligned maroon digits in its 8 slots.
  function goldCounter(g, L, value, x, y, s) {
    g.drawImage(L.cursors, 340 - L.cx, 474 - L.cy, 65, 15, Math.round(x), Math.round(y), 65 * s, 15 * s);
    const str = String(Math.max(0, Math.min(99999999, Math.floor(value + 1e-9))));
    for (let i = 0; i < str.length; i++) {
      const slot = 8 - str.length + i, d = Number(str[i]);
      g.drawImage(L.digits, 0, 72 - d * 8, 5, 8, Math.round(x + (10 + slot * 6) * s), Math.round(y + 4 * s), 5 * s, 8 * s);
    }
  }
  function nine(g, L, x, y, w, h, s) {
    const img = L.cursors, sx = 384 - L.cx, sy = 373 - L.cy, c = 6, m = 6, C = c * s;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    const pcs = [[0, 0, x, y, C, C], [c + m, 0, x + w - C, y, C, C], [0, c + m, x, y + h - C, C, C], [c + m, c + m, x + w - C, y + h - C, C, C],
      [c, 0, x + C, y, w - 2 * C, C], [c, c + m, x + C, y + h - C, w - 2 * C, C], [0, c, x, y + C, C, h - 2 * C], [c + m, c, x + w - C, y + C, C, h - 2 * C],
      [c, c, x + C, y + C, w - 2 * C, h - 2 * C]];
    for (const [px, py, dx, dy, dw, dh] of pcs) g.drawImage(img, sx + px, sy + py, px === c ? m : c, py === c ? m : c, dx, dy, dw, dh);
  }
  function say(g, t, x, y, px, k, o = {}) {
    g.font = font(px, k, o.bold !== false);
    g.textAlign = o.align || 'left';
    if (o.shadow !== false) { g.fillStyle = SHADOW; g.fillText(t, x + 1.5 * k, y + 1.5 * k); }
    g.fillStyle = o.color || INK;
    g.fillText(t, x, y);
    g.textAlign = 'left';
  }
  // Numbers in the counter's maroon pixel digits; ':' is two pixel dots. Returns the width in texels.
  const digitsWidth = str => [...str].reduce((w, ch) => w + (ch === ':' ? 3 : 6), 0) - 1;
  function pixelDigits(g, L, str, x, y, cs) {
    let tx = 0;
    for (const ch of str) {
      if (ch === ':') {
        g.fillStyle = 'rgb(128,0,0)';
        g.fillRect(Math.round(x + tx * cs), Math.round(y + 2 * cs), cs, cs);
        g.fillRect(Math.round(x + tx * cs), Math.round(y + 5 * cs), cs, cs);
        tx += 3;
      } else if (ch >= '0' && ch <= '9') {
        g.drawImage(L.digits, 0, 72 - Number(ch) * 8, 5, 8, Math.round(x + tx * cs), Math.round(y), 5 * cs, 8 * cs);
        tx += 6;
      }
    }
    return tx - 1;
  }
  // A countdown in the game's cream text box (the hover-hint box), centred on cx, middle at cy.
  function clockBox(g, L, str, cx, cy, cs) {
    const tw = digitsWidth(str), w = tw + 14, h = 18;
    const x = Math.round(cx - (w * cs) / 2), y = Math.round(cy - (h * cs) / 2);
    nine(g, L, x, y, w * cs, h * cs, cs);
    pixelDigits(g, L, str, x + 7 * cs, y + 5 * cs, cs);
  }
  // A price like the shop's: label, the number in pixel digits, then the gold coin.
  function priceTag(g, L, label, value, cx, cy, s, k) {
    const num = String(Math.max(0, Math.floor(value + 1e-9)));
    g.font = font(11, k, false);
    const lw = g.measureText(label).width, gap = 5 * k;
    const dw = digitsWidth(num) * s, coin = 9 * s;
    const total = lw + gap + dw + 2 * s + coin;
    let x = cx - total / 2;
    say(g, label, x, cy, 11, k, { color: DIM, shadow: false, bold: false });
    x += lw + gap;
    pixelDigits(g, L, num, x, cy - 4 * s, s);
    x += dw + 2 * s;
    g.drawImage(L.cursors, 193 - L.cx, 373 - L.cy, 9, 10, Math.round(x), Math.round(cy - 5 * s), 9 * s, 10 * s);
  }
  // The game's empty options box; a ticked one gets a green pixel tick drawn over it.
  const TICK = [            // relative to the box's top-left, in texels; may poke out at the top right
    '..........hh',
    '.........hgg',
    '........hggd',
    '.......hggd.',
    '.hh...hggd..',
    '.hggh.ggd...',
    '..dggggd....',
    '...dggd.....',
    '....dd......',
  ];
  const TICK_C = { h: '#b4f07a', g: '#4caf3a', d: '#2b6b23' };
  function checkbox(g, L, on, x, y, s) {
    x = Math.round(x); y = Math.round(y);
    g.drawImage(L.cursors, 227 - L.cx, 425 - L.cy, 9, 9, x, y, 9 * s, 9 * s);
    if (!on) return;
    TICK.forEach((row, j) => [...row].forEach((ch, i) => {
      if (TICK_C[ch]) { g.fillStyle = TICK_C[ch]; g.fillRect(x + i * s, y + (j - 2) * s, s, s); }
    }));
  }

  // The slip over the board: the game's text box.
  // What the slip says, as rows of [label, number] in the game's pixel digits (and the
  // gold coin after money), or a plain line of text.
  function slipRows(date) {
    const P = pay(date), n = openCount(date), R = [];
    const gold = v => String(Math.max(0, Math.floor(v + 1e-9)));
    if (P) {
      const withMoney = B.showMoney && P.daily;
      if (P.status === 'rest') { R.push({ text: '今天休息' }); if (n) R.push({ label: '待办', num: String(n) }); }
      else if (P.status === 'before') R.push({ label: '距上班', num: hms(P.toStart) });
      else if (P.status === 'after') { R.push({ text: '下班啦！' }); if (withMoney) R.push({ label: '今日', num: gold(P.daily), coin: true }); }
      else {
        if (withMoney) R.push({ label: '已挣', num: gold(P.earned), coin: true });
        R.push(P.status === 'lunch' ? { label: '午休到', num: P.lunchEnd } : { label: '下班', num: hms(P.toEnd) });
      }
    } else if (n) R.push({ label: '待办', num: String(n) });
    return R;
  }

  // The slip over the board: a note of the game's paper, numbers in its pixel digits.
  function drawSlip(g, date, anchor, k, W, H, L) {
    if (!(L.digits && L.coin)) return drawSlipText(g, date, anchor, k, W, H, L);
    const rows = slipRows(date);
    if (!rows.length) return null;
    const cs = Math.max(2, Math.round(2 * k));               // digit texel → device px
    const rh = 21 * k, gap = 6 * k;
    g.font = font(12.5, k, true);
    const widths = rows.map(r => r.text ? g.measureText(r.text).width
      : g.measureText(r.label).width + gap + digitsWidth(r.num) * cs + (r.coin ? 11 * cs : 0));
    const tw = Math.max(...widths);
    let r;
    if (L.paper) {
      const s = Math.max(1, Math.round(k));
      const w = Math.max(60 * s, Math.ceil(tw + 30 * s)), h = Math.max(54 * s, Math.ceil(rows.length * rh + 30 * s));
      r = place(anchor, w, h, k, W, H);
      g.save(); g.globalAlpha = 0.25; g.fillStyle = '#000';
      g.fillRect(r.x + 3 * s, r.y + r.h - 2 * s, r.w - 6 * s, 3 * s); g.restore();
      paperBox(g, L, r.x, r.y, r.w, r.h, s);
    } else {
      const s = Math.max(2, Math.round(2 * k));
      r = place(anchor, Math.ceil(tw + 16 * s), Math.ceil(rows.length * rh + 12 * s), k, W, H);
      nine(g, L, r.x, r.y, r.w, r.h, s);
    }
    const top = r.y + (r.h - rows.length * rh) / 2 + 2 * k;
    rows.forEach((row, i) => {
      const cy = Math.round(top + rh * (i + 0.5));
      let x = Math.round(r.x + (r.w - widths[i]) / 2);
      if (row.text) { say(g, row.text, x, cy, 12.5, k); return; }
      say(g, row.label, x, cy, 12.5, k);
      x += g.measureText(row.label).width + gap;
      x += pixelDigits(g, L, row.num, x, cy - 4 * cs, cs) * cs;
      if (row.coin) g.drawImage(L.cursors, 193 - L.cx, 373 - L.cy, 9, 10, Math.round(x + 2 * cs), Math.round(cy - 5 * cs), 9 * cs, 10 * cs);
    });
    return r;
  }
  // (the same slip in plain text, for game data from before the digits were read)
  function drawSlipText(g, date, anchor, k, W, H, L) {
    const lines = compactLines(date);
    if (!lines.length) return null;
    g.font = font(12.5, k, true);
    const lh = 17 * k;
    const tw = Math.max(...lines.map(t => g.measureText(t).width));
    let r, padX, padY;
    if (L.paper) {
      const s = Math.max(1, Math.round(k));
      const w = Math.max(56 * s, Math.ceil(tw + 28 * s)), h = Math.max(54 * s, Math.ceil(lines.length * lh + 26 * s));
      r = place(anchor, w, h, k, W, H);
      paperBox(g, L, r.x, r.y, r.w, r.h, s);
      padY = (r.h - lines.length * lh) / 2 + 2 * s;
      padX = (r.w - tw) / 2;
    } else {
      const s = Math.max(2, Math.round(2 * k));
      padX = 6 * s + 4 * k; padY = 5 * s + 1 * k;
      r = place(anchor, Math.ceil(tw + padX * 2), Math.ceil(lines.length * lh + padY * 2), k, W, H);
      nine(g, L, r.x, r.y, r.w, r.h, s);
    }
    lines.forEach((t, i) => say(g, t, r.x + padX, r.y + padY + lh * (i + 0.5), 12.5, k, { color: /^已挣|^今日/.test(t) ? GOLD : INK }));
    return r;
  }

  // The open notice: the special-orders board, work on the left note, to-dos on the right.
  function drawBoardNotice(g, date, anchor, k, W, H, L, cursor) {
    const s = Math.max(2, Math.round(1.5 * k));             // device px per texel
    const r = place(anchor, 338 * s, 198 * s, k, W, H);
    g.drawImage(L.orders, 0, 0, 338, 198, r.x, r.y, 338 * s, 198 * s);
    const X = t => r.x + t * s, Y = t => r.y + t * s;
    // left note: the working day
    const P = pay(date), cxL = X(88);
    say(g, `${date.getMonth() + 1}月${date.getDate()}日 周${WEEK[date.getDay()]}`, cxL, Y(40), 13, k, { align: 'center' });
    const bar = (t, p) => {
      const bx = X(34), bw = 108 * s, bh = 5 * s, by = Y(t);
      g.fillStyle = '#5b3a22'; g.fillRect(bx - s, by - s, bw + 2 * s, bh + 2 * s);
      g.fillStyle = '#e8cfa0'; g.fillRect(bx, by, bw, bh);
      const fw = Math.round(bw * Math.max(0, Math.min(1, p)) / s) * s;
      if (fw > 0) { g.fillStyle = '#5daa3c'; g.fillRect(bx, by, fw, bh); g.fillStyle = '#8fd16a'; g.fillRect(bx, by, fw, s); }
    };
    if (!P) {
      say(g, '今天也辛苦啦', cxL, Y(92), 17, k, { align: 'center' });
      say(g, '设置窗口 → 公告板', cxL, Y(132), 11.5, k, { align: 'center', color: DIM, shadow: false, bold: false });
      say(g, '填上下班时间就有倒计时', cxL, Y(146), 11.5, k, { align: 'center', color: DIM, shadow: false, bold: false });
    } else if (P.status === 'rest') {
      say(g, '今天休息', cxL, Y(92), 22, k, { align: 'center' });
      say(g, '好好玩 🌿', cxL, Y(118), 13, k, { align: 'center', color: DIM });
    } else {
      const withMoney = B.showMoney && P.daily;
      let y = withMoney ? 64 : 70;
      if (withMoney) {
        const earned = P.status === 'after' ? P.daily : P.earned;
        say(g, '今日已挣', cxL, Y(y - 2), 11.5, k, { align: 'center', color: DIM, shadow: false, bold: false });
        const cs = s + Math.max(1, Math.round(k / 2));        // the counter one pixel step larger, still crisp
        if (L.moneyBox && L.digits) goldCounter(g, L, earned, cxL - (65 * cs) / 2, Y(y + 13) - (15 * cs) / 2, cs);
        else say(g, money(earned), cxL, Y(y + 13), 22, k, { align: 'center', color: GOLD });
        if (L.digits && L.coin) priceTag(g, L, '今日目标', P.daily, cxL, Y(y + 33), s, k);
        else say(g, `今日目标 ${money(P.daily)}`, cxL, Y(y + 33), 11, k, { align: 'center', color: DIM, shadow: false, bold: false });
        y += 50;
      }
      bar(y - 2, P.progress);
      y += 18;
      const label = P.status === 'before' ? '距离上班' : P.status === 'lunch' ? '午休中，到点继续' : P.status === 'after' ? '今天的活干完了' : '下班倒计时';
      const value = P.status === 'before' ? hms(P.toStart) : P.status === 'lunch' ? P.lunchEnd : P.status === 'after' ? '下班啦！' : hms(P.toEnd);
      say(g, label, cxL, Y(y), 11.5, k, { align: 'center', color: DIM, shadow: false, bold: false });
      if (P.status !== 'after' && L.digits && L.box) clockBox(g, L, value, cxL, Y(y + 21), s + Math.max(1, Math.round(k / 2)));
      else say(g, value, cxL, Y(y + 20), 22, k, { align: 'center' });
    }
    // right note: today's to-dos, ticked with the game's checkbox
    // kept in the order they were added, so a row never jumps away from under the cursor;
    // only a list too long for the note puts the open ones first
    const all = todos(date);
    const list = all.length > 6 ? all.slice().sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done))) : all;
    const done = list.filter(t => t.done).length;
    say(g, '今日待办', X(186), Y(44), 13, k);
    if (list.length) say(g, `${done}/${list.length}`, X(311), Y(44), 12, k, { align: 'right', color: DIM, shadow: false });
    g.fillStyle = '#e2c79a'; g.fillRect(X(186), Y(53), 126 * s, s);
    const ROW = 17, FIRST = 59, MAXROWS = 6;
    const shown = list.length > MAXROWS ? list.slice(0, MAXROWS - 1) : list;
    shown.forEach((t, i) => {
      const ry = Y(FIRST + i * ROW), rh = ROW * s, rx = X(184), rw = 130 * s;
      const hov = cursor && cursor.x >= rx && cursor.x < rx + rw && cursor.y >= ry && cursor.y < ry + rh;
      if (hov) { g.fillStyle = 'rgba(206,156,95,0.28)'; g.fillRect(rx, ry, rw, rh); }
      if (L.check) checkbox(g, L, t.done, X(187), ry + 4 * s, s);
      g.font = font(12.5, k, false);
      let txt = t.text;
      const maxW = 110 * s;
      while (txt.length > 1 && g.measureText(txt).width > maxW) txt = txt.slice(0, -1);
      if (txt !== t.text) txt = txt.slice(0, -1) + '…';
      say(g, txt, X(202), ry + rh / 2, 12.5, k, { bold: false, color: t.done ? DIM : INK, shadow: !t.done });
      if (t.done) { g.fillStyle = DIM; g.fillRect(X(202), ry + rh / 2, g.measureText(txt).width, Math.max(1, Math.round(k))); }
      hits.push({ x: rx, y: ry, w: rw, h: rh, id: t.id });
    });
    if (list.length > shown.length) say(g, `还有 ${list.length - shown.length} 项…`, X(200), Y(FIRST + shown.length * ROW + 8), 11.5, k, { color: DIM, shadow: false, bold: false });
    const foot = !list.length ? '还没有待办' : done === list.length ? '都做完啦 ✨' : '点一下就能勾掉';
    say(g, foot, X(249), Y(!list.length ? 100 : 160), !list.length ? 13 : 11, k, { align: 'center', color: DIM, shadow: false, bold: !list.length });
    if (!list.length) say(g, '在叶子菜单或设置窗口里添加', X(249), Y(118), 11, k, { align: 'center', color: DIM, shadow: false, bold: false });
    return r;
  }


  function place(anchor, w, h, k, W, H) {
    let x = Math.round(anchor.x - w / 2), y = Math.round(anchor.y - h - 4 * k);
    if (y < 8 * k) y = Math.round(anchor.y + anchor.h + 4 * k);           // no room above: below the board
    x = Math.max(8 * k, Math.min(W - w - 8 * k, x));
    y = Math.max(8 * k, Math.min(H - h - 8 * k, y));
    return { x, y, w, h };
  }

  function drawCompact(g, date, anchor, k, W, H) {
    const L = compactLines(date);
    if (!L.length) return null;
    g.font = font(12, k, true);
    const lh = 16 * k, padX = 10 * k, padY = 7 * k;
    const w = Math.max(...L.map(t => g.measureText(t).width)) + padX * 2;
    const h = L.length * lh + padY * 2;
    const r = place(anchor, w, h, k, W, H);
    paper(g, r.x, r.y, r.w, r.h, k);
    L.forEach((t, i) => {
      g.fillStyle = /^已挣|^今日/.test(t) ? C.gold : C.ink;
      g.fillText(t, r.x + padX, r.y + padY + lh * (i + 0.5));
    });
    return r;
  }

  function drawFull(g, date, anchor, k, W, H, cursor) {
    const P = pay(date), list = todos(date);
    const rows = [];   // [kind, text, extra]
    rows.push(['title', `公告板 · ${date.getMonth() + 1}月${date.getDate()}日 周${WEEK[date.getDay()]}`]);
    if (P) {
      if (P.status === 'rest') rows.push(['kv', '今天', '休息，好好玩 🌿']);
      else {
        if (B.showMoney && P.daily) rows.push(['kv', '今日已挣', `${money(P.status === 'after' ? P.daily : P.earned)}  /  ${money(P.daily)}`, 'gold']);
        rows.push(['bar', '', P.progress]);
        const cd = P.status === 'before' ? `还没上班 · ${hms(P.toStart)}` : P.status === 'after' ? '已经下班啦 🎉'
          : P.status === 'lunch' ? `午休中 · ${P.lunchEnd} 继续` : hms(P.toEnd);
        rows.push(['kv', '下班倒计时', cd, P.status === 'work' ? 'big' : '']);
      }
    }
    const done = list.filter(t => t.done).length;
    rows.push(['head', list.length ? `今日待办  ${done}/${list.length}` : '今日待办']);
    const shown = (list.length > 8 ? list.slice().sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done))) : list).slice(0, 8);
    if (!list.length) rows.push(['hint', '还没有待办 · 在叶子菜单或设置窗口里添加']);
    for (const t of shown) rows.push(['todo', t.text, t.done, t.id]);
    if (list.length > shown.length) rows.push(['hint', `还有 ${list.length - shown.length} 项…`]);
    else if (list.length && done === list.length) rows.push(['hint', '今天的事都做完啦 ✨']);

    const padX = 14 * k, padY = 12 * k;
    const H_ = { title: 22, kv: 22, bar: 12, head: 26, todo: 20, hint: 20 };
    const measure = ([kind, a, b]) => {
      if (kind === 'title') { g.font = font(13, k, true); return g.measureText(a).width; }
      if (kind === 'kv') { g.font = font(12, k); const l = g.measureText(a).width; g.font = font(b && String(b).length < 12 ? 15 : 12, k, true); return l + 14 * k + g.measureText(String(b)).width; }
      if (kind === 'todo') { g.font = font(12, k); return 20 * k + g.measureText(a).width; }
      g.font = font(12, k, kind === 'head'); return g.measureText(a).width;
    };
    const w = Math.min(360 * k, Math.max(230 * k, ...rows.map(measure))) + padX * 2;
    const h = rows.reduce((s, r) => s + H_[r[0]] * k, 0) + padY * 2;
    const r = place(anchor, w, h, k, W, H);
    paper(g, r.x, r.y, r.w, r.h, k);
    const x0 = r.x + padX, x1 = r.x + r.w - padX;
    let y = r.y + padY;
    const clip = (t, maxW) => { if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
    for (const [kind, a, b, style] of rows) {
      const rh = H_[kind] * k, cy = y + rh / 2;
      if (kind === 'title') { g.font = font(13, k, true); g.fillStyle = C.ink; g.fillText(a, x0, cy); }
      else if (kind === 'kv') {
        g.font = font(12, k); g.fillStyle = C.dim; g.fillText(a, x0, cy);
        g.font = font(style === 'big' ? 15 : 12, k, true); g.fillStyle = style === 'gold' ? C.gold : C.ink;
        g.textAlign = 'right'; g.fillText(String(b), x1, cy); g.textAlign = 'left';
      } else if (kind === 'bar') {
        const bh = 6 * k, by = cy - bh / 2;
        roundRect(g, x0, by, x1 - x0, bh, bh / 2); g.fillStyle = C.bar; g.fill();
        if (b > 0) { roundRect(g, x0, by, Math.max(bh, (x1 - x0) * Math.min(1, b)), bh, bh / 2); g.fillStyle = C.green; g.fill(); }
      } else if (kind === 'head') {
        g.strokeStyle = C.line; g.lineWidth = 1 * k;
        g.beginPath(); g.moveTo(x0, y + 4 * k); g.lineTo(x1, y + 4 * k); g.stroke();
        g.font = font(12, k, true); g.fillStyle = C.ink; g.fillText(a, x0, cy + 3 * k);
      } else if (kind === 'todo') {
        const bx = x0, bs = 11 * k, by = cy - bs / 2;
        g.strokeStyle = C.edge; g.lineWidth = 1.5 * k; g.strokeRect(bx, by, bs, bs);
        if (b) {
          g.strokeStyle = C.green; g.lineWidth = 2 * k;
          g.beginPath(); g.moveTo(bx + 2 * k, by + 5.5 * k); g.lineTo(bx + 4.5 * k, by + 8.5 * k); g.lineTo(bx + 9.5 * k, by + 2 * k); g.stroke();
        }
        g.font = font(12, k); g.fillStyle = b ? C.dim : C.ink;
        const t = clip(a, x1 - bx - 20 * k);
        if (style) hits.push({ x: x0, y, w: x1 - x0, h: rh, id: style });
        g.fillText(t, bx + 20 * k, cy);
        if (b) { const tw = g.measureText(t).width; g.fillRect(bx + 20 * k, cy, tw, 1 * k); }
      } else if (kind === 'hint') { g.font = font(11.5, k); g.fillStyle = C.dim; g.fillText(a, x0, cy); }
      y += rh;
    }
    return r;
  }

  // ---------- settings window: edit to-dos and pay ----------
  let ui = null, onChange = () => {};
  const $ = id => document.getElementById(id);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function changed() { spriteKey = ''; renderPanel(); checkTicks(); onChange(get()); }

  function bindPanel(cb) {
    onChange = cb || onChange;
    onToggle = onChange;
    if (!$('board-panel')) return;
    ui = true;
    if ($('board-open')) $('board-open').addEventListener('click', () => openPanel(!$('board-panel').classList.contains('on')));
    const add = () => {
      const t = $('todo-text').value.trim();
      if (!t) return;
      B.todos.push({ id: newId(), text: t.slice(0, 40), done: false });
      $('todo-text').value = '';
      changed();
    };
    $('todo-add').addEventListener('click', add);
    $('todo-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
    $('todo-list').addEventListener('click', e => {
      const li = e.target.closest('[data-id]');
      if (!li) return;
      const t = B.todos.find(x => x.id === li.dataset.id);
      if (!t) return;
      if (e.target.matches('.del')) B.todos = B.todos.filter(x => x !== t);
      else if (e.target.matches('input[type=checkbox]')) { t.done = e.target.checked; t.doneDay = t.done ? dayKey(new Date()) : undefined; }
      else return;
      changed();
    });
    $('todo-clear').addEventListener('click', () => { B.todos = B.todos.filter(t => !t.done); changed(); });
    const num = () => { B.pay.daily = Math.max(0, Number($('pay-daily').value) || 0); changed(); };
    $('pay-daily').addEventListener('change', num);
    $('pay-on').addEventListener('change', () => { B.payOn = $('pay-on').checked; changed(); });
    for (const [id, key] of [['pay-start', 'start'], ['pay-end', 'end'], ['pay-ls', 'lunchStart'], ['pay-le', 'lunchEnd']]) {
      $(id).addEventListener('change', () => { if (mins($(id).value) != null) { B.pay[key] = $(id).value; changed(); } });
    }
    $('pay-lunch').addEventListener('change', () => { B.pay.lunch = $('pay-lunch').checked; changed(); });
    $('pay-days').addEventListener('click', e => {
      const d = e.target.dataset && e.target.dataset.day;
      if (d == null) return;
      const n = Number(d), s = new Set(B.pay.days);
      s.has(n) ? s.delete(n) : s.add(n);
      B.pay.days = [...s].sort();
      changed();
    });
    for (const [id, key] of [['board-show', 'show'], ['board-money', 'showMoney'], ['board-remind', 'remind'], ['board-sound', 'sound']]) {
      $(id).addEventListener('change', () => { B[key] = $(id).checked; changed(); });
    }
    renderPanel();
  }
  function openPanel(on = true) {
    const p = $('board-panel');
    if (!p) return;
    if ($('board-open')) { p.classList.toggle('on', on); $('board-open').setAttribute('aria-pressed', String(on)); }
    if (on) { renderPanel(); $('todo-text').focus(); }
  }
  function renderPanel() {
    if (!ui) return;
    const date = new Date();
    const list = $('todo-list');
    list.innerHTML = '';
    const items = todos(date);
    for (const t of items) {
      const li = document.createElement('li');
      li.dataset.id = t.id;
      li.className = t.done ? 'done' : '';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = t.done;
      const sp = document.createElement('span'); sp.textContent = t.text;
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '×'; del.title = '删掉';
      li.append(cb, sp, del);
      list.appendChild(li);
    }
    if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '还没有待办'; list.appendChild(li); }
    $('todo-clear').hidden = !items.some(t => t.done);
    const ae = document.activeElement;
    const setv = (id, v) => { if (ae !== $(id)) $(id).value = v; };
    $('pay-on').checked = B.payOn;
    $('pay-fields').classList.toggle('off', !B.payOn);
    setv('pay-daily', B.pay.daily || '');
    setv('pay-start', B.pay.start); setv('pay-end', B.pay.end);
    setv('pay-ls', B.pay.lunchStart); setv('pay-le', B.pay.lunchEnd);
    $('pay-lunch').checked = Boolean(B.pay.lunch);
    document.querySelectorAll('#pay-days [data-day]').forEach(b => b.setAttribute('aria-pressed', String(B.pay.days.includes(Number(b.dataset.day)))));
    $('board-show').checked = B.show; $('board-money').checked = B.showMoney; $('board-remind').checked = B.remind;
    if ($('board-sound')) $('board-sound').checked = B.sound;
    previewLine();
  }
  function previewLine() {
    if (!ui) return;
    const P = pay(new Date());
    const s = mins(B.pay.start), e = mins(B.pay.end);
    let t = '';
    if (B.payOn && (s == null || e == null || e <= s)) t = '下班时间要晚于上班时间';
    else if (P && P.status === 'rest') t = '今天不是工作日';
    else if (P) t = [B.showMoney && P.daily ? `今日已挣 ${money(P.status === 'after' ? P.daily : P.earned)}` : '',
      P.status === 'before' ? `距上班 ${hms(P.toStart)}` : P.status === 'after' ? '已下班' : P.status === 'lunch' ? '午休中' : `下班倒计时 ${hms(P.toEnd)}`].filter(Boolean).join(' · ');
    $('pay-preview').textContent = t;
  }

  return { set, get, image, draw, rect, click, onToggle: cb => { onToggle = cb; }, onTicked: cb => { onTicked = cb; }, pay, compactLines, bindPanel, openPanel, previewLine, shown: () => B.show, dayKey };
})();
