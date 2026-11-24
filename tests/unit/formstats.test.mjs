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
