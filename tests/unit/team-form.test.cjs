const test = require("node:test"); const assert = require("node:assert/strict");
const { buildTeamForm, main } = require("../../scripts/team-form.js");
const T = (id, shortName) => ({ id, shortName });
let t = 0;
const M = (h, a, hs, as, day) => ({ id: ++t, status: "FINISHED", utcDate: `2026-11-${String(day).padStart(2, "0")}T15:00:00Z`, homeTeam: h, awayTeam: a, score: { fullTime: { home: hs, away: as } } });
const ARS = T(1, "Arsenal"), CHE = T(2, "Chelsea"), HUL = T(3, "Hull City");
test("table, records, last 5 and home/away split", () => {
  const rows = buildTeamForm([M(ARS, CHE, 2, 0, 1), M(HUL, ARS, 1, 1, 8), M(CHE, HUL, 3, 0, 15), M(ARS, HUL, 4, 0, 22)]);
  const by = n => rows.find(r => r.team === n);
  assert.deepEqual(rows.map(r => [r.team, r.position]), [["Arsenal", 1], ["Chelsea", 2], ["Hull City", 3]]);
  assert.equal(by("Arsenal").points, 7); assert.equal(by("Arsenal").last5, "WDW");
  assert.deepEqual([by("Arsenal").home.w, by("Arsenal").home.p, by("Arsenal").away.d], [2, 2, 1]);
  assert.equal(by("Hull City").home.last5, "D"); assert.equal(by("Hull City").away.last5, "LL");
  assert.equal(by("Chelsea").gf, 3); assert.equal(by("Chelsea").ga, 2);
});
test("last5 keeps only the newest five, oldest first", () => {
  const ms = [1, 2, 3, 4, 5, 6, 7].map(d => M(ARS, CHE, d === 1 ? 0 : 1, 0, d));   // lose the first, win the rest
  assert.equal(buildTeamForm(ms).find(r => r.team === "Arsenal").last5, "WWWWW");
});
test("ignores unfinished matches and uses the 90-minute score", () => {
  const live = { ...M(ARS, CHE, 1, 0, 3), status: "TIMED" };
  const et = { ...M(ARS, HUL, 1, 1, 4), score: { fullTime: { home: 2, away: 1 }, regularTime: { home: 1, away: 1 } } };
  const rows = buildTeamForm([live, et]);
  assert.equal(rows.find(r => r.team === "Chelsea"), undefined);
  assert.equal(rows.find(r => r.team === "Arsenal").last5, "D");
  assert.deepEqual(buildTeamForm([]), []);
});
test("main writes one upsert and reports the top teams", async () => {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url, opts }); return url.includes("football-data") ? { ok: true, json: async () => ({ matches: [M(ARS, CHE, 1, 0, 1)] }) } : { ok: true, text: async () => "" }; };
  const logs = []; const r = await main({ FOOTBALL_DATA_TOKEN: "t", SB_URL: "https://x.supabase.co", SB_KEY: "k" }, f, m => logs.push(m));
  assert.equal(r.written, 2); assert.equal(calls.length, 2);
  assert.match(calls[1].url, /team_form\?on_conflict=team/); assert.equal(calls[1].opts.method, "POST");
  assert.equal(JSON.parse(calls[1].opts.body).length, 2);
  await assert.rejects(() => main({}, f, () => {}), /Missing/);
  const bad = async () => ({ ok: false, status: 429, text: async () => "slow down" });
  await assert.rejects(() => main({ FOOTBALL_DATA_TOKEN: "t", SB_URL: "u", SB_KEY: "k" }, bad, () => {}), /429/);
});
