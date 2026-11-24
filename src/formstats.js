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

// ── Using team_form (league position, last 5, home/away records) ───────────────────────────────
const pts = s => (s || "").split("").reduce((a, c) => a + (c === "W" ? 3 : c === "D" ? 1 : 0), 0);
export const formPoints = pts;
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
export const ordinal = ord;
export function teamMap(rows) { const m = {}; (rows || []).forEach(r => { m[r.team] = r; }); return m; }

// One line per fixture this week: each side's position, last 5, and record at the relevant venue.
export function matchPreviews(round, tf) {
  const by = teamMap(tf);
  return (round ? round.fixtures : []).map((f, i) => {
    const h = by[f.home], a = by[f.away];
    const side = (r, fallback, venue) => ({
      pos: r ? r.position : null,
      last5: r && r.last5 ? r.last5 : (fallback || []).join(""),
      venue: r && r[venue] ? { w: r[venue].w, d: r[venue].d, l: r[venue].l, p: r[venue].p, last5: r[venue].last5 || "" } : null,
    });
    const home = side(h, f.form && f.form.home, "home"), away = side(a, f.form && f.form.away, "away");
    const hv = home.venue ? pts(home.venue.last5) : null, av = away.venue ? pts(away.venue.last5) : null;
    return { i, homeTeam: f.home, awayTeam: f.away, home, away, edge: hv != null && av != null ? hv - av : null };
  });
}

// Last Man Standing: this gameweek's teams, best-looking first, leaving out teams already used.
// Score = last 5 results + last 5 at the venue they play at this week + a small nod to league position. A guide, not a promise.
export function lmsBest(fixtures, tf, used = new Set()) {
  const by = teamMap(tf), out = [];
  (fixtures || []).forEach(f => {
    if (f.result && f.result !== "postponed") return;                      // already played
    for (const [team, opp, venue] of [[f.home, f.away, "home"], [f.away, f.home, "away"]]) {
      if (used.has(team)) continue;
      const r = by[team], o = by[opp];
      if (!r) { out.push({ team, opp, venue, score: null }); continue; }
      const v = r[venue] || {};
      const oppPos = o ? o.position : 10;
      out.push({ team, opp, venue, last5: r.last5 || "", venueLast5: v.last5 || "", pos: r.position, oppPos,
        score: pts(r.last5) + pts(v.last5) + Math.max(0, (oppPos - r.position)) * 0.3 });
    }
  });
  return out.sort((a, b) => (b.score == null ? -1e9 : b.score) - (a.score == null ? -1e9 : a.score));
}

// ── Using the richer history (fixtures + results saved by the weekly archive; older rows don't have them) ─────
// How often each kind of pick has come in, across every saved week.
export function pickTypeRecord(history) {
  const t = { home: { n: 0, hit: 0 }, draw: { n: 0, hit: 0 }, away: { n: 0, hit: 0 } };
  let weeks = new Set();
  (history || []).forEach(h => {
    if (!Array.isArray(h.results) || !h.preds) return;
    weeks.add(h.series + "|" + h.week);
    h.results.forEach((r, i) => {
      const p = h.preds[String(i)] || h.preds[i];
      if (!t[p] || !r || r === "upcoming" || r === "void") return;
      t[p].n++; if (p === r) t[p].hit++;
    });
  });
  const total = t.home.n + t.draw.n + t.away.n;
  return total ? { weeks: weeks.size, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...v, pct: v.n ? Math.round(v.hit / v.n * 100) : null }])) } : null;
}
// Teams the group has backed to win, and how often that paid off (at least `min` picks).
export function teamRecord(history, min = 3) {
  const by = {};
  (history || []).forEach(h => {
    if (!Array.isArray(h.results) || !Array.isArray(h.fixtures) || !h.preds) return;
    h.fixtures.forEach((f, i) => {
      const p = h.preds[String(i)] || h.preds[i], r = h.results[i];
      if ((p !== "home" && p !== "away") || !r || r === "upcoming" || r === "void") return;
      const team = p === "home" ? f.home : f.away;
      by[team] = by[team] || { team, n: 0, hit: 0 };
      by[team].n++; if (p === r) by[team].hit++;
    });
  });
  const rows = Object.values(by).filter(x => x.n >= min).map(x => ({ ...x, pct: Math.round(x.hit / x.n * 100) }));
  if (!rows.length) return null;
  const best = rows.slice().sort((a, b) => b.pct - a.pct || b.n - a.n).slice(0, Math.min(3, Math.ceil(rows.length / 2)));
  const worst = rows.filter(r => !best.includes(r)).sort((a, b) => a.pct - b.pct || b.n - a.n).slice(0, 3);   // a team never appears in both lists
  return { best, worst };
}
