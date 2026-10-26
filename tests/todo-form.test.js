'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function formPage(now) {
  const html = fs.readFileSync(path.join(__dirname, '../scene/todo-form.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map(), sent = [];
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', hidden: false, checked: false, listeners: {}, focus() {}, select() {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
    });
    return elements.get(id);
  };
  const document = { getElementById: get, addEventListener() {} };
  const window = { webkit: { messageHandlers: { sdv: { postMessage: message => sent.push(message) } } } };
  const Clock = now == null ? Date : class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  vm.runInNewContext(script, { window, document, Date: Clock, Number });
  const submit = () => get('form').listeners.submit({ preventDefault() {} });
  return { get, sent, submit, init: todo => window.SDV.todoForm.init(todo) };
}

test('the form permits a title-only edit of a past acknowledged reminder', () => {
  const page = formPage(), at = Math.floor((Date.now() - 3600000) / 60000) * 60000;
  page.init({ id: 'a', text: '旧标题', reminder: { at, advance: 0, acknowledged: true } });
  page.get('text').value = '新标题';
  page.submit();
  assert.equal(page.get('error').textContent, '');
  assert.equal(page.sent.at(-1).type, 'todoSave');
  assert.equal(page.sent.at(-1).reminder.at, at);
});

test('the form rejects a newly selected past reminder time', () => {
  const page = formPage();
  page.init(null);
  page.get('text').value = '新待办';
  page.get('remind').checked = true;
  const past = new Date(Date.now() - 3600000);
  page.get('due').value = new Date(past.getTime() - past.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  page.submit();
  assert.match(page.get('error').textContent, /已过去/);
  assert.deepEqual(page.sent.map(x => x.type), ['hello']);
});

test('turning on the reminder for a new to-do picks the next half-hour slot', () => {
  for (const [hour, minute, expected] of [
    [1, 2, '2026-01-05T01:30'],
    [1, 29, '2026-01-05T01:30'],
    [1, 30, '2026-01-05T02:00'],
    [1, 45, '2026-01-05T02:00'],
    [23, 45, '2026-01-06T00:00'],
  ]) {
    const page = formPage(new Date(2026, 0, 5, hour, minute, 12).getTime());
    page.init(null);
    assert.equal(page.get('remind').checked, false);
    page.get('remind').checked = true;
    page.get('remind').listeners.change({ target: { checked: true } });
    assert.equal(page.get('due').value, expected);
  }
});

test('editing a to-do without a reminder leaves the time empty', () => {
  const page = formPage(new Date(2026, 0, 5, 1, 2, 12).getTime());
  page.init({ id: 'a', text: '记事' });
  assert.equal(page.get('due').value, '');
});

test('a new to-do has no reminder unless one is asked for', () => {
  const page = formPage(new Date(2026, 0, 5, 1, 2, 12).getTime());
  page.init(null);
  page.get('text').value = '记事';
  page.submit();
  assert.equal(page.get('error').textContent, '');
  assert.equal(page.sent.at(-1).reminder, null);
});

test('saving a new to-do keeps the half-hour reminder it was given', () => {
  const page = formPage(new Date(2026, 0, 5, 1, 2, 12).getTime());
  page.init(null);
  page.get('text').value = '新待办';
  page.get('remind').checked = true;
  page.get('remind').listeners.change({ target: { checked: true } });
  page.submit();
  assert.equal(page.get('error').textContent, '');
  assert.equal(page.sent.at(-1).reminder.at, new Date(2026, 0, 5, 1, 30).getTime());
});

test('re-opening the form resets the previous to-do state', () => {
  const page = formPage(new Date(2026, 0, 5, 1, 2, 12).getTime());
  page.init({ id: 'a', text: '旧待办', reminder: { at: new Date(2026, 0, 5, 9, 0).getTime(), advance: 77 } });
  page.get('error').textContent = '旧错误';
  page.init(null);
  assert.equal(page.get('text').value, '');
  assert.equal(page.get('remind').checked, false);
  assert.equal(page.get('due').value, '');
  assert.equal(page.get('advance').value, '0');
  assert.equal(page.get('custom').value, '');
  assert.equal(page.get('custom').hidden, true);
  assert.equal(page.get('error').textContent, '');
  page.init({ id: 'b', text: '记事' });
  assert.equal(page.get('remind').checked, false);
  assert.equal(page.get('due').value, '');
});

test('unchecking the reminder saves the to-do without one', () => {
  const page = formPage(new Date(2026, 0, 5, 1, 2, 12).getTime());
  page.init(null);
  page.get('text').value = '记事';
  page.get('remind').checked = true;
  page.get('remind').listeners.change({ target: { checked: true } });
  assert.equal(page.get('remind-fields').hidden, false);
  page.get('remind').checked = false;
  page.get('remind').listeners.change({ target: { checked: false } });
  assert.equal(page.get('remind-fields').hidden, true);
  page.submit();
  assert.equal(page.get('error').textContent, '');
  assert.equal(page.sent.at(-1).reminder, null);
});

test('turning the reminder on fills in a time', () => {
  const page = formPage(new Date(2026, 0, 5, 1, 2, 12).getTime());
  page.init({ id: 'a', text: '记事' });
  assert.equal(page.get('remind-fields').hidden, true);
  page.get('remind').checked = true;
  page.get('due').value = '';
  page.get('remind').listeners.change({ target: { checked: true } });
  assert.equal(page.get('remind-fields').hidden, false);
  assert.equal(page.get('due').value, '2026-01-05T01:30');
});

test('a checked reminder needs a time', () => {
  const page = formPage(new Date(2026, 0, 5, 1, 2, 12).getTime());
  page.init(null);
  page.get('text').value = '记事';
  page.get('remind').checked = true;
  page.get('due').value = '';
  page.submit();
  assert.match(page.get('error').textContent, /请选择提醒时间/);
  assert.deepEqual(page.sent.map(x => x.type), ['hello']);
});
