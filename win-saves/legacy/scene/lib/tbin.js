/* tBIN10 (xTile binary map) parser -> plain JSON. Used by the first-run setup.
 * Format reference: xTile TbinFormat (strings = int32 length + UTF-8 bytes). */
window.SDV_TBIN = (() => {
  'use strict';
  function parseTbin(buf) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 0;
    const u8 = () => view.getUint8(p++);
    const i32 = () => { const v = view.getInt32(p, true); p += 4; return v; };
    const f32 = () => { const v = view.getFloat32(p, true); p += 4; return v; };
    const str = () => {
      const n = i32();
      const s = new TextDecoder().decode(buf.subarray(p, p + n));
      p += n;
      return s;
    };
    const size = () => ({ x: i32(), y: i32() });
    const props = () => {
      const n = i32();
      const out = {};
      for (let i = 0; i < n; i++) {
        const key = str();
        const type = u8();
        if (type === 0) out[key] = u8() !== 0;
        else if (type === 1) out[key] = i32();
        else if (type === 2) out[key] = f32();
        else if (type === 3) out[key] = str();
        else throw new Error(`unknown property type ${type} at ${p}`);
      }
      return out;
    };
  
    const magic = new TextDecoder().decode(buf.subarray(0, 6));
    if (magic !== 'tBIN10') throw new Error(`not a tBIN10 file (got "${magic}")`);
    p = 6;
  
    const map = { id: str(), description: str(), properties: props(), tilesheets: [], layers: [] };
  
    const tsCount = i32();
    for (let i = 0; i < tsCount; i++) {
      map.tilesheets.push({
        id: str(),
        description: str(),
        imageSource: str(),
        sheetSize: size(),
        tileSize: size(),
        margin: size(),
        spacing: size(),
        properties: props(),
      });
    }
  
    const layerCount = i32();
    for (let i = 0; i < layerCount; i++) {
      const layer = {
        id: str(),
        visible: u8() !== 0,
        description: str(),
        size: size(),
        tileSize: size(),
        properties: props(),
        // tiles[y][x] = null | {s: sheetIndex, i: tileIndex} | {a: [{s,i}...], ms: interval}
        tiles: [],
      };
      const sheetIndex = id => map.tilesheets.findIndex(t => t.id === id);
      let current = -1;
      const staticTile = () => {
        const index = i32();
        u8(); // blend mode
        const tp = props();
        const t = { s: current, i: index };
        if (Object.keys(tp).length) t.p = tp;
        return t;
      };
      for (let y = 0; y < layer.size.y; y++) {
        const row = new Array(layer.size.x).fill(null);
        let x = 0;
        while (x < layer.size.x) {
          const ch = String.fromCharCode(u8());
          if (ch === 'T') { current = sheetIndex(str()); }
          else if (ch === 'N') { x += i32(); }
          else if (ch === 'S') { row[x++] = staticTile(); }
          else if (ch === 'A') {
            const ms = i32();
            const frameCount = i32();
            const frames = [];
            while (frames.length < frameCount) {
              const c = String.fromCharCode(u8());
              if (c === 'T') current = sheetIndex(str());
              else if (c === 'S') frames.push(staticTile());
              else throw new Error(`bad animated frame marker "${c}" at ${p}`);
            }
            const tp = props();
            const t = { a: frames, ms };
            if (Object.keys(tp).length) t.p = tp;
            row[x++] = t;
          } else throw new Error(`bad tile marker "${ch}" at ${p - 1}`);
        }
        layer.tiles.push(row);
      }
      map.layers.push(layer);
    }
    return map;
  }
  return { parseTbin };
})();
