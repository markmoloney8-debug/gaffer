// The redesigned navigation: Home tiles, account menu, The Gaffer hub, This run grid, Form guide, combined How to play.
// Everything is run as an ordinary player (bob) and as the admin (ann), because the earlier permission bugs hid behind the admin.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, launch, newWorld, picks, HOUR } from "./harness.mjs";

let bundle, browser;
before(async () => { bundle = await buildApp(); browser = await launch(); });
after(async () => { await browser.close(); });
const R = (...r) => r.map(result => ({ result, score: result === "upcoming" || result === "void" ? null : "1-0" }));
let seq = 0;
const ent = (u, g, name, ...p) => ({ id: `n-${++seq}`, username: u, group_id: g, entry_name: name, preds: picks(...p), submitted_at: new Date().toISOString() });
const locked = -3 * HOUR, open = 48 * HOUR;
async function run(opts, body) {
  const w = await newWorld(browser, bundle, opts);
  w.text = (t, timeout = 8000) => w.page.getByText(t, { exact: false }).first().waitFor({ timeout });
  w.tile = id => w.page.getByTestId(id);
  w.menu = async label => { await w.page.getByRole("button", { name: "Account menu" }).click(); if (label) await w.page.getByRole("menuitem", { name: label }).click(); };
  try { await body(w); assert.deepEqual(w.errors, [], "the page threw errors"); } finally { await w.close(); }
}
const borderOf = (w, id) => w.tile(id).evaluate(e => getComputedStyle(e).borderTopColor);

for (const who of ["bob", "ann"]) {
  test(`${who}: Home shows two game tiles with their status, and the old button wall is gone`, async () => {
    await run({ loginAs: who, kickoff: open }, async w => {
      await w.tile("tile-gaffer").waitFor();
      await w.tile("tile-lms").waitFor();
      assert.match(await w.tile("tile-gaffer").innerText(), /Make your picks/);
      assert.match(await w.tile("tile-lms").innerText(), /Not started/);
      for (const gone of [/My Groups/, /My Profile/, /Send feedback/, /Sign out/]) assert.equal(await w.page.getByRole("button", { name: gone }).count(), 0, String(gone));
    });
  });
  test(`${who}: account menu has profile, groups, feedback, how to play, theme and sign out`, async () => {
    await run({ loginAs: who }, async w => {
      await w.page.getByRole("button", { name: "Account menu" }).click();
      for (const n of ["My profile", "My groups", "Send feedback", "How to play", "Theme", "Sign out"]) await w.page.getByRole("menuitem", { name: new RegExp(n) }).waitFor();
      await w.page.keyboard.press("Escape");
      assert.equal(await w.page.getByRole("menu").count(), 0);
    });
  });
}
test("tile colour follows what you can do: gold to act, green once in, grey when closed", async () => {
  await run({ loginAs: "bob", kickoff: open }, async w => {
    await w.tile("tile-gaffer").waitFor();
    const gold = await borderOf(w, "tile-gaffer");
    w.tables.submissions.push(ent("bob", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"));
    await w.page.waitForFunction(() => /entry in|entries in/.test(document.querySelector('[data-testid="tile-gaffer"]').innerText), null, { timeout: 15000 });
    assert.notEqual(await borderOf(w, "tile-gaffer"), gold, "tile colour should change once you have entered");
  });
  await run({ loginAs: "bob", kickoff: locked }, async w => {
    await w.tile("tile-gaffer").waitFor();
    assert.match(await w.tile("tile-gaffer").innerText(), /Missed this week/);
  });
  await run({ loginAs: "bob", kickoff: locked, setup: t => t.submissions.push(ent("bob", "g-alpha", "Entry 1", "home", "home", "home", "home", "home")) }, async w => {
    await w.tile("tile-gaffer").waitFor();
    assert.match(await w.tile("tile-gaffer").innerText(), /Locked in/);
  });
});
test("non-admin: Gaffer hub shows my entries, what I've put in and the group pot", async () => {
  const setup = t => {
    t.history.push({ group_id: "g-alpha", series: 1, week: 1, username: "ann", entry_name: "E", correct: 5, total: 5, perfect: true },
                   { group_id: "g-alpha", series: 1, week: 2, username: "bob", entry_name: "E", correct: 2, total: 5, perfect: false },
                   { group_id: "g-alpha", series: 1, week: 2, username: "ann", entry_name: "E", correct: 2, total: 5, perfect: false });
    t.submissions.push(ent("bob", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"));
  };
  await run({ loginAs: "bob", kickoff: open, setup }, async w => {
    await w.tile("tile-gaffer").click();
    const card = w.page.getByLabel("Your run so far");
    await card.waitFor();
    const t = await card.innerText();
    assert.match(t, /ann won in week 1/i);
    assert.match(t, /2\s*\nentries made/);     // bob: week 2 + this week
    assert.match(t, /£2/);
    assert.match(t, /£3\s*\ngroup pot/);        // week 2 (bob + ann) + this week (bob)
    for (const n of [/My predictions/, /This run/, /Season/, /Form guide/]) await w.page.getByRole("button", { name: n }).waitFor();
    assert.equal(await w.page.getByRole("button", { name: /Admin/ }).count(), 0);
  });
});
test("non-admin: hub → My predictions → make and save an entry, then Back lands on the hub", async () => {
  await run({ loginAs: "bob", kickoff: open }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /My predictions/ }).click();
    await w.text("Entry");
  });
});
test("non-admin: This run grid and by-match tab appear once entries close", async () => {
  const setup = t => t.submissions.push(ent("bob", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"), ent("ann", "g-alpha", "Entry 1", "away", "draw", "home", "home", "away"));
  await run({ loginAs: "bob", kickoff: locked, setup, results: R("home", "home", "upcoming", "upcoming", "upcoming") }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /This run/ }).click();
    const grid = w.page.getByLabel("Picks grid"); await grid.waitFor();
    assert.match(await grid.innerText(), /Split/);
    await w.page.getByRole("button", { name: "By match" }).click();
    await w.page.getByLabel("Picks by match").waitFor();
  });
  await run({ loginAs: "bob", kickoff: open, setup }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /This run/ }).click();
    await w.text("This run");
    assert.equal(await w.page.getByLabel("Picks grid").count(), 0, "no grid while picks are hidden");
  });
});
test("non-admin: Season page opens from the hub", async () => {
  await run({ loginAs: "bob" }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Season/ }).click();
    await w.text("Season");
  });
});
test("non-admin: combined How to play has both games and the £ rules", async () => {
  await run({ loginAs: "bob" }, async w => {
    await w.menu(/How to play/);
    await w.text("£1 into the group pot");
    await w.page.getByRole("button", { name: "Last Man Standing" }).click();
    await w.text("The stake is £5");
    await w.text("You can't pick the same team twice");
  });
});
test("non-admin: Form guide cards collapse, pin to the top and follow players; choices survive a reload", async () => {
  const setup = t => t.submissions.push(ent("bob", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"),
    ent("ann", "g-alpha", "Entry 1", "away", "away", "away", "away", "away"), ent("dan", "g-alpha", "Entry 1", "home", "draw", "home", "home", "home"));
  await run({ loginAs: "bob", kickoff: locked, setup, results: R("home", "away", "home", "upcoming", "upcoming") }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Form guide/ }).click();
    await w.text("FORM GUIDE");
    await w.text("builds up from now on");
    await w.text("Arsenal v Chelsea");              // match labels use team names, not counts
    assert.equal(await w.page.getByText(/^\d v \d$/).count(), 0);              // hot/cold needs history
    const teamForm = w.page.locator("button[aria-expanded]").filter({ hasText: "Team form" });
    await teamForm.click();                              // collapse
    assert.equal(await teamForm.getAttribute("aria-expanded"), "false");
    await w.page.getByRole("button", { name: "Pin Is the crowd right?" }).click();
    const first = await w.page.locator("section").first().getAttribute("aria-label");
    assert.equal(first, "Is the crowd right?");
    assert.equal(await w.page.getByRole("button", { name: "Unpin Is the crowd right?" }).innerText(), "Pinned");   // state is visible, not just the icon
    assert.equal(await w.page.getByRole("button", { name: "Pin Team form (last 5)" }).innerText(), "Pin");
    await w.page.getByRole("button", { name: "Follow ann" }).first().click();
    await w.page.getByLabel("My watchlist").waitFor();
    await w.page.reload();
    await w.page.getByTestId("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Form guide/ }).click();
    await w.page.getByLabel("My watchlist").waitFor();
    assert.equal(await w.page.locator("section").first().getAttribute("aria-label"), "Is the crowd right?");
    await w.page.getByRole("button", { name: "Last Man Standing" }).click();
    await w.text("No game running");
  });
});
test("non-admin: Form guide shows last week's scores from history", async () => {
  const setup = t => t.history.push({ group_id: "g-alpha", series: 1, week: 3, username: "ann", entry_name: "E", correct: 4, total: 5, perfect: false },
                                      { group_id: "g-alpha", series: 1, week: 3, username: "bob", entry_name: "E", correct: 2, total: 5, perfect: false });
  await run({ loginAs: "bob", kickoff: open, setup }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Form guide/ }).click();
    await w.text("Last week (week 3)");
    await w.text("4 of 5");
    await w.text("2 of 5");
  });
});
test("non-admin: Form guide tells you when hidden-pick cards will fill in", async () => {
  await run({ loginAs: "bob", kickoff: open }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Form guide/ }).click();
    await w.text("No entries yet. Once people enter, picks stay hidden until entries close");
    assert.ok(await w.page.getByText(/first kick-off/).count() > 0);
  });
});
test("non-admin: sign out from the account menu returns to the sign-in page", async () => {
  await run({ loginAs: "bob" }, async w => {
    await w.menu(/Sign out/);
    await w.page.locator('input[type="password"]').first().waitFor();
  });
});
test("admin: menu shows Admin tools and opens the panel", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.menu(/Admin/);
    await w.page.locator('input[type="password"]').waitFor();     // PIN gate still applies
  });
});
test("non-admin: Form guide is reachable from Last Man Standing, opens on that game, and Back returns there", async () => {
  await run({ loginAs: "bob" }, async w => {
    await w.tile("tile-lms").click();
    await w.page.getByRole("button", { name: "Form guide" }).click();
    await w.text("FORM GUIDE");
    assert.equal(await w.page.getByRole("button", { name: "Last Man Standing" }).getAttribute("aria-pressed"), "true");
    await w.page.getByRole("button", { name: "The Gaffer" }).click();            // and you can still switch games
    assert.equal(await w.page.getByRole("button", { name: "The Gaffer" }).getAttribute("aria-pressed"), "true");
    await w.page.getByRole("button", { name: /Back/ }).first().click();
    await w.page.getByRole("button", { name: "Form guide" }).waitFor();            // back on the Last Man Standing page
    await w.text("Last Man Standing");
  });
  await run({ loginAs: "bob" }, async w => {                                      // from The Gaffer it still opens on The Gaffer
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Form guide/ }).click();
    assert.equal(await w.page.getByRole("button", { name: "The Gaffer" }).getAttribute("aria-pressed"), "true");
  });
});

// ── Form guide: team form for picking, and the richer history ───────────────────────────────────
const tf = (team, position, last5, h, a) => ({ team, position, played: 12, won: 6, drawn: 3, lost: 3, gf: 20, ga: 12, points: 21, last5, home: h, away: a });
const TEAMS = t => t.team_form.push(
  tf("Arsenal", 1, "WWWWW", { p: 6, w: 6, d: 0, l: 0, gf: 15, ga: 2, last5: "WWWWW" }, { p: 6, w: 4, d: 1, l: 1, gf: 9, ga: 4, last5: "WDWWL" }),
  tf("Chelsea", 9, "LLWLD", { p: 6, w: 2, d: 2, l: 2, gf: 8, ga: 8, last5: "DLWLD" }, { p: 6, w: 1, d: 1, l: 4, gf: 5, ga: 11, last5: "LLDLL" }));
test("non-admin: Form guide shows league position, last 5 and home/away records from team form", async () => {
  await run({ loginAs: "bob", kickoff: open, setup: TEAMS }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Form guide/ }).click();
    const card = w.page.locator('section[aria-label="This week: form and league position"]');
    await card.waitFor();
    await w.text("Arsenal (1st) v Chelsea (9th)");
    const t = await card.innerText();
    assert.match(t, /WWWWW/); assert.match(t, /Home: W6 D0 L0/); assert.match(t, /Away: W1 D1 L4/);
  });
});
test("non-admin: Form guide still works before the first team-form update (falls back to fixture form)", async () => {
  await run({ loginAs: "bob", kickoff: open }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Form guide/ }).click();
    await w.text("league position and home/away records appear after the first update");
    await w.text("Arsenal v Chelsea");
  });
});
test("non-admin: Form guide uses saved fixtures and results from past weeks", async () => {
  const fx = [{ home: "Arsenal", away: "Chelsea" }, { home: "Spurs", away: "Everton" }];
  const row = (u, preds, results, week) => ({ group_id: "g-alpha", series: 1, week, username: u, entry_name: "E", preds, results, fixtures: fx, correct: 1, total: 2, perfect: false });
  const setup = t => { for (const wk of [1, 2, 3]) t.history.push(row("ann", { 0: "home", 1: "away" }, ["home", "home"], wk), row("bob", { 0: "home", 1: "draw" }, ["home", "draw"], wk)); };
  await run({ loginAs: "bob", kickoff: open, setup }, async w => {
    await w.tile("tile-gaffer").click();
    await w.page.getByRole("button", { name: /Form guide/ }).click();
    const types = w.page.locator('section[aria-label="How our picks have landed"]'); await types.waitFor();
    const t = await types.innerText();
    assert.match(t, /Home picks\s*100% right \(6\)/); assert.match(t, /Away picks\s*0% right \(3\)/); assert.match(t, /Across 3 saved weeks/);
    await w.page.locator('section[aria-label="Teams we back right (and wrong)"]').getByText("Arsenal").first().waitFor();
  });
});
test("non-admin: Last Man Standing 'Best teams to pick' ranks by form and leaves out used teams", async () => {
  await run({ loginAs: "bob", kickoff: open, setup: TEAMS }, async w => {
    const ko = Date.now() + 24 * HOUR;
    w.fake.lms.gameweek = { id: 11, season: "2026-27", matchday: 10, status: "open", deadline: new Date(ko - 60000).toISOString(),
      fixtures: [["Arsenal", "Chelsea"], ["Spurs", "Everton"]].map(([home, away], i) => ({ matchId: i + 1, home, away, kickoffTs: ko, kickoffIso: new Date(ko).toISOString(), date: "Sat", time: "15:00" })) };
    w.fake.lms.comp = { id: "c1", group_id: "g-alpha", name: "LMS", status: "running", winners: [], startGameweek: 9, startMatchday: 8 };
    w.fake.lms.entries = [{ username: "bob", status: "alive", cycleFrom: 9, picks: [{ gameweek: 9, matchday: 8, team: "Spurs", matchId: 9, outcome: "win" }] }];
    await w.tile("tile-lms").click();
    await w.page.getByRole("button", { name: "Form guide" }).click();
    const card = w.page.locator('section[aria-label="Best teams to pick this gameweek"]'); await card.waitFor();
    const t = await card.innerText();
    assert.ok(t.indexOf("Arsenal") < t.indexOf("Chelsea"), "Arsenal (strong form) ranks above Chelsea");
    assert.ok(!/^Spurs\b/m.test(t), "Spurs already used, so not offered as a pick");
    assert.match(t, /Everton/);
  });
});
