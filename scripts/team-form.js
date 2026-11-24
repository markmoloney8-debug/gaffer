// Team form for picking: league position, record, last 5, and home / away records, worked out from the
// season's finished matches. Run by .github/workflows/team-form.yml. One football-data.org call, one Supabase write.
const { outcomeFor } = require("./form.js");

const teamName = t => ((t && (t.shortName || t.name)) || "TBC").slice(0, 20);   // same naming as fetch-fixtures.js and lms.js
const blank = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, res: [] });

function ninety(m) {
  const s = m.score || {};
  const x = s.regularTime || s.fullTime || {};
  return x.home == null || x.away == null ? null : x;
}

// finished: football-data matches. Returns rows for the team_form table, best position first.
function buildTeamForm(finished) {
  const teams = new Map();
  const get = m => {
    const id = m.id;
    if (!teams.has(id)) teams.set(id, { team: teamName(m), tid: id, all: blank(), home: blank(), away: blank() });
    return teams.get(id);
  };
  const list = (finished || []).filter(m => m.status === "FINISHED" && m.homeTeam && m.awayTeam && ninety(m))
    .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));            // oldest first, so res[] ends with the newest
  for (const m of list) {
    const sc = ninety(m);
    for (const [side, t, gf, ga] of [["home", m.homeTeam, sc.home, sc.away], ["away", m.awayTeam, sc.away, sc.home]]) {
      const row = get(t), o = outcomeFor(m, t.id);
      for (const b of [row.all, row[side]]) {
        b.p++; b.gf += gf; b.ga += ga; b.res.push(o);
        if (o === "W") b.w++; else if (o === "D") b.d++; else b.l++;
      }
    }
  }
  const out = [...teams.values()].map(t => ({
    team: t.team, played: t.all.p, won: t.all.w, drawn: t.all.d, lost: t.all.l, gf: t.all.gf, ga: t.all.ga,
    points: t.all.w * 3 + t.all.d, last5: t.all.res.slice(-5).join(""),
    home: { p: t.home.p, w: t.home.w, d: t.home.d, l: t.home.l, gf: t.home.gf, ga: t.home.ga, last5: t.home.res.slice(-5).join("") },
    away: { p: t.away.p, w: t.away.w, d: t.away.d, l: t.away.l, gf: t.away.gf, ga: t.away.ga, last5: t.away.res.slice(-5).join("") },
  }));
  out.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.team.localeCompare(b.team));
  out.forEach((r, i) => { r.position = i + 1; });
  return out;
}

async function main(env = process.env, fetchFn = fetch, log = console.log) {
  const TOKEN = env.FOOTBALL_DATA_TOKEN, URL = env.SB_URL, KEY = env.SB_KEY;
  if (!TOKEN || !URL || !KEY) throw new Error("Missing FOOTBALL_DATA_TOKEN, SB_URL or SB_KEY");
  const res = await fetchFn("https://api.football-data.org/v4/competitions/PL/matches?status=FINISHED", { headers: { "X-Auth-Token": TOKEN } });
  if (!res.ok) throw new Error(`football-data.org error ${res.status}: ${await res.text()}`);
  const rows = buildTeamForm((await res.json()).matches || []);
  if (!rows.length) { log("No finished matches yet; nothing to write."); return { written: 0 }; }
  const AUTHZ = String(KEY).startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` };
  const w = await fetchFn(`${URL}/rest/v1/team_form?on_conflict=team`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, ...AUTHZ, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows.map(r => ({ ...r, updated_at: new Date().toISOString() }))),
  });
  if (!w.ok) throw new Error(`Supabase write failed ${w.status}: ${await w.text()}`);
  log(`Wrote form for ${rows.length} teams. Top: ${rows.slice(0, 3).map(r => `${r.position}. ${r.team} ${r.points}pts ${r.last5}`).join(", ")}`);
  return { written: rows.length };
}

module.exports = { buildTeamForm, teamName, main };
if (require.main === module) main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
