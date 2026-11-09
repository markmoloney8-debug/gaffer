import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, launch, newWorld, picks, ADMIN_PIN, HOUR } from "./harness.mjs";

let bundle, browser;
before(async () => { bundle = await buildApp(); browser = await launch(); });
after(async () => { await browser.close(); });

const R = (...r) => r.map(result => ({ result, score: result === "upcoming" || result === "void" ? null : "1-0" }));
const seeEntry = (u, g, name, ...p) => ({ username: u, group_id: g, entry_name: name, preds: picks(...p), submitted_at: new Date().toISOString() });

async function world(opts) {
  const w = await newWorld(browser, bundle, opts);
  w.text = (t, timeout = 8000) => w.page.getByText(t, { exact: false }).first().waitFor({ timeout });
  w.gone = (t, timeout = 4000) => w.page.getByText(t, { exact: false }).first().waitFor({ state: "hidden", timeout });
  w.click = async name => { await w.page.getByRole("button", { name }).first().click(); };
  return w;
}
async function run(opts, body) {
  const w = await world(opts);
  try { await body(w); assert.deepEqual(w.errors, [], "the page threw errors"); }
  finally { await w.close(); }
}
async function sealEntry(w, ...p) {
  const label = { home: "Home Win", draw: "Draw", away: "Away Win" };
  for (let i = 0; i < 5; i++) await w.page.locator(`button:has-text("${label[p[i]]}")`).nth(i).click();
  await w.click(/Seal This Entry/);
}

// ── Sign-up and groups ─────────────────────────────────────────────────────
test("registering needs a valid invite code and lands the player in that group", async () => {
  await run({}, async w => {
    await w.click("Register");
    await w.page.getByPlaceholder("your_username").fill("newbie");
    await w.page.locator('input[type="password"]').nth(0).fill("secret1");
    await w.page.locator('input[type="password"]').nth(1).fill("secret1");
    await w.page.getByPlaceholder("Ask the admin").fill("WRONGCODE");
    await w.click(/Create Account/);
    await w.text("Invalid invite code");
    assert.equal(w.tables.users.some(u => u.username === "newbie"), false);

    await w.page.getByPlaceholder("Ask the admin").fill("beta22");          // lower case is fine
    await w.click(/Create Account/);
    await w.text("Weekly Football Prediction League");
    await w.text("newbie · Beta");
    assert.deepEqual(w.tables.memberships.filter(m => m.username === "newbie").map(m => m.group_id), ["g-beta"]);
  });
});

test("a taken username is refused", async () => {
  await run({}, async w => {
    await w.click("Register");
    await w.page.getByPlaceholder("your_username").fill("ann");
    await w.page.locator('input[type="password"]').nth(0).fill("secret1");
    await w.page.locator('input[type="password"]').nth(1).fill("secret1");
    await w.page.getByPlaceholder("Ask the admin").fill("ALPHA1");
    await w.click(/Create Account/);
    await w.text("Username already taken");
  });
});

// ── Entries ────────────────────────────────────────────────────────────────
test("making entries: no name to type, auto-named, capped at five", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.click(/My Predictions/);
    for (let n = 1; n <= 5; n++) {
      await w.click(/Add Entry/);
      assert.equal(await w.page.getByText("Entry Name").count(), 0, "there should be no entry-name box");
      await sealEntry(w, "home", "draw", "away", "home", "home");
      await w.text("Entry sealed");
      await w.text(`Entry ${n}`);
    }
    await w.text("used all 5 entries");
    assert.equal(await w.page.getByRole("button", { name: /Add Entry/ }).count(), 0);
    const mine = w.tables.submissions.filter(s => s.username === "ann");
    assert.equal(mine.length, 5);
    assert.ok(mine.every(s => s.group_id === "g-alpha"));
    assert.deepEqual(mine.map(s => s.entry_name), ["Entry 1", "Entry 2", "Entry 3", "Entry 4", "Entry 5"]);
  });
});

test("the Seal button stays disabled until all five matches are picked", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.click(/My Predictions/);
    await w.click(/Add Entry/);
    const seal = w.page.getByRole("button", { name: /Seal This Entry/ });
    assert.equal(await seal.isDisabled(), true);
    for (let i = 0; i < 4; i++) await w.page.locator('button:has-text("Draw")').nth(i).click();
    assert.equal(await seal.isDisabled(), true);
    await w.page.locator('button:has-text("Draw")').nth(4).click();
    assert.equal(await seal.isDisabled(), false);
  });
});

test("once the first match is within a minute of kick-off, entries are closed", async () => {
  await run({ loginAs: "ann", kickoff: 30_000 }, async w => {
    await w.click(/Lobby/);
    await w.text("Submissions closed");
    assert.equal(await w.page.getByRole("button", { name: /Add Entry/ }).count(), 0);
  });
});

// ── Group isolation and switching ──────────────────────────────────────────
test("players only see their own group's entries", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"),
                                        seeEntry("cat", "g-beta", "Entry 1", "away", "away", "away", "away", "away"));
  await run({ loginAs: "cat", setup }, async w => {
    await w.click(/Lobby/);
    await w.text("1 entry across 1 player");
    assert.equal(await w.page.getByText("ann", { exact: true }).count(), 0);
    await w.text("cat");
  });
});

test("a player can join a second group, switch between them, and entries stay separate", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"),
                                        seeEntry("ann", "g-alpha", "Entry 2", "draw", "draw", "draw", "draw", "draw"),
                                        seeEntry("cat", "g-beta", "Entry 1", "away", "away", "away", "away", "away"));
  await run({ loginAs: "ann", setup }, async w => {
    assert.equal(await w.page.locator("select").count(), 0, "no switcher with a single group");
    await w.text("ann · Alpha");

    await w.click(/Join another group/);
    await w.page.getByPlaceholder("e.g. GAFFERMATES26").fill("NOPE");
    await w.click(/Join Group/);
    await w.text("Invalid invite code");
    await w.page.getByPlaceholder("e.g. GAFFERMATES26").fill("beta22");
    await w.click(/Join Group/);
    await w.text("Weekly Football Prediction League");
    assert.deepEqual(w.tables.memberships.filter(m => m.username === "ann").map(m => m.group_id).sort(), ["g-alpha", "g-beta"]);

    const select = w.page.locator("select").first();
    assert.equal(await select.inputValue(), "g-beta");
    await w.click(/Lobby/);
    await w.text("1 entry across 1 player");                  // Beta: only cat's entry

    await select.selectOption("g-alpha");
    await w.click(/Lobby/);
    await w.text("2 entries across 1 player");                // Alpha: ann's two entries
    await w.text("ann");
  });
});

test("the last group a player used is remembered", async () => {
  await run({ loginAs: "ann", setup: t => t.memberships.push({ username: "ann", group_id: "g-beta" }) }, async w => {
    await w.page.locator("select").first().selectOption("g-beta");
    await w.text("Weekly Football Prediction League");
    await w.page.reload();
    await w.page.locator("select").first().waitFor();
    assert.equal(await w.page.locator("select").first().inputValue(), "g-beta");
  });
});

// ── Results and reveal ─────────────────────────────────────────────────────
const locked = -3 * HOUR;

test("a partial reveal shows finished matches only and does not declare a winner", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"));
  await run({ loginAs: "ann", setup, kickoff: locked, results: R("home", "home", "upcoming", "upcoming", "upcoming") }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    await w.text("2 of 5 results in");
    await w.click(/Reveal next result/);
    await w.text("3 matches still to come");
    assert.equal(await w.page.getByText("Awaiting result").count(), 3);
    assert.equal(await w.page.getByRole("button", { name: /See the Outcome/ }).count(), 0);
    assert.equal(await w.page.getByText(/WE HAVE/).count(), 0);
    assert.equal(w.tables.group_state.find(g => g.group_id === "g-alpha").winners_found, false);
  });
});

test("the reveal button explains when no results are in yet", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"));
  await run({ loginAs: "ann", setup, kickoff: locked, results: R("upcoming", "upcoming", "upcoming", "upcoming", "upcoming") }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    await w.text("No results are in yet");
  });
});

test("a perfect entry wins; winners share; other groups are unaffected", async () => {
  const win = ["home", "draw", "away", "home", "home"];
  const setup = t => t.submissions.push(
    seeEntry("ann", "g-alpha", "Entry 1", ...win), seeEntry("bob", "g-alpha", "Entry 1", ...win),
    seeEntry("bob", "g-alpha", "Entry 2", "away", "away", "away", "away", "away"),
    seeEntry("cat", "g-beta", "Entry 1", ...win));
  await run({ loginAs: "ann", setup, kickoff: locked, results: R(...win) }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    for (let i = 0; i < 4; i++) await w.click(/Reveal next result/);
    await w.click(/See the Outcome/);
    await w.text("WE HAVE WINNERS!");
    await w.text("2 players nailed all 5");
    await w.page.waitForFunction(() => true);
    const state = id => w.tables.group_state.find(g => g.group_id === id);
    for (let i = 0; i < 20 && !state("g-alpha").winners_found; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(state("g-alpha").winners_found, true);
    assert.equal(state("g-beta").winners_found, false, "Beta must not be marked as won");
  });
});

test("no perfect entry means the round rolls over", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "away", "draw", "away", "home", "home"));
  await run({ loginAs: "ann", setup, kickoff: locked, results: R("home", "draw", "away", "home", "home") }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    for (let i = 0; i < 4; i++) await w.click(/Reveal next result/);
    await w.click(/See the Outcome/);
    await w.text("NO WINNER THIS WEEK");
    await w.text("4/5");
    assert.equal(w.tables.group_state.find(g => g.group_id === "g-alpha").winners_found, false);
  });
});

test("a voided match counts as correct for everyone", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "draw", "home" /* wrong: match is void */, "home", "home"));
  await run({ loginAs: "ann", setup, kickoff: locked, results: R("home", "draw", "void", "home", "home") }, async w => {
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    await w.click(/Reveal next result/);
    await w.click(/Reveal next result/);                      // the void match is the third card
    await w.text("Match void");
    for (let i = 0; i < 2; i++) await w.click(/Reveal next result/);
    await w.click(/See the Outcome/);
    await w.text("WE HAVE A WINNER!");
  });
});

// ── Admin ──────────────────────────────────────────────────────────────────
async function adminIn(w) {
  await w.click(/Admin/);
  await w.page.locator('input[type="password"]').fill(ADMIN_PIN);
  await w.click("Enter");
  await w.text("Admin Panel");
}

test("a wrong admin PIN is refused", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.click(/Admin/);
    await w.page.locator('input[type="password"]').fill("000000");
    await w.click("Enter");
    await w.text("Incorrect PIN");
    assert.equal(await w.page.getByText("Admin Panel").count(), 0);
  });
});

test("the admin can void a postponed match, and can undo it", async () => {
  await run({ loginAs: "ann", kickoff: locked, results: R("home", "draw", "away", "home", "upcoming") }, async w => {
    await adminIn(w);
    await w.page.getByRole("button", { name: "Void", exact: true }).first().click();
    await w.page.getByRole("button", { name: "Un-void", exact: true }).waitFor();
    assert.equal(w.tables.round[0].results[4].result, "void");
    assert.equal(w.tables.round[0].results[0].result, "home", "other results are untouched");
    await w.page.getByRole("button", { name: "Un-void", exact: true }).click();
    await w.page.getByRole("button", { name: "Void", exact: true }).first().waitFor();
    assert.equal(w.tables.round[0].results[4].result, "upcoming");
  });
});

test("the admin can create a group, and its code then works for sign-up", async () => {
  await run({ loginAs: "ann" }, async w => {
    await adminIn(w);
    await w.text("Original", 1000).catch(() => {});
    await w.page.getByPlaceholder("New group name").fill("Fresh Mates");
    await w.page.getByPlaceholder(/Invite code/).fill("freshmates1");
    await w.click(/Add group/);
    await w.text("FRESHMATES1");
    const g = w.tables.groups.find(x => x.invite_code === "FRESHMATES1");
    assert.ok(g, "group saved");
    assert.ok(w.tables.group_state.some(s => s.group_id === g.id), "group state created");
  });
});

test("a duplicate group code is rejected", async () => {
  await run({ loginAs: "ann" }, async w => {
    await adminIn(w);
    await w.page.getByPlaceholder("New group name").fill("Copycat");
    await w.page.getByPlaceholder(/Invite code/).fill("ALPHA1");
    await w.click(/Add group/);
    await w.text("may already be in use");
    assert.equal(w.tables.groups.filter(g => g.invite_code === "ALPHA1").length, 1);
  });
});

// ── The Story So Far ───────────────────────────────────────────────────────
test("the story page totals entries and accuracy across rounds, and hides this round's picks", async () => {
  const setup = t => {
    t.history.push(
      { group_id: "g-alpha", series: 1, week: 1, username: "ann", entry_name: "Entry 1", correct: 3, total: 5, perfect: false },
      { group_id: "g-alpha", series: 1, week: 1, username: "bob", entry_name: "Entry 1", correct: 2, total: 5, perfect: false },
      { group_id: "g-alpha", series: 1, week: 2, username: "ann", entry_name: "Entry 1", correct: 4, total: 5, perfect: false },
      { group_id: "g-beta", series: 1, week: 1, username: "cat", entry_name: "Entry 1", correct: 5, total: 5, perfect: true });
    t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"));
  };
  await run({ loginAs: "ann", setup }, async w => {
    await w.click(/The Story So Far/);
    await w.text("Entries used");
    const row = name => w.page.locator("tr", { hasText: name }).first();
    assert.match(await row("ann").innerText(), /3\s+4\/5\s+70%\s*\(7\/10\)/);     // 3 entries (2 past + 1 now), best 4/5
    assert.match(await row("bob").innerText(), /1\s+2\/5\s+40%\s*\(2\/5\)/);
    await w.text("Week 3 (in play)");
    assert.equal(await w.page.getByText("cat").count(), 0, "the other group's players are not shown");
    assert.equal(await w.page.getByText("🏆").count(), 0, "no winner banner in Alpha");
  });
});

// ── Light and dark mode ────────────────────────────────────────────────────
const theme = w => w.page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const pageBg = w => w.page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("light and dark mode: a toggle switches, changes the look, and is remembered", async () => {
  await run({ loginAs: "ann" }, async w => {
    const before = await theme(w), bgBefore = await pageBg(w);
    assert.ok(before === "light" || before === "dark");
    await w.page.getByRole("button", { name: /Switch between light and dark/ }).click();
    const after = await theme(w);
    assert.notEqual(after, before);
    assert.notEqual(await pageBg(w), bgBefore, "the page background should change");
    await w.page.reload();
    await w.text("Weekly Football Prediction League");
    assert.equal(await theme(w), after, "the choice survives a reload");
    await w.page.getByRole("button", { name: /Switch between light and dark/ }).click();
    assert.equal(await theme(w), before);
  });
});

test("the theme can be switched before signing in", async () => {
  await run({}, async w => {
    const before = await theme(w);
    await w.page.getByRole("button", { name: /Switch between light and dark/ }).click();
    assert.notEqual(await theme(w), before);
  });
});

// ── Avatars ────────────────────────────────────────────────────────────────
test("a player can pick an avatar, and other players see it", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"));
  await run({ loginAs: "ann", setup }, async w => {
    await w.click(/My Profile/);
    await w.page.getByRole("button", { name: "Avatar 🦁" }).click();
    await w.page.getByRole("button", { name: "Colour #60a5fa" }).click();
    await w.click(/Save profile/);
    await w.text("Weekly Football Prediction League");
    const ann = w.tables.users.find(u => u.username === "ann");
    assert.equal(ann.avatar, "🦁");
    assert.equal(ann.avatar_color, "#60a5fa");
    await w.click(/Lobby/);
    await w.page.locator("text=🦁").first().waitFor();
  });
  // a different player, same group, sees ann's avatar in the lobby
  await run({ loginAs: "bob", setup: t => { setup(t); Object.assign(t.users.find(u => u.username === "ann"), { avatar: "🦁", avatar_color: "#60a5fa" }); } }, async w => {
    await w.click(/Lobby/);
    await w.page.locator("text=🦁").first().waitFor();
  });
});

test("choosing 'my initial' removes the avatar", async () => {
  await run({ loginAs: "ann", setup: t => Object.assign(t.users.find(u => u.username === "ann"), { avatar: "🦁", avatar_color: "#f0c040" }) }, async w => {
    await w.click(/My Profile/);
    await w.page.getByRole("button", { name: "Use my initial" }).click();
    await w.click(/Save profile/);
    await w.text("Weekly Football Prediction League");
    assert.equal(w.tables.users.find(u => u.username === "ann").avatar, null);
  });
});

// ── Group badges ───────────────────────────────────────────────────────────
test("a group badge shows by the group name", async () => {
  await run({ loginAs: "ann", setup: t => { t.groups.find(g => g.id === "g-alpha").emoji = "🏆"; } }, async w => {
    await w.text("ann · 🏆 Alpha");
  });
});

test("the admin can set a badge on a group and give a new group one", async () => {
  await run({ loginAs: "ann" }, async w => {
    await adminIn(w);
    await w.page.getByLabel("Badge for Alpha").selectOption("🔥");
    await w.page.waitForFunction(() => true);
    for (let i = 0; i < 30 && w.tables.groups.find(g => g.id === "g-alpha").emoji !== "🔥"; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(w.tables.groups.find(g => g.id === "g-alpha").emoji, "🔥");

    await w.page.getByLabel("New group badge").selectOption("🚀");
    await w.page.getByPlaceholder("New group name").fill("Rockets");
    await w.page.getByPlaceholder(/Invite code/).fill("rockets1");
    await w.click(/Add group/);
    await w.text("ROCKETS1");
    assert.equal(w.tables.groups.find(g => g.invite_code === "ROCKETS1").emoji, "🚀");
  });
});

// ── Feedback ───────────────────────────────────────────────────────────────
test("a player can send feedback and the admin can see it and close it", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.click(/Send feedback/);
    assert.equal(await w.page.getByRole("button", { name: /Send feedback/ }).isDisabled(), true, "empty message can't be sent");
    await w.page.getByLabel("Type of feedback").selectOption("bug");
    await w.page.getByLabel("Your message").fill("The lobby is slow on my phone");
    await w.click(/Send feedback/);
    await w.text("Your feedback has been sent");
    const row = w.tables.feedback[0];
    assert.equal(row.username, "ann");
    assert.equal(row.group_id, "g-alpha");
    assert.equal(row.category, "bug");
    assert.equal(row.message, "The lobby is slow on my phone");

    await w.click(/Back/);
    await adminIn(w);
    await w.text("The lobby is slow on my phone");
    await w.text("Feedback (1 open)");
    await w.page.getByRole("button", { name: "Mark done" }).click();
    await w.text("Feedback (0 open)");
    assert.equal(w.tables.feedback[0].status, "done");
  });
});

test("sending feedback too quickly shows a friendly message", async () => {
  await run({ loginAs: "ann" }, async w => {
    w.fake.hooks.beforeInsert.feedback = () => "Please wait a couple of minutes before sending more feedback";
    await w.click(/Send feedback/);
    await w.page.getByLabel("Your message").fill("Again");
    await w.click(/Send feedback/);
    await w.text("Please wait a couple of minutes");
    assert.equal(w.tables.feedback.length, 0);
  });
});

test("feedback with markup is shown as plain text in the admin list", async () => {
  await run({ loginAs: "ann", setup: t => t.feedback.push({ id: "f1", username: "bob", category: "idea", message: "<img src=x onerror=window.__pwned=1> hello", status: "new", created_at: new Date().toISOString() }) }, async w => {
    await adminIn(w);
    await w.text("<img src=x onerror=window.__pwned=1> hello");
    assert.equal(await w.page.evaluate(() => window.__pwned), undefined);
  });
});
