// The client side of the shared records, against a fake server.
//   node --test 'web/test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, memoryStorage } from './load.mjs';

// A tiny server in memory: keys, runs per key, names.
function fakeServer() {
  const s = { keys: new Map(), calls: [], down: false };
  s.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    s.calls.push((opts.method || 'GET') + ' ' + u.pathname);
    if (s.down) throw new TypeError('Failed to fetch');
    const reply = (status, j) => ({ ok: status < 400, status, json: async () => j });
    if (u.pathname === '/v1/keys') { const k = 'kaze-matsu-tsuru-' + String(s.keys.size).padStart(3, '0'); s.keys.set(k, { runs: new Map(), name: null }); return reply(200, { key: k }); }
    const p = body && s.keys.get(body.key);
    if (!p) return reply(404, { error: 'unknown key' });
    if (u.pathname === '/v1/sync') { body.runs.forEach((r) => p.runs.has(r.id) || p.runs.set(r.id, r)); return reply(200, { runs: [...p.runs.values()], name: p.name }); }
    if (u.pathname === '/v1/name') { p.name = body.name; return reply(200, { name: body.name }); }
    if (u.pathname === '/v1/scores') return reply(200, { rank: 1, total: 1 });
    return reply(404, {});
  };
  return s;
}

const device = (server, storage = memoryStorage()) => load(['levels.js', 'records.js', 'net.js'], { storage, fetch: server.fetch, search: '?api=http://localhost:8787' }).ADV;
const run = (time) => ({ course: 'easy', prefix: 'C-b', time, raw: time, misses: 0, overs: 0, guides: 0, keys: 30, n: 15, qs: [] });

test('nothing is sent until asked: no key, no calls', () => {
  const server = fakeServer();
  const ADV = device(server);
  ADV.records.add(run(40));
  assert.equal(ADV.net.state().key, undefined);
  assert.equal(server.calls.length, 0);
});

test('?api= points the page at a local server, and only a local one', () => {
  const api = (search) => load(['levels.js', 'records.js', 'net.js'], { search }).ADV.net.API;
  assert.equal(api('?api=http://localhost:8787'), 'http://localhost:8787');
  assert.equal(api('?api=http://127.0.0.1:9000/'), 'http://127.0.0.1:9000');
  assert.equal(api('?api=staging'), 'https://tmux-da-api-staging.starrydata-mcp-cloudflare.workers.dev');
  const real = api('');
  assert.match(real, /^https:\/\/tmux-da-api\..+\.workers\.dev$/);
  for (const evil of ['?api=https://evil.example', '?api=http://localhost.evil.example', '?api=http://localhost@evil.example', '?api=javascript:alert(1)']) {
    assert.equal(api(evil), real, evil);
  }
});

test('sync makes a 合言葉 once and sends the runs', async () => {
  const server = fakeServer();
  const ADV = device(server);
  ADV.records.add(run(40));
  await ADV.net.sync();
  await ADV.net.sync();
  assert.match(ADV.net.state().key, /^kaze-matsu-tsuru-\d{3}$/);
  assert.deepEqual(server.calls, ['POST /v1/keys', 'POST /v1/sync', 'POST /v1/sync']);
});

test('useKey brings another device\'s runs and name', async () => {
  const server = fakeServer();
  const A = device(server), B = device(server);
  A.records.add(run(40));
  await A.net.setName('たまご');
  await A.net.sync();
  B.records.add(run(50));
  const res = await B.net.useKey('  KAZE MATSU TSURU 000 ');
  assert.equal(res.added, 1);
  assert.equal(B.net.state().name, 'たまご');
  assert.equal(B.records.runsOf('easy').length, 2);
  assert.equal(B.records.best('easy').time, 40);
});

test('useKey: a wrong 合言葉 keeps the old one', async () => {
  const server = fakeServer();
  const ADV = device(server);
  await ADV.net.sync();
  const before = ADV.net.state().key;
  await assert.rejects(ADV.net.useKey('nope-nope-nope-999'), (e) => e.status === 404);
  assert.equal(ADV.net.state().key, before);
  await assert.rejects(ADV.net.useKey('not a key'), /bad key/);
});

test('submit needs a name; runs on own keys go on the boards too', async () => {
  const server = fakeServer();
  const ADV = device(server);
  await ADV.net.sync();
  assert.equal(await ADV.net.submit({ id: 'r' }), null);
  await ADV.net.setName('ひよこ');
  assert.equal((await ADV.net.submit({ id: 'r' })).rank, 1);
  assert.equal((await ADV.net.submit({ id: 'r2', conf: 1 })).rank, 1);
});

test('offline: calls fail, records stay', async () => {
  const server = fakeServer();
  const ADV = device(server);
  ADV.records.add(run(40));
  server.down = true;
  await assert.rejects(ADV.net.sync());
  assert.equal(ADV.records.runsOf('easy').length, 1);
});

test('forget drops the 合言葉 and the name', async () => {
  const server = fakeServer();
  const ADV = device(server);
  await ADV.net.setName('きつね');
  ADV.net.forget();
  assert.equal(ADV.net.state().key, null);
  assert.equal(ADV.net.state().name, null);
});

test('state: a broken store is as if unset (round 11)', () => {
  for (const raw of ['"str"', '[]', '0', '{{{', JSON.stringify({ key: 123, name: { a: 1 }, syncedAt: 12, vid: 5, boards: false })]) {
    const ADV = device(fakeServer(), memoryStorage({ 'tmux-da-net': raw }));
    const st = ADV.net.state();
    assert.ok(st.key == null && st.name == null && st.syncedAt == null && st.vid == null, raw);
  }
  const ADV = device(fakeServer(), memoryStorage({ 'tmux-da-net': JSON.stringify({ boards: false }) }));
  assert.equal(ADV.net.state().boards, false, 'a flag is kept');
});

// ---- key logs and the published .tmux.conf ----------------------------------
test('sync leaves the key logs at home; the ranked run carries its log', async () => {
  const server = fakeServer();
  const bodies = [];
  const inner = server.fetch;
  server.fetch = async (url, opts) => { if (opts && opts.body) bodies.push([new URL(url).pathname, JSON.parse(opts.body)]); return inner(url, opts); };
  const ADV = device(server);
  ADV.records.add({ ...run(40), klog: { keys: [[0, 'Ctrl+b'], [150, '%']], q: [0] } });
  await ADV.net.sync();
  const synced = bodies.find((b) => b[0] === '/v1/sync')[1].runs;
  assert.equal(synced.length, 1);
  assert.equal(synced[0].klog, undefined, 'no log in the history sent up');
  assert.ok(ADV.records.load().runs[0].klog, 'the log stays in the browser');
  await ADV.net.setName('ねこ');
  await ADV.net.submit(ADV.records.load().runs[0]);
  const scored = bodies.find((b) => b[0] === '/v1/scores')[1].run;
  assert.deepEqual(scored.klog.keys, [[0, 'Ctrl+b'], [150, '%']]);
});

test('ghost: the span, the next one up, a name; conf: publish and withdraw', async () => {
  const urls = [];
  const fetch = async (url, opts = {}) => {
    urls.push(url);
    const u = new URL(url);
    const j = u.pathname === '/v1/ghost' ? { ghost: { name: 'x', time: 10, splits: [], keys: null } } : u.pathname === '/v1/conf' && opts.method === 'POST' ? { shared: JSON.parse(opts.body).text !== '' } : u.pathname === '/v1/keys' ? { key: 'kaze-matsu-tsuru-001' } : { name: 'y', text: 'bind x kill-pane' };
    return { ok: true, status: 200, json: async () => j };
  };
  const ADV = load(['levels.js', 'records.js', 'net.js'], { fetch, search: '?api=http://localhost:8787' }).ADV;
  await ADV.net.ghost('easy', 'today');
  await ADV.net.ghost('easy', 'today', { above: 12.5 });
  await ADV.net.ghost('hard', 'all', { name: 'たま ご' });
  assert.equal(urls[0], 'http://localhost:8787/v1/ghost?course=easy&span=today');
  assert.equal(urls[1], 'http://localhost:8787/v1/ghost?course=easy&span=today&above=12.5');
  assert.equal(urls[2], 'http://localhost:8787/v1/ghost?course=hard&span=all&name=%E3%81%9F%E3%81%BE%20%E3%81%94');
  assert.equal((await ADV.net.conf('y')).text, 'bind x kill-pane');
  assert.equal(await ADV.net.setConf('set -g prefix C-a'), true);
  assert.equal(ADV.net.state().confShared, true);
  assert.equal(await ADV.net.setConf(''), false);
  assert.equal(ADV.net.state().confShared, false);
});
