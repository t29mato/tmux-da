// tmux からくり屋敷: the server's rules, apart from the Worker so the unit
// tests can import them (a Worker module may export only its handler).

export const COURSES = { easy: 15, normal: 20, hard: 16 };
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

export class Fail extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Typed on a phone or read aloud: lower case, single spaces or dashes.
export function normalizeKey(key) {
  if (typeof key !== 'string') return null;
  const k = key.trim().toLowerCase().replace(/[\s_ー－‐]+/g, '-').replace(/-+/g, '-');
  return /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/.test(k) ? k : null;
}

export function cleanRun(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || r.id.length > 40) return null;
  if (!COURSES[r.course] && !PRACTICE.includes(r.course)) return null;
  if (typeof r.time !== 'number' || !(r.time > 0) || r.time > 36000) return null;
  if (typeof r.at !== 'string' || r.at.length > 40 || isNaN(Date.parse(r.at))) return null;
  const body = JSON.stringify(r);
  return body.length > 8000 ? null : { id: r.id, course: r.course, at: r.at, body };
}

export function jstDay(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// The run must add up: one entry per question, each humanly possible, and
// the total equal to the questions plus the +2 秒 per wrong command. A run
// in a changed order (順番を変えて) or paused for long is not today's race.
export function checkRun(run) {
  if (!run || typeof run !== 'object') throw new Fail(400, 'no run');
  const n = COURSES[run.course];
  if (!n) throw new Fail(400, 'bad course');
  if (run.ver !== VER) throw new Fail(400, 'old rules');
  if (typeof run.id !== 'string' || run.id.length > 40) throw new Fail(400, 'bad id');
  if (run.shuffled) throw new Fail(400, 'not today\'s order');
  if (typeof run.paused === 'number' && run.paused > PAUSE_MAX) throw new Fail(400, 'paused');
  if (!Array.isArray(run.qs) || run.qs.length !== n) throw new Fail(400, 'bad questions');
  const splits = run.qs.map((q) => {
    const s = q && q.s, m = q && q.m;
    if (typeof s !== 'number' || !(s >= MIN_Q) || s > 3600) throw new Fail(400, 'bad split');
    if (!Number.isInteger(m) || m < 0 || m > 999) throw new Fail(400, 'bad misses');
    return +(s + 2 * m).toFixed(2);
  });
  const sum = splits.reduce((a, b) => a + b, 0);
  if (!(run.qs.reduce((a, q) => a + q.s, 0) >= MIN_AVG * n)) throw new Fail(400, 'too fast');
  if (typeof run.time !== 'number' || Math.abs(sum - run.time) > 0.05 * n + 0.2) throw new Fail(400, 'time does not add up');
  return { n, splits, time: +run.time.toFixed(2) };
}

