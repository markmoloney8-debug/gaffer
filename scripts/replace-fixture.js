// replace-fixture.js
// Replaces ONE fixture in the current round (e.g. after a postponement) with a random
// upcoming match from the same competition. Players' picks for that slot are cleared, and
// they re-pick it from the Lobby until 1 minute before the new match kicks off.
//
// Usage:   node replace-fixture.js 3        (3 = the match number shown in the app)
//          node replace-fixture.js 3 --force (replace even if that match already has a result)
// Requires Node 18+.

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
const isoDate    = ms => new Date(ms).toISOString().slice(0, 10);
const londonDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const teamName   = t => (t.shortName || t.name || "TBC").slice(0, 20);

async function fdGet(path) {
  const res = await fetch(`${FD_BASE}${path}`, { headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN } });
  if (res.status === 429) throw new Error("football-data.org rate limit hit (10 calls/min). Try again in a minute.");
  if (!res.ok) throw new Error(`football-data.org error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sb(method, path, body, prefer) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`,
      ...(prefer ? { "Prefer": prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Next Tuesday 07:00 (UTC), the time the next round is generated.
function nextRoundTime(now) {
  const d = new Date(now);
  d.setUTCHours(7, 0, 0, 0);
  while (d.getUTCDay() !== 2 || d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

async function main() {
  const slotArg = parseInt(process.argv[2], 10);
  const force = process.argv.includes("--force");
  if (!(slotArg >= 1 && slotArg <= 5)) throw new Error("Usage: node replace-fixture.js <match number 1-5>");
  const slot = slotArg - 1;

  const rounds = await sb("GET", "round?id=eq.1");
  if (!rounds.length) throw new Error("No active round.");
  const round = rounds[0];
  if (round.mock_results) throw new Error("This is a test-mode round. Nothing to replace.");
  const fixtures = round.fixtures || [];
  const code = round.league && round.league.code;
  if (!code) throw new Error("Round has no competition code.");
  if (!fixtures[slot]) throw new Error(`There is no match #${slotArg}.`);

  const prev = Array.isArray(round.results) ? round.results : [];
  if (prev[slot] && ["home", "away", "draw"].includes(prev[slot].result) && !force) {
    throw new Error(`Match #${slotArg} already has a result (${prev[slot].score}). Use --force if you really want to replace it.`);
  }

  const now = Date.now();
  const cutoff = nextRoundTime(now) - 3 * HOUR;
  const data = await fdGet(`/competitions/${code}/matches?dateFrom=${isoDate(now)}&dateTo=${isoDate(cutoff + DAY)}`);
  const used = new Set(fixtures.map(f => f.matchId));
  const candidates = (data.matches || []).filter(m => {
    const ko = Date.parse(m.utcDate);
    return ["SCHEDULED", "TIMED"].includes(m.status)
        && m.homeTeam?.id && m.awayTeam?.id
        && !used.has(m.id)
        && ko > now + 2 * HOUR          // leaves time for players to re-pick
        && ko <= cutoff;
  });
  console.log(`Found ${candidates.length} possible replacement(s).`);
  if (!candidates.length) throw new Error("No suitable replacement match found. Use Void in the admin panel instead.");

  const m = candidates[Math.floor(Math.random() * candidates.length)];
  const ko = new Date(m.utcDate);
  const old = fixtures[slot];
  fixtures[slot] = {
    matchId: m.id, home: teamName(m.homeTeam), away: teamName(m.awayTeam),
    date: londonDate.format(ko).replace(",", ""), time: londonTime.format(ko),
    kickoffIso: m.utcDate, kickoffTs: ko.getTime(), replaced: true,
  };

  const patch = { fixtures };
  if (prev.length === fixtures.length) {
    const results = prev.map(r => ({ ...r }));
    results[slot] = { result: "upcoming", score: null };
    patch.results = results;
  }
  await sb("PATCH", "round?id=eq.1", patch, "return=minimal");

  // Clear everyone's pick for this slot so they can re-pick.
  const subs = await sb("GET", "submissions?select=id,preds");
  let cleared = 0;
  for (const s of subs) {
    const preds = { ...(s.preds || {}) };
    delete preds[String(slot)];
    delete preds[slot];
    await sb("PATCH", `submissions?id=eq.${s.id}`, { preds }, "return=minimal");
    cleared++;
  }

  console.log(`Replaced #${slotArg}: ${old.home} vs ${old.away}  ->  ${fixtures[slot].home} vs ${fixtures[slot].away} (${fixtures[slot].date} ${fixtures[slot].time})`);
  console.log(`Cleared the pick for that match on ${cleared} entr${cleared === 1 ? "y" : "ies"}. Players can re-pick from the Lobby until 1 minute before kick-off.`);
}

main().catch(err => { console.error("ERROR:", err.message); process.exit(1); });
