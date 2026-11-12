// WCAG 2.1 AA text contrast (success criterion 1.4.3): 4.5:1 for normal text, 3:1 for large text.
// Every screen is checked in both dark and light mode, so a colour change can't quietly make something hard to read.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, launch, newWorld, picks, ADMIN_PIN, HOUR } from "./harness.mjs";
import { MEASURE } from "./contrast.mjs";

let bundle, browser;
before(async () => { bundle = await buildApp(); browser = await launch(); });
after(async () => { await browser.close(); });

const entry = (u, g, name, ...p) => ({ username: u, group_id: g, entry_name: name, preds: picks(...p), submitted_at: new Date().toISOString() });
const hist = (u, week, correct, perfect = false) => ({ group_id: "g-alpha", series: 1, week, username: u, entry_name: "Entry 1", correct, total: 5, perfect });
const win = ["home", "draw", "away", "home", "home"];
const R = (...r) => r.map(result => ({ result, score: result === "upcoming" || result === "void" ? null : "1-0" }));
const click = (p, name) => p.getByRole("button", { name }).first().click();
const base = t => { t.history.push(hist("bob", 1, 3), hist("ann", 1, 5, true), hist("ann", 2, 2)); t.submissions.push(entry("ann", "g-alpha", "Entry 1", ...win), entry("bob", "g-alpha", "Entry 1", "away", "away", "away", "away", "away")); t.memberships.push({ username: "ann", group_id: "g-beta" }); };

const SCREENS = [
  ["sign-in", {}, async () => {}],
  ["sign-in with help and password-reset form", {}, async p => { await click(p, "How does this work?"); await click(p, "Forgot password?"); }],
  ["register", {}, async p => { await click(p, "Register"); }],
  ["home", { loginAs: "ann" }, async () => {}],
  ["lobby", { loginAs: "ann" }, async p => { await click(p, /Lobby/); }],
  ["my entries", { loginAs: "ann" }, async p => { await click(p, /My Predictions/); }],
  ["new entry", { loginAs: "ann" }, async p => { await click(p, /My Predictions/); await click(p, /Add Entry/); await click(p, "Draw"); }],
  ["story so far", { loginAs: "ann" }, async p => { await click(p, /The Story So Far/); await p.getByText("Week 1").first().click(); }],
  ["my groups", { loginAs: "ann" }, async p => { await click(p, /My Groups/); }],
  ["profile", { loginAs: "ann" }, async p => { await click(p, /My Profile/); await p.getByText("Your stats").first().waitFor().catch(() => {}); }],
  ["how to play", { loginAs: "ann" }, async p => { await click(p, /How to play/); await p.getByText("Can I change an entry once").click(); }],
  ["feedback", { loginAs: "ann" }, async p => { await click(p, /Send feedback/); }],
  ["admin panel", { loginAs: "ann" }, async p => { await click(p, /Admin/); await p.locator('input[type="password"]').fill(ADMIN_PIN); await click(p, "Enter"); await p.getByText("Admin Panel").first().waitFor(); }],
  ["results check", { loginAs: "ann", kickoff: -3 * HOUR, results: R("home", "home", "upcoming", "upcoming", "upcoming") }, async p => { await click(p, /Lobby/); await click(p, /Check Results/); await click(p, /Reveal next result/); }],
  ["winners screen", { loginAs: "ann", kickoff: -3 * HOUR, results: R(...win), setup: t => t.submissions.push(entry("ann", "g-alpha", "Entry 1", ...win), entry("bob", "g-alpha", "Entry 1", ...win)) }, async p => { await click(p, /Lobby/); await click(p, /Check Results/); for (let i = 0; i < 4; i++) await click(p, /Reveal next result/); await click(p, /See the Outcome/); await p.getByText("WE HAVE WINNERS").first().waitFor(); await p.waitForTimeout(1200); }],
];

for (const theme of ["dark", "light"]) for (const [name, opts, go] of SCREENS) {
  test(`readable text (WCAG AA) in ${theme} mode: ${name}`, async () => {
    const w = await newWorld(browser, bundle, { setup: base, ...opts });
    try {
      await w.page.addInitScript(t => localStorage.setItem("fp_theme", t), theme);
      await w.page.reload();
      await w.page.waitForTimeout(400);
      await go(w.page);
      await w.page.waitForTimeout(500);
      const bad = await w.page.evaluate(MEASURE);
      assert.deepEqual(bad, [], `text that is too faint to read comfortably:\n${bad.map(b => `  ${b.ratio}:1 (needs ${b.need}) "${b.text}" ${b.color}`).join("\n")}`);
    } finally { await w.close(); }
  });
}
