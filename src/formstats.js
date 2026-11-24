// Stats for the Form guide. Everything here works from data the app already has; nothing needs a database change.
const pk = (e, i) => e.preds[String(i)] || e.preds[i];

// How the group split on each match.
export function crowdSplit(round, subs) {
  return (round ? round.fixtures : []).map((f, i) => {
    const t = { home: 0, draw: 0, away: 0 };
    subs.forEach(s => { const p = pk(s, i); if (t[p] != null) t[p]++; });
    const n = t.home + t.draw + t.away;
    const top = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
    return { i, homeTeam: f.home, awayTeam: f.away, ...t, n, topPick: n ? top[0] : null, topShare: n ? Math.round(top[1] / n * 100) : 0 };
  });
}
// Players whose picks differ most from the crowd's favourite (needs at least 3 entries).
export function contrarians(round, subs) {
  const cs = crowdSplit(round, subs);
  if (subs.length < 3) return [];
  const by = {};
  subs.forEach(s => { by[s.username] = by[s.username] || { username: s.username, away: 0, of: 0 };
    cs.forEach(c => { if (pk(s, c.i) && c.topPick) { by[s.username].of++; if (pk(s, c.i) !== c.topPick) by[s.username].away++; } }); });
  return Object.values(by).filter(x => x.of).map(x => ({ ...x, pct: Math.round(x.away / x.of * 100) })).sort((a, b) => b.pct - a.pct);
}
// Crowd record on matches already played: right when the group's favourite pick was the result.
export function crowdRecord(round, subs) {
  const cs = crowdSplit(round, subs); let right = 0, played = 0, worst = null;
  cs.forEach(c => { const r = round.results && round.results[c.i] && round.results[c.i].result;
    if (!r || r === "upcoming" || r === "void") return; played++;
    const share = c.n ? Math.round(c[r] / c.n * 100) : 0;
    if (c.topPick === r) right++;
    if (!worst || share < worst.share) worst = { ...c, result: r, share }; });
  return { played, right, worst };
}
// Hot/cold: accuracy over each player's last `n` weeks vs their whole season. Needs at least 2 weeks of history.
export function hotCold(history, n = 3) {
  const weeks = [...new Set(history.map(h => `${h.series}|${h.week}`))];
  if (weeks.length < 2) return null;
  const order = weeks.map(w => w.split("|").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([s, w]) => `${s}|${w}`);
  const recent = new Set(order.slice(-n));
  const acc = rows => { const t = rows.reduce((a, r) => a + (r.total || 0), 0); return t ? rows.reduce((a, r) => a + (r.correct || 0), 0) / t : null; };
  const out = [...new Set(history.map(h => h.username))].map(u => {
    const mine = history.filter(h => h.username === u), rec = mine.filter(h => recent.has(`${h.series}|${h.week}`));
    const a = acc(rec), s = acc(mine);
    return a == null || s == null ? null : { username: u, recent: Math.round(a * 100), season: Math.round(s * 100), diff: Math.round((a - s) * 100) };
  }).filter(Boolean);
  return out.sort((a, b) => b.recent - a.recent);
}

// Last finished week: each player's best entry, best first. Works from a single week of history.
export function lastWeek(history) {
  if (!history || !history.length) return null;
  const key = h => h.series * 10000 + h.week;
  const top = Math.max(...history.map(key));
  const rows = history.filter(h => key(h) === top);
  const best = {};
  rows.forEach(h => { const b = best[h.username]; if (!b || h.correct > b.correct) best[h.username] = { username: h.username, correct: h.correct, total: h.total, entries: 0 }; });
  rows.forEach(h => { best[h.username].entries++; });
  return { series: rows[0].series, week: rows[0].week, players: Object.values(best).sort((a, b) => b.correct - a.correct || a.username.localeCompare(b.username)) };
}
