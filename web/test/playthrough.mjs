// Plays tmux からくり屋敷 with real keyboard events: all three courses with
// both prefixes and on a phone, every question type solved once by an
// independent solver and once by following the in-game guide (指南), the
// no-skip rule past the 目安, line editing, the records (絵巻) and the
// sound. With SHOTS_DIR set it also writes screenshots.
//
//   cd <a directory where `npm i playwright` was run>
//   node /path/to/tmux-da/web/test/playthrough.mjs
//   SHOTS_DIR=/tmp/shots node /path/to/tmux-da/web/test/playthrough.mjs
//
// Playwright is resolved from the current directory first, so it never has
// to live inside the project.

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(HERE, '..', 'index.html');
const SHOTS = process.env.SHOTS_DIR || '';

function loadPlaywright() {
  const candidates = [path.join(process.cwd(), 'noop.js'), process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'noop.js') : null, import.meta.url].filter(Boolean);
  for (const c of candidates) {
    try { return createRequire(c)('playwright'); } catch (e) { /* next */ }
  }
  throw new Error('playwright not found: run `npm i playwright` in some directory and run this script from there');
}

const { chromium } = loadPlaywright();

let failures = 0;
function ok(cond, what) {
  if (cond) console.log('ok   ' + what);
  else { console.log('FAIL ' + what); failures++; }
}

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

async function st(page) { return page.evaluate(() => window.tmuxDa.state()); }

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network request: ' + r.url()); });
  return errors;
}

// Move the focus to the pane that holds `scene`, with the arrow keys.
async function goTo(page, scene, prefix) {
  for (let i = 0; i < 16; i++) {
    const d = await page.evaluate((scene) => {
      const a = document.querySelector('.pane.active');
      const t = document.querySelector('.pane[data-scene="' + scene + '"]');
      if (!a || !t) return null;
      if (a === t) return 'done';
      const ar = a.getBoundingClientRect(), tr = t.getBoundingClientRect();
      const dx = (tr.left + tr.width / 2) - (ar.left + ar.width / 2);
      const dy = (tr.top + tr.height / 2) - (ar.top + ar.height / 2);
      const overlapX = tr.left < ar.right && ar.left < tr.right;
      const overlapY = tr.top < ar.bottom && ar.top < tr.bottom;
      if (overlapX && !overlapY) return dy < 0 ? 'U' : 'D';
      if (overlapY && !overlapX) return dx < 0 ? 'L' : 'R';
      return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D');
    }, scene);
    if (d === 'done') return true;
    if (!d) return false;
    await page.keyboard.press(prefix);
    await page.keyboard.press({ L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' }[d]);
  }
  return false;
}

async function sceneAtLeft(page, scene) {
  return page.evaluate((scene) => {
    const t = document.querySelector('.pane[data-scene="' + scene + '"]');
    return !!t && parseFloat(t.style.left) === 0;
  }, scene);
}

async function windowIndex(page, name) {
  const s = await st(page);
  const w = s.windows.find((w) => w.name === name);
  return w ? String(w.index) : null;
}

// Resize the active pane by a few cells, either way that works.
async function resizeSome(page, prefix, prefixOpt) {
  const before = await page.evaluate(() => document.querySelector('.pane.active').getBoundingClientRect().width);
  const changed = () => page.evaluate((b) => Math.abs(document.querySelector('.pane.active').getBoundingClientRect().width - b) > 40, before);
  for (const dir of ['Right', 'Left']) {
    await page.keyboard.press(prefix);
    const mod = prefixOpt === 'C-a' ? 'Alt' : 'Control';
    for (let i = 0; i < (mod === 'Alt' ? 2 : 8); i++) await page.keyboard.press(mod + '+Arrow' + dir);
    if (await changed()) return;
  }
}

// Solves the question on screen with its own idea of the keys, without
// looking at the guide.
async function solve(page, prefix, prefixOpt) {
  const s = await st(page);
  const type = s.run.type;
  const p = async (k) => { await page.keyboard.press(prefix); await page.keyboard.press(k); };
  switch (type) {
    case 'split_lr': await p('%'); break;
    case 'split_tb': await p('"'); break;
    case 'focus': await goTo(page, 'kakejiku', prefix); break;
    case 'zoom': case 'unzoom': await p('z'); break;
    case 'close':
      await goTo(page, 'akima', prefix);
      await p('x'); await page.keyboard.press('y');
      break;
    case 'new_window': await p('c'); break;
    case 'select_window': await p(await windowIndex(page, s.run.goal)); break;
    case 'resize': await resizeSome(page, prefix, prefixOpt); break;
    case 'swap':
    case 'swap_zoom':
      for (let i = 0; i < 4 && !(await sceneAtLeft(page, 'kakejiku')); i++) await p('{');
      if (type === 'swap_zoom') await p('z');
      break;
    case 'rename':
      await p(','); await page.keyboard.press('Control+u'); await page.keyboard.type('camp'); await page.keyboard.press('Enter');
      break;
    case 'kill_window':
      if (s.activeWindow !== '蔵') await p(await windowIndex(page, '蔵'));
      await p('&'); await page.keyboard.press('y');
      break;
    case 'copy_top': await p('['); await page.keyboard.press('g'); break;
    case 'find_zoom': await goTo(page, 'kakejiku', prefix); await p('z'); break;
    case 'trident': await p('%'); await p('"'); break;
    case 'two_akima':
      for (let i = 0; i < 2; i++) {
        await goTo(page, 'akima', prefix);
        await p('x'); await page.keyboard.press('y');
      }
      break;
    case 'new_and_home': await p('c'); await p(await windowIndex(page, '母屋')); break;
    default: throw new Error('no solver for ' + type);
  }
}

// One move of the in-game guide, pressed as written.
const ARROW = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
async function followGuide(page, prefix) {
  const mv = (await st(page)).run.next;
  if (!mv) return false;
  if (mv.pfx) await page.keyboard.press(prefix);
  if (!mv.keys.length) {
    // The rename prompt: written as words.
    await page.keyboard.press('Control+u'); await page.keyboard.type('camp'); await page.keyboard.press('Enter');
    return true;
  }
  const label = mv.keys[0];
  let m;
  if (label === '0-9') await page.keyboard.press(/(\d+) 番/.exec(mv.text)[1]);
  else if ((m = /^(Ctrl|Option)\+(.)$/.exec(label))) {
    const key = (m[1] === 'Ctrl' ? 'Control+' : 'Alt+') + ARROW[m[2]];
    for (let i = 0; i < (m[1] === 'Ctrl' ? 6 : 1); i++) await page.keyboard.press(key);
  } else await page.keyboard.press(ARROW[label] || label);
  return true;
}

async function waitPlay(page) {
  await page.waitForFunction(() => { const r = window.tmuxDa.state().run; return r && r.phase === 'play'; }, null, { timeout: 5000 });
}

// Plays a whole course; `how` is 'solve' or 'guide'. Returns the types seen.
async function playCourse(page, prefix, prefixOpt, label, how) {
  await waitPlay(page);
  const seen = new Set();
  for (let guard = 0; guard < 40; guard++) {
    const s = await st(page);
    if (!s.run || s.run.phase !== 'play') break;
    const i = s.run.i;
    seen.add(s.run.type);
    if (how === 'guide') {
      for (let step = 0; step < 12; step++) {
        const now = await st(page);
        if (!now.run || now.run.i !== i) break;
        await followGuide(page, prefix);
      }
    } else await solve(page, prefix, prefixOpt);
    try {
      await page.waitForFunction((i) => { const r = window.tmuxDa.state().run; return !r || r.i !== i; }, i, { timeout: 3000 });
    } catch (e) {
      ok(false, label + ' question ' + (i + 1) + ' (' + s.run.type + ') was not solved by ' + how);
      return seen;
    }
  }
  return seen;
}

async function waitResult(page, label) {
  try {
    await page.waitForFunction(() => document.body.dataset.screen === 'result', null, { timeout: 4000 });
    ok(true, label + ' the course ends on the 絵巻 result');
    return true;
  } catch (e) {
    ok(false, label + ' no result screen');
    return false;
  }
}

async function course(browser, prefixOpt, id, viewport, scheme, tag) {
  const prefix = prefixOpt === 'C-a' ? 'Control+a' : 'Control+b';
  const label = `[${id} ${prefixOpt} ${viewport.width}px ${scheme}]`;
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  ok((await st(page)).prefix === 'C-b', label + ' the prefix is the default Ctrl+b');
  ok(!(await page.$('#title-screen [data-prefix]')), label + ' there is no prefix chooser');
  await shot(page, `title-${tag}`);
  await page.click(`#course-list [data-course="${id}"]`);
  await waitPlay(page);
  if (viewport.width < 500) {
    ok(await page.$eval('#keybar', (e) => getComputedStyle(e).display) !== 'none', label + ' the key bar shows on a phone');
  }
  if (id === 'easy') {
    // An unbound key: a miss that leaves the board as it was.
    await page.keyboard.press(prefix);
    await page.keyboard.press('Y');
    ok((await st(page)).run.misses === 1, label + ' a wrong command counts as 仕掛け違い');
  }
  await shot(page, `play-${tag}`);
  await playCourse(page, prefix, prefixOpt, label, 'solve');
  await waitResult(page, label);
  const s = await st(page);
  ok(s.result && s.result.time > 0 && s.result.record, label + ' the result has a time (' + (s.result ? s.result.time.toFixed(1) : '-') + 's) and is a new record');
  ok(/奥の間に辿り着いた/.test(await page.$eval('#result-body', (e) => e.textContent)), label + ' the result says the inner room was reached');
  ok(/当主の刻/.test(await page.$eval('#result-body .em-verdict', (e) => e.textContent)), label + ' the result compares with 当主の刻');
  if (id === 'easy') ok(s.result.misses >= 1, label + ' the miss is in the result');
  await shot(page, `result-${tag}`);
  await page.reload();
  const best = await page.$eval(`#course-list [data-course="${id}"] .wing-best`, (e) => e.textContent);
  ok(/\d+\.\d秒/.test(best), label + ' the best time survives a reload (' + best + ')');
  if (viewport.width < 500) {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= viewport.width, label + ' no horizontal page scroll (' + sw + 'px)');
  }
  ok(errors.length === 0, label + ' no page errors and no network requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Following the guide alone solves every question type.
async function guided(browser) {
  const L = '[guide]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  const all = new Set();
  for (const id of ['normal', 'hard']) {
    await page.click(`#course-list [data-course="${id}"]`);
    const seen = await playCourse(page, 'Control+b', 'C-b', L + ' ' + id, 'guide');
    seen.forEach((t) => all.add(t));
    await waitResult(page, L + ' ' + id);
    const r = (await st(page)).result;
    ok(r.misses === 0, L + ' ' + id + ' the guide never leads to a wrong key (' + r.misses + ' misses)');
    await page.click('#result-body [data-title]');
  }
  const types = await page.evaluate(() => [...new Set(ADV.levels.COURSES.flatMap((c) => c.qs))]);
  ok(types.every((t) => all.has(t)), L + ' every question type was solved from the guide (' + all.size + '/' + types.length + ')');
  ok(errors.length === 0, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Past the 目安 nothing is skipped: the keys light up, then the 指南.
async function noSkip(browser) {
  const L = '[目安]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.clock.install();
  await page.goto(PAGE);
  await page.click('#course-list [data-course="easy"]');
  await page.clock.runFor(3000);
  await waitPlay(page);
  const first = await st(page);
  ok(first.run.stage === 0 && !(await page.$('#sashizu kbd.next')), L + ' within the 目安 no key is lit');
  await page.clock.runFor(12500);
  let s = await st(page);
  ok(s.run.i === 0 && s.run.stage === 1, L + ' past 12 秒 the question is still there and the 行灯 is lit');
  ok(await page.$$eval('#sashizu kbd.next', (e) => e.length) >= 1, L + ' the keys to press light up');
  ok(/超過 \+\d/.test(await page.$eval('#sashizu .andon-over', (e) => e.textContent)), L + ' the overrun counts up');
  ok(!(await page.$('#sashizu .shinan')), L + ' no 指南 yet');
  await shot(page, 'andon');
  await page.clock.runFor(6500);
  s = await st(page);
  ok(s.run.i === 0 && s.run.stage === 2, L + ' at 1.5 times the 目安 the question is still there');
  ok(await page.$$eval('#sashizu .shinan li', (e) => e.length) >= 1, L + ' the 指南 lists the steps');
  ok(/合図|押す/.test(await page.$eval('#sashizu .shinan', (e) => e.textContent)), L + ' the 指南 says which key');
  await shot(page, 'shinan');
  await page.clock.runFor(60000);
  ok((await st(page)).run.i === 0, L + ' a minute later it is still the same question');
  // Prefix pressed: the first step is ticked off.
  if (s.run.next && s.run.next.pfx) {
    await page.keyboard.press('Control+b');
    await page.clock.runFor(200);
    ok(await page.$$eval('#sashizu .shinan li.done', (e) => e.length) === 1, L + ' pressing the prefix ticks off the first step');
    await page.keyboard.press('Escape');
  }
  // Solve the rest quickly from the guide, letting the clock run.
  await page.clock.resume();
  for (let guard = 0; guard < 60; guard++) {
    const now = await st(page);
    if (!now.run) break;
    await followGuide(page, 'Control+b');
    await page.waitForTimeout(30);
  }
  await waitResult(page, L);
  const r = (await st(page)).result;
  ok(r.overs >= 1 && r.guides >= 1, L + ' the result counts 灯り and 指南 (' + r.overs + ', ' + r.guides + ')');
  ok(/灯り/.test(await page.$eval('#result-body', (e) => e.textContent)), L + ' the 絵巻 names the slow question');
  const db = await page.evaluate(() => window.tmuxDa.records());
  const q = db.runs[db.runs.length - 1].qs[0];
  ok(q.o === 1 && q.g === 1 && q.s > 18, L + ' the first question is stored with its overrun (' + q.s + 's)');
  ok(errors.length === 0, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Emacs line editing in the shell and in prompts; send-prefix; copy keys.
async function lineEditing(browser) {
  const L = '[emacs]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  // Keep to one question: give it a single-key question we will not solve.
  const k = (key) => page.keyboard.press(key);
  const input = async () => (await st(page)).input;
  await page.keyboard.type('world');
  await k('Control+a'); await page.keyboard.type('hello ');
  await k('Control+e');
  ok(await input() === 'hello world', L + ' C-a inserts at the start, C-e goes to the end');
  await k('Control+w');
  ok(await input() === 'hello ', L + ' C-w kills the word before the cursor');
  await k('Control+y');
  ok(await input() === 'hello world', L + ' C-y yanks it back');
  await k('Alt+b'); await page.keyboard.type('big ');
  ok(await input() === 'hello big world', L + ' M-b moves back a word');
  await k('Control+e');
  await k('Control+b'); await k('Control+b');
  ok((await st(page)).cursor === 'hello big world'.length - 1 && !(await st(page)).armed, L + ' prefix twice sends C-b to the shell');
  await k('Control+a'); await k('Control+k');
  ok(await input() === '', L + ' C-k kills to the end');
  await k('Control+y'); await k('Enter');
  await k('ArrowUp');
  ok(await input() === 'hello big world', L + ' ↑ recalls the last command');
  await k('Control+u');
  await k('Control+b'); await k(',');
  await k('Control+a'); await page.keyboard.type('x');
  ok(/^x/.test((await st(page)).promptValue || ''), L + ' the rename prompt edits like the shell');
  await k('Escape');
  await page.keyboard.type('echo secret-42'); await k('Enter');
  await k('Control+b'); await k('[');
  await k('v');
  ok(/矩形/.test(await page.$eval('#status', (e) => e.textContent)), L + ' v in tmux copy mode explains rectangle-toggle');
  await k('Control+p'); await k('Control+p');
  await k('Control+Space'); await k('Alt+w');
  const s = await st(page);
  ok(!s.copyMode && s.clipboard.length > 0, L + ' C-Space then M-w copies (' + JSON.stringify(s.clipboard) + ')');
  // Leaving mid-run goes back to the title and keeps nothing.
  await page.click('#game-screen .quit');
  ok((await st(page)).screen === 'title' && (await page.evaluate(() => window.tmuxDa.records().runs.length)) === 0, L + ' 屋敷を出る returns to the title without a record');
  await ctx.close();
}

// The run history: growth on the result, the 絵巻, migration from older
// saves, the cap, and the weakness panel.
async function records(browser) {
  const L = '[records]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  page.on('dialog', (d) => d.accept());
  await page.goto(PAGE);
  const names = await page.$$eval('.wing-name', (els) => els.map((e) => e.firstChild.textContent));
  ok(names.join('|') === '三間屋敷|八間屋敷|百間屋敷', L + ' the three houses are named (' + names.join('|') + ')');
  const modes = await page.$$eval('.wing-mode', (els) => els.map((e) => e.textContent));
  ok(modes.join('|') === '手ならし|おすすめ|真剣勝負', L + ' the three modes are named (' + modes.join('|') + ')');
  ok(await page.$$eval('.wing-mode.rec', (els) => els.length === 1 && !!els[0].closest('[data-course="normal"]')), L + ' only 八間屋敷 is recommended');
  ok(/当主の刻 36 秒/.test(await page.$eval('[data-course="easy"] .wing-best', (e) => e.textContent)), L + ' a house with no runs shows 当主の刻');
  ok(/八間屋敷/.test(await page.$eval('#btn-enter', (e) => e.textContent)), L + ' 屋敷に入る starts with 八間屋敷 the first time');

  // Run 1, with one deliberate miss.
  await page.click('[data-course="easy"]');
  await waitPlay(page);
  await page.keyboard.press('Control+b'); await page.keyboard.press('Y');
  await playCourse(page, 'Control+b', 'C-b', L, 'solve');
  await waitResult(page, L);
  let r = (await st(page)).result;
  ok(r.count === 1 && r.prev === null && r.record === true, L + ' first run: count 1, no previous, a record');
  ok(/出発点/.test(await page.$eval('#result-body', (e) => e.textContent)), L + ' first run says it is the starting point');
  let db = await page.evaluate(() => window.tmuxDa.records());
  const run = db.runs[0];
  ok(db.schema === 3 && db.runs.length === 1 && run.id && run.at && run.rank && run.course === 'easy' && run.ver === 2, L + ' the run is stored with id, time, rank and ver 2');
  ok(run.qs.length === 15 && run.qs.every((q) => typeof q.s === 'number' && q.s >= 0), L + ' every question has its seconds');
  ok(run.qs.some((q) => q.m >= 1), L + ' the deliberate miss is on its question');

  // Run 2, from the result.
  await page.click('#result-body [data-course="easy"]');
  await playCourse(page, 'Control+b', 'C-b', L, 'solve');
  await waitResult(page, L);
  r = (await st(page)).result;
  ok(r.count === 2 && typeof r.prev === 'number' && Math.abs(r.delta - (r.time - r.prev)) < 0.05, L + ' second run compares with the first (' + (r.delta || 0).toFixed(1) + 's)');
  ok(/前回より|自己ベスト更新/.test(await page.$eval('#result-body', (e) => e.textContent)), L + ' the 絵巻 says how it went against last time');
  ok(await page.$$eval('#result-body .spark i', (e) => e.length) === 2, L + ' the result shows a two-bar trend');
  await shot(page, 'result2');

  // The 絵巻 from the result.
  await page.click('#result-body [data-records]');
  ok((await st(page)).screen === 'records' && (await st(page)).recCourse === 'easy', L + ' 絵巻を開く opens the easy history');
  ok(await page.$$eval('#rec-chart .bar', (e) => e.length) === 2, L + ' the chart has a bar per run');
  ok(await page.$$eval('#rec-chart .bar.rec', (e) => e.length) >= 1, L + ' record runs are marked on the chart');
  ok(await page.$$eval('.rec-table tbody tr', (e) => e.length) === 2, L + ' the table lists both runs');
  ok(await page.$$eval('.weak-list li', (e) => e.length) >= 1, L + ' two runs are enough for the weakness panel');
  await shot(page, 'records-desktop');
  await page.click('[data-rec-course="hard"]');
  ok(/白紙/.test(await page.$eval('#records-body', (e) => e.textContent)), L + ' a house with no runs says so');
  await page.click('#btn-records-back');
  ok((await st(page)).screen === 'result', L + ' 戻る goes back to the result');

  // After a reload, from the title.
  await page.reload();
  ok((await page.evaluate(() => window.tmuxDa.records())).runs.length === 2, L + ' runs survive a reload');
  ok(/通算 2 回/.test(await page.$eval('#btn-records', (b) => b.textContent)), L + ' the title offers the 絵巻 with the count');
  ok(/三間屋敷/.test(await page.$eval('#btn-enter', (e) => e.textContent)), L + ' 屋敷に入る now starts the house played last');
  await page.click('#btn-records');
  ok((await st(page)).screen === 'records', L + ' the title button opens the 絵巻');
  await page.click('#btn-records-back');
  ok((await st(page)).screen === 'title', L + ' 戻る goes back to the title');
  await page.click('#btn-records');
  await page.click('#btn-records-clear');
  db = await page.evaluate(() => window.tmuxDa.records());
  ok(db.runs.length === 0 && Object.keys(db.arena).length === 0, L + ' 記録を消す empties the history');
  ok(errors.length === 0, L + ' no page errors and no network requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();

  // Migration from a best-only save, and from schema 2 with the old titles.
  const ctx2 = await browser.newContext({ viewport: PHONE, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(PAGE);
  await p2.evaluate(() => localStorage.setItem('tmux-da', JSON.stringify({ prefix: 'C-b', level: 5, arena: { 'tmux:easy': { time: 30.5, misses: 1, date: '2026-01-01' } } })));
  await p2.reload();
  db = await p2.evaluate(() => window.tmuxDa.records());
  ok(db.schema === 3 && db.runs.length === 1 && db.runs[0].legacy === true && db.runs[0].time === 30.5, L + ' an old best becomes a legacy run');
  ok(/30\.5秒/.test(await p2.$eval('[data-course="easy"] .wing-best', (e) => e.textContent)), L + ' the old best shows on the house');
  await p2.evaluate(() => localStorage.setItem('tmux-da', JSON.stringify({ schema: 2, arena: { 'tmux:normal': { time: 50 } }, runs: [{ id: 'a', course: 'normal', ver: 1, at: '2026-02-01T00:00:00Z', time: 50, misses: 0, timeouts: 1, n: 20, rank: '勇者', rec: true, qs: [{ t: 'focus', s: null, m: 0, to: 1 }] }] })));
  await p2.reload();
  db = await p2.evaluate(() => window.tmuxDa.records());
  ok(db.schema === 3 && db.runs[0].rank === 'からくり師', L + ' schema 2 runs get the new titles (勇者 → からくり師)');

  // The cap, and the weakness ranking, through the module directly.
  const capped = await p2.evaluate(() => {
    const runs = [];
    for (let i = 0; i < 150; i++) runs.push({ id: 'r' + i, course: 'easy', ver: 2, at: '2026-02-01T00:00:00Z', time: 40 - i * 0.01, misses: 0, n: 15, rank: '見習い', rec: i < 5, qs: [] });
    localStorage.setItem('tmux-da', JSON.stringify({ schema: 3, arena: { 'tmux:easy': { time: 38.5 } }, runs }));
    ADV.records.add({ course: 'easy', time: 50, raw: 50, misses: 0, overs: 0, guides: 0, keys: 15, n: 15, qs: [] });
    const left = ADV.records.load().runs.filter((x) => x.course === 'easy');
    return { n: left.length, recs: left.filter((x) => x.rec).length };
  });
  ok(capped.n <= 100 && capped.recs === 5, L + ' the history is capped at 100 per house and keeps record runs (' + capped.n + ', ' + capped.recs + ' records)');
  await p2.evaluate(() => {
    const qs = (slow) => ['focus', 'resize', 'swap', 'copy_top', 'rename'].map((t) => ({ t, s: t === 'copy_top' ? slow : 1.5, m: 0, o: t === 'copy_top' ? 1 : undefined }));
    const runs = [1, 2, 3, 4, 5].map((i) => ({ id: 'w' + i, course: 'normal', ver: 2, at: '2026-03-0' + i + 'T00:00:00Z', time: 60 - i, misses: 0, n: 20, rank: '屋敷守', rec: i === 5, qs: qs(16) }));
    localStorage.setItem('tmux-da', JSON.stringify({ schema: 3, arena: { 'tmux:normal': { time: 55 } }, runs }));
  });
  ok(await p2.evaluate(() => ADV.records.weakness('normal', 10).weak[0].type) === 'copy_top', L + ' the slowest question type comes first in the weakness list');
  await p2.goto(PAGE);
  ok(/五回平均 57\.0/.test(await p2.$eval('[data-course="normal"] .wing-best', (e) => e.textContent)), L + ' the house shows 五回平均 after five runs');
  await p2.click('#btn-records');
  ok((await st(p2)).recCourse === 'normal', L + ' the 絵巻 opens on the house played last');
  ok(/巻物/.test(await p2.$eval('.weak-list li', (e) => e.textContent)), L + ' the weakness panel names the scroll question first');
  ok(/灯り 5/.test(await p2.$eval('.weak-list li', (e) => e.textContent)), L + ' the weakness panel counts the 灯り');
  ok(/−\d/.test(await p2.$eval('.rec-log', (e) => e.textContent)), L + ' the headline shows how much faster the best is than the first run');
  const sw = await p2.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= PHONE.width, L + ' no horizontal page scroll on a phone (' + sw + 'px)');
  await shot(p2, 'records-phone');
  ok(await p2.evaluate(() => ADV.levels.rankFor(4.0, 2) === 'からくり師' && ADV.levels.rankFor(4.0) === '仕掛け番'), L + ' the hard house scales the rank thresholds');
  await ctx2.close();
}

// The music and the effects: every voice of a tune the same length, real
// notes only, and nothing silent or clipping.
async function sound(browser) {
  const L = '[sound]';
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  const tracks = await page.evaluate(() => ADV.audio.tracks());
  ok(['title', 'play', 'clear', 'record', 'rankup'].every((t) => tracks.includes(t)), L + ' the tunes exist (' + tracks.join(', ') + ')');
  for (const t of tracks) {
    const v = await page.evaluate((t) => ADV.audio.voiceLens(t), t);
    ok(v.every((x) => x.len === v[0].len) && v.every((x) => !x.bad.length), L + ' ' + t + ': voices line up and every note is real');
    const r = await page.evaluate((t) => ADV.audio.render(t, 4), t);
    ok(r.peak > 0.02 && r.peak < 0.99, L + ' ' + t + ': audible without clipping (peak ' + r.peak + ')');
  }
  for (const e of ['cursor', 'prefix', 'cmd', 'miss', 'hit', 'andon', 'shinan', 'tick', 'go']) {
    const r = await page.evaluate((e) => ADV.audio.render(e, 1.5, 5), e);
    ok(r.peak > 0.005 && r.peak < 0.99, L + ' effect ' + e + ' (peak ' + r.peak + ')');
  }
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await course(browser, 'C-b', 'easy', DESKTOP, 'dark', 'easy-dark');
  await course(browser, 'C-b', 'normal', DESKTOP, 'light', 'normal-light');
  await course(browser, 'C-b', 'hard', PHONE, 'dark', 'hard-phone');
  await course(browser, 'C-b', 'easy', PHONE, 'light', 'easy-phone-light');
  await guided(browser);
  await noSkip(browser);
  await lineEditing(browser);
  await records(browser);
  await sound(browser);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
