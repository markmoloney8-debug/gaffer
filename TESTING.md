# Testing The Gaffer

| Suite | Command | What it covers | Needs |
|---|---|---|---|
| Unit | `npm run test:unit` | Scoring, void, deadlines, fixture picking, archiving, results mapping, round timing | Node 22 |
| Database | see `tests/sql` | The server-side rules in `hardening.sql`, and the sign-in lock-down in `auth/auth.sql` (who can read or write what, hidden picks, reset-request limits) | A scratch Postgres |
| Accessibility | `tests/e2e/contrast.test.mjs` | WCAG 2.1 AA text contrast (4.5:1, or 3:1 for large text) on every screen, in both dark and light mode | The real app in a browser |
| Account function | `tests/unit/auth-function.test.mjs` | Sign-up, moving old accounts across, admin-only temporary passwords, clean-up if something fails | A pretend sign-in service |
| Browser | `npm run test:e2e` | Sign-up, groups, entries, locking, partial reveal, winners, void, admin, Story So Far, on a phone-sized screen | Playwright + Chromium |

The browser tests never touch live data: `tests/e2e/fake-supabase.mjs` stands in for Supabase.

## One-time setup
Add to `package.json`:

    "scripts": {
      "test:unit": "node --test \"tests/unit/*.test.*\"",
      "test:e2e":  "node --test --test-concurrency=1 \"tests/e2e/*.test.mjs\"",
      "test":      "npm run test:unit && npm run test:e2e"
    }

Then: `npm i -D playwright esbuild` and `npx playwright install chromium`.

## Running the database tests locally
    createdb gaffer_test
    for f in tests/sql/baseline.sql history-setup.sql hardening.sql; do psql -v ON_ERROR_STOP=1 -d gaffer_test -f $f; done
    psql -v ON_ERROR_STOP=1 -d gaffer_test -f tests/sql/hardening.test.sql

## When you change something
- Changed scoring, deadlines or any script decision: add or update a unit test first.
- Added a screen or flow: add a browser test in `tests/e2e/app.e2e.test.mjs`.
- Changed a database rule: add a case to `tests/sql/hardening.test.sql`.
- The ADMIN_PIN in the browser tests must match `src/App.jsx`.

## Not covered yet
- Real football-data.org responses (the tests use made-up matches shaped like the API).
- Real Supabase behaviour (the fake and the local Postgres approximate it).
- Sign-in and per-user privacy: the database is still open to anyone with the public key.
