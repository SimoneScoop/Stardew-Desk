/* 中文 / English. The Chinese text is the key: L('下班 {0}', time) gives the English
 * line when the language is English (and the Chinese one otherwise), {0} {1}… filled in.
 * Shared by the scene pages and by both apps (they read this file at start).
 * The language: 'zh', 'en', or 'auto' (the system's language: Chinese → 中文, anything
 * else → English). */
var SDV_I18N = (function () {
  var EN = {};                       // filled in by i18n-en.js
  var lang = 'zh';
  function fill(s, a) {
    return a.length ? s.replace(/\{(\d+)\}/g, function (m, i) { var v = a[Number(i)]; return v == null ? '' : String(v); }) : s;
  }
  // A key may carry a context to tell apart words that are the same in Chinese but not in
  // English: '@slip|下班' reads 下班 in Chinese.
  function L(zh) {
    var a = Array.prototype.slice.call(arguments, 1);
    zh = String(zh);
    var s = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, zh) ? EN[zh] : zh.charAt(0) === '@' && zh.indexOf('|') > 0 ? zh.slice(zh.indexOf('|') + 1) : zh;
    return fill(s, a);
  }
  function resolve(pref, system) {
    if (pref === 'zh' || pref === 'en') return pref;
    return /^zh/i.test(String(system || '')) ? 'zh' : 'en';
  }
  // A list joined the way each language writes one: 鸡舍、畜棚 / Coop, Barn
  function list(items) { return items.join(lang === 'en' ? ', ' : '、'); }
  // A page written in Chinese, in the current language: text, title / placeholder, and
  // elements marked data-i18n="html" (their whole inner HTML is one entry). The Chinese is
  // kept, so it can be switched back. Anything inside [data-noi18n] is left alone.
  function dom(root) {
    var CJK = /[\u4e00-\u9fa5]/;
    var norm = function (t) { return t.replace(/\s+/g, ' ').trim(); };
    // a short English of its own where the general entry doesn't fit (a tab, a narrow button)
    Array.prototype.forEach.call(root.querySelectorAll('[data-en]'), function (el) {
      if (el.__zh == null) el.__zh = el.innerHTML;
      el.innerHTML = lang === 'en' ? el.getAttribute('data-en') : el.__zh;
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n="html"]'), function (el) {
      if (el.__zh == null) el.__zh = el.innerHTML;
      el.innerHTML = lang === 'en' ? L(norm(el.__zh)) : el.__zh;
    });
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var p = n.parentElement;
      return p && !p.closest('script, style, [data-noi18n], [data-i18n="html"], [data-en]') && (n.__zh != null || CJK.test(n.nodeValue)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    } });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      if (n.__zh == null) n.__zh = n.nodeValue;
      var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(n.__zh);
      n.nodeValue = m[1] + L(norm(m[2])) + m[3];
    });
    Array.prototype.forEach.call(root.querySelectorAll('[title], [placeholder], [aria-label]'), function (el) {
      if (el.closest('[data-noi18n]')) return;
      ['title', 'placeholder', 'aria-label'].forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        var k = '__zh_' + a;
        if (el[k] == null) { if (!CJK.test(el.getAttribute(a))) return; el[k] = el.getAttribute(a); }
        el.setAttribute(a, L(el[k]));
      });
    });
  }
  return {
    L: L, list: list, resolve: resolve, EN: EN, dom: dom,
    set: function (l) { lang = l === 'en' ? 'en' : 'zh'; return lang; },
    get: function () { return lang; },
    add: function (dict) { for (var k in dict) if (Object.prototype.hasOwnProperty.call(dict, k)) EN[k] = dict[k]; },
  };
})();
if (typeof window !== 'undefined') window.SDV_I18N = SDV_I18N;
