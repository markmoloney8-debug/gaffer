import test from "node:test"; import assert from "node:assert/strict";
import { runStats } from "../../src/runstats.js";
const H = (week, username, perfect=false, series=1) => ({ series, week, username, perfect });
test("counts entries since the last win, £1 each", () => {
  const history = [H(1,"a"),H(1,"b",true),H(2,"a"),H(2,"b"),H(2,"a"),H(3,"a")];
  const r = runStats({ history, round:{series:1,week:4}, subs:[{username:"a"},{username:"c"}], username:"a" });
  assert.equal(r.lastWin,1); assert.deepEqual(r.winners,["b"]);
  assert.equal(r.pot,6); assert.equal(r.mine,4);
  assert.deepEqual(r.weeks.map(w=>[w.week,w.entries]),[[2,3],[3,1],[4,2]]);
});
test("no win yet counts everything; other series ignored", () => {
  const r = runStats({ history:[H(1,"a"),H(1,"x",true,0)], round:{series:1,week:2}, subs:[], username:"a" });
  assert.equal(r.pot,1); assert.equal(r.lastWin,0);
});
test("round already archived is not double counted", () => {
  const r = runStats({ history:[H(2,"a")], round:{series:1,week:2}, subs:[{username:"a"}], username:"a" });
  assert.equal(r.pot,1);
});
test("works with no round", () => { assert.equal(runStats({}).pot,0); });
import { gafferTile, lmsTile } from "../../src/runstats.js";
test("gaffer tile states", () => {
  const r = { locked:false };
  assert.equal(gafferTile({round:null}).tone,"grey");
  assert.equal(gafferTile({round:r,subs:[],username:"a"}).tone,"gold");
  assert.equal(gafferTile({round:r,subs:[{username:"a"}],username:"a"}).tone,"green");
  assert.equal(gafferTile({round:{locked:true},subs:[],username:"a"}).tone,"grey");
  assert.equal(gafferTile({round:r,subs:[{username:"a"}],username:"a",closed:true}).pill,"Locked in");
  assert.equal(gafferTile({round:{winnersFound:true},subs:[],username:"a"}).pill,"Round complete");
});
test("lms tile states", () => {
  const gw = { id:1, deadline:new Date(Date.now()+1e6).toISOString() };
  const base = { me:"a", gameweek:gw, competition:{status:"running"}, entries:[] };
  assert.equal(lmsTile(null).pill,"Loading");
  assert.equal(lmsTile({...base,competition:null}).pill,"Not started");
  assert.equal(lmsTile(base).tone,"gold");
  assert.equal(lmsTile({...base,entries:[{username:"a",status:"out"}]}).tone,"red");
  assert.equal(lmsTile({...base,entries:[{username:"a",status:"alive",picks:[]}]}).tone,"gold");
  assert.equal(lmsTile({...base,entries:[{username:"a",status:"alive",picks:[{gameweek:1,team:"X"}]}]}).tone,"green");
  const past = { ...gw, deadline:new Date(Date.now()-1e3).toISOString() };
  assert.equal(lmsTile({...base,gameweek:past,entries:[{username:"a",status:"alive",picks:[]}]}).pill,"No pick");
});
