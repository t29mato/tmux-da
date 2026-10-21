// The tmux model: moving between rooms.
//   node --test 'web/test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

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
  assert.equal(go(h.win, 'L'), h.right, 'left of the leftmost room is the right side');
  assert.equal(go(h.win, 'U'), null, 'one room from top to bottom: nowhere to go');
});

test('neighbour: noWrap stops at the edge (the 指南 never points round it)', () => {
  const h = house();
  assert.equal(go(h.win, 'R', true), null);
  assert.equal(go(h.win, 'D', true), null);
  assert.equal(go(h.win, 'L', true), h.left);
});
