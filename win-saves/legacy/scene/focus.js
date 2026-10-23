/* Focus farming: a 25-minute (or 50-minute) focus timer started from the leaf menu.
 * The app keeps the time; this page only shows it — the focus plot is sown when the
 * timer starts, grows through the crop's phases as the minutes pass, and is ripe when
 * time is up. It stays ripe for ten minutes, then counts as shipped: the shipping bin
 * keeps today's tally. */
window.SDV = window.SDV || {};
SDV.focus = (() => {
  'use strict';

  // {start, dur, done, doneAt, crop, cropZh, log: {n, crops: {name: count}}}; times in epoch seconds
  let st = null;
  let lastDone = 0;            // doneAt we've already celebrated
  const SEASON_CROP = { spring: 'cauliflower', summer: 'melon', fall: 'pumpkin', winter: 'powdermelon' };
  const DAYS = { cauliflower: [1, 2, 4, 4, 1], melon: [1, 2, 3, 3, 3], pumpkin: [1, 2, 3, 4, 3], powdermelon: [1, 1, 1, 2, 2] };
  const RIPE_FOR = 600;        // seconds the ripe crop waits before it's shipped

  function set(s) { st = s && s.start ? s : (s && s.log ? { log: s.log } : null); }
  const now = () => Date.now() / 1000;

  // What the focus plot shows: {name, phase, ripe, regrowing:false} or null (bare soil).
  function state(season) {
    if (!st || !st.start) return null;
    const name = st.crop || SEASON_CROP[season] || 'pumpkin';
    const days = DAYS[name] || DAYS.pumpkin;
    const t = now();
    if (st.done) return t - st.doneAt < RIPE_FOR ? { name, phase: days.length, ripe: true, regrowing: false } : null;
    // spread the crop's real growing days over the focus time
    const total = days.reduce((a, b) => a + b, 0);
    const g = Math.max(0, Math.min(0.999, (t - st.start) / st.dur)) * total;
    let acc = 0, phase = 0;
    for (; phase < days.length; phase++) { acc += days[phase]; if (g < acc) break; }
    return { name, phase, ripe: false, regrowing: false };
  }
  // Minutes left, or null when no timer is running.
  function remaining() {
    if (!st || !st.start || st.done) return null;
    return Math.max(0, Math.ceil((st.start + st.dur - now()) / 60));
  }
  const tally = () => (st && st.log) || { n: 0, crops: {} };
  // True once per finished session, for a little celebration on screen.
  function justFinished() {
    if (st && st.done && st.doneAt !== lastDone && now() - st.doneAt < 60) { lastDone = st.doneAt; return true; }
    return false;
  }
  const finishedAgo = () => (st && st.done ? now() - st.doneAt : Infinity);

  return { set, state, remaining, tally, justFinished, finishedAgo, cropFor: s => SEASON_CROP[s] };
})();
