// The Worker end to end, in-process, on a SQLite stand-in for D1.
//   node --test 'server/test/*.test.mjs'
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeD1 } from './d1.mjs';

let env, ip = 0;
beforeEach(() => { env = { DB: makeD1() }; });

// Each call comes from its own address unless told otherwise, so the rate
// limit only bites in the test about it.
async function call(method, path, body, opts = {}) {
  const headers = { Origin: opts.origin || 'https://t29mato.github.io', 'CF-Connecting-IP': opts.ip || '10.0.0.' + (++ip % 250) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://api.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: res.status === 204 ? null : await res.json(), headers: res.headers };
}

const human = (id, course, s, misses = 0) => {
  const n = { easy: 15, normal: 20, hard: 16 }[course];
  const qs = Array.from({ length: n }, (_, i) => ({ t: 'split_lr', s, m: i === 0 ? misses : 0 }));
  return { id, course, ver: 2, at: new Date().toISOString(), time: +(n * s + 2 * misses).toFixed(2), misses, qs };
};

async function player(name) {
  const { body: { key } } = await call('POST', '/v1/keys');
  if (name) assert.equal((await call('POST', '/v1/name', { key, name })).status, 200);
  return key;
}

test('a 合言葉 is three words and three digits, stored only as a hash', async () => {
  const r = await call('POST', '/v1/keys');
  assert.equal(r.status, 200);
  assert.match(r.body.key, /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/);
  const rows = env.DB.raw.prepare('SELECT key_hash FROM players').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].key_hash, r.body.key);
  assert.match(rows[0].key_hash, /^[0-9a-f]{64}$/);
});

test('CORS: the site and file:// pages may call; others get the site origin', async () => {
  assert.equal((await call('GET', '/v1/board?course=easy&span=today')).headers.get('Access-Control-Allow-Origin'), 'https://t29mato.github.io');
  assert.equal((await call('GET', '/v1/board?course=easy&span=today', undefined, { origin: 'null' })).headers.get('Access-Control-Allow-Origin'), 'null');
  assert.equal((await call('GET', '/v1/board?course=easy&span=today', undefined, { origin: 'http://localhost:8000' })).headers.get('Access-Control-Allow-Origin'), 'http://localhost:8000');
  assert.equal((await call('GET', '/v1/board?course=easy&span=today', undefined, { origin: 'https://evil.example' })).headers.get('Access-Control-Allow-Origin'), 'https://t29mato.github.io');
  assert.equal((await call('OPTIONS', '/v1/sync')).status, 204);
});

test('sync: two devices with one 合言葉 end up with the same runs', async () => {
  const key = await player();
  const a = human('r_a', 'normal', 1.5), b = human('r_b', 'normal', 1.2);
  assert.equal((await call('POST', '/v1/sync', { key, runs: [a] })).body.runs.length, 1);
  const res = await call('POST', '/v1/sync', { key: key.toUpperCase().replace(/-/g, ' '), runs: [b, a] });
  assert.deepEqual(res.body.runs.map((r) => r.id).sort(), ['r_a', 'r_b']);
  // Sending the same run again changes nothing.
  assert.equal((await call('POST', '/v1/sync', { key, runs: [a, b] })).body.runs.length, 2);
});

test('sync: bad runs are skipped, bad keys refused', async () => {
  const key = await player();
  const res = await call('POST', '/v1/sync', { key, runs: [human('r_ok', 'easy', 2), { id: 'r_bad', course: 'nope', time: 1, at: 'x' }, null] });
  assert.deepEqual(res.body.runs.map((r) => r.id), ['r_ok']);
  assert.equal((await call('POST', '/v1/sync', { key: 'nope-nope-nope-000', runs: [] })).status, 404);
  assert.equal((await call('POST', '/v1/sync', { key: 'garbage', runs: [] })).status, 400);
  assert.equal((await call('POST', '/v1/sync', { key, runs: 'x' })).status, 400);
});

test('names: unique, at most 12 characters, changeable by their owner', async () => {
  const a = await player('たまご');
  const b = await player();
  assert.equal((await call('POST', '/v1/name', { key: b, name: 'たまご' })).status, 409);
  assert.equal((await call('POST', '/v1/name', { key: b, name: 'x'.repeat(13) })).status, 400);
  assert.equal((await call('POST', '/v1/name', { key: b, name: '<b>' })).status, 400);
  assert.equal((await call('POST', '/v1/name', { key: b, name: '  ひよこ  ' })).body.name, 'ひよこ');
  assert.equal((await call('POST', '/v1/name', { key: a, name: 'にわとり' })).status, 200);
  assert.equal((await call('POST', '/v1/name', { key: b, name: 'たまご' })).status, 200, 'a freed name can be taken');
});

test('scores: need a name, and must be humanly possible', async () => {
  const anon = await player();
  assert.equal((await call('POST', '/v1/scores', { key: anon, run: human('r_1', 'easy', 2) })).status, 400);
  const key = await player('ふくろう');
  assert.equal((await call('POST', '/v1/scores', { key, run: human('r_2', 'easy', 0.1) })).status, 400);
  const bad = human('r_3', 'easy', 2); bad.time = 5;
  assert.equal((await call('POST', '/v1/scores', { key, run: bad })).status, 400);
  const ok = await call('POST', '/v1/scores', { key, run: human('r_4', 'easy', 2, 1) });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.rank, ok.body.total], [1, 1]);
});

test('boards: one row per player, their best, fastest first; spans filter by day', async () => {
  const slow = await player('かめ'), fast = await player('うさぎ');
  await call('POST', '/v1/scores', { key: slow, run: human('s1', 'normal', 2.0) });
  await call('POST', '/v1/scores', { key: slow, run: human('s2', 'normal', 1.8) });
  await call('POST', '/v1/scores', { key: fast, run: human('f1', 'normal', 1.0) });
  // An old run of うさぎ, faster still, from last month: only the all-time board.
  env.DB.raw.prepare("INSERT INTO scores (run_id, key_hash, course, ver, time, day, at, splits) SELECT 'old', key_hash, 'normal', 2, 10, '2026-01-01', '2026-01-01T00:00:00Z', '[]' FROM players WHERE name = 'うさぎ'").run();
  const today = (await call('GET', '/v1/board?course=normal&span=today')).body.rows;
  assert.deepEqual(today.map((r) => [r.rank, r.name, r.time]), [[1, 'うさぎ', 20], [2, 'かめ', 36]]);
  const week = (await call('GET', '/v1/board?course=normal&span=week')).body.rows;
  assert.equal(week.length, 2);
  const all = (await call('GET', '/v1/board?course=normal&span=all')).body.rows;
  assert.deepEqual(all.map((r) => [r.name, r.time]), [['うさぎ', 10], ['かめ', 36]]);
  assert.equal((await call('GET', '/v1/board?course=easy&span=today')).body.rows.length, 0, 'courses are apart');
  assert.equal((await call('GET', '/v1/board?course=normal&span=year')).status, 400);
  assert.equal((await call('GET', '/v1/board?course=nope&span=today')).status, 400);
});

test('ghost: today\'s best run with a split per question', async () => {
  assert.equal((await call('GET', '/v1/ghost?course=hard&span=today')).body.ghost, null);
  const key = await player('きつね');
  await call('POST', '/v1/scores', { key, run: human('g1', 'hard', 3, 2) });
  const g = (await call('GET', '/v1/ghost?course=hard&span=today')).body.ghost;
  assert.equal(g.name, 'きつね');
  assert.equal(g.splits.length, 16);
  assert.equal(g.splits[0], 7, 'the first question carries its +2 秒 × 2');
  assert.equal(g.splits.reduce((a, b) => a + b, 0), g.time);
});

test('rate limit: too many writes from one address in a minute', async () => {
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await call('POST', '/v1/keys', undefined, { ip: '192.0.2.1' })).status);
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(statuses[6], 429);
});

test('unknown paths and bodies', async () => {
  assert.equal((await call('GET', '/v1/nope')).status, 404);
  assert.equal((await call('POST', '/v1/nope', {})).status, 404);
  const key = await player();
  const res = await worker.fetch(new Request('https://api.test/v1/sync', { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.1' }, body: '{not json' }), env);
  assert.equal(res.status, 400);
  assert.ok(key);
});

test('counts: a visit reports its steps; the stats add them up by day and course', async () => {
  const v = 'v_' + '0123456789abcdef';
  for (const e of [{ e: 'visit' }, { e: 'start', c: 'easy' }, { e: 'q1', c: 'easy' }, { e: 'quit', c: 'easy', n: 4 }]) {
    assert.equal((await call('POST', '/v1/ev', { v, ...e })).status, 204);
  }
  assert.equal((await call('POST', '/v1/ev', { v: 'v_' + 'f'.repeat(16), e: 'visit' })).status, 204);
  const s = (await call('GET', '/v1/stats?days=3')).body;
  const today = Object.values(s.days)[0];
  assert.equal(today.visitors, 2);
  assert.deepEqual(today.courses.easy, { start: 1, q1: 1, finish: 0, quit: 1 });
  assert.deepEqual(s.quitAt, [{ c: 'easy', n: 4, k: 1 }]);
});

test('counts: anything but the known steps is refused', async () => {
  for (const b of [{ v: 'me', e: 'visit' }, { v: 'v_0123456789abcdef', e: 'click' }, { v: 'v_0123456789abcdef', e: 'start', c: 'nope' }]) {
    assert.equal((await call('POST', '/v1/ev', b)).status, 400, JSON.stringify(b));
  }
});
