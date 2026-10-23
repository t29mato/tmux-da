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
// `watch`: open on a shared ?watch=<run id> link.
const open = async (watch) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE + (watch ? '&watch=' + encodeURIComponent(watch) : ''));
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
for (const course of ['easy', 'normal', 'hard', 'pro', 'daily']) {
  const C = await open();
  if (course === 'daily') await C.page.click('#today [data-daily]');
  else await C.page.click('#course-list [data-course="' + course + '"]');
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


// ---- ghost race, replay, shared configs ------------------------------------
const ARROW = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
const state = (page) => page.evaluate(() => window.tmuxDa.state());
// A run by the guide at a hand's pace, on `prefix`: the result enters the board with its keys.
const playByGuide = async (page, course, prefix, pace = [260, 500]) => {
  await page.click('#course-list [data-course="' + course + '"]');
  await page.waitForFunction(() => { const r = window.tmuxDa.state().run; return r && r.phase === 'play'; }, null, { timeout: 15000 });
  for (let guard = 0; guard < 400; guard++) {
    const s = await state(page);
    if (!s.run) break;
    if (s.run.phase !== 'play') { await page.waitForTimeout(30); continue; }
    // Reading the order: the server wants at least 0.4 s a question on average.
    await page.waitForTimeout(pace[0] + Math.random() * (pace[1] - pace[0]));
    const mv = s.run.next;
    if (!mv) continue;
    // A hand: the prefix, a moment, the key.
    if (mv.pfx) { await page.keyboard.press(prefix); await page.waitForTimeout(40 + Math.random() * 100); }
    if (mv.type) { if (/Ctrl\+u/.test(mv.text)) await page.keyboard.press('Control+u'); await page.keyboard.type(mv.type, { delay: 70 }); await page.keyboard.press('Enter'); continue; }
    if (!mv.keys.length) { await page.keyboard.press('Control+u'); await page.keyboard.type(s.run.goal, { delay: 70 }); await page.keyboard.press('Enter'); continue; }
    // Option+1, Ctrl+o (the 達人 house's layouts and rotate-window).
    const mod = /^(Ctrl|Option|Alt)\+(.+)$/.exec(mv.keys[0]);
    await page.keyboard.press(mod ? (mod[1] === 'Ctrl' ? 'Control+' : 'Alt+') + mod[2] : ARROW[mv.keys[0]] || (mv.keys[0] === 'Esc' ? 'Escape' : mv.keys[0]));
  }
  await page.waitForFunction(() => window.tmuxDa.state().screen === 'result', null, { timeout: 15000 });
  await page.waitForFunction(() => { const r = window.tmuxDa.state().result; return r.board && r.board.state !== 'sending'; }, null, { timeout: 15000 });
  return (await state(page)).result;
};

// A plays for real: the run goes up with its key log and is the ghost of others.
await A.page.click('#btn-records-back');
await A.page.click('#btn-records-back').catch(() => {});
await A.page.evaluate(() => document.querySelector('.to-title') && document.querySelector('.to-title').click());
await A.page.waitForFunction(() => window.tmuxDa.state().screen === 'title');
// Slower than the own-config run below, so that one is A's best (the mark with the link).
const ra = await playByGuide(A.page, 'easy', 'Control+b', [600, 900]);
ok(ra.board.state === 'ok', 'A: a run played by hand enters the board (' + JSON.stringify(ra.board) + ')');
if (ra.board.state !== 'ok') process.exit(1);
ok(ra.qlog.every((q) => typeof q.p === 'number'), 'A: every question has its fewest keys on the result');
// The shared link: in the share text and under この回を見る, and it opens the replay for anyone.
const shareTxt = await A.page.$eval('#result-body .share-text', (e) => e.textContent);
const watchUrl = 'https://t29mato.github.io/games/tmux-dojo/?watch=' + ra.runId;
ok(shareTxt.indexOf(watchUrl) >= 0 && /🟩|🟨|🟥/.test(shareTxt), 'A: the share text carries the squares and the watch link: ' + watchUrl);
ok(await A.page.$eval('#result-body .watch-link a', (a) => a.getAttribute('href')) === watchUrl, 'A: the link is shown under この回を見る with リンクを写す');
const W = await open(ra.runId);
await W.page.waitForFunction(() => window.tmuxDa.state().replay, null, { timeout: 15000 });
await W.page.waitForTimeout(1200);
const wr = (await state(W.page)).replay;
ok(wr.who === name && wr.playing && wr.i > 0 && !wr.lost, 'W: a fresh browser opened on ?watch=<id> goes straight into the replay of A\'s run (' + wr.i + '/' + wr.n + ' keys fed)');
if (SHOTS) await W.page.screenshot({ path: SHOTS + '/online-watch-link.png' });
await W.page.keyboard.press('Escape');
ok((await state(W.page)).screen === 'title', 'W: Esc leaves to the title');
const WX = await open('r_nope');
await WX.page.waitForTimeout(2500);
ok((await state(WX.page)).screen === 'title' && !(await state(WX.page)).replay, 'W: an unknown id stays on the title');
await WX.page.context().close();

// E: a fresh device races today's #1 (A) and sees its keys.
const E = await open();
ok(await E.page.$eval('#ghost-pick [data-ghost="top"]', (b) => b.getAttribute('aria-pressed')) === 'true', 'E: 今日の 1 位 is the ghost by default');
await E.page.click('#course-list [data-course="easy"]');
await E.page.waitForFunction(() => { const s = window.tmuxDa.state(); return s.ghost && s.ghost.today && s.run && s.run.phase === 'play'; }, null, { timeout: 10000 });
let eg = (await state(E.page)).ghost;
ok(eg.name === name && eg.keys === ra.keys, 'E: the ghost is A with its ' + eg.keys + ' keys');
await E.page.waitForTimeout(1500);
const strip = await E.page.$eval('#ghostbar', (e) => ({ t: e.textContent, kbd: e.querySelectorAll('kbd').length }));
ok(strip.t.indexOf(name) >= 0 && /問題/.test(strip.t) && strip.kbd >= 1, 'E: the strip shows A\'s question and keys: ' + strip.t);
if (SHOTS) await E.page.screenshot({ path: SHOTS + '/online-ghost-strip.png' });
await E.page.keyboard.press('Escape'); await E.page.keyboard.press('Escape');
await E.page.waitForFunction(() => window.tmuxDa.state().screen === 'title');

// E: 1 つ上の人 — the slowest run on today's board faster than E's own best (45 s).
await E.page.click('#ghost-pick [data-ghost="next"]');
await E.page.evaluate((r) => ADV.records.add(r), fakeRun(3.0));
await E.page.click('#course-list [data-course="easy"]');
await E.page.waitForFunction(() => { const s = window.tmuxDa.state(); return s.ghost && s.ghost.today; }, null, { timeout: 10000 }).catch(() => {});
const bg = (await state(E.page)).ghost;
ok(bg && bg.kind === 'next' && bg.time < 45 && bg.name === name, 'E: 1 つ上の人 is the slowest run faster than its best 45 s: ' + JSON.stringify(bg));
// (Esc is swallowed during the countdown.)
await E.page.waitForFunction(() => { const r = window.tmuxDa.state().run; return r && r.phase === 'play'; }, null, { timeout: 10000 });
await E.page.keyboard.press('Escape'); await E.page.keyboard.press('Escape');
await E.page.waitForFunction(() => window.tmuxDa.state().screen === 'title');

// E: この回を見る from the board: the keys per question, then the replay.
await E.page.click('#btn-board');
await E.page.waitForSelector('.rec-table.board tbody tr');
const watchLink = await E.page.$('.rec-table.board [data-watch="' + name + '"]');
ok(!!watchLink, 'E: A\'s row offers 見る');
await watchLink.click();
await E.page.waitForSelector('.rec-table.keylist tbody tr');
const rows = await E.page.$$eval('.rec-table.keylist tbody tr', (trs) => trs.length);
ok(rows === 15, 'E: the watch view lists the 15 questions with their keys');
if (SHOTS) await E.page.screenshot({ path: SHOTS + '/online-watch.png', fullPage: true });
await E.page.click('[data-replay-watch]');
await E.page.waitForFunction(() => window.tmuxDa.state().replay, null, { timeout: 5000 });
await E.page.waitForTimeout(1500);
const rp = (await state(E.page)).replay;
ok(rp.who === name && rp.playing && rp.i > 0 && !rp.lost, 'E: A\'s run replays on the house (' + rp.i + '/' + rp.n + ' keys fed)');
if (SHOTS) await E.page.screenshot({ path: SHOTS + '/online-replay.png' });
await E.page.keyboard.press('Escape');
ok((await state(E.page)).screen === 'records', 'E: Esc goes back to the records');

// A publishes the .tmux.conf it plays on: the exact text, after the warning.
const CONF = 'set -g prefix C-a\nbind | split-window -h\nbind - split-window -v\n';
await A.page.click('#result-body [data-title]');
await A.page.click('#conf-box summary');
await A.page.fill('#conf-text', CONF);
await A.page.click('#conf-apply');
ok((await state(A.page)).conf && (await state(A.page)).conf.prefix === 'Ctrl+a', 'A: plays on its own file (prefix Ctrl+a)');
const rc = await playByGuide(A.page, 'easy', 'Control+a');
ok(rc.board.state === 'ok' && rc.conf === 1, 'A: the own-config run enters the board');
ok(await A.page.$('#result-body [data-conf-share]') !== null, 'A: the result offers to publish the file');
await A.page.click('#result-body [data-conf-share]');
await A.page.waitForSelector('#conf-dialog[open]');
ok(await A.page.$eval('#conf-preview', (e) => e.textContent) === CONF, 'A: the sheet shows the exact text that will be public');
ok(/パス|ホスト/.test(await A.page.$eval('#conf-dialog .warn', (e) => e.textContent)), 'A: with the warning about paths and host names');
if (SHOTS) await A.page.screenshot({ path: SHOTS + '/online-conf-dialog.png' });
await A.page.click('#conf-publish');
await A.page.waitForFunction(() => ADV.net.state().confShared === true, null, { timeout: 10000 });
ok(/公開中/.test(await A.page.$eval('#result-body', (e) => e.textContent)), 'A: the result says the file is published');
await A.page.click('#result-body [data-records]');
await tab(A.page, 'sync');
await A.page.waitForSelector('[data-conf-unshare]');
ok(true, 'A: the 引き継ぎ tab shows the published file with 公開をやめる');
if (SHOTS) await A.page.screenshot({ path: SHOTS + '/online-conf-sync.png', fullPage: true });

// E reads it from the board and plays on it.
await tab(E.page, 'board');
await E.page.waitForSelector('.rec-table.board [data-conf-of="' + name + '"]');
await E.page.click('.rec-table.board [data-conf-of="' + name + '"]');
await E.page.waitForSelector('#records-body pre.conf-view');
ok(await E.page.$eval('#records-body pre.conf-view', (e) => e.textContent) === CONF, 'E: 自分の設定 on A\'s row opens the file, read-only, as published');
if (SHOTS) await E.page.screenshot({ path: SHOTS + '/online-conf-view.png', fullPage: true });
E.page.once('dialog', (d) => d.accept());
await E.page.click('[data-conf-use]');
await E.page.waitForFunction(() => window.tmuxDa.state().screen === 'title');
const ec = await state(E.page);
ok(ec.conf && ec.conf.prefix === 'Ctrl+a' && (await E.page.$eval('#conf-text', (e) => e.value)) === CONF, 'E: この設定で遊ぶ loads it into キー設定 (prefix Ctrl+a)');
// E's replay of A's own-config run uses the published file.
await E.page.click('#btn-board');
await E.page.waitForSelector('.rec-table.board [data-watch="' + name + '"]');
await E.page.click('.rec-table.board [data-watch="' + name + '"]');
await E.page.waitForSelector('[data-replay-watch]');
await E.page.click('[data-replay-watch]');
await E.page.waitForFunction(() => { const s = window.tmuxDa.state(); return s.replay && (s.replay.done || s.replay.lost || s.replay.i > 6); }, null, { timeout: 20000 });
const rp2 = (await state(E.page)).replay;
ok(!rp2.lost && (await state(E.page)).conf && (await state(E.page)).conf.prefix === 'Ctrl+a', 'E: A\'s own-config run replays on A\'s published file (' + rp2.i + ' keys, lost ' + rp2.lost + ')');
await E.page.keyboard.press('Escape');

// The link to A's own-config run: the published file comes first, then the replay starts by itself.
const W2 = await open(rc.runId);
await W2.page.waitForFunction(() => { const s = window.tmuxDa.state(); return s.replay && s.replay.i > 3; }, null, { timeout: 20000 });
const w2 = await state(W2.page);
ok(w2.replay.who === name && !w2.replay.lost && w2.conf && w2.conf.prefix === 'Ctrl+a', 'W2: ?watch= of an own-config run replays on the published file');
await W2.page.context().close();

// A takes the file down: the link goes.
await A.page.click('[data-conf-unshare]');
await A.page.waitForFunction(() => ADV.net.state().confShared === false, null, { timeout: 20000 }).catch(async (e) => {
  console.log('unshare did not go through: ' + JSON.stringify(await A.page.evaluate(() => ({ state: ADV.net.state(), msg: (document.querySelector('[data-conf-msg]') || {}).textContent, panel: (document.querySelector('[data-conf-panel]') || {}).textContent }))));
  throw e;
});
await E.page.click('[data-rec-tab="board"]');
await E.page.evaluate(() => { window.tmuxDa && (document.querySelector('[data-span="week"]').click()); });
await E.page.waitForSelector('.rec-table.board tbody tr');
ok(await E.page.$('.rec-table.board [data-conf-of="' + name + '"]') === null, 'E: after 公開をやめる the board has no link to the file');

// ---- 達人 and 今日の達人 ----------------------------------------------------
// A plays both by the guide at a hand's pace: the server takes the 達人 house
// and the day's question, and the daily board lists the keys and the peek.
await A.page.click('#btn-records-back').catch(() => {});
await A.page.evaluate(() => document.querySelector('.to-title') && document.querySelector('.to-title').click());
await A.page.waitForFunction(() => window.tmuxDa.state().screen === 'title');
await A.page.click('#conf-reset');
const rp3 = await playByGuide(A.page, 'pro', 'Control+b', [300, 500]);
ok(rp3.board.state === 'ok' && rp3.misses === 0, 'A: a 達人 run by hand enters the board (' + JSON.stringify(rp3.board) + ')');
await A.page.click('#result-body [data-title]');
const lineA = await A.page.$eval('#today .today-daily', (e) => e.textContent);
ok(/今日の達人: .+ ・ 最短 \d+ キー/.test(lineA), 'A: the title line: ' + lineA.replace(/\s+/g, ' '));
await A.page.click('#today [data-daily]');
await A.page.waitForFunction(() => { const r = window.tmuxDa.state().run; return r && r.phase === 'play'; }, null, { timeout: 15000 });
// The guide's move from the state hook: played from memory, no peek.
for (let guard = 0; guard < 80; guard++) {
  const s = await state(A.page);
  if (!s.run) break;
  if (s.run.phase !== 'play') { await A.page.waitForTimeout(30); continue; }
  await A.page.waitForTimeout(250 + Math.random() * 200);
  const mv = s.run.next;
  if (!mv) continue;
  if (mv.pfx) { await A.page.keyboard.press('Control+b'); await A.page.waitForTimeout(40 + Math.random() * 90); }
  if (mv.type) { if (/Ctrl\+u/.test(mv.text)) await A.page.keyboard.press('Control+u'); await A.page.keyboard.type(mv.type, { delay: 70 }); await A.page.keyboard.press('Enter'); continue; }
  const m = /^(Ctrl|Option|Alt)\+(.+)$/.exec(mv.keys[0]);
  await A.page.keyboard.press(m ? (m[1] === 'Ctrl' ? 'Control+' : 'Alt+') + m[2] : ARROW[mv.keys[0]] || (mv.keys[0] === 'Esc' ? 'Escape' : mv.keys[0]));
}
await A.page.waitForFunction(() => window.tmuxDa.state().screen === 'result', null, { timeout: 15000 });
await A.page.waitForFunction(() => { const r = window.tmuxDa.state().result; return r.board && r.board.state !== 'sending'; }, null, { timeout: 15000 });
const rd = (await state(A.page)).result;
ok(rd.daily && rd.board.state === 'ok' && !rd.qlog[0].g, 'A: 今日の達人 enters its board, played without the 手順 (' + JSON.stringify(rd.board) + ')');
await A.page.waitForSelector('#result-body .daily-board tr.is-me', { timeout: 10000 });
const drow = await A.page.$eval('#result-body .daily-board tr.is-me', (e) => e.textContent);
ok(drow.indexOf(name) >= 0 && drow.indexOf(rd.keys + ' / 最短 ' + rd.qlog[0].p) >= 0 && !/手順を見た/.test(drow), 'A: the day\'s board under the result: ' + drow);
const dshare = await A.page.$eval('#result-body .share-text', (e) => e.textContent);
ok(dshare.indexOf('?watch=' + rd.runId) >= 0 && /今日の達人/.test(dshare), 'A: its share text carries the watch link: ' + dshare.replace(/\n/g, ' / '));
if (SHOTS) await A.page.screenshot({ path: SHOTS + '/online-daily.png', fullPage: true });
// Another device sees it, and can watch it.
const F = await open(rd.runId);
await F.page.waitForFunction(() => window.tmuxDa.state().replay, null, { timeout: 15000 });
ok((await state(F.page)).replay.who === name, 'F: the daily run replays from its link');
await F.page.context().close();

// The unknown 合言葉 above is a 404 on purpose; anything else is a fault.
const errs = A.errors.concat(B.errors, D.errors, E.errors, W.errors).filter((e) => !/status of 404/.test(e));
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close();
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exit(failed ? 1 : 0);
