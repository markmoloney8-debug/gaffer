// fetch-fixtures.js
// Run weekly by GitHub Actions (see .github/workflows/fetch-fixtures.yml).
// Picks 5 random upcoming matches from football-data.org and saves them to Supabase
// as the new round. No Anthropic key needed. Requires Node 18+.
//
// NOTE: running this replaces the current round and clears all entries.

// Settings come from environment variables (GitHub Actions) or, failing that, config.js (local runs).
let cfg = {};
try { cfg = require("./config.js"); } catch (e) { /* no local config: rely on env vars */ }
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || cfg.FOOTBALL_DATA_TOKEN;
const SB_URL = process.env.SB_URL || cfg.SB_URL;
const SB_KEY = process.env.SB_KEY || cfg.SB_KEY;
function requireConfig() {
  if (!FOOTBALL_DATA_TOKEN || !SB_URL || !SB_KEY) { console.error("ERROR: missing FOOTBALL_DATA_TOKEN / SB_URL / SB_KEY"); process.exit(1); }
}

const FD_BASE = "https://api.football-data.org/v4";
const HOUR = 3600 * 1000;
const DAY  = 24 * HOUR;

// Default competition used when no tournament is running.
const DEFAULT_COMP = {
  code: "PL", id: "epl", name: "Premier League",
  flag: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  windowDays: 7,
};

// Tournaments take over from the league while they are running.
// (The 2026 World Cup has finished, so this is dormant until you add another.)
const TOURNAMENTS = [
  { code: "WC", id: "world_cup_2026", name: "2026 FIFA World Cup", flag: "\u{1F30D}",
    start: "2026-06-05", end: "2026-07-19", windowDays: 5 },
];

const isoDate    = ms => new Date(ms).toISOString().slice(0, 10);
const londonDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const { formForMatch } = require("./form.js");
const teamName   = t => (t.shortName || t.name || "TBC").slice(0, 20);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


// ── Pure helpers (unit tested) ────────────────────────────────────────────────

// Matches that can go in the round: not started, teams known, kicking off inside the window.
function pickCandidates(matches, now, cutoff) {
  return matches.filter(m => {
    const ko = Date.parse(m.utcDate);
    return ["SCHEDULED", "TIMED"].includes(m.status)
        && m.homeTeam?.id && m.awayTeam?.id
        && ko > now + 5 * 60 * 1000
        && ko <= cutoff;
  });
}

function toFixture(m, finished) {
  const ko = new Date(m.utcDate);
  const fx = {
    matchId:    m.id,
    home:       teamName(m.homeTeam),
    away:       teamName(m.awayTeam),
    date:       londonDate.format(ko).replace(",", ""),
    time:       londonTime.format(ko),
    kickoffIso: m.utcDate,
    kickoffTs:  ko.getTime(),
  };
  if (finished) fx.form = formForMatch(m, finished);
  return fx;
}

// A round is still running until 3 hours after its last kick-off. Weekly runs leave a running round
// alone (this matters in international breaks, when a round can span more than a week).
// A postponed match does not hold things up: its original kick-off time still passes.
function roundStillRunning(round, now) {
  if (!round || round.mock_results) return false;
  const times = (round.fixtures || []).map(f => f.kickoffTs).filter(Boolean);
  if (!times.length) return false;
  return now < Math.max(...times) + 3 * HOUR;
}

// Scores last round's entries for the history table. A group with a perfect entry has a winner.
function buildArchive(prev, subs, seriesOf) {
  const results = Array.isArray(prev.results) ? prev.results : [];
  const hit = (s, r, i) => r.result === "void" || (s.preds || {})[i] === r.result || (s.preds || {})[String(i)] === r.result;
  const allFinal = results.length === (prev.fixtures || []).length && results.every(r => r.result !== "upcoming");
  const rows = [];
  const winningGroups = new Set();
  for (const s of subs) {
    if (!s.group_id) continue;
    let correct = 0, total = 0;
    results.forEach((r, i) => { if (r.result === "upcoming") return; total++; if (hit(s, r, i)) correct++; });
    const perfect = allFinal && results.every((r, i) => hit(s, r, i));
    if (perfect) winningGroups.add(s.group_id);
    rows.push({
      group_id: s.group_id, series: seriesOf(s.group_id), week: prev.week || 1,
      username: s.username, entry_name: s.entry_name, preds: s.preds, correct, total, perfect,
    });
  }
  return { rows, winningGroups, allFinal };
}

async function fdGet(path) {
  const res = await fetch(`${FD_BASE}${path}`, { headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN } });
  if (res.status === 429) throw new Error("football-data.org rate limit hit (10 calls/min). Try again in a minute.");
  if (res.status === 401 || res.status === 403) {
    throw new Error(`football-data.org rejected the request (${res.status}). Check the token in config.js. ${await res.text()}`);
  }
  if (!res.ok) throw new Error(`football-data.org error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sb(method, path, body, prefer) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      ...(prefer ? { "Prefer": prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  requireConfig();
  const rounds = await sb("GET", "round?id=eq.1");
  if (rounds.length && roundStillRunning(rounds[0], Date.now()) && !process.env.FORCE) {
    console.log(`Week ${rounds[0].week} is still running (its last match hasn't finished yet). Leaving it alone.`);
    return;
  }

  const now  = Date.now();
  const comp = TOURNAMENTS.find(t => isoDate(now) >= t.start && isoDate(now) <= t.end) || DEFAULT_COMP;
  console.log(`[${new Date(now).toISOString()}] Competition: ${comp.name}`);

  // Look in the normal window first; if there are fewer than 5 matches (international
  // break, rest days) look twice as far ahead.
  let candidates = [];
  for (const days of [comp.windowDays, comp.windowDays * 2]) {
    // The last kick-off must be 3h+ before the next weekly run so the round has finished by then.
    const cutoff = now + days * DAY - 3 * HOUR;
    const data = await fdGet(`/competitions/${comp.code}/matches?dateFrom=${isoDate(now)}&dateTo=${isoDate(now + (days + 1) * DAY)}`);
    candidates = pickCandidates(data.matches || [], now, cutoff);
    console.log(`Found ${candidates.length} match(es) in the next ${days} days.`);
    if (candidates.length >= 5) break;
  }
  if (candidates.length < 5) {
    throw new Error("Fewer than 5 upcoming matches found. The existing round has been left untouched.");
  }

  // Recent form is a nice extra. If this lookup fails, the round is still created without it.
  let finished = null;
  try {
    finished = (await fdGet(`/competitions/${comp.code}/matches?status=FINISHED`)).matches || [];
    console.log(`Loaded ${finished.length} finished match(es) for recent form.`);
  } catch (e) { console.log(`WARNING: could not load recent form (${e.message}). Continuing without it.`); }

  const fixtures = shuffle(candidates)
    .slice(0, 5)
    .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
    .map(m => toFixture(m, finished));

  console.log("Fixtures picked:");
  fixtures.forEach((f, i) => console.log(`  ${i + 1}. ${f.home} vs ${f.away} - ${f.date} ${f.time}`));

  const week   = rounds.length ? (rounds[0].week || 1) + 1 : 1;

  // Archive last round's entries (with scores), per group, so "The Story So Far" keeps a running total.
  // A group whose entries include a perfect score has a winner, so it starts a new run.
  const groups = await sb("GET", "groups?select=id");
  const states = await sb("GET", "group_state?select=group_id,series");
  const seriesOf = id => ((states.find(s => s.group_id === id) || {}).series) || 1;
  const newSeries = new Map(groups.map(g => [g.id, seriesOf(g.id)]));

  if (rounds.length && !rounds[0].mock_results) {
    const prev = rounds[0];
    const subs = await sb("GET", "submissions?select=username,entry_name,preds,group_id");
    if (subs.length) {
      const { rows, winningGroups, allFinal } = buildArchive(prev, subs, seriesOf);
      if (!allFinal) console.log("WARNING: last round's results were not all final. Archiving entries with the results that were available.");
      console.log(`Archiving ${rows.length} entr${rows.length === 1 ? "y" : "ies"} from Week ${prev.week || 1}...`);
      if (rows.length) await sb("POST", "history", rows, "return=minimal");
      for (const gid of winningGroups) { newSeries.set(gid, seriesOf(gid) + 1); console.log(`Group ${gid} had a winner: starting a new run.`); }
    }
  }

  console.log("Clearing old submissions...");
  await sb("DELETE", "submissions?submitted_at=gte.1970-01-01", null, "return=minimal");

  console.log(`Writing Week ${week} to Supabase...`);
  await sb("POST", "round", {
    id:            1,
    league:        { id: comp.id, name: comp.name, flag: comp.flag, code: comp.code },
    fixtures,
    mock_results:  null,
    results:       null,
    week,
    locked:        false,
    winners_found: false,
  }, "resolution=merge-duplicates,return=minimal");

  for (const g of groups) {
    await sb("POST", "group_state", { group_id: g.id, series: newSeries.get(g.id), winners_found: false },
      "resolution=merge-duplicates,return=minimal");
  }

  console.log(`Done. Week ${week} is live. Entries close 1 minute before the first kick-off.`);
}

module.exports = { pickCandidates, toFixture, buildArchive, roundStillRunning, shuffle };

if (require.main === module) {
  main().catch(err => {
    console.error("ERROR:", err.message);
    process.exit(1);
  });
}
