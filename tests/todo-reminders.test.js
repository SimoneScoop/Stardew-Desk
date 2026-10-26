'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../scene/todo-reminders');

const at = Date.parse('2026-10-22T15:00:00+08:00');
const now = at - 20 * 60000;

test('a saved to-do becomes due once at its early reminder time', () => {
  const board = R.save({ todos: [] }, null, '回邮件', { at, advance: 10 }, now);
  assert.equal(board.todos.length, 1);
  assert.deepEqual(R.due(board, at - 11 * 60000), []);
  assert.deepEqual(R.due(board, at - 10 * 60000), [board.todos[0].id]);
  const acknowledged = R.acknowledge(board, [board.todos[0].id]);
  assert.deepEqual(R.due(acknowledged, at), []);
  assert.equal(acknowledged.todos[0].done, false);
});

test('completed and old to-dos cannot trigger reminders', () => {
  const b = { todos: [{ id: 'old', text: '旧事项', done: false },
    { id: 'done', text: '已完成', done: true, reminder: { at, advance: 0 } }] };
  assert.deepEqual(R.due(b, at + 1000), []);
});

test('a group can snooze past its original time and survive a restart', () => {
  const board = { todos: ['a', 'b'].map(id => ({ id, text: id, done: false, reminder: { at, advance: 0 } })) };
  const delayed = R.snooze(board, ['a', 'b'], 10, at + 60000);
  const persisted = JSON.parse(JSON.stringify(delayed));
  assert.deepEqual(R.due(persisted, at + 2 * 60000), []);
  assert.deepEqual(R.due(persisted, at + 11 * 60000), ['a', 'b']);
});

test('editing an acknowledged reminder creates a new alert; past times are rejected', () => {
  const board = { todos: [{ id: 'a', text: '原事项', done: false, reminder: { at, advance: 0, acknowledged: true } }] };
  const edited = R.save(board, 'a', '新事项', { at: at + 3600000, advance: 15 }, at + 1000);
  assert.deepEqual(R.due(edited, at + 45 * 60000), ['a']);
  assert.equal(board.todos[0].text, '原事项');
  assert.throws(() => R.save(board, 'a', '迟到', { at, advance: 10 }, at - 5 * 60000), /future/);
});

test('editing only the title keeps acknowledgement, while cancelling removes the reminder', () => {
  const board = { todos: [{ id: 'a', text: '原事项', done: false, reminder: { at, advance: 0, acknowledged: true } }] };
  const renamed = R.save(board, 'a', '新事项', { at, advance: 0 }, at + 60000);
  assert.deepEqual(R.due(renamed, at + 60000), []);
  const cancelled = R.save(renamed, 'a', '新事项', null, at + 60000);
  assert.equal(cancelled.todos[0].reminder, undefined);
});

test('snoozing a group does not resurrect completed or deleted to-dos', () => {
  const board = { todos: [{ id: 'a', text: '完成', done: true, reminder: { at, advance: 0 } },
    { id: 'b', text: '未完成', done: false, reminder: { at, advance: 0 } }] };
  const delayed = R.snooze(board, ['a', 'b', 'deleted'], 5, at);
  assert.deepEqual(R.due(delayed, at + 300000), ['b']);
});

test('later arrivals join the visible group and acknowledgement survives restart', () => {
  const board = { todos: [{ id: 'a', text: '先到', done: false, reminder: { at, advance: 0 } },
    { id: 'b', text: '后到', done: false, reminder: { at: at + 60000, advance: 0 } }] };
  assert.deepEqual(R.due(board, at), ['a']);
  assert.deepEqual(R.due(board, at + 60000), ['a', 'b']);
  const persisted = JSON.parse(JSON.stringify(R.acknowledge(board, R.due(board, at + 60000))));
  assert.deepEqual(R.due(persisted, at + 3600000), []);
  assert.equal(persisted.todos[0].done, false);
});

test('snooze can repeat after the original due time; changing the reminder resets it', () => {
  const board = R.save({ todos: [] }, null, '出门', { at, advance: 0 }, now);
  const id = board.todos[0].id;
  const first = R.snooze(board, [id], 5, at + 60000);
  const second = R.snooze(first, [id], 10, at + 7 * 60000);
  assert.deepEqual(R.due(second, at + 16 * 60000), []);
  assert.deepEqual(R.due(second, at + 17 * 60000), [id]);
  const edited = R.save(second, id, '出门', { at: at + 3600000, advance: 0 }, at + 18 * 60000);
  assert.deepEqual(R.due(edited, at + 18 * 60000), []);
  assert.deepEqual(R.due(edited, at + 3600000), [id]);
});

test('to-dos whose reminder day is over are expired; today, future and undated ones stay', () => {
  const day = new Date(2026, 9, 22, 10, 0).getTime();
  const todo = (id, at) => ({ id, text: id, done: false, reminder: { at, advance: 0 } });
  assert.equal(R.expired(todo('昨天', new Date(2026, 9, 21, 23, 50).getTime()), day), true);
  assert.equal(R.expired(todo('今天早', new Date(2026, 9, 22, 8, 0).getTime()), day), false);
  assert.equal(R.expired(todo('明天', new Date(2026, 9, 23, 9, 0).getTime()), day), false);
  assert.equal(R.expired({ id: 'x', text: '没有时间', done: false }, day), false);
});

test('a snooze that lands later today keeps the to-do alive', () => {
  const day = new Date(2026, 9, 22, 10, 0).getTime();
  const t = { id: 'a', text: 'a', done: false,
    reminder: { at: new Date(2026, 9, 21, 23, 50).getTime(), advance: 0, next: new Date(2026, 9, 22, 12, 0).getTime() } };
  assert.equal(R.expired(t, day), false);
});
