/* Reading a Stardew Valley save — only what "从存档导入布局" needs, read-only.
 *
 * A save is one big XML file (Saves/<Farm>_<id>/<Farm>_<id>); next to it SaveGameInfo
 * holds the farmer alone, which is enough to label the save in a list. This file runs in
 * three places, so it is plain JavaScript with no DOM: the Mac app (JXA, it evaluates
 * this file and reads SDV_SAVE), the Windows app (Node, require) and the settings page.
 *
 *   SDV_SAVE.info(text)   → { farmName, name, year, season, day, version }
 *   SDV_SAVE.parse(text)  → { farmName, name, whichFarm, version, houseLevel, pet,
 *                             greenhouseUnlocked, buildings: [{type, x, y, w, h, skin,
 *                             level, animals: {type: n}}], outsideAnimals: {type: n} }
 *
 * Nothing here writes anything, and nothing leaves the computer. */
var SDV_SAVE = (function () {
  'use strict';

  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function decode(t) {
    return String(t == null ? '' : t).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, function (m, e) {
      if (e[0] === '#') { var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isNaN(n) ? m : String.fromCharCode(n); }
      return ENT[e] != null ? ENT[e] : m;
    });
  }
  // The text of the first <tag>…</tag> in s (from `from`), or null.
  function first(s, tag, from) {
    var a = s.indexOf('<' + tag + '>', from || 0);
    if (a < 0) return null;
    var b = s.indexOf('</' + tag + '>', a);
    return b < 0 ? null : decode(s.slice(a + tag.length + 2, b));
  }
  var num = function (v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; };
  var SEASONS = ['spring', 'summer', 'fall', 'winter'];
  function seasonOf(v) {
    if (v == null) return null;
    var n = parseInt(v, 10);
    if (!isNaN(n)) return SEASONS[n] || null;
    v = String(v).toLowerCase();
    return SEASONS.indexOf(v) >= 0 ? v : null;
  }
  function strip(text) { return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; }

  // ---------- SaveGameInfo: the farmer, for the list of saves ----------
  function info(text) {
    text = strip(String(text || ''));
    if (text.indexOf('<Farmer') < 0 && text.indexOf('<player') < 0) return null;
    return {
      farmName: first(text, 'farmName') || '',
      name: first(text, 'name') || '',
      year: num(first(text, 'yearForSaveGame'), null),
      season: seasonOf(first(text, 'seasonForSaveGame')),
      day: num(first(text, 'dayOfMonthForSaveGame'), null),
      version: first(text, 'gameVersion') || '',
    };
  }

  // ---------- the save itself ----------
  // A small tag walker: no DOM, no namespaces, just a stack of element names, so a value
  // can be picked by where it sits (a Building's own <tileX>, not one deeper inside it).
  var TAG = /<(\/?)([A-Za-z_][\w.\-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  function walk(s, onOpen, onClose) {
    var stack = [];
    TAG.lastIndex = 0;
    var m;
    while ((m = TAG.exec(s))) {
      if (m[1]) {                                   // </name>
        var top = stack.pop();
        if (!top) continue;
        onClose(top, stack, m.index);
      } else {
        var el = { name: m[2], attrs: m[3], end: TAG.lastIndex };
        if (m[4]) { onOpen(el, stack); onClose(el, stack, m.index, true); }   // <name />
        else { onOpen(el, stack); stack.push(el); }
      }
    }
  }
  var typeOf = function (attrs) { var m = /xsi:type="([^"]*)"/.exec(attrs || ''); return m ? m[1] : null; };

  function parse(text) {
    var s = strip(String(text || ''));
    if (s.indexOf('<SaveGame') < 0) throw new Error('这不是星露谷的存档文件');
    var pEnd = s.indexOf('</player>');
    var player = pEnd > 0 ? s.slice(0, pEnd) : '';
    var out = {
      farmName: first(player, 'farmName') || '',
      name: first(player, 'name') || '',
      version: first(s, 'gameVersion') || '',
      whichFarm: first(s, 'whichFarm'),
      houseLevel: num(first(player, 'houseUpgradeLevel'), 0),
      pet: null,
      greenhouseUnlocked: false,
      buildings: [],
      outsideAnimals: {},
    };
    var petType = first(player, 'whichPetType'), petBreed = first(player, 'whichPetBreed');
    if (petType == null) { var cat = first(player, 'catPerson'); if (cat != null) petType = cat === 'true' ? 'Cat' : 'Dog'; }
    if (petType) out.pet = { type: petType, breed: num(petBreed, 0) };

    var a = s.indexOf('<GameLocation xsi:type="Farm"');
    if (a < 0) throw new Error('存档里没找到农场');
    var b = s.indexOf('</GameLocation>', a);
    var farm = s.slice(a, b < 0 ? s.length : b + '</GameLocation>'.length);

    var bld = null, bldDepth = -1, pet = null, petDepth = -1, animal = null;
    var count = function (o, t) { if (t) o[t] = (o[t] || 0) + 1; };
    walk(farm, function (el, stack) {
      var d = stack.length;
      // <GameLocation> <buildings> <Building>
      if (el.name === 'Building' && d === 2 && stack[1].name === 'buildings') { bld = { type: null, x: null, y: null, w: null, h: null, skin: null, level: 0, animals: {} }; bldDepth = d; }
      else if (el.name === 'NPC' && d === 2 && stack[1].name === 'characters' && typeOf(el.attrs) === 'Pet') { pet = {}; petDepth = d; }
      else if (el.name === 'FarmAnimal') animal = { type: null };
    }, function (el, stack, at, empty) {
      var d = stack.length, parent = stack[d - 1], val = empty ? '' : farm.slice(el.end, at);
      var leaf = val.indexOf('<') < 0;
      if (bld) {
        if (d === bldDepth + 1 && parent && parent.name === 'Building' && leaf) {
          if (el.name === 'buildingType') bld.type = decode(val);
          else if (el.name === 'tileX') bld.x = num(val, null);
          else if (el.name === 'tileY') bld.y = num(val, null);
          else if (el.name === 'tilesWide') bld.w = num(val, null);
          else if (el.name === 'tilesHigh') bld.h = num(val, null);
        } else if (el.name === 'string' && d === bldDepth + 2 && parent.name === 'skinId' && leaf && val) bld.skin = decode(val);
        else if (el.name === 'upgradeLevel' && d === bldDepth + 2 && parent.name === 'indoors' && leaf) bld.level = num(val, 0);
      }
      if (animal && el.name === 'type' && parent && parent.name === 'FarmAnimal' && leaf) animal.type = decode(val);
      if (el.name === 'FarmAnimal' && animal) { count(bld ? bld.animals : out.outsideAnimals, animal.type); animal = null; }
      if (pet && d === petDepth + 1 && leaf) {
        if (el.name === 'petType') pet.type = decode(val);
        else if (el.name === 'whichBreed') pet.breed = num(val, 0);
        else if (el.name === 'name') pet.name = decode(val);
      }
      if (el.name === 'NPC' && pet && d === petDepth) { if (pet.type) out.pet = { type: pet.type, breed: pet.breed || 0, name: pet.name || '' }; pet = null; }
      if (el.name === 'Building' && bld && d === bldDepth) {
        if (bld.type && bld.x != null && bld.y != null) out.buildings.push(bld);
        bld = null;
      }
      if (el.name === 'greenhouseUnlocked' && d === 1 && leaf) out.greenhouseUnlocked = val.trim() === 'true';
    });
    return out;
  }

  return { info: info, parse: parse, decode: decode };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SDV_SAVE;
if (typeof window !== 'undefined') window.SDV_SAVE = SDV_SAVE;
