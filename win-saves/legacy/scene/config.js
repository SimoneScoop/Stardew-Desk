/* Stardew Desk — settings you may want to edit by hand. */
window.SDV = window.SDV || {};
SDV.config = {
  // Where the weather and the sun come from (Hangzhou).
  location: { name: '杭州', lat: 30.27, lon: 120.15 },

  fps: 15,
  targetCols: 36,                       // ~36 tiles across the screen
  frame: { cx: 64 * 16, cy: 17 * 16 },  // default composition centre, map px
  hiddenLayers: ['Paths'],

  weather: {
    refreshMinutes: 30,
    offlineAfterHours: 3,   // no data this long → seasonal random weather
    windyKmh: 15,           // above this, petals / leaves blow through
  },

  // Props placed on the farm, in map px (top-left of the sprite).
  props: {
    house:   { img: 'houses', src: [0, 0, 160, 144], x: 58 * 16, y: 130 },
    mailbox: { img: 'mailbox', src: [0, 0, 16, 32], x: 68 * 16, y: 14 * 16 },
    bin:     { img: 'shipping_bin', src: [0, 0, 32, 32], x: 71 * 16, y: 13 * 16 },
    // The bulletin board (drawn by board.js): to-dos and the countdown to the end of the day.
    board:   { img: 'board', src: [0, 0, 40, 30], x: 52 * 16 + 8, y: 15 * 16 + 2 },
    // An empty stable: park a horse-shaped desktop icon in it.
    stable:  { img: 'stable', src: [0, 0, 64, 96], x: 73 * 16, y: 13 * 16 },
    coop: {
      img: 'coop', src: [0, 0, 96, 112], x: 46 * 16, y: 9 * 16,
      door: { x: 32, y: 96, w: 16, h: 16, closed: [0, 112, 16, 16], open: [16, 112, 16, 16] },
    },
    barn: {
      img: 'barn', src: [0, 0, 112, 112], x: 45 * 16, y: 19 * 16,
      door: { x: 48, y: 80, w: 32, h: 32, closed: [0, 112, 32, 16], open: [32, 112, 32, 16] },
    },
  },

  // Warm window glows at night (map px).
  lights: [
    { of: 'house', x: 1008, y: 217, r: 26 },  // farmhouse front window
    { of: 'house', x: 1032, y: 218, r: 16 },  // farmhouse door glass
    { of: 'house', x: 1032, y: 181, r: 12 },  // attic window
    { of: 'coop', x: 768, y: 214, r: 18 },    // coop window
  ],

  animals: [
    { kind: 'chicken', img: 'chicken_white' },
    { kind: 'chicken', img: 'chicken_brown' },
    { kind: 'chicken', img: 'chicken_white' },
    { kind: 'chicken', img: 'chicken_brown' },
    { kind: 'cow', img: 'cow_white' },
    { kind: 'cow', img: 'cow_brown' },
  ],
  // Tall-grass tufts the cursor can brush: [tileX, tileY, variant 0–2].
  grass: [
    [53, 8, 0], [55, 10, 1], [56, 12, 2], [44, 17, 1], [52, 16, 0], [53, 17, 2],
    [70, 18, 1], [73, 18, 0], [75, 22, 2], [74, 26, 1], [56, 26, 0], [62, 27, 2],
    [67, 24, 1], [48, 27, 0], [58, 21, 2], [64, 20, 0],
  ],

  // The farm cat: rests by the porch, follows the cursor around the yard.
  cat: { home: [1058, 292], area: { x: 712, y: 250, w: 540, h: 190 } },

  // Farm dressing (tile coordinates). Trees, grass, weeds and stones outside the
  // yard come from the map's own spawn markers; the yard is kept tidy.
  decor: {
    seed: 7,
    clearedZone: { x: 34, y: 5, w: 44, h: 33 },
    treeDensity: 1, wildGrass: 0.5, yardGrass: 0.3, debrisDensity: 0.4,
    // Each field replants every couple of weeks; offset staggers them.
    fields: [
      { x: 52, y: 29, w: 8, h: 5, offset: 0, crops: { spring: 'cauliflower', summer: 'melon', fall: 'pumpkin' } },
      { x: 61, y: 29, w: 7, h: 5, offset: 5, crops: { spring: 'parsnip', summer: 'blueberry', fall: 'cranberry' } },
      { x: 37, y: 10, w: 7, h: 6, offset: 9, crops: { spring: 'potato', summer: 'tomato', fall: 'eggplant' } },
      { x: 37, y: 19, w: 6, h: 6, offset: 3, crops: { spring: 'kale', summer: 'corn', fall: 'corn' } },
      { x: 67, y: 20, w: 5, h: 5, offset: 7, crops: { spring: 'potato', summer: 'tomato', fall: 'pumpkin' } },
    ],
    // Sprinklers are worked out per field (enough quality / iridium ones to water every
    // crop, as in the game); the sprinkler entries below are placeholders that keep the
    // numbering of the other objects stable for saved layouts. A field no scarecrow
    // reaches gets one of its own.
    objects: [
      { type: 'scarecrow', x: 60, y: 31 }, { type: 'scarecrow', x: 40, y: 17 },
      { type: 'sprinkler', x: 54, y: 31 }, { type: 'sprinkler', x: 57, y: 31 },
      { type: 'sprinkler', x: 64, y: 31 }, { type: 'sprinkler', x: 40, y: 12 },
      { type: 'sprinkler', x: 39, y: 21 }, { type: 'sprinkler', x: 69, y: 22 }, { type: 'sign', x: 51, y: 30 },
      { type: 'scarecrow', x: 66, y: 25 },
      { type: 'beehouse', x: 73, y: 11 }, { type: 'beehouse', x: 75, y: 11 }, { type: 'beehouse', x: 77, y: 11 },
      { type: 'keg', x: 55, y: 15 }, { type: 'keg', x: 56, y: 15 }, { type: 'jar', x: 57, y: 16 },
      { type: 'chest', x: 70, y: 16 },
    ],
    // A small grove inside the yard: [x, y, 1 oak | 2 maple | 3 pine]
    extraTrees: [[36, 30, 1], [39, 33, 2], [43, 30, 3], [46, 34, 1], [35, 36, 2], [35, 7, 3], [49, 36, 3]],
  },

  // Screensaver tour: [tileX, tileY, seconds to linger]; cols sets the zoom.
  saver: {
    cols: 30,
    speed: 12,   // map px per second while panning
    tour: [[64, 15, 9], [58, 30, 8], [72, 30, 6], [32, 52, 8], [16, 40, 7], [18, 16, 7], [41, 16, 8], [50, 21, 6]],
  },

  // Where each kind may wander (map px rectangles).
  pens: {
    chicken: { x: 712, y: 266, w: 186, h: 34 },
    cow: { x: 848, y: 300, w: 200, h: 128 },
  },
};
