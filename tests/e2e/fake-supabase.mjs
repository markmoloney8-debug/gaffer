// An in-memory stand-in for the parts of Supabase's REST API (PostgREST) that the app uses.
// The browser tests route every request to the real Supabase URL here, so tests never
// touch live data and need no network access.

import { createHash } from "node:crypto";
import { emailFor } from "../../supabase/functions/auth/handler.js";

const sha = x => createHash("sha256").update(x).digest("hex");
const PK = { users: "username", round: "id", group_state: "group_id" };
const UNIQUE = { users: ["username"], groups: ["invite_code"], memberships: ["username", "group_id"] };

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

export function createFakeSupabase() {
  const tables = { users: [], round: [], submissions: [], groups: [], group_state: [], history: [], memberships: [], feedback: [], reset_requests: [], admins: [] };
  const logins = [];                                     // sign-in accounts: { id, email, username, password }
  const addLogin = (username, password) => { const l = { id: `auth-${username}`, email: emailFor(username), username, password }; logins.push(l); return l; };
  const callerOf = req => { const m = (req.headers()["authorization"] || "").match(/^Bearer tok:(.+)$/); return m ? m[1] : null; };
  const log = [];                                        // every write, for assertions
  const hooks = { beforeInsert: {} };                    // tests can make an insert fail, like a database rule would

  function applyDefaults(table, row) {
    const now = new Date().toISOString();
    if (table === "submissions") return { id: uuid(), submitted_at: now, ...row };
    if (table === "groups") return { id: uuid(), created_at: now, ...row };
    if (table === "history") return { id: uuid(), archived_at: now, ...row };
    if (table === "memberships") return { joined_at: now, ...row };
    if (table === "group_state") return { series: 1, winners_found: false, ...row };
    if (table === "reset_requests") return { id: uuid(), status: "new", created_at: now, ...row };
    return { created_at: now, ...row };
  }

  function predicate(params) {
    const tests = [];
    for (const [key, value] of params) {
      if (["order", "select", "limit"].includes(key)) continue;
      const [op, ...rest] = value.split(".");
      const arg = rest.join(".");
      if (op === "eq") tests.push(r => String(r[key]) === arg);
      else if (op === "in") tests.push(r => arg.replace(/^\(|\)$/g, "").split(",").includes(String(r[key])));
      else if (op === "is") tests.push(r => (arg === "null" ? r[key] == null : String(r[key]) === arg));
      else if (op === "neq") tests.push(r => String(r[key]) !== arg);
      else if (op === "gte") tests.push(r => String(r[key]) >= arg);
      else throw new Error(`fake-supabase: unsupported filter ${key}=${value}`);
    }
    return r => tests.every(t => t(r));
  }

  function shape(rows, params) {
    let out = [...rows];
    const order = params.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
    }
    const select = params.get("select");
    if (select && select !== "*") out = out.map(r => Object.fromEntries(select.split(",").map(c => [c, r[c]])));
    return out;
  }

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  };

  async function handle(route) {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

    const url = new URL(req.url());
    const sub = url.pathname.split("/rest/v1/")[1];
    if (sub && sub.startsWith("rpc/")) return rpc(route, req, sub.slice(4));
    const table = sub;
    if (!(table in tables)) return route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ message: `no table ${table}` }) });
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    const prefer = req.headers()["prefer"] || "";
    const want = prefer.includes("return=representation");

    try {
      if (req.method() === "GET") {
        return json(200, shape(tables[table].filter(predicate(url.searchParams)), url.searchParams));
      }

      if (req.method() === "POST") {
        const body = JSON.parse(req.postData() || "null");
        const incoming = Array.isArray(body) ? body : [body];
        const saved = [];
        for (const raw of incoming) {
          const refusal = hooks.beforeInsert[table] && hooks.beforeInsert[table](raw);
          if (refusal) return json(400, { code: "P0001", message: refusal });
          const row = applyDefaults(table, raw);
          const pk = PK[table];
          const existing = pk ? tables[table].find(r => r[pk] === row[pk]) : null;
          if (existing && prefer.includes("merge-duplicates")) { Object.assign(existing, raw); saved.push(existing); continue; }
          const keys = UNIQUE[table];
          if (keys && tables[table].some(r => keys.every(k => r[k] === row[k]))) {
            return json(409, { code: "23505", message: `duplicate key value violates unique constraint on ${table}` });
          }
          tables[table].push(row);
          saved.push(row);
        }
        log.push({ method: "POST", table, rows: saved });
        return want ? json(201, saved) : route.fulfill({ status: 201, headers: cors });
      }

      if (req.method() === "PATCH") {
        const patch = JSON.parse(req.postData());
        const rows = tables[table].filter(predicate(url.searchParams));
        rows.forEach(r => Object.assign(r, patch));
        log.push({ method: "PATCH", table, patch, count: rows.length });
        return json(200, rows);
      }

      if (req.method() === "DELETE") {
        const test = predicate(url.searchParams);
        const before = tables[table].length;
        tables[table] = tables[table].filter(r => !test(r));
        log.push({ method: "DELETE", table, count: before - tables[table].length });
        return route.fulfill({ status: 204, headers: cors });
      }
    } catch (e) {
      return json(400, { message: String(e.message || e) });
    }
    return json(405, { message: "unsupported" });
  }

  // ── database functions the app calls ──
  async function rpc(route, req, name) {
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    const me = callerOf(req);
    if (!me) return json(401, { message: "JWT expired" });
    const args = JSON.parse(req.postData() || "{}");
    if (name === "join_group") {
      const g = tables.groups.find(x => x.invite_code === String(args.code).trim().toUpperCase());
      if (!g) return json(400, { message: "Invalid invite code" });
      if (!tables.memberships.some(m => m.username === me && m.group_id === g.id)) tables.memberships.push({ username: me, group_id: g.id, joined_at: new Date().toISOString() });
      log.push({ method: "RPC", name, args });
      return json(200, g);
    }
    if (name === "create_group") {
      const refusal = hooks.beforeInsert.groups && hooks.beforeInsert.groups(args);
      if (refusal) return json(400, { code: "P0001", message: refusal });
      const g = applyDefaults("groups", { name: String(args.p_name).trim(), invite_code: Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join(""), emoji: args.p_emoji || null, created_by: me });
      tables.groups.push(g); tables.group_state.push({ group_id: g.id, series: 1, winners_found: false }); tables.memberships.push({ username: me, group_id: g.id });
      log.push({ method: "RPC", name, args });
      return json(200, g);
    }
    if (name === "group_entries") {
      if (!tables.memberships.some(m => m.username === me && m.group_id === args.gid)) return json(400, { message: "Not a member of this group" });
      const first = tables.round[0] ? Math.min(...tables.round[0].fixtures.map(f => f.kickoffTs)) : Infinity;
      const open = Date.now() >= first - 60000;                              // others' picks stay hidden until entries lock
      return json(200, tables.submissions.filter(x => x.group_id === args.gid).map(x => ({ ...x, preds: x.username === me || open ? x.preds : {} })));
    }
    return json(404, { message: `no function ${name}` });
  }

  // ── sign-in service and the account function ──
  async function handleAuth(route) {
    const req = route.request(); const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || "{}");
    const session = l => ({ access_token: `tok:${l.username}`, refresh_token: `refresh:${l.username}`, expires_in: 3600, user: { id: l.id, user_metadata: { username: l.username } } });

    if (url.pathname === "/auth/v1/token") {
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const l = logins.find(x => `refresh:${x.username}` === body.refresh_token);
        return l ? json(200, session(l)) : json(400, { error: "invalid_grant" });
      }
      const l = logins.find(x => x.email === body.email && x.password === body.password);
      return l ? json(200, session(l)) : json(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
    }
    if (url.pathname === "/auth/v1/user" && req.method() === "PUT") {
      const me = callerOf(req); const l = logins.find(x => x.username === me);
      if (!l) return json(401, {});
      if (String(body.password || "").length < 6) return json(422, { msg: "Password should be at least 6 characters." });
      l.password = body.password; log.push({ method: "PASSWORD", username: me });
      return json(200, {});
    }
    if (url.pathname === "/functions/v1/auth") {
      const handle = x => emailFor(x).split("@")[0];
      if (body.action === "register") {
        const g = tables.groups.find(x => x.invite_code === String(body.invite || "").trim().toUpperCase());
        if (!g) return json(400, { error: "Invalid invite code." });
        if (tables.users.some(u => handle(u.username) === handle(body.username))) return json(409, { error: "Username already taken." });
        if (String(body.password).length < 6) return json(400, { error: "Password must be between 6 and 72 characters." });
        const l = addLogin(body.username, body.password);
        tables.users.push({ username: body.username, handle: handle(body.username), auth_id: l.id, created_at: new Date().toISOString() });
        tables.memberships.push({ username: body.username, group_id: g.id });
        return json(200, { ok: true });
      }
      if (body.action === "claim") {
        const u = tables.users.find(x => handle(x.username) === handle(String(body.username || "")));
        if (!u || u.auth_id || !u.password_hash || sha(body.password || "") !== u.password_hash) return json(400, { error: "Incorrect username or password.", code: "invalid" });
        if (body.password.length < 6) return json(400, { error: "Your old password is too short for the new sign-in. Use Forgot password and the admin will set you a new one.", code: "short_password" });
        const l = addLogin(u.username, body.password); u.auth_id = l.id; u.password_hash = null;
        return json(200, { ok: true });
      }
      if (body.action === "reset_password") {
        const me = callerOf(req);
        if (!me) return json(401, { error: "Sign in first." });
        if (!tables.admins.some(a => a.username === me)) return json(403, { error: "Admin only." });
        const u = tables.users.find(x => handle(x.username) === handle(String(body.username || "")));
        if (!u) return json(404, { error: "No player with that username." });
        const temp = "Temp" + Math.random().toString(36).slice(2, 8);
        const l = logins.find(x => x.username === u.username) || addLogin(u.username, temp); l.password = temp; u.auth_id = l.id; u.password_hash = null;
        const rr = tables.reset_requests.find(x => x.id === body.request_id); if (rr) rr.status = "done";
        return json(200, { ok: true, username: u.username, tempPassword: temp });
      }
      return json(400, { error: "Unknown action." });
    }
    return json(404, {});
  }

  return { tables, log, hooks, handle, handleAuth, addLogin, logins };
}
