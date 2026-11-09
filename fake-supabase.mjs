// An in-memory stand-in for the parts of Supabase's REST API (PostgREST) that the app uses.
// The browser tests route every request to the real Supabase URL here, so tests never
// touch live data and need no network access.

const PK = { users: "username", round: "id", group_state: "group_id" };
const UNIQUE = { users: ["username"], groups: ["invite_code"], memberships: ["username", "group_id"] };

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

export function createFakeSupabase() {
  const tables = { users: [], round: [], submissions: [], groups: [], group_state: [], history: [], memberships: [], feedback: [] };
  const log = [];                                        // every write, for assertions
  const hooks = { beforeInsert: {} };                    // tests can make an insert fail, like a database rule would

  function applyDefaults(table, row) {
    const now = new Date().toISOString();
    if (table === "submissions") return { id: uuid(), submitted_at: now, ...row };
    if (table === "groups") return { id: uuid(), created_at: now, ...row };
    if (table === "history") return { id: uuid(), archived_at: now, ...row };
    if (table === "memberships") return { joined_at: now, ...row };
    if (table === "group_state") return { series: 1, winners_found: false, ...row };
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
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  };

  async function handle(route) {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

    const url = new URL(req.url());
    const table = url.pathname.split("/rest/v1/")[1];
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

  return { tables, log, hooks, handle };
}
