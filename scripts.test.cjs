const test = require("node:test");
const assert = require("node:assert/strict");

const fixtures = require("../../scripts/fetch-fixtures.js");
const results = require("../../scripts/update-results.js");
const replace = require("../../scripts/replace-fixture.js");

const H = 3600e3;
const NOW = Date.UTC(2026, 10, 3, 7, 0, 0);            // Tue 3 Nov 2026 07:00 UTC
const match = (id, offsetH, extra = {}) => ({
  id, utcDate: new Date(NOW + offsetH * H).toISOString(), status: "TIMED",
  homeTeam: { id: id * 2, shortName: "H" + id }, awayTeam: { id: id * 2 + 1, shortName: "A" + id }, ...extra,
});

// ── fetch-fixtures: which matches can be picked ────────────────────────────
test("candidates must be upcoming, have both teams and fall inside the window", () => {
  const cutoff = NOW + 7 * 24 * H - 3 * H;
  const all = [
    match(1, 10),                                         // fine
    match(2, 24 * 7),                                     // after the cutoff
    match(3, 0.05),                                       // starts in 3 minutes: too soon
    match(4, 20, { status: "POSTPONED" }),
    match(5, 20, { status: "FINISHED" }),
    match(6, 20, { status: "IN_PLAY" }),
    match(7, 20, { homeTeam: {} }),                       // team not decided yet
    match(8, 30, { status: "SCHEDULED" }),                // fine
  ];
  assert.deepEqual(fixtures.pickCandidates(all, NOW, cutoff).map(m => m.id), [1, 8]);
});

test("the cutoff keeps the last kick-off at least 3 hours before the next round", () => {
  const cutoff = NOW + 7 * 24 * H - 3 * H;
  assert.equal(fixtures.pickCandidates([match(1, 7 * 24 - 3)], NOW, cutoff).length, 1);
  assert.equal(fixtures.pickCandidates([match(2, 7 * 24 - 2)], NOW, cutoff).length, 0);
});

test("a fixture is built with London time and the football-data id", () => {
  const summer = fixtures.toFixture({ ...match(1, 0), utcDate: "2026-07-04T14:00:00Z" });
  assert.equal(summer.time, "15:00");                    // BST
  const winter = fixtures.toFixture({ ...match(1, 0), utcDate: "2026-11-07T15:00:00Z" });
  assert.equal(winter.time, "15:00");                    // GMT
  assert.equal(winter.matchId, 1);
  assert.equal(winter.kickoffTs, Date.parse("2026-11-07T15:00:00Z"));
  assert.match(winter.date, /^Sat 7 Nov$/);
});

test("long team names are cut to 20 characters", () => {
  const f = fixtures.toFixture({ ...match(1, 1), homeTeam: { id: 1, shortName: "A very long team name FC" } });
  assert.equal(f.home.length, 20);
});

// ── fetch-fixtures: archiving last round ───────────────────────────────────
const R = (...r) => r.map(result => ({ result }));
const sub = (user, group, ...picks) => ({ username: user, group_id: group, entry_name: "Entry 1", preds: Object.fromEntries(picks.map((p, i) => [String(i), p])) });
const prevRound = (res) => ({ week: 4, fixtures: [1, 2, 3, 4, 5].map(() => ({})), results: res });

test("a perfect entry is archived as perfect and its group is flagged as a winner", () => {
  const { rows, winningGroups, allFinal } = fixtures.buildArchive(
    prevRound(R("home", "draw", "away", "home", "home")),
    [sub("a", "g1", "home", "draw", "away", "home", "home"), sub("b", "g1", "away", "draw", "away", "home", "home")],
    () => 2);
  assert.equal(allFinal, true);
  assert.deepEqual([...winningGroups], ["g1"]);
  assert.deepEqual(rows.map(r => [r.username, r.correct, r.total, r.perfect]), [["a", 5, 5, true], ["b", 4, 5, false]]);
  assert.equal(rows[0].series, 2);
  assert.equal(rows[0].week, 4);
});

test("groups are scored independently: a win in one group does not flag another", () => {
  const { winningGroups } = fixtures.buildArchive(
    prevRound(R("home", "draw", "away", "home", "home")),
    [sub("a", "g1", "home", "draw", "away", "home", "home"), sub("c", "g2", "away", "away", "away", "away", "away")],
    () => 1);
  assert.deepEqual([...winningGroups], ["g1"]);
});

test("several winners in one group are all archived as perfect", () => {
  const { rows } = fixtures.buildArchive(
    prevRound(R("home", "home", "home", "home", "home")),
    [sub("a", "g1", "home", "home", "home", "home", "home"), sub("b", "g1", "home", "home", "home", "home", "home")],
    () => 1);
  assert.equal(rows.filter(r => r.perfect).length, 2);
});

test("a void fixture counts as correct in the archive", () => {
  const { rows } = fixtures.buildArchive(
    prevRound(R("home", "draw", "void", "home", "home")),
    [sub("a", "g1", "home", "draw", "away", "home", "home")], () => 1);
  assert.equal(rows[0].perfect, true);
});

test("if results are incomplete nobody is perfect, and scores cover only finished matches", () => {
  const { rows, winningGroups, allFinal } = fixtures.buildArchive(
    prevRound(R("home", "draw", "upcoming", "home", "home")),
    [sub("a", "g1", "home", "draw", "away", "home", "home")], () => 1);
  assert.equal(allFinal, false);
  assert.equal(winningGroups.size, 0);
  assert.deepEqual([rows[0].correct, rows[0].total, rows[0].perfect], [4, 4, false]);
});

test("a round with no saved results archives zero scores and no winner", () => {
  const { rows, winningGroups } = fixtures.buildArchive(prevRound(null), [sub("a", "g1", "home", "draw", "away", "home", "home")], () => 1);
  assert.equal(winningGroups.size, 0);
  assert.deepEqual([rows[0].correct, rows[0].total], [0, 0]);
});

test("entries with no group are skipped rather than archived", () => {
  const { rows } = fixtures.buildArchive(prevRound(R("home", "home", "home", "home", "home")), [sub("a", null, "home", "home", "home", "home", "home")], () => 1);
  assert.equal(rows.length, 0);
});

// ── update-results: turning football-data matches into results ─────────────
const fin = (h, a, extra = {}) => ({ status: "FINISHED", score: { fullTime: { home: h, away: a }, ...extra } });

test("finished matches map to home, away and draw with the score", () => {
  assert.deepEqual(results.resultFor(fin(2, 1), "x"), { result: "home", score: "2-1" });
  assert.deepEqual(results.resultFor(fin(0, 3), "x"), { result: "away", score: "0-3" });
  assert.deepEqual(results.resultFor(fin(1, 1), "x"), { result: "draw", score: "1-1" });
  assert.deepEqual(results.resultFor(fin(0, 0), "x"), { result: "draw", score: "0-0" });
});

test("the 90-minute score is used when a match went to extra time or penalties", () => {
  const m = fin(3, 4, { regularTime: { home: 1, away: 1 } });
  assert.deepEqual(results.resultFor(m, "x"), { result: "draw", score: "1-1" });
});

test("unfinished matches stay upcoming", () => {
  for (const status of ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"]) {
    assert.deepEqual(results.resultFor({ status, score: { fullTime: { home: 1, away: 0 } } }, "x"), { result: "upcoming", score: null });
  }
});

test("a finished match with no score yet stays upcoming", () => {
  assert.deepEqual(results.resultFor(fin(null, null), "x"), { result: "upcoming", score: null });
});

test("a postponed match stays upcoming and logs a warning", () => {
  const logs = [];
  assert.deepEqual(results.resultFor({ status: "POSTPONED" }, "A vs B", m => logs.push(m)), { result: "upcoming", score: null });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /POSTPONED/);
});

test("mapResults matches fixtures by id, keeps voids and flags missing matches", () => {
  const fx = [1, 2, 3, 4, 5].map(i => ({ matchId: i, home: "H" + i, away: "A" + i }));
  const byId = new Map([[1, { id: 1, ...fin(2, 0) }], [2, { id: 2, ...fin(0, 0) }], [3, { id: 3, status: "TIMED" }], [4, { id: 4, ...fin(0, 5) }]]);
  const prev = [null, null, null, { result: "void", score: null, voided: true }, null];
  const logs = [];
  const out = results.mapResults(fx, prev, byId, m => logs.push(m));
  assert.deepEqual(out.map(r => r.result), ["home", "draw", "upcoming", "void", "upcoming"]);
  assert.equal(logs.length, 1);                          // fixture 5 is missing from the response
});

test("mapResults copes with no previous results", () => {
  const fx = [{ matchId: 1, home: "H", away: "A" }];
  const out = results.mapResults(fx, null, new Map([[1, { id: 1, ...fin(1, 0) }]]));
  assert.equal(out[0].result, "home");
});

// ── replace-fixture ────────────────────────────────────────────────────────
test("the next round time is always a future Tuesday at 07:00 UTC", () => {
  for (let d = 0; d < 14; d++) for (const hour of [0, 6, 7, 8, 23]) {
    const now = Date.UTC(2026, 10, 1 + d, hour, 30);
    const t = new Date(replace.nextRoundTime(now));
    assert.equal(t.getUTCDay(), 2);
    assert.equal(t.getUTCHours(), 7);
    assert.ok(t.getTime() > now);
    assert.ok(t.getTime() - now <= 7 * 24 * H);
  }
});

test("on a Tuesday after 07:00 the next round is a week away; before 07:00 it is today", () => {
  assert.equal(new Date(replace.nextRoundTime(Date.UTC(2026, 10, 3, 6, 0))).getUTCDate(), 3);
  assert.equal(new Date(replace.nextRoundTime(Date.UTC(2026, 10, 3, 8, 0))).getUTCDate(), 10);
});

test("replacement candidates exclude matches already in the round and ones too close to kick-off", () => {
  const cutoff = NOW + 100 * H;
  const all = [match(1, 10), match(2, 10), match(3, 1), match(4, 50), match(5, 200), match(6, 20, { status: "POSTPONED" })];
  const out = replace.pickReplacements(all, new Set([1]), NOW, cutoff).map(m => m.id);
  assert.deepEqual(out, [2, 4]);
});

// ── fetch-fixtures: leave a running round alone ────────────────────────────
const roundWith = (...offsets) => ({ fixtures: offsets.map(o => ({ kickoffTs: NOW + o * H })) });

test("a round whose matches are still to come is left alone (international-break case)", () => {
  assert.equal(fixtures.roundStillRunning(roundWith(96, 97, 98, 120, 121), NOW), true);
});

test("a round is still running until 3 hours after its last kick-off", () => {
  const round = roundWith(-50, -30, -2);                       // last match kicked off 2 hours ago
  assert.equal(fixtures.roundStillRunning(round, NOW), true);
  assert.equal(fixtures.roundStillRunning(round, NOW + 1 * H + 1), false);
});

test("a finished round, no round, a test round or an empty round does not block a new one", () => {
  assert.equal(fixtures.roundStillRunning(roundWith(-100, -80), NOW), false);
  assert.equal(fixtures.roundStillRunning(null, NOW), false);
  assert.equal(fixtures.roundStillRunning({ ...roundWith(100), mock_results: [] }, NOW), false);
  assert.equal(fixtures.roundStillRunning({ fixtures: [] }, NOW), false);
});

test("a postponed match does not hold up the next round", () => {
  // its stored kick-off is the original, now in the past, even though it was never played
  assert.equal(fixtures.roundStillRunning(roundWith(-100, -99, -98, -97, -96), NOW), false);
});

// ── feedback-to-issues ─────────────────────────────────────────────────────
const feedback = require("../../scripts/feedback-to-issues.js");

test("a bug report becomes a labelled issue with the sender and group", () => {
  const issue = feedback.formatIssue({ category: "bug", username: "ann", message: "The button is broken", created_at: "2026-11-09T20:00:00Z" }, "Alpha");
  assert.equal(issue.title, "[Bug] The button is broken");
  assert.deepEqual(issue.labels, ["bug", "from-app"]);
  assert.match(issue.body, /\*\*From:\*\* ann \(Alpha\)/);
  assert.match(issue.body, /The button is broken/);
});

test("ideas and other feedback get their own labels; unknown categories fall back to other", () => {
  assert.deepEqual(feedback.formatIssue({ category: "idea", username: "a", message: "x" }).labels, ["enhancement", "from-app"]);
  assert.deepEqual(feedback.formatIssue({ category: "other", username: "a", message: "x" }).labels, ["feedback", "from-app"]);
  assert.equal(feedback.formatIssue({ category: "weird", username: "a", message: "x" }).title, "[Other] x");
});

test("long messages are cut in the title but kept whole in the body", () => {
  const long = "word ".repeat(60).trim();
  const issue = feedback.formatIssue({ category: "idea", username: "a", message: long }, null);
  assert.ok(issue.title.length <= "[Idea] ".length + 60);
  assert.match(issue.title, /\.\.\.$/);
  assert.ok(issue.body.includes(long));
});

test("@mentions are defused so feedback can't ping real GitHub users", () => {
  const issue = feedback.formatIssue({ category: "bug", username: "@octocat", message: "cc @torvalds please" }, "@team");
  assert.ok(!/@(?!​)/.test(issue.title + issue.body), "every @ is followed by a zero-width space");
});

test("feedback can't break out of the code block", () => {
  const issue = feedback.formatIssue({ category: "bug", username: "a", message: "oops ``` # injected heading" }, null);
  const fences = issue.body.split("\n").filter(l => l.startsWith("```"));
  assert.equal(fences.length, 2);
});

test("new feedback is turned into issues and marked as sent", async () => {
  process.env.SB_URL = "https://sb.test"; process.env.SB_KEY = "k";
  process.env.GITHUB_TOKEN = "t"; process.env.GITHUB_REPOSITORY = "me/gaffer";
  const calls = [];
  global.fetch = async (url, o = {}) => {
    calls.push([o.method || "GET", url, o.body]);
    const ok = b => ({ ok: true, status: 200, text: async () => JSON.stringify(b), json: async () => b });
    if (url.includes("feedback?issue_url")) return ok([{ id: "f1", username: "ann", group_id: "g1", category: "bug", message: "Broken", created_at: "x" }]);
    if (url.includes("groups?select")) return ok([{ id: "g1", name: "Alpha" }]);
    if (url.includes("api.github.com")) return ok({ html_url: "https://github.com/me/gaffer/issues/7" });
    return ok(null);
  };
  delete require.cache[require.resolve("../../scripts/feedback-to-issues.js")];
  const failures = await require("../../scripts/feedback-to-issues.js").main();
  assert.equal(failures, 0);
  const gh = calls.find(c => c[1].includes("api.github.com"));
  assert.equal(gh[1], "https://api.github.com/repos/me/gaffer/issues");
  const patch = calls.find(c => c[0] === "PATCH");
  assert.match(patch[1], /feedback\?id=eq\.f1/);
  assert.deepEqual(JSON.parse(patch[2]), { status: "sent", issue_url: "https://github.com/me/gaffer/issues/7" });
});

test("if GitHub refuses, the feedback stays unsent so the next run retries it", async () => {
  const calls = [];
  global.fetch = async (url, o = {}) => {
    calls.push(o.method || "GET");
    const ok = b => ({ ok: true, status: 200, text: async () => JSON.stringify(b), json: async () => b });
    if (url.includes("feedback?issue_url")) return ok([{ id: "f1", username: "a", category: "idea", message: "x" }]);
    if (url.includes("groups?select")) return ok([]);
    if (url.includes("api.github.com")) return { ok: false, status: 403, text: async () => "no", json: async () => ({}) };
    return ok(null);
  };
  delete require.cache[require.resolve("../../scripts/feedback-to-issues.js")];
  const failures = await require("../../scripts/feedback-to-issues.js").main();
  assert.equal(failures, 1);
  assert.ok(!calls.includes("PATCH"));
});
