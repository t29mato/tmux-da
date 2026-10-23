// The shared records against a local server: run `wrangler dev --local` in
// server/ first. Two browsers stand in for two devices.
//   scripts/test.sh online   (starts the local server and runs this)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Playwright from the directory the script is run in (as playthrough.mjs).
const { chromium } = createRequire(path.join(process.cwd(), 'noop.js'))('playwright');
import { dailyOrder, jstDay } from '../../server/src/rules.js';

const API = process.env.API || 'http://localhost:8787';
// The page sends anything else to the live server: never run against it.
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(API) && API !== 'staging') {
  console.error('API must be a local server or "staging", not ' + API);
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(here, '..', 'index.html') + '?api=' + encodeURIComponent(API);
const SHOTS = process.env.SHOTS_DIR;
let failed = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed++; };

// A run as the game stores it, at a human pace.
const fakeRun = (secs) => ({
  course: 'easy', prefix: 'C-b', time: +(15 * secs).toFixed(2), raw: +(15 * secs).toFixed(2), misses: 0, overs: 0, guides: 0, keys: 30, n: 15,
  qs: Array.from({ length: 15 }, () => ({ t: 'split_lr', s: secs, m: 0 }))
});

const browser = await chromium.launch();
// The page picks its language from the browser: these checks read the
// Japanese, so every page here is Japanese unless a test says otherwise.
for (const fn of ['newContext', 'newPage']) {
  const orig = browser[fn].bind(browser);
  browser[fn] = (o = {}) => orig({ locale: 'ja-JP', ...o });
}
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE);
  return { page, errors };
};
const tab = async (page, t) => { await page.click('[data-rec-tab="' + t + '"]'); };

// Device A: two runs, then a name from the 引き継ぎ tab.
const A = await open();
await A.page.evaluate((r) => { ADV.records.add(r[0]); ADV.records.add(r[1]); }, [fakeRun(2.0), fakeRun(1.6)]);
ok(await A.page.evaluate(() => !ADV.net.state().key), 'A: no 合言葉 until asked for (nothing sent)');
await A.page.click('#btn-records');
await tab(A.page, 'sync');
await A.page.click('[data-sync-now]');
await A.page.waitForSelector('.sync-key code');
const key = await A.page.$eval('.sync-key code', (e) => e.textContent);
ok(/^[a-z]+-[a-z]+-[a-z]+-\d{3}$/.test(key), 'A: 今すぐ合わせる makes a 合言葉: ' + key);
const name = 'て' + Date.now().toString(36).slice(-5);
await A.page.fill('[data-name-form="records"] input', name);
await A.page.click('[data-name-form="records"] button');
await A.page.waitForFunction((n) => ADV.net.state().name === n, name);
ok(true, 'A: the name is set: ' + name);
if (SHOTS) await A.page.screenshot({ path: SHOTS + '/online-sync.png', fullPage: true });

// A plays: the result enters the board.
await A.page.click('#btn-records-back');
await A.page.evaluate((order) => {
  // A finished run through the game's own path, at a human pace.
  const r = { course: 'easy', prefix: 'C-b', time: 21, raw: 21, misses: 0, overs: 0, guides: 0, keys: 30, n: 15, qs: order.map((t) => ({ t, s: 1.4, m: 0 })) };
  return ADV.net.submit(Object.assign(r, { id: 'r_online_' + Date.now(), ver: 2, at: new Date().toISOString() }));
}, dailyOrder('easy', jstDay(new Date())));
await A.page.click('#btn-records');
await tab(A.page, 'board');
await A.page.waitForSelector('.rec-table.board tr.is-me');
ok(/21\.0秒/.test(await A.page.$eval('.rec-table.board tr.is-me', (e) => e.textContent)), 'A: the board shows my row, highlighted');
if (SHOTS) await A.page.screenshot({ path: SHOTS + '/online-board.png', fullPage: true });

// Device B: one run of its own, then A's 合言葉.
const B = await open();
await B.page.evaluate((r) => ADV.records.add(r), fakeRun(3.0));
await B.page.click('#btn-records');
await tab(B.page, 'sync');
await B.page.fill('[data-key-form] input', key.toUpperCase().replace(/-/g, ' '));
await B.page.click('[data-key-form] button');
await B.page.waitForFunction(() => /切り替えた/.test((document.querySelector('[data-sync-msg]') || {}).textContent || ''));
const bRuns = await B.page.evaluate(() => ADV.records.runsOf('easy').length);
ok(bRuns === 3, 'B: after the 合言葉, B has A\'s two runs and its own (' + bRuns + ')');
ok(await B.page.evaluate((n) => ADV.net.state().name === n, name), 'B: the name came along');
const best = await B.page.evaluate(() => ADV.records.best('easy').time);
ok(best === 24, 'B: the best is recomputed across devices (' + best + ')');

// A syncs again and gets B's run.
await A.page.evaluate(() => ADV.net.sync());
ok(await A.page.evaluate(() => ADV.records.runsOf('easy').length) === 3, 'A: B\'s run arrives on A');

// A bad 合言葉.
await B.page.fill('[data-key-form] input', 'nope-nope-nope-000');
await B.page.click('[data-key-form] button');
await B.page.waitForFunction(() => /見つからない/.test(document.querySelector('[data-key-form] .nf-msg').textContent));
ok(await B.page.evaluate((k) => ADV.net.state().key === k, key), 'B: an unknown 合言葉 is refused and the old one kept');

// Ghost: a run started now races today's best or your own.
await B.page.click('#btn-records-back');
await B.page.click('#btn-records-back').catch(() => {});
await B.page.click('#course-list [data-course="easy"]');
await B.page.waitForFunction(() => window.tmuxDa.state().run && window.tmuxDa.state().run.phase === 'play', null, { timeout: 10000 });
await B.page.waitForSelector('#playbar .pb-ghost');
ok(/影/.test(await B.page.$eval('#playbar .pb-ghost', (e) => e.textContent)), 'B: the ghost shows in the bar: ' + (await B.page.$eval('#playbar .pb-ghost', (e) => e.textContent)));
if (SHOTS) await B.page.screenshot({ path: SHOTS + '/online-ghost.png' });

// The order the game asks today is the order the server expects (its copy
// of the shuffle): a real run of each course passes the check.
for (const course of ['easy', 'normal', 'hard']) {
  const C = await open();
  await C.page.click('#course-list [data-course="' + course + '"]');
  await C.page.waitForFunction(() => window.tmuxDa.state().run && window.tmuxDa.state().run.phase === 'play', null, { timeout: 10000 });
  const asked = await C.page.evaluate(() => window.tmuxDa.state().run.qs);
  const expect = dailyOrder(course, jstDay(new Date()));
  ok(JSON.stringify(asked) === JSON.stringify(expect), course + ': the game asks today\'s questions in the server\'s order (' + asked.join(' ') + ')');
  await C.page.context().close();
}

// A run on the player's own .tmux.conf is marked on the board.
await A.page.evaluate((order) => {
  const r = { course: 'easy', prefix: 'Ctrl+a', conf: 1, time: 18, raw: 18, misses: 0, overs: 0, guides: 0, keys: 30, n: 15, qs: order.map((t) => ({ t, s: 1.2, m: 0 })) };
  return ADV.net.submit(Object.assign(r, { id: 'r_own_' + Date.now(), ver: 2, at: new Date().toISOString() }));
}, dailyOrder('easy', jstDay(new Date())));
const D = await open();
await D.page.click('#btn-records');
await tab(D.page, 'board');
await D.page.waitForSelector('.rec-table.board tbody tr');
const myRow = await D.page.$$eval('.rec-table.board tbody tr', (trs, n) => {
  const tr = trs.find((t) => t.children[1].textContent.indexOf(n) === 0);
  return tr ? { text: tr.textContent, own: !!tr.querySelector('.r-own') } : null;
}, name);
ok(myRow && myRow.own && /18\.0秒/.test(myRow.text) && /自分の設定/.test(myRow.text), 'D: the own-config best shows with its mark: ' + (myRow && myRow.text));
if (SHOTS) await D.page.screenshot({ path: SHOTS + '/online-board-own.png', fullPage: true });

// The unknown 合言葉 above is a 404 on purpose; anything else is a fault.
const errs = A.errors.concat(B.errors, D.errors).filter((e) => !/status of 404/.test(e));
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close();
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exit(failed ? 1 : 0);
