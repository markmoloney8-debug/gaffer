// Recent form: each team's last results (W / D / L), oldest first, newest last.
// Uses the 90-minute score, the same as the game itself.
function outcomeFor(m, teamId) {
  const s = m.score || {};
  const ninety = s.regularTime || s.fullTime || {};
  const h = ninety.home, a = ninety.away;
  if (h == null || a == null) return null;
  if (h === a) return "D";
  const homeWon = h > a;
  return (m.homeTeam && m.homeTeam.id === teamId) === homeWon ? "W" : "L";
}

function formFor(finished, teamId, n = 5) {
  if (teamId == null) return [];
  return (finished || [])
    .filter(m => m.status === "FINISHED" && m.homeTeam && m.awayTeam && (m.homeTeam.id === teamId || m.awayTeam.id === teamId))
    .sort((a, b) => Date.parse(b.utcDate) - Date.parse(a.utcDate))     // newest first
    .map(m => outcomeFor(m, teamId))
    .filter(Boolean)
    .slice(0, n)
    .reverse();                                                       // oldest to newest
}

function formForMatch(m, finished, n = 5) {
  return { home: formFor(finished, m.homeTeam && m.homeTeam.id, n), away: formFor(finished, m.awayTeam && m.awayTeam.id, n) };
}

module.exports = { outcomeFor, formFor, formForMatch };
