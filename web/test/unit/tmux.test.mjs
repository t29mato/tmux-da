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

// ---- 達人: layouts, join-pane, swap-window, move-window, rotate -D ----------
// The numbers below were read off a real tmux 3.8 (tmux -L test -f /dev/null,
// new-session -x 100 -y 30, then select-layout): pane x,y w×h in pane order.

function panes(n) {
  const s = T.createSession({ name: 't' });
  const w = T.createWindow(s, 'z');
  for (let i = 1; i < n; i++) T.splitPane(w, T.panesOf(w)[0].id, 'tb', null, true);
  return { s, w };
}
const rects = (w, C, R) => T.layout(w, C, R).panes.slice().sort((a, b) => T.panesOf(w).indexOf(a.pane) - T.panesOf(w).indexOf(b.pane)).map((r) => `${r.x},${r.y} ${r.w}x${r.h}`).join(' ');

test('select-layout: every layout sized as tmux 3.8 sizes it', () => {
  const real = [
    [4, 'even-horizontal', 80, 24, '0,0 20x24 21,0 19x24 41,0 19x24 61,0 19x24'],
    [4, 'even-vertical', 80, 24, '0,0 80x6 0,7 80x5 0,13 80x5 0,19 80x5'],
    [6, 'even-horizontal', 100, 30, '0,0 16x30 17,0 16x30 34,0 16x30 51,0 16x30 68,0 16x30 85,0 15x30'],
    [3, 'even-vertical', 100, 30, '0,0 100x10 0,11 100x9 0,21 100x9'],
    [3, 'tiled', 100, 30, '0,0 49x14 50,0 50x14 0,15 100x15'],
    [5, 'tiled', 100, 30, '0,0 49x9 50,0 50x9 0,10 49x9 50,10 50x9 0,20 100x10'],
    [7, 'tiled', 100, 30, '0,0 32x9 33,0 32x9 66,0 34x9 0,10 32x9 33,10 32x9 66,10 34x9 0,20 100x10'],
    [4, 'tiled', 80, 24, '0,0 39x11 40,0 40x11 0,12 39x12 40,12 40x12'],
    [5, 'main-horizontal', 100, 30, '0,0 100x24 0,25 25x5 26,25 24x5 51,25 24x5 76,25 24x5'],
    [5, 'main-vertical', 100, 30, '0,0 80x30 81,0 19x7 81,8 19x7 81,16 19x7 81,24 19x6'],
    [6, 'main-horizontal-mirrored', 100, 30, '0,6 100x24 0,0 20x5 21,0 19x5 41,0 19x5 61,0 19x5 81,0 19x5'],
    [6, 'main-vertical-mirrored', 100, 30, '20,0 80x30 0,0 19x6 0,7 19x5 0,13 19x5 0,19 19x5 0,25 19x5']
  ];
  for (const [n, name, C, R, want] of real) {
    const { w } = panes(n);
    assert.equal(T.applyLayout(w, name), true);
    assert.equal(rects(w, C, R), want, n + ' panes, ' + name);
    assert.equal(w.layoutName, name);
  }
});

test('next-layout: tmux 3.8\'s order of seven, going on from the last one set through splits and closes', () => {
  assert.deepEqual(plain(T.LAYOUTS), ['even-horizontal', 'even-vertical', 'main-horizontal', 'main-horizontal-mirrored', 'main-vertical', 'main-vertical-mirrored', 'tiled']);
  assert.deepEqual(plain(T.LAYOUT_KEYS.slice(0, 5)), ['even-horizontal', 'even-vertical', 'main-horizontal', 'main-vertical', 'tiled'], 'prefix M-1 … M-5');
  const { w } = panes(3);
  T.nextLayout(w);
  assert.equal(w.layoutName, 'even-horizontal', 'none set yet: the first');
  T.applyLayout(w, 'even-vertical');
  T.splitPane(w, w.active, 'lr', null, true);
  assert.equal(w.layoutName, null, 'a split leaves the layout');
  T.nextLayout(w);
  assert.equal(w.layoutName, 'main-horizontal', 'but next-layout goes on from even-vertical, as tmux does');
  T.nextLayout(w, true);
  assert.equal(w.layoutName, 'even-vertical', 'previous-layout');
  T.applyLayout(w, 'tiled');
  T.nextLayout(w);
  assert.equal(w.layoutName, 'even-horizontal', 'round again');
});

test('a resize inside a layout moves the border by the cells asked, mirrored ones the other way', () => {
  const { w } = panes(3);
  T.applyLayout(w, 'main-vertical-mirrored');
  const main = T.panesOf(w)[0];
  assert.equal(T.rectOf(w, main.id, 100, 30).x, 20);
  T.resizePane(w, main.id, 'lr', -5, 100, 30);
  assert.equal(T.rectOf(w, main.id, 100, 30).w, 85, 'resize-pane -L on the right-hand main pane widens it');
  assert.equal(T.rectOf(w, main.id, 100, 30).x, 15);
});

test('rotate-window -D: the contents move down one place, the focus stays put', () => {
  const s = T.createSession({ name: 't' });
  const w = T.createWindow(s, 'z');
  const a = w.active, b = T.splitPane(w, a, 'lr', null, true).id, c = T.splitPane(w, b, 'tb', null, true).id;
  T.selectPane(w, b);
  T.rotateWindow(w);
  assert.deepEqual(plain(T.panesOf(w).map((p) => p.id)), [b, c, a], 'C-o: the first goes to the end (tmux: %1 %2 %0)');
  assert.equal(w.active, c, 'the focus stays at the place: the pane that moved in');
  T.rotateWindow(w, true);
  assert.deepEqual(plain(T.panesOf(w).map((p) => p.id)), [a, b, c], 'M-o turns it back');
  assert.equal(w.active, b);
});

test('join-pane: the pane leaves its window (gone when empty) and splits the target, below or to the right, and takes the focus', () => {
  const s = T.createSession({ name: 't' });
  const main = T.createWindow(s, 'main');
  T.selectWindow(s, main.id);
  const left = main.active;
  const right = T.splitPane(main, left, 'lr', null, false).id;
  const logs = T.createWindow(s, 'logs');
  const l2 = T.splitPane(logs, logs.active, 'tb', null, false).id;
  const build = T.createWindow(s, 'build');
  const lone = build.active;
  // tmux: join-pane -s 2 → 0:main panes=3, the new one below the active pane, active; window 2 gone.
  assert.ok(T.joinPane(s, build, lone, main, right, 'tb', false, false));
  assert.equal(T.windowById(s, build.id), null, 'a window left with no pane closes');
  assert.deepEqual(plain(T.panesOf(main).map((p) => p.id)), [left, right, lone]);
  assert.equal(main.active, lone);
  assert.equal(rects(main, 80, 24), '0,0 40x24 41,0 39x12 41,13 39x11', 'as tmux: 0,0 40x24 41,0 39x12 41,13 39x11');
  // join-pane -h -s :1 → to the right of the active pane (19 + 19 in tmux).
  assert.ok(T.joinPane(s, logs, l2, main, lone, 'lr', false, false));
  assert.equal(rects(main, 80, 24), '0,0 40x24 41,0 39x12 41,13 19x11 61,13 19x11');
  assert.equal(T.panesOf(logs).length, 1, 'the other window keeps its other pane');
  // -d: the focus stays; the same pane twice is refused.
  assert.ok(T.joinPane(s, logs, logs.active, main, left, 'tb', true, true));
  assert.equal(main.active, l2);
  assert.equal(T.joinPane(s, main, left, main, left, 'tb'), null);
});

test('swap-window: numbers trade; tmux 3.8 keeps the current number current unless -d', () => {
  const mk = () => {
    const s = T.createSession({ name: 't' });
    const ws = ['main', 'logs', 'build'].map((n) => T.createWindow(s, n));
    T.selectWindow(s, ws[1].id); T.selectWindow(s, ws[2].id);
    return { s, ws };
  };
  const names = (s) => s.windows.map((w) => w.index + ':' + w.name + (w.id === s.active ? '*' : w.id === s.last ? '-' : '')).join(' ');
  let { s, ws } = mk();
  T.swapWindows(s, ws[2].id, ws[0].id, false);
  assert.equal(names(s), '0:build 1:logs- 2:main*', 'tmux: 0:build 1:logs- 2:main*');
  ({ s, ws } = mk());
  T.swapWindows(s, ws[2].id, ws[0].id, true);
  assert.equal(names(s), '0:build* 1:logs 2:main-', 'with -d, tmux: 0:build* 1:logs 2:main-');
});

test('move-window: to a free number only ("index in use"), -r closes the gaps', () => {
  const s = T.createSession({ name: 't' });
  const ws = ['main', 'logs', 'build'].map((n) => T.createWindow(s, n));
  assert.equal(T.moveWindow(s, ws[2].id, 1), false, 'index in use');
  assert.equal(T.moveWindow(s, ws[2].id, 6), true);
  assert.deepEqual(plain(s.windows.map((w) => w.index + ':' + w.name)), ['0:main', '1:logs', '6:build']);
  T.renumberWindows(s);
  assert.deepEqual(plain(s.windows.map((w) => w.index)), [0, 1, 2]);
});
