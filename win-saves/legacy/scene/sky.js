/* Sun position and day/night colour. */
window.SDV = window.SDV || {};
SDV.sky = (() => {
  'use strict';
  const rad = Math.PI / 180;

  // Solar altitude in degrees (SunCalc's low-precision formula).
  function sunAltitude(date, lat, lon) {
    const d = date.getTime() / 86400000 - 10957.5; // days since J2000
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const e = rad * 23.4397;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    const H = rad * (280.16 + 360.9856235 * d) + rad * lon - ra;
    const phi = rad * lat;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
  }

  // Multiply colour by sun altitude: night blue → dusk violet → golden → white.
  const KEYS = [
    [-90, [78, 90, 160]],
    [-12, [78, 90, 160]],
    [-6, [112, 108, 172]],
    [-2, [196, 150, 172]],
    [3, [255, 192, 146]],
    [12, [255, 234, 208]],
    [24, [255, 255, 255]],
  ];
  function tint(alt) {
    if (alt >= KEYS[KEYS.length - 1][0]) return KEYS[KEYS.length - 1][1].slice();
    for (let i = 1; i < KEYS.length; i++) {
      const [a1, c1] = KEYS[i];
      if (alt <= a1) {
        const [a0, c0] = KEYS[i - 1];
        const t = (alt - a0) / (a1 - a0);
        return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      }
    }
    return KEYS[0][1].slice();
  }

  // 0 in daylight, 1 at full night — how strongly lamps glow.
  const lampLevel = alt => Math.max(0, Math.min(1, (1 - alt) / 9));

  function phaseName(alt, hour) {
    if (alt > 10) return '白天';
    if (alt > -6) return hour < 12 ? '清晨' : '黄昏';
    return '夜晚';
  }

  return {
    sunAltitude,
    at(date, loc) {
      const alt = sunAltitude(date, loc.lat, loc.lon);
      return { alt, tint: tint(alt), lamps: lampLevel(alt), phase: phaseName(alt, date.getHours()) };
    },
  };
})();
