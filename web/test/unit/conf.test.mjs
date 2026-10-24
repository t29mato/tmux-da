// Reading a pasted .tmux.conf: what is taken, what is passed over and why.
//   node --test 'web/test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, plain } from './load.mjs';

const C = load(['conf.js']).ADV.conf;
const mac = load(['conf.js'], { platform: 'MacIntel' }).ADV.conf;
const ev = (key, mods = {}) => ({ key, code: mods.code, ctrl: !!mods.ctrl, alt: !!mods.alt, shift: !!mods.shift, meta: !!mods.meta });

test('keys: tmux names become key events and labels', () => {
  const k = (s) => plain(C.parseKey(s));
  assert.deepEqual(k('C-a'), { ctrl: true, alt: false, shift: false, key: 'a', label: 'Ctrl+a' });
  assert.equal(k('^b').label, 'Ctrl+b');
  assert.equal(k('M-Left').label, 'Alt+←');
  assert.equal(mac.parseKey('M-Left').label, 'Option+←');
  assert.equal(k('S-Up').label, 'Shift+↑');
  assert.equal(k('Space').key, ' ');
  assert.equal(k('|').key, '|');
  assert.equal(k('C-\\').label, 'Ctrl+\\');
  assert.equal(C.parseKey('Nope'), null);
});

test('keys: matching events, Option remapping on a Mac included', () => {
  assert.ok(C.matches(C.parseKey('C-a'), ev('a', { ctrl: true })));
  assert.ok(C.matches(C.parseKey('C-a'), ev('A', { ctrl: true, shift: true })));
  assert.ok(!C.matches(C.parseKey('C-a'), ev('a')));
  assert.ok(C.matches(C.parseKey('|'), ev('|', { shift: true })), 'a character carries its own shift');
  assert.ok(C.matches(C.parseKey('M-h'), ev('˙', { alt: true, code: 'KeyH' })));
  assert.ok(C.matches(C.parseKey('C-\\'), ev('\\', { ctrl: true, code: 'Backslash' })));
  assert.ok(!C.matches(C.parseKey('Left'), ev('ArrowLeft', { shift: true })));
  assert.ok(!C.matches(C.parseKey('h'), ev('h', { meta: true })), 'Cmd is never tmux');
});

test('words: quotes, escapes, comments and \\; between commands', () => {
  assert.deepEqual(plain(C.words(`bind '"' split-window -v -c "#{pane_current_path}" # below`)), [['bind', '"', 'split-window', '-v', '-c', '#{pane_current_path}']]);
  assert.deepEqual(plain(C.words('bind r source-file ~/.tmux.conf \\; display "Reloaded!"')), [['bind', 'r', 'source-file', '~/.tmux.conf'], ['display', 'Reloaded!']]);
  assert.deepEqual(plain(C.words('  # only a comment')), []);
});

test('the prefix', () => {
  const c = C.parse('unbind C-b\nset -g prefix C-a\nbind C-a send-prefix');
  assert.equal(c.prefix.label, 'Ctrl+a');
  assert.ok(C.isPrefix(c, ev('a', { ctrl: true })));
  assert.ok(!C.isPrefix(c, ev('b', { ctrl: true })));
  assert.equal(C.lookup(c, 'prefix', ev('a', { ctrl: true })).act.run, 'send-prefix');
  assert.equal(c.custom, true);
  const two = C.parse('set -g prefix2 C-Space');
  assert.ok(C.isPrefix(two, ev('b', { ctrl: true })) && C.isPrefix(two, ev(' ', { ctrl: true })));
});

test('binds: the usual ones become the game\'s own keys', () => {
  const c = C.parse([
    'bind | split-window -h -c "#{pane_current_path}"',
    'bind - split-window -v',
    'bind h select-pane -L',
    'bind -r H resize-pane -L 5',
    'bind -n M-Right select-pane -R',
    'bind x kill-pane',
    'bind X confirm-before -p "kill window? (y/n)" kill-window',
    'bind m resize-pane -Z',
    'bind Tab last-window',
    'bind r source-file ~/.tmux.conf \\; display "Reloaded!"'
  ].join('\n'));
  const act = (t, e) => plain(C.lookup(c, t, e).act);
  assert.equal(act('prefix', ev('|', { shift: true })).key, '%');
  assert.equal(act('prefix', ev('-')).key, '"');
  assert.equal(act('prefix', ev('h')).key, 'ArrowLeft');
  assert.deepEqual([act('prefix', ev('H', { shift: true })).resize, act('prefix', ev('H', { shift: true })).n], ['L', 5]);
  assert.equal(C.lookup(c, 'prefix', ev('H', { shift: true })).repeat, true);
  assert.equal(act('root', ev('ArrowRight', { alt: true })).key, 'ArrowRight');
  assert.equal(act('prefix', ev('x')).now, true, 'kill-pane without confirm-before closes at once');
  assert.equal(act('prefix', ev('X', { shift: true })).now, undefined, 'confirm-before keeps the y');
  assert.equal(act('prefix', ev('m')).key, 'z');
  assert.equal(act('prefix', ev('Tab')).key, 'l');
  assert.equal(act('prefix', ev('r')).run, 'noop');
  assert.equal(c.skipped.length, 0);
  assert.equal(c.used.length, 10);
});

test('unbind, and a default key bound to something else, take the default away', () => {
  const c = C.parse('unbind %\nbind l select-pane -R');
  assert.ok(C.overridden(c, ev('%', { shift: true })));
  assert.ok(C.overridden(c, ev('l')));
  assert.ok(!C.overridden(c, ev('"', { shift: true })));
  assert.ok(C.overridden(C.parse('unbind -a'), ev('c')));
  assert.ok(!C.overridden(C.parse(''), ev('c')));
});

test('vim-tmux-navigator: the keys the plugin binds by default', () => {
  const c = C.parse(C.SAMPLE_NAVIGATOR);
  assert.equal(c.navigator, true);
  const root = (key, mods) => plain(C.lookup(c, 'root', ev(key, { ctrl: true, ...mods })).act);
  assert.equal(root('h').key, 'ArrowLeft');
  assert.equal(root('j').key, 'ArrowDown');
  assert.equal(root('k').key, 'ArrowUp');
  assert.equal(root('l').key, 'ArrowRight');
  assert.equal(root('\\', { code: 'Backslash' }).key, ';');
  assert.equal(plain(C.lookup(c, 'prefix', ev('l', { ctrl: true })).act).run, 'clear');
  assert.equal(C.lookup(c, 'prefix', ev('l')), null, 'prefix l stays last-window');
  assert.equal(c.skipped.length, 0, 'the TPM lines are understood');
});

test('everything else is listed with a reason, never dropped silently: 未対応 apart from 関係ない', () => {
  const c = C.parse([
    'set -g mouse on',
    'set -g status-style bg=black',
    "set -g @plugin 'tmux-plugins/tmux-resurrect'",
    "set -g @resurrect-strategy-nvim 'session'",
    'set -g renumber-windows on',
    'bind -T popup q kill-pane',
    'if-shell "test -f ~/.local.conf" "source ~/.local.conf"',
    'run "~/bin/something"',
    'bind Q display-popup -E'
  ].join('\n'));
  // renumber-windows is followed (expert round 2).
  assert.deepEqual(plain(c.used.map((s) => s.no)), [5]);
  assert.equal(c.renumber, true);
  // 関係ない: the look and the plugin's own option. 未対応: what tmux does and the game cannot.
  assert.deepEqual(plain(c.skipped.map((s) => s.no)), [1, 2, 4]);
  assert.deepEqual(plain(c.unsupported.map((s) => s.no)), [3, 6, 7, 8, 9]);
  assert.ok(c.skipped.concat(c.unsupported).every((s) => s.why && s.no >= 1 && s.line));
  assert.equal(c.custom, true, 'Q is taken (dead), so the file counts');
  assert.equal(C.parse('set -g mouse on').custom, false, 'nothing taken: still the defaults');
});

test('a key bound to something the game lacks does nothing: no fall-back to the default', () => {
  const c = C.parse('bind = display-popup -E "lazygit"\nbind -n M-s set -g mouse on\nbind S choose-tree -w');
  const eq = C.lookup(c, 'prefix', ev('='));
  assert.ok(eq && eq.act.none, '= is bound, to nothing the game can do');
  assert.ok(C.overridden(c, ev('=')), 'so choose-buffer is gone from =');
  assert.ok(C.lookup(c, 'root', ev('ß', { alt: true, code: 'KeyS' })).act.none);
  assert.equal(C.lookup(c, 'prefix', ev('S', { shift: true })).act.key, 'w', 'choose-tree -w opens the tree with the windows');
  assert.equal(c.unsupported.length, 2);
  assert.ok(/display-popup/.test(c.unsupported[0].why));
});

test('the prefix key bound in the prefix table: last-window runs, send-prefix sends', () => {
  const c = C.parse('set -g prefix C-a\nbind C-a send-prefix\nbind C-a last-window');
  assert.equal(C.lookup(c, 'prefix', ev('a', { ctrl: true })).act.key, 'l', 'the later bind wins, as in tmux');
  const d = C.parse('set -g prefix C-a\nbind C-a send-prefix');
  assert.equal(C.lookup(d, 'prefix', ev('a', { ctrl: true })).act.run, 'send-prefix');
  assert.equal(C.lookup(C.parse('set -g prefix C-a'), 'prefix', ev('a', { ctrl: true })), null, 'nothing bound: the game falls back to send-prefix');
});

test('copy-mode tables: the player\'s keys for begin, copy, cancel and the moves; mode-keys picks the table', () => {
  const c = C.parse([
    'setw -g mode-keys vi',
    'bind -T copy-mode-vi v send-keys -X begin-selection',
    'bind -T copy-mode-vi V send -X select-line',
    'bind -T copy-mode-vi C-v send-keys -X rectangle-toggle',
    'bind -T copy-mode-vi y send-keys -X copy-pipe-and-cancel "pbcopy"',
    'bind -T copy-mode-vi Y send -X copy-pipe "pbcopy"',
    'bind -T copy-mode-vi Escape send-keys -X cancel',
    'bind -T copy-mode-vi H send -X start-of-line',
    'bind -T copy-mode-vi K send -X scroll-up',
    'bind -T copy-mode-vi T send -X top-line',
    'bind -T copy-mode M-w send -X copy-selection-and-cancel',
    'bind -t vi-copy u halfpage-up'
  ].join('\n'));
  assert.equal(c.modeKeys, 'vi');
  assert.ok(c.used.some((u) => /vi 式/.test(u.say)), 'mode-keys is a used line, not 見た目');
  assert.equal(C.copyLookup(c, ev('v')).act.copy, 'begin-selection');
  assert.equal(C.copyLookup(c, ev('y')).act.copy, 'copy-pipe-and-cancel');
  assert.equal(C.copyLookup(c, ev('Y', { shift: true })).act.copy, 'copy-pipe');
  assert.equal(C.copyLookup(c, ev('Escape')).act.copy, 'cancel');
  assert.equal(C.copyLookup(c, ev('H', { shift: true })).act.copy, 'start-of-line');
  assert.equal(C.copyLookup(c, ev('u')).act.copy, 'halfpage-up', 'the old -t vi-copy form is read');
  assert.ok(C.copyLookup(c, ev('K', { shift: true })).act.none, 'scroll-up: the key is taken, dead');
  assert.equal(C.copyLookup(c, ev('T', { shift: true })).act.copy, 'top-line', 'the vi screen moves are the game\'s since expert round 2');
  assert.equal(C.copyLookup(c, ev('w', { alt: true, code: 'KeyW' })), null, 'the emacs table is not in use with mode-keys vi');
  assert.equal(C.copyKey(c, ['begin-selection']), 'v');
  assert.equal(C.copyKey(c, ['copy-pipe-and-cancel', 'copy-selection-and-cancel']), 'y');
  assert.equal(C.copyKey(c, ['history-top']), null);
  assert.equal(c.unsupported.length, 1);
  assert.ok(/scroll-up/.test(c.unsupported[0].why));
  // No mode-keys: both tables count.
  const both = C.parse('bind -T copy-mode M-w send -X copy-selection-and-cancel\nbind -T copy-mode-vi v send -X begin-selection');
  assert.equal(both.modeKeys, null);
  assert.equal(C.copyLookup(both, ev('w', { alt: true, code: 'KeyW' })).act.copy, 'copy-selection-and-cancel');
  assert.equal(C.copyLookup(both, ev('v')).act.copy, 'begin-selection');
  const em = C.parse('set -g mode-keys emacs');
  assert.equal(em.modeKeys, 'emacs');
  assert.equal(C.parse('set -g mode-keys foo').unsupported.length, 1);
});

test('status-position, and the aliases of the commands the game has', () => {
  const c = C.parse([
    'set -g status-position top',
    'bind a lastp',
    'bind b selectp -R',
    'bind c neww',
    'bind d killp',
    'bind e swapp -U',
    'bind f resizep -L 5',
    'bind g last',
    'bind h rotatew',
    'bind i prev',
    'bind j lsk',
    'bind k clock-mode',
    'bind l display "hello"',
    'bind m choose-tree -w'
  ].join('\n'));
  assert.equal(c.statusTop, true);
  assert.equal(c.unsupported.length, 0, JSON.stringify(c.unsupported));
  assert.equal(c.skipped.length, 0);
  const act = (k) => plain(C.lookup(c, 'prefix', ev(k)).act);
  assert.equal(act('a').key, ';');
  assert.equal(act('b').key, 'ArrowRight');
  assert.equal(act('c').key, 'c');
  assert.equal(act('d').key, 'x');
  assert.equal(act('e').key, '{');
  assert.deepEqual([act('f').resize, act('f').n], ['L', 5]);
  assert.equal(act('g').key, 'l');
  assert.deepEqual([act('h').key, act('h').ctrl], ['o', true]);
  assert.equal(act('i').key, 'p');
  assert.equal(act('j').key, '?');
  assert.equal(act('k').key, 't');
  assert.deepEqual([act('l').run, act('l').text], ['say', 'hello']);
  assert.equal(act('m').key, 'w');
  assert.equal(C.parse('set -g status-position bottom').statusTop, false);
});

test('base-index and pane-base-index are taken; the keys the tips name are understood', () => {
  const c = C.parse('set -g base-index 1\nsetw -g pane-base-index 1\nbind q display-panes\nbind C-o rotate-window\nbind PageUp copy-mode -u\nbind b choose-buffer');
  assert.equal(c.baseIndex, 1);
  assert.equal(c.paneBaseIndex, 1);
  assert.equal(c.used.length, 6);
  assert.equal(c.skipped.length, 0);
  assert.equal(c.custom, true);
  assert.equal(C.lookup(c, 'prefix', ev('q')).act.key, 'q');
  assert.equal(C.lookup(c, 'prefix', ev('o', { ctrl: true })).act.ctrl, true);
  assert.equal(C.lookup(c, 'prefix', ev('PageUp')).act.key, 'PageUp');
  assert.equal(C.lookup(c, 'prefix', ev('b')).act.key, '=');
  assert.equal(C.parse('set -g base-index 1').custom, true, 'a base-index alone is a setting of its own');
  assert.equal(C.parse('set -g base-index x').unsupported.length, 1, 'an unreadable number is listed');
});

test('a later bind of the same key wins; long lines join with a backslash', () => {
  const c = C.parse('bind v split-window -v\nbind v split-window -h\nbind w \\\n  new-window');
  assert.equal(C.lookup(c, 'prefix', ev('v')).act.key, '%');
  assert.equal(C.lookup(c, 'prefix', ev('w')).act.key, 'c');
  assert.equal(c.binds.length, 2);
});

test('an empty file is the defaults', () => {
  const c = C.parse('');
  assert.equal(c.custom, false);
  assert.equal(c.prefix.label, 'Ctrl+b');
});

test('the 達人 commands bound to keys: layouts, rotate -D, synchronize-panes, join / move prompts, swap and move', () => {
  const c = C.parse([
    'bind = select-layout tiled',
    'bind M-9 select-layout main-vertical-mirrored',
    'bind S setw synchronize-panes \\; display "sync #{?pane_synchronized,on,off}"',
    'bind J command-prompt -p "join pane from:" "join-pane -s \'%%\'"',
    'bind m command-prompt -p "move window to:" "move-window -t \'%%\'"',
    'bind -r < swap-window -d -t -1',
    'bind R move-window -r',
    'bind O rotate-window -D',
    'bind @ join-pane -h -s :2',
    'bind K kill-session'
  ].join('\n'));
  assert.equal(c.unsupported.length, 0, c.unsupported.map((u) => u.line + ': ' + u.why).join(' | '));
  const at = (k, m) => plain(C.lookup(c, 'prefix', ev(k, m)).act);
  assert.deepEqual([at('=').key, at('=').alt], ['5', true], 'tiled is prefix M-5');
  assert.equal(at('9', { alt: true, code: 'Digit9' }).key, '7', 'main-vertical-mirrored is prefix M-7');
  assert.deepEqual(at('S', { shift: true }).argv, ['set-window-option', 'synchronize-panes'], 'the first command counts, its name written out');
  const j = at('J', { shift: true });
  assert.deepEqual([j.run, j.label, j.tpl], ['prompt', 'join pane from:', "join-pane -s '%%'"]);
  assert.equal(at('m').run, 'prompt');
  assert.deepEqual(plain(C.lookup(c, 'prefix', ev('<', { shift: true })).repeat), true);
  assert.deepEqual(at('<', { shift: true }).argv, ['swap-window', '-d', '-t', '-1']);
  assert.deepEqual(at('O', { shift: true }), { key: 'o', alt: true, say: 'ペインを逆向きに回す' });
  assert.equal(at('@', { shift: true }).run, 'cmd');
  assert.equal(at('K', { shift: true }).run, 'cmd');
  assert.deepEqual(plain(C.flags(['join-pane', '-hd', '-s', '2.1']).f), { h: true, d: true, s: '2.1' });
});

// --- expert round 2 ---
test('command names: any start only one name has, whole aliases, tmux 3.8 ambiguity', () => {
  const r = (w, exact) => plain(C.resolve(w, exact));
  assert.deepEqual(r('kill-ses'), { name: 'kill-session' });
  assert.deepEqual(r('swapw'), { name: 'swap-window' });
  assert.deepEqual(r('selectl'), { name: 'select-layout' });
  assert.deepEqual(r('select-l'), { name: 'select-layout' });
  assert.deepEqual(r('show'), { name: 'show-options' }, 'an alias wins over the names it starts');
  assert.deepEqual(r('send'), { name: 'send-keys' });
  assert.deepEqual(r('new'), { name: 'new-session' });
  assert.deepEqual(r('break'), { name: 'break-pane' });
  assert.deepEqual(r('sp'), { name: 'split-window' });
  assert.deepEqual(r('display-mes'), { name: 'display-message' });
  assert.equal(r('display-m').error, 'ambiguous command: display-m, could be: display-menu, display-message');
  // As tmux 3.8 words it (tmux -L x source-file of each line).
  assert.equal(r('kill').error, 'ambiguous command: kill, could be: kill-pane, kill-server, kill-session, kill-window');
  assert.equal(r('kill-s').error, 'ambiguous command: kill-s, could be: kill-server, kill-session');
  assert.equal(r('sel').error, 'ambiguous command: sel, could be: select-layout, select-pane, select-window');
  assert.equal(r('disp').error, 'ambiguous command: disp, could be: display-menu, display-message, display-popup, display-panes');
  assert.equal(r('res').error, 'ambiguous command: res, could be: resize-pane, resize-window, respawn-pane, respawn-window');
  assert.equal(r('switch').error, 'ambiguous command: switch, could be: switch-client, switch-mode');
  assert.equal(r('foo').error, 'unknown command: foo');
  assert.equal(r('choose-window').error, 'unknown command: choose-window', 'gone from tmux since 2.7');
  assert.equal(r('lsp').name, 'list-panes', 'an alias of a command the game does not have');
  // An alias is never shortened: 'swap' is a start of two names.
  assert.equal(r('swap').error, 'ambiguous command: swap, could be: swap-pane, swap-window');
  // A replay of an older run: whole names only.
  assert.equal(r('kill-ses', true).error, 'unknown command: kill-ses');
  assert.deepEqual(r('killp', true), { name: 'kill-pane' });
});

test('a pasted file: shortened names in bind lines, ambiguity reported, renumber-windows and break-pane -d taken', () => {
  const c = C.parse(['bind K kill-ses', 'bind W swapw -t 1', 'bind Q kill', 'bind b break-pane -d', 'set -g renumber-windows on', 'set-o -g mode-keys vi', 'bind ~ show-messages'].join('\n'));
  const at = (k, m) => plain(C.lookup(c, 'prefix', ev(k, m)).act);
  assert.deepEqual(at('K', { shift: true }).argv, ['kill-session']);
  assert.deepEqual(at('W', { shift: true }).argv, ['swap-window', '-t', '1']);
  assert.ok(at('Q', { shift: true }).none, 'an ambiguous name binds nothing');
  assert.equal(c.unsupported.length, 1);
  assert.equal(c.unsupported[0].why, 'ambiguous command: kill, could be: kill-pane, kill-server, kill-session, kill-window');
  assert.deepEqual(at('b').argv, ['break-pane', '-d']);
  assert.equal(c.renumber, true);
  assert.equal(c.modeKeys, 'vi', 'set-o is set-option');
  assert.deepEqual(at('~').argv, ['show-messages']);
  // Read as before for a replay of an older run.
  const old = C.parse(['bind K kill-ses', 'bind b break-pane -d', 'set -g renumber-windows on'].join('\n'), { legacy: true });
  assert.equal(old.renumber, false);
  assert.equal(old.unsupported.length, 3);
});

test('fidelity 3: getopt values, shortest names, timed options, bindings with targets', () => {
  // -t2 and -dt 2 as tmux's getopt reads them.
  assert.deepEqual(plain(C.flags(['kill-pane', '-t2'])), { f: { t: '2' }, rest: [] });
  assert.deepEqual(plain(C.words('kill-session -t a; display hi')), [['kill-session', '-t', 'a'], ['display', 'hi']], 'a; b: two commands');
  assert.deepEqual(plain(C.words("display 'a;b'")), [['display', 'a;b']]);
  assert.deepEqual(plain(C.flags(['new-window', '-dn', 'logs'])), { f: { d: true, n: 'logs' }, rest: [] });
  assert.deepEqual(plain(C.flags(['rename-window', '-t', ':1', 'dev'])), { f: { t: ':1' }, rest: ['dev'] });
  // The fewest letters tmux still takes: the alias, else the shortest unique start.
  assert.equal(C.shortest('kill-pane'), 'killp');
  assert.equal(C.shortest('kill-session'), 'kill-ses');
  assert.equal(C.shortest('swap-window'), 'swapw');
  assert.equal(C.shortest('new-window'), 'neww');
  assert.equal(C.resolve(C.shortest('kill-session')).name, 'kill-session');
  // Times the game keeps are used; escape-time and mouse say why they do not matter.
  const c = C.parse(['set -g display-panes-time 3000', 'set -g repeat-time 300', 'set -sg escape-time 10', 'set -g mouse on'].join('\n'));
  assert.equal(c.displayPanesTime, 3000);
  assert.equal(c.repeatTime, 300);
  assert.deepEqual(plain(c.used.map((s) => s.no)), [1, 2]);
  assert.deepEqual(plain(c.skipped.map((s) => s.no)), [3, 4]);
  assert.ok(/Esc/.test(c.skipped[0].why) && /マウス/.test(c.skipped[1].why));
  assert.deepEqual(plain(c.unsupported.map((s) => s.no)), []);
  // A binding with a target runs the command itself (it used to be 未対応).
  const b = C.parse(['bind m select-pane -t 0', 'bind K kill-pane -t 1', 'bind W select-window -t logs', 'bind e select-layout -E'].join('\n'));
  assert.equal(b.unsupported.length, 0, JSON.stringify(plain(b.unsupported)));
  assert.deepEqual(plain(b.binds.map((x) => x.act.run || x.act.key)), ['cmd', 'cmd', 'cmd', 'E']);
});
