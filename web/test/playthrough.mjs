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

// The state, once a solved question's 成 hold is over (the next question is
// up). raw: true reads it as it is.
async function st(page, raw) {
  for (let i = 0; ; i++) {
    const s = await page.evaluate(() => window.tmuxDa.state());
    if (raw || !s.run || s.run.phase !== 'clear' || i > 80) return s;
    await page.waitForTimeout(25);
  }
}

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

// Move the focus to the (first) pane the 完成図 marks, with the arrow keys.
async function goTo(page, prefix) {
  for (let i = 0; i < 16; i++) {
    const d = await page.evaluate(() => {
      const a = document.querySelector('.pane.active');
      const t = document.querySelector('.pane.wanted');
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
    });
    if (d === 'done') return true;
    if (!d) return false;
    await page.keyboard.press(prefix);
    await page.keyboard.press({ L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' }[d]);
  }
  return false;
}

// Whether the marked pane is at the top left (or the question is over).
async function wantedAtFirst(page) {
  return page.evaluate(() => {
    const t = document.querySelector('.pane.wanted');
    return !t || (parseFloat(t.style.left) === 0 && parseFloat(t.style.top) === 0);
  });
}

// Resize the active pane by a few cells, whichever way works.
async function resizeSome(page, prefix, prefixOpt) {
  const size = () => page.evaluate(() => { const r = document.querySelector('.pane.active').getBoundingClientRect(); return [r.width, r.height]; });
  const before = await size();
  const changed = async () => { const n = await size(); return Math.abs(n[0] - before[0]) > 40 || Math.abs(n[1] - before[1]) > 40; };
  for (const dir of ['Right', 'Left', 'Down', 'Up']) {
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
    case 'focus': await goTo(page, prefix); break;
    case 'zoom': case 'unzoom': await p('z'); break;
    case 'close':
      await goTo(page, prefix);
      await p('x'); await page.keyboard.press('y');
      break;
    case 'new_window': await p('c'); break;
    case 'select_window': await p(String(s.run.goal.index)); break;
    case 'resize': await resizeSome(page, prefix, prefixOpt); break;
    case 'swap':
    case 'swap_zoom':
      await goTo(page, prefix);
      for (let i = 0; i < 8 && !(await wantedAtFirst(page)); i++) await p('{');
      if (type === 'swap_zoom') await p('z');
      break;
    case 'rename':
      await p(','); await page.keyboard.press('Control+u'); await page.keyboard.type(s.run.goal); await page.keyboard.press('Enter');
      break;
    case 'kill_window':
      if (s.activeIndex !== s.run.goal.index) await p(String(s.run.goal.index));
      await p('&'); await page.keyboard.press('y');
      break;
    case 'copy_top': await p('['); await page.keyboard.press('g'); break;
    case 'find_zoom': await goTo(page, prefix); await p('z'); break;
    case 'trident': await p('%'); await p('"'); break;
    case 'two_akima':
      for (let i = 0; i < 2; i++) {
        await goTo(page, prefix);
        await p('x'); await page.keyboard.press('y');
      }
      break;
    case 'new_and_home': await p('c'); await p(String(s.run.goal.index)); break;
    default: throw new Error('no solver for ' + type);
  }
}

// One move of the in-game guide, pressed as written.
const ARROW = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
async function followGuide(page, prefix) {
  const s = await st(page);
  const mv = s.run.next;
  if (!mv) return false;
  if (mv.pfx) await page.keyboard.press(prefix);
  if (!mv.keys.length) {
    // The rename prompt: written as words, with the name the order asks for.
    await page.keyboard.press('Control+u'); await page.keyboard.type(s.run.goal); await page.keyboard.press('Enter');
    return true;
  }
  const label = mv.keys[0];
  let m;
  if (label === '0-9') await page.keyboard.press(/(\d+) を押す|Press (\d+)/.exec(mv.text).slice(1).filter(Boolean)[0]);
  else if ((m = /^Ctrl\+([hjkl\\])$/.exec(label))) await page.keyboard.press('Control+' + (m[1] === '\\' ? 'Backslash' : m[1]));
  else if ((m = /^(Ctrl|Option)\+(.)$/.exec(label))) {
    const key = (m[1] === 'Ctrl' ? 'Control+' : 'Alt+') + ARROW[m[2]];
    for (let i = 0; i < (m[1] === 'Ctrl' ? 6 : 1); i++) await page.keyboard.press(key);
  } else await page.keyboard.press(ARROW[label] || label);
  return true;
}

// A run paused by a stray blur (another window taking the focus while the
// suite runs) is resumed with a key, and said so.
async function waitPlay(page) {
  for (let i = 0; i < 2; i++) {
    try {
      await page.waitForFunction(() => { const r = window.tmuxDa.state().run; return r && r.phase === 'play'; }, null, { timeout: 15000 });
      return;
    } catch (e) {
      const s = await page.evaluate(() => window.tmuxDa.state());
      if (!(s.run && s.run.phase === 'pause')) throw new Error('not playing: ' + JSON.stringify({ screen: s.screen, run: s.run && { phase: s.run.phase, i: s.run.i } }));
      console.log('note the run was paused by a blur; resuming');
      await page.keyboard.press('Escape');
    }
  }
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
    // The order is in the house, and the 完成図 marks what to change.
    // A two-step question shows the step big and the whole order small.
    const ob = await page.$eval('#term .motd', (e) => (e.querySelector('.ob-whole') || e.querySelector('.ob-q')).textContent).catch(() => '');
    if (ob !== s.run.order) ok(false, label + ' question ' + (i + 1) + ' (' + s.run.type + '): the order bar says "' + ob + '"');
    const marks = await page.$$eval('#term .goal, #status .goal-tab', (e) => e.length);
    if (!marks) ok(false, label + ' question ' + (i + 1) + ' (' + s.run.type + '): no 完成図 mark in the house');
    if (how === 'guide') {
      for (let step = 0; step < 12; step++) {
        const now = await st(page);
        if (!now.run || now.run.i !== i) break;
        await followGuide(page, prefix);
      }
    } else await solve(page, prefix, prefixOpt);
    try {
      await page.waitForFunction((i) => { const r = window.tmuxDa.state().run; return !r || r.i !== i; }, i, { timeout: 10000 });
    } catch (e) {
      const now = await st(page, true);
      ok(false, label + ' question ' + (i + 1) + ' (' + s.run.type + ') was not solved by ' + how + ': ' +
        JSON.stringify(now.run && { phase: now.run.phase, i: now.run.i, type: now.run.type, misses: now.run.misses, next: now.run.next && now.run.next.text, armed: now.armed, windows: now.windows }));
      return seen;
    }
  }
  return seen;
}

async function waitResult(page, label) {
  try {
    await page.waitForFunction(() => document.body.dataset.screen === 'result', null, { timeout: 10000 });
    ok(true, label + ' the course ends on the 絵巻 result');
    return true;
  } catch (e) {
    ok(false, label + ' no result screen');
    return false;
  }
}

// Pretend to be a Mac or a PC: the resize keys differ (see guided()).
async function setPlatform(ctx, platform) {
  const p = platform === 'mac' ? 'MacIntel' : 'Linux x86_64';
  await ctx.addInitScript((p) => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => p });
    Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => p });
  }, p);
}

async function course(browser, prefixOpt, id, viewport, scheme, tag, platform = 'mac') {
  const prefix = prefixOpt === 'C-a' ? 'Control+a' : 'Control+b';
  const label = `[${id} ${platform} ${viewport.width}px ${scheme}]`;
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: 'reduce' });
  await setPlatform(ctx, platform);
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  ok((await st(page)).prefix === 'C-b', label + ' the prefix is the default Ctrl+b');
  ok(!(await page.$('#title-screen [data-prefix]')), label + ' there is no prefix chooser');
  await shot(page, `title-${tag}`);
  await page.click(`#course-list [data-course="${id}"]`);
  await waitPlay(page);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'sink'), label + ' the key sink has the focus (so Vimium and the like pass keys through)');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'sink');
  ok(true, label + ' the sink takes the focus back after a blur');
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
  ok(/お手本/.test(await page.$eval('#result-body .em-verdict', (e) => e.textContent)), label + ' the result compares with the お手本 time');
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
// `platform` 'mac' or 'pc': the resize keys differ (Option+arrow once, or
// Ctrl+arrow pressed again and again), so both are played on any machine.
async function guided(browser, platform) {
  const L = '[guide ' + platform + ']';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  await setPlatform(ctx, platform);
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

// Moving between rooms: the 別解 (o, ;) beside the 指南, and the
// vim-tmux-navigator setting (Ctrl+h/j/k/l, no prefix).
async function navigator(browser) {
  const L = '[navigator]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  ok((await st(page)).conf === null && /既定/.test(await page.$eval('#conf-state', (e) => e.textContent)), L + ' the keys are the defaults to begin with');
  // Default: arrows, with o / ; offered as 別解.
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  let alts = 0;
  for (let guard = 0; guard < 80; guard++) {
    const s = await st(page);
    if (!s.run || s.run.phase !== 'play') break;
    if (s.run.next && /^[←→↑↓]$/.test(s.run.next.keys[0] || '')) {
      const t = await page.$eval('#term .motd', (e) => (e.querySelector('.ob-alt') || {}).textContent || '');
      if (/別解/.test(t) && /o|;/.test(t)) alts++;
    }
    await followGuide(page, 'Control+b');
  }
  await waitResult(page, L);
  ok(alts >= 1, L + ' o / ; are shown as 別解 next to the arrows (' + alts + ')');
  ok((await st(page)).result.misses === 0, L + ' following the arrows makes no miss');
  // o and ; themselves solve a move.
  await page.click('#result-body [data-title]');
  await page.click('#conf-box summary');
  await page.click('#conf-sample');
  ok((await st(page)).conf.navigator === true, L + ' the vim-tmux-navigator sample is applied');
  ok(/vim-tmux-navigator/.test(await page.$eval('#conf-text', (e) => e.value)), L + ' its lines are in the box, to copy');
  ok(await page.$$eval('#conf-report li', (e) => e.length) === 2, L + ' the report lists the plugin and TPM lines as used');
  ok(/vim-tmux-navigator/.test(JSON.parse(await page.evaluate(() => localStorage.getItem('tmux-da'))).conf), L + ' the setting is kept');
  await page.reload();
  ok((await st(page)).conf && (await st(page)).conf.navigator && /自分の設定/.test(await page.$eval('#conf-state', (e) => e.textContent)), L + ' and survives a reload');
  // vim: the guide says Ctrl+h/j/k/l, no prefix, and following it solves the house.
  await page.click('#course-list [data-course="normal"]');
  await waitPlay(page);
  let ctrl = 0, bad = 0, lit = 0;
  for (let guard = 0; guard < 120; guard++) {
    const s = await st(page);
    if (!s.run || s.run.phase !== 'play') break;
    const n = s.run.next;
    if (n && /^[←→↑↓]$/.test(n.keys[0] || '')) bad++;
    if (n && /^Ctrl\+[hjkl\\]$/.test(n.keys[0] || '')) {
      ctrl++;
      if (n.pfx) bad++;
      if (!s.run.folded && !lit++) ok(/Ctrl\+[hjkl]/.test(await page.$eval('#term .motd .ob-keys', (e) => e.textContent)), L + ' the order bar lights Ctrl+h/j/k/l');
    }
    await followGuide(page, 'Control+b');
  }
  await waitResult(page, L);
  ok(lit >= 1, L + ' a move was shown in the order bar');
  ok(ctrl >= 2 && bad === 0, L + ' every move is Ctrl+h/j/k/l without the prefix (' + ctrl + ' moves, ' + bad + ' arrows)');
  ok((await st(page)).result.misses === 0, L + ' following Ctrl+h/j/k/l makes no miss');
  // As the plugin binds them by default: 合図 → Ctrl+l clears the screen,
  // Ctrl+\ with no last room says so; neither is a miss.
  await page.click('#result-body [data-title]');
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  await page.keyboard.type('echo navi');
  await page.keyboard.press('Enter');
  const body = () => page.$eval('#term .pane.active .pane-body', (e) => e.textContent);
  ok(/navi/.test(await body()), L + ' the shell shows what was typed');
  await page.keyboard.press('Control+b'); await page.keyboard.press('Control+l');
  ok(await page.$eval('#term .pane.active .pane-body', (e) => { const c = e.querySelector('.sh-clear'); if (!c) return false; let t = ''; for (let n = c.nextSibling; n; n = n.nextSibling) t += n.textContent; return !/navi/.test(t); }), L + ' 合図 → Ctrl+l clears the screen');
  await page.keyboard.press('Control+Backslash');
  ok(/no last pane/.test(await page.$eval('#status', (e) => e.textContent)), L + ' Ctrl+\\ with no last room says no last pane');
  ok((await st(page)).run.misses === 0, L + ' neither is a miss');
  ok(errors.length === 0, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// A pasted .tmux.conf: its prefix and keys are the game's, the 指南 says
// them, unknown lines are listed, and the run goes on the boards like any other.
// In English (the browser's language): a whole course by the guide, the
// result and the records, with no Japanese left on screen except the switch
// back to 日本語, and no text missing from the English table.
async function english(browser) {
  const L = '[english]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce', locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = watch(page);
  const missing = new Set();
  page.on('console', (m) => { if (/\[i18n\]/.test(m.text())) missing.add(m.text()); });
  const japanese = () => page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const el = n.parentElement;
      if (!el || el.closest('[hidden]') || el.closest('.lang-toggle') || !el.getClientRects().length) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if (/[ぁ-んァ-ヶ一-龠]/.test(n.textContent)) out.push(n.textContent.trim().slice(0, 60));
    }
    return out;
  });
  const left = new Set();
  const look = async () => { for (const t of await japanese()) left.add(t); };
  await page.goto(PAGE);
  ok(await page.evaluate(() => document.documentElement.lang) === 'en', L + ' an English browser gets the English page');
  ok(/Start/.test(await page.$eval('#btn-enter', (e) => e.textContent)), L + ' the title says Start');
  await look();
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  for (let guard = 0; guard < 400; guard++) {
    const s = await st(page);
    if (!s.run || s.run.phase !== 'play') break;
    await look();
    await followGuide(page, 'Control+b');
  }
  await waitResult(page, L);
  ok((await st(page)).result.misses === 0, L + ' the English guide leads to no wrong key');
  const share = await page.$eval('#result-body .share-text', (e) => e.textContent);
  ok(/^tmux Dojo \d+\/\d+ Beginner [\d.]+s \(par 36s\) \S+/.test(share) && (share.match(/[🟩🟨🟥]/gu) || []).length === 15 && /tmux-dojo\/\?lang=en$/.test(share),
    L + ' the result to share: time against par, the rank, a square per question, the link (' + share.replace(/\n/g, ' / ') + ')');
  await look();
  await page.click('#result-body [data-title]');
  await page.click('#btn-records');
  await look();
  await page.click('[data-rec-tab="sync"]');
  await look();
  ok(!left.size, L + ' no Japanese on screen' + (left.size ? ': ' + [...left].join(' | ') : ''));
  ok(!missing.size, L + ' every text has its English' + (missing.size ? ': ' + [...missing].join(' | ') : ''));
  // The switch: to Japanese, and it stays.
  await page.click('.lang-toggle');
  await page.waitForFunction(() => document.documentElement.lang === 'ja');
  ok(/はじめる/.test(await page.$eval('#btn-enter', (e) => e.textContent)), L + ' 日本語 switches the page to Japanese and it stays');
  ok(!errors.length, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// The no-confirm button adds the two binds, and x closes without asking.
async function noConfirm(browser) {
  const L = '[no confirm]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  ok(!(await st(page)).conf, L + ' off by default: tmux asks y first');
  await page.click('#conf-box summary');
  await page.click('#conf-noconfirm');
  ok(/bind x kill-pane/.test(await page.inputValue('#conf-text')), L + ' the button writes the binds into the box');
  ok(/確認なし/.test(await page.$eval('#conf-report', (e) => e.textContent)), L + ' the report says x closes without asking');
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  await page.keyboard.press('Control+b'); await page.keyboard.press('%');
  const n = (await st(page)).panes.length;
  await page.keyboard.press('Control+b'); await page.keyboard.press('x');
  const s = await st(page, true);
  ok(s.panes.length === n - 1, L + ' Ctrl+b x closes the pane at once (' + n + ' → ' + s.panes.length + ')');
  ok(!errors.length, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

async function ownConf(browser) {
  const L = '[own conf]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  await page.click('#conf-box summary');
  await page.fill('#conf-text', [
    'unbind C-b',
    'set -g prefix C-a',
    'bind C-a send-prefix',
    'bind | split-window -h -c "#{pane_current_path}"',
    'bind - split-window -v -c "#{pane_current_path}"',
    'unbind %',
    "unbind '\"'",
    'bind h select-pane -L',
    'bind j select-pane -D',
    'bind k select-pane -U',
    'bind l select-pane -R',
    'bind x kill-pane',
    'bind m resize-pane -Z',
    'set -g mouse on',
    'set -g status-style bg=colour235',
    'bind -T copy-mode-vi v send -X begin-selection'
  ].join('\n'));
  await page.click('#conf-apply');
  const c = (await st(page)).conf;
  ok(c && c.prefix === 'Ctrl+a', L + ' the prefix is Ctrl+a');
  ok(/合図 Ctrl\+a/.test(await page.$eval('#conf-state', (e) => e.textContent)), L + ' the box says so');
  ok(await page.$$eval('#conf-report > ul li', (e) => e.length) === 13, L + ' 13 lines are used');
  ok(/読み飛ばした 3 行/.test(await page.$eval('#conf-report', (e) => e.textContent)), L + ' 3 lines are listed as passed over');
  await page.click('#course-list [data-course="normal"]');
  await waitPlay(page);
  ok(/Ctrl\+a/.test(await page.$eval('#term .motd', (e) => e.textContent)), L + ' the order bar shows Ctrl+a as the prefix');
  const seen = new Set();
  for (let guard = 0; guard < 120; guard++) {
    const s = await st(page);
    if (!s.run || s.run.phase !== 'play') break;
    if (s.run.next && s.run.next.keys[0]) seen.add(s.run.next.keys[0]);
    await followGuide(page, 'Control+a');
  }
  await waitResult(page, L);
  const r = (await st(page)).result;
  ok(r.misses === 0, L + ' following the 指南 in these keys makes no miss (' + r.misses + ')');
  const own = [...seen];
  ok(own.includes('|') || own.includes('-'), L + ' the 指南 splits with | or - (' + own.join(' ') + ')');
  ok(own.some((k) => /^[hjkl]$/.test(k)) && !own.some((k) => /^[←→↑↓]$/.test(k)), L + ' and moves with h/j/k/l, never the arrows');
  ok(!own.includes('%') && !own.includes('"'), L + ' the unbound % and " are never shown');
  ok(!/番付には載らない/.test(await page.$eval('#result-body', (e) => e.textContent)), L + ' the run is not kept off the boards');
  const db = await page.evaluate(() => window.tmuxDa.records());
  ok(db.runs[db.runs.length - 1].conf === 1 && db.runs[db.runs.length - 1].prefix === 'Ctrl+a', L + ' the run is marked as own keys');
  // The default prefix no longer arms, and an unbound key is unbound.
  await page.click('#result-body [data-title]');
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  await page.keyboard.press('Control+b');
  ok(!(await st(page)).armed, L + ' Ctrl+b is not the prefix any more');
  await page.keyboard.press('Control+a'); await page.keyboard.press('%');
  ok(/割り当てがない/.test(await page.$eval('#status', (e) => e.textContent)), L + ' the unbound % says it has no binding');
  // Back to the defaults.
  await page.click('#game-screen .quit');
  await page.click('#conf-reset');
  ok((await st(page)).conf === null, L + ' 既定に戻す brings the defaults back');
  ok(errors.length === 0, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// A solved question stays on screen under a 成 seal while its rooms finish
// moving; the clock stops for it, and any key goes on at once.
async function clearHold(browser) {
  const L = '[成]';
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  for (let i = 0; i < 6 && (await st(page, true)).run.phase === 'play'; i++) await followGuide(page, 'Control+b');
  let s = await st(page, true);
  ok(s.run.phase === 'clear' && s.run.i === 0, L + ' a solved question is held (' + s.run.phase + ')');
  ok(await page.$eval('#seal', (e) => e.classList.contains('show')), L + ' the 成 seal is shown');
  const t0 = await page.$eval('#playbar .pb-time span', (e) => e.textContent);
  await page.waitForTimeout(250);
  ok(await page.$eval('#playbar .pb-time span', (e) => e.textContent) === t0, L + ' the clock stands still while held (' + t0 + ')');
  await page.waitForTimeout(700);
  s = await st(page, true);
  ok(s.run.phase === 'play' && s.run.i === 1, L + ' then the next question comes by itself');
  ok(await page.$eval('#seal', (e) => !e.classList.contains('show')), L + ' and the seal is gone');
  for (let i = 0; i < 6 && (await st(page, true)).run.phase === 'play'; i++) await followGuide(page, 'Control+b');
  ok((await st(page, true)).run.phase === 'clear', L + ' the second one is held too');
  await page.keyboard.press('Control+b');
  s = await st(page, true);
  ok(s.run.phase === 'play' && s.run.i === 2 && s.armed, L + ' a key goes on at once, and counts for the next question');
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
  ok(first.run.stage === 0, L + ' the question starts within its 目安');
  ok(await page.$$eval('#sashizu .shinan li', (e) => e.length) >= 1, L + ' the 指南 is on screen from the start');
  ok(/合図|押す/.test(await page.$eval('#sashizu .shinan', (e) => e.textContent)), L + ' the 指南 says which key');
  ok(await page.$$eval('#sashizu kbd.next', (e) => e.length) >= 1, L + ' the keys to press are lit from the start');
  await shot(page, 'shinan');
  // Leaving the tab pauses: the clock stops and the question is hidden.
  await page.clock.runFor(2000);
  const before = (await st(page)).run;
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  ok((await st(page)).run.phase === 'pause', L + ' leaving the window pauses the run');
  ok(await page.$eval('#pause', (e) => !e.hidden), L + ' the pause screen shows');
  ok(!(await page.$('#sashizu .shinan')), L + ' the question is hidden while paused');
  const shown = await page.$eval('#playbar .pb-time span', (e) => e.textContent);
  await page.clock.runFor(30000);
  ok(await page.$eval('#playbar .pb-time span', (e) => e.textContent) === shown && (await st(page)).run.stage === 0, L + ' the clock does not run while paused (' + shown + ')');
  await shot(page, 'pause');
  await page.keyboard.press('Space');
  ok((await st(page)).run.phase === 'play' && (await st(page)).run.i === before.i, L + ' a key resumes on the same question');
  // Any other key resumes and also does its work (the first Ctrl+l after
  // coming back must move, not just resume).
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.press('Control+b');
  ok((await st(page)).run.phase === 'play' && (await st(page)).armed, L + ' the prefix pressed while paused resumes and arms');
  await page.keyboard.press('Escape');
  await page.clock.runFor(10500);
  let s = await st(page);
  ok(s.run.i === 0 && s.run.stage === 1, L + ' past 12 秒 of play the question is still there and the 行灯 is lit');
  ok(/目安を過ぎた/.test(await page.$eval('#sashizu .andon-over', (e) => e.textContent)), L + ' the panel says the 目安 is past');
  ok(await page.$eval('#sashizu kbd.next', (e) => getComputedStyle(e).animationName) === 'none', L + ' the lit keys stay still');
  await shot(page, 'andon');
  await page.clock.runFor(60000);
  s = await st(page);
  ok(s.run.i === 0 && s.run.stage === 1, L + ' a minute later it is still the same question');
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
  ok(r.overs >= 1, L + ' the result counts 灯り (' + r.overs + ')');
  ok(/時間がかかった|目安超え/.test(await page.$eval('#result-body', (e) => e.textContent)), L + ' the 絵巻 names the slow question');
  const db = await page.evaluate(() => window.tmuxDa.records());
  const q = db.runs[db.runs.length - 1].qs[0];
  ok(q.o === 1 && q.s > 12, L + ' the first question is stored with its overrun (' + q.s + 's)');
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
  ok(names.join('|') === '入門|中級|上級', L + ' the three courses are named (' + names.join('|') + ')');
  const modes = await page.$$eval('.wing-mode', (els) => els.map((e) => e.textContent));
  ok(modes.join('|') === '手ならし|腕試し|真剣勝負', L + ' the three modes are named (' + modes.join('|') + ')');
  ok(await page.$$eval('.wing-mode.rec', (els) => els.length === 1 && !!els[0].closest('[data-course="easy"]')), L + ' only 三間屋敷 is recommended');
  ok(/お手本 36 秒/.test(await page.$eval('[data-course="easy"] .wing-best', (e) => e.textContent)), L + ' a course with no runs shows the お手本 time');
  ok(/入門/.test(await page.$eval('#btn-enter', (e) => e.textContent)), L + ' はじめる starts with 入門 the first time');
  ok(await page.$eval('.wing[data-course="easy"]', (e) => e.classList.contains('hot')), L + ' 三間屋敷 is picked the first time');

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
  ok(db.schema === 4 && db.runs.length === 1 && run.id && run.at && run.rank && run.course === 'easy' && run.ver === 2, L + ' the run is stored with id, time, rank and ver 2');
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
  ok(await page.$$eval('.rec-panel:not(.rec-ranks) .rec-table tbody tr', (e) => e.length) === 2, L + ' the table lists both runs');
  ok(await page.$$eval('.rec-ranks tbody tr', (e) => e.length) === 5, L + ' the list of titles has all five');
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
  ok(/入門/.test(await page.$eval('#btn-enter', (e) => e.textContent)), L + ' はじめる now starts the course played last');
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
  ok(db.schema === 4 && db.runs.length === 1 && db.runs[0].legacy === true && db.runs[0].time === 30.5, L + ' an old best becomes a legacy run');
  ok(/30\.5秒/.test(await p2.$eval('[data-course="easy"] .wing-best', (e) => e.textContent)), L + ' the old best shows on the house');
  await p2.evaluate(() => localStorage.setItem('tmux-da', JSON.stringify({ schema: 2, arena: { 'tmux:normal': { time: 50 } }, runs: [{ id: 'a', course: 'normal', ver: 1, at: '2026-02-01T00:00:00Z', time: 50, misses: 0, timeouts: 1, n: 20, rank: '勇者', rec: true, qs: [{ t: 'focus', s: null, m: 0, to: 1 }] }] })));
  await p2.reload();
  db = await p2.evaluate(() => window.tmuxDa.records());
  ok(db.schema === 4 && db.runs[0].rank === '師範代', L + ' schema 2 runs get the new titles (勇者 → 師範代)');

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
    const runs = [1, 2, 3, 4, 5].map((i) => ({ id: 'w' + i, course: 'normal', ver: 2, at: '2026-03-0' + i + 'T00:00:00Z', time: 60 - i, misses: 0, n: 20, rank: '三段', rec: i === 5, qs: qs(16) }));
    localStorage.setItem('tmux-da', JSON.stringify({ schema: 3, arena: { 'tmux:normal': { time: 55 } }, runs }));
  });
  ok(await p2.evaluate(() => ADV.records.weakness('normal', 10).weak[0].type) === 'copy_top', L + ' the slowest question type comes first in the weakness list');
  await p2.goto(PAGE);
  ok(/五回平均 57\.0/.test(await p2.$eval('[data-course="normal"] .wing-best', (e) => e.textContent)), L + ' the house shows 五回平均 after five runs');
  await p2.click('#btn-records');
  ok((await st(p2)).recCourse === 'normal', L + ' the 絵巻 opens on the house played last');
  ok(/スクロール/.test(await p2.$eval('.weak-list li', (e) => e.textContent)), L + ' the weakness panel names the scroll question first');
  ok(/目安超え 5/.test(await p2.$eval('.weak-list li', (e) => e.textContent)), L + ' the weakness panel counts the overruns');
  ok(/−\d/.test(await p2.$eval('.rec-log', (e) => e.textContent)), L + ' the headline shows how much faster the best is than the first run');
  const sw = await p2.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= PHONE.width, L + ' no horizontal page scroll on a phone (' + sw + 'px)');
  await shot(p2, 'records-phone');
  ok(await p2.evaluate(() => ADV.levels.rankFor(4.0, 2) === '師範代' && ADV.levels.rankFor(4.0) === '初段'), L + ' the hard house scales the rank thresholds');
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


// What the player has learnt folds its 指南 until the 目安 passes; the
// 稽古の間 asks the weakest types; today's order is fixed for the day.
async function learning(browser) {
  const L = '[learn]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.clock.install();
  await page.goto(PAGE);
  // Every easy type solved cleanly three times: all learnt. 'resize' slow
  // and over the 目安: the weak one.
  await page.evaluate(() => {
    const types = [...new Set(ADV.levels.COURSES[0].qs)];
    for (let k = 0; k < 3; k++) {
      ADV.records.add({ course: 'easy', prefix: 'C-b', time: 30, raw: 30, misses: 0, overs: 0, guides: 0, keys: 30, n: 15, qs: types.map((t) => ({ t, s: 1.5, m: 0 })) });
    }
    ADV.records.add({ course: 'normal', prefix: 'C-b', time: 60, raw: 60, misses: 0, overs: 1, guides: 0, keys: 30, n: 20, qs: Array.from({ length: 6 }, () => ({ t: 'resize', s: 13, m: 0, o: 1 })) });
  });
  await page.reload();
  ok(/Lv\.\d+/.test(await page.$eval('#skill', (e) => e.textContent)), L + ' the title shows the 腕前: ' + (await page.$eval('#skill .sk-row', (e) => e.textContent)));
  ok(/腕前 Lv\.\d+/.test(await page.$eval('#title-meta', (e) => e.textContent)), L + ' the top bar shows the 腕前');
  ok(await page.$eval('#btn-keiko', (e) => !e.hidden && /大きさ変更/.test(e.textContent)), L + ' the 稽古の間 offers the weak type');
  ok((await st(page)).quiet === true && await page.evaluate(() => document.body.dataset.quiet === '1'), L + ' the house is quiet by default');
  await shot(page, 'title-skill');

  // Keyboard: 1 enters the first house.
  await page.keyboard.press('1');
  await page.clock.runFor(3000);
  await waitPlay(page);
  let s = await st(page);
  ok(s.run.course === 'easy', L + ' 1 on the title enters 三間屋敷');
  ok(s.run.folded, L + ' a learnt type starts with its 指南 folded');
  ok(await page.$('#term .motd .ob-guide.learnt') && !(await page.$('#sashizu .shinan')) && !(await page.$('#term .motd kbd.next')), L + ' folded: no steps, no lit keys, a 覚えた note');
  ok(s.run.goals >= 1, L + ' the 完成図 still shows what to do');
  await shot(page, 'play-learnt');
  ok(await page.$eval('#sashizu', (e) => e.offsetParent === null), L + ' the side panel is hidden unless asked for');
  await page.clock.runFor(12500);
  s = await st(page);
  ok(s.run.stage === 1 && !s.run.folded && !!(await page.$('#term .motd .ob-guide:not(.learnt)')), L + ' past the 目安 the 指南 unfolds');
  await page.clock.resume();
  // Today's order: leaving and entering again asks the same order.
  const first = s.run.qs;
  await page.click('.quit.to-title');
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  ok(JSON.stringify((await st(page)).run.qs) === JSON.stringify(first), L + ' the same house asks today\'s order again');
  ok((await st(page)).run.day === await page.evaluate(() => ADV.levels.dayKey()), L + ' the order is today\'s (Japan time)');
  // The detail panel opens and stays open.
  await page.click('.detail-toggle');
  ok(await page.$eval('#sashizu', (e) => e.offsetParent !== null), L + ' 指図の詳細 opens the side panel');
  await page.click('.detail-toggle');
  await page.click('.quit.to-title');

  // The 稽古の間 from the keyboard: K.
  await page.keyboard.press('k');
  await waitPlay(page);
  s = await st(page);
  ok(s.run.course === 'keiko' && s.run.n === 9 && s.run.qs.includes('resize'), L + ' K enters the 稽古の間: 9 questions of the weak types (' + s.run.qs.join(',') + ')');
  await playCourse(page, 'Control+b', 'C-b', L + ' keiko', 'guide');
  await waitResult(page, L + ' keiko');
  ok(/稽古を終えた/.test(await page.$eval('#result-body', (e) => e.textContent)), L + ' the 稽古 result says so');
  ok(!(await page.$('#result-body .name-form')), L + ' a 稽古 run is not offered for the boards');
  // Enter right away (a key held from the last question) does nothing; then it replays.
  await page.keyboard.press('Enter');
  ok((await st(page)).screen === 'result', L + ' Enter straight after the end does not start a new run');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await waitPlay(page);
  ok((await st(page)).run.course === 'keiko', L + ' Enter on the result plays again');
  await page.click('.quit.to-title');
  await page.keyboard.press('r');
  ok((await st(page)).screen === 'records', L + ' R opens the 絵巻');
  ok(/覚えた問題/.test(await page.$eval('#records-body', (e) => e.textContent)), L + ' the 絵巻 lists what is learnt');
  await page.keyboard.press('Escape');
  ok((await st(page)).screen === 'title', L + ' Esc goes back');

  // Quiet off: the decoration may move; the choice is kept.
  await page.click('.quiet-toggle');
  ok(await page.evaluate(() => document.body.dataset.quiet === '0'), L + ' 静 toggles the quiet house off');
  await page.reload();
  ok((await st(page)).quiet === false, L + ' and the choice is kept');
  ok(errors.length === 0, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// The long view: a day-by-day chart once there are two days.
async function longView(browser) {
  const L = '[long view]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  await page.evaluate(() => {
    const r = (t, at) => ({ course: 'easy', prefix: 'C-b', time: t, raw: t, misses: 0, overs: 0, guides: 0, keys: 30, n: 15, qs: [], at });
    ADV.records.add(r(50, '2026-09-01T03:00:00Z'));
    ADV.records.add(r(41, '2026-09-08T03:00:00Z'));
    ADV.records.add(r(33, '2026-10-01T03:00:00Z'));
  });
  await page.click('#btn-records');
  await page.click('[data-rec-course="easy"]');
  ok(await page.$$eval('.daily-chart .dot', (e) => e.length) === 3, L + ' one point per day');
  ok(/−17\.0 秒/.test(await page.$eval('.daily-l', (e) => e.textContent)), L + ' first day to latest: −17.0 秒');
  await shot(page, 'long-view');
  ok(errors.length === 0, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// The house carries on: the focus, the panes and the windows at the start
// of a question are those at the end of the one before (plus what the
// question says it added), the house is never rebuilt, and today's order
// pairs unzoom right after zoom.
async function continuity(browser, id) {
  const L = '[continuity ' + id + ']';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(PAGE);
  await page.click(`#course-list [data-course="${id}"]`);
  await waitPlay(page);
  const first = await st(page);
  ok(first.windows.map((w) => w.index + ':' + w.name + '/' + w.panes).join(' ') === '0:main/3 1:logs/2 2:build/2' && first.activeIndex === 0,
    L + ' the house starts the same for everyone: main with 3 panes, logs and build with 2, the focus in main');
  const qs = first.run.qs;
  const uz = qs.indexOf('unzoom');
  if (uz >= 0) ok(qs[uz - 1] === 'zoom', L + ' unzoom comes right after a zoom (' + qs.join(',') + ')');
  let checked = 0, kept = 0, houses = new Set([first.house]), notes = 0, noted = 0, focusMoved = 0;
  let end = null;
  for (let guard = 0; guard < 120; guard++) {
    const raw = await st(page, true);
    if (!raw.run) break;
    if (raw.run.phase === 'clear') { end = raw; await st(page); continue; }
    if (raw.run.phase !== 'play') { await st(page); continue; }
    if (end && raw.run.i === end.run.i + 1) {
      checked++;
      houses.add(raw.house);
      const same = raw.activePane === end.activePane && raw.activeIndex === end.activeIndex;
      if (same) kept++; else focusMoved++;
      const grew = raw.panes.length > end.panes.length || raw.windows.length > end.windows.length;
      const unz = end.windows.find((w) => w.active).zoomed && !raw.windows.find((w) => w.active).zoomed;
      const zoomed = !end.windows.find((w) => w.active).zoomed && raw.windows.find((w) => w.active).zoomed;
      if (raw.run.note.length) notes++;
      if (grew || unz || zoomed) { noted++; if (!raw.run.note.length) ok(false, L + ' question ' + (raw.run.i + 1) + ' (' + raw.run.type + ') changed the house without a note'); }
      else if (!end.panes.every((p) => raw.panes.includes(p))) ok(false, L + ' question ' + (raw.run.i + 1) + ' lost a pane at the boundary');
      end = null;
    }
    await followGuide(page, 'Control+b');
  }
  await waitResult(page, L);
  ok(checked >= qs.length - 3, L + ' boundaries checked: ' + checked + ' of ' + (qs.length - 1));
  ok(focusMoved === 0, L + ' the focus never moves between questions (' + kept + ' kept, ' + focusMoved + ' moved)');
  ok(houses.size === 1, L + ' one house for the whole run, never rebuilt');
  ok(notes === noted, L + ' a note appears exactly when the house had to change (' + notes + ' notes, ' + noted + ' changes)');
  ok((await st(page)).result.misses === 0, L + ' the guide never leads to a wrong key');
  ok(errors.length === 0, L + ' no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Nothing in the order moves when the prefix is pressed: the tick of a
// done step has its space from the start.
async function stillOrder(browser) {
  const L = '[still order]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.click('#course-list [data-course="easy"]');
  await waitPlay(page);
  await page.click('.detail-toggle');
  for (let i = 0; i < 20 && !((await st(page)).run.next || {}).pfx; i++) await followGuide(page, 'Control+b');
  const measure = () => page.evaluate(() => {
    const x = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().left) : null; };
    const w = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().width) : null; };
    return [x('#term .motd .ob-keys kbd.pfx + .arr'), x('#term .motd .ob-keys kbd:not(.pfx)'), x('#term .motd .ob-txt'), x('#sashizu .sz-keys kbd.pfx + .arr'), w('#sashizu .shinan li:first-child'), w('#term .motd .ob-keys kbd.pfx')];
  });
  const before = await measure();
  ok(before.every((v) => v != null), L + ' the order and the 指南 show the prefix step (' + before.join(',') + ')');
  await page.keyboard.press('Control+b');
  ok((await st(page)).armed && await page.$('#term .motd kbd.pfx.done .tick.on') && await page.$('#sashizu .shinan li.done .tick.on'), L + ' the prefix step is ticked off');
  const after = await measure();
  ok(before.join(',') === after.join(','), L + ' nothing after the prefix keycap moves (' + before.join(',') + ' → ' + after.join(',') + ')');
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ONLY=records,sound runs just those parts (the names below).
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const parts = [
  ['continuity', (b) => continuity(b, 'easy')],
  ['continuity', (b) => continuity(b, 'hard')],
  ['still', stillOrder],
  ['courses', (b) => course(b, 'C-b', 'easy', DESKTOP, 'dark', 'easy-dark')],
  ['courses', (b) => course(b, 'C-b', 'normal', DESKTOP, 'light', 'normal-light')],
  ['courses', (b) => course(b, 'C-b', 'normal', DESKTOP, 'dark', 'normal-pc', 'pc')],
  ['courses', (b) => course(b, 'C-b', 'hard', PHONE, 'dark', 'hard-phone')],
  ['courses', (b) => course(b, 'C-b', 'hard', DESKTOP, 'light', 'hard-pc', 'pc')],
  ['courses', (b) => course(b, 'C-b', 'easy', PHONE, 'light', 'easy-phone-light')],
  ['guided', (b) => guided(b, 'mac')],
  ['guided', (b) => guided(b, 'pc')],
  ['noskip', noSkip],
  ['clear', clearHold],
  ['navigator', navigator],
  ['ownconf', ownConf],
  ['noconfirm', noConfirm],
  ['english', english],
  ['editing', lineEditing],
  ['records', records],
  ['learning', learning],
  ['longview', longView],
  ['sound', sound]
];
const browser = await chromium.launch();
// The page picks its language from the browser: these checks read the
// Japanese, so every page here is Japanese unless a test says otherwise.
for (const fn of ['newContext', 'newPage']) {
  const orig = browser[fn].bind(browser);
  browser[fn] = (o = {}) => orig({ locale: 'ja-JP', ...o });
}
try {
  for (const [name, fn] of parts) if (!only.length || only.includes(name)) await fn(browser);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
