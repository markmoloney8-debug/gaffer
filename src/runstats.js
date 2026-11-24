// How much has been put in since the last win. One entry = £1.
// history rows: {series, week, username, perfect}; subs: this round's live entries ({username}).
export function runStats({ history = [], round = null, subs = [], username = null }) {
  const series = round ? (round.series || 1) : null;
  const past = history.filter(h => series == null || h.series === series);
  const wins = [...new Set(past.filter(h => h.perfect).map(h => h.week))].sort((a, b) => a - b);
  const lastWin = wins.length ? wins[wins.length - 1] : 0;
  const rows = past.filter(h => h.week > lastWin).map(h => ({ week: h.week, username: h.username }));
  const inHistory = round && past.some(h => h.week === round.week);
  if (round && !inHistory) subs.forEach(s => rows.push({ week: round.week, username: s.username }));
  const weeks = [...new Set(rows.map(r => r.week))].sort((a, b) => a - b)
    .map(w => ({ week: w, entries: rows.filter(r => r.week === w).length,
                 mine: rows.filter(r => r.week === w && r.username === username).length }));
  const mine = rows.filter(r => r.username === username).length;
  const winners = lastWin ? [...new Set(past.filter(h => h.week === lastWin && h.perfect).map(h => h.username))] : [];
  return { lastWin, winners, weeks, mine, pot: rows.length, entries: rows.length };
}

// Status for the Home tiles. tone: gold = you can act, green = you're in / locked in, red = out, grey = nothing to do.
export function gafferTile({ round, subs = [], username, closed = false }) {
  if (!round) return { tone: "grey", pill: "No active round", line: "Waiting for the admin to start the week." };
  const mine = subs.filter(s => s.username === username).length;
  if (round.winnersFound) return { tone: "grey", pill: "Round complete", line: "A winner has been found." };
  if (round.locked || closed) {
    return mine
      ? { tone: "green", pill: "Locked in", line: `${mine} entr${mine === 1 ? "y" : "ies"} sealed. Waiting for results.` }
      : { tone: "grey", pill: "Missed this week", line: "Entries have closed. You can still watch it play out." };
  }
  return mine
    ? { tone: "green", pill: `${mine} entr${mine === 1 ? "y" : "ies"} in`, line: "You can add or edit until kick-off." }
    : { tone: "gold", pill: "Make your picks", line: "Pick home, draw or away for 5 matches." };
}
export function lmsTile(st, now = Date.now()) {
  const c = st && st.competition;
  if (!st) return { tone: "grey", pill: "Loading", line: "" };
  if (!c) return { tone: "grey", pill: "Not started", line: "No game running in this group yet." };
  if (c.status !== "running") return { tone: "grey", pill: "Finished", line: "This game has ended." };
  const mine = (st.entries || []).find(e => e.username === st.me);
  const gw = st.gameweek, open = gw && now < Date.parse(gw.deadline);
  if (!mine) return open ? { tone: "gold", pill: "Join in", line: "Entries are open until the first deadline." }
                         : { tone: "grey", pill: "Closed", line: "Entries closed. You can follow along." };
  if (mine.status !== "alive") return { tone: "red", pill: "Out", line: "Knocked out. You can keep following the board." };
  const picked = gw && (mine.picks || []).some(p => p.gameweek === gw.id && p.team);
  if (picked) return { tone: "green", pill: "Pick locked in", line: "You're still standing." };
  return open ? { tone: "gold", pill: "Pick a team", line: "You haven't picked this gameweek yet." }
              : { tone: "red", pill: "No pick", line: "The deadline has passed." };
}
