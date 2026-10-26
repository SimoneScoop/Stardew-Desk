// Shared reminder policy for the JXA and Electron hosts.
var SDVReminder = (function () {
  'use strict';

  function copy(board) { return JSON.parse(JSON.stringify(board || { todos: [] })); }
  function valid(reminder) {
    return reminder && Number.isFinite(reminder.at) && Number.isInteger(reminder.advance)
      && reminder.advance >= 0;
  }
  function save(board, id, text, reminder, now) {
    var b = copy(board), clean = String(text || '').trim().slice(0, 40);
    if (!clean) throw new Error('empty title');
    b.todos = Array.isArray(b.todos) ? b.todos : [];
    var todo = id && b.todos.find(function (t) { return t.id === id; });
    if (id && !todo) throw new Error('missing to-do');
    if (!todo) {
      todo = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: clean, done: false };
      b.todos.push(todo);
    }
    var before = todo.reminder;
    var changed = Boolean(before) !== Boolean(reminder) || Boolean(before && reminder &&
      (before.at !== reminder.at || before.advance !== reminder.advance));
    if (reminder) {
      if (!valid(reminder)) throw new Error('invalid reminder');
      if (changed && reminder.at - reminder.advance * 60000 <= now) throw new Error('reminder must be in the future');
      todo.reminder = changed ? { at: reminder.at, advance: reminder.advance, acknowledged: false } : before;
    } else delete todo.reminder;
    todo.text = clean;
    return b;
  }
  function due(board, now) {
    return ((board && board.todos) || []).filter(function (t) {
      var r = t.reminder;
      return !t.done && r && valid(r) && !r.acknowledged
        && (Number.isFinite(r.next) ? r.next : r.at - r.advance * 60000) <= now;
    }).map(function (t) { return t.id; });
  }
  function dayStart(now) {
    var d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  // A to-do whose reminder day is over is stale and gets cleared; ones with a reminder
  // today (even one that already fired) or later, and ones without a reminder, stay.
  function expired(todo, now) {
    var r = todo && todo.reminder;
    if (!valid(r)) return false;
    return (Number.isFinite(r.next) ? r.next : r.at) < dayStart(now);
  }
  function update(board, ids, fn) {
    var b = copy(board), set = new Set(ids);
    b.todos.forEach(function (t) { if (set.has(t.id) && !t.done && t.reminder) fn(t.reminder); });
    return b;
  }
  function acknowledge(board, ids) {
    return update(board, ids, function (r) { r.acknowledged = true; delete r.next; });
  }
  function snooze(board, ids, minutes, now) {
    if (![5, 10, 30].includes(minutes)) throw new Error('invalid snooze');
    return update(board, ids, function (r) { r.next = now + minutes * 60000; r.acknowledged = false; });
  }
  return { save: save, due: due, expired: expired, acknowledge: acknowledge, snooze: snooze };
})();

if (typeof module !== 'undefined') module.exports = SDVReminder;
