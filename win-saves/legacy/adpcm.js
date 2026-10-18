/* Microsoft ADPCM WAV → 16-bit samples, for the player window (plain script, no modules).
 * Same decoder as mac/musicx.js. Web browsers can't play ADPCM WAVs themselves. */
(function (root) {
  'use strict';
  var COEF = [[256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232]];
  var ADAPT = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];

  // bytes: Uint8Array of a whole WAV file. Returns {channels, rate, data: Float32Array[]}.
  function decodeWav(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var fmt = null, data = null, p = 12;
    while (p + 8 <= bytes.length) {
      var id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      var len = dv.getUint32(p + 4, true);
      if (id === 'fmt ') fmt = { tag: dv.getUint16(p + 8, true), channels: dv.getUint16(p + 10, true), rate: dv.getUint32(p + 12, true),
        blockAlign: dv.getUint16(p + 20, true), samplesPerBlock: dv.getUint16(p + 26, true) };
      else if (id === 'data') { data = bytes.subarray(p + 8, Math.min(bytes.length, p + 8 + len)); break; }
      p += 8 + len + (len & 1);
    }
    if (!fmt || !data || fmt.tag !== 2) throw new Error('not an MS ADPCM wav');
    var ch = fmt.channels, blockAlign = fmt.blockAlign, spb = fmt.samplesPerBlock;
    var blocks = Math.floor(data.length / blockAlign);
    var out = [];
    for (var c = 0; c < ch; c++) out.push(new Float32Array(blocks * spb));
    var pred = new Int32Array(ch), delta = new Int32Array(ch), s1 = new Int32Array(ch), s2 = new Int32Array(ch);
    var c1 = new Int32Array(ch), c2 = new Int32Array(ch);
    var rd16 = function (q) { var v = data[q] | (data[q + 1] << 8); return v > 32767 ? v - 65536 : v; };
    var K = 1 / 32768;
    for (var b = 0; b < blocks; b++) {
      var q = b * blockAlign, base = b * spb, k;
      for (k = 0; k < ch; k++) { pred[k] = Math.min(6, data[q++]); c1[k] = COEF[pred[k]][0]; c2[k] = COEF[pred[k]][1]; }
      for (k = 0; k < ch; k++) { delta[k] = rd16(q); q += 2; }
      for (k = 0; k < ch; k++) { s1[k] = rd16(q); q += 2; }
      for (k = 0; k < ch; k++) { s2[k] = rd16(q); q += 2; }
      for (k = 0; k < ch; k++) { out[k][base] = s2[k] * K; out[k][base + 1] = s1[k] * K; }
      var nibbles = (spb - 2) * ch;
      for (var i = 0; i < nibbles; i++) {
        var byte = data[q + (i >> 1)];
        var nib = (i & 1) ? byte & 15 : byte >> 4;
        var cc = ch === 2 ? i & 1 : 0;
        var signed = nib >= 8 ? nib - 16 : nib;
        var predicted = (((s1[cc] * c1[cc]) + (s2[cc] * c2[cc])) / 256) | 0;
        var sample = predicted + signed * delta[cc];
        if (sample > 32767) sample = 32767; else if (sample < -32768) sample = -32768;
        s2[cc] = s1[cc]; s1[cc] = sample;
        delta[cc] = (ADAPT[nib] * delta[cc]) >> 8;
        if (delta[cc] < 16) delta[cc] = 16;
        out[cc][base + 2 + (ch === 2 ? i >> 1 : i)] = sample * K;
      }
    }
    return { channels: ch, rate: fmt.rate, data: out };
  }
  root.SDV_ADPCM = { decodeWav: decodeWav };
  if (typeof module !== 'undefined') module.exports = root.SDV_ADPCM;
})(typeof window !== 'undefined' ? window : globalThis);
