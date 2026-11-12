import test from "node:test";
import assert from "node:assert/strict";
import { hit, isPerfect, scoreEntry, deadlineTs, isDeadlinePassed, msUntilDeadline, fmtCountdown } from "../../src/logic.js";

const mk = (...r) => r.map(result => ({ result, score: null }));
const entry = (...p) => ({ preds: Object.fromEntries(p.map((v, i) => [String(i), v])) });

test("a correct pick is a hit, a wrong one is not", () => {
  assert.equal(hit(entry("home"), { result: "home" }, 0), true);
  assert.equal(hit(entry("home"), { result: "away" }, 0), false);
});

test("a missing pick never counts as a hit", () => {
  assert.equal(hit({ preds: {} }, { result: "home" }, 0), false);
});

test("a void fixture counts as correct for everyone, even with no pick", () => {
  assert.equal(hit({ preds: {} }, { result: "void" }, 3), true);
  assert.equal(hit(entry("away"), { result: "void" }, 0), true);
});

test("picks stored with numeric keys still work", () => {
  assert.equal(hit({ preds: { 0: "draw" } }, { result: "draw" }, 0), true);
});

test("isPerfect needs all five right", () => {
  const res = mk("home", "draw", "away", "home", "home");
  assert.equal(isPerfect(entry("home", "draw", "away", "home", "home"), res), true);
  assert.equal(isPerfect(entry("home", "draw", "away", "home", "away"), res), false);
});

test("isPerfect is false while any match is still upcoming", () => {
  const res = mk("home", "draw", "away", "home", "upcoming");
  assert.equal(isPerfect(entry("home", "draw", "away", "home", "home"), res), false);
});

test("isPerfect is false with no results, and for an entry missing a pick", () => {
  assert.equal(isPerfect(entry("home"), null), false);
  assert.equal(isPerfect({ preds: { 0: "home", 1: "draw", 2: "away", 3: "home" } }, mk("home", "draw", "away", "home", "home")), false);
});

test("a void fixture lets an otherwise-4/4 entry be perfect", () => {
  const res = mk("home", "draw", "void", "home", "home");
  assert.equal(isPerfect(entry("home", "draw", "away", "home", "home"), res), true);
  assert.equal(isPerfect(entry("home", "away", "away", "home", "home"), res), false);
});

test("several entries can all be perfect (winners share)", () => {
  const res = mk("home", "home", "home", "home", "home");
  const subs = [entry("home", "home", "home", "home", "home"), entry("home", "home", "home", "home", "home"), entry("away", "home", "home", "home", "home")];
  assert.equal(subs.filter(s => isPerfect(s, res)).length, 2);
});

test("scoreEntry counts only finished matches", () => {
  const res = mk("home", "draw", "upcoming", "away", "upcoming");
  assert.deepEqual(scoreEntry(entry("home", "away", "home", "away", "home"), res), { correct: 2, total: 3 });
});

test("scoreEntry counts a void as correct and as played", () => {
  const res = mk("void", "upcoming", "upcoming", "upcoming", "upcoming");
  assert.deepEqual(scoreEntry(entry("away"), res), { correct: 1, total: 1 });
});

test("scoreEntry handles no results", () => {
  assert.deepEqual(scoreEntry(entry("home"), null), { correct: 0, total: 0 });
});

test("the deadline is one minute before the earliest kick-off", () => {
  const f = [{ kickoffTs: 5_000_000 }, { kickoffTs: 3_000_000 }, { kickoffTs: 9_000_000 }];
  assert.equal(deadlineTs(f), 3_000_000 - 60_000);
});

test("no kick-off times means no deadline", () => {
  assert.equal(deadlineTs([]), null);
  assert.equal(deadlineTs(undefined), null);
  assert.equal(isDeadlinePassed([]), false);
  assert.equal(msUntilDeadline([]), null);
});

test("entries are open until exactly one minute before kick-off", () => {
  const f = [{ kickoffTs: 1_000_000 }];
  assert.equal(isDeadlinePassed(f, 1_000_000 - 60_001), false);
  assert.equal(isDeadlinePassed(f, 1_000_000 - 60_000), true);
  assert.equal(isDeadlinePassed(f, 1_000_000 + 1), true);
});

test("the countdown never goes negative", () => {
  const f = [{ kickoffTs: 1_000_000 }];
  assert.equal(msUntilDeadline(f, 1_000_000 - 120_000), 60_000);
  assert.equal(msUntilDeadline(f, 2_000_000), 0);
});

test("countdown formatting", () => {
  assert.equal(fmtCountdown(0), "00:00:00");
  assert.equal(fmtCountdown(-5), "00:00:00");
  assert.equal(fmtCountdown(3_661_000), "01:01:01");
  assert.equal(fmtCountdown(23 * 3_600_000 + 59 * 60_000 + 59_000), "23:59:59");
  assert.equal(fmtCountdown(24 * 3_600_000), "1d 00:00:00");
  assert.equal(fmtCountdown(26 * 3_600_000), "1d 02:00:00");
  assert.equal(fmtCountdown((9 * 24 + 16) * 3_600_000 + 16 * 60_000 + 33_000), "9d 16:16:33");
});
