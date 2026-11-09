// Builds the app and gives each test a fresh phone-sized browser with a fake Supabase behind it.
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFakeSupabase } from "./fake-supabase.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORIGIN = "https://gaffer.test";
export const ADMIN_PIN = "085419";                       // must match ADMIN_PIN in src/App.jsx
export const HOUR = 3600e3;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="root"></div><script src="/app.js"></script></body></html>`;

export async function buildApp() {
  const result = await build({
    stdin: {
      contents: `import { createRoot } from "react-dom/client";
                 import App from "./src/App.jsx";
                 createRoot(document.getElementById("root")).render(<App />);`,
      resolveDir: path.join(here, "../.."), loader: "jsx",
    },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error",
  });
  return result.outputFiles[0].text;
}

export async function launch() { return chromium.launch(); }

export const fixtures = (firstKickoffOffsetMs) => [
  ["Arsenal", "Chelsea"], ["Man City", "Liverpool"], ["Spurs", "Man Utd"], ["Villa", "Newcastle"], ["Brighton", "Wolves"],
].map(([home, away], i) => {
  const ts = Date.now() + firstKickoffOffsetMs + i * HOUR;
  return { matchId: 100 + i, home, away, date: "Sat 7 Nov", time: "15:00", kickoffIso: new Date(ts).toISOString(), kickoffTs: ts };
});

export const picks = (...p) => Object.fromEntries(p.map((v, i) => [String(i), v]));

// A fresh world: two groups (Alpha / Beta), a round, and any extra setup the test wants.
export async function newWorld(browser, bundle, { loginAs, setup, kickoff = 48 * HOUR, results = null } = {}) {
  const fake = createFakeSupabase();
  const { tables } = fake;
  tables.groups.push({ id: "g-alpha", name: "Alpha", invite_code: "ALPHA1" }, { id: "g-beta", name: "Beta", invite_code: "BETA22" });
  tables.group_state.push({ group_id: "g-alpha", series: 1, winners_found: false }, { group_id: "g-beta", series: 1, winners_found: false });
  tables.round.push({ id: 1, league: { id: "epl", name: "Premier League", flag: "⚽", code: "PL" }, fixtures: fixtures(kickoff),
    mock_results: null, results, week: 3, locked: false, winners_found: false, created_at: new Date().toISOString() });

  const hash = "a".repeat(64);
  for (const [u, g] of [["ann", "g-alpha"], ["bob", "g-alpha"], ["cat", "g-beta"]]) {
    tables.users.push({ username: u, password_hash: hash, group_id: g });
    tables.memberships.push({ username: u, group_id: g });
  }
  if (setup) setup(tables);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (loginAs) await context.addInitScript(u => localStorage.setItem("fp_session", u), loginAs);
  await context.route("**/*", route => {
    const url = route.request().url();
    if (url.includes("/rest/v1/")) return fake.handle(route);
    if (url === ORIGIN + "/") return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    if (url === ORIGIN + "/app.js") return route.fulfill({ status: 200, contentType: "application/javascript", body: bundle });
    return route.abort();                                // fonts and anything else external
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());                    // the Void button asks for confirmation
  await page.goto(ORIGIN + "/");
  return { page, fake, tables, errors, context, close: () => context.close() };
}
