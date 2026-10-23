// tmux からくり屋敷: the server's rules, apart from the Worker so the unit
// tests can import them (a Worker module may export only its handler).

// Each course's questions, as levels.js lists them (a unit test keeps the
// two in step; a change there bumps the course's ver and VER here).
export const QUESTIONS = {
  easy: ['split_lr', 'focus', 'zoom', 'split_tb', 'close', 'unzoom', 'focus', 'new_window', 'select_window', 'split_lr', 'close', 'focus', 'zoom', 'select_window', 'split_tb'],
  normal: ['focus', 'resize', 'swap', 'rename', 'close', 'kill_window', 'copy_top', 'split_tb', 'swap', 'select_window', 'zoom', 'new_window', 'detach_attach', 'last_window', 'break_pane', 'unzoom', 'close', 'split_lr', 'rename', 'copy_page'],
  hard: ['find_zoom', 'trident', 'two_akima', 'new_and_home', 'swap_zoom', 'split_lr', 'yank_paste', 'copy_top', 'session_new', 'trident', 'kill_window', 'session_switch', 'session_attach', 'focus', 'resize', 'copy_search']
};
export const COURSES = Object.fromEntries(Object.entries(QUESTIONS).map(([id, qs]) => [id, qs.length]));
export const VER = 2;
// Practice runs (稽古の間) are synced between devices but never ranked.
export const PRACTICE = ['keiko'];
// A person needs at least two keys per question. One question can be very
// quick (the prefix pressed while the last one was still being sealed), so
// the floor is on the average; each question only has to take some time.
export const MIN_AVG = 0.4;
export const MIN_Q = 0.1;
// The clock stops while the tab is away; a run that stood still longer than
// this (seconds, in all) is kept in the player's history but not ranked.
export const PAUSE_MAX = 3;
// A name on the boards: up to this many characters (code points).
export const NAME_MAX = 12;

export class Fail extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Typed on a phone or read aloud: lower case, single spaces or dashes.
export function normalizeKey(key) {
  if (typeof key !== 'string') return null;
  const k = key.trim().toLowerCase().replace(/[\s_ー－‐]+/g, '-').replace(/-+/g, '-');
  return /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/.test(k) ? k : null;
}

// The name as it goes on the boards, or null. Invisible characters (zero
// width, direction marks) are dropped so a blank or a look-alike of another
// name cannot be made; control and private-use characters, piled-up accents
// (Zalgo) and a name with nothing readable in it are refused.
export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.normalize('NFC').replace(/\p{Cf}/gu, '').trim().replace(/\s+/g, ' ');
  if (!n || [...n].length > NAME_MAX) return null;
  if (/[<>]|\p{C}|\p{M}{3}/u.test(n) || !/[\p{L}\p{N}\p{S}]/u.test(n)) return null;
  return n;
}

export function cleanRun(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || r.id.length > 40) return null;
  if (!COURSES[r.course] && !PRACTICE.includes(r.course)) return null;
  if (typeof r.time !== 'number' || !(r.time > 0) || r.time > 36000) return null;
  if (typeof r.at !== 'string' || r.at.length > 40 || isNaN(Date.parse(r.at))) return null;
  // The key log is for the boards (keylogs), not the history: it would make
  // the history many times its size.
  if (r.klog !== undefined) { r = { ...r }; delete r.klog; }
  const body = JSON.stringify(r);
  return body.length > 8000 ? null : { id: r.id, course: r.course, at: r.at, body };
}

export function jstDay(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---- today's order ----------------------------------------------------------
// The same shuffle as app.js (rng, shuffle, pairZoom), from the day in Japan
// and the course: everyone on a board solved the same questions in the same
// order, and a crafted run has to claim that order too.

function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle(a, rand) {
  for (let tries = 0; tries < 50; tries++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    if (a.every((x, n) => n === 0 || (a[n - 1] !== x && !(a[n - 1] === 'new_window' && x === 'zoom')))) break;
  }
  return a;
}

function pairZoom(list) {
  let outs = list.filter((t) => t === 'unzoom').length;
  if (!outs) return list;
  const zooms = list.filter((t) => t === 'zoom').length;
  let spare = Math.max(0, outs - zooms);
  const out = [];
  list.forEach((t) => {
    if (t === 'unzoom') { if (spare) { spare--; out.push(t); } return; }
    out.push(t);
    if (t === 'zoom' && outs > spare) { outs--; out.push('unzoom'); }
  });
  return out;
}

export function dailyOrder(course, day) {
  return pairZoom(shuffle(QUESTIONS[course].slice(), rng(day + ':' + course)));
}

// The days whose order a run finished at `now` may have: the day in Japan,
// the day before (a run started before midnight) and the day after (a clock
// that runs ahead).
export function orderDays(now) {
  return [-1, 0, 1].map((d) => jstDay(new Date(now.getTime() + d * 86400 * 1000)));
}

// The run must add up: one entry per question, in today's order, each
// humanly possible, and the total equal to the questions plus the +2 秒 per
// wrong command. A run in a changed order (順番を変えて) or paused for long is
// not today's race.
export function checkRun(run, now = new Date()) {
  if (!run || typeof run !== 'object') throw new Fail(400, 'no run');
  const n = COURSES[run.course];
  if (!n) throw new Fail(400, 'bad course');
  if (run.ver !== VER) throw new Fail(400, 'old rules');
  if (typeof run.id !== 'string' || run.id.length > 40) throw new Fail(400, 'bad id');
  if (run.shuffled) throw new Fail(400, 'not today\'s order');
  if (typeof run.paused === 'number' && run.paused > PAUSE_MAX) throw new Fail(400, 'paused');
  if (!Array.isArray(run.qs) || run.qs.length !== n) throw new Fail(400, 'bad questions');
  const types = run.qs.map((q) => q && q.t).join(',');
  if (!orderDays(now).some((day) => dailyOrder(run.course, day).join(',') === types)) throw new Fail(400, 'not today\'s order');
  const splits = run.qs.map((q) => {
    const s = q.s, m = q.m;
    if (typeof s !== 'number' || !(s >= MIN_Q) || s > 3600) throw new Fail(400, 'bad split');
    if (!Number.isInteger(m) || m < 0 || m > 999) throw new Fail(400, 'bad misses');
    return +(s + 2 * m).toFixed(2);
  });
  const sum = splits.reduce((a, b) => a + b, 0);
  if (!(run.qs.reduce((a, q) => a + q.s, 0) >= MIN_AVG * n)) throw new Fail(400, 'too fast');
  if (typeof run.time !== 'number' || Math.abs(sum - run.time) > 0.05 * n + 0.2) throw new Fail(400, 'time does not add up');
  return { n, splits, time: +run.time.toFixed(2), own: run.conf ? 1 : 0 };
}

// ---- the key log ------------------------------------------------------------
// A run may carry what was pressed: `klog: { keys: [[ms, label], ...], q:
// [ms, ...], cut? }`, ms from the run's start (the clock, without penalties),
// `q` the start of each question. It must agree with the run and look typed
// by a hand: a script's keys come at once or on a fixed beat. A run with no
// log (an older client) is taken as before.
export const LOG_MAX = 1500;
export const LOG_LABEL_MAX = 24;
// Two keys closer than this (ms) are not two presses of a hand.
export const LOG_MIN_GAP = 15;
// Checked against the log only when it holds at least this many keys.
const LOG_FEW = 8;

function logFail(why) { throw new Fail(400, 'key log: ' + why); }

export function checkLog(run) {
  const g = run.klog;
  if (g == null) return null;
  const n = run.qs.length;
  if (typeof g !== 'object' || !Array.isArray(g.keys) || !Array.isArray(g.q)) logFail('bad shape');
  if (g.keys.length > LOG_MAX || g.q.length !== n) logFail('bad length');
  let prev = 0;
  for (const e of g.keys) {
    if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < prev || typeof e[1] !== 'string' || !e[1] || e[1].length > LOG_LABEL_MAX) logFail('bad entry');
    prev = e[0];
  }
  prev = 0;
  for (const t of g.q) { if (!Number.isInteger(t) || t < prev) logFail('bad boundary'); prev = t; }
  const cut = !!g.cut;
  if (g.keys.length < n) logFail('too few keys');
  if (!cut && Number.isInteger(run.keys) && run.keys !== g.keys.length) logFail('key count');
  // The last key solved the last question: it comes at the clock's end.
  const raw = run.qs.reduce((a, q) => a + q.s, 0);
  const last = g.keys[g.keys.length - 1][0] / 1000;
  if (!cut && Math.abs(last - raw) > 0.5 + 0.02 * n) logFail('last key time');
  // Each question's start is the one before plus its seconds.
  for (let i = 1; i < n; i++) {
    if (Math.abs((g.q[i] - g.q[i - 1]) / 1000 - run.qs[i - 1].s) > 0.4) logFail('question boundaries');
  }
  const gaps = [];
  for (let i = 1; i < g.keys.length; i++) gaps.push(g.keys[i][0] - g.keys[i - 1][0]);
  if (gaps.length >= LOG_FEW) {
    const fast = gaps.filter((d) => d < LOG_MIN_GAP).length;
    if (fast / gaps.length > 0.3) logFail('intervals too short');
    const lo = Math.min(...gaps), hi = Math.max(...gaps);
    if (hi - lo < 5) logFail('intervals identical');
  }
  return { keys: g.keys, q: g.q, cut };
}
