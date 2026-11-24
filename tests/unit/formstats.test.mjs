import test from "node:test"; import assert from "node:assert/strict";
import { crowdSplit, contrarians, crowdRecord, hotCold } from "../../src/formstats.js";
const fx = [{home:"A",away:"B"},{home:"C",away:"D"}];
const E = (u,a,b) => ({ username:u, preds:{0:a,1:b} });
const subs = [E("x","home","home"),E("y","home","draw"),E("z","away","away")];
test("crowdSplit", () => { const c = crowdSplit({fixtures:fx}, subs); assert.equal(c[0].home,2); assert.equal(c[0].topPick,"home"); assert.equal(c[0].topShare,67); assert.equal(c[0].homeTeam,"A"); assert.equal(c[0].awayTeam,"B"); assert.equal(crowdSplit(null,[]).length,0); });
test("contrarians ranks the odd one out first; needs 3 entries", () => {
  const c = contrarians({fixtures:fx}, subs); assert.equal(c[0].username,"z"); assert.deepEqual(contrarians({fixtures:fx}, subs.slice(0,2)),[]);
});
test("crowdRecord and worst pick", () => {
  const r = crowdRecord({fixtures:fx,results:[{result:"home"},{result:"away"}]}, subs);
  assert.equal(r.played,2); assert.equal(r.right,1); assert.equal(r.worst.i,1); assert.equal(r.worst.share,33); assert.equal(r.worst.homeTeam,"C");
  assert.equal(crowdRecord({fixtures:fx,results:[{result:"upcoming"},{result:"void"}]}, subs).played,0);
});
test("hotCold needs two weeks", () => {
  const h = (week,u,correct) => ({series:1,week,username:u,correct,total:5});
  assert.equal(hotCold([h(1,"a",3)]), null);
  const r = hotCold([h(1,"a",1),h(2,"a",5),h(3,"a",5),h(1,"b",5),h(2,"b",1),h(3,"b",1)], 2);
  assert.equal(r[0].username,"a"); assert.ok(r[0].diff>0); assert.ok(r[1].diff<0);
});
import { lastWeek } from "../../src/formstats.js";
test("lastWeek uses the latest week, best entry per player", () => {
  const h = (week,u,correct,series=1) => ({series,week,username:u,correct,total:5});
  const r = lastWeek([h(1,"a",5),h(2,"a",2),h(2,"a",4),h(2,"b",3)]);
  assert.equal(r.week,2); assert.deepEqual(r.players.map(p=>[p.username,p.correct,p.entries]),[["a",4,2],["b",3,1]]);
  assert.equal(lastWeek([]),null);
  assert.equal(lastWeek([h(9,"a",1,1),h(1,"a",3,2)]).week,1);   // a newer run beats a higher week number
});
import { matchPreviews, lmsBest, pickTypeRecord, teamRecord, formPoints, ordinal } from "../../src/formstats.js";
const TF = [
  { team: "A", position: 1, last5: "WWWWW", home: { w: 5, d: 0, l: 0, p: 5, last5: "WWWWW" }, away: { w: 2, d: 1, l: 2, p: 5, last5: "WDLWL" } },
  { team: "B", position: 10, last5: "LLLDL", home: { w: 1, d: 1, l: 3, p: 5, last5: "LDLLW" }, away: { w: 0, d: 0, l: 5, p: 5, last5: "LLLLL" } },
  { team: "C", position: 5, last5: "WDWDL", home: { w: 3, d: 1, l: 1, p: 5, last5: "WWDLW" }, away: { w: 1, d: 2, l: 2, p: 5, last5: "DDLWL" } },
];
test("formPoints and ordinal", () => { assert.equal(formPoints("WWDLL"), 7); assert.equal(ordinal(1), "1st"); assert.equal(ordinal(11), "11th"); assert.equal(ordinal(22), "22nd"); });
test("matchPreviews uses table data, falls back to fixture form, and gives a venue edge", () => {
  const round = { fixtures: [{ home: "A", away: "B" }, { home: "X", away: "Y", form: { home: ["W", "D"], away: ["L"] } }] };
  const p = matchPreviews(round, TF);
  assert.equal(p[0].home.pos, 1); assert.equal(p[0].away.last5, "LLLDL"); assert.equal(p[0].edge, 15 - 0);
  assert.equal(p[1].home.pos, null); assert.equal(p[1].home.last5, "WD"); assert.equal(p[1].edge, null);
  assert.deepEqual(matchPreviews(null, TF), []);
});
test("lmsBest ranks by form, skips used teams and played games, keeps unknown teams last", () => {
  const fx = [{ home: "A", away: "B" }, { home: "C", away: "Z" }, { home: "D", away: "E", result: "home" }];
  const r = lmsBest(fx, TF, new Set(["C"]));
  assert.deepEqual(r.map(x => x.team), ["A", "B", "Z"]);
  assert.equal(r[0].venue, "home"); assert.equal(r[2].score, null);
  assert.equal(lmsBest([{ home: "A", away: "B", result: "postponed" }], TF).length, 2);
});
test("pickTypeRecord and teamRecord work from saved fixtures and results, and ignore old rows", () => {
  const row = (preds, results) => ({ series: 1, week: 4, preds, results, fixtures: [{ home: "A", away: "B" }, { home: "C", away: "D" }] });
  const h = [row({ 0: "home", 1: "away" }, ["home", "home"]), row({ 0: "home", 1: "draw" }, ["home", "draw"]), { series: 1, week: 3, preds: { 0: "home" } }];
  const r = pickTypeRecord(h);
  assert.equal(r.weeks, 1); assert.equal(r.home.n, 2); assert.equal(r.home.pct, 100); assert.equal(r.away.pct, 0); assert.equal(r.draw.pct, 100);
  assert.equal(pickTypeRecord([{ preds: { 0: "home" } }]), null);
  const many = Array.from({ length: 3 }, () => row({ 0: "home", 1: "away" }, ["home", "home"]));
  const t = teamRecord(many);
  assert.equal(t.best[0].team, "A"); assert.equal(t.best[0].pct, 100); assert.equal(t.worst[0].team, "D"); assert.equal(t.worst[0].pct, 0);
  assert.ok(t.worst.every(w => !t.best.some(b => b.team === w.team)));
  assert.equal(teamRecord(many.slice(0, 2)), null);                       // fewer than 3 picks per team
});
