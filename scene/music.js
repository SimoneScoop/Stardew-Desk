/* The game's music the app can play (shared by the Mac and Windows apps and the
 * settings window): [id, wave, 中文名, soundtrack title, group]. The id is the game's
 * cue name (spaces dropped) and also the file name the track is saved under; the wave
 * is its number in the game's wave bank (Content/XACT/Wave Bank.xwb), as the game's
 * Sound Bank maps it. Tracks are taken out of the player's own copy of the game the
 * first time they're wanted. */
var SDV_MUSIC = (function () {
  var T = [
    ["spring1", 93, "春 · 外面的世界很大", "Spring (It's A Big World Outside)", "四季"],
    ["spring2", 91, "春 · 山谷苏醒了", "Spring (The Valley Comes Alive)", "四季"],
    ["spring3", 92, "春 · 野辣根即兴", "Spring (Wild Horseradish Jam)", "四季"],
    ["summer1", 122, "夏 · 自然的渐强", "Summer (Nature's Crescendo)", "四季"],
    ["summer2", 123, "夏 · 太阳把天空染成橙色", "Summer (The Sun Can Bend An Orange Sky)", "四季"],
    ["summer3", 115, "夏 · 热带风情", "Summer (Tropicala)", "四季"],
    ["fall1", 121, "秋 · 蘑菇的气味", "Fall (The Smell Of Mushroom)", "四季"],
    ["fall2", 119, "秋 · 幽灵合成器", "Fall (Ghost Synth)", "四季"],
    ["fall3", 120, "秋 · 渡鸦降临", "Fall (Raven's Descent)", "四季"],
    ["winter1", 126, "冬 · 冰之夜曲", "Winter (Nocturne Of Ice)", "四季"],
    ["winter2", 124, "冬 · 风也可以很安静", "Winter (The Wind Can Be Still)", "四季"],
    ["winter3", 125, "冬 · 古老", "Winter (Ancient)", "四季"],
    ["MainTheme", 335, "星露谷序曲", "Stardew Valley Overture", "小镇与日常"],
    ["SettlingIn", 192, "安顿下来", "Settling In", "小镇与日常"],
    ["springtown", 94, "鹈鹕镇", "Pelican Town", "小镇与日常"],
    ["distantBanjo", 347, "远方的班卓琴", "Distant Banjo", "小镇与日常"],
    ["Saloon1", 350, "星之果实酒吧", "The Stardrop Saloon", "小镇与日常"],
    ["woodsTheme", 216, "深林之中", "In The Deep Woods", "小镇与日常"],
    ["CloudCountry", 190, "云之国", "Cloud Country", "小镇与日常"],
    ["libraryTheme", 341, "图书馆与博物馆", "Library And Museum", "小镇与日常"],
    ["musicboxsong", 44, "音乐盒", "Music Box Song", "小镇与日常"],
    ["grandpas_theme", 336, "爷爷的主题", "Grandpa's Theme", "小镇与日常"],
    ["wedding", 104, "婚礼", "Wedding Celebration", "小镇与日常"],
    ["FlowerDance", 301, "花舞节", "Flower Dance", "节日"],
    ["moonlightJellies", 303, "月光水母之舞", "Dance Of The Moonlight Jellies", "节日"],
    ["fallFest", 304, "星露谷展览会", "Stardew Valley Fair Theme", "节日"],
    ["spirits_eve", 334, "万灵节", "Spirit's Eve Festival", "节日"],
    ["christmasTheme", 305, "冬日星盛宴", "Winter Festival", "节日"],
    ["night_market", 364, "夜市", "Night Market", "节日"],
    ["EmilyTheme", 359, "艾米丽的主题", "Emily's Theme", "人物"],
    ["elliottPiano", 295, "艾利欧特的钢琴", "Elliott's Piano", "人物"],
    ["shaneTheme", 361, "谢恩的主题", "Shane's Theme", "人物"],
    ["AbigailFlute", 279, "阿比盖尔的长笛", "Abigail's Flute", "人物"],
    ["MarlonsTheme", 349, "马龙的主题", "Marlon's Theme", "人物"],
    ["CrystalBells", 64, "矿井 · 水晶铃", "Mines (Crystal Bells)", "矿井与远方"],
    ["Icicles", 68, "矿井 · 冰柱", "Mines (Icicles)", "矿井与远方"],
    ["OfDwarves", 73, "矿井 · 矮人", "Mines (Of Dwarves)", "矿井与远方"],
    ["IslandMusic", 374, "姜岛", "Ginger Island", "矿井与远方"],
  ];
  var tracks = T.map(function (t) { return { id: t[0], wave: t[1], zh: t[2], en: t[3], group: t[4] }; });
  var byId = {};
  tracks.forEach(function (t) { byId[t.id] = t; });
  return {
    tracks: tracks, byId: byId,
    groups: ['四季', '小镇与日常', '节日', '人物', '矿井与远方'],
    seasons: { spring: ['spring1', 'spring2', 'spring3'], summer: ['summer1', 'summer2', 'summer3'], fall: ['fall1', 'fall2', 'fall3'], winter: ['winter1', 'winter2', 'winter3'] },
  };
})();
if (typeof window !== 'undefined') window.SDV_MUSIC = SDV_MUSIC;
