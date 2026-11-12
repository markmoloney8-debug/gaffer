// update-results.js
// Run hourly (Windows Task Scheduler -> update-results.bat).
// Looks up the final scores for the current round on football-data.org and saves them to
// Supabase, so the app's "Check Results & Reveal" button can read them. No Anthropic key needed.
// Requires Node 18+.
//
// A result is the score after 90 minutes. Extra time and penalties are ignored, so a
// knockout match that goes to penalties counts as a draw.

// Settings come from environment variables (GitHub Actions) or, failing that, config.js (local runs).
let cfg = {};
try { cfg = require("./config.js"); } catch (e) { /* no local config: rely on env vars */ }
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || cfg.FOOTBALL_DATA_TOKEN;
const SB_URL = process.env.SB_URL || cfg.SB_URL;
const SB_KEY = process.env.SB_KEY || cfg.SB_KEY;
// New-style secret keys (sb_secret_...) go in apikey only; older JWT keys also need the Authorization header.
const AUTHZ = String(SB_KEY || "").startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` };
function requireConfig() {
  if (!FOOTBALL_DATA_TOKEN || !SB_URL || !SB_KEY) { console.error("ERROR: missing FOOTBALL_DATA_TOKEN / SB_URL / SB_KEY"); process.exit(1); }
}

const FD_BASE = "https://api.football-data.org/v4";
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const isoDate = ms => new Date(ms).toISOString().slice(0, 10);

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
      ...AUTHZ,
      ...(prefer ? { "Prefer": prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function resultFor(m, label, log = console.log) {
  if (m.status !== "FINISHED") {
    if (["POSTPONED", "CANCELLED", "SUSPENDED"].includes(m.status)) {
      log(`  WARNING: ${label} is ${m.status}. It stays "upcoming" until it is played.`);
    }
    return { result: "upcoming", score: null };
  }
  const s = m.score || {};
  const ninety = s.regularTime || s.fullTime || {};   // regularTime only exists if the match went to extra time
  const h = ninety.home, a = ninety.away;
  if (h == null || a == null) return { result: "upcoming", score: null };
  return { result: h > a ? "home" : h < a ? "away" : "draw", score: `${h}-${a}` };
}


// Maps each fixture to its result. Voided fixtures keep their void; unknown matches stay "upcoming".
function mapResults(fixtures, prevResults, byId, log = console.log) {
  const prev = Array.isArray(prevResults) ? prevResults : [];
  return fixtures.map((f, i) => {
    if (prev[i] && prev[i].result === "void") return prev[i];
    const label = `${f.home} vs ${f.away}`;
    const m = byId.get(f.matchId);
    if (!m) { log(`  WARNING: ${label} not found in football-data.org response.`); return { result: "upcoming", score: null }; }
    return resultFor(m, label, log);
  });
}

async function main() {
  requireConfig();
  console.log(`[${new Date().toISOString()}] Checking results...`);

  const rounds = await sb("GET", "round?id=eq.1");
  if (!rounds.length) { console.log("No active round."); return; }
  const round = rounds[0];

  if (round.mock_results) { console.log("Test-mode round (mock results). Nothing to do."); return; }

  const fixtures = round.fixtures || [];
  if (!fixtures.length || fixtures.some(f => !f.matchId)) {
    console.log("This round has no match ids (it wasn't created by the new fetch-fixtures.js). Nothing to do.");
    return;
  }
  const code = round.league && round.league.code;
  if (!code) { console.log("Round has no competition code. Nothing to do."); return; }

  const existing = round.results;
  if (Array.isArray(existing) && existing.length === fixtures.length && existing.every(r => r.result !== "upcoming")) {
    console.log("All results already recorded.");
    return;
  }

  const kickoffs = fixtures.map(f => f.kickoffTs);
  const first = Math.min(...kickoffs);
  const last  = Math.max(...kickoffs);
  if (Date.now() < first + 100 * MIN) {
    console.log("The first match hasn't finished yet. Nothing to check.");
    return;
  }

  const data = await fdGet(`/competitions/${code}/matches?dateFrom=${isoDate(first - DAY)}&dateTo=${isoDate(last + 2 * DAY)}`);
  const byId = new Map((data.matches || []).map(m => [m.id, m]));

  const results = mapResults(fixtures, round.results, byId);

  results.forEach((r, i) => {
    const f = fixtures[i];
    console.log(`  ${i + 1}. ${f.home} vs ${f.away}: ${r.result === "upcoming" ? "not final yet" : r.result === "void" ? "VOID" : `${r.score} (${r.result})`}`);
  });

  await sb("PATCH", "round?id=eq.1", { results }, "return=minimal");

  const done = results.filter(r => r.result !== "upcoming").length;
  console.log(`Saved. ${done}/${results.length} results are final.`);
}

module.exports = { resultFor, mapResults };

if (require.main === module) {
  main().catch(err => {
    console.error("ERROR:", err.message);
    process.exit(1);
  });
}
