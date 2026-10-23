// The Worker end to end, in-process, on a SQLite stand-in for D1.
//   node --test 'server/test/*.test.mjs'
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeD1 } from './d1.mjs';
import { dailyOrder, jstDay } from '../src/rules.js';

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

const human = (id, course, s, misses = 0, extra = {}) => {
  const qs = dailyOrder(course, jstDay(new Date())).map((t, i) => ({ t, s, m: i === 0 ? misses : 0 }));
  const n = qs.length;
  return { id, course, ver: 2, at: new Date().toISOString(), time: +(n * s + 2 * misses).toFixed(2), misses, qs, ...extra };
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
  assert.equal((await call('POST', '/v1/name', { key: b, name: 'たまご\u200b' })).status, 409, 'a zero-width space does not make a second たまご');
  assert.equal((await call('POST', '/v1/name', { key: b, name: '\u200b\u200b' })).status, 400, 'an invisible name');
  assert.equal((await call('POST', '/v1/name', { key: b, name: 'a\u0301\u0301\u0301\u0301' })).status, 400, 'piled-up accents');
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
  const wrongOrder = human('r_5', 'easy', 2); wrongOrder.qs.reverse();
  assert.equal((await call('POST', '/v1/scores', { key, run: wrongOrder })).status, 400, 'not today\'s order');
  const ok = await call('POST', '/v1/scores', { key, run: human('r_4', 'easy', 2, 1) });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.rank, ok.body.total], [1, 1]);
});

test('scores: a run on the player\'s own keys is on the board, marked', async () => {
  const own = await player('ねこ'), def = await player('いぬ');
  assert.equal((await call('POST', '/v1/scores', { key: own, run: human('o1', 'easy', 1, 0, { conf: 1, prefix: 'Ctrl+a' }) })).status, 200);
  assert.equal((await call('POST', '/v1/scores', { key: def, run: human('d1', 'easy', 1.2) })).status, 200);
  const rows = (await call('GET', '/v1/board?course=easy&span=today')).body.rows;
  assert.deepEqual(rows.map((r) => [r.name, r.own]), [['ねこ', 1], ['いぬ', 0]]);
  assert.equal((await call('GET', '/v1/ghost?course=easy&span=today')).body.ghost.own, 1);
});

test('scores: a database from before the own column gets it on first use', async () => {
  env.DB.raw.exec('DROP TABLE scores; CREATE TABLE scores (run_id TEXT NOT NULL, key_hash TEXT NOT NULL, course TEXT NOT NULL, ver INTEGER NOT NULL, time REAL NOT NULL, day TEXT NOT NULL, at TEXT NOT NULL, splits TEXT NOT NULL, PRIMARY KEY (key_hash, run_id))');
  const key = await player('むかし');
  assert.equal((await call('POST', '/v1/scores', { key, run: human('m1', 'easy', 1) })).status, 200);
  assert.deepEqual((await call('GET', '/v1/board?course=easy&span=today')).body.rows.map((r) => [r.name, r.own]), [['むかし', 0]]);
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

test('rate limit: at most 40 new 合言葉 a day from one address', async () => {
  const minute = Math.floor(Date.now() / 60000);
  env.DB.raw.prepare('INSERT INTO hits (ip, minute, n) VALUES (?, ?, 40)').run('192.0.2.2:keys:day', (Math.floor(minute / 1440) + 1) * 1440);
  assert.equal((await call('POST', '/v1/keys', undefined, { ip: '192.0.2.2' })).status, 429);
  assert.equal((await call('POST', '/v1/keys', undefined, { ip: '192.0.2.3' })).status, 200, 'another address is fine');
  assert.equal((await call('POST', '/v1/sync', { key: 'nope-nope-nope-000', runs: [] }, { ip: '192.0.2.2' })).status, 404, 'only new 合言葉 are capped by day');
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

// ---- key logs, ghosts to pick, published configs ----------------------------
import fs from 'node:fs';
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/keylogs.json', import.meta.url), 'utf8'));
// A human run on today's order, with a log that fits it: `g` ms a key, the
// boundaries from the splits, the last key at the clock's end.
const logged = (id, course, s, misses = 0, extra = {}) => {
  const r = human(id, course, s, misses, extra);
  const n = r.qs.length, keys = [], q = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    q.push(Math.round(t));
    // Two keys a question: the prefix a bit in, the key at the end (a hand: never the same gap twice).
    keys.push([Math.round(t + s * 1000 * 0.4 + (i % 7) * 3), 'Ctrl+b']);
    keys.push([Math.round(t + s * 1000 - 20 - (i % 5) * 4), '%']);
    t += s * 1000;
  }
  r.keys = keys.length;
  r.klog = { keys, q };
  return r;
};

test('scores: the key log is kept with the run and comes back with the ghost', async () => {
  const key = await player('こま');
  const r = logged('l1', 'easy', 1.2);
  assert.equal((await call('POST', '/v1/scores', { key, run: r })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM keylogs').get().n, 1);
  const g = (await call('GET', '/v1/ghost?course=easy&span=today')).body.ghost;
  assert.equal(g.name, 'こま');
  assert.equal(g.keys.keys.length, 30);
  assert.equal(g.keys.q.length, 15);
  assert.equal(g.rank, 1);
  const rows = (await call('GET', '/v1/board?course=easy&span=today')).body.rows;
  assert.deepEqual(rows.map((x) => [x.name, x.log, x.conf]), [['こま', 1, 0]]);
});

test('scores: a run recorded from a real hand (fixture) is accepted', async () => {
  const key = await player('ひと');
  // The fixture's questions are of its own day: the log is checked on today's order.
  const r = human('f1', 'easy', 0.49);
  const f = FIX['easy-expert'];
  r.qs = r.qs.map((q, i) => ({ ...q, s: f.qs[i].s }));
  r.time = +f.qs.reduce((a, q) => a + q.s, 0).toFixed(2);
  r.keys = f.keys; r.klog = f.klog;
  const res = await call('POST', '/v1/scores', { key, run: r });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('scores: a script\'s log is refused with the reason; an older client without a log is not', async () => {
  const key = await player('きかい');
  const bot = logged('b1', 'easy', 1.0);
  bot.klog.keys = bot.klog.keys.map((e, i) => [Math.round(i * 500), e[1]]);
  const res = await call('POST', '/v1/scores', { key, run: bot });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /^key log: /);
  const old = human('o1', 'easy', 1.0);
  delete old.klog;
  assert.equal((await call('POST', '/v1/scores', { key, run: old })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM keylogs').get().n, 0);
});

test('ghost: the next one up from a time, and a player\'s own best by name', async () => {
  for (const [name, s] of [['いち', 1.0], ['に', 1.5], ['さん', 2.0]]) {
    const key = await player(name);
    await call('POST', '/v1/scores', { key, run: logged('g_' + name, 'easy', s) });
  }
  const next = (await call('GET', '/v1/ghost?course=easy&span=today&above=30')).body.ghost;
  assert.equal(next.name, 'に', 'the slowest run faster than 30 s');
  assert.equal(next.rank, 2);
  assert.equal((await call('GET', '/v1/ghost?course=easy&span=today&above=15')).body.ghost, null, 'nobody faster than 15 s');
  const named = (await call('GET', '/v1/ghost?course=easy&span=today&name=' + encodeURIComponent('さん'))).body.ghost;
  assert.equal(named.time, 30);
  assert.equal(named.keys.keys.length, 30);
  assert.equal((await call('GET', '/v1/ghost?course=easy&span=today&name=nobody')).body.ghost, null);
});

test('conf: a named player publishes the file, anyone reads it, the owner takes it down', async () => {
  const key = await player('せってい');
  const text = 'set -g prefix C-a\nbind | split-window -h\n';
  assert.equal((await call('POST', '/v1/conf', { key, text })).body.shared, true);
  const got = await call('GET', '/v1/conf?name=' + encodeURIComponent('せってい'));
  assert.equal(got.status, 200);
  assert.equal(got.body.text, text, 'as pasted, nothing stripped');
  await call('POST', '/v1/scores', { key, run: logged('c1', 'easy', 1.0, 0, { conf: 1, prefix: 'Ctrl+a' }) });
  const rows = (await call('GET', '/v1/board?course=easy&span=today')).body.rows;
  assert.deepEqual(rows.map((x) => [x.own, x.conf]), [[1, 1]]);
  assert.equal((await call('GET', '/v1/ghost?course=easy&span=today')).body.ghost.conf, 1);
  assert.equal((await call('POST', '/v1/conf', { key, text: '' })).body.shared, false);
  assert.equal((await call('GET', '/v1/conf?name=' + encodeURIComponent('せってい'))).status, 404);
  assert.deepEqual((await call('GET', '/v1/board?course=easy&span=today')).body.rows.map((x) => x.conf), [0]);
});

test('conf: needs a name, at most 8 KB, a string', async () => {
  const anon = await player();
  assert.equal((await call('POST', '/v1/conf', { key: anon, text: 'bind x kill-pane' })).status, 400);
  const key = await player('おおきい');
  assert.equal((await call('POST', '/v1/conf', { key, text: 'x'.repeat(8 * 1024 + 1) })).status, 413);
  assert.equal((await call('POST', '/v1/conf', { key, text: 'あ'.repeat(3000) })).status, 413, 'bytes, not characters');
  assert.equal((await call('POST', '/v1/conf', { key, text: 42 })).status, 400);
  assert.equal((await call('GET', '/v1/conf?name=')).status, 400);
  assert.equal((await call('GET', '/v1/conf?name=' + encodeURIComponent('だれもいない'))).status, 404);
});

test('a database from before the key logs and the configs gets their tables on first use', async () => {
  env.DB.raw.exec('DROP TABLE keylogs; DROP TABLE confs;');
  const key = await player('ふるい');
  assert.equal((await call('POST', '/v1/scores', { key, run: logged('old1', 'easy', 1) })).status, 200);
  assert.equal((await call('GET', '/v1/board?course=easy&span=today')).body.rows[0].log, 1);
  assert.equal((await call('POST', '/v1/conf', { key, text: 'bind x kill-pane' })).body.shared, true);
});

test('replay: a ranked run by its id, with its log; nothing without a name or a wrong id', async () => {
  const key = await player('みる');
  await call('POST', '/v1/scores', { key, run: logged('w1', 'easy', 1.1) });
  const r = await call('GET', '/v1/replay?id=w1');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.name, r.body.course, r.body.time, r.body.keys.keys.length, r.body.own], ['みる', 'easy', 16.5, 30, 0]);
  assert.equal((await call('GET', '/v1/board?course=easy&span=today')).body.rows[0].id, 'w1', 'the board row carries the id for its link');
  assert.equal((await call('GET', '/v1/replay?id=nope')).status, 404);
  assert.equal((await call('GET', '/v1/replay?id=' + encodeURIComponent('a b'))).status, 400);
  // A run synced but never ranked (no name) is not there.
  const anon = await player();
  await call('POST', '/v1/sync', { key: anon, runs: [human('s1', 'easy', 1)] });
  assert.equal((await call('GET', '/v1/replay?id=s1')).status, 404);
});
