// lms.js: keeps Last Man Standing (LMS) gameweeks up to date.
// Run every couple of hours from GitHub Actions (.github/workflows/lms.yml).
// Requires Node 18+. Add --dry-run (or DRY_RUN=1) to log what it WOULD write without changing anything.
//
// Each run:
//   a. Takes the latest lms_gameweeks row. If it is 'open', refreshes its fixtures from football-data.org,
//      re-works the pick deadline while it is still in the future, and once the deadline has passed and
//      every fixture has a result, calls lms_settle(id). The database does the knock-outs.
//   b. If there are no rows, or the latest is 'settled', adds the next Premier League matchday that has
//      not started yet (all of its fixtures; the deadline is the first kick-off minus 60 seconds).
// It is safe to run again and again: gameweeks are upserted on (season, matchday), and a settled
// gameweek is never settled twice.

let cfg = {};
try { cfg = require("./config.js"); } catch (e) { /* no local config: rely on env vars */ }

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const DEADLINE_LEAD = 60 * 1000;       // picks lock 60s before the first kick-off
const OVER_AFTER = 115 * MIN;          // a match is surely finished this long after kick-off
const RESCHEDULE_LIMIT = 4 * DAY;      // moved more than this after the round's first game = postponed
const FD_BASE = "https://api.football-data.org/v4";

const londonDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const teamName = t => ((t && (t.shortName || t.name)) || "TBC").slice(0, 20);   // same naming as fetch-fixtures.js

// ── pure helpers (unit tested) ──────────────────────────────────────────────

// 90-minute result of a finished match: 'home' | 'away' | 'draw' (null if there is no score yet).
function resultOf(m) {
  const s = m.score || {};
  const ninety = s.regularTime || s.fullTime || {};      // regularTime only exists after extra time
  const h = ninety.home, a = ninety.away;
  if (h == null || a == null) return null;
  return h > a ? "home" : h < a ? "away" : "draw";
}

function fixtureFromMatch(m, now) {
  const ko = Date.parse(m.utcDate);
  const f = {
    matchId: m.id, home: teamName(m.homeTeam), away: teamName(m.awayTeam),
    kickoffTs: ko, kickoffIso: m.utcDate,
    date: londonDate.format(ko).replace(",", ""), time: londonTime.format(ko),
  };
  if (["POSTPONED", "CANCELLED", "SUSPENDED"].includes(m.status)) { f.result = "postponed"; f.postponedAt = now; }
  return f;
}

// Season label such as '2026-27' from a football-data match's season object.
function seasonLabel(match) {
  const y = new Date(match.season.startDate).getUTCFullYear();
  return `${y}-${String(y + 1).slice(2)}`;
}

const firstKickoff = fixtures => {
  const live = fixtures.filter(f => f.result !== "postponed");
  return live.length ? Math.min(...live.map(f => f.kickoffTs)) : null;
};
const deadlineFor = fixtures => { const k = firstKickoff(fixtures); return k == null ? null : new Date(k - DEADLINE_LEAD).toISOString(); };

// Brings a stored fixture list up to date with football-data.org. Returns the new list and whether anything changed.
function refreshFixtures(fixtures, byId, now, log = () => {}) {
  const roundFirst = firstKickoff(fixtures) ?? Math.min(...fixtures.map(f => f.kickoffTs));
  let changed = false;
  const next = fixtures.map(f => {
    const m = byId.get(f.matchId);
    if (!m) { log(`  WARNING: ${f.home} vs ${f.away} not found in football-data.org response.`); return f; }
    const ko = Date.parse(m.utcDate);
    const postponed = ["POSTPONED", "CANCELLED", "SUSPENDED"].includes(m.status)
      || (Number.isFinite(ko) && ko > roundFirst + RESCHEDULE_LIMIT);
    let n = { ...f };
    if (postponed) {
      n.result = "postponed";
      if (!n.postponedAt) n.postponedAt = now;
    } else {
      if (n.result === "postponed") delete n.result;          // it is back inside the round
      if (Number.isFinite(ko) && ko !== n.kickoffTs) {         // moved a little: keep the times right
        n.kickoffTs = ko; n.kickoffIso = m.utcDate;
        n.date = londonDate.format(ko).replace(",", ""); n.time = londonTime.format(ko);
      }
      if (m.status === "FINISHED") { const r = resultOf(m); if (r) n.result = r; }
    }
    if (JSON.stringify(n) !== JSON.stringify(f)) changed = true;
    return n;
  });
  return { fixtures: next, changed };
}

const allResultsIn = fixtures => fixtures.length > 0 && fixtures.every(f => ["home", "away", "draw", "postponed"].includes(f.result));

// The next matchday to open: the lowest matchday after `lastMatchday` whose first game hasn't started yet.
function nextMatchday(matches, lastMatchday, now) {
  const byDay = new Map();
  for (const m of matches) {
    if (!m.matchday || !m.homeTeam || !m.awayTeam || !m.homeTeam.id || !m.awayTeam.id) continue;
    if (!byDay.has(m.matchday)) byDay.set(m.matchday, []);
    byDay.get(m.matchday).push(m);
  }
  const days = [...byDay.keys()].filter(d => d > (lastMatchday || 0)).sort((a, b) => a - b);
  for (const d of days) {
    const list = byDay.get(d);
    const live = list.filter(m => !["POSTPONED", "CANCELLED", "SUSPENDED"].includes(m.status));
    if (!live.length) continue;                                  // nothing to play yet
    const first = Math.min(...live.map(m => Date.parse(m.utcDate)));
    if (first - DEADLINE_LEAD <= now) continue;                  // already started (or about to): too late to enter
    const fixtures = list.map(m => fixtureFromMatch(m, now)).sort((a, b) => a.kickoffTs - b.kickoffTs || a.home.localeCompare(b.home));
    return { matchday: d, season: seasonLabel(list[0]), fixtures, deadline: deadlineFor(fixtures) };
  }
  return null;
}

// ── I/O ─────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeRunner({ env = process.env, fetchFn = fetch, now = Date.now(), dryRun = false, log = console.log, sleepFn = sleep } = {}) {
  const TOKEN = env.FOOTBALL_DATA_TOKEN || cfg.FOOTBALL_DATA_TOKEN;
  const SB_URL = env.SB_URL || cfg.SB_URL;
  const SB_KEY = env.SB_KEY || cfg.SB_KEY;
  const AUTHZ = String(SB_KEY || "").startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` };

  async function fdGet(path) {
    const res = await fetchFn(`${FD_BASE}${path}`, { headers: { "X-Auth-Token": TOKEN } });
    if (res.status === 429) throw new Error("football-data.org rate limit hit (10 calls/min). Try again in a minute.");
    if (res.status === 401 || res.status === 403) throw new Error(`football-data.org rejected the request (${res.status}). Check the token. ${await res.text()}`);
    if (!res.ok) throw new Error(`football-data.org error ${res.status}: ${await res.text()}`);
    return res.json();
  }
  async function sb(method, path, body, prefer) {
    const res = await fetchFn(`${SB_URL}/rest/v1/${path}`, {
      method, headers: { "Content-Type": "application/json", apikey: SB_KEY, ...AUTHZ, ...(prefer ? { Prefer: prefer } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async function rpc(fn, args) {
    const res = await fetchFn(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY, ...AUTHZ }, body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Supabase rpc ${fn} -> ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function run() {
    if (!TOKEN || !SB_URL || !SB_KEY) throw new Error("missing FOOTBALL_DATA_TOKEN / SB_URL / SB_KEY");
    log(`[${new Date(now).toISOString()}] LMS check${dryRun ? " (DRY RUN: nothing will be written)" : ""}`);

    const latestRows = await sb("GET", "lms_gameweeks?select=*&order=id.desc&limit=1");
    const latest = latestRows[0];

    // a. Keep the open gameweek current, and settle it when it is done.
    if (latest && latest.status === "open") {
      const fixtures = latest.fixtures || [];
      const first = Math.min(...fixtures.map(f => f.kickoffTs));
      const data = await fdGet(`/competitions/PL/matches?dateFrom=${new Date(first - DAY).toISOString().slice(0, 10)}&dateTo=${new Date(first + 10 * DAY).toISOString().slice(0, 10)}`);
      const byId = new Map((data.matches || []).map(m => [m.id, m]));

      // The list request can lag behind. For any match that should be over by now but isn't marked finished,
      // ask for that one match directly, which is more up to date. (The free plan allows 10 calls a minute.)
      const overdue = fixtures.filter(f => !f.result && f.kickoffTs + OVER_AFTER < now && (!byId.get(f.matchId) || byId.get(f.matchId).status !== "FINISHED"));
      for (const f of overdue) {
        try {
          const one = await fdGet(`/matches/${f.matchId}`);
          if (one && one.id) { log(`  ${f.home} vs ${f.away}: list said ${byId.get(f.matchId) ? byId.get(f.matchId).status : "missing"}, direct lookup says ${one.status}`); byId.set(f.matchId, one); }
        } catch (e) { log(`  ${f.home} vs ${f.away}: direct lookup failed (${e.message})`); }
        await sleepFn(7000);
      }

      const { fixtures: fresh, changed } = refreshFixtures(fixtures, byId, now, log);
      fresh.forEach(f => { const m = byId.get(f.matchId); log(`  ${f.home} vs ${f.away}: ${f.result || "not final yet"}${m ? ` (feed: ${m.status})` : ""}`); });

      const deadlinePassed = now >= Date.parse(latest.deadline);
      const patch = {};
      if (changed) patch.fixtures = fresh;
      if (!deadlinePassed) {
        const d = deadlineFor(fresh);
        if (d && Date.parse(d) !== Date.parse(latest.deadline)) patch.deadline = d;
      }
      if (Object.keys(patch).length) {
        log(`  ${dryRun ? "WOULD update" : "Updating"} matchday ${latest.matchday}: ${Object.keys(patch).join(", ")}${patch.deadline ? ` (new deadline ${patch.deadline})` : ""}`);
        if (!dryRun) await sb("PATCH", `lms_gameweeks?id=eq.${latest.id}`, patch, "return=minimal");
      } else log("  No changes.");

      const nowDeadlinePassed = now >= Date.parse(patch.deadline || latest.deadline);
      if (nowDeadlinePassed && allResultsIn(fresh)) {
        if (dryRun) log(`  WOULD settle matchday ${latest.matchday} (lms_settle(${latest.id}))`);
        else {
          const summary = await rpc("lms_settle", { p_gw: latest.id });
          log(`  Settled matchday ${latest.matchday}: ${JSON.stringify(summary)}`);
        }
      } else if (nowDeadlinePassed) {
        log(`  Deadline has passed; waiting for ${fresh.filter(f => !["home", "away", "draw", "postponed"].includes(f.result)).length} result(s).`);
      } else {
        log(`  Open for picks until ${patch.deadline || latest.deadline}.`);
      }
      return { action: "refreshed", gameweek: latest.id };
    }

    // b. Nothing open: add the next matchday that hasn't started.
    const data = await fdGet("/competitions/PL/matches");
    const matches = data.matches || [];
    const sameSeasonLast = latest && matches.length && seasonLabel(matches[0]) === latest.season ? latest.matchday : 0;
    const next = nextMatchday(matches, sameSeasonLast, now);
    if (!next) { log("No upcoming matchday to add yet."); return { action: "none" }; }
    log(`  ${dryRun ? "WOULD add" : "Adding"} ${next.season} matchday ${next.matchday}: ${next.fixtures.length} fixtures, deadline ${next.deadline}`);
    next.fixtures.forEach(f => log(`    ${f.date} ${f.time}  ${f.home} vs ${f.away}${f.result ? ` [${f.result}]` : ""}`));
    if (!dryRun) {
      await sb("POST", "lms_gameweeks?on_conflict=season,matchday",
        { season: next.season, matchday: next.matchday, fixtures: next.fixtures, deadline: next.deadline, status: "open" },
        "resolution=ignore-duplicates,return=minimal");
    }
    return { action: "added", matchday: next.matchday };
  }
  return { run };
}

module.exports = { resultOf, fixtureFromMatch, seasonLabel, firstKickoff, deadlineFor, refreshFixtures, allResultsIn, nextMatchday, makeRunner };

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  makeRunner({ dryRun }).run().catch(err => { console.error("ERROR:", err.message); process.exit(1); });
}
