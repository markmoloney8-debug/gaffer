// Everything an ordinary player does, signed in as an ordinary player.
// The fake database enforces the same permission rules as the real one (see fake-supabase.mjs `policy`),
// so a step that only works for the admin fails here. Most older tests sign in as "ann", who is the admin in
// this test world — these exist so that can never hide a problem for everybody else.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, launch, newWorld, picks, HOUR, navClick } from "./harness.mjs";

let bundle, browser;
before(async () => { bundle = await buildApp(); browser = await launch(); });
after(async () => { await browser.close(); });

const R = (...r) => r.map(result => ({ result, score: result === "upcoming" || result === "void" ? null : "1-0" }));
let seq = 0;
const seeEntry = (u, g, name, ...p) => ({ id: `r-${++seq}`, username: u, group_id: g, entry_name: name, preds: picks(...p), submitted_at: new Date().toISOString() });
const open = 48 * HOUR, locked = -3 * HOUR;

async function run(opts, body) {
  const w = await newWorld(browser, bundle, opts);
  w.text = (t, timeout = 8000) => w.page.getByText(t, { exact: false }).first().waitFor({ timeout });
  w.click = name => navClick(w.page, name);
  try {
    assert.equal(w.tables.admins.some(a => a.username === opts.loginAs), false, `${opts.loginAs} must NOT be an admin in these tests`);
    await body(w);
    assert.deepEqual(w.errors, [], "the page threw errors");
  } finally { await w.close(); }
}
async function seal(w, ...p) {
  const label = { home: "Home Win", draw: "Draw", away: "Away Win" };
  for (let i = 0; i < 5; i++) await w.page.locator(`button:has-text("${label[p[i]]}")`).nth(i).click();
  await w.click(/Save Entry/);
}
const ownEntry = t => t.submissions.push(seeEntry("bob", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"));

// ── Reveal: every state the round can be in when a player presses the button ──────────────────────
for (const roundLocked of [false, true]) {
  test(`player reveal works when the round's locked flag is ${roundLocked}`, async () => {
    await run({ loginAs: "bob", setup: ownEntry, kickoff: locked, results: R("home", "home", "home", "home", "home") }, async w => {
      w.tables.round[0].locked = roundLocked;
      await w.click(/Lobby/);
      await w.click(/Check Results/);
      await w.text("All 5 results in");
      assert.equal(await w.page.getByText(/Couldn't load results/).count(), 0);
    });
  });
}
test("player reveal with only some results in shows what is there, without an error", async () => {
  await run({ loginAs: "bob", setup: ownEntry, kickoff: locked, results: R("home", "home", "upcoming", "upcoming", "upcoming") }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    assert.equal(await w.page.getByText(/Couldn't load results/).count(), 0);
  });
});
test("a player in another group can open the reveal too", async () => {
  const setup = t => t.submissions.push(seeEntry("cat", "g-beta", "Entry 1", "home", "home", "home", "home", "home"));
  await run({ loginAs: "cat", setup, kickoff: locked, results: R("home", "home", "home", "home", "home") }, async w => {
    w.tables.round[0].locked = true;
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    await w.text("All 5 results in");
  });
});

// ── Entries ──────────────────────────────────────────────────────────────────────────────────────
test("player: make, edit and delete an entry", async () => {
  await run({ loginAs: "bob" }, async w => {
    await w.click(/My Predictions/);
    await w.click(/Add Entry/);
    await seal(w, "home", "draw", "away", "home", "home");
    await w.text("Entry sealed");
    assert.equal(w.tables.submissions.filter(s => s.username === "bob").length, 1);
    await w.click("Delete Entry 1");
    await w.click("Yes, delete Entry 1");
    await w.page.getByRole("button", { name: "Delete Entry 1" }).waitFor({ state: "hidden" });
    assert.equal(w.tables.submissions.filter(s => s.username === "bob").length, 0);
  });
});
test("player: once entries have closed there is no way to add or delete an entry, and nothing is removed", async () => {
  await run({ loginAs: "bob", setup: ownEntry, kickoff: locked }, async w => {
    await w.page.getByTestId("tile-gaffer").click();
    assert.equal(await w.page.getByRole("button", { name: /My predictions/ }).first().isDisabled(), true);
    assert.equal(w.tables.submissions.filter(s => s.username === "bob").length, 1);
  });
});

// ── Seeing other people's picks ──────────────────────────────────────────────────────────────────
test("player: after kick-off the lobby shows everyone's picks", async () => {
  const setup = t => { ownEntry(t); t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "away", "away", "away", "away", "away")); };
  await run({ loginAs: "bob", setup, kickoff: locked }, async w => {
    await w.click(/Lobby/);
    await w.text("View picks");
  });
});

// ── Pages every player opens ─────────────────────────────────────────────────────────────────────
test("player: profile, story and help pages load without errors", async () => {
  const setup = t => t.history.push({ group_id: "g-alpha", series: 1, week: 1, username: "bob", entry_name: "Entry 1", correct: 3, total: 5, perfect: false });
  await run({ loginAs: "bob", setup }, async w => {
    await w.click(/My Profile/);
    await w.page.getByLabel("Your stats").waitFor();
    await w.click(/Back/);
    await w.click(/Season/);
    await w.text("Season");
  });
});
test("player: Last Man Standing opens", async () => {
  await run({ loginAs: "bob" }, async w => {
    await w.page.getByRole("button", { name: /Last Man Standing/ }).first().click();
    await w.text("Last Man Standing");
  });
});
test("player: sending feedback works", async () => {
  await run({ loginAs: "bob" }, async w => {
    await w.click(/Send feedback/);
    await w.page.getByLabel("Your message").fill("test from a normal player");
    await w.click(/Send feedback/);
    await w.text("Your feedback has been sent");
    assert.equal(w.tables.feedback[0].username, "bob");
  });
});
test("player: cannot see the admin's tools", async () => {
  await run({ loginAs: "bob" }, async w => {
    assert.equal(await w.page.getByText(/Feedback \(\d+ open\)/).count(), 0);
    assert.equal(await w.page.getByText(/Password reset requests/i).count(), 0);
  });
});

test("player: watching a winning reveal records the winner and shows the winners (round already locked)", async () => {
  const win = ["home", "draw", "away", "home", "home"];
  const setup = t => t.submissions.push(seeEntry("bob", "g-alpha", "Entry 1", ...win), seeEntry("ann", "g-alpha", "Entry 1", ...win));
  await run({ loginAs: "bob", setup, kickoff: locked, results: R(...win) }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    for (let i = 0; i < 4; i++) await w.click(/Reveal next result/);
    await w.click(/See the Outcome/);
    await w.text("WE HAVE WINNERS!");
    const state = () => w.tables.group_state.find(g => g.group_id === "g-alpha");
    for (let i = 0; i < 20 && !state().winners_found; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(state().winners_found, true, "the win must be recorded even when a player (not the admin) watches the reveal");
  });
});

test("player: 'Skip to the outcome' goes straight to the winners without clicking through every result", async () => {
  const win = ["home", "draw", "away", "home", "home"];
  const setup = t => t.submissions.push(seeEntry("bob", "g-alpha", "Entry 1", ...win));
  await run({ loginAs: "bob", setup, kickoff: locked, results: R(...win) }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    await w.click(/Skip to the outcome/);
    await w.text("WE HAVE A WINNER");
    const state = () => w.tables.group_state.find(g => g.group_id === "g-alpha");
    for (let i = 0; i < 20 && !state().winners_found; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(state().winners_found, true);
  });
});
test("player: with some matches still to play, 'Show all results now' reveals the finished ones and no outcome yet", async () => {
  await run({ loginAs: "bob", setup: ownEntry, kickoff: locked, results: R("home", "home", "upcoming", "upcoming", "upcoming") }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    await w.click(/Show all results now/);
    await w.text("Who got it right?");
    assert.equal(await w.page.getByText(/WE HAVE/).count(), 0);
    assert.equal(await w.page.getByRole("button", { name: /Show all results now/ }).count(), 0);
  });
});
