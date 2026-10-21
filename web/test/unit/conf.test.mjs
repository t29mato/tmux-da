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

test('everything else is listed with a reason, never dropped silently', () => {
  const c = C.parse([
    'set -g mouse on',
    'set -g status-style bg=black',
    'setw -g mode-keys vi',
    "set -g @plugin 'tmux-plugins/tmux-resurrect'",
    'bind -T copy-mode-vi v send -X begin-selection',
    'bind q display-panes',
    'if-shell "test -f ~/.local.conf" "source ~/.local.conf"',
    'bind Q kill-session'
  ].join('\n'));
  assert.equal(c.used.length, 0);
  assert.equal(c.skipped.length, 8);
  assert.ok(c.skipped.every((s) => s.why && s.no >= 1 && s.line));
  assert.equal(c.custom, false, 'nothing taken: still the defaults');
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
