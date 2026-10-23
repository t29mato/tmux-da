// The tmux model: moving between rooms.
//   node --test 'web/test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, plain } from './load.mjs';

const T = load(['tmux.js']).ADV.tmux;
const COLS = 80, ROWS = 24;

// A window split left | right, the right one split top / bottom.
function house() {
  const s = T.createSession({ name: 't', baseIndex: 0, paneBaseIndex: 0 });
  const win = T.createWindow(s, 'zsh');
  T.selectWindow(s, win.id);
  const left = win.active;
  const right = T.splitPane(win, left, 'lr', null, false).id;
  const below = T.splitPane(win, right, 'tb', null, false).id;
  return { win, left, right, below };
}
const go = (win, dir, noWrap) => { const p = T.neighbour(win, COLS, ROWS, dir, noWrap); return p && p.id; };

test('neighbour: the room next door', () => {
  const h = house();
  assert.equal(h.win.active, h.below);
  assert.equal(go(h.win, 'U'), h.right);
  assert.equal(go(h.win, 'L'), h.left);
});

test('neighbour: wraps round the window edge, as tmux does', () => {
  const h = house();
  assert.equal(go(h.win, 'R'), h.left, 'right of the rightmost room is the leftmost');
  assert.equal(go(h.win, 'D'), h.right, 'below the bottom room is the top one');
  T.selectPane(h.win, h.left);
  assert.equal(go(h.win, 'L'), h.below, 'left of the leftmost room is the right side: the one you were in last');
  assert.equal(go(h.win, 'U'), null, 'one room from top to bottom: nowhere to go');
});

test('neighbour: among several, the most recently active one (window_pane_choose_best)', () => {
  const h = house();
  // right, down, left: from the left room, → goes back to the one below.
  T.selectPane(h.win, h.right);
  T.selectPane(h.win, h.below);
  T.selectPane(h.win, h.left);
  assert.equal(go(h.win, 'R'), h.below);
  T.selectPane(h.win, h.right);
  T.selectPane(h.win, h.left);
  assert.equal(go(h.win, 'R'), h.right, 'and after a visit to the top one, that');
});

test('kill-pane: the focus goes to the last pane, else the previous one in order', () => {
  const h = house();
  // below (active) was reached from right: last is right.
  T.killPane(h.win, h.below);
  assert.equal(h.win.active, h.right);
  const h2 = house();
  T.selectPane(h2.win, h2.left);
  T.selectPane(h2.win, h2.below);
  h2.win.last = null;
  T.killPane(h2.win, h2.below);
  assert.equal(h2.win.active, h2.right, 'no last pane: the previous one in order');
  const h3 = house();
  T.selectPane(h3.win, h3.left);
  h3.win.last = null;
  T.killPane(h3.win, h3.left);
  assert.equal(h3.win.active, h3.right, 'the first pane closed: the next one');
});

test('kill-window: the last window, else the previous one', () => {
  const s = T.createSession({ name: 't' });
  const a = T.createWindow(s, 'a'), b = T.createWindow(s, 'b'), c = T.createWindow(s, 'c');
  s.active = c.id;
  T.killWindow(s, c.id);
  assert.equal(s.active, b.id, 'no last window: the previous one');
  T.selectWindow(s, a.id);
  T.selectWindow(s, b.id);
  T.killWindow(s, b.id);
  assert.equal(s.active, a.id, 'the last window');
});

test('resize-pane unzooms first, as tmux does', () => {
  const h = house();
  h.win.zoomed = true;
  assert.equal(T.resizePane(h.win, h.below, 'lr', 5, COLS, ROWS), true);
  assert.equal(h.win.zoomed, false);
});

test('rotate-window: the contents move up one place, the focus stays put', () => {
  const h = house();
  T.selectPane(h.win, h.left);
  T.rotateWindow(h.win);
  const order = T.panesOf(h.win).map((p) => p.id);
  assert.deepEqual(plain(order), [h.right, h.below, h.left]);
  assert.equal(h.win.active, h.right, 'the pane now at the top left');
});

test('neighbour: noWrap stops at the edge (the 指南 never points round it)', () => {
  const h = house();
  assert.equal(go(h.win, 'R', true), null);
  assert.equal(go(h.win, 'D', true), null);
  assert.equal(go(h.win, 'L', true), h.left);
});

test('breakPane: the pane leaves for a window of its own, which becomes current; a window of one pane only moves to the next free index', () => {
  const s = T.createSession({ name: 't', baseIndex: 0, paneBaseIndex: 0 });
  const w0 = T.createWindow(s, 'main');
  T.selectWindow(s, w0.id);
  const left = w0.active;
  const right = T.splitPane(w0, left, 'lr', null, false).id;
  w0.zoomed = true;
  const fresh = T.breakPane(s, w0, right);
  assert.ok(fresh && fresh.id !== w0.id);
  assert.equal(s.active, fresh.id, 'the new window is current');
  assert.equal(s.last, w0.id);
  assert.deepEqual(plain(T.panesOf(fresh).map((p) => p.id)), [right]);
  assert.deepEqual(plain(T.panesOf(w0).map((p) => p.id)), [left], 'the source window keeps its other pane');
  assert.equal(w0.active, left);
  assert.equal(w0.zoomed, false, 'the zoom is cleared');
  assert.equal(fresh.index, 1);
  // tmux 3.x: windows 0,1 and break-pane in 1 → windows 0,2 (the same window).
  assert.equal(T.breakPane(s, fresh, right), fresh, 'a window of one pane is handed back');
  assert.equal(s.windows.length, 2);
  assert.equal(fresh.index, 2, 'it took the next free index');
  assert.deepEqual(plain(s.windows.map((w) => w.index)), [0, 2]);
  assert.equal(s.active, fresh.id);
  assert.equal(T.freeIndex(s), 1, 'new-window would fill the gap');
});

// Three rooms along the top (the goal leftmost) over one wide room: from the
// top right, the nearest step towards the goal is ↓ (the wide room's middle
// is closer), and from there ↑ comes back to the room just left, for ever.
test('arrowPath: the way tmux walks it, never swinging back and forth', () => {
  const s = T.createSession({ name: 't', baseIndex: 0, paneBaseIndex: 0 });
  const win = T.createWindow(s, 'zsh');
  T.selectWindow(s, win.id);
  const goal = win.active;
  const wide = T.splitPane(win, goal, 'tb', null, false).id;
  T.selectPane(win, goal);
  const mid = T.splitPane(win, goal, 'lr', null, false).id;
  const right = T.splitPane(win, mid, 'lr', null, false).id;
  T.resizePane(win, goal, 'lr', 12, COLS, ROWS);
  assert.equal(win.active, right);
  assert.equal(T.arrowPath(win, COLS, ROWS, goal), 'L', 'two ← rather than ↓ ↑ ↓ ↑');
  // After ↓ for real, ↑ is the only way back up (to the room just left), then ←.
  T.selectPane(win, T.neighbour(win, COLS, ROWS, 'D', true).id);
  assert.equal(win.active, wide);
  assert.equal(T.arrowPath(win, COLS, ROWS, goal), 'U');
  T.selectPane(win, T.neighbour(win, COLS, ROWS, 'U', true).id);
  assert.equal(win.active, right, 'tmux goes back to the most recently active room');
  assert.equal(T.arrowPath(win, COLS, ROWS, goal), 'L');
  assert.equal(T.arrowPath(win, COLS, ROWS, 'nope'), null, 'no such room: no way');
  // neighbour asked from another room, with the room that would be most recent.
  assert.equal(T.neighbour(win, COLS, ROWS, 'U', true, wide, mid).id, mid);
  assert.equal(T.neighbour(win, COLS, ROWS, 'U', true, wide, goal).id, goal);
});
