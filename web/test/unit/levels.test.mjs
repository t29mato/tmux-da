// Courses, ranks and keys.   node --test 'web/test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
import { COURSES as SERVER_COURSES, VER } from '../../../server/src/rules.js';

const LV = load(['levels.js']).ADV.levels;
// Arrays from the sandbox belong to another realm; compare them as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the server knows every course with the same number of questions and rules', () => {
  assert.deepEqual(plain(Object.fromEntries(LV.COURSES.map((c) => [c.id, c.qs.length]))), SERVER_COURSES);
  for (const c of LV.COURSES) assert.equal(c.ver, VER, c.id);
});

test('course ids stay easy / normal / hard so old records carry over', () => {
  assert.deepEqual(plain(LV.COURSES.map((c) => c.id)), ['easy', 'normal', 'hard']);
});

test('rankFor: thresholds by seconds per question, scaled by rankMul', () => {
  assert.equal(LV.rankFor(2), '師範');
  assert.equal(LV.rankFor(2.01), '師範代');
  assert.equal(LV.rankFor(3), '師範代');
  assert.equal(LV.rankFor(5), '三段');
  assert.equal(LV.rankFor(8), '初段');
  assert.equal(LV.rankFor(8.01), '見習い');
  assert.equal(LV.rankFor(99), '見習い');
  assert.equal(LV.rankFor(3.2, 1.6), '師範', 'a hard question may take 1.6 times as long');
});

test('rankMul: the same hands land on about the same Lv and title on every course', () => {
  // Seconds per question the reviewer's simulation gives one player model
  // (read + one move) on each course, following the guide: 入門 1.35 moves
  // a question, 中級 1.71, 上級 2.87.
  const mul = Object.fromEntries(LV.COURSES.map((c) => [c.id, c.rankMul]));
  const models = [
    { easy: 5.20, normal: 6.06, hard: 8.23 }, // 初心者
    { easy: 2.28, normal: 2.72, hard: 3.49 }, // 中級
    { easy: 1.04, normal: 1.33, hard: 1.65 } // 上級
  ];
  for (const m of models) {
    const lvs = ['easy', 'normal', 'hard'].map((id) => LV.levelFor(m[id] / mul[id]));
    assert.ok(Math.max(...lvs) - Math.min(...lvs) <= 1, JSON.stringify(m) + ' → Lv ' + lvs.join('/'));
    const idx = ['easy', 'normal', 'hard'].map((id) => LV.RANKS.findIndex((r) => r.title === LV.rankFor(m[id], mul[id])));
    assert.ok(Math.max(...idx) - Math.min(...idx) <= 1, JSON.stringify(m) + ' → titles ' + idx.join('/'));
  }
  assert.equal(LV.levelFor(5.2), 9, 'a beginner reading the 手順 is well off Lv 1');
});

test('nextRank: the title a course time holds, the next one and the seconds it needs', () => {
  const easy = LV.COURSES[0], hard = LV.COURSES[2];
  const r = plain(LV.nextRank(easy, 89.6));
  assert.equal(r.rank, '初段');
  assert.equal(r.next, '三段');
  assert.equal(r.need, 75, '5 秒 × 15 問');
  assert.equal(+r.gap.toFixed(1), 14.6);
  assert.deepEqual(plain(LV.nextRank(easy, 20)), { rank: '師範', next: null, need: null, gap: null }, 'nothing above 師範');
  const h = plain(LV.nextRank(hard, 100));
  assert.equal(h.rank, '三段');
  assert.equal(h.next, '師範代');
  assert.equal(+h.need.toFixed(1), 76.8, '3 秒 × 1.6 × 16 問');
  assert.equal(plain(LV.nextRank(easy, 40, 10)).rank, '三段', 'n overrides the count');
});

test('par (お手本) is 師範代 pace on every question', () => {
  assert.deepEqual(plain(LV.COURSES.map((c) => LV.par(c))), [45, 75, 77]);
  assert.equal(LV.par(LV.KEIKO, 9), 35, 'the 稽古の間 counts the questions it picked');
});

test('limitFor: the 目安 grows with the moves a question takes, two when unknown', () => {
  assert.equal(LV.limitFor(1), 7);
  assert.equal(LV.limitFor(2), 10);
  assert.equal(LV.limitFor(4), 16);
  assert.equal(LV.limitFor(8), 28);
  assert.equal(LV.limitFor(undefined), LV.limitFor(LV.STEPS_DEFAULT));
});

test('every old rank title maps to a current one', () => {
  const titles = LV.RANKS.map((r) => r.title);
  for (const t of Object.values(LV.OLD_RANKS)) assert.ok(titles.includes(t), t);
});

test('the prefix label is Ctrl+b by default', () => {
  assert.equal(LV.prefixLabel('C-b'), 'Ctrl+b');
  assert.equal(LV.prefixLabel(undefined), 'Ctrl+b');
});

test('resize keys show as Option+arrows on a Mac', () => {
  const mac = load(['levels.js'], { platform: 'MacIntel' }).ADV.levels;
  assert.ok(JSON.stringify(mac.KEYS).includes('Option') || JSON.stringify(mac.KEYS) !== JSON.stringify(LV.KEYS));
});

test('腕前: Lv 1 at 10 秒 per question, Lv 30 at 1.2 秒, monotonic, and paceFor inverts levelFor', () => {
  assert.equal(LV.levelFor(10), 1);
  assert.equal(LV.levelFor(20), 1);
  assert.equal(LV.levelFor(1.2), 30);
  assert.equal(LV.levelFor(0.5), 30);
  let prev = 0;
  for (let p = 10; p >= 1.2; p -= 0.05) { const lv = LV.levelFor(p); assert.ok(lv >= prev); prev = lv; }
  for (let lv = 1; lv <= 30; lv++) assert.equal(LV.levelFor(LV.paceFor(lv)), lv, 'Lv ' + lv);
});

test('dayKey is the date in Japan', () => {
  assert.equal(LV.dayKey(new Date('2026-10-20T14:59:00Z')), '2026-10-20');
  assert.equal(LV.dayKey(new Date('2026-10-20T15:00:00Z')), '2026-10-21');
});

test('the 稽古の間 is not a house: never on the boards, not among the courses', () => {
  assert.equal(LV.KEIKO.practice, true);
  assert.ok(!LV.COURSES.some((c) => c.id === LV.KEIKO.id));
  assert.equal(SERVER_COURSES[LV.KEIKO.id], undefined);
});

test('the new skills are in the courses, with the counts the server knows', () => {
  const normal = LV.COURSES[1].qs, hard = LV.COURSES[2].qs;
  for (const t of ['copy_page', 'last_window', 'break_pane']) assert.ok(normal.includes(t), t + ' in 中級');
  assert.ok(hard.includes('copy_search'), 'copy_search in 上級');
  assert.equal(normal.length, 20);
  assert.equal(hard.length, 16);
});

test('the 稽古 is a drill: practice, no fixed questions, every frequent key weighs 3', () => {
  assert.equal(LV.KEIKO.drill, true);
  assert.equal(LV.KEIKO.practice, true);
  assert.deepEqual(plain(LV.KEIKO.qs), []);
  for (const t of ['focus', 'split_lr', 'zoom', 'new_window', 'select_window', 'last_window', 'copy_search', 'close', 'detach_attach']) assert.equal(LV.DRILL_FREQ[t], 3, t);
  for (const t of ['resize', 'rename', 'swap', 'kill_window', 'break_pane']) assert.equal(LV.DRILL_FREQ[t], 2, t);
  for (const t of ['trident', 'two_akima', 'yank_paste', 'swap_zoom']) assert.equal(LV.DRILL_FREQ[t], 1, t);
});
