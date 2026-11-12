// Tests for the account function (supabase/functions/auth/handler.js) against an in-memory stand-in
// for Supabase's sign-in service and database.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handler, emailLocal, emailFor } from "../../supabase/functions/auth/handler.js";

const sha = s => createHash("sha256").update(s).digest("hex");
const ENV = { url: "https://x.supabase.test", key: "service-key" };

function backend({ failMemberships = false } = {}) {
  const db = {
    groups: [{ id: "g1", invite_code: "GAFFER26" }],
    users: [
      { username: "MarkMolo", handle: "markmolo", auth_id: "u-mark", password_hash: null },
      { username: "Old Timer", handle: "old-s-timer", auth_id: null, password_hash: sha("hunter22") },
      { username: "Shorty", handle: "shorty", auth_id: null, password_hash: sha("abcd") },
      { username: "Never", handle: "never", auth_id: null, password_hash: sha("neverever") },
    ],
    admins: [{ username: "MarkMolo" }],
    memberships: [], reset_requests: [{ id: "r1", username: "Old Timer", status: "new" }],
  };
  const logins = new Map([["u-mark", { email: emailFor("MarkMolo"), password: "markspass" }]]);
  const tokens = new Map([["mark-token", "u-mark"], ["old-token", "u-old"]]);
  logins.set("u-old", { email: "x", password: "x" });
  db.users.push({ username: "Plain", handle: "plain", auth_id: "u-old", password_hash: null });
  let n = 0;
  const j = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const filter = (rows, params) => rows.filter(r => [...params].every(([k, v]) => k === "select" || !v.startsWith("eq.") || String(r[k]) === decodeURIComponent(v.slice(3))));

  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); const method = init.method || "GET"; const body = init.body ? JSON.parse(init.body) : undefined;
    if (init.headers.apikey !== "service-key") return j(401, { message: "no key" });
    if (u.pathname === "/auth/v1/admin/users" && method === "POST") {
      if ([...logins.values()].some(l => l.email === body.email)) return j(422, { error_code: "email_exists", msg: "A user with this email address has already been registered" });
      if (body.password.length < 6) return j(422, { error_code: "weak_password", msg: "Password should be at least 6 characters." });
      const id = `u-${++n}`; logins.set(id, { email: body.email, password: body.password, meta: body.user_metadata, confirmed: body.email_confirm }); return j(200, { id });
    }
    let m = u.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (m && method === "PUT") { if (!logins.has(m[1])) return j(404, {}); logins.get(m[1]).password = body.password; return j(200, {}); }
    if (m && method === "DELETE") { logins.delete(m[1]); return j(200, {}); }
    if (u.pathname === "/auth/v1/user") { const id = tokens.get((init.headers.authorization || "").replace("Bearer ", "")); return id ? j(200, { id }) : j(401, {}); }
    m = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (m) {
      const t = m[1];
      if (method === "GET") return j(200, filter(db[t], u.searchParams));
      if (method === "POST") { if (t === "memberships" && failMemberships) return j(500, {}); db[t].push(body); return j(201); }
      if (method === "PATCH") { filter(db[t], u.searchParams).forEach(r => Object.assign(r, body)); return j(204); }
      if (method === "DELETE") { const gone = new Set(filter(db[t], u.searchParams)); db[t] = db[t].filter(r => !gone.has(r)); return j(204); }
    }
    return j(404, { message: `unhandled ${method} ${u.pathname}` });
  };
  return { db, logins, fetchFn };
}
const post = (body, headers = {}) => new Request("https://f.test/auth", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function run(b, body, headers) { const res = await handler(post(body, headers), ENV, b.fetchFn); return { status: res.status, json: await res.json() }; }

test("sign-in handles: ordinary names, punctuation, and non-ASCII all map to distinct safe email names", () => {
  assert.equal(emailLocal("MarkMolo"), "markmolo");
  assert.equal(emailLocal("ogorki jafar"), "ogorki-s-jafar");
  assert.equal(emailLocal("A_b.c-d"), "a-u-b-d-c-h-d");
  assert.equal(emailLocal("Zoë"), "zo-xc3ab-");
  assert.equal(emailFor("MarkMolo"), "markmolo@gaffers5.com");
  const names = ["a b", "a-b", "a_b", "a.b", "ab", "AB", "a-s-b"];
  const handles = names.map(emailLocal);
  assert.equal(new Set(handles).size, new Set(names.map(n => n.toLowerCase())).size, "only case differences share a handle");
  assert.ok(emailLocal("x".repeat(20)).length <= 64 && emailLocal(" ".repeat(20)).length <= 64, "longest allowed names fit an email");
});

test("register: creates the sign-in, the profile and the group membership", async () => {
  const b = backend();
  const r = await run(b, { action: "register", username: "Newbie", password: "secret1", invite: "gaffer26" });
  assert.equal(r.status, 200);
  const login = [...b.logins.values()].find(l => l.email === "newbie@gaffers5.com");
  assert.ok(login && login.password === "secret1" && login.confirmed === true && login.meta.username === "Newbie");
  assert.ok(b.db.users.some(u => u.username === "Newbie" && u.handle === "newbie" && u.auth_id));
  assert.deepEqual(b.db.memberships, [{ username: "Newbie", group_id: "g1" }]);
});

test("register: refuses a wrong invite code, a taken name (any case), a short password and odd characters, creating nothing", async () => {
  const b = backend();
  const before = b.logins.size;
  const cases = [
    [{ username: "Newbie", password: "secret1", invite: "WRONG" }, 400, /invite/i],
    [{ username: "markmolo", password: "secret1", invite: "GAFFER26" }, 409, /taken/i],
    [{ username: "MARKMOLO", password: "secret1", invite: "GAFFER26" }, 409, /taken/i],
    [{ username: "Newbie", password: "abc", invite: "GAFFER26" }, 400, /password/i],
    [{ username: "x", password: "secret1", invite: "GAFFER26" }, 400, /username/i],
    [{ username: "bad<name>", password: "secret1", invite: "GAFFER26" }, 400, /username/i],
    [{ username: "Newbie", password: "secret1", invite: "" }, 400, /invite/i],
  ];
  for (const [body, status, text] of cases) {
    const r = await run(b, { action: "register", ...body });
    assert.equal(r.status, status, JSON.stringify(body)); assert.match(r.json.error, text);
  }
  assert.equal(b.logins.size, before); assert.equal(b.db.memberships.length, 0);
});

test("register: if the group join fails, the half-made account is removed", async () => {
  const b = backend({ failMemberships: true });
  const before = b.logins.size, users = b.db.users.length;
  const r = await run(b, { action: "register", username: "Newbie", password: "secret1", invite: "GAFFER26" });
  assert.equal(r.status, 500);
  assert.equal(b.logins.size, before, "sign-in removed"); assert.equal(b.db.users.length, users, "profile removed");
});

test("claim: an old account moves to real sign-in with the same password", async () => {
  const b = backend();
  const r = await run(b, { action: "claim", username: "old timer", password: "hunter22" });   // typed in any case
  assert.equal(r.status, 200);
  const login = [...b.logins.values()].find(l => l.email === "old-s-timer@gaffers5.com");
  assert.equal(login.password, "hunter22");
  const row = b.db.users.find(u => u.username === "Old Timer");
  assert.ok(row.auth_id); assert.equal(row.password_hash, null, "old hash is wiped");
  assert.equal((await run(b, { action: "claim", username: "Old Timer", password: "hunter22" })).status, 400, "cannot be claimed twice");
});

test("claim: wrong password, unknown name and already-migrated names all get the same answer and change nothing", async () => {
  const b = backend(); const before = b.logins.size;
  const answers = [];
  for (const body of [{ username: "Old Timer", password: "nope" }, { username: "Ghost", password: "hunter22" }, { username: "MarkMolo", password: "markspass" }, { username: "", password: "" }]) {
    const r = await run(b, { action: "claim", ...body }); assert.equal(r.status, 400); answers.push(r.json.error);
  }
  assert.equal(new Set(answers).size, 1, "no hint about which names exist");
  assert.equal(b.logins.size, before);
  assert.ok(b.db.users.find(u => u.username === "Old Timer").password_hash);
});

test("claim: an old password too short for the new system is explained, and the account is left alone", async () => {
  const b = backend();
  const r = await run(b, { action: "claim", username: "Shorty", password: "abcd" });
  assert.equal(r.status, 400); assert.equal(r.json.code, "short_password");
  assert.equal(b.db.users.find(u => u.username === "Shorty").auth_id, null);
});

test("reset_password: only the admin can set a temporary password", async () => {
  const b = backend();
  assert.equal((await run(b, { action: "reset_password", username: "Never" })).status, 401);
  assert.equal((await run(b, { action: "reset_password", username: "Never" }, { authorization: "Bearer bad" })).status, 401);
  assert.equal((await run(b, { action: "reset_password", username: "Never" }, { authorization: "Bearer old-token" })).status, 403, "a signed-in non-admin is refused");
  assert.equal(b.db.users.find(u => u.username === "Never").auth_id, null);
});

test("reset_password: the admin gets a working temporary password and the request is closed", async () => {
  const b = backend(); const admin = { authorization: "Bearer mark-token" };
  const r = await run(b, { action: "reset_password", username: "markmolo" }, admin);   // existing sign-in
  assert.equal(r.status, 200); assert.equal(r.json.username, "MarkMolo"); assert.match(r.json.tempPassword, /^[A-Za-z0-9]{10}$/);
  assert.equal(b.logins.get("u-mark").password, r.json.tempPassword);

  const r2 = await run(b, { action: "reset_password", username: "Old Timer", request_id: "r1" }, admin);   // never migrated
  assert.equal(r2.status, 200);
  const row = b.db.users.find(u => u.username === "Old Timer");
  assert.ok(row.auth_id); assert.equal(row.password_hash, null);
  assert.equal(b.logins.get(row.auth_id).password, r2.json.tempPassword);
  assert.equal(b.db.reset_requests[0].status, "done");

  assert.notEqual(r.json.tempPassword, r2.json.tempPassword);
  assert.equal((await run(b, { action: "reset_password", username: "Nobody" }, admin)).status, 404);
});

test("other methods, junk bodies and unknown actions are refused; browsers can call it (CORS)", async () => {
  const b = backend();
  assert.equal((await handler(new Request("https://f.test/auth", { method: "OPTIONS" }), ENV, b.fetchFn)).status, 204);
  assert.equal((await handler(new Request("https://f.test/auth", { method: "GET" }), ENV, b.fetchFn)).status, 405);
  assert.equal((await handler(new Request("https://f.test/auth", { method: "POST", body: "not json" }), ENV, b.fetchFn)).status, 400);
  assert.equal((await run(b, { action: "wipe_everything" })).status, 400);
  const res = await handler(post({ action: "nope" }), ENV, b.fetchFn);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});
