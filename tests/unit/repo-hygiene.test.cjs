// Catches upload mistakes: browsers rename a re-uploaded file "name (1).ext" instead of replacing it,
// and a workflow that names a file that never arrived fails in a confusing way.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist"].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    f.isDirectory() ? walk(p, out) : out.push(path.relative(root, p));
  }
  return out;
}

test("no file has a browser-added copy number like 'App (1).jsx'", () => {
  const bad = walk(root).filter(f => /\s\(\d+\)(\.|$)/.test(path.basename(f)));
  assert.deepEqual(bad, [], "Delete these and upload the file again under its real name: " + bad.join(", "));
});

test("every file the workflows run actually exists", () => {
  const dir = path.join(root, ".github", "workflows");
  const missing = [];
  for (const wf of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, wf), "utf8");
    for (const m of text.matchAll(/(?:^|[\s"'=])((?:tests|auth|scripts|src)\/[\w./-]+\.(?:sql|js|cjs|mjs|jsx)|(?:history-setup|hardening)\.sql)/gm)) {
      if (!fs.existsSync(path.join(root, m[1]))) missing.push(`${wf} needs ${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test("every SQL file in auth/ and tests/sql/ is wired into the database tests workflow", () => {
  const wf = fs.readFileSync(path.join(root, ".github", "workflows", "tests.yml"), "utf8");
  const skip = new Set(["auth/rollback.sql", "tests/sql/auth-stub.sql", "tests/sql/baseline.sql"]);
  const unused = walk(root).filter(f => /^(auth|tests\/sql)\/[^/]+\.sql$/.test(f.replace(/\\/g, "/")) && !skip.has(f.replace(/\\/g, "/")) && !wf.includes(f.replace(/\\/g, "/")));
  assert.deepEqual(unused, [], "These SQL files are never run by CI: " + unused.join(", "));
});
