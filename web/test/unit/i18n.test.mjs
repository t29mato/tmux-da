// The two languages and the English plurals.   node --test 'web/test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const en = () => load(['en.js', 'i18n.js'], { search: '?lang=en' }).ADV.i18n;
const ja = () => load(['en.js', 'i18n.js'], { search: '?lang=ja' }).ADV.i18n;

test('t: the Japanese as written, or its English, with {0} filled in', () => {
  assert.equal(ja().t('{0} 回', 3), '3 回');
  assert.equal(en().t('{0} 回', 3), '3 runs');
  assert.equal(en().t('{0} 回', 1), '1 run');
  assert.equal(en().t('通算 {0} 回', 1), '1 run in all');
  assert.equal(en().t('通算 {0} 回', 12), '12 runs in all');
  assert.equal(en().t('使う {0} 行', 1), '1 line used');
  assert.equal(en().t('手順なし・押し違いなしで続けて解けた最長 {0} 問 ・ {1} 回', 7, 1), 'Longest run from memory with no wrong key: 7 · 1 drill');
});

test('t: {0:one|many} is left alone in Japanese and when there is no argument', () => {
  assert.equal(ja().t('{0:run|runs} {0}', 1), 'run 1', 'the syntax works in either language');
  assert.equal(en().t('{0} 回'), '{0} {0:run|runs}', 'no argument: the template as it is');
  assert.equal(en().t('あと {0}', null), ' to go');
});

test('every English value with a plural marker names the argument it depends on', () => {
  const EN = load(['en.js']).ADV.EN;
  for (const [k, v] of Object.entries(EN)) {
    for (const m of v.matchAll(/\{(\d):[^{}]*\}/g)) assert.ok(k.includes('{' + m[1] + '}'), k + ' has no {' + m[1] + '}');
  }
});

test('no English value keeps the Japanese middle dot', () => {
  const EN = load(['en.js']).ADV.EN;
  for (const [k, v] of Object.entries(EN)) assert.ok(!/・/.test(v), k + ' → ' + v);
});
