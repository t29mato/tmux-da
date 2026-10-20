// The run history: adding, migrating, merging devices, ghosts, weak spots.
//   node --test 'web/test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, memoryStorage, plain } from './load.mjs';

const fresh = (init) => load(['levels.js', 'records.js'], { storage: memoryStorage(init) }).ADV.records;
const qs = (n, s = 2, m = 0) => Array.from({ length: n }, (_, i) => ({ t: i % 2 ? 'focus' : 'split_lr', s, m: i === 0 ? m : 0 }));
const run = (time, extra = {}) => ({ course: 'easy', prefix: 'C-b', time, raw: time, misses: 0, overs: 0, guides: 0, keys: 30, n: 15, qs: qs(15, time / 15), ...extra });

test('add: the first run and every faster one is a record', () => {
  const REC = fresh();
  assert.equal(REC.add(run(40)).record, true);
  assert.equal(REC.add(run(45)).record, false);
  const s = REC.add(run(35));
  assert.equal(s.record, true);
  assert.equal(s.best, 40);
  assert.equal(s.count, 3);
  assert.equal(REC.best('easy').time, 35);
  assert.equal(REC.runsOf('easy')[0].time, 35, 'newest first');
});

test('add: delta from the last run and 五回平均 after five runs', () => {
  const REC = fresh();
  [50, 48, 46, 44].forEach((t) => REC.add(run(t)));
  const s = REC.add(run(42));
  assert.equal(s.delta, -2);
  assert.equal(s.ao5, 46);
  assert.equal(s.ao5Prev, null);
  assert.equal(REC.add(run(40)).ao5Prev, 46);
});

test('add: rank and the rank going up', () => {
  const REC = fresh();
  REC.add(run(75)); // 5.0 s per question
  const s = REC.add(run(30)); // 2.0
  assert.equal(s.rank, 'からくり師');
  assert.equal(s.rankUp, true);
});

test('migrate: schema 2 rank titles become the new ones', () => {
  const REC = fresh({ 'tmux-da': JSON.stringify({ schema: 2, arena: {}, runs: [{ id: 'r_1', course: 'easy', time: 30, rank: '勇者', at: '2026-01-01T00:00:00Z', qs: [] }] }) });
  assert.equal(REC.runsOf('easy')[0].rank, 'からくり師');
  assert.equal(REC.load().schema, REC.SCHEMA);
});

test('migrate: a schema 1 best time becomes one legacy run', () => {
  const REC = fresh({ 'tmux-da': JSON.stringify({ prefix: 'C-b', arena: { 'tmux:easy': { time: 30.5, misses: 1, date: '2026-01-01' } } }) });
  const runs = REC.runsOf('easy');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].legacy, true);
  assert.equal(runs[0].time, 30.5);
});

test('merge: runs from another device join, by id, once', () => {
  const REC = fresh();
  REC.add(run(40));
  const mine = plain(REC.runsOf('easy'));
  const other = [{ ...run(30), id: 'r_other', ver: 2, at: '2020-01-01T00:00:00Z' }];
  assert.equal(REC.merge(other.concat(mine)), 1);
  assert.equal(REC.merge(other), 0, 'the same run again adds nothing');
  assert.equal(REC.runsOf('easy').length, 2);
});

test('merge: records and the best are worked out again in time order', () => {
  const REC = fresh();
  REC.add(run(40, { at: '2026-10-02T00:00:00Z' }));
  REC.merge([{ ...run(30), id: 'r_early', ver: 2, at: '2026-10-01T00:00:00Z' }]);
  const [late, early] = REC.runsOf('easy');
  assert.equal(early.rec, true);
  assert.equal(late.rec, false, 'the 40 s run is no longer a record once the earlier 30 s run is known');
  assert.equal(REC.best('easy').time, 30);
});

test('merge: ignores junk', () => {
  const REC = fresh();
  assert.equal(REC.merge([null, { id: 1 }, { id: 'x', course: 'nope', time: 3 }, { id: 'y', course: 'easy' }]), 0);
  assert.equal(REC.merge(undefined), 0);
});

test('ghostOf: the best complete run, with +2 秒 per miss in its splits', () => {
  const REC = fresh();
  REC.add(run(40));
  REC.add({ ...run(31), qs: qs(15, 2, 0).map((q, i) => (i === 0 ? { ...q, s: 1, m: 1 } : q)) });
  REC.add({ ...run(20), qs: qs(14, 1) }); // a question missing: not a ghost
  const g = REC.ghostOf('easy');
  assert.equal(g.time, 31);
  assert.equal(g.splits.length, 15);
  assert.equal(g.splits[0], 3);
  assert.equal(fresh().ghostOf('easy'), null);
});

test('weakness: the slowest question types first', () => {
  const REC = fresh();
  const slowFocus = () => ({ ...run(30), qs: qs(15, 1).map((q) => (q.t === 'focus' ? { ...q, s: 4, o: 1 } : q)) });
  REC.add(slowFocus());
  REC.add(slowFocus());
  const w = REC.weakness('easy');
  assert.equal(w.weak[0].type, 'focus');
  assert.equal(w.weak[0].overs, 14);
});

test('clearArena empties the history', () => {
  const REC = fresh();
  REC.add(run(40));
  REC.clearArena();
  assert.equal(REC.runsOf('easy').length, 0);
  assert.equal(REC.best('easy'), null);
});

test('storage that throws does not break the game', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const REC = load(['levels.js', 'records.js'], { storage: broken }).ADV.records;
  assert.doesNotThrow(() => REC.add(run(40)));
  assert.equal(REC.runsOf('easy').length, 0);
});
