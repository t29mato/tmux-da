// Unit tests for the records server's pure rules.
//   node --test server/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, checkRun, cleanRun, jstDay, COURSES, MIN_PER_Q } from '../src/rules.js';

const run = (n, s = 1.5, extra = {}) => {
  const qs = Array.from({ length: n }, () => ({ t: 'split_lr', s, m: 0 }));
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
    ['inhumanly fast', run(20, MIN_PER_Q - 0.01)],
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
