const test = require("node:test");
const assert = require("node:assert/strict");
const lms = require("../../scripts/lms.js");

const H = 3600e3, DAY = 24 * H;
const NOW = Date.UTC(2026, 10, 3, 7, 0, 0);
const season = { startDate: "2026-08-01", endDate: "2027-05-30" };
const m = (id, md, offH, extra = {}) => ({
  id, matchday: md, season, utcDate: new Date(NOW + offH * H).toISOString(), status: "TIMED",
  homeTeam: { id: id * 2, shortName: "H" + id }, awayTeam: { id: id * 2 + 1, shortName: "A" + id }, ...extra,
});
const fx = (id, offH, extra = {}) => ({ matchId: id, home: "H" + id, away: "A" + id, kickoffTs: NOW + offH * H, kickoffIso: new Date(NOW + offH * H).toISOString(), date: "x", time: "y", ...extra });

test("resultOf uses 90 minutes", () => {
  assert.equal(lms.resultOf({ score: { fullTime: { home: 2, away: 1 } } }), "home");
  assert.equal(lms.resultOf({ score: { fullTime: { home: 1, away: 1 } } }), "draw");
  assert.equal(lms.resultOf({ score: { fullTime: { home: 3, away: 1 }, regularTime: { home: 0, away: 1 } } }), "away");
  assert.equal(lms.resultOf({ score: { fullTime: { home: null, away: null } } }), null);
});

test("seasonLabel", () => assert.equal(lms.seasonLabel(m(1, 1, 5)), "2026-27"));

test("nextMatchday picks first future matchday after the last one, deadline = first kick-off - 60s", () => {
  const all = [m(1, 9, -50), m(2, 10, 30), m(3, 10, 20), m(4, 11, 100)];
  const n = lms.nextMatchday(all, 9, NOW);
  assert.equal(n.matchday, 10);
  assert.equal(n.season, "2026-27");
  assert.equal(n.fixtures.length, 2);
  assert.equal(n.deadline, new Date(NOW + 20 * H - 60000).toISOString());
});

test("nextMatchday skips a matchday that has already started", () => {
  const all = [m(1, 10, -1), m(2, 10, 5), m(3, 11, 100)];
  assert.equal(lms.nextMatchday(all, 9, NOW).matchday, 11);
});

test("nextMatchday returns null when nothing is upcoming, and ignores TBC teams", () => {
  assert.equal(lms.nextMatchday([m(1, 10, -5)], 9, NOW), null);
  assert.equal(lms.nextMatchday([m(1, 10, 5, { homeTeam: {} })], 9, NOW), null);
});

test("postponed fixtures at creation are marked and excluded from the deadline", () => {
  const all = [m(1, 10, 10, { status: "POSTPONED" }), m(2, 10, 30)];
  const n = lms.nextMatchday(all, 9, NOW);
  assert.equal(n.fixtures.find(f => f.matchId === 1).result, "postponed");
  assert.equal(n.deadline, new Date(NOW + 30 * H - 60000).toISOString());
});

test("refreshFixtures: finished, postponed, rescheduled far away, back in window", () => {
  const stored = [fx(1, 10), fx(2, 10), fx(3, 12), fx(4, 12, { result: "postponed", postponedAt: 5 })];
  const byId = new Map([
    [1, m(1, 10, 10, { status: "FINISHED", score: { fullTime: { home: 1, away: 1 } } })],
    [2, m(2, 10, 10, { status: "POSTPONED" })],
    [3, m(3, 10, 12 + 5 * 24)],                       // moved 5 days later
    [4, m(4, 10, 12)],                                // restored
  ]);
  const { fixtures, changed } = lms.refreshFixtures(stored, byId, NOW);
  assert.equal(changed, true);
  assert.equal(fixtures[0].result, "draw");
  assert.equal(fixtures[1].result, "postponed"); assert.equal(fixtures[1].postponedAt, NOW);
  assert.equal(fixtures[2].result, "postponed");
  assert.equal(fixtures[3].result, undefined);
});

test("refreshFixtures keeps the first postponedAt and reports no change when nothing moved", () => {
  const stored = [fx(1, 10, { result: "postponed", postponedAt: 123 }), fx(2, 10)];
  const byId = new Map([[1, m(1, 10, 10, { status: "POSTPONED" })], [2, m(2, 10, 10)]]);
  const r = lms.refreshFixtures(stored, byId, NOW);
  assert.equal(r.fixtures[0].postponedAt, 123);
  assert.equal(r.changed, false);
});

test("allResultsIn", () => {
  assert.equal(lms.allResultsIn([fx(1, 1, { result: "home" }), fx(2, 1, { result: "postponed" })]), true);
  assert.equal(lms.allResultsIn([fx(1, 1, { result: "home" }), fx(2, 1)]), false);
});

// ── end to end with a fake fetch ────────────────────────────────────────────
function harness({ rows, matches, now = NOW, direct }) {
  const calls = [];
  const fetchFn = async (url, opt = {}) => {
    const method = opt.method || "GET";
    calls.push({ url, method, body: opt.body && JSON.parse(opt.body) });
    const ok = b => ({ ok: true, status: 200, text: async () => JSON.stringify(b), json: async () => b });
    if (/football-data.org\/v4\/matches\/\d+/.test(url)) { const one = (direct || {})[url.split("/").pop()]; return one ? ok(one) : { ok: false, status: 404, text: async () => "no" }; }
    if (url.includes("football-data.org")) return ok({ matches });
    if (url.includes("/rpc/lms_settle")) return ok({ settled: true });
    if (method === "GET") return ok(rows);
    return { ok: true, status: 204, text: async () => "", json: async () => null };
  };
  const logs = [];
  const run = dryRun => lms.makeRunner({ env: { FOOTBALL_DATA_TOKEN: "t", SB_URL: "http://sb", SB_KEY: "k" }, fetchFn, now, dryRun, log: s => logs.push(s), sleepFn: async () => {} }).run();
  return { calls, logs, run };
}

test("script: empty table -> inserts next matchday (dry run writes nothing)", async () => {
  const matches = [m(1, 10, 30), m(2, 10, 20)];
  const h = harness({ rows: [], matches });
  const r = await h.run(true);
  assert.equal(r.action, "added");
  assert.equal(h.calls.filter(c => c.method === "POST").length, 0);
  assert.ok(h.logs.some(l => l.includes("WOULD add")));
  const h2 = harness({ rows: [], matches });
  await h2.run(false);
  const post = h2.calls.find(c => c.method === "POST");
  assert.match(post.url, /on_conflict=season,matchday/);
  assert.equal(post.body.matchday, 10); assert.equal(post.body.fixtures.length, 2);
});

test("script: open gameweek past deadline with all results -> settles once", async () => {
  const past = NOW - 3 * H;
  const rows = [{ id: 7, season: "2026-27", matchday: 10, status: "open", deadline: new Date(past - 2 * DAY).toISOString(), fixtures: [fx(1, -50), fx(2, -50)] }];
  const matches = [m(1, 10, -50, { status: "FINISHED", score: { fullTime: { home: 2, away: 0 } } }), m(2, 10, -50, { status: "FINISHED", score: { fullTime: { home: 0, away: 0 } } })];
  const dry = harness({ rows, matches }); await dry.run(true);
  assert.ok(!dry.calls.some(c => c.url.includes("lms_settle")));
  const h = harness({ rows, matches }); await h.run(false);
  assert.ok(h.calls.some(c => c.url.includes("/rpc/lms_settle") && c.body.p_gw === 7));
  assert.ok(h.calls.some(c => c.method === "PATCH"));
});

test("script: open gameweek, deadline in future -> recomputes deadline, does not settle", async () => {
  const rows = [{ id: 8, season: "2026-27", matchday: 11, status: "open", deadline: new Date(NOW + 10 * H - 60000).toISOString(), fixtures: [fx(1, 10), fx(2, 20)] }];
  const matches = [m(1, 11, 10, { status: "POSTPONED" }), m(2, 11, 20)];
  const h = harness({ rows, matches }); await h.run(false);
  const patch = h.calls.find(c => c.method === "PATCH");
  assert.equal(patch.body.deadline, new Date(NOW + 20 * H - 60000).toISOString());
  assert.ok(!h.calls.some(c => c.url.includes("lms_settle")));
});

test("script: settled latest -> adds the following matchday, never re-settles", async () => {
  const rows = [{ id: 9, season: "2026-27", matchday: 10, status: "settled", deadline: "2026-11-01T00:00:00Z", fixtures: [] }];
  const h = harness({ rows, matches: [m(1, 10, -5), m(2, 11, 40)] });
  const r = await h.run(false);
  assert.equal(r.matchday, 11);
  assert.ok(!h.calls.some(c => c.url.includes("lms_settle")));
});

test("script: when the list lags (says not finished) a direct lookup of an overdue match still records the result", async () => {
  const rows = [{ id: 12, season: "2026-27", matchday: 12, status: "open", deadline: new Date(NOW - 6 * H).toISOString(), fixtures: [fx(1, -5), fx(2, 40)] }];
  const matches = [m(1, 12, -5, { status: "TIMED" }), m(2, 12, 40)];                         // the list is stale
  const direct = { 1: m(1, 12, -5, { status: "FINISHED", score: { fullTime: { home: 1, away: 1 } } }) };
  const h = harness({ rows, matches, direct }); await h.run(false);
  const patch = h.calls.find(c => c.method === "PATCH");
  assert.equal(patch.body.fixtures[0].result, "draw");
  assert.equal(patch.body.fixtures[1].result, undefined, "a match that has not kicked off is left alone");
  assert.equal(h.calls.filter(c => /v4\/matches\/\d+/.test(c.url)).length, 1, "only the overdue match is looked up");
  assert.ok(h.logs.some(l => /list said TIMED, direct lookup says FINISHED/.test(l)));
});
