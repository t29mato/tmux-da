// tmux からくり屋敷: the records server (Cloudflare Workers + D1).
//
// No accounts. A player is a 合言葉 such as "matsu-kaze-tsuru-482": made
// here, kept in the browser, typed into another device to bring the same
// records there. The server stores only its SHA-256.
//
//   POST /v1/keys                       → { key }            a new 合言葉
//   POST /v1/sync   { key, runs }       → { runs, name }     merge and return the history
//   POST /v1/name   { key, name }       → { name }           the name on the boards
//   POST /v1/scores { key, run }        → { rank, total }    enter a run on the boards
//   GET  /v1/board?course=&span=        → { rows }           today / week / all
//   GET  /v1/ghost?course=&span=        → { name, time, splits } the run to race
//   POST /v1/ev     { v, e, c, n }      → 204                one step of a visit (counts only)
//   GET  /v1/stats?days=                → { days }           the counts per day

import { COURSES, VER, Fail, normalizeKey, cleanRun, jstDay, checkRun } from './rules.js';

const MAX_RUNS = 900, MAX_BODY = 600 * 1024;
const LIMITS = { keys: 5, sync: 30, name: 10, scores: 20, ev: 60 };

// What a visit may report: the page opened, a course started, its first
// question solved, the course finished, a run left half way.
const EVENTS = ['visit', 'start', 'q1', 'finish', 'quit'];

const ORIGINS = ['https://t29mato.github.io', 'null', 'http://localhost', 'http://127.0.0.1'];

const WORDS = (
  'aka ame aki asa ayu fuji fuku fune gin goma hana hane hashi hata hebi hiru hoshi ido ika ine inu ishi ito iwa ' +
  'kabe kado kagi kai kame kami kani kasa kata kawa kaze kiji kiku kiri kita koi koma kome kumo kura kuri kusa ' +
  'mado maki mame mari masu matsu mayu mimi mine miso mizu mochi momo mori mugi mura nabe nami nashi neko nezumi ' +
  'niji nori numa nuno oka oni oto sake saru sasa sato seki shika shima shio shiro sora suda sugi suna taka take ' +
  'tako tama tani tara tatami tera tobi tori tsuki tsuru tsuyu uma umi ume ura usagi uta wani wara washi yama ' +
  'yane yari yoru yuki yumi zeni hotaru fusuma shoji andon kiseru koto taiko suzu haru natsu fuyu kumade sensu ' +
  'tabi geta obi kiso hagi kaki'
).split(' ');

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e instanceof Fail ? e.status : 500;
      const body = { error: e instanceof Fail ? e.message : 'server error' };
      return json(body, status, cors);
    }
  }
};

function corsHeaders(req) {
  const o = req.headers.get('Origin') || '';
  const ok = ORIGINS.some((x) => o === x || o.startsWith(x + ':'));
  return {
    'Access-Control-Allow-Origin': ok ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;
  if (req.method === 'GET' && p === '/v1/board') return board(env, url.searchParams);
  if (req.method === 'GET' && p === '/v1/ghost') return ghost(env, url.searchParams);
  if (req.method === 'GET' && p === '/v1/stats') return stats(env, url.searchParams);
  if (req.method !== 'POST') throw new Fail(404, 'not found');
  const name = { '/v1/keys': 'keys', '/v1/sync': 'sync', '/v1/name': 'name', '/v1/scores': 'scores', '/v1/ev': 'ev' }[p];
  if (!name) throw new Fail(404, 'not found');
  await limit(env, req, name);
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Fail(413, 'too large');
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch (e) { throw new Fail(400, 'bad json'); }
  }
  if (name === 'keys') return newKey(env);
  if (name === 'ev') return event(env, body);
  const hash = await player(env, body.key);
  if (name === 'sync') return sync(env, hash, body.runs);
  if (name === 'name') return setName(env, hash, body.name);
  return enter(env, hash, body.run);
}

// ---- rate limit -------------------------------------------------------------

async function limit(env, req, what) {
  const ip = (req.headers.get('CF-Connecting-IP') || 'local') + ':' + what;
  const minute = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare(
    'INSERT INTO hits (ip, minute, n) VALUES (?1, ?2, 1) ON CONFLICT (ip, minute) DO UPDATE SET n = n + 1 RETURNING n'
  ).bind(ip, minute).first();
  if (row && row.n > LIMITS[what]) throw new Fail(429, 'too many requests');
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM hits WHERE minute < ?1').bind(minute - 5).run();
}

// ---- 合言葉 -------------------------------------------------------------------

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function newKey(env) {
  const r = new Uint32Array(4);
  crypto.getRandomValues(r);
  const key = [0, 1, 2].map((i) => WORDS[r[i] % WORDS.length]).join('-') + '-' + String(r[3] % 1000).padStart(3, '0');
  await env.DB.prepare('INSERT INTO players (key_hash, created) VALUES (?1, ?2)').bind(await sha256(key), new Date().toISOString()).run();
  return json({ key });
}

async function player(env, key) {
  const k = normalizeKey(key);
  if (!k) throw new Fail(400, 'bad key');
  const hash = await sha256(k);
  const row = await env.DB.prepare('SELECT key_hash FROM players WHERE key_hash = ?1').bind(hash).first();
  if (!row) throw new Fail(404, 'unknown key');
  return hash;
}

// ---- sync ---------------------------------------------------------------------

async function sync(env, hash, runs) {
  if (!Array.isArray(runs)) throw new Fail(400, 'runs must be a list');
  const clean = runs.map(cleanRun).filter(Boolean);
  const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE key_hash = ?1').bind(hash).first();
  if ((have ? have.n : 0) + clean.length > MAX_RUNS + 400) throw new Fail(413, 'too many runs');
  const stmt = env.DB.prepare('INSERT OR IGNORE INTO runs (key_hash, id, course, at, body) VALUES (?1, ?2, ?3, ?4, ?5)');
  for (let i = 0; i < clean.length; i += 50) {
    await env.DB.batch(clean.slice(i, i + 50).map((r) => stmt.bind(hash, r.id, r.course, r.at, r.body)));
  }
  const all = await env.DB.prepare('SELECT body FROM runs WHERE key_hash = ?1 ORDER BY at').bind(hash).all();
  const me = await env.DB.prepare('SELECT name FROM players WHERE key_hash = ?1').bind(hash).first();
  return json({ runs: all.results.map((x) => JSON.parse(x.body)), name: me ? me.name : null });
}

// ---- boards -------------------------------------------------------------------

async function setName(env, hash, name) {
  const n = typeof name === 'string' ? name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (!n || [...n].length > 12 || /[\u0000-\u001f<>]/.test(n)) throw new Fail(400, 'bad name');
  const taken = await env.DB.prepare('SELECT key_hash FROM players WHERE name = ?1').bind(n).first();
  if (taken && taken.key_hash !== hash) throw new Fail(409, 'name taken');
  await env.DB.prepare('UPDATE players SET name = ?1 WHERE key_hash = ?2').bind(n, hash).run();
  return json({ name: n });
}

async function enter(env, hash, run) {
  const me = await env.DB.prepare('SELECT name FROM players WHERE key_hash = ?1').bind(hash).first();
  if (!me || !me.name) throw new Fail(400, 'set a name first');
  const c = checkRun(run);
  const now = new Date();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO scores (run_id, key_hash, course, ver, time, day, at, splits) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
  ).bind(run.id, hash, run.course, VER, c.time, jstDay(now), now.toISOString(), JSON.stringify(c.splits)).run();
  // Where it stands today among each player's best.
  const day = jstDay(now);
  const rank = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM (SELECT key_hash, MIN(time) AS t FROM scores WHERE course = ?1 AND ver = ?2 AND day = ?3 GROUP BY key_hash) WHERE t < ?4'
  ).bind(run.course, VER, day, c.time).first();
  const total = await env.DB.prepare(
    'SELECT COUNT(DISTINCT key_hash) AS n FROM scores WHERE course = ?1 AND ver = ?2 AND day = ?3'
  ).bind(run.course, VER, day).first();
  return json({ rank: rank.n + 1, total: total.n, day });
}

function spanWhere(span) {
  const now = new Date();
  if (span === 'today') return { sql: ' AND s.day = ?3', arg: jstDay(now) };
  if (span === 'week') return { sql: ' AND s.day >= ?3', arg: jstDay(new Date(now.getTime() - 6 * 86400 * 1000)) };
  if (span === 'all') return { sql: ' AND ?3 = ?3', arg: '' };
  throw new Fail(400, 'bad span');
}

// Each player's best in the span, best first.
async function bestRows(env, q, max) {
  const course = q.get('course');
  if (!COURSES[course]) throw new Fail(400, 'bad course');
  const w = spanWhere(q.get('span') || 'today');
  const res = await env.DB.prepare(
    'SELECT p.name, s.time, s.day, s.splits, s.at FROM scores s JOIN players p ON p.key_hash = s.key_hash ' +
    'WHERE s.course = ?1 AND s.ver = ?2' + w.sql + ' AND p.name IS NOT NULL ' +
    'AND s.time = (SELECT MIN(t.time) FROM scores t WHERE t.key_hash = s.key_hash AND t.course = s.course AND t.ver = s.ver' + w.sql.replace(/s\./g, 't.') + ') ' +
    'GROUP BY s.key_hash ORDER BY s.time, s.at LIMIT ' + max
  ).bind(course, VER, w.arg).all();
  return res.results;
}

async function board(env, q) {
  const rows = await bestRows(env, q, 50);
  return json({ rows: rows.map((r, i) => ({ rank: i + 1, name: r.name, time: r.time, day: r.day })) }, 200, { 'Cache-Control': 'max-age=15' });
}

async function ghost(env, q) {
  const rows = await bestRows(env, q, 1);
  if (!rows.length) return json({ ghost: null });
  const r = rows[0];
  return json({ ghost: { name: r.name, time: r.time, day: r.day, splits: JSON.parse(r.splits) } }, 200, { 'Cache-Control': 'max-age=15' });
}

// ---- counts -------------------------------------------------------------------
// A visit is a random id made in the browser, never tied to a 合言葉 or a
// name. Only the step and the course are kept, by day.

let evReady = false;
async function evTable(env) {
  if (evReady) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS events (day TEXT NOT NULL, v TEXT NOT NULL, e TEXT NOT NULL, c TEXT NOT NULL, n INTEGER NOT NULL, at TEXT NOT NULL)'
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS events_day ON events (day, e)').run();
  evReady = true;
}

async function event(env, b) {
  const v = typeof b.v === 'string' && /^v_[0-9a-f]{16}$/.test(b.v) ? b.v : null;
  if (!v || EVENTS.indexOf(b.e) < 0) throw new Fail(400, 'bad event');
  const c = b.c == null || b.c === '' ? '' : String(b.c);
  if (c && !COURSES[c] && c !== 'keiko') throw new Fail(400, 'bad course');
  const n = Number.isInteger(b.n) && b.n >= 0 && b.n < 100 ? b.n : 0;
  await evTable(env);
  const now = new Date();
  await env.DB.prepare('INSERT INTO events (day, v, e, c, n, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(jstDay(now), v, b.e, c, n, now.toISOString()).run();
  return new Response(null, { status: 204 });
}

// Per day: visitors, how many came back from an earlier day, and per course
// how many started, solved the first question, finished, and where those
// who left stopped.
async function stats(env, q) {
  const days = Math.max(1, Math.min(60, parseInt(q.get('days') || '14', 10) || 14));
  await evTable(env);
  const since = jstDay(new Date(Date.now() - (days - 1) * 86400 * 1000));
  const rows = (await env.DB.prepare(
    'SELECT day, e, c, COUNT(DISTINCT v) AS n FROM events WHERE day >= ?1 GROUP BY day, e, c'
  ).bind(since).all()).results;
  const back = (await env.DB.prepare(
    'SELECT a.day, COUNT(DISTINCT a.v) AS n FROM events a WHERE a.day >= ?1 AND a.e = \'visit\' ' +
    'AND EXISTS (SELECT 1 FROM events b WHERE b.v = a.v AND b.day < a.day) GROUP BY a.day'
  ).bind(since).all()).results;
  const quits = (await env.DB.prepare(
    'SELECT c, n, COUNT(*) AS k FROM events WHERE day >= ?1 AND e = \'quit\' GROUP BY c, n'
  ).bind(since).all()).results;
  const out = {};
  for (const r of rows) {
    const d = out[r.day] || (out[r.day] = { visitors: 0, back: 0, courses: {} });
    if (r.e === 'visit') { d.visitors += r.n; continue; }
    const c = d.courses[r.c] || (d.courses[r.c] = { start: 0, q1: 0, finish: 0, quit: 0 });
    c[r.e] = r.n;
  }
  for (const r of back) if (out[r.day]) out[r.day].back = r.n;
  return json({ since, days: out, quitAt: quits }, 200, { 'Cache-Control': 'max-age=60' });
}
