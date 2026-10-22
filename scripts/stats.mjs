// The counts, readable: visitors, returners, and per course how many started,
// solved question 1, finished, and where those who left stopped.
//   node scripts/stats.mjs [days]
const API = 'https://tmux-da-api.starrydata-mcp-cloudflare.workers.dev';
const days = process.argv[2] || 14;
const s = await (await fetch(`${API}/v1/stats?days=${days}`)).json();
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '-');
console.log('day         visitors  back');
const sum = {};
for (const [d, x] of Object.entries(s.days).sort()) {
  console.log(`${d}  ${String(x.visitors).padStart(8)}  ${String(x.back).padStart(4)}`);
  for (const [c, v] of Object.entries(x.courses)) {
    const t = sum[c] || (sum[c] = { start: 0, q1: 0, finish: 0, quit: 0 });
    for (const k in t) t[k] += v[k] || 0;
  }
}
console.log('\ncourse   start  q1 (rate)     finish (rate)');
for (const [c, t] of Object.entries(sum)) {
  console.log(`${c.padEnd(7)} ${String(t.start).padStart(6)}  ${String(t.q1).padStart(3)} (${pct(t.q1, t.start)})  ${String(t.finish).padStart(9)} (${pct(t.finish, t.start)})`);
}
if (s.quitAt.length) {
  console.log('\nleft at (course, question index → visits)');
  for (const q of s.quitAt) console.log(`  ${q.c} q${q.n + 1}: ${q.k}`);
}
