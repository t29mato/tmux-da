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
  REC.add(run(135)); // 9.0 s per question: 見習い
  const s = REC.add(run(45)); // 3.0
  assert.equal(s.rank, '師範代');
  assert.equal(s.rankUp, true);
});

test('migrate: schema 2 rank titles become the new ones', () => {
  const REC = fresh({ 'tmux-da': JSON.stringify({ schema: 2, arena: {}, runs: [{ id: 'r_1', course: 'easy', time: 30, rank: '勇者', at: '2026-01-01T00:00:00Z', qs: [] }] }) });
  assert.equal(REC.runsOf('easy')[0].rank, '師範代');
  assert.equal(REC.load().schema, REC.SCHEMA);
});

test('migrate: schema 3 house titles become the dojo ones, and so do merged runs', () => {
  const REC = fresh({ 'tmux-da': JSON.stringify({ schema: 3, arena: {}, runs: [{ id: 'r_1', course: 'easy', time: 30, rank: '屋敷守', at: '2026-01-01T00:00:00Z', qs: [] }] }) });
  assert.equal(REC.runsOf('easy')[0].rank, '三段');
  REC.merge([{ id: 'r_2', course: 'easy', time: 20, rank: 'からくり師', at: '2026-01-02T00:00:00Z', qs: [] }]);
  assert.equal(REC.runsOf('easy')[0].rank, '師範代');
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

// ---- learning across courses -------------------------------------------------

// A run where every question is `t`, each taking `s` seconds (easy: 目安 12).
const typed = (t, s, extra = {}) => ({ ...run(15 * s), qs: Array.from({ length: 15 }, () => ({ t, s, m: 0, ...extra })) });

const clean = (n, q = { t: 'zoom', s: 2, m: 0 }) => Array.from({ length: n }, () => ({ ...q }));

test('learnt: five clean solves in a row within the 目安 make a type learnt (LEARNT_AFTER)', () => {
  const REC = fresh();
  REC.add({ ...run(30), qs: clean(4) });
  assert.equal(REC.learnt().zoom.learnt, false);
  assert.equal(REC.learnt().zoom.streak, 4);
  REC.add({ ...run(30), qs: clean(1) });
  assert.equal(REC.learnt().zoom.learnt, true);
});

test('learnt: a wrong key, an overrun, a peek at the 手順 or a solve past half the 目安 starts the count again', () => {
  // The 目安 is logged per question (`l`); older logs fall back on the course's (easy: 12).
  for (const bad of [{ m: 1 }, { o: 1 }, { g: 1 }, { s: 6.1 }, { s: 3.6, l: 7 }]) {
    const REC = fresh();
    REC.add({ ...run(30), qs: clean(5).concat([{ t: 'zoom', s: 2, m: 0, ...bad }]) });
    assert.equal(REC.learnt().zoom.learnt, false, JSON.stringify(bad));
    assert.equal(REC.learnt().zoom.streak, 0);
  }
  const REC = fresh();
  REC.add({ ...run(30), qs: [{ t: 'zoom', s: 3.5, m: 0, l: 7 }, { t: 'zoom', s: 6, m: 0 }, { t: 'zoom', s: 3.5, m: 0, l: 7 }, { t: 'zoom', s: 6, m: 0 }, { t: 'zoom', s: 3.5, m: 0, l: 7 }] });
  assert.equal(REC.learnt().zoom.learnt, true, 'exactly half the 目安 still counts');
});

test('limitOf: a question\'s own 目安, else its course\'s old one', () => {
  const REC = fresh();
  assert.equal(REC.limitOf({ l: 7 }, REC.courseOf('easy')), 7);
  assert.equal(REC.limitOf({}, REC.courseOf('easy')), 12);
  assert.equal(REC.limitOf({}, null), 10);
});

test('add reports what was learnt and what slipped in this run', () => {
  const REC = fresh();
  REC.add({ ...run(30), qs: clean(4) });
  const s1 = REC.add({ ...run(30), qs: clean(1) });
  assert.deepEqual(plain(s1.learntNew), ['zoom']);
  const s2 = REC.add({ ...run(30), qs: [{ t: 'zoom', s: 2, m: 1 }] });
  assert.deepEqual(plain(s2.learntLost), ['zoom']);
});

test('weakTypes: the slowest types relative to their 目安, most overruns first', () => {
  const REC = fresh();
  const mixed = () => ({ ...run(30), qs: [
    ...Array.from({ length: 4 }, () => ({ t: 'zoom', s: 1, m: 0 })),
    ...Array.from({ length: 4 }, () => ({ t: 'resize', s: 9, m: 0, o: 1 })),
    ...Array.from({ length: 4 }, () => ({ t: 'focus', s: 4, m: 0 }))
  ] });
  REC.add(mixed());
  assert.deepEqual(plain(REC.weakTypes(3)), [], 'one run is not enough to call anything weak (the records say so too)');
  REC.add(mixed());
  assert.deepEqual(plain(REC.weakTypes(2)), ['resize'], 'focus is within its 目安 and no slower than the rest: not weak');
  assert.deepEqual(plain(fresh().weakTypes(3)), [], 'nothing to go on yet');
});

test('weakTypes and weakness: nothing is weak when every type is within its 目安 and about as quick', () => {
  const REC = fresh();
  const even = () => ({ ...run(30), qs: [
    ...Array.from({ length: 4 }, () => ({ t: 'zoom', s: 2, m: 0, l: 7 })),
    ...Array.from({ length: 4 }, () => ({ t: 'close', s: 4, m: 0, l: 16 })),
    ...Array.from({ length: 4 }, () => ({ t: 'focus', s: 3.2, m: 0, l: 10 }))
  ] });
  REC.add(even());
  REC.add(even());
  assert.deepEqual(plain(REC.weakTypes(3)), []);
  assert.deepEqual(plain(REC.weakness('easy').weak), [], 'the records panel lists none either');
  // Clearly slow: past half its 目安 and over 1.3 times the others' pace (relative to the 目安).
  const slow = (s) => ({ ...run(30), qs: [
    ...Array.from({ length: 6 }, () => ({ t: 'zoom', s: 1, m: 0, l: 7 })),
    ...Array.from({ length: 6 }, () => ({ t: 'focus', s, m: 0, l: 10 }))
  ] });
  const R2 = fresh();
  R2.add(slow(6)); R2.add(slow(6));
  assert.deepEqual(plain(R2.weakTypes(3)), ['focus']);
  assert.equal(R2.weakness('easy').weak[0].type, 'focus');
  assert.ok(R2.weakness('easy').weak[0].ratio > R2.WEAK_RATIO);
  // Quick hands: 0.3 against 0.1 秒 is three times the pace, but nowhere near the 目安.
  const R3 = fresh();
  R3.add(slow(0.3)); R3.add(slow(0.3));
  assert.deepEqual(plain(R3.weakTypes(3)), []);
  assert.deepEqual(plain(R3.weakness('easy').weak), []);
});

test('skill: the pace of the latest five runs gives the 腕前', () => {
  const REC = fresh();
  assert.equal(REC.skill(), null);
  [75, 60, 45, 36, 30, 30].forEach((t) => REC.add(run(t)));
  const sk = REC.skill();
  assert.equal(sk.runs, 5);
  assert.equal(+sk.pace.toFixed(3), +((60 + 45 + 36 + 30 + 30) / 5 / 15).toFixed(3));
  assert.ok(sk.lv >= 1 && sk.lv <= 30);
  assert.ok(sk.toNext > 0);
  assert.equal(sk.title, '師範代', '2.68 秒 per question');
});

test('skill: practice runs do not count, and rankMul evens out the houses', () => {
  const REC = fresh();
  REC.add({ ...run(30), course: 'keiko', n: 15 });
  assert.equal(REC.skill(), null);
  REC.add({ course: 'hard', time: 64, raw: 64, misses: 0, n: 16, qs: [] }); // 4 s, ×1.6 → 2.5 s
  assert.equal(REC.skill().pace, 2.5);
});

test('add reports the 腕前 before and after', () => {
  const REC = fresh();
  REC.add(run(75));
  const s = REC.add(run(20));
  assert.ok(s.skill.lv > s.skillFrom.lv);
});

test('dailyBest: one point per day (Japan time), the best of the day', () => {
  const REC = fresh();
  REC.add(run(40, { at: '2026-10-01T01:00:00Z' }));
  REC.add(run(35, { at: '2026-10-01T05:00:00Z' }));
  REC.add(run(38, { at: '2026-10-01T16:00:00Z' })); // already the 2nd in Japan
  assert.deepEqual(plain(REC.dailyBest('easy')), [{ day: '2026-10-01', time: 35 }, { day: '2026-10-02', time: 38 }]);
});

test('the 稽古の間 is a course for records (rank, par) with its own question count', () => {
  const REC = fresh();
  const s = REC.add({ ...run(18), course: 'keiko', n: 9, qs: [] });
  assert.equal(s.par, 35);
  assert.equal(REC.courseOf('keiko').practice, true);
});

test('streak: days in a row (Japan time), alive until midnight even before today is played', () => {
  const REC = fresh();
  REC.add(run(40, { at: '2026-10-19T03:00:00Z' }));
  REC.add(run(40, { at: '2026-10-20T03:00:00Z' }));
  REC.add(run(40, { at: '2026-10-21T03:00:00Z' }));
  REC.add({ ...run(18), course: 'keiko', n: 9, qs: [], at: '2026-10-22T03:00:00Z' }); // practice does not count
  assert.deepEqual(plain(REC.streak(null, new Date('2026-10-22T05:00:00Z'))), { days: 3, today: false });
  REC.add(run(39, { at: '2026-10-22T04:00:00Z' }));
  assert.deepEqual(plain(REC.streak(null, new Date('2026-10-22T05:00:00Z'))), { days: 4, today: true });
  assert.deepEqual(plain(REC.streak(null, new Date('2026-10-24T05:00:00Z'))), { days: 0, today: false });
});

// ---- 稽古 (the recall drill) ----------------------------------------------------

test('drillWeight: frequency times weakness; unseen types weigh double, a type just asked weighs half', () => {
  const REC = fresh();
  const recent = [{ t: 'focus', s: 1 }, { t: 'resize', s: 9, o: 1 }, { t: 'resize', s: 3, m: 1 }, { t: 'rename', s: 2, g: 1 }];
  assert.equal(REC.drillWeight('zoom', recent), 3 * 2, 'never seen: freq 3 × 2');
  assert.equal(REC.drillWeight('trident', recent), 1 * 2, 'a rare combo never seen: 1 × 2');
  // resize: freq 2, both bad (×4), last asked one question ago (gap 1 → 0.5 + 0.5 × 1/40).
  assert.ok(Math.abs(REC.drillWeight('resize', recent) - 2 * 4 * (0.5 + 0.5 / 40)) < 1e-9);
  // focus: freq 3, clean (×1), gap 3.
  assert.ok(Math.abs(REC.drillWeight('focus', recent) - 3 * (0.5 + 0.5 * 3 / 40)) < 1e-9);
  // rename: a peek counts as bad.
  assert.ok(Math.abs(REC.drillWeight('rename', recent) - 2 * 4 * 0.5) < 1e-9);
  // Far back: no spacing penalty left.
  const far = [{ t: 'focus', s: 1 }].concat(Array.from({ length: 50 }, () => ({ t: 'zoom', s: 1 })));
  assert.equal(REC.drillWeight('focus', far), 3);
});

test('drillPick: never the same type twice in a row; weights steer the choice', () => {
  const REC = fresh();
  const types = ['focus', 'resize', 'trident'];
  const recent = [{ t: 'resize', s: 9, o: 1 }];
  let last = null;
  const counts = { focus: 0, resize: 0, trident: 0 };
  // A fixed sequence of "random" numbers stands in for Math.random.
  let k = 0;
  const rand = () => ((k++ * 7919) % 1000) / 1000;
  for (let i = 0; i < 300; i++) {
    const t = REC.drillPick(types, recent, last, rand);
    assert.notEqual(t, last, 'no repeat');
    assert.ok(types.includes(t));
    counts[t]++;
    last = t;
  }
  assert.ok(counts.focus > counts.trident, 'the frequent key comes more often than the rare combo: ' + JSON.stringify(counts));
  assert.equal(REC.drillPick(['focus'], recent, 'focus', rand), 'focus', 'one type only: it must repeat');
});

test('drillStreak and drillBest: the longest run from memory, over drill runs only', () => {
  const REC = fresh();
  const clean = (t) => ({ t, s: 1.5, m: 0 });
  assert.equal(REC.drillStreak([clean('focus'), clean('zoom'), { t: 'resize', s: 5, g: 1 }, clean('focus'), clean('close'), clean('zoom')]), 3);
  assert.equal(REC.drillStreak([clean('focus'), { t: 'zoom', s: 1, m: 1 }, { t: 'zoom', s: 9, o: 1 }]), 1);
  assert.equal(REC.drillBest(), 0);
  // An old 苦手の稽古 run (no `drill`) does not count, nor a course run.
  REC.add({ ...run(30), course: 'keiko', n: 3, qs: [clean('resize'), clean('resize'), clean('resize')] });
  REC.add(run(30));
  assert.equal(REC.drillBest(), 0);
  REC.add({ ...run(20), course: 'keiko', drill: true, n: 4, qs: [clean('focus'), clean('zoom'), { t: 'resize', s: 5, g: 1 }, clean('focus')] });
  assert.equal(REC.drillBest(), 2);
  REC.add({ ...run(20), course: 'keiko', drill: true, n: 5, qs: [clean('focus'), clean('zoom'), clean('close'), clean('focus'), clean('split_lr')] });
  assert.equal(REC.drillBest(), 5);
  assert.equal(REC.skill().runs, 1, 'drills do not count towards the 腕前');
});

test('drillRecent: the latest logged questions with the drill\'s own after them', () => {
  const REC = fresh();
  REC.add(run(30));
  const r = REC.drillRecent([{ t: 'zoom', s: 1, m: 0 }]);
  assert.equal(r.length, 16);
  assert.equal(r[15].t, 'zoom');
  assert.equal(r[0].t, 'split_lr');
});
