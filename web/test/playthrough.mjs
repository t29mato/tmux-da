// Plays all 24 levels of the browser version with real keyboard events,
// with both prefixes, including the boss fight, and runs arena courses.
// Also covers the Ctrl+a prefix, Alt+arrow resize,
// the prefix → i briefing, resuming, and the phone layout. With SHOTS_DIR
// set it also writes screenshots.
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

async function waitLevel(page, n, what) {
  try {
    await page.waitForFunction((n) => document.body.dataset.level === String(n), n, { timeout: 4000 });
    ok(true, what);
    return true;
  } catch (e) {
    const s = await st(page);
    ok(false, what + ' (level is ' + s.level + ', wanted ' + n + ')');
    return false;
  }
}

async function briefOpen(page) {
  return page.evaluate(() => document.body.dataset.brief === '1');
}

// The briefing ignores keys for its first 300ms. Without reduced motion the
// text types itself out, and the first key only finishes it.
async function dismissBrief(page) {
  await page.waitForFunction(() => document.body.dataset.brief === '1', null, { timeout: 2000 });
  for (let i = 0; i < 3 && await briefOpen(page); i++) {
    await page.waitForTimeout(320);
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => document.body.dataset.brief === '0', null, { timeout: 2000 });
}

const K = { splitLR: '%', splitTB: '"', rename: ',', detach: 'd', killWindow: '&', swapLeft: '{', swapUp: '{' };

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
      // prefer the axis the panes do not overlap on
      const overlapX = tr.left < ar.right && ar.left < tr.right;
      const overlapY = tr.top < ar.bottom && ar.top < tr.bottom;
      if (overlapX && !overlapY) return dy < 0 ? 'U' : 'D';
      if (overlapY && !overlapX) return dx < 0 ? 'L' : 'R';
      return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D');
    }, scene);
    if (d === 'done') return true;
    if (!d) return false;
    const key = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' }[d];
    await page.keyboard.press(prefix);
    await page.keyboard.press(key);
  }
  return false;
}

// Is the pane with `scene` the leftmost (and optionally topmost) one?
async function sceneAt(page, scene, top) {
  return page.evaluate(([scene, top]) => {
    const t = document.querySelector('.pane[data-scene="' + scene + '"]');
    if (!t) return false;
    return parseFloat(t.style.left) === 0 && (!top || parseFloat(t.style.top) === 0);
  }, [scene, top]);
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
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
    for (let i = 0; i < (mod === 'Alt' ? 2 : 8); i++) await page.keyboard.press(mod + '+Arrow' + dir);    if (await changed()) return;
  }
}

// Solves the arena / boss question on screen, with real keys.
async function solve(page, prefix, prefixOpt) {
  const s = await st(page);
  const type = s.battle.type;
  const p = async (k) => { await page.keyboard.press(prefix); await page.keyboard.press(k); };
  switch (type) {
    case 'split_lr': await p(K.splitLR); break;
    case 'split_tb': await p(K.splitTB); break;
    case 'focus': await goTo(page, 'treasure', prefix); break;
    case 'zoom': case 'unzoom': await p('z'); break;
    case 'close':
      await goTo(page, 'monster', prefix);
      await p('x'); await page.keyboard.press('y');
      break;
    case 'new_window': await p('c'); break;
    case 'select_window': {
      const name = s.battle.order.split(' ')[0];
      await p(await windowIndex(page, name));
      break;
    }
    case 'resize': await resizeSome(page, prefix, prefixOpt); break;
    case 'swap':
    case 'swap_zoom':
      for (let i = 0; i < 4 && !(await sceneAt(page, 'treasure')); i++) await p(K.swapLeft);
      if (type === 'swap_zoom') await p('z');
      break;
    case 'rename':
      await p(K.rename); await page.keyboard.press('Control+u'); await page.keyboard.type('camp'); await page.keyboard.press('Enter');
      break;
    case 'kill_window':
      if (s.activeWindow !== 'trap') await p(await windowIndex(page, 'trap'));
      await p(K.killWindow); await page.keyboard.press('y');
      break;
    case 'copy_top': await p('['); await page.keyboard.press('g'); break;
    case 'find_zoom': await goTo(page, 'treasure', prefix); await p('z'); break;
    case 'trident': await p(K.splitLR); await p(K.splitTB); break;
    case 'two_monsters':
      for (let i = 0; i < 2; i++) {
        await goTo(page, 'monster', prefix);
        await p('x'); await page.keyboard.press('y');
      }
      break;
    case 'new_and_home': await p('c'); await p(await windowIndex(page, 'home')); break;
    default: throw new Error('no solver for ' + type);
  }
}

// Fights a whole battle; returns when it is over.
async function fight(page, prefix, prefixOpt, label) {
  await page.waitForFunction(() => { const b = window.tmuxDa.state().battle; return b && b.phase === 'fight'; }, null, { timeout: 5000 });
  for (let guard = 0; guard < 40; guard++) {
    const s = await st(page);
    if (!s.battle || s.battle.phase !== 'fight') break;
    const i = s.battle.i;
    await solve(page, prefix, prefixOpt);
    try {
      await page.waitForFunction((i) => { const b = window.tmuxDa.state().battle; return !b || b.i !== i || b.phase !== 'fight'; }, i, { timeout: 3000 });
    } catch (e) {
      ok(false, label + ' question ' + (i + 1) + ' (' + s.battle.type + ') was not solved');
      return false;
    }
  }
  return true;
}

// One full playthrough. opts: {prefixOpt, viewport, scheme, tag}
async function play(browser, opts) {
  const { prefixOpt, viewport, scheme, tag } = opts;
  const prefix = prefixOpt === 'C-a' ? 'Control+a' : 'Control+b';
  const label = `[${prefixOpt} ${viewport.width}x${viewport.height} ${scheme}]`;
  console.log('--- ' + label);
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network request: ' + r.url()); });
  await page.goto(PAGE);

  await page.click(`#title-screen [data-prefix="${prefixOpt}"]`);
  const s0 = await st(page);
  ok(s0.prefix === prefixOpt, label + ' settings chosen on the title screen');
  await shot(page, `title-${tag}`);
  await page.click('#btn-start');
  await page.waitForFunction(() => document.body.dataset.brief === '1', null, { timeout: 2000 });
  await shot(page, `brief-${tag}`);
  await dismissBrief(page);

  if (viewport.width < 500) {
    const keybar = await page.$eval('#keybar', (e) => getComputedStyle(e).display);
    ok(keybar !== 'none', label + ' key bar shown on the game screen');
  }

  // ---- chapter 1 ----

  // 1: split left/right
  await page.keyboard.press(prefix);
  await page.keyboard.press(K.splitLR);
  await waitLevel(page, 2, label + ' 1 split left/right');
  await dismissBrief(page);

  // prefix → i re-opens the briefing
  await page.keyboard.press(prefix);
  await page.keyboard.press('i');
  ok(await briefOpen(page), label + ' prefix → i reopens the briefing');
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape');
  ok(!(await briefOpen(page)), label + ' any key closes the briefing');

  // 2: split top/bottom
  await page.keyboard.press(prefix);
  await page.keyboard.press(K.splitTB);
  await waitLevel(page, 3, label + ' 2 split top/bottom');
  await dismissBrief(page);

  // 3: focus the treasure pane
  ok(await goTo(page, 'treasure', prefix), label + ' 3 moved to the treasure pane');
  await waitLevel(page, 4, label + ' 3 focus the treasure pane');
  await dismissBrief(page);

  // 4: zoom
  await page.keyboard.press(prefix);
  await page.keyboard.press('z');
  await waitLevel(page, 5, label + ' 4 zoom');
  await dismissBrief(page);

  // 5: close the monster pane
  ok(await goTo(page, 'monster', prefix), label + ' 5 moved to the monster pane');
  await page.keyboard.press(prefix);
  await page.keyboard.press('x');
  await shot(page, `monster-${tag}`);
  await page.keyboard.press('y');
  await waitLevel(page, 6, label + ' 5 close the monster pane');
  await dismissBrief(page);
  await shot(page, `game-${tag}`);

  // 6: resize: Ctrl+arrows (C-b run) or Alt+arrows (C-a run), repeatable.
  const dirs = prefixOpt === 'C-a'
    ? ['Alt+ArrowDown', 'Alt+ArrowUp', 'Alt+ArrowRight', 'Alt+ArrowLeft']
    : ['Control+ArrowDown', 'Control+ArrowUp', 'Control+ArrowRight', 'Control+ArrowLeft'];
  const reps = prefixOpt === 'C-a' ? 2 : 9;
  let cleared = false;
  for (const d of dirs) {
    await page.keyboard.press(prefix);
    for (let i = 0; i < reps && !cleared; i++) {
      await page.keyboard.press(d);   // repeat: no prefix between presses
      cleared = await page.evaluate(() => document.body.dataset.level === '7');
    }
    if (cleared) break;
  }
  await waitLevel(page, 7, label + ' 6 resize with ' + dirs[0].replace('Arrow', '') + ' (repeat)');
  await dismissBrief(page);

  // 7: new window
  await page.keyboard.press(prefix);
  await page.keyboard.press('c');
  await waitLevel(page, 8, label + ' 7 new window');
  await dismissBrief(page);

  // 8: rename to camp
  await page.keyboard.press(prefix);
  await page.keyboard.press(K.rename);
  await page.keyboard.press('Control+u');
  await page.keyboard.type('camp');
  await page.keyboard.press('Enter');
  await waitLevel(page, 9, label + ' 8 rename to camp');
  await dismissBrief(page);

  // 9: back to home by number
  await page.keyboard.press(prefix);
  await page.keyboard.press('0');
  await waitLevel(page, 10, label + ' 9 back to home');
  await dismissBrief(page);

  // 10: copy mode to the top of the scroll
  ok(await goTo(page, 'scroll', prefix), label + ' 10 moved to the scroll pane');
  await page.keyboard.press(prefix);
  await page.keyboard.press('[');
  ok((await st(page)).copyMode, label + ' 10 copy mode entered');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('PageUp');
  await shot(page, `copy-${tag}`);
  // A short pane on a phone needs many pages; stop when the top is reached.
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press('PageUp');
    if (await page.evaluate(() => document.body.dataset.level === '11')) break;
  }
  await waitLevel(page, 11, label + ' 10 copy mode to the top');
  await dismissBrief(page);

  // 11: detach and come back
  await page.keyboard.press(prefix);
  await page.keyboard.press(K.detach);
  ok((await st(page)).detached, label + ' 11 detached to the outer shell');
  await page.keyboard.press(prefix);
  await page.keyboard.press('d');
  ok((await st(page)).detached && (await st(page)).level === 11, label + ' 11 prefix does nothing outside tmux');
  await page.keyboard.press('Control+u');   // the `d` above went into the shell line, as it would in a real one
  await page.keyboard.type('tmux ls');
  await page.keyboard.press('Enter');
  const outer = await page.evaluate(() => document.querySelector('.outer-body').textContent);
  ok(/adv: \d+ windows/.test(outer), label + ' 11 tmux ls lists the session while detached');
  await shot(page, `detached-${tag}`);
  await page.keyboard.type('tmux attach');
  await page.keyboard.press('Enter');
  await waitLevel(page, 12, label + ' 11 attach clears chapter 1');
  ok(await page.evaluate(() => !!document.querySelector('.chapter-card')), label + ' 11 the briefing opens chapter 2');
  ok(/豆知識/.test(await page.$eval('.brief-card', (e) => e.textContent)), label + ' 12 the briefing has a tip');
  await shot(page, `chapter2-${tag}`);
  await dismissBrief(page);

  // ---- chapter 2 ----

  // 12: swap the treasure pane to the left edge
  for (let i = 0; i < 3 && !(await sceneAt(page, 'treasure')); i++) { await page.keyboard.press(prefix); await page.keyboard.press(K.swapLeft); }
  await waitLevel(page, 13, label + ' 12 swap the treasure pane to the left');
  await dismissBrief(page);

  // 13: tiled layout with Space
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(prefix);
    await page.keyboard.press('Space');
    if (await page.evaluate(() => document.body.dataset.level === '14')) break;
  }
  await waitLevel(page, 14, label + ' 13 tiled layout with Space');
  await dismissBrief(page);

  // 14: search the scroll for "secret"
  await page.keyboard.press(prefix);
  await page.keyboard.press('[');
  await page.keyboard.press('?');
  await page.keyboard.type('secret');
  await page.keyboard.press('Enter');
  await waitLevel(page, 15, label + ' 14 search in copy mode');
  ok(/secret: ruby-7731/.test((await st(page)).copyLine || ''), label + ' 14 the cursor is on the secret line');
  await shot(page, `search-${tag}`);
  await dismissBrief(page);

  // 15: select the line and copy it
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await waitLevel(page, 16, label + ' 15 copy the secret line');
  ok(!(await st(page)).copyMode, label + ' 15 copying leaves copy mode');
  await dismissBrief(page);

  // 16: paste into the door; typing it by hand must not open it
  ok(await goTo(page, 'door', prefix), label + ' 16 moved to the door pane');
  await page.keyboard.type('ruby-7731');
  await page.keyboard.press('Enter');
  ok((await st(page)).level === 16, label + ' 16 a typed password does not open the door');
  await page.keyboard.press(prefix); await page.keyboard.press(']');
  await page.keyboard.press('Enter');
  await waitLevel(page, 17, label + ' 16 pasted password opens the door');
  await dismissBrief(page);

  // 17: kill the trap window
  await page.keyboard.press(prefix);
  await page.keyboard.press(K.killWindow);
  await page.keyboard.press('y');
  await waitLevel(page, 18, label + ' 17 kill the trap window');
  await dismissBrief(page);

  // 18: a new session called castle
  await page.keyboard.press(prefix);
  await page.keyboard.press(':');
  await page.keyboard.type('new -s castle');
  await page.keyboard.press('Enter');
  await waitLevel(page, 19, label + ' 18 new session castle');
  await dismissBrief(page);

  // 19: back to adv through the picker
  await page.keyboard.press(prefix);
  await page.keyboard.press('s');
  ok(await page.evaluate(() => !!document.querySelector('.picker')), label + ' 19 the session picker opens');
  await shot(page, `picker-${tag}`);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await waitLevel(page, 20, label + ' 19 switch back to adv');
  ok(await page.evaluate(() => !!document.querySelector('.chapter-card')), label + ' 19 the briefing opens chapter 3');
  await dismissBrief(page);

  // ---- chapter 3 (MP) ----

  // 20: the trident
  ok((await st(page)).mp === 10, label + ' 20 MP starts full');
  await page.keyboard.press(prefix); await page.keyboard.press(K.splitLR);
  await page.keyboard.press(prefix); await page.keyboard.press(K.splitTB);
  await waitLevel(page, 21, label + ' 20 trident within MP');
  await dismissBrief(page);

  // 21: treasure to the top-left, zoomed
  await goTo(page, 'treasure', prefix);
  for (let i = 0; i < 4 && !(await sceneAt(page, 'treasure', true)); i++) { await page.keyboard.press(prefix); await page.keyboard.press('{'); }
  await page.keyboard.press(prefix); await page.keyboard.press('z');
  await waitLevel(page, 22, label + ' 21 treasure to the top-left and zoomed');
  await dismissBrief(page);

  // 22: three monsters, two allies
  for (let i = 0; i < 3; i++) {
    await goTo(page, 'monster', prefix);
    await page.keyboard.press(prefix); await page.keyboard.press('x'); await page.keyboard.press('y');
  }
  await waitLevel(page, 23, label + ' 22 all monsters closed, allies kept');
  await dismissBrief(page);

  // 23: library → copy → gate → paste
  await page.keyboard.press(prefix); await page.keyboard.press(await windowIndex(page, 'library'));
  await page.keyboard.press(prefix); await page.keyboard.press('[');
  await page.keyboard.press('?'); await page.keyboard.type('secret'); await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.keyboard.press(prefix); await page.keyboard.press(await windowIndex(page, 'gate'));
  await goTo(page, 'door', prefix);
  await page.keyboard.press(prefix); await page.keyboard.press(']');
  await page.keyboard.press('Enter');
  await waitLevel(page, 24, label + ' 23 the gate opens');
  await shot(page, `boss-brief-${tag}`);
  await dismissBrief(page);

  // 24: the boss
  await fight(page, prefix, prefixOpt, label + ' 24 boss');
  await shot(page, `boss-${tag}`);
  try {
    await page.waitForFunction(() => document.body.dataset.screen === 'finale', null, { timeout: 4000 });
    ok(true, label + ' 24 beating the boss reaches the finale');
  } catch (e) {
    ok(false, label + ' 24 the boss fight did not reach the finale (level ' + (await st(page)).level + ')');
  }
  const rows = await page.$$eval('#cheat-body tr', (r) => r.length);
  // Every key taught once; chapter 3 teaches no new keys.
  ok(rows === 19, label + ' finale shows the 19-row cheat sheet (' + rows + ' rows)');
  await shot(page, `finale-${tag}`);

  if (viewport.width < 500) {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= viewport.width, label + ' no horizontal page scroll (' + sw + 'px)');
  }

  ok(errors.length === 0, label + ' no page errors and no network requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Chapter 3: running out of MP resets the level with MP refilled.
async function mpRuns(browser) {
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.setItem('tmux-da', JSON.stringify({ level: 20, prefix: 'C-b' })));
  await page.reload();
  await page.click('#btn-continue');
  await page.waitForFunction(() => document.body.dataset.brief === '1', null, { timeout: 2000 });
  ok(await page.evaluate(() => !!document.querySelector('.brief-card .goal-svg')), '[mp] level 20 shows the goal shape');
  ok(/豆知識/.test(await page.$eval('.brief-card', (e) => e.textContent)) === false, '[mp] chapter 3 gives no key tips away');
  await dismissBrief(page);
  for (let i = 0; i < 10; i++) await page.keyboard.press('a');
  await page.waitForFunction(() => document.body.dataset.brief === '1', null, { timeout: 2000 });
  ok((await st(page)).mp === 10 && (await st(page)).level === 20, '[mp] running out of MP resets level 20 with MP refilled');
  ok(!(await page.evaluate(() => !!document.querySelector('.brief-card .elder'))), '[mp] no advice after the first failure');
  await dismissBrief(page);
  for (let i = 0; i < 10; i++) await page.keyboard.press('a');
  await page.waitForFunction(() => document.body.dataset.brief === '1', null, { timeout: 2000 });
  const advice = await page.$eval('.brief-card', (e) => e.textContent);
  ok(/長老/.test(advice) && advice.includes('%') && advice.includes('"'), '[mp] the elder gives the keys after the second failure');
  await dismissBrief(page);
  await ctx.close();
}

// An arena course from the title screen to the result.
async function arena(browser, prefixOpt, course, viewport, tag) {
  const prefix = prefixOpt === 'C-a' ? 'Control+a' : 'Control+b';
  const label = `[arena ${course} ${prefixOpt}]`;
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network request: ' + r.url()); });
  await page.goto(PAGE);
  await page.click(`#title-screen [data-prefix="${prefixOpt}"]`);
  await page.click('#btn-arena');
  await shot(page, `arena-${tag}`);
  await page.click(`[data-course="${course}"]`);
  await page.waitForFunction(() => { const b = window.tmuxDa.state().battle; return b && b.phase === 'fight'; }, null, { timeout: 5000 });
  // One deliberate miss: a key the question does not want.
  if (course === 'easy') {
    // Unbound, so the board stays solvable whatever question comes first.
    await page.keyboard.press(prefix);
    await page.keyboard.press('Y');
    ok((await st(page)).battle.misses === 1, label + ' a wrong command counts as a miss');
  }
  await shot(page, `battle-${tag}`);
  await fight(page, prefix, prefixOpt, label);
  try {
    await page.waitForFunction(() => document.body.dataset.screen === 'arena' && !document.querySelector('#arena-result').hidden, null, { timeout: 4000 });
    ok(true, label + ' the course ends on the result screen');
  } catch (e) {
    ok(false, label + ' no result screen');
  }
  const s = await st(page);
  ok(s.result && s.result.time > 0 && s.result.record, label + ' result has a time (' + (s.result ? s.result.time.toFixed(1) : '-') + 's) and is a new record');
  if (course === 'easy') ok(s.result.misses >= 1, label + ' the miss is in the result');
  await shot(page, `result-${tag}`);
  await page.reload();
  await page.click('#btn-arena');
  const best = await page.$eval(`[data-course="${course}"] .course-best`, (e) => e.textContent);
  ok(/\d+\.\d秒/.test(best), label + ' the best time survives a reload (' + best + ')');
  if (viewport.width < 500) {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= viewport.width, label + ' no horizontal page scroll (' + sw + 'px)');
  }
  ok(errors.length === 0, label + ' no page errors and no network requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Emacs line editing in the shell and in prompts; send-prefix; copy keys.
async function lineEditing(browser) {
  const L = '[emacs]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.click('#title-screen [data-prefix="C-b"]');
  await page.click('#btn-start');
  await dismissBrief(page);
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
  ok((await st(page)).promptValue === 'xhome', L + ' the rename prompt edits like the shell');
  await k('Escape');
  // copy mode: C-Space / M-w (emacs) copy; v is not a selection key in tmux
  await page.keyboard.type('echo secret-42'); await k('Enter');
  await k('Control+b'); await k('[');
  await k('v');
  ok(/矩形/.test(await page.$eval('#status', (e) => e.textContent)), L + ' v in tmux copy mode explains rectangle-toggle');
  await k('Control+p'); await k('Control+p');
  await k('Control+Space'); await k('Alt+w');
  const s = await st(page);
  ok(!s.copyMode && s.clipboard.length > 0, L + ' C-Space then M-w copies (' + JSON.stringify(s.clipboard) + ')');
  await ctx.close();
}

// Progress survives a reload, and the reset button clears it.
async function persistence(browser) {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.click('#btn-start');
  await dismissBrief(page);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('%');
  await waitLevel(page, 2, '[persist] level 2 reached');
  await page.reload();
  const cont = await page.$eval('#btn-continue', (b) => b.hidden ? '' : b.textContent);
  ok(/Lv 2/.test(cont), '[persist] title screen offers to continue from level 2');
  await ctx.close();
}

// Resuming starts a fresh session; the level must still be winnable.
async function resume(browser, level) {
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.evaluate((level) => localStorage.setItem('tmux-da', JSON.stringify({ level, prefix: 'C-b' })), level);
  await page.reload();
  await page.click('#btn-continue');
  await dismissBrief(page);
  if (level === 6) {
    const panes = await page.$$eval('.pane', (p) => p.length);
    ok(panes >= 2, '[resume] level 6 resumes with a neighbour pane');
    await resizeSome(page, 'Control+b', 'C-b');
    await waitLevel(page, 7, '[resume] level 6 clears after resuming');
  }
  if (level === 16) {
    // The scroll is back, but nothing is copied yet: copy, then paste.
    await page.keyboard.press('Control+b'); await page.keyboard.press('[');
    await page.keyboard.press('?'); await page.keyboard.type('secret'); await page.keyboard.press('Enter');
    await page.keyboard.press('Space'); await page.keyboard.press('Enter');
    await goTo(page, 'door', 'Control+b');
    await page.keyboard.press('Control+b'); await page.keyboard.press(']');
    await page.keyboard.press('Enter');
    await waitLevel(page, 17, '[resume] level 16 clears after resuming');
  }
  await ctx.close();
}

// The run history: growth on the result screen, the 記録の間, migration
// from the old best-only save, the cap, and the weakness panel.
async function records(browser) {
  const L = '[records]';
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith('file://')) errors.push('network request: ' + r.url()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(PAGE);
  ok(await page.$eval('#btn-records', (b) => b.hidden), L + ' no 記録の間 button before any run');
  await page.click('#btn-arena');
  const modes = await page.$$eval('.course-mode', (els) => els.map((e) => e.textContent));
  ok(modes.join('|') === '手ならし|おすすめ ★|真剣勝負', L + ' the three modes are named (' + modes.join('|') + ')');
  ok(await page.$$eval('.course-mode.rec', (els) => els.length === 1 && !!els[0].closest('[data-course="normal"]')), L + ' only the normal course is recommended');
  ok(/目標 36秒/.test(await page.$eval('[data-course="easy"] .course-best', (e) => e.textContent)), L + ' the easy card shows its target time');

  // Run 1, with one deliberate miss.
  await page.click('[data-course="easy"]');
  await page.waitForFunction(() => { const b = window.tmuxDa.state().battle; return b && b.phase === 'fight'; }, null, { timeout: 5000 });
  // An unbound key: a miss that leaves the board as it was.
  await page.keyboard.press('Control+b'); await page.keyboard.press('Y');
  ok((await st(page)).battle.misses === 1, L + ' an unbound key counts as a miss');
  await fight(page, 'Control+b', 'C-b', L);
  await page.waitForFunction(() => document.body.dataset.screen === 'arena' && !document.querySelector('#arena-result').hidden, null, { timeout: 4000 });
  let r = (await st(page)).result;
  ok(r.count === 1 && r.prev === null && r.record === true, L + ' first run: count 1, no previous, a record');
  ok(/出発点/.test(await page.$eval('#arena-result .dq-log', (e) => e.textContent)), L + ' first run says it is the starting point');
  let db = await page.evaluate(() => window.tmuxDa.records());
  const run = db.runs[0];
  ok(db.schema === 2 && db.runs.length === 1 && run.id && run.at && run.rank && run.course === 'easy', L + ' the run is stored with id, time and rank');
  ok(run.qs.length === 15 && run.qs.every((q) => q.to === 1 || q.s > 0), L + ' every question has its seconds');
  ok(run.qs.some((q) => q.m >= 1), L + ' the deliberate miss is on its question');

  // Run 2, from the result screen.
  await page.click('#arena-result [data-course="easy"]');
  await fight(page, 'Control+b', 'C-b', L);
  await page.waitForFunction(() => document.body.dataset.screen === 'arena' && !document.querySelector('#arena-result').hidden, null, { timeout: 4000 });
  r = (await st(page)).result;
  ok(r.count === 2 && typeof r.prev === 'number' && Math.abs(r.delta - (r.time - r.prev)) < 0.05, L + ' second run compares with the first (' + (r.delta || 0).toFixed(1) + 's)');
  ok(/前回より|新記録/.test(await page.$eval('#arena-result .dq-log', (e) => e.textContent)), L + ' the log says how it went against last time');
  ok(await page.$$eval('#arena-result .spark-bars i', (e) => e.length) === 2, L + ' the result shows a two-bar trend');
  await shot(page, 'result2-records');

  // The 記録の間 from the result.
  await page.click('#arena-result [data-records]');
  ok((await st(page)).screen === 'records' && (await st(page)).recCourse === 'easy', L + ' 記録を見る opens the easy history');
  ok(await page.$$eval('#rec-chart .bar', (e) => e.length) === 2, L + ' the chart has a bar per run');
  ok(await page.$$eval('#rec-chart .bar.rec', (e) => e.length) >= 1, L + ' record runs are marked on the chart');
  ok(await page.$$eval('.rec-table tbody tr', (e) => e.length) === 2, L + ' the table lists both runs');
  ok(await page.$$eval('.weak-list li', (e) => e.length) >= 1, L + ' two runs are enough for the weakness panel');
  await shot(page, 'records-desktop');
  await page.click('[data-rec-course="hard"]');
  ok(/まだない/.test(await page.$eval('#records-body', (e) => e.textContent)), L + ' a course with no runs says so');
  await page.click('#btn-records-back');
  ok((await st(page)).screen === 'arena', L + ' 戻る goes back to the arena');

  // After a reload, from the title.
  await page.reload();
  ok((await page.evaluate(() => window.tmuxDa.records())).runs.length === 2, L + ' runs survive a reload');
  ok(/通算 2 戦/.test(await page.$eval('#btn-records', (b) => b.hidden ? '' : b.textContent)), L + ' the title offers the 記録の間 with the count');
  await page.click('#btn-records');
  ok((await st(page)).screen === 'records', L + ' the title button opens the 記録の間');
  await page.click('#btn-records-back');
  ok((await st(page)).screen === 'title', L + ' 戻る goes back to the title');

  // The story's "記録を消す" keeps the arena history.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('tmux-da')); d.level = 3; localStorage.setItem('tmux-da', JSON.stringify(d)); });
  await page.reload();
  await page.click('#btn-start');
  await dismissBrief(page);
  ok((await page.evaluate(() => window.tmuxDa.records())).runs.length === 2, L + ' restarting the story keeps the runs');

  // Clearing the arena from the 記録の間.
  await page.goto(PAGE);
  await page.click('#btn-records');
  await page.click('#btn-records-clear');
  db = await page.evaluate(() => window.tmuxDa.records());
  ok(db.runs.length === 0 && Object.keys(db.arena).length === 0, L + ' 闘技場の記録を消す empties the history');
  ok(errors.length === 0, L + ' no page errors and no network requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();

  // Migration from a best-only save.
  const ctx2 = await browser.newContext({ viewport: PHONE, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(PAGE);
  await p2.evaluate(() => localStorage.setItem('tmux-da', JSON.stringify({ prefix: 'C-b', arena: { 'tmux:easy': { time: 30.5, misses: 1, date: '2026-01-01' } } })));
  await p2.reload();
  db = await p2.evaluate(() => window.tmuxDa.records());
  ok(db.schema === 2 && db.runs.length === 1 && db.runs[0].legacy === true && db.runs[0].time === 30.5, L + ' an old best becomes a legacy run');
  await p2.click('#btn-arena');
  ok(/30\.5秒/.test(await p2.$eval('[data-course="easy"] .course-best', (e) => e.textContent)), L + ' the old best still shows on the card');

  // The cap, and the weakness ranking, through the module directly.
  const capped = await p2.evaluate(() => {
    const runs = [];
    for (let i = 0; i < 150; i++) runs.push({ id: 'r' + i, course: 'easy', ver: 1, at: '2026-02-01T00:00:00Z', time: 40 - i * 0.01, misses: 0, timeouts: 0, n: 15, rank: '村人', rec: i < 5, qs: [] });
    localStorage.setItem('tmux-da', JSON.stringify({ schema: 2, arena: { 'tmux:easy': { time: 38.5 } }, runs }));
    ADV.records.add({ course: 'easy', time: 50, raw: 50, misses: 0, timeouts: 0, keys: 15, n: 15, qs: [] });
    const left = ADV.records.load().runs.filter((x) => x.course === 'easy');
    return { n: left.length, recs: left.filter((x) => x.rec).length };
  });
  ok(capped.n <= 100 && capped.recs === 5, L + ' the history is capped at 100 per course and keeps record runs (' + capped.n + ', ' + capped.recs + ' records)');
  await p2.evaluate(() => {
    const qs = (slow) => ['focus', 'resize', 'swap', 'copy_top', 'rename'].map((t) => ({ t, s: t === 'copy_top' ? slow : 1.5, m: 0 }));
    const runs = [1, 2, 3].map((i) => ({ id: 'w' + i, course: 'normal', ver: 1, at: '2026-03-0' + i + 'T00:00:00Z', time: 60 - i, misses: 0, timeouts: 0, n: 20, rank: '戦士', rec: i === 3, qs: qs(9) }));
    localStorage.setItem('tmux-da', JSON.stringify({ schema: 2, arena: { 'tmux:normal': { time: 57 } }, runs }));
  });
  ok(await p2.evaluate(() => ADV.records.weakness('normal', 10).weak[0].type) === 'copy_top', L + ' the slowest question type comes first in the weakness list');
  await p2.goto(PAGE);
  await p2.click('#btn-records');
  ok((await st(p2)).recCourse === 'normal', L + ' the 記録の間 opens on the course played last');
  ok(/古文書/.test(await p2.$eval('.weak-list li', (e) => e.textContent)), L + ' the weakness panel names the copy-mode question first');
  ok(/−\d/.test(await p2.$eval('.rec-log', (e) => e.textContent)), L + ' the headline shows how much faster the best is than the first run');
  const sw = await p2.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= PHONE.width, L + ' no horizontal page scroll on a phone (' + sw + 'px)');
  await shot(p2, 'records-phone');
  ok(await p2.evaluate(() => ADV.levels.rankFor(4.0, 2) === '勇者' && ADV.levels.rankFor(4.0) === '見習い剣士'), L + ' the hard course scales the rank thresholds');
  await ctx2.close();
}

const browser = await chromium.launch();
try {
  await play(browser, { prefixOpt: 'C-b', viewport: DESKTOP, scheme: 'dark', tag: 'desktop-dark' });
  await play(browser, { prefixOpt: 'C-a', viewport: DESKTOP, scheme: 'light', tag: 'desktop-light' });
  await play(browser, { prefixOpt: 'C-a', viewport: PHONE, scheme: 'light', tag: 'phone-light' });
  await play(browser, { prefixOpt: 'C-b', viewport: PHONE, scheme: 'dark', tag: 'phone-dark' });
  await arena(browser, 'C-b', 'easy', DESKTOP, 'easy');
  await arena(browser, 'C-a', 'normal', DESKTOP, 'normal');
  await arena(browser, 'C-a', 'hard', PHONE, 'hard-phone');
  await mpRuns(browser);
  await lineEditing(browser);
  await persistence(browser);
  await records(browser);
  await resume(browser, 6);
  await resume(browser, 16);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
