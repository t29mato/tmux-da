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
  assert.equal(LV.rankFor(1.6), '名匠');
  assert.equal(LV.rankFor(1.61), 'からくり師');
  assert.equal(LV.rankFor(5), '仕掛け番');
  assert.equal(LV.rankFor(99), '見習い');
  assert.equal(LV.rankFor(3.2, 2), '名匠', 'a hard question may take twice as long');
});

test('par (当主の刻) is からくり師 pace on every question', () => {
  assert.deepEqual(plain(LV.COURSES.map(LV.par)), [36, 62, 77]);
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
