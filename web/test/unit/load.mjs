// Loads the game's plain scripts into a fresh sandbox with a fake window and
// localStorage, the way the page would, so modules can be tested in Node.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'js');

// Arrays and objects from the sandbox belong to another realm; compare them
// as plain data.
export const plain = (x) => JSON.parse(JSON.stringify(x));

export function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m)
  };
}

// files: e.g. ['levels.js', 'records.js']. Returns the sandbox's window.
export function load(files, opts = {}) {
  const window = {
    localStorage: opts.storage || memoryStorage(),
    location: { search: opts.search || '' }
  };
  const navigator = { platform: opts.platform || 'Linux x86_64', userAgent: opts.platform || 'node' };
  const ctx = { window, navigator, URLSearchParams, JSON, Math, Date, Promise, console, fetch: opts.fetch };
  ctx.ADV = undefined;
  vm.createContext(ctx);
  // The scripts read the global ADV that earlier scripts put on window.
  for (const f of files) {
    vm.runInContext('var ADV = window.ADV;', ctx);
    vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
  }
  return window;
}
