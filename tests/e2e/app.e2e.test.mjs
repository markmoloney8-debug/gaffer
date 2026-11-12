import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

// ── Invite links, sharing, own groups, stats ───────────────────────────────
test("a short password is refused at sign-up, with a hint to use a unique one", async () => {
  await run({}, async w => {
    await w.click("Register");
    await w.text("password you don't use anywhere else");
    await w.page.getByPlaceholder("your_username").fill("newbie");
    await w.page.locator('input[type="password"]').nth(0).fill("abc");
    await w.page.locator('input[type="password"]').nth(1).fill("abc");
    await w.page.getByPlaceholder("Ask the admin").fill("ALPHA1");
    await w.click(/Create Account/);
    await w.text("at least 6 characters");
    assert.equal(w.tables.users.some(u => u.username === "newbie"), false);
  });
});

test("an invite link opens sign-up with the code filled in", async () => {
  await run({ path: "/?join=beta22" }, async w => {
    await w.text("Confirm Password");
    assert.equal(await w.page.getByPlaceholder("Ask the admin").inputValue(), "BETA22");
    await w.page.getByPlaceholder("your_username").fill("newbie");
    await w.page.locator('input[type="password"]').nth(0).fill("secret1");
    await w.page.locator('input[type="password"]').nth(1).fill("secret1");
    await w.click(/Create Account/);
    await w.text("newbie · Beta");
  });
});

test("a signed-in player opening an invite link lands on Join with the code filled in", async () => {
  await run({ loginAs: "ann", path: "/?join=BETA22" }, async w => {
    await w.text("Join Another Group");
    assert.equal(await w.page.getByPlaceholder("e.g. GAFFERMATES26").inputValue(), "BETA22");
    await w.click(/Join Group/);
    await w.text("Weekly Football Prediction League");
    assert.ok(w.tables.memberships.some(m => m.username === "ann" && m.group_id === "g-beta"));
  });
});

test("sharing an invite copies a link that opens straight to sign-up", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://gaffer.test" });
    await w.click(/Join another group/);
    await w.text("Invite friends to Alpha");
    await w.click(/Share invite link/);
    await w.text("Invite copied");
    const clip = await w.page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /https:\/\/gaffer\.test\/\?join=ALPHA1/);
    assert.match(clip, /Alpha/);
  });
});

test("a player can start their own group, becomes its first member, and gets a working code", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.click(/Join another group/);
    await w.page.getByLabel("New group name").fill("Sunday League");
    await w.click(/Create group/);
    await w.text("Weekly Football Prediction League");
    const g = w.tables.groups.find(x => x.name === "Sunday League");
    assert.ok(g, "group saved");
    assert.equal(g.created_by, "ann");
    assert.match(g.invite_code, /^[A-Z0-9]{8}$/);
    assert.ok(w.tables.memberships.some(m => m.username === "ann" && m.group_id === g.id));
    assert.ok(w.tables.group_state.some(s => s.group_id === g.id), "run state created");
    assert.equal(await w.page.locator("select").first().inputValue(), g.id, "switched into the new group");
  });
});

test("hitting the group limit shows a friendly message and creates nothing", async () => {
  await run({ loginAs: "ann" }, async w => {
    w.fake.hooks.beforeInsert.groups = () => "Group limit reached (3 per player)";
    const before = w.tables.groups.length;
    await w.click(/Join another group/);
    await w.page.getByLabel("New group name").fill("One too many");
    await w.click(/Create group/);
    await w.text("up to 3 of your own");
    assert.equal(w.tables.groups.length, before);
  });
});

test("the profile page shows a player's stats from completed rounds", async () => {
  const setup = t => t.history.push(
    { group_id: "g-alpha", series: 1, week: 1, username: "ann", entry_name: "Entry 1", correct: 3, total: 5, perfect: false },
    { group_id: "g-alpha", series: 1, week: 2, username: "ann", entry_name: "Entry 1", correct: 4, total: 5, perfect: false },
    { group_id: "g-alpha", series: 2, week: 1, username: "ann", entry_name: "Entry 1", correct: 5, total: 5, perfect: true },
    { group_id: "g-alpha", series: 1, week: 1, username: "bob", entry_name: "Entry 1", correct: 0, total: 5, perfect: false });
  await run({ loginAs: "ann", setup }, async w => {
    await w.click(/My Profile/);
    const stats = w.page.getByLabel("Your stats");
    await stats.waitFor();
    const text = await stats.innerText();
    assert.match(text, /3\s+ENTRIES/i);
    assert.match(text, /80%/);                         // 12 of 15
    assert.match(text, /5\/5/);
    assert.match(text, /3\s+PER WIN/i);
    assert.match(text, /1 win/);
  });
});

test("a player with no completed rounds sees dashes, not NaN", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.click(/My Profile/);
    await w.page.getByLabel("Your stats").waitFor();
    assert.doesNotMatch(await w.page.getByLabel("Your stats").innerText(), /NaN|undefined/);
  });
});

test("the winners can share their result", async () => {
  const win = ["home", "draw", "away", "home", "home"];
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", ...win));
  await run({ loginAs: "ann", setup, kickoff: locked, results: R(...win) }, async w => {
    await w.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://gaffer.test" });
    await w.click(/Lobby/);
    await w.click(/Check Results/);
    for (let i = 0; i < 4; i++) await w.click(/Reveal next result/);
    await w.click(/See the Outcome/);
    await w.text("WE HAVE A WINNER");
    await w.click(/Share result/);
    await w.text("Copied");
    assert.match(await w.page.evaluate(() => navigator.clipboard.readText()), /ann got all 5 right/);
  });
});

test("My Entries shows each fixture with the team picked", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "draw", "away", "home", "away"));
  await run({ loginAs: "ann", setup }, async w => {
    await w.click(/Lobby/);
    await w.click(/My Entries/);
    const list = w.page.getByLabel("Entry 1 picks");
    await list.waitFor();
    const text = await list.innerText();
    assert.match(text, /Arsenal v Chelsea\s+🏠 Arsenal win/);
    assert.match(text, /Man City v Liverpool\s+🤝? ?Draw/);
    assert.match(text, /Spurs v Man Utd\s+\S+ Man Utd win/);
    assert.match(text, /Brighton v Wolves\s+\S+ Wolves win/);
  });
});

test("new entry cards show each team's recent form, and nothing when there is none", async () => {
  const setup = t => {
    const fx = t.round[0].fixtures;
    fx[0].form = { home: ["W", "W", "D", "L", "W"], away: ["L", "L", "D", "W", "L"] };
  };
  await run({ loginAs: "ann", setup }, async w => {
    await w.click(/Lobby/);
    await w.click(/My Entries/);
    await w.click(/Add Entry/);
    const home = w.page.getByLabel("Arsenal recent form: W W D L W");
    await home.waitFor();
    await w.page.getByLabel("Chelsea recent form: L L D W L").waitFor();
    assert.equal(await w.page.getByLabel(/recent form/).count(), 2, "only the fixture that has form shows any");
    assert.equal(await w.page.getByText("Form", { exact: true }).count(), 1);
  });
});

test("the lobby shows how many entries each player has, not their auto-names, and the countdown includes days", async () => {
  const setup = t => t.submissions.push(seeEntry("ann", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"),
                                        seeEntry("bob", "g-alpha", "Entry 1", "away", "away", "away", "away", "away"),
                                        seeEntry("bob", "g-alpha", "Entry 2", "draw", "draw", "draw", "draw", "draw"));
  await run({ loginAs: "ann", setup }, async w => {          // kick-off is 48h away in the harness
    await w.click(/Lobby/);
    await w.text("1 entry");
    await w.text("2 entries");
    assert.equal(await w.page.getByText(/Entry 1/).count(), 0, "auto-names are not listed");
    await w.text(/^\d+d \d\d:\d\d:\d\d$/);
  });
});

// ── Real sign-in ───────────────────────────────────────────────────────────
async function signIn(w, name, pw) {
  await w.page.getByPlaceholder("your_username").fill(name);
  await w.page.locator('input[type="password"]').first().fill(pw);
  await w.click(/Sign In →/);
}

test("signing in: the right password gets you in (any letter case), a wrong one does not", async () => {
  await run({}, async w => {
    await signIn(w, "ann", "wrong-one");
    await w.text("Wrong username or password");
    await signIn(w, "ANN", "secret1");
    await w.text("ann · Alpha");
  });
});

test("an old-style account signs in with the same password and is moved to the new sign-in", async () => {
  await run({}, async w => {
    await signIn(w, "Old Timer", "nope");
    await w.text("Wrong username or password");
    assert.equal(w.tables.users.find(u => u.username === "Old Timer").auth_id, null, "a wrong password changes nothing");
    await signIn(w, "old timer", "hunter22");
    await w.text("Old Timer · Alpha");
    const row = w.tables.users.find(u => u.username === "Old Timer");
    assert.ok(row.auth_id); assert.equal(row.password_hash, null);
  });
});

test("an old password that is too short gets a clear explanation", async () => {
  await run({ setup: t => t.users.push({ username: "Shorty", handle: "shorty", auth_id: null, password_hash: createHash("sha256").update("abcd").digest("hex") }) }, async w => {
    await signIn(w, "Shorty", "abcd");
    await w.text("too short for the new sign-in");
  });
});

test("staying signed in: a player whose token is out of date is renewed without being asked again", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.page.evaluate(() => { const a = JSON.parse(localStorage.getItem("fp_auth")); a.expires_at = Date.now() - 1000; localStorage.setItem("fp_auth", JSON.stringify(a)); });
    await w.page.reload();
    await w.text("ann · Alpha");
    assert.ok(await w.page.evaluate(() => JSON.parse(localStorage.getItem("fp_auth")).expires_at > Date.now() + 60000), "renewed");
  });
});

test("signing out removes the sign-in token", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.click("Sign out");
    await w.text("Sign In →");
    assert.equal(await w.page.evaluate(() => localStorage.getItem("fp_auth")), null);
  });
});

test("forgot password: a request is saved for the admin; asking again too soon is explained", async () => {
  await run({}, async w => {
    await w.click("Forgot password?");
    await w.page.getByPlaceholder("your_username").fill("Dave from the pub");
    await w.page.getByPlaceholder(/pub league/).fill("Pete's mate");
    await w.click("Send reset request");
    await w.text("Request sent");
    assert.deepEqual(w.tables.reset_requests.map(r => [r.username, r.note, r.status]), [["Dave from the pub", "Pete's mate", "new"]]);
    w.fake.hooks.beforeInsert.reset_requests = () => "Please wait a few minutes before asking again";
    await w.click("Send reset request");
    await w.text("already asked recently");
    assert.equal(w.tables.reset_requests.length, 1);
  });
});

test("forgot password needs a username first", async () => {
  await run({}, async w => {
    await w.click("Forgot password?");
    await w.click("Send reset request");
    await w.text("Type your username first");
    assert.equal(w.tables.reset_requests.length, 0);
  });
});

test("the admin sees reset requests, sets a temporary password, and the player can then sign in with it", async () => {
  await run({ loginAs: "ann", setup: t => t.reset_requests.push({ id: "rr1", username: "bob", note: "Bob here, locked out", status: "new", created_at: new Date().toISOString() }) }, async w => {
    await adminIn(w);
    await w.text("Password resets (1 waiting)");
    await w.text("Bob here, locked out");
    await w.click("Set temporary password");
    await w.text("Temporary password for");
    const temp = w.fake.logins.find(l => l.username === "bob").password;
    assert.notEqual(temp, "secret1");
    await w.text(temp);
    await w.text("Nobody is waiting");
    assert.equal(w.tables.reset_requests[0].status, "done");
    await w.page.goto("https://gaffer.test/");                      // fresh page, then bob signs in with the temporary password
    await w.click("Sign out");
    await signIn(w, "bob", temp);
    await w.text("bob · Alpha");
  });
});

test("the admin can dismiss a reset request without changing anyone's password", async () => {
  await run({ loginAs: "ann", setup: t => t.reset_requests.push({ id: "rr1", username: "bob", status: "new", created_at: new Date().toISOString() }) }, async w => {
    await adminIn(w);
    await w.click("Dismiss");
    await w.text("Nobody is waiting");
    assert.equal(w.fake.logins.find(l => l.username === "bob").password, "secret1");
  });
});

test("a player can change their own password, then sign in with the new one only", async () => {
  await run({ loginAs: "ann" }, async w => {
    await w.page.getByRole("button", { name: "Profile" }).first().click().catch(async () => { await w.page.getByLabel(/profile/i).first().click(); });
    await w.page.getByLabel("New password").fill("abc");
    await w.click("Change");
    await w.text("at least 6 characters");
    await w.page.getByLabel("New password").fill("brand-new-1");
    await w.click("Change");
    await w.text("Password changed");
    await w.click(/Back/);
    await w.click("Sign out");
    await signIn(w, "ann", "secret1");
    await w.text("Wrong username or password");
    await signIn(w, "ann", "brand-new-1");
    await w.text("ann · Alpha");
  });
});

test("other players' picks are not sent to the browser until entries close", async () => {
  const setup = t => t.submissions.push(seeEntry("bob", "g-alpha", "Entry 1", "home", "home", "home", "home", "home"), seeEntry("ann", "g-alpha", "Entry 1", "away", "away", "away", "away", "away"));
  await run({ loginAs: "ann", setup }, async w => {                 // kick-off is 48 hours away
    await w.text("ann · Alpha");
    const seen = await w.page.evaluate(async () => {
      const a = JSON.parse(localStorage.getItem("fp_auth"));
      const r = await fetch("https://oszrnwhyvmvccxxepsnm.supabase.co/rest/v1/rpc/group_entries", { method: "POST", headers: { Authorization: `Bearer ${a.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ gid: "g-alpha" }) });
      return r.json();
    });
    assert.deepEqual(seen.find(x => x.username === "bob").preds, {});
    assert.equal(Object.keys(seen.find(x => x.username === "ann").preds).length, 5);
  });
});
