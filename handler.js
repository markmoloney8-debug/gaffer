// The Gaffer: server-side account actions (runs as a Supabase Edge Function).
//
//   register        create an account, checking the group invite code            (public)
//   claim           move an account from the old login to real sign-in, using the
//                   SAME password the player already has                          (public)
//   reset_password  set a temporary password for a player                        (admin only)
//
// It uses the service key, which can bypass every database rule. That key only ever exists
// inside this function. Never put it in the app.

export const EMAIL_DOMAIN = "gaffers5.com";

// Turns a username into the first half of the sign-in email.
// MUST match handle_for() in auth/auth.sql.
export function emailLocal(username) {
  let out = "";
  for (const ch of String(username).toLowerCase()) {
    if (/^[a-z0-9]$/.test(ch)) out += ch;
    else if (ch === " ") out += "-s-";
    else if (ch === "_") out += "-u-";
    else if (ch === ".") out += "-d-";
    else if (ch === "-") out += "-h-";
    else out += "-x" + Array.from(new TextEncoder().encode(ch)).map(b => b.toString(16).padStart(2, "0")).join("") + "-";
  }
  return out;
}
export const emailFor = username => `${emailLocal(username)}@${EMAIL_DOMAIN}`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const fail = (status, error, code) => reply(status, { error, ...(code ? { code } : {}) });

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function tempPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

export async function handler(req, env, fetchFn = fetch) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return fail(405, "Use POST.");

  const call = (path, { method = "GET", body, headers = {}, token } = {}) =>
    fetchFn(`${env.url}${path}`, {
      method,
      headers: { apikey: env.key, authorization: `Bearer ${token || env.key}`, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const rows = async path => { const r = await call(`/rest/v1/${path}`); if (!r.ok) throw new Error(`database: ${r.status}`); return r.json(); };
  const write = async (path, method, body) => { const r = await call(`/rest/v1/${path}`, { method, body, headers: { Prefer: "return=minimal" } }); if (!r.ok) throw new Error(`database: ${r.status}`); };
  const q = encodeURIComponent;

  async function createLogin(username, password) {
    const r = await call("/auth/v1/admin/users", { method: "POST", body: { email: emailFor(username), password, email_confirm: true, user_metadata: { username } } });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return { id: data.id };
    const msg = String(data.msg || data.message || data.error_description || "");
    if (data.error_code === "email_exists" || /already (been )?registered/i.test(msg)) return { error: "exists" };
    if (data.error_code === "weak_password" || /password/i.test(msg)) return { error: "weak" };
    throw new Error(`auth: ${r.status} ${msg}`);
  }
  const deleteLogin = id => call(`/auth/v1/admin/users/${id}`, { method: "DELETE" }).catch(() => {});

  let input;
  try { input = await req.json(); } catch { return fail(400, "Bad request."); }
  const action = input && input.action;

  try {
    // ── register ─────────────────────────────────────────────────────────────
    if (action === "register") {
      const username = String(input.username || "").trim();
      const password = String(input.password || "");
      const invite = String(input.invite || "").trim().toUpperCase();
      if (!/^[A-Za-z0-9 _.-]{2,20}$/.test(username)) return fail(400, "Username must be 2 to 20 letters, numbers, spaces, dots, dashes or underscores.");
      if (password.length < 6 || password.length > 72) return fail(400, "Password must be between 6 and 72 characters.");
      if (!invite) return fail(400, "Invalid invite code.");

      const group = (await rows(`groups?invite_code=eq.${q(invite)}&select=id`))[0];
      if (!group) return fail(400, "Invalid invite code.");
      if ((await rows(`users?handle=eq.${q(emailLocal(username))}&select=username`)).length) return fail(409, "Username already taken.");

      const login = await createLogin(username, password);
      if (login.error === "exists") return fail(409, "Username already taken.");
      if (login.error === "weak") return fail(400, "That password is too easy to guess. Try a longer one.");
      try {
        await write("users", "POST", { username, handle: emailLocal(username), auth_id: login.id });
      } catch (e) { await deleteLogin(login.id); throw e; }
      try {
        await write("memberships", "POST", { username, group_id: group.id });
      } catch (e) { await write(`users?username=eq.${q(username)}`, "DELETE").catch(() => {}); await deleteLogin(login.id); throw e; }
      return reply(200, { ok: true });
    }

    // ── claim: old-style account, same password ──────────────────────────────
    if (action === "claim") {
      const username = String(input.username || "").trim();
      const password = String(input.password || "");
      const generic = () => fail(400, "Incorrect username or password.", "invalid");
      if (!username || !password) return generic();
      const row = (await rows(`users?handle=eq.${q(emailLocal(username))}&select=username,password_hash,auth_id`))[0];
      if (!row || row.auth_id || !row.password_hash) return generic();
      if (await sha256(password) !== row.password_hash) return generic();
      const login = await createLogin(row.username, password);
      if (login.error === "weak") return fail(400, "Your old password is too short for the new sign-in. Use Forgot password and the admin will set you a new one.", "short_password");
      if (login.error === "exists") return generic();
      try {
        await write(`users?username=eq.${q(row.username)}`, "PATCH", { auth_id: login.id, password_hash: null });
      } catch (e) { await deleteLogin(login.id); throw e; }
      return reply(200, { ok: true });
    }

    // ── reset_password: admin sets a temporary password ──────────────────────
    if (action === "reset_password") {
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) return fail(401, "Sign in first.");
      const who = await call("/auth/v1/user", { token });
      if (!who.ok) return fail(401, "Sign in first.");
      const me = await who.json();
      const meRow = (await rows(`users?auth_id=eq.${q(me.id)}&select=username`))[0];
      const isAdmin = meRow && (await rows(`admins?username=eq.${q(meRow.username)}&select=username`)).length > 0;
      if (!isAdmin) return fail(403, "Admin only.");

      const target = (await rows(`users?handle=eq.${q(emailLocal(String(input.username || "")))}&select=username,auth_id`))[0];
      if (!target) return fail(404, "No player with that username.");
      const temp = tempPassword();
      if (target.auth_id) {
        const r = await call(`/auth/v1/admin/users/${target.auth_id}`, { method: "PUT", body: { password: temp } });
        if (!r.ok) throw new Error(`auth: ${r.status}`);
      } else {
        const login = await createLogin(target.username, temp);
        if (login.error) throw new Error("could not create login");
        await write(`users?username=eq.${q(target.username)}`, "PATCH", { auth_id: login.id, password_hash: null });
      }
      if (input.request_id) await write(`reset_requests?id=eq.${q(String(input.request_id))}`, "PATCH", { status: "done" }).catch(() => {});
      return reply(200, { ok: true, username: target.username, tempPassword: temp });
    }

    return fail(400, "Unknown action.");
  } catch (e) {
    console.error(String(e && e.message || e));
    return fail(500, "Something went wrong. Try again.");
  }
}
