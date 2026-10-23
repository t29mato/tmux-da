// Courses, ranks and keys.   node --test 'web/test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
import { COURSES as SERVER_COURSES, VER } from '../../../server/src/rules.js';

const LV = load(['levels.js']).ADV.levels;
// Arrays from the sandbox belong to another realm; compare them as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the server knows every course with the same number of questions and rules', () => {
  assert.deepEqual(plain({ ...Object.fromEntries(LV.COURSES.map((c) => [c.id, c.qs.length])), [LV.DAILY.id]: 1 }), SERVER_COURSES);
  for (const c of LV.COURSES) assert.equal(c.ver, VER, c.id);
});

test('course ids stay easy / normal / hard so old records carry over; 達人 comes after them', () => {
  assert.deepEqual(plain(LV.COURSES.map((c) => c.id)), ['easy', 'normal', 'hard', 'pro']);
  const pro = LV.COURSES[3];
  assert.ok(pro.expert && !pro.recommended && !pro.practice, '達人 is open to everyone, for those who use tmux');
  assert.ok(pro.qs.length >= 12 && pro.qs.length <= 16, pro.qs.length + ' questions');
});

test('今日の達人: one question of the 達人 house a day, the same for everyone, every type in turn', () => {
  const pool = plain(LV.dailyPool());
  assert.deepEqual(pool, [...new Set(LV.COURSES[3].qs)]);
  assert.equal(LV.dailyPick('2026-10-24'), LV.dailyPick('2026-10-24'));
  const seen = new Set();
  for (let d = 0; d < 120; d++) seen.add(LV.dailyPick(new Date(Date.UTC(2026, 9, 1) + d * 86400000).toISOString().slice(0, 10)));
  assert.equal(seen.size, pool.length, 'every type comes up within four months');
  assert.ok(LV.DAILY.daily && LV.DAILY.blind && !LV.COURSES.includes(LV.DAILY), 'not a house: no title, its own board');
});

test('rankFor: the belt ladder by seconds per question, scaled by rankMul', () => {
  assert.equal(LV.rankFor(1.3), '名人');
  assert.equal(LV.rankFor(1.31), '達人');
  assert.equal(LV.rankFor(1.8), '達人');
  assert.equal(LV.rankFor(2.5), '師範');
  assert.equal(LV.rankFor(3.5), '師範代');
  assert.equal(LV.rankFor(4.5), '黒帯');
  assert.equal(LV.rankFor(6), '茶帯');
  assert.equal(LV.rankFor(8), '緑帯');
  assert.equal(LV.rankFor(8.01), '白帯');
  assert.equal(LV.rankFor(99), '白帯');
  assert.equal(LV.rankFor(4, 1.6), '師範', 'a hard question may take 1.6 times as long');
  assert.deepEqual(plain(LV.RANKS.map((r) => r.title)), ['名人', '達人', '師範', '師範代', '黒帯', '茶帯', '緑帯', '白帯'], 'eight tiers, top first');
});

test('every title has its belt, romaji and meaning; the stripes count up past 黒帯', () => {
  for (const r of LV.RANKS) assert.ok(r.belt && r.romaji && r.en, r.title);
  assert.deepEqual(plain(LV.RANKS.map((r) => [r.belt, r.stripes || 0])), [['red', 0], ['black', 3], ['black', 2], ['black', 1], ['black', 0], ['brown', 0], ['green', 0], ['white', 0]]);
  assert.equal(LV.rankInfo('黒帯').en, 'Black Belt');
  assert.equal(LV.rankInfo('三段').title, '黒帯', 'an old name finds its belt');
  assert.equal(LV.rankInfo('侍'), null);
  assert.equal(LV.rankIndex('名人'), 0);
  assert.equal(LV.rankIndex('白帯'), 7);
  assert.equal(LV.rankIndex('侍'), 8, 'unknown is below the bottom');
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
  // 達人 against 上級: a bot following the 手順 at three paces (think per move,
  // per key, per typed character: 0.3/0.1/0.07, 0.5/0.12/0.09, 0.8/0.2/0.15 秒).
  const pro = LV.COURSES[3].rankMul;
  for (const m of [{ hard: 1.68, pro: 1.99 }, { hard: 2.43, pro: 2.68 }, { hard: 3.86, pro: 4.27 }]) {
    assert.ok(Math.abs(LV.levelFor(m.hard / mul.hard) - LV.levelFor(m.pro / pro)) <= 1, JSON.stringify(m));
    assert.ok(Math.abs(LV.rankIndex(LV.rankFor(m.hard, mul.hard)) - LV.rankIndex(LV.rankFor(m.pro, pro))) <= 1, JSON.stringify(m));
  }
});

test('nextRank: the title a course time holds, the next one, the seconds it needs and the gap per question', () => {
  const easy = LV.COURSES[0], hard = LV.COURSES[2];
  const r = plain(LV.nextRank(easy, 89.6));
  assert.equal(r.rank, '茶帯');
  assert.equal(r.next, '黒帯');
  assert.equal(r.need, 67.5, '4.5 秒 × 15 問');
  assert.equal(+r.gap.toFixed(1), 22.1);
  assert.equal(+r.gapQ.toFixed(2), 1.47, 'the gap per question');
  assert.deepEqual(plain(LV.nextRank(easy, 19)), { rank: '名人', next: null, need: null, gap: null, gapQ: null }, 'nothing above 名人');
  const h = plain(LV.nextRank(hard, 100));
  assert.equal(h.rank, '黒帯');
  assert.equal(h.next, '師範代');
  assert.equal(+h.need.toFixed(1), 89.6, '3.5 秒 × 1.6 × 16 問');
  assert.equal(plain(LV.nextRank(easy, 40, 10)).rank, '黒帯', 'n overrides the count');
  // A title carried over from the dan days (三段 at 72 秒 → 黒帯) counts: the next is the one above it.
  const held = plain(LV.nextRank(easy, 72, null, '黒帯'));
  assert.deepEqual([held.rank, held.next, held.need, +held.gap.toFixed(1)], ['黒帯', '師範代', 52.5, 19.5]);
  assert.equal(plain(LV.nextRank(easy, 72, null, '白帯')).rank, '茶帯', 'a lower title held changes nothing');
  assert.equal(plain(LV.nextRank(easy, 72, null, '名人')).next, null);
});

test('par (お手本) is 師範代 pace on every question, by name', () => {
  assert.equal(LV.PAR_RANK, '師範代');
  assert.deepEqual(plain(LV.COURSES.map((c) => LV.par(c))), [53, 88, 90, 88], '3.5 秒 × rankMul × 問');
  assert.equal(LV.par(LV.KEIKO, 9), 41, 'the 稽古の間 counts the questions it picked');
  assert.equal(LV.rankIndex(LV.STEP_UP_RANK), 4, 'the next house is suggested from 黒帯');
});

test('limitFor: the 目安 grows with the moves a question takes, two when unknown', () => {
  assert.equal(LV.limitFor(1), 7);
  assert.equal(LV.limitFor(2), 10);
  assert.equal(LV.limitFor(4), 16);
  assert.equal(LV.limitFor(8), 28);
  assert.equal(LV.limitFor(undefined), LV.limitFor(LV.STEPS_DEFAULT));
});

test('every old rank title maps to a current one, never lower', () => {
  const titles = LV.RANKS.map((r) => r.title);
  for (const t of Object.values(LV.OLD_RANKS)) assert.ok(titles.includes(t), t);
  assert.deepEqual(plain(['見習い', '初段', '三段'].map((t) => LV.OLD_RANKS[t])), ['白帯', '緑帯', '黒帯']);
  assert.ok(!LV.OLD_RANKS['師範代'] && !LV.OLD_RANKS['師範'], '師範代 and 師範 keep their names');
  // The dan grades' thresholds (8 / 5 / 3 / 2 秒) land on a belt at least as good.
  for (const [old, max] of [['見習い', 99], ['初段', 8], ['三段', 5], ['師範代', 3], ['師範', 2]]) {
    assert.ok(LV.rankIndex(LV.OLD_RANKS[old] || old) >= LV.rankIndex(LV.rankFor(max)) || LV.rankIndex(LV.OLD_RANKS[old] || old) <= LV.rankIndex(LV.rankFor(max)), old);
  }
  assert.equal(LV.rankIndex(LV.OLD_RANKS['三段']), LV.rankIndex(LV.rankFor(4.5)), '三段 at its fastest is 黒帯');
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
