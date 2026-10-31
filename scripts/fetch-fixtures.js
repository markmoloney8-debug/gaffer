// fetch-fixtures.js
// Run every Monday at 7am (Windows Task Scheduler -> fetch-fixtures.bat).
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
if (!FOOTBALL_DATA_TOKEN || !SB_URL || !SB_KEY) { console.error("ERROR: missing FOOTBALL_DATA_TOKEN / SB_URL / SB_KEY"); process.exit(1); }

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
const teamName   = t => (t.shortName || t.name || "TBC").slice(0, 20);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    candidates = (data.matches || []).filter(m => {
      const ko = Date.parse(m.utcDate);
      return ["SCHEDULED", "TIMED"].includes(m.status)
          && m.homeTeam?.id && m.awayTeam?.id
          && ko > now + 5 * 60 * 1000
          && ko <= cutoff;
    });
    console.log(`Found ${candidates.length} match(es) in the next ${days} days.`);
    if (candidates.length >= 5) break;
  }
  if (candidates.length < 5) {
    throw new Error("Fewer than 5 upcoming matches found. The existing round has been left untouched.");
  }

  const fixtures = shuffle(candidates)
    .slice(0, 5)
    .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
    .map(m => {
      const ko = new Date(m.utcDate);
      return {
        matchId:    m.id,
        home:       teamName(m.homeTeam),
        away:       teamName(m.awayTeam),
        date:       londonDate.format(ko).replace(",", ""),
        time:       londonTime.format(ko),
        kickoffIso: m.utcDate,
        kickoffTs:  ko.getTime(),
      };
    });

  console.log("Fixtures picked:");
  fixtures.forEach((f, i) => console.log(`  ${i + 1}. ${f.home} vs ${f.away} - ${f.date} ${f.time}`));

  const rounds = await sb("GET", "round?id=eq.1");
  const week   = rounds.length ? (rounds[0].week || 1) + 1 : 1;

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

  console.log(`Done. Week ${week} is live. Entries close 1 minute before the first kick-off.`);
}

main().catch(err => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
