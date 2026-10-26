'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function boardScene() {
  const g = new Proxy({ measureText: text => ({ width: String(text).length * 7 }) }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
  });
  const context = { window: { SDV: {} }, navigator: { platform: 'MacIntel' }, document: { createElement: () => ({ getContext: () => g }) } };
  context.SDV = context.window.SDV;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scene/board.js'), 'utf8'), context);
  return { board: context.window.SDV.board, g };
}

const OPEN = { anchor: { x: 350, y: 370, h: 30 }, cursor: { x: 350, y: 370 }, overBoard: true,
  dt: 0.5, k: 1, W: 900, H: 700, images: {}, cur: null };

// Draws once and reports the texts painted that frame (the notice's own labels included).
function paint(board, g, over) {
  const texts = [];
  g.fillText = t => texts.push(String(t));
  board.draw(g, { ...OPEN, ...over });
  delete g.fillText;
  return texts;
}

test('the notice lists only the first page of a long to-do list, with a scrollbar', () => {
  const { board, g } = boardScene();
  board.set({ todos: Array.from({ length: 12 }, (_, i) => ({ id: 't' + i, text: '事' + i, done: false })) });
  const texts = paint(board, g, {});
  assert.ok(texts.includes('事0'));
  assert.ok(!texts.includes('事8'));
  assert.ok(!texts.some(t => t.includes('还有')));      // no "还有 N 项…" hint any more
});

test('the wheel and the scrollbar thumb scroll the to-do list by one page at a time', () => {
  const { board, g } = boardScene();
  board.set({ todos: Array.from({ length: 12 }, (_, i) => ({ id: 't' + i, text: '事' + i, done: false })) });
  paint(board, g, {});
  const r = board.rect();
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  assert.equal(board.wheel(0, 20, cx, cy), true);        // one 20 px row of wheel travel
  let texts = paint(board, g, {});
  assert.ok(texts.includes('事1'));
  assert.ok(!texts.includes('事0'));
  board.wheel(0, -20, cx, cy);
  texts = paint(board, g, {});
  assert.ok(texts.includes('事0'));

  const track = { x: r.x + r.w - 7, y: r.y + 60 };        // the bar sits in the paper's right padding
  assert.equal(board.down(track.x, track.y + 5), 'drag');  // pressed on the thumb
  board.drag(track.x, r.y + 400);                          // dragged past the bottom
  board.up();
  texts = paint(board, g, {});
  assert.ok(texts.includes('事11'));
  assert.ok(!texts.includes('事0'));
});

test('a ticked to-do moves to the end of the list', () => {
  const { board, g } = boardScene();
  const names = ['浇水', '喂鸡', '收菜'];
  board.set({ todos: names.map((text, i) => ({ id: 't' + i, text, done: false })) });
  let texts = paint(board, g, {});
  const r = board.rect();
  assert.deepEqual(texts.filter(t => names.includes(t)), names);
  assert.equal(board.click(r.x + 20, r.y + 70), true);       // the first row's checkbox
  texts = paint(board, g, {});
  assert.deepEqual(texts.filter(t => names.includes(t)), ['喂鸡', '收菜', '浇水']);
  assert.equal(board.get().todos.find(t => t.id === 't0').done, true);
});

test('the notice stays up while the to-do form is open, then closes once it is released', () => {
  const { board, g } = boardScene();
  board.set({ todos: [{ id: 'a', text: '浇水', done: false }] });
  paint(board, g, {});
  assert.ok(board.rect());
  paint(board, g, { cursor: null, overBoard: false, dt: 1 });   // the pointer left
  assert.equal(board.rect(), null);

  paint(board, g, {});
  board.hold(true);                                            // the form opened
  paint(board, g, { cursor: null, overBoard: false, dt: 5 });
  assert.ok(board.rect());
  board.hold(false);                                           // the form closed
  paint(board, g, { cursor: null, overBoard: false, dt: 1 });
  assert.equal(board.rect(), null);
});

test('desktop notice opens a new to-do without toggling an existing one', () => {
  const { board, g } = boardScene();
  board.set({ todos: [{ id: 'a', text: '浇水', done: false }] });
  const requests = [];
  board.onEdit(id => requests.push(id));
  board.draw(g, { anchor: { x: 350, y: 370, h: 30 }, cursor: { x: 350, y: 370 }, overBoard: true,
    dt: 0.5, k: 1, W: 900, H: 700, images: {}, cur: null });
  const r = board.rect();
  assert.ok(r);
  assert.equal(board.click(r.x + r.w - 20, r.y + 34), true);
  assert.deepEqual(requests, [null]);
  assert.equal(board.get().todos[0].done, false);
});

test('desktop notice edits a to-do separately from its checkbox', () => {
  const { board, g } = boardScene();
  board.set({ todos: [{ id: 'a', text: '浇水', done: false }] });
  const requests = [];
  board.onEdit(id => requests.push(id));
  board.draw(g, { anchor: { x: 350, y: 370, h: 30 }, cursor: { x: 350, y: 370 }, overBoard: true,
    dt: 0.5, k: 1, W: 900, H: 700, images: {}, cur: null });
  const r = board.rect();
  assert.equal(board.click(r.x + r.w - 22, r.y + 70), true);
  assert.deepEqual(requests, ['a']);
  assert.equal(board.get().todos[0].done, false);
});
