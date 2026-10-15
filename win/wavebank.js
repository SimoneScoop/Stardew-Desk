/* Take tracks out of Stardew Valley's wave bank (Content/XACT/Wave Bank.xwb) as small
 * Microsoft-ADPCM WAV files, for the optional background music and sound effects.
 * Same format notes as mac/musicx.js: XACT 3 wave bank, compact 24-byte entries,
 * tracks stored as XACT ADPCM (= MS ADPCM). On Windows nothing is converted: the
 * player window (audio.html) decodes the ADPCM itself. Only reads the game's file. */
'use strict';
const fs = require('fs');
const path = require('path');

const COEF = [[256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232]];

function readAt(fd, off, len) {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const r = fs.readSync(fd, b, got, len - got, off + got);
    if (!r) break;
    got += r;
  }
  return b.subarray(0, got);
}
function parse(fd) {
  const head = readAt(fd, 0, 52);
  if (head.toString('latin1', 0, 4) !== 'WBND') throw new Error('不是星露谷的音乐文件（wave bank）');
  const seg = [];
  for (let i = 0; i < 5; i++) seg.push({ off: head.readUInt32LE(12 + i * 8), len: head.readUInt32LE(16 + i * 8) });
  const bank = readAt(fd, seg[0].off, seg[0].len);
  const count = bank.readUInt32LE(4), metaSize = bank.readUInt32LE(72);
  const meta = readAt(fd, seg[1].off, seg[1].len);
  return { seg, count, metaSize, meta };
}
function entry(wb, index) {
  if (index < 0 || index >= wb.count) throw new Error('没有第 ' + index + ' 段音频');
  const o = index * wb.metaSize;
  const fmt = wb.meta.readUInt32LE(o + 4);
  return {
    tag: fmt & 3, channels: (fmt >>> 2) & 7, rate: (fmt >>> 5) & 0x3ffff, align: (fmt >>> 23) & 0xff,
    offset: wb.meta.readUInt32LE(o + 8), length: wb.meta.readUInt32LE(o + 12),
  };
}
function layout(e) {
  const blockAlign = (e.align + 22) * e.channels;
  return { blockAlign, samplesPerBlock: (blockAlign / e.channels - 7) * 2 + 2 };
}
function wavHeader(e, dataLen) {
  const L = layout(e), blocks = Math.floor(dataLen / L.blockAlign);
  const h = Buffer.alloc(90);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(h.length - 8 + dataLen, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(50, 16);
  h.writeUInt16LE(2, 20); h.writeUInt16LE(e.channels, 22); h.writeUInt32LE(e.rate, 24);
  h.writeUInt32LE(Math.floor(e.rate * L.blockAlign / L.samplesPerBlock), 28);
  h.writeUInt16LE(L.blockAlign, 32); h.writeUInt16LE(4, 34); h.writeUInt16LE(32, 36);
  h.writeUInt16LE(L.samplesPerBlock, 38); h.writeUInt16LE(7, 40);
  for (let i = 0; i < 7; i++) { h.writeInt16LE(COEF[i][0], 42 + i * 4); h.writeInt16LE(COEF[i][1], 44 + i * 4); }
  h.write('fact', 70, 'latin1'); h.writeUInt32LE(4, 74); h.writeUInt32LE(blocks * L.samplesPerBlock, 78);
  h.write('data', 82, 'latin1'); h.writeUInt32LE(dataLen, 86);
  return h;
}

// tracks: [[name, waveIndex], …] → writes <outDir>/<name>.wav, skipping ones already there.
// Returns the names that are ready.
function extract(xwb, outDir, tracks, log) {
  fs.mkdirSync(outDir, { recursive: true });
  const fd = fs.openSync(xwb, 'r');
  const done = [];
  try {
    const wb = parse(fd);
    for (const [name, index] of tracks) {
      const dst = path.join(outDir, name + '.wav');
      try { if (fs.statSync(dst).size > 20000) { done.push(name); continue; } } catch { /* not there yet */ }
      const e = entry(wb, index);
      if (e.tag !== 2) { if (log) log(name + '：不是 ADPCM（' + e.tag + '），跳过'); continue; }
      const data = readAt(fd, wb.seg[4].off + e.offset, e.length);
      const tmp = dst + '.part';
      fs.writeFileSync(tmp, Buffer.concat([wavHeader(e, data.length), data]));
      fs.renameSync(tmp, dst);
      done.push(name);
      if (log) log(name + ' 已取出（' + Math.round(data.length / 1024) + ' KB）');
    }
  } finally {
    fs.closeSync(fd);
  }
  return done;
}

module.exports = { extract, wavHeader, layout };
