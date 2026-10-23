/* First-run setup, shown by the app in its own window.
 *  1. The app looks for Stardew Valley on this Mac (Steam, App Store / GOG) — or the
 *     user points at it — and lists the game's Content folder for us.
 *  2. We ask the app for each file we need, unpack it here (lib/xnb.js: LZX/LZ4 +
 *     Texture2D, lib/tbin.js: the farm map) and hand back PNGs and data/farm.js,
 *     which the app saves next to the scene. Nothing is sent anywhere else.
 *  3. The user says whether they'd like the game's seasonal music. (Weather follows
 *     the Mac's time zone; there is no city to pick.)
 * The game's files are only read; the pictures stay on this Mac. */
(() => {
  'use strict';

  const DATA_VERSION = '9';
  const tr = (...a) => (window.SDV_I18N ? SDV_I18N.L(...a) : a[0]);
  const SEASONS = ['spring', 'summer', 'fall', 'winter'];
  const HIDDEN_LAYERS = ['Paths'];
  // Big sheets the scene only needs a corner of: [x, y, w, h]
  const CROP = { cursors: [140, 373, 280, 138], houses: [0, 0, 160, 432],   // the farmhouse, its three upgrade levels stacked
    orders: [0, 0, 338, 198],
    // the cork bulletin board on the front of Pierre's shop, in each season's town tilesheet
    board_spring: [122, 291, 36, 20], board_summer: [122, 291, 36, 20], board_fall: [122, 291, 36, 20], board_winter: [122, 291, 36, 20] };
  const EXTRAS = [
    ['Buildings/houses', 'houses', '农舍'],
    ['LooseSprites/Cursors', 'cursors', '时钟、气泡与对话框'],
    ['LooseSprites/SpecialOrdersBoard', 'orders', '公告板'],
    ['Buildings/Coop', 'coop', '鸡舍'],
    ['Buildings/Barn', 'barn', '畜棚'],
    ['Buildings/Stable', 'stable', '马厩'],
    ['Buildings/Mailbox', 'mailbox', '信箱'],
    ['Buildings/Shipping Bin', 'shipping_bin', '出货箱'],
    // the other buildings a save can have (for「从存档导入布局」)
    ['Buildings/Big Coop', 'coop_big', '建筑'], ['Buildings/Deluxe Coop', 'coop_deluxe', '建筑'],
    ['Buildings/Big Barn', 'barn_big', '建筑'], ['Buildings/Deluxe Barn', 'barn_deluxe', '建筑'],
    ['Buildings/Silo', 'b_silo', '建筑'], ['Buildings/Well', 'b_well', '建筑'], ['Buildings/Shed', 'b_shed', '建筑'],
    ['Buildings/Big Shed', 'b_bigshed', '建筑'], ['Buildings/Slime Hutch', 'b_slimehutch', '建筑'], ['Buildings/Mill', 'b_mill', '建筑'],
    ['Buildings/Gold Clock', 'b_goldclock', '建筑'], ['Buildings/Junimo Hut', 'b_junimohut', '建筑'], ['Buildings/Fish Pond', 'b_fishpond', '建筑'],
    ['Buildings/Greenhouse', 'b_greenhouse', '建筑'],
    ['Buildings/Earth Obelisk', 'b_obelisk_earth', '建筑'], ['Buildings/Water Obelisk', 'b_obelisk_water', '建筑'],
    ['Buildings/Desert Obelisk', 'b_obelisk_desert', '建筑'], ['Buildings/Island Obelisk', 'b_obelisk_island', '建筑'],
    ...['Log', 'Plank', 'Stone', 'Rustic', 'Neighbor', 'Trailer', 'Beach'].map(n => [`Buildings/${n} Cabin`, `b_cabin_${n.toLowerCase()}`, '建筑']),
    ['Animals/White Chicken', 'chicken_white', '鸡'],
    ['Animals/Brown Chicken', 'chicken_brown', '鸡'],
    ['Animals/White Cow', 'cow_white', '奶牛'],
    ['Animals/Brown Cow', 'cow_brown', '奶牛'],
    ['TerrainFeatures/grass', 'grass', '草丛'],
    ['TileSheets/emotes', 'emotes', '表情'],
    ['TileSheets/critters', 'critters', '小动物'],
    ['TerrainFeatures/Flooring', 'flooring', '石板路'],
    ['TerrainFeatures/Flooring_winter', 'flooring_winter', '石板路'],
    ['LooseSprites/Fence1', 'fence_wood', '围栏'],
    ['TileSheets/crops', 'crops', '作物'],
    ['TileSheets/Craftables', 'craftables', '小物件'],
    ['Maps/springobjects', 'springobjects', '杂物'],
    ['TerrainFeatures/hoeDirt', 'hoedirt', '耕地'],
    ['TerrainFeatures/hoeDirtSnow', 'hoedirt_snow', '耕地'],
    ...['Lewis', 'Robin', 'Pierre', 'Emily', 'Linus', 'Willy'].map(n => [`Characters/${n}`, `npc_${n.toLowerCase()}`, '村民']),
    ...[0, 1, 2, 3, 4, 5].flatMap(i => [[`Animals/cat${i || ''}`, `pet_cat${i}`, '猫'], [`Animals/dog${i || ''}`, `pet_dog${i}`, '狗']]),
    ...SEASONS.flatMap(s => [
      [`TerrainFeatures/tree1_${s}`, `tree1_${s}`, '树'],
      [`TerrainFeatures/tree2_${s}`, `tree2_${s}`, '树'],
      [`TerrainFeatures/tree3_${s === 'summer' ? 'spring' : s}`, `tree3_${s}`, '树'],
      [`Maps/${s}_town`, `board_${s}`, '公告栏'],
    ]),
  ];

  // The farm types, in the game's own order (a save's whichFarm counts the same way).
  const FARMS = [
    ['standard', '标准农场', 'Maps/Farm'], ['riverland', '河边农场', 'Maps/Farm_Fishing'],
    ['forest', '森林农场', 'Maps/Farm_Foraging'], ['hilltop', '山顶农场', 'Maps/Farm_Mining'],
    ['wilderness', '荒野农场', 'Maps/Farm_Combat'], ['fourcorners', '四角农场', 'Maps/Farm_FourCorners'],
    ['beach', '海滩农场', 'Maps/Farm_Island'], ['meadowlands', '草原农场', 'Maps/Farm_Ranching'],
  ];
  const mapData = map => ({
    id: map.id,
    properties: map.properties,
    tilesheets: map.tilesheets.map(t => ({
      id: t.id, image: t.image, seasonal: t.seasonal,
      cols: t.sheetSize.x, rows: t.sheetSize.y, tw: t.tileSize.x, th: t.tileSize.y,
      margin: t.margin, spacing: t.spacing,
      water: Object.keys(t.properties).map(k => k.match(/^@TileIndex@(\d+)@Water$/i)).filter(Boolean).map(m => Number(m[1])),
      diggable: Object.keys(t.properties).map(k => k.match(/^@TileIndex@(\d+)@Diggable$/i)).filter(Boolean).map(m => Number(m[1])),
    })),
    layers: map.layers.map(l => ({ id: l.id, visible: l.visible, w: l.size.x, h: l.size.y, tiles: l.tiles })),
  });

  const $ = id => document.getElementById(id);
  const post = msg => { try { window.webkit.messageHandlers.sdv.postMessage(msg); } catch { console.log('post', msg.type); } };
  const show = id => document.querySelectorAll('.step').forEach(s => s.classList.toggle('on', s.id === id));

  // ---------- talking to the app ----------
  let index = new Map();                 // lower-case path without .xnb -> real relative path
  const waiting = new Map();
  let nextId = 1;
  function read(rel) {
    const real = index.get(rel.toLowerCase());
    if (!real) return Promise.resolve(null);
    const id = nextId++;
    return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); post({ type: 'read', id, path: real }); });
  }
  function b64ToBytes(b64) {
    const s = atob(b64), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  function bytesToB64(u) {
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const write = (path, bytes) => post({ type: 'write', path, b64: bytesToB64(bytes) });

  // ---------- unpacking ----------
  async function unpack(rel) {
    const bytes = await read(rel);
    if (!bytes) return null;
    return XNB.bufferToContents(bytes.buffer);
  }
  const written = [];
  async function texture(rel, name) {
    const res = await unpack(rel);
    if (!res) return false;
    if (res.type !== 'Texture2D') throw new Error(tr('{0} 不是图片（{1}）', rel, res.type));
    let blob = res.content;
    if (CROP[name]) {
      const [x, y, w, h] = CROP[name];
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    write(`img/${name}.png`, new Uint8Array(await blob.arrayBuffer()));
    written.push(name);
    return true;
  }

  // The game's Chinese dialogue font (a pixel SpriteFont): the glyph sheet goes to
  // img/font.png (white, with the game's own baked-in shadow in the alpha), the glyph
  // boxes to font.js. The bulletin board writes with it, like the game's menus.
  async function font(rel) {
    const bytes = await read(rel);
    if (!bytes) return false;
    const f = XNB.bufferToXnb(bytes.buffer).content;
    const t = f && f.texture && f.texture.export;
    if (!t || !t.data || !f.characterMap) return false;
    const px = new Uint8ClampedArray(t.width * t.height * 4);
    for (let i = 0; i < px.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = t.data[i + 3]; }
    const c = document.createElement('canvas');
    c.width = t.width; c.height = t.height;
    c.getContext('2d').putImageData(new ImageData(px, t.width, t.height), 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    write('img/font.png', new Uint8Array(await blob.arrayBuffer()));
    const g = [];
    f.characterMap.forEach((_, i) => {
      const a = f.glyphs[i], b = f.cropping[i], k = f.kerning[i];
      g.push(a.x, a.y, a.width, a.height, b.x, b.y, Math.round(k.x), Math.round(k.y), Math.round(k.z));
    });
    const data = { chars: f.characterMap.join(''), g, ls: f.verticalLineSpacing, hs: f.horizontalSpacing };
    write('font.js', new TextEncoder().encode(`window.SDV_FONT = ${JSON.stringify(data)};\n`));
    return true;
  }

  async function extract() {
    show('step-read');
    const bar = $('bar'), label = $('label');
    // every farm map the game has (the farm type picked in the settings window); the
    // standard farm goes into farm.js, the others into maps/<key>.js, loaded when chosen
    const jobs = [], sheetJobs = new Set(), farms = [], maps = {};
    for (const [key, name, rel] of FARMS) {
      label.textContent = tr('正在读取：{0}的地图', tr(name));
      const res = await unpack(rel).catch(e => { if (key === 'standard') throw e; console.warn(rel, e); return null; });
      if (!res) { if (key === 'standard') throw new Error(tr('游戏文件里找不到农场地图（Maps/Farm）')); continue; }
      const map = SDV_TBIN.parseTbin(new Uint8Array(await res.content.arrayBuffer()));
      // tilesheets the visible layers use, in all four seasons when they change with the season
      const used = new Set();
      map.layers.filter(l => !HIDDEN_LAYERS.includes(l.id)).forEach(l => l.tiles.forEach(row => row.forEach(t => {
        if (!t) return;
        (t.a || [t]).forEach(f => used.add(f.s));
      })));
      const sheets = [];
      map.tilesheets.forEach((ts, i) => {
        const src = ts.imageSource.replace(/\\/g, '/');
        const base = src.split('/').pop();
        const dir = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : 'Maps';
        const seasonal = SEASONS.find(s => base.toLowerCase().startsWith(`${s}_`));
        ts.image = seasonal ? base.slice(seasonal.length + 1) : base;
        ts.seasonal = Boolean(seasonal);
        if (!used.has(i)) return;
        if (seasonal) SEASONS.forEach(s => { sheets.push(`${s}_${ts.image}`); if (!sheetJobs.has(`${s}_${ts.image}`)) { sheetJobs.add(`${s}_${ts.image}`); jobs.push([`${dir}/${s}_${ts.image}`, `${s}_${ts.image}`, '地形']); } });
        else { sheets.push(base); if (!sheetJobs.has(base)) { sheetJobs.add(base); jobs.push([`${dir}/${base}`, base, '地形', `Maps/${base}`]); } }
      });
      maps[key] = mapData(map);
      farms.push({ key, name, w: map.layers[0].size.x, h: map.layers[0].size.y, sheets, props: map.properties });
    }
    jobs.push(...EXTRAS);

    const missing = [];
    for (let i = 0; i < jobs.length; i++) {
      const [rel, name, zh, alt] = jobs[i];
      label.textContent = tr('正在读取：{0}（{1}/{2}）', tr(zh), i + 1, jobs.length);
      bar.style.width = `${Math.round(((i + 1) / (jobs.length + 1)) * 100)}%`;
      const ok = (await texture(rel, name)) || (alt && (await texture(alt, name)));
      if (!ok) missing.push(rel);
    }
    label.textContent = tr('正在读取：游戏字体');
    try { if (!(await font('Fonts/SpriteFont1.zh-CN'))) missing.push('Fonts/SpriteFont1.zh-CN'); }
    catch (e) { console.warn('font', e); missing.push('Fonts/SpriteFont1.zh-CN'); }
    const data = {
      extractedAt: new Date().toISOString(),
      version: DATA_VERSION,
      crops: { cursors: CROP.cursors.slice(0, 2), houses: CROP.houses.slice(0, 2) },
      map: maps.standard,
      farms: farms.map(f => ({ key: f.key, name: f.name, w: f.w, h: f.h, sheets: f.sheets })),
      images: written,
    };
    write('farm.js', new TextEncoder().encode(`window.SDV_DATA = ${JSON.stringify(data)};\n`));
    for (const f of farms) {
      if (f.key === 'standard') continue;
      write(`maps/${f.key}.js`, new TextEncoder().encode(`(window.SDV_MAPS = window.SDV_MAPS || {})[${JSON.stringify(f.key)}] = ${JSON.stringify(maps[f.key])};\n`));
    }
    write('version.txt', new TextEncoder().encode(DATA_VERSION));
    bar.style.width = '100%';
    label.textContent = missing.length ? tr('读好了（有 {0} 个小素材没找到，不影响使用）', missing.length) : tr('读好了');
    if (missing.length) console.warn('missing', missing);
  }

  function doneStep(music) {
    show('step-done');
    $('music').checked = music === 'always' || music === 'saver';
    $('done').focus();
  }

  // ---------- flow ----------
  window.SDV_SETUP = {
    // from the app: where the game is (or null) and what's in it
    start(info) {
      if (info.lang && window.SDV_I18N) { SDV_I18N.set(info.lang); SDV_I18N.dom(document.body); document.title = info.lang === 'en' ? 'Stardew Desk setup' : 'Stardew Desk 设置'; }
      if (!info.content) {
        show('step-find');
        $('find-msg').textContent = info.tried
          ? tr('这个位置里没找到星露谷的游戏文件，再选一次试试。')
          : tr('没在常见的位置找到星露谷物语。');
        return;
      }
      index = new Map(info.files.filter(f => /\.xnb$/i.test(f)).map(f => [f.replace(/\.xnb$/i, '').toLowerCase(), f]));
      $('where').textContent = info.content;
      extract().then(() => doneStep(info.music)).catch(e => {
        show('step-find');
        $('find-msg').textContent = tr('读取失败：{0}', e.message || e);
      });
    },
    file(id, b64) { const w = waiting.get(id); if (w) { waiting.delete(id); w.resolve(b64 == null ? null : b64ToBytes(b64)); } },
  };

  $('choose').onclick = () => post({ type: 'choose' });
  $('done').onclick = () => post({ type: 'finish', music: $('music').checked ? 'always' : 'off' });
  document.querySelectorAll('[data-version]').forEach(n => { n.textContent = DATA_VERSION; });
  show('step-hello');
  post({ type: 'hello' });
})();
