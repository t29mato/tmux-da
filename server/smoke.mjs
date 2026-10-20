// Smoke test of a running server (wrangler dev, or the deployed one): API=https://... node server/smoke.mjs
const API = process.env.API || 'http://localhost:8787';
let failed = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed++; };
const post = async (p, body) => {
  const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://t29mato.github.io' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cors: r.headers.get('Access-Control-Allow-Origin') };
};
const get = async (p) => { const r = await fetch(API + p); return { status: r.status, body: await r.json() }; };

const tag = Date.now().toString(36);
const run = (id, course, splits, misses = 0) => ({
  id, course, ver: 2, at: new Date().toISOString(),
  time: +(splits.reduce((a, b) => a + b, 0) + 2 * misses).toFixed(2), misses,
  qs: splits.map((s, i) => ({ t: 'split_lr', s, m: i === 0 ? misses : 0 }))
});

const a = await post('/v1/keys', {});
ok(a.status === 200 && /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/.test(a.body.key), 'a new 合言葉: ' + a.body.key);
ok(a.cors === 'https://t29mato.github.io', 'CORS allows the site');
const key = a.body.key;

// Sync from two devices: each sends its own runs, both get the union.
const r1 = run('r_' + tag + 'a', 'normal', Array(20).fill(1.5));
const r2 = run('r_' + tag + 'b', 'normal', Array(20).fill(1.2));
let s = await post('/v1/sync', { key, runs: [r1] });
ok(s.status === 200 && s.body.runs.length === 1, 'device A syncs one run');
s = await post('/v1/sync', { key: key.toUpperCase().replace(/-/g, ' '), runs: [r2, r1] });
ok(s.status === 200 && s.body.runs.length === 2, 'device B (key typed in caps with spaces) gets both runs');
ok((await post('/v1/sync', { key: 'nope-nope-nope-000', runs: [] })).status === 404, 'an unknown key is refused');
ok((await post('/v1/sync', { key: 'garbage', runs: [] })).status === 400, 'a malformed key is refused');

// Boards need a name; names are unique.
ok((await post('/v1/scores', { key, run: r2 })).status === 400, 'no name, no board');
const name = 'たまご' + tag.slice(-4);
ok((await post('/v1/name', { key, name })).body.name === name, 'the name is set');
const b = await post('/v1/keys', {});
ok((await post('/v1/name', { key: b.body.key, name })).status === 409, 'another key cannot take the name');
ok((await post('/v1/name', { key: b.body.key, name: 'x'.repeat(13) })).status === 400, 'a name longer than 12 is refused');

// Entering runs.
let e = await post('/v1/scores', { key, run: r2 });
ok(e.status === 200 && e.body.rank >= 1, 'a run enters the board, rank ' + e.body.rank + '/' + e.body.total);
ok((await post('/v1/scores', { key, run: run('r_' + tag + 'c', 'normal', Array(20).fill(0.1)) })).status === 400, 'an inhuman run is refused');
const bad = run('r_' + tag + 'd', 'normal', Array(20).fill(1)); bad.time = 5;
ok((await post('/v1/scores', { key, run: bad })).status === 400, 'a time that does not add up is refused');
ok((await post('/v1/scores', { key, run: run('r_' + tag + 'e', 'normal', Array(19).fill(1)) })).status === 400, 'a run with a question missing is refused');
const withMiss = run('r_' + tag + 'f', 'normal', Array(20).fill(1.4), 2);
ok((await post('/v1/scores', { key, run: withMiss })).status === 200, 'misses add +2 秒 each and still add up');

await post('/v1/name', { key: b.body.key, name: 'ほか' + tag.slice(-4) });
await post('/v1/scores', { key: b.body.key, run: run('r_' + tag + 'g', 'normal', Array(20).fill(1.0)) });

const board = await get('/v1/board?course=normal&span=today');
const mine = board.body.rows.filter((r) => r.name === name);
ok(mine.length === 1 && mine[0].time === r2.time, 'the board shows one row per player, their best (' + (mine[0] && mine[0].time) + ')');
const other = board.body.rows.find((r) => r.name === 'ほか' + tag.slice(-4));
ok(other && mine[0] && other.rank < mine[0].rank, 'a faster player ranks higher');
for (const span of ['week', 'all']) ok((await get('/v1/board?course=normal&span=' + span)).status === 200, 'the ' + span + ' board answers');
ok((await get('/v1/board?course=nope&span=today')).status === 400, 'an unknown course is refused');
const g = await get('/v1/ghost?course=normal&span=today');
ok(g.body.ghost && g.body.ghost.splits.length === 20, 'the ghost has a split per question (' + g.body.ghost.name + ' ' + g.body.ghost.time + ')');

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
