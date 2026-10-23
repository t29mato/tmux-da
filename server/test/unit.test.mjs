// Unit tests for the records server's pure rules.
//   node --test server/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, cleanName, checkRun, cleanRun, jstDay, dailyOrder, orderDays, QUESTIONS, COURSES, MIN_Q, MIN_AVG, PAUSE_MAX, NAME_MAX } from '../src/rules.js';
import { load, plain } from '../../web/test/unit/load.mjs';

// A run on today's order of the course (`n` questions of it: a short run
// is one with questions missing).
const run = (n, s = 1.5, extra = {}) => {
  const course = extra.course && QUESTIONS[extra.course] ? extra.course : 'normal';
  const qs = dailyOrder(course, jstDay(new Date())).slice(0, n).map((t) => ({ t, s, m: 0 }));
  return { id: 'r_x', course: 'normal', ver: 2, time: +(n * s).toFixed(2), qs, ...extra };
};

test('normalizeKey accepts what people type', () => {
  assert.equal(normalizeKey('matsu-kaze-tsuru-482'), 'matsu-kaze-tsuru-482');
  assert.equal(normalizeKey('  MATSU KAZE TSURU 482 '), 'matsu-kaze-tsuru-482');
  assert.equal(normalizeKey('matsu_kaze--tsuru-482'), 'matsu-kaze-tsuru-482');
  assert.equal(normalizeKey('matsu－kaze－tsuru－482'), 'matsu-kaze-tsuru-482');
});

test('normalizeKey refuses anything else', () => {
  for (const k of [null, 42, '', 'matsu-kaze-482', 'matsu-kaze-tsuru-48', 'matsu-kaze-tsuru-4821', 'まつ-かぜ-つる-482', "a-b-c-123'; drop table players;--"]) {
    assert.equal(normalizeKey(k), null, String(k));
  }
});

test('checkRun: a human run adds up', () => {
  const r = run(COURSES.normal);
  const c = checkRun(r);
  assert.equal(c.splits.length, 20);
  assert.equal(c.time, 30);
});

test('checkRun: a run on the player\'s own keys is ranked like any other, and marked', () => {
  const c = checkRun({ ...run(COURSES.normal), conf: 1, prefix: 'Ctrl+a' });
  assert.deepEqual([c.time, c.own], [30, 1]);
  assert.equal(checkRun(run(COURSES.normal)).own, 0);
});

test('the courses here are the courses of levels.js', () => {
  const LV = load(['i18n.js', 'levels.js']).ADV.levels;
  const mine = Object.fromEntries(LV.COURSES.map((c) => [c.id, plain(c.qs)]));
  assert.deepEqual(mine, QUESTIONS);
  assert.ok(LV.COURSES.every((c) => c.ver === 2), 'a course change bumps ver and VER together');
});

test('today\'s order: fixed by the day and the course, unzoom right after zoom', () => {
  const a = dailyOrder('easy', '2026-10-23'), b = dailyOrder('easy', '2026-10-24');
  assert.deepEqual(dailyOrder('easy', '2026-10-23'), a);
  assert.notDeepEqual(a, b);
  assert.deepEqual([...a].sort(), [...QUESTIONS.easy].sort());
  for (const day of ['2026-10-23', '2026-10-24', '2026-11-01']) {
    for (const course of Object.keys(QUESTIONS)) {
      const o = dailyOrder(course, day);
      o.forEach((t, i) => {
        if (t === 'unzoom' && o.indexOf('zoom') >= 0) assert.equal(o[i - 1], 'zoom', course + ' ' + day + ': unzoom follows zoom');
      });
    }
  }
  assert.deepEqual(orderDays(new Date('2026-10-23T03:00:00Z')), ['2026-10-22', '2026-10-23', '2026-10-24']);
});

test('checkRun: the questions must be today\'s (or the day before or after: a run over midnight, a clock ahead)', () => {
  const now = new Date();
  const at = (day) => ({ ...run(20), qs: dailyOrder('normal', day).map((t) => ({ t, s: 1.5, m: 0 })) });
  for (const day of orderDays(now)) assert.equal(checkRun(at(day), now).time, 30, day);
  assert.throws(() => checkRun(at('2026-01-01'), now), /order/, 'another day\'s order');
  const r = run(20);
  r.qs.reverse();
  assert.throws(() => checkRun(r, now), /order/, 'today\'s questions backwards');
  const all = { ...run(20), qs: Array.from({ length: 20 }, () => ({ t: 'split_lr', s: 1.5, m: 0 })) };
  assert.throws(() => checkRun(all, now), /order/, 'the same easy question twenty times');
  const other = { ...run(20), course: 'easy', qs: dailyOrder('easy', jstDay(now)).map((t) => ({ t, s: 2, m: 0 })), time: 30 };
  assert.equal(checkRun(other, now).time, 30, 'the right course');
  assert.throws(() => checkRun({ ...other, course: 'hard' }, now), /./, 'easy\'s questions on hard');
});

test('cleanName: what goes on the boards', () => {
  assert.equal(cleanName('  たまご  '), 'たまご');
  assert.equal(cleanName('ta  ma go'), 'ta ma go');
  assert.equal(cleanName('🐣ひよこ'), '🐣ひよこ');
  assert.equal(cleanName('é'.normalize('NFD')), 'é', 'NFC');
  assert.equal(cleanName('たまご\u200b'), 'たまご', 'a zero-width space is dropped, not a second たまご');
  assert.equal(cleanName('\u202eabc'), 'abc', 'direction marks are dropped');
  assert.equal(cleanName('あ'.repeat(NAME_MAX)), 'あ'.repeat(NAME_MAX));
  for (const bad of [null, 42, '', '   ', 'あ'.repeat(NAME_MAX + 1), '<b>', 'a\u0000b', '\u200b\u200b', '\u3099\u3099', '…', 'a\u0301\u0301\u0301\u0301', '\ue000']) {
    assert.equal(cleanName(bad), null, JSON.stringify(bad));
  }
});

test('checkRun: one quick question is fine when the run as a whole is humanly paced', () => {
  const r = run(COURSES.normal, 0.6);
  r.qs[0].s = 0.22; // the prefix pressed during the last question's seal
  r.time = +r.qs.reduce((a, q) => a + q.s, 0).toFixed(2);
  assert.equal(checkRun(r).splits[0], 0.22);
  assert.ok(0.22 < 0.25, 'the old per-question floor of 0.25 refused this');
});

test('checkRun: a paused run and a shuffled order stay off the boards', () => {
  assert.throws(() => checkRun({ ...run(20), shuffled: 1 }), /order/);
  assert.throws(() => checkRun({ ...run(20), paused: PAUSE_MAX + 0.1 }), /paused/);
  assert.equal(checkRun({ ...run(20), paused: PAUSE_MAX, pauses: 2 }).time, 30, 'a short pause is allowed');
});

test('checkRun: misses add +2 秒 to their question', () => {
  const r = run(COURSES.normal);
  r.qs[3].m = 2;
  r.time += 4;
  assert.equal(checkRun(r).splits[3], 5.5);
});

test('checkRun refuses impossible or broken runs', () => {
  const bad = [
    ['unknown course', { ...run(20), course: 'nope' }],
    ['practice is never ranked', { ...run(20), course: 'keiko' }],
    ['old rules', { ...run(20), ver: 1 }],
    ['a question missing', run(19)],
    ['a question with no time at all', run(20, MIN_Q - 0.01)],
    ['inhumanly fast on average', run(20, MIN_AVG - 0.01)],
    ['time does not add up', { ...run(20), time: 10 }],
    ['negative misses', (() => { const r = run(20); r.qs[0].m = -1; return r; })()],
    ['split not a number', (() => { const r = run(20); r.qs[0].s = '1'; return r; })()],
    ['no run', null]
  ];
  for (const [why, r] of bad) assert.throws(() => checkRun(r), /./, why);
});

test('cleanRun keeps sane runs and drops the rest', () => {
  assert.ok(cleanRun({ id: 'r_1', course: 'easy', time: 20, at: '2026-10-21T00:00:00Z' }));
  assert.equal(cleanRun({ id: 'r_1', course: 'nope', time: 20, at: '2026-10-21T00:00:00Z' }), null);
  assert.ok(cleanRun({ id: 'r_k', course: 'keiko', time: 20, at: '2026-10-21T00:00:00Z' }), 'practice runs sync');
  assert.equal(cleanRun({ id: 'r_1', course: 'easy', time: -1, at: '2026-10-21T00:00:00Z' }), null);
  assert.equal(cleanRun({ id: 'r_1', course: 'easy', time: 20, at: 'yesterday' }), null);
  assert.equal(cleanRun({ id: 'r_1', course: 'easy', time: 20, at: '2026-10-21T00:00:00Z', pad: 'x'.repeat(9000) }), null);
});

test('jstDay rolls over at midnight in Japan', () => {
  assert.equal(jstDay(new Date('2026-10-20T14:59:59Z')), '2026-10-20');
  assert.equal(jstDay(new Date('2026-10-20T15:00:00Z')), '2026-10-21');
});

// ---- the key log ----------------------------------------------------------
// Three runs a hand played by the guide (recorded with Playwright at an
// expert, a steady and a slow pace: fixtures/keylogs.json), and the ways a
// script's log gives itself away.
import fs from 'node:fs';
import { checkLog, LOG_MAX } from '../src/rules.js';
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/keylogs.json', import.meta.url), 'utf8'));
const withLog = (name, patch) => {
  const r = JSON.parse(JSON.stringify(FIX[name]));
  return patch ? patch(r) || r : r;
};

test('checkLog: runs a hand played pass, at every pace', () => {
  for (const name of Object.keys(FIX)) {
    const r = FIX[name];
    const c = checkLog(r);
    assert.ok(c && c.keys.length === r.keys, name + ': ' + r.keys + ' keys');
    assert.equal(c.cut, false);
    assert.ok(r.time / r.n < 5, name + ' is a plausible pace');
  }
  assert.ok(FIX['easy-expert'].time / 15 < 0.6, 'the expert run is faster than 0.6 s a question and still accepted');
});

test('checkLog: no log (an older client) is accepted as before', () => {
  assert.equal(checkLog(withLog('easy-expert', (r) => { delete r.klog; })), null);
});

test('checkLog: the log must agree with the run', () => {
  const fails = (patch, why) => assert.throws(() => checkLog(withLog('normal-steady', patch)), (e) => e.status === 400 && e.message.startsWith('key log: '), why);
  fails((r) => { r.klog.keys.pop(); }, 'a key fewer than reported');
  fails((r) => { r.keys += 3; }, 'more keys reported than logged');
  fails((r) => { r.klog.keys.slice(-3).forEach((e) => { e[0] = r.klog.keys[5][0]; }); r.klog.keys.sort((a, b) => a[0] - b[0]); }, 'the last keys long before the end');
  fails((r) => { r.klog.q[5] += 1500; }, 'a question boundary off its split');
  fails((r) => { r.klog.q.pop(); }, 'a boundary missing');
  fails((r) => { r.klog = { keys: 'x', q: [] }; }, 'not a list');
  fails((r) => { r.klog.keys[3] = [r.klog.keys[3][0], '']; }, 'an empty label');
  fails((r) => { r.klog.keys[3] = [r.klog.keys[2][0] - 10, 'x']; }, 'time going backwards');
  fails((r) => { r.klog.keys = r.klog.keys.slice(0, 10); r.keys = 10; r.klog.cut = 1; }, 'fewer keys than questions even when cut');
});

test('checkLog: a cut log skips the counts but keeps the shape and the boundaries', () => {
  const c = checkLog(withLog('hard-slow', (r) => { r.klog.cut = 1; r.keys = 999; }));
  assert.equal(c.cut, true);
  assert.throws(() => checkLog(withLog('hard-slow', (r) => { r.klog.cut = 1; r.klog.q[2] -= 2000; })));
  assert.throws(() => checkLog(withLog('hard-slow', (r) => { r.klog.keys = Array.from({ length: LOG_MAX + 1 }, (_, i) => [i * 10, 'x']); r.klog.cut = 1; })));
});

test('checkLog: a script\'s hands are refused, a quick hand is not', () => {
  const bot = (why, patch) => assert.throws(() => checkLog(withLog('easy-expert', patch)), (e) => e.status === 400 && e.message === 'key log: ' + why, why);
  // Every key 5 ms after the one before: nothing is typed that fast.
  bot('intervals too short', (r) => {
    const end = r.klog.keys[r.klog.keys.length - 1][0];
    r.klog.keys = r.klog.keys.map((e, i) => [Math.max(0, end - (r.klog.keys.length - 1 - i) * 5), e[1]]);
    r.klog.q = r.klog.q.map((t, i) => (i ? end - (r.n - i) * 0.01 : 0) | 0);
    r.qs = r.qs.map((q, i) => ({ ...q, s: i ? 0.01 : end / 1000 - 0.14 }));
  });
  // A metronome: the same gap between every key.
  bot('intervals identical', (r) => {
    const gap = 180, L = r.klog.keys.length, kq = Math.floor(L / r.n);
    r.klog.keys = r.klog.keys.map((e, i) => [i * gap, e[1]]);
    // The keys shared out evenly over the questions, the rest in the last.
    r.klog.q = r.klog.q.map((t, i) => i * kq * gap);
    r.qs = r.qs.map((q, i) => ({ ...q, s: (i === r.n - 1 ? L - (r.n - 1) * kq : kq) * gap / 1000 }));
    r.time = +(L * gap / 1000).toFixed(2);
  });
  // A quick hand: 40–120 ms gaps, each a little different: fine.
  const quick = withLog('easy-expert');
  assert.ok(checkLog(quick));
  const gaps = quick.klog.keys.slice(1).map((e, i) => e[0] - quick.klog.keys[i][0]);
  assert.ok(Math.min(...gaps) >= 15, 'the recorded expert never pressed two keys within 15 ms (' + Math.min(...gaps) + ')');
});
