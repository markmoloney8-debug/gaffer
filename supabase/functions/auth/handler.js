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
// Recovery emails are stored encrypted (AES-256-GCM). The key comes from the EMAIL_KEY secret, which only this function can read.
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = t => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
async function aesKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("gaffer-email:" + secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptEmail(secret, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(plain)));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}
export async function decryptEmail(secret, stored) {
  const [v, iv, ct] = String(stored || "").split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("bad ciphertext");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(secret), unb64u(ct));
  return new TextDecoder().decode(pt);
}
// "mark.m@gmail.com" -> "m****@gmail.com": what the player sees of their own address
export const maskEmail = e => { const [l, d] = String(e).split("@"); return `${l.slice(0, 1)}****@${d}`; };

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

  // ── recovery email helpers ──────────────────────────────────────────────────
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const mailReady = () => Boolean(env.resendKey && env.emailKey);
  const enc = plain => encryptEmail(env.emailKey, plain);
  const dec = stored => decryptEmail(env.emailKey, stored);
  const siteUrl = (env.siteUrl || "https://gaffers5.com").replace(/\/$/, "");
  async function sendMail(to, subject, text) {
    const r = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.mailFrom || "The Gaffer <noreply@gaffers5.com>", to: [to], subject, text }),
    });
    if (!r.ok) throw new Error(`mail: ${r.status}`);
  }
  const newToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const iso = ms => new Date(ms).toISOString();
  // Makes a single-use link token. Returns null if too many were made recently (per player, and overall).
  async function issueToken(username, purpose, email, minutes) {
    const hourAgo = iso(Date.now() - 3600000);
    const mine = await rows(`auth_tokens?username=eq.${q(username)}&purpose=eq.${purpose}&created_at=gte.${q(hourAgo)}&select=id`);
    if (mine.length >= 3) return null;
    const all = await rows(`auth_tokens?purpose=eq.${purpose}&created_at=gte.${q(hourAgo)}&select=id`);
    if (all.length >= 60) return null;
    const token = newToken();
    await write("auth_tokens", "POST", { username, purpose, token_hash: await sha256(token), email: email || null, expires_at: iso(Date.now() + minutes * 60000) });
    return token;
  }
  // Uses a token exactly once. Returns the token row, or null if it is unknown, expired or already used.
  async function useToken(token, purpose) {
    const hash = await sha256(String(token || ""));
    const row = (await rows(`auth_tokens?token_hash=eq.${q(hash)}&purpose=eq.${purpose}&used_at=is.null&expires_at=gt.${q(iso(Date.now()))}&select=id,username,email`))[0];
    if (!row) return null;
    const r = await call(`/rest/v1/auth_tokens?id=eq.${row.id}&used_at=is.null`, { method: "PATCH", body: { used_at: iso(Date.now()) }, headers: { Prefer: "return=representation" } });
    const claimed = r.ok ? await r.json() : [];
    return claimed.length ? row : null;                         // someone else got there first
  }
  async function signedInUser() {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const who = await call("/auth/v1/user", { token });
    if (!who.ok) return null;
    const me = await who.json();
    return (await rows(`users?auth_id=eq.${q(me.id)}&select=username,recovery_email,recovery_verified_at`))[0] || null;
  }
  // `stored` is the encrypted address as it sits in the users row; the token remembers it so the link only works for that exact address.
  async function sendVerification(username, email, stored) {
    const token = await issueToken(username, "verify", stored, 24 * 60);
    if (!token) return "limited";
    await sendMail(email, "Confirm your email for The Gaffer",
      `Hi ${username},\n\nConfirm this email address so you can reset your password yourself if you ever forget it:\n\n${siteUrl}/?verify=${token}\n\nThe link works once and lasts 24 hours. If you didn't ask for this, ignore this email and nothing will happen.\n\nThe Gaffer`);
    return "sent";
  }

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
      let emailSent = false;
      const email = String(input.email || "").trim().toLowerCase();
      if (email && EMAIL_RE.test(email) && email.length <= 254 && mailReady()) {           // best effort: never blocks sign-up
        try {
          const stored = await enc(email);
          await write(`users?username=eq.${q(username)}`, "PATCH", { recovery_email: stored, recovery_hint: maskEmail(email), recovery_verified_at: null });
          emailSent = (await sendVerification(username, email, stored)) === "sent";
        } catch (e) { console.error(String(e && e.message || e)); }
      }
      return reply(200, { ok: true, emailSent });
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

    // ── set_email: add or change the recovery email (signed in). It only counts once the link is tapped.
    if (action === "set_email") {
      const me = await signedInUser();
      if (!me) return fail(401, "Sign in first.");
      const email = String(input.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) return fail(400, "That doesn't look like an email address.");
      if (!mailReady()) return fail(503, "Email isn't switched on yet. Ask the admin to reset your password if you get locked out.", "mail_off");
      if (me.recovery_email && me.recovery_verified_at) {
        const current = await dec(me.recovery_email).catch(() => null);
        if (current === email) return reply(200, { ok: true, alreadyVerified: true });
      }
      const stored = await enc(email);
      await write(`users?username=eq.${q(me.username)}`, "PATCH", { recovery_email: stored, recovery_hint: maskEmail(email), recovery_verified_at: null });
      const res = await sendVerification(me.username, email, stored);
      if (res === "limited") return fail(429, "Too many emails just now. Try again in an hour.");
      return reply(200, { ok: true });
    }

    // ── resend_email: send the confirmation link again to the address already saved
    if (action === "resend_email") {
      const me = await signedInUser();
      if (!me) return fail(401, "Sign in first.");
      if (!mailReady()) return fail(503, "Email isn't switched on yet.", "mail_off");
      if (!me.recovery_email || me.recovery_verified_at) return reply(200, { ok: true });
      const res = await sendVerification(me.username, await dec(me.recovery_email), me.recovery_email);
      if (res === "limited") return fail(429, "Too many emails just now. Try again in an hour.");
      return reply(200, { ok: true });
    }

    // ── remove_email
    if (action === "remove_email") {
      const me = await signedInUser();
      if (!me) return fail(401, "Sign in first.");
      await write(`users?username=eq.${q(me.username)}`, "PATCH", { recovery_email: null, recovery_hint: null, recovery_verified_at: null });
      await write(`auth_tokens?username=eq.${q(me.username)}&used_at=is.null`, "DELETE").catch(() => {});
      return reply(200, { ok: true });
    }

    // ── verify_email: the link in the confirmation email
    if (action === "verify_email") {
      const row = await useToken(input.token, "verify");
      if (!row) return fail(400, "This link has expired or has already been used.", "bad_token");
      const r = await call(`/rest/v1/users?username=eq.${q(row.username)}&recovery_email=eq.${q(row.email || "")}`, { method: "PATCH", body: { recovery_verified_at: iso(Date.now()) }, headers: { Prefer: "return=representation" } });
      const done = r.ok ? await r.json() : [];
      if (!done.length) return fail(400, "This link has expired or has already been used.", "bad_token");   // the address was changed since
      return reply(200, { ok: true });
    }

    // ── request_reset: "forgot password". Always answers the same, so it can't be used to find out who has an email.
    if (action === "request_reset") {
      const username = String(input.username || "").trim();
      if (username && mailReady()) {
        try {
          const row = (await rows(`users?handle=eq.${q(emailLocal(username))}&select=username,recovery_email,recovery_verified_at`))[0];
          if (row && row.recovery_email && row.recovery_verified_at) {
            const token = await issueToken(row.username, "reset", null, 30);
            if (token) await sendMail(await dec(row.recovery_email), "Reset your Gaffer password",
              `Hi ${row.username},\n\nSomeone asked to reset the password for your Gaffer account. If that was you, tap this link within 30 minutes:\n\n${siteUrl}/?reset=${token}\n\nThe link works once. If it wasn't you, ignore this email and your password stays as it is.\n\nThe Gaffer`);
          }
        } catch (e) { console.error(String(e && e.message || e)); }
      }
      return reply(200, { ok: true });
    }

    // ── complete_reset: set a new password from the emailed link
    if (action === "complete_reset") {
      const password = String(input.password || "");
      if (password.length < 6 || password.length > 72) return fail(400, "Password must be between 6 and 72 characters.");
      const row = await useToken(input.token, "reset");
      if (!row) return fail(400, "This link has expired or has already been used. Ask for a new one.", "bad_token");
      const user = (await rows(`users?username=eq.${q(row.username)}&select=auth_id`))[0];
      const undo = () => write(`auth_tokens?id=eq.${row.id}`, "PATCH", { used_at: null }).catch(() => {});
      if (!user || !user.auth_id) { await undo(); return fail(400, "Couldn't reset that account. Ask the admin.", "no_login"); }
      const r = await call(`/auth/v1/admin/users/${user.auth_id}`, { method: "PUT", body: { password } });
      if (!r.ok) {
        await undo();
        const d = await r.json().catch(() => ({}));
        if (d.error_code === "weak_password" || /password/i.test(String(d.msg || ""))) return fail(400, "That password is too easy to guess. Try a longer one.");
        throw new Error(`auth: ${r.status}`);
      }
      await write(`auth_tokens?username=eq.${q(row.username)}&purpose=eq.reset&used_at=is.null`, "PATCH", { used_at: iso(Date.now()) }).catch(() => {});   // any other open links die too
      return reply(200, { ok: true, username: row.username });
    }

    return fail(400, "Unknown action.");
  } catch (e) {
    console.error(String(e && e.message || e));
    return fail(500, "Something went wrong. Try again.");
  }
}
