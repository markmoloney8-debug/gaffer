import { useState, useEffect, useRef, createContext, useContext } from "react";
import { emailFor } from "../supabase/functions/auth/handler.js";
import { deadlineTs, isDeadlinePassed, msUntilDeadline, fmtCountdown, hit, isPerfect, scoreEntry } from "./logic.js";

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); }
  :root {
    --gold: #f0c040; --ink: #05080f; --surface: #0c1018; --surface2: #131822;
    --border: rgba(255,255,255,0.07); --muted: #8b97ab; --text: #e2e8f0;
    --green: #34d399; --red: #f87171;
    --bg: #05080f; --navbg: rgba(5,8,15,0.92); --scrim: rgba(5,8,15,0.88);
    --g1: #f0c040; --g2: #f5d780; --g3: #c8960c; --danger-text: #fca5a5;
    color-scheme: dark;
  }
  :root[data-theme="light"] {
    --bg: #f5f3ee; --ink: #ffffff; --surface: #efece4; --surface2: #ffffff;
    --border: rgba(15,23,42,0.13); --muted: #5b6574; --text: #1a202c;
    --gold: #8a5e00; --green: #047857; --red: #b91c1c;
    --navbg: rgba(245,243,238,0.92); --scrim: rgba(245,243,238,0.9);
    --g1: #8a5e00; --g2: #a87400; --g3: #6b4800; --danger-text: #b91c1c;
    color-scheme: light;
  }
  @keyframes spin         { to { transform: rotate(360deg); } }
  @keyframes fadeUp       { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pop          { 0%{transform:scale(0.85);opacity:0} 70%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
  @keyframes confettiFall { 0%{transform:translateY(-10px) rotate(0deg);opacity:1} 100%{transform:translateY(100vh) rotate(720deg);opacity:0} }
  @keyframes revealCard   { 0%{transform:rotateY(90deg) scale(0.9);opacity:0} 100%{transform:rotateY(0deg) scale(1);opacity:1} }
  @keyframes shake        { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }
  @keyframes glow         { 0%,100%{box-shadow:0 0 20px rgba(240,192,64,0.3)} 50%{box-shadow:0 0 40px rgba(240,192,64,0.7)} }
  .pop    { animation: pop 0.4s cubic-bezier(.34,1.56,.64,1) both; }
  .spin   { animation: spin 0.9s linear infinite; }
  .shake  { animation: shake 0.35s ease; }
  .glow   { animation: glow 2s ease-in-out infinite; }
  button  { cursor: pointer; font-family: inherit; }
  input:focus { outline: none; border-color: var(--gold) !important; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
`;
const styleEl = document.createElement("style");
styleEl.textContent = css;
document.head.appendChild(styleEl);

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Optional voluntary tip link shown on the winner screen (e.g. "https://monzo.me/yourname"). Leave "" to hide it.
const TIP_URL           = "https://monzo.me/markmoloney4?h=3txBA-";
const MAX_OWN_GROUPS    = 3;   // groups one player may start (also enforced in the database)
function inviteLink(code) { return `${window.location.origin}/?join=${encodeURIComponent(code)}`; }
async function shareOrCopy(text, url) {
  try { if (navigator.share) { await navigator.share({ text, url }); return "shared"; } }
  catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); return "copied"; } catch { return "failed"; }
}
function randomCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function profileStats(rows) {
  const entries = rows.length;
  const correct = rows.reduce((n, r) => n + (r.correct || 0), 0);
  const total   = rows.reduce((n, r) => n + (r.total || 0), 0);
  const wins    = rows.filter(r => r.perfect).length;
  return {
    entries, wins,
    accuracy: total ? Math.round((correct / total) * 100) : null,
    best: rows.reduce((m, r) => Math.max(m, r.correct || 0), 0),
    perWin: wins ? Math.round((entries / wins) * 10) / 10 : null,
  };
}
const ADMIN_PIN         = "085419";                        // ← change this
const MAX_ENTRIES       = 5;
const SB_URL            = "https://oszrnwhyvmvccxxepsnm.supabase.co";
const SB_KEY            = "sb_publishable_V9itVh6Qu_ThqCfAEV5SBA_PagJsoG4";

// ─── Constants ────────────────────────────────────────────────────────────────
const OUTCOMES = [
  { key:"home", label:"Home Win", icon:"🏠" },
  { key:"draw", label:"Draw",     icon:"🤝" },
  { key:"away", label:"Away Win", icon:"✈️" },
];

// ─── Avatars, group badges ────────────────────────────────────────────────────
const AVATAR_EMOJIS = ["⚽","🏆","🥅","🧤","👟","⛳","🎯","🥊","🧢","🎩","🕶️","👑","🦁","🐺","🦅","🦈","🐂","🔥","⚡","🏎️","🎸","🍺","🥃","☕"];
const AVATAR_COLORS = ["#f0c040","#34d399","#60a5fa","#a78bfa","#f472b6","#fb923c","#f87171","#94a3b8"];
const GROUP_EMOJIS  = ["","⚽","🏆","🔥","🍺","🦁","🐯","🚀","🎯","👑","🍀","⭐","🧠","🎩"];
// Each group gets its own colour so it's obvious at a glance which one you're playing in.
const groupHue = id => { let h = 0; for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
// "Sat 14 Nov" or "Fri 13 – Sun 15 Nov": the dates a round's matches are played on (UK time).
// Weeks are numbered across the whole game, so dates are clearer than "Week 3" for a group that has only just started.
function roundDates(round) {
  const ts = ((round && round.fixtures) || []).map(f=>f.kickoffTs).filter(Number.isFinite);
  if (!ts.length) return round ? `Week ${round.week}` : "";
  const fmt = (t, o) => new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/London", ...o }).format(new Date(t));
  const a = Math.min(...ts), b = Math.max(...ts);
  const day = t => fmt(t, { weekday:"short", day:"numeric" }), full = t => fmt(t, { weekday:"short", day:"numeric", month:"short" });
  if (fmt(a,{day:"numeric",month:"short",year:"numeric"}) === fmt(b,{day:"numeric",month:"short",year:"numeric"})) return full(a);
  return fmt(a,{month:"short"}) === fmt(b,{month:"short"}) ? `${day(a)} – ${full(b)}` : `${full(a)} – ${full(b)}`;
}
const gLabel = g => g ? `${g.emoji ? g.emoji + " " : ""}${g.name}` : "";
const ProfilesCtx = createContext({});

// Recent form chips: W / D / L, oldest to newest. Letters as well as colours, so it works without colour.
function FormChips({ form, align = "left", label }) {
  if (!form || !form.length) return <div style={{flex:1}}/>;
  const col = { W:"var(--green)", D:"var(--muted)", L:"var(--red)" };
  return (
    <div style={{flex:1,display:"flex",gap:3,justifyContent:align==="right"?"flex-end":"flex-start"}} aria-label={`${label} recent form: ${form.join(" ")}`}>
      {form.map((r,i)=>(
        <span key={i} style={{width:17,height:17,borderRadius:4,fontSize:10,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",background:col[r]||"var(--muted)",opacity:i===form.length-1?1:0.8}}>{r}</span>
      ))}
    </div>
  );
}
function FormRow({ f }) {
  if (!f.form || (!(f.form.home||[]).length && !(f.form.away||[]).length)) return null;
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,margin:"2px 0 8px"}}>
      <FormChips form={f.form.home} label={f.home}/>
      <span style={{fontSize:9,color:"var(--muted)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Form</span>
      <FormChips form={f.form.away} align="right" label={f.away}/>
    </div>
  );
}
function AvatarBubble({ emoji, color, initial, size = 28 }) {
  const base = { width:size, height:size, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 };
  if (emoji) return <div style={{ ...base, background: color || "var(--gold)", fontSize: Math.round(size*0.55), lineHeight:1 }}>{emoji}</div>;
  return <div style={{ ...S.playerAvatar, width:size, height:size, fontSize: Math.round(size*0.43) }}>{initial}</div>;
}
function Avatar({ name, size = 28 }) {
  const p = useContext(ProfilesCtx)[name] || {};
  return <AvatarBubble emoji={p.avatar} color={p.avatar_color} initial={(name||"?")[0].toUpperCase()} size={size}/>;
}

// ─── Sign-in (Supabase Auth) ──────────────────────────────────────────────────
// The browser holds a short-lived access token; every database request is made as that player.
const AUTH_KEY = "fp_auth";
let onAuthLost = () => {};
const auth = {
  read()   { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; } },
  clear()  { try { localStorage.removeItem(AUTH_KEY); } catch {} },
  token()  { const a = this.read(); return (a && a.access_token) || null; },
  store(d) {
    const prev = this.read() || {};
    const rec = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000,
                  username: (d.user && d.user.user_metadata && d.user.user_metadata.username) || prev.username || null };
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(rec)); } catch {}
    return rec;
  },
  async signIn(username, password) {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY },
      body: JSON.stringify({ email: emailFor(username), password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return { ok: false, status: res.status };
    return { ok: true, session: this.store(data) };
  },
  // Renew the token shortly before it runs out
  async ensure() {
    const a = this.read();
    if (!a || a.expires_at - Date.now() > 60000) return;
    if (!this._refreshing) {
      this._refreshing = (async () => {
        try {
          const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY },
            body: JSON.stringify({ refresh_token: a.refresh_token }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.access_token) this.store(data);
          else if (res.status === 400 || res.status === 401 || res.status === 403) { this.clear(); onAuthLost(); }
        } catch {}
        this._refreshing = null;
      })();
    }
    await this._refreshing;
  },
  async changePassword(password) {
    await this.ensure();
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      method: "PUT", headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${this.token()}` },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.msg || d.message || "failed"); }
  },
};
// Calls the account function (sign-up, moving old accounts across, admin password resets)
async function accountCall(action, body) {
  await auth.ensure();
  const res = await fetch(`${SB_URL}/functions/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${auth.token() || SB_KEY}` },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

// ─── Supabase client (vanilla fetch, no SDK needed) ───────────────────────────
async function sbFetch(path, init = {}) {
  await auth.ensure();
  const token = auth.token();
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${token || SB_KEY}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    if (res.status === 401 && token) { auth.clear(); onAuthLost(); }
    throw new Error(await res.text());
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const REP = { Prefer: "return=representation" }, MIN = { Prefer: "return=minimal" };
const sb = {
  get:    (table, params = "")      => sbFetch(`${table}?${params}`),
  upsert: (table, body)             => sbFetch(table, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(body) }),
  insert: (table, body, minimal)    => sbFetch(table, { method: "POST", headers: minimal ? MIN : REP, body: JSON.stringify(body) }),
  patch:  (table, params, body)     => sbFetch(`${table}?${params}`, { method: "PATCH", headers: MIN, body: JSON.stringify(body) }),
  del:    async (table, params)     => { await sbFetch(`${table}?${params}`, { method: "DELETE", headers: MIN }); },
  rpc:    (fn, args = {})           => sbFetch(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }),

  // Live updates by polling every 5s. Returns a cancel function.
  pollFn(fetcher, onChange, intervalMs = 5000) {
    let last = null, stopped = false;
    async function check() {
      try {
        const data = await fetcher();
        if (stopped) return;
        const str = JSON.stringify(data);
        if (str !== last) { last = str; onChange(data); }
      } catch {}
    }
    check();
    const id = setInterval(check, intervalMs);
    return () => { stopped = true; clearInterval(id); };
  },
  poll(table, params, onChange, intervalMs) { return sb.pollFn(() => sb.get(table, params), onChange, intervalMs); },
};

// ─── DB helpers ───────────────────────────────────────────────────────────────
const db = {
  // Users
  async getUser(username) {
    const rows = await sb.get("users", `username=eq.${encodeURIComponent(username)}&select=username`);
    return rows[0] || null;
  },

  // Groups: each group has its own invite code, entries, history and winners
  async getMemberships(username) {
    return sb.get("memberships", `username=eq.${encodeURIComponent(username)}`);
  },
  async joinGroup(code) { return sb.rpc("join_group", { code }); },
  async getGroupsByIds(ids) {
    if (!ids.length) return [];
    return sb.get("groups", `id=in.(${ids.join(",")})&order=created_at.asc`);
  },
  async getGroup(id) {
    const rows = await sb.get("groups", `id=eq.${id}`);
    return rows[0] || null;
  },
  async createOwnGroup(name, emoji) { return sb.rpc("create_group", { p_name: name, p_emoji: emoji || "" }); },
  async createGroup(name, code, emoji) {   // admin only
    const rows = await sb.insert("groups", { name, invite_code: code, emoji: emoji || null });
    await sb.insert("group_state", { group_id: rows[0].id }, true);
    return rows[0];
  },
  async setGroupWinners(groupId, found) {
    return sb.patch("group_state", `group_id=eq.${groupId}`, { winners_found: found });
  },

  // Round (single row, id=1)
  async getRound(groupId) {
    const rows = await sb.get("round", "id=eq.1");
    if (!rows.length) return null;
    const r = rows[0];
    // The round (fixtures, results) is shared. Winner/run status is per group.
    let gs = null;
    if (groupId) { try { gs = (await sb.get("group_state", `group_id=eq.${groupId}`))[0] || null; } catch {} }
    return {
      league:       r.league,
      fixtures:     r.fixtures,
      mockResults:  r.mock_results || null,
      results:      r.results || null,
      series:       (gs && gs.series) || 1,
      week:         r.week,
      locked:       r.locked,
      winnersFound: gs ? !!gs.winners_found : false,
      createdAt:    new Date(r.created_at).getTime(),
    };
  },
  async setRound(round) {
    return sb.upsert("round", {
      id:            1,
      league:        round.league,
      fixtures:      round.fixtures,
      mock_results:  round.mockResults || null,
      results:       round.results || null,
      series:        round.series || 1,
      week:          round.week,
      locked:        round.locked,
      winners_found: round.winnersFound,
    });
  },
  async patchRound(fields) {
    // fields uses snake_case keys matching DB columns
    return sb.patch("round", "id=eq.1", fields);
  },

  // Submissions
  async getSubs(groupId) {
    if (!groupId) return [];
    const rows = await sb.rpc("group_entries", { gid: groupId });
    return rows.map(r => ({
      id:          r.id,
      username:    r.username,
      entryName:   r.entry_name,
      preds:       r.preds,
      submittedAt: new Date(r.submitted_at).getTime(),
    }));
  },
  async addSub(username, entryName, preds, groupId) {
    return sb.insert("submissions", { username, entry_name: entryName, preds, group_id: groupId }, true);
  },
  async updateSubPreds(id, preds) {
    return sb.patch("submissions", `id=eq.${id}`, { preds });
  },
  async getHistory(groupId) {
    if (!groupId) return [];
    return sb.get("history", `group_id=eq.${groupId}&order=week.asc`);
  },
  async clearSubs() {
    return sb.del("submissions", "submitted_at=gte.1970-01-01");
  },
  async clearAll() {
    await db.clearSubs();
    await sb.del("round", "id=eq.1");
  },
};

// ─── Session (just username in localStorage — no sensitive data) ──────────────
// The signed-in name is only trusted while a sign-in token exists too.
const session = {
  get: ()  => { try { return (auth.token() && localStorage.getItem("fp_session")) || null; } catch { return null; } },
  set: u   => { try { localStorage.setItem("fp_session", u); } catch {} },
  clear: () => { try { localStorage.removeItem("fp_session"); } catch {} auth.clear(); },
};

// ─── Confetti ─────────────────────────────────────────────────────────────────
function Confetti({ active }) {
  if (!active) return null;
  const pieces = Array.from({length:80},(_,i)=>({
    id:i, left:Math.random()*100,
    color:["#f0c040","#34d399","#60a5fa","#f87171","#a78bfa","#fb923c"][i%6],
    delay:Math.random()*2.5, duration:2.5+Math.random()*2, size:6+Math.random()*9,
  }));
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:200,overflow:"hidden"}}>
      {pieces.map(p=>(
        <div key={p.id} style={{position:"absolute",top:"-20px",left:`${p.left}%`,
          width:p.size,height:p.size,background:p.color,
          borderRadius:p.id%3===0?"50%":2,
          animation:`confettiFall ${p.duration}s ${p.delay}s ease-in both`}}/>
      ))}
    </div>
  );
}

// ─── PIN Modal ────────────────────────────────────────────────────────────────
function PinModal({ onSuccess, onCancel }) {
  const [pin,setPin]=useState(""); const [err,setErr]=useState(false); const [cls,setCls]=useState("");
  function attempt() {
    if (pin===ADMIN_PIN) { onSuccess(); }
    else { setErr(true); setPin(""); setCls("shake"); setTimeout(()=>setCls(""),400); }
  }
  return (
    <div style={S.backdrop}>
      <div style={S.modal} className={`pop ${cls}`}>
        <div style={{fontSize:32,marginBottom:6}}>🔐</div>
        <div style={S.modalTitle}>Admin Access</div>
        <div style={{fontSize:13,color:"var(--muted)",marginBottom:20}}>Enter the admin PIN</div>
        <input style={{...S.input,textAlign:"center",letterSpacing:"0.4em",fontSize:20,borderColor:err?"var(--red)":"var(--border)"}}
          type="password" maxLength={8} value={pin} autoFocus placeholder="••••"
          onChange={e=>{setPin(e.target.value);setErr(false);}}
          onKeyDown={e=>e.key==="Enter"&&attempt()}/>
        {err&&<div style={{fontSize:12,color:"var(--red)",marginTop:6}}>Incorrect PIN</div>}
        <div style={{display:"flex",gap:8,width:"100%",marginTop:16}}>
          <Btn onClick={onCancel} style={{flex:1}}>Cancel</Btn>
          <Btn gold onClick={attempt} disabled={!pin} style={{flex:1}}>Enter</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── How to play + FAQ ────────────────────────────────────────────────────────
const HOW_TO_PLAY = [
  "Each week you pick home, draw or away for 5 randomly selected Premier League fixtures.",
  `You can make up to ${MAX_ENTRIES} entries a week. Each one is a separate set of picks.`,
  "You can edit your entries until they lock, 1 minute before the first kick-off. Until then, nobody can see anyone else's picks.",
  "Get all 5 right and you win. If more than one person does, you share it.",
  "If nobody gets all 5, the run carries on to next week and everyone's entries keep adding up on The Story So Far.",
];
const FAQ = [
  ["What does it cost?", "Nothing. It's a game between friends. If you enjoy it, there's a tip link on the results screen."],
  ["Can I change an entry once I've made it?", "Yes, until entries lock (1 minute before the first kick-off). Open My Entries and tap Edit. After that, entries are sealed."],
  ["What if a match is postponed?", "The admin either voids it, which counts it as correct for everyone, or swaps in a replacement. If it's replaced, you re-pick just that match from the Lobby."],
  ["Why can't I see everyone else's picks?", "They stay hidden until entries lock, so nobody can copy. After the lock, picks are revealed in stages."],
  ["Who wins?", "Anyone who gets all 5 right in a week. Nobody gets 5? The run carries on and the entries keep adding up."],
  ["How do I invite friends or start my own group?", "Tap My Groups on the home screen. There you can share an invite link for your group, or create a new group of your own (up to 3)."],
  ["I forgot my password.", "On the sign-in page tap Forgot password?, type your username and send the request. The admin will set you a temporary password. You can change it on your profile."],
  ["Which games count?", "Five randomly selected Premier League fixtures each week. Results are collected automatically."],
];
function HelpContent() {
  return (
    <div style={{width:"100%",maxWidth:520,display:"flex",flexDirection:"column",gap:14,textAlign:"left"}}>
      <div style={{...S.card}}>
        <div style={S.sectionLabel}>How to play</div>
        <ol style={{margin:"6px 0 0",paddingLeft:20,fontSize:14,lineHeight:1.6}}>
          {HOW_TO_PLAY.map((t,i)=><li key={i} style={{marginBottom:6}}>{t}</li>)}
        </ol>
      </div>
      <div style={{...S.card}}>
        <div style={S.sectionLabel}>Questions</div>
        {FAQ.map(([q,a])=>(
          <details key={q} style={{borderTop:"1px solid var(--border)",padding:"8px 0"}}>
            <summary style={{cursor:"pointer",fontSize:14,fontWeight:600}}>{q}</summary>
            <div style={{fontSize:13,color:"var(--muted)",lineHeight:1.6,marginTop:6}}>{a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onLogin, theme, toggleTheme }) {
  const [tab,setTab]=useState(() => { try { return new URLSearchParams(window.location.search).get("join") ? "register" : "login"; } catch { return "login"; } });
  const [u,setU]=useState(""); const [pw,setPw]=useState("");
  const joinParam = (() => { try { return (new URLSearchParams(window.location.search).get("join") || "").toUpperCase(); } catch { return ""; } })();
  const [cpw,setCpw]=useState(""); const [inv,setInv]=useState(joinParam);
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  const [showHelp,setShowHelp]=useState(false);
  const [forgot,setForgot]=useState(false); const [resetNote,setResetNote]=useState(""); const [note,setNote]=useState("");

  async function login() {
    setErr(""); setLoading(true);
    const name = u.trim();
    if (!name || !pw) { setErr("Enter your username and password."); setLoading(false); return; }
    try {
      let r = await auth.signIn(name, pw);
      if (!r.ok) {
        // Accounts from before the new sign-in are moved across the first time they sign in
        const c = await accountCall("claim", { username: name, password: pw });
        if (c.ok) r = await auth.signIn(name, pw);
        else if (c.json && c.json.code === "short_password") { setErr(c.json.error); setLoading(false); return; }
      }
      if (!r.ok) { setErr("Wrong username or password."); setLoading(false); return; }
      const who = r.session.username || name;
      session.set(who); onLogin(who);
    } catch { setErr("Connection error — check your internet."); }
    setLoading(false);
  }

  async function register() {
    setErr(""); setLoading(true);
    const trimmed=u.trim();
    if (trimmed.length<2)                        { setErr("Username must be at least 2 characters."); setLoading(false); return; }
    if (trimmed.length>20)                       { setErr("Username must be 20 characters or less."); setLoading(false); return; }
    if (!/^[A-Za-z0-9 _.-]+$/.test(trimmed))     { setErr("Usernames can use letters, numbers, spaces, dots, dashes and underscores."); setLoading(false); return; }
    if (pw.length<6)                             { setErr("Password must be at least 6 characters."); setLoading(false); return; }
    if (pw!==cpw)                                { setErr("Passwords don't match."); setLoading(false); return; }
    try {
      const r = await accountCall("register", { username: trimmed, password: pw, invite: inv.trim().toUpperCase() });
      if (!r.ok) { setErr((r.json && r.json.error) || "Couldn't create the account. Try again."); setLoading(false); return; }
      const si = await auth.signIn(trimmed, pw);
      if (!si.ok) { setErr("Account created. Please sign in."); setTab("login"); setLoading(false); return; }
      const who = si.session.username || trimmed;
      session.set(who); onLogin(who);
    } catch { setErr("Connection error — check your internet."); }
    setLoading(false);
  }

  async function sendResetRequest() {
    setErr(""); setNote("");
    const name = u.trim();
    if (!name) { setErr("Type your username first."); return; }
    setLoading(true);
    try {
      await sb.insert("reset_requests", { username: name, note: resetNote.trim().slice(0, 300) || null }, true);
      setNote("Request sent. The admin will set you a temporary password and let you know.");
      setResetNote("");
    } catch (e) {
      setErr(String(e.message || e).toLowerCase().includes("wait") ? "You've already asked recently. Give it a few minutes." : "Couldn't send the request. Try again in a minute.");
    }
    setLoading(false);
  }

  const go = () => tab==="login"?login():register();

  return (
    <Screen>
      <button onClick={toggleTheme} aria-label="Switch between light and dark mode" style={{...S.navBtn,position:"fixed",top:12,right:16}}>
        {theme==="dark"?"☀️":"🌙"}
      </button>
      <div style={S.bigLogo}>
        <div style={{fontSize:56,marginBottom:8}}>⚽</div>
        <div style={S.bigTitle}>THE GAFFER</div>
        <div style={S.bigSub}>Weekly Football Prediction League</div>
      </div>
      <div style={{display:"flex",width:"100%",maxWidth:360,marginBottom:4,background:"var(--surface2)",borderRadius:10,padding:4,border:"1px solid var(--border)"}}>
        {["login","register"].map(t=>(
          <button key={t} onClick={()=>{setTab(t);setErr("");}}
            style={{flex:1,padding:"9px",borderRadius:8,border:"none",fontSize:13,fontWeight:600,
              background:tab===t?"var(--gold)":"transparent",color:tab===t?"var(--ink)":"var(--muted)",transition:"all 0.2s"}}>
            {t==="login"?"Sign In":"Register"}
          </button>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:11,width:"100%",maxWidth:360}}>
        <Field label="Username"><input style={S.input} value={u} onChange={e=>setU(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="your_username" autoFocus autoCapitalize="none"/></Field>
        <Field label="Password"><input style={S.input} type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="••••••••"/></Field>
        {tab==="register"&&<>
          <div style={{fontSize:11,color:"var(--muted)",lineHeight:1.5,marginTop:-4}}>🔒 Use a password you don't use anywhere else. This is a fun game, not a bank.</div>
          <Field label="Confirm Password"><input style={S.input} type="password" value={cpw} onChange={e=>setCpw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="••••••••"/></Field>
          <Field label="Invite Code"><input style={S.input} value={inv} onChange={e=>setInv(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="Ask the admin" autoCapitalize="characters"/></Field>
        </>}
        {err&&<ErrorBox>{err}</ErrorBox>}
        {note&&<div role="status" style={{fontSize:13,color:"var(--green)",lineHeight:1.5}}>{note}</div>}
        {loading?<Loader msg={tab==="login"?"Signing in…":"Creating account…"}/>:
          <Btn gold onClick={go} style={{marginTop:4}}>{tab==="login"?"Sign In →":"Create Account →"}</Btn>}
        <button onClick={()=>setShowHelp(h=>!h)} aria-expanded={showHelp} style={{background:"none",border:"none",color:"var(--muted)",fontSize:12,textDecoration:"underline",padding:4}}>{showHelp?"Hide help":"How does this work?"}</button>
        {tab==="login"&&!forgot&&<button onClick={()=>{setForgot(true);setErr("");setNote("");}} style={{background:"none",border:"none",color:"var(--muted)",fontSize:12,textDecoration:"underline",padding:4}}>Forgot password?</button>}
        {tab==="login"&&forgot&&<div style={{...S.card,display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.5}}>Type your username above, then send a request. The admin will set you a temporary password and tell you what it is. You can change it once you're in.</div>
          <Field label="Message for the admin (optional)"><input style={S.input} value={resetNote} onChange={e=>setResetNote(e.target.value)} maxLength={300} placeholder="e.g. I'm Dave, Pete's mate from the pub league"/></Field>
          <Btn onClick={sendResetRequest} disabled={loading}>Send reset request</Btn>
        </div>}
      </div>
      {showHelp&&<HelpContent/>}
    </Screen>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [username,  setUsername]  = useState(session.get());
  const [view,      setView]      = useState("home");
  const [round,     setRound]     = useState(null);
  const [subs,      setSubs]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [loadMsg,   setLoadMsg]   = useState("");
  const [error,     setError]     = useState("");
  const [confetti,  setConfetti]  = useState(false);
  const [results,   setResults]   = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [appReady,  setAppReady]  = useState(false); // initial load complete
  const [history,   setHistory]   = useState([]);
  const [groupId,   setGroupId]   = useState(null);
  const [myGroups,  setMyGroups]  = useState([]);
  const [joinCode,  setJoinCode]  = useState("");
  const [joinErr,   setJoinErr]   = useState("");
  const [theme,     setTheme]     = useState(() => {
    try { const t = localStorage.getItem("fp_theme"); if (t === "light" || t === "dark") return t; } catch {}
    return (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
  });
  const [profiles,  setProfiles]  = useState({});
  const [profAvatar, setProfAvatar] = useState("");
  const [myStats,   setMyStats]   = useState(null);
  const [shareNote, setShareNote]  = useState("");
  const [ownGroupName, setOwnGroupName] = useState("");
  const [profColor,  setProfColor]  = useState(AVATAR_COLORS[0]);
  const [newGroupEmoji, setNewGroupEmoji] = useState("");
  const [fbCategory, setFbCategory] = useState("idea");
  const [fbText,     setFbText]     = useState("");
  const [fbNote,     setFbNote]     = useState("");
  const [feedbackList, setFeedbackList] = useState([]);
  const [resets,     setResets]     = useState([]);
  const [tempPw,     setTempPw]     = useState(null);   // { username, tempPassword } shown once to the admin
  const [newPw,      setNewPw]      = useState("");
  const [pwNote,     setPwNote]     = useState("");
  const [groups,    setGroups]    = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupCode, setNewGroupCode] = useState("");
  const [storySeries, setStorySeries] = useState(null);

  const [isAdmin,   setIsAdmin]   = useState(false);
  const [showPin,   setShowPin]   = useState(false);
  const [pinTarget, setPinTarget] = useState(null);
  const [entryName, setEntryName] = useState("");
  const [preds,     setPreds]     = useState({});
  const [entryView, setEntryView] = useState("list");
  const [submitDone,setSubmitDone]= useState(false);
  const [editing,   setEditing]   = useState(null);   // the entry being edited, or null when making a new one

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("fp_theme", theme); } catch {}
  }, [theme]);
  // ── Installable app + invite links ───────────────────────────────────────
  useEffect(() => {
    try {
      const add = (tag, attrs) => { const el = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); document.head.appendChild(el); };
      if (!document.querySelector('link[rel="manifest"]')) {
        add("link", { rel: "manifest", href: "/manifest.webmanifest" });
        add("meta", { name: "theme-color", content: "#05080f" });
        add("link", { rel: "apple-touch-icon", href: "/icon-192.png" });
        add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
      }
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    } catch {}
  }, []);
  useEffect(() => {
    if (!username || !appReady) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const code = (params.get("join") || "").toUpperCase();
      if (!code) return;
      setJoinCode(code); setJoinErr(""); setView("join");
      window.history.replaceState({}, "", window.location.pathname);
    } catch {}
  }, [username, appReady]);
  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");
  useEffect(() => { onAuthLost = () => { session.clear(); setUsername(null); setIsAdmin(false); setView("home"); }; return () => { onAuthLost = () => {}; }; }, []);

  // ── Player avatars ────────────────────────────────────────────────────────
  async function loadProfiles() {
    try {
      const rows = await sb.get("users", "select=username,avatar,avatar_color");
      setProfiles(Object.fromEntries(rows.map(r => [r.username, r])));
    } catch {}
  }
  useEffect(() => { if (username && appReady) loadProfiles(); }, [username, appReady, view, groupId]);

  function openProfile() {
    const me = profiles[username] || {};
    setProfAvatar(me.avatar || "");
    setProfColor(me.avatar_color || AVATAR_COLORS[0]);
    setError(""); setMyStats(null); setView("profile");
    sb.get("history", `username=eq.${encodeURIComponent(username)}&select=correct,total,perfect`)
      .then(rows => setMyStats(profileStats(rows))).catch(() => setMyStats(profileStats([])));
  }
  async function shareGroupInvite() {
    const g = myGroups.find(x => x.id === groupId); if (!g) return;
    const r = await shareOrCopy(`Join my group "${g.name}" on The Gaffer, the weekly football prediction game. Use code ${g.invite_code}.`, inviteLink(g.invite_code));
    setShareNote(r === "copied" ? "Invite copied. Paste it into your group chat." : r === "failed" ? "Couldn't share. Copy the code instead." : "");
  }
  async function createOwnGroup() {
    const name = ownGroupName.trim();
    if (name.length < 2) { setJoinErr("Give your group a name (2+ characters)."); return; }
    setJoinErr(""); setLoading(true); setLoadMsg("Creating group…");
    try {
      const g = await db.createOwnGroup(name, "");
      setMyGroups(gs => [...gs, g]); setOwnGroupName("");
      await switchGroup(g.id);
      setShareNote("Group created! Share the invite from the Join screen.");
    } catch { setJoinErr(`Couldn't create the group. You can start up to ${MAX_OWN_GROUPS} of your own.`); setLoading(false); }
  }
  async function saveProfile() {
    setLoading(true); setLoadMsg("Saving…"); setError("");
    try {
      await sb.patch("users", `username=eq.${encodeURIComponent(username)}`, { avatar: profAvatar || null, avatar_color: profColor });
      await loadProfiles();
      setView("home");
    } catch { setError("Couldn't save your profile. Try again."); }
    setLoading(false);
  }

  // ── Feedback ──────────────────────────────────────────────────────────────
  async function sendFeedback() {
    const message = fbText.trim();
    if (!message) return;
    setLoading(true); setLoadMsg("Sending…"); setFbNote(""); setError("");
    try {
      await sb.insert("feedback", { username, group_id: groupId, category: fbCategory, message }, true);
      setFbText(""); setFbNote("Thanks! Your feedback has been sent.");
    } catch (e) {
      setError(String(e.message||e).includes("wait") ? "Please wait a couple of minutes before sending another message." : "Couldn't send your feedback. Try again.");
    }
    setLoading(false);
  }
  async function loadFeedback() {
    try { setFeedbackList(await sb.get("feedback", "order=created_at.desc&limit=30")); } catch { setFeedbackList([]); }
  }
  async function loadResets() {
    try { setResets(await sb.get("reset_requests", "status=eq.new&order=created_at.asc")); } catch { setResets([]); }
  }
  async function resetPlayerPassword(row) {
    setError(""); setTempPw(null);
    try {
      const r = await accountCall("reset_password", { username: row.username, request_id: row.id });
      if (!r.ok) { setError((r.json && r.json.error) || "Couldn't reset that password."); return; }
      setTempPw({ username: r.json.username, tempPassword: r.json.tempPassword });
      await loadResets();
    } catch { setError("Couldn't reset that password."); }
  }
  async function dismissReset(id) {
    try { await sb.patch("reset_requests", `id=eq.${id}`, { status: "dismissed" }); await loadResets(); } catch { setError("Couldn't update that request."); }
  }
  async function saveNewPassword() {
    setPwNote(""); setError("");
    if (newPw.length < 6) { setError("Password must be at least 6 characters."); return; }
    try { await auth.changePassword(newPw); setNewPw(""); setPwNote("Password changed."); }
    catch { setError("Couldn't change your password. Try a longer or less common one."); }
  }
  async function setFeedbackStatus(id, status) {
    try {
      await sb.patch("feedback", `id=eq.${id}`, { status });
      await loadFeedback();
    } catch { setError("Couldn't update that item."); }
  }
  async function setGroupEmoji(id, emoji) {
    try {
      await sb.patch("groups", `id=eq.${id}`, { emoji: emoji || null });
      setMyGroups(gs => gs.map(g => g.id === id ? { ...g, emoji: emoji || null } : g));
      await loadGroups();
    } catch { setError("Couldn't change the badge."); }
  }

  // ── Initial load from Supabase (runs again whenever someone signs in/out) ──
  useEffect(() => {
    async function init() {
      setAppReady(false);
      if (!username) { setGroupId(null); setMyGroups([]); setAppReady(true); return; }
      try {
        const u = await db.getUser(username);
        if (!u) { session.clear(); setUsername(null); setAppReady(true); return; }
        let ids = (await db.getMemberships(username)).map(m => m.group_id);
        const gs = await db.getGroupsByIds(ids);
        setMyGroups(gs);
        let stored = null;
        try { stored = localStorage.getItem("fp_group"); } catch {}
        const gid = (gs.find(g => g.id === stored) || gs[0] || {}).id || null;
        setGroupId(gid);
        const [r, s] = await Promise.all([db.getRound(gid), db.getSubs(gid)]);
        setRound(r); setSubs(s);
      } catch (e) {
        setError("Couldn't connect to database. Check your internet connection.");
      }
      setAppReady(true);
    }
    init();
  }, [username]);

  // ── Switch / join groups ──────────────────────────────────────────────────
  async function switchGroup(id) {
    if (!id || id === groupId) return;
    try { localStorage.setItem("fp_group", id); } catch {}
    setLoading(true); setLoadMsg("Switching group…"); setError("");
    setSubs([]); setHistory([]); setResults(null);
    try {
      setGroupId(id);
      const [r, s] = await Promise.all([db.getRound(id), db.getSubs(id)]);
      setRound(r); setSubs(s);
    } catch { setError("Couldn't switch group — try again."); }
    setView("home"); setLoading(false);
  }
  async function joinGroup() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoinErr(""); setLoading(true); setLoadMsg("Joining…");
    try {
      const g = await db.joinGroup(code);
      if (!myGroups.some(x => x.id === g.id)) setMyGroups(gs => [...gs, g]);
      setJoinCode("");
      if (g.id === groupId) { setView("home"); setLoading(false); return; }
      await switchGroup(g.id);
    } catch (e) { setJoinErr(String(e.message || e).includes("Invalid invite") ? "Invalid invite code." : "Couldn't join. Try again."); setLoading(false); }
  }

  async function loadGroups() {
    try {
      const [gs, us] = await Promise.all([sb.get("groups","order=created_at.asc"), sb.get("memberships","select=group_id")]);
      setGroups(gs.map(g=>({...g, members: us.filter(u=>u.group_id===g.id).length})));
    } catch { setGroups([]); }
  }
  async function addGroup() {
    const name=newGroupName.trim(), code=newGroupCode.trim().toUpperCase();
    if (name.length<2||code.length<4) { setError("Give the group a name and a code of at least 4 characters."); return; }
    setLoading(true); setLoadMsg("Creating group…"); setError("");
    try {
      await db.createGroup(name, code, newGroupEmoji);
      setNewGroupName(""); setNewGroupCode(""); setNewGroupEmoji("");
      await loadGroups();
    } catch { setError("Couldn't create the group. That code may already be in use."); }
    setLoading(false);
  }

  async function openStory() {
    setError("");
    try { setHistory(await db.getHistory(groupId)); } catch { setHistory([]); }
    setStorySeries(null);
    setView("story");
  }

  // ── Poll for live updates (round + this group's subs every 5s) ───────────
  useEffect(() => {
    if (!appReady || !groupId) return;
    const refreshRound = async () => { setRound(await db.getRound(groupId)); };
    const cancelRound = sb.poll("round", "", refreshRound);
    const cancelState = sb.poll("group_state", `group_id=eq.${groupId}`, refreshRound);
    const cancelSubs = sb.pollFn(() => db.getSubs(groupId), setSubs);
    return () => { cancelRound(); cancelState(); cancelSubs(); };
  }, [appReady, groupId]);

  // ── Deadline ticker ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!round||round.locked) { setCountdown(null); return; }
    function tick() {
      const ms = msUntilDeadline(round.fixtures);
      if (ms===null) { setCountdown(null); return; }
      if (ms<=0) {
        setCountdown("00:00:00");
        const updated = { ...round, locked:true };
        setRound(updated);
        db.patchRound({ locked:true }).catch(()=>{});
      } else { setCountdown(fmtCountdown(ms)); }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [round]);

  const groupName      = gLabel(myGroups.find(g=>g.id===groupId));
  const myEntries      = username ? subs.filter(s=>s.username===username) : [];
  const deadlineLocked = round ? isDeadlinePassed(round.fixtures) : false;
  const canAddEntry    = myEntries.length < MAX_ENTRIES && !deadlineLocked;
  const allPicked      = Object.keys(preds).length === 5;
  // An entry with exactly the same picks as one you already made in this group is refused.
  const duplicateOf    = allPicked ? myEntries.find(e=>(!editing||e.id!==editing.id)&&[0,1,2,3,4].every(i=>e.preds&&e.preds[i]===preds[i])) : null;
  const unchanged      = !!editing && [0,1,2,3,4].every(i=>editing.preds&&editing.preds[i]===preds[i]);

  // ── Admin gate ────────────────────────────────────────────────────────────
  function requireAdmin(target) {
    if (isAdmin) executeAdmin(target);
    else { setPinTarget(target); setShowPin(true); }
  }
  function onPinSuccess() { setIsAdmin(true); setShowPin(false); executeAdmin(pinTarget); }
  function executeAdmin(t) {
    if (t==="reset")   { doReset(); }
    if (t==="newweek") { doNewWeek(); }
    if (t==="admin")   { loadGroups(); loadFeedback(); loadResets(); setView("admin"); }
  }

  // ── Submit an entry ───────────────────────────────────────────────────────
  async function submitEntry() {
    if (!allPicked||(!editing&&!canAddEntry)||round?.locked||deadlineLocked) return;
    if (duplicateOf) { setError(`Those picks are exactly the same as ${duplicateOf.entryName}. Change at least one pick.`); return; }
    setError("");
    setLoading(true); setLoadMsg(editing?"Saving changes…":"Sealing entry…");
    try {
      if (editing) await db.updateSubPreds(editing.id, { 0:preds[0], 1:preds[1], 2:preds[2], 3:preds[3], 4:preds[4] });
      else await db.addSub(username, `Entry ${myEntries.length+1}`, preds, groupId);   // auto-named, no typing needed
      const s = await db.getSubs(groupId);
      setSubs(s);
      setPreds({}); setEntryName(""); setEntryView("list"); setSubmitDone(editing?"updated":true); setEditing(null);
    } catch { setError(editing?"Couldn't save your changes. If entries have just closed, they can't be changed now.":"Couldn't save entry — try again."); }
    setLoading(false);
  }

  // ── Reveal ────────────────────────────────────────────────────────────────
  async function startReveal() {
    setLoading(true); setLoadMsg("Checking results…"); setError("");
    try {
      const fresh = (await db.getRound(groupId)) || round;
      let parsed;
      if (fresh.mockResults) {
        parsed = fresh.mockResults;               // test mode
      } else {
        parsed = fresh.results;                   // saved by update-results.js
        if (!Array.isArray(parsed) || parsed.length !== fresh.fixtures.length) {
          setError("Results aren't in yet. They're picked up automatically once the matches have finished, so check back later.");
          setLoading(false); return;
        }
        if (parsed.every(r=>r.result==="upcoming")) {
          setError("No results are in yet. They're picked up automatically once matches have finished, so check back later.");
          setLoading(false); return;
        }
      }
      await db.patchRound({ locked:true });
      setRound(await db.getRound(groupId));
      setResults(parsed); setView("reveal");
    } catch {
      setError("Couldn't load results — try again later.");
    }
    setLoading(false);
  }

  // ── Admin: void / un-void a fixture ──────────────────────────────────────
  async function setVoid(i, on) {
    if (on && !window.confirm(`Void fixture #${i+1}? Everyone will be counted as correct for it.`)) return;
    setLoading(true); setLoadMsg("Updating…"); setError("");
    try {
      const fresh = (await db.getRound(groupId)) || round;
      const base = (Array.isArray(fresh.results) && fresh.results.length===fresh.fixtures.length
        ? fresh.results : fresh.fixtures.map(()=>({result:"upcoming",score:null}))).map(r=>({...r}));
      base[i] = on ? { result:"void", score:null, voided:true } : { result:"upcoming", score:null };
      await db.patchRound({ results: base });
      setRound(await db.getRound(groupId));
    } catch(e) { setError("Couldn't update: "+e.message); }
    setLoading(false);
  }

  // ── Re-pick a replaced fixture ────────────────────────────────────────────
  async function saveRepick(sub, i, key) {
    setLoading(true); setLoadMsg("Saving pick…"); setError("");
    try {
      await db.updateSubPreds(sub.id, { ...sub.preds, [String(i)]: key });
      setSubs(await db.getSubs(groupId));
    } catch { setError("Couldn't save your pick — try again."); }
    setLoading(false);
  }

  // ── Reveal complete ───────────────────────────────────────────────────────
  async function onRevealComplete(winners) {
    if (winners.length>0) {
      await db.patchRound({ locked:true });
      await db.setGroupWinners(groupId, true);
      const r = await db.getRound(groupId);
      setRound(r);
      setConfetti(true);
    }
  }

  // ── New week — fixtures now come from the local Monday script ───────────
  // This just refreshes the round/subs from Supabase after the script has run.
  async function doNewWeek() {
    setLoading(true); setLoadMsg("Refreshing fixtures from database…");
    try {
      const [r, s] = await Promise.all([db.getRound(groupId), db.getSubs(groupId)]);
      setRound(r); setSubs(s); setResults(null); setView("lobby");
    } catch { setError("Couldn't refresh — check your connection."); }
    setLoading(false);
  }

  // ── Full reset ────────────────────────────────────────────────────────────
  async function doReset() {
    setLoading(true); setLoadMsg("Resetting…");
    try {
      await db.clearAll();
    } catch {}
    setRound(null); setSubs([]); setResults(null); setView("home");
    setPreds({}); setEntryName(""); setEntryView("list");
    setSubmitDone(false); setConfetti(false); setError("");
    setLoading(false);
  }

  function signOut() {
    session.clear(); setUsername(null); setIsAdmin(false); setView("home");
    setPreds({}); setEntryName(""); setEntryView("list"); setSubmitDone(false);
  }

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!username) return <AuthScreen onLogin={u=>setUsername(u)} theme={theme} toggleTheme={toggleTheme}/>;

  // ── Loading initial data ───────────────────────────────────────────────────
  if (!appReady) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)"}}>
      <Loader msg="Connecting…"/>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ProfilesCtx.Provider value={profiles}>
    <div style={S.root}>
      <Confetti active={confetti}/>
      {showPin&&<PinModal onSuccess={onPinSuccess} onCancel={()=>setShowPin(false)}/>}

      {/* Nav */}
      <div style={{...S.nav,...(myGroups.length>1&&groupId?{borderBottom:`3px solid hsl(${groupHue(groupId)} 65% 52%)`}:{})}}>
        <div style={S.navLogo} onClick={()=>setView("home")}>⚽ THE GAFFER</div>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
          <Avatar name={username} size={24}/>
          <span style={{fontSize:13,color:"var(--muted)",maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{username}{myGroups.length===1&&groupName?` · ${groupName}`:""}</span>
          {myGroups.length>1&&(
            <select value={groupId||""} onChange={e=>switchGroup(e.target.value)}
              style={{...S.input,width:"auto",maxWidth:"min(280px, 44vw)",padding:"4px 8px",fontSize:12,border:`2px solid hsl(${groupHue(groupId)} 65% 52%)`}}>
              {myGroups.map(g=><option key={g.id} value={g.id}>{gLabel(g)}</option>)}
            </select>
          )}
          <button style={S.navBtn} onClick={toggleTheme} aria-label="Switch between light and dark mode">{theme==="dark"?"☀️":"🌙"}</button>
          <button style={S.navBtn} onClick={signOut}>Sign out</button>
        </div>
      </div>

      {/* Which group am I in? Shown when you belong to more than one. */}
      {myGroups.length>1&&groupId&&["home","submit","lobby","story","reveal"].includes(view)&&(()=>{
        const h = groupHue(groupId);
        return (
          <div role="status" aria-label={`Playing in ${groupName}`} style={{display:"flex",justifyContent:"center",padding:"8px 16px",marginTop:56,marginBottom:-34,background:`hsl(${h} 65% 52% / 0.2)`,borderBottom:`3px solid hsl(${h} 65% 52%)`}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:16,fontWeight:800,color:"var(--text)",maxWidth:"100%"}}>
              <span style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--muted)"}}>Playing in</span>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{groupName}</span>
            </div>
          </div>
        );
      })()}

      {/* ── HOME ── */}
      {view==="home"&&(
        <Screen>
          <div style={S.bigLogo}>
            <div style={{fontSize:52,marginBottom:8}}>⚽</div>
            <div style={S.bigTitle}>THE GAFFER</div>
            <div style={S.bigSub}>Weekly Football Prediction League</div>
            {groupName&&<div style={{marginTop:12,display:"inline-block",padding:"6px 18px",borderRadius:999,fontSize:18,fontWeight:800,color:"var(--text)",
              border:`2px solid hsl(${groupHue(groupId)} 65% 52%)`,background:`hsl(${groupHue(groupId)} 65% 52% / 0.18)`}}>{groupName}</div>}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:360}}>
            <Btn gold onClick={()=>{setEntryView("list");setView("submit");}} disabled={!round||round.locked||deadlineLocked}>
              ✏️ My Predictions
            </Btn>
            <Btn onClick={()=>setView("lobby")} disabled={!round}>👥 Lobby</Btn>
            <Btn onClick={openStory}>📊 The Story So Far</Btn>
            <Btn onClick={()=>{setJoinErr("");setJoinCode("");setView("join");}}>👥 My Groups</Btn>
            <Btn onClick={openProfile}>🙂 My Profile</Btn>
            <Btn onClick={()=>setView("help")}>❓ How to play</Btn>
            <Btn onClick={()=>{setFbNote("");setError("");setView("feedback");}}>💬 Send feedback</Btn>
          </div>
          {round?(
            <div style={S.pill}>
              {groupName&&<><span style={{fontWeight:600}}>{groupName}</span><span style={{color:"var(--muted)",margin:"0 8px"}}>·</span></>}
              <span style={{color:"var(--gold)",fontWeight:600}}>{round.league.flag} {round.league.name}</span>
              <span style={{color:"var(--muted)",margin:"0 8px"}}>·</span>
              <span style={{color:"var(--muted)"}}>{roundDates(round)}</span>
              <span style={{color:"var(--muted)",margin:"0 8px"}}>·</span>
              <span style={{color:"var(--muted)"}}>{subs.length} entr{subs.length!==1?"ies":"y"}</span>
              {(round.locked||deadlineLocked)&&<span style={{color:"var(--red)",marginLeft:8,fontSize:11}}>🔒 Locked</span>}
              {!round.locked&&!deadlineLocked&&countdown&&<span style={{color:"var(--gold)",marginLeft:8,fontSize:11,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.1em"}}>⏱ {countdown}</span>}
            </div>
          ):(
            <div style={{color:"var(--muted)",fontSize:13,textAlign:"center"}}>No active round — waiting for the admin.</div>
          )}
          <button style={S.adminLink} onClick={()=>requireAdmin("admin")}>
            {isAdmin?"⚙️ Admin Panel":"🔐 Admin"}
          </button>
        </Screen>
      )}

      {/* ── ADMIN PANEL ── */}
      {view==="admin"&&(
        <Screen>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle eyebrow="Admin" title="Admin Panel"
            sub="Fixtures are set automatically every Monday at 7am by your local script."/>
          {error&&<ErrorBox>{error}</ErrorBox>}

          {/* Current round status */}
          <div style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"16px"}}>
            <div style={S.sectionLabel}>Current Round</div>
            {round ? (
              <>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"var(--gold)",marginBottom:4}}>
                  {round.league.flag} {round.league.name} — {roundDates(round)}
                </div>
                <div style={{fontSize:13,color:"var(--muted)",marginBottom:12}}>
                  {subs.length} entr{subs.length!==1?"ies":"y"} · {round.locked?"🔒 Locked":"🟢 Open"}
                  {round.winnersFound?" · 🏆 Winner found":""}
                </div>
                <div style={{fontSize:13,color:"var(--muted)",marginBottom:12}}>
                  {round.mockResults
                    ? "Results: test mode"
                    : Array.isArray(round.results)
                      ? `Results: ${round.results.filter(r=>r.result!=="upcoming").length}/${round.fixtures.length} final`
                      : "Results: not checked yet"}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {round.fixtures.map((f,i)=>(
                    <div key={i} style={{fontSize:13,color:"var(--text)",display:"flex",gap:8}}>
                      <span style={{color:"var(--muted)",width:20}}>#{i+1}</span>
                      <span>{f.home} vs {f.away}{f.replaced?" 🔁":""}</span>
                      <span style={{color:"var(--muted)",marginLeft:"auto"}}>{f.date}</span>
                      {!round.mockResults&&(
                        round.results?.[i]?.result==="void"
                          ? <button style={S.dangerLink} onClick={()=>setVoid(i,false)}>Un-void</button>
                          : !round.winnersFound&&(!round.results?.[i]||round.results[i].result==="upcoming")
                            ? <button style={S.dangerLink} onClick={()=>setVoid(i,true)}>Void</button>
                            : null
                      )}
                    </div>
                  ))}
                </div>
                <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.6,marginTop:12}}>
                  <b>Postponed match?</b> <b>Void</b> counts it as correct for everyone. To <b>replace</b> it instead, run{" "}
                  <code style={{color:"var(--gold)"}}>node replace-fixture.js 3</code> (use the match number) in the scripts folder.
                  Players then re-pick just that match from the Lobby.
                </div>
              </>
            ) : (
              <div style={{fontSize:13,color:"var(--muted)"}}>
                No active round. Run the Monday script to populate fixtures.
              </div>
            )}
          </div>

          {/* Groups */}
          <div style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"16px"}}>
            <div style={S.sectionLabel}>Groups</div>
            {groups.map(g=>(
              <div key={g.id} style={{fontSize:13,display:"flex",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                <select aria-label={`Badge for ${g.name}`} value={g.emoji||""} onChange={e=>setGroupEmoji(g.id,e.target.value)}
                  style={{...S.input,width:56,padding:"2px 4px",fontSize:14}}>
                  {GROUP_EMOJIS.map(em=><option key={em||"none"} value={em}>{em||"–"}</option>)}
                </select>
                <span style={{flex:1}}>{g.name}</span>
                <code style={{color:"var(--gold)"}}>{g.invite_code}</code>
                <span style={{color:"var(--muted)",width:64,textAlign:"right"}}>{g.members} player{g.members!==1?"s":""}</span>
              </div>
            ))}
            {groups.length===0&&<div style={{fontSize:13,color:"var(--muted)"}}>No groups found.</div>}
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12}}>
              <div style={{display:"flex",gap:8}}>
                <select aria-label="New group badge" value={newGroupEmoji} onChange={e=>setNewGroupEmoji(e.target.value)} style={{...S.input,width:64}}>
                  {GROUP_EMOJIS.map(em=><option key={em||"none"} value={em}>{em||"–"}</option>)}
                </select>
                <input style={S.input} placeholder="New group name" value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} maxLength={30}/>
              </div>
              <input style={S.input} placeholder="Invite code (e.g. GAFFERMATES26)" value={newGroupCode} onChange={e=>setNewGroupCode(e.target.value.toUpperCase())} maxLength={24} autoCapitalize="characters"/>
              <Btn onClick={addGroup} disabled={loading}>+ Add group</Btn>
            </div>
          </div>

          {/* Password resets */}
          <div style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"16px"}} aria-label="Password resets">
            <div style={S.sectionLabel}>Password resets ({resets.length} waiting)</div>
            {tempPw&&<div role="status" style={{padding:"10px 12px",marginBottom:8,borderRadius:8,border:"1px solid var(--gold)",fontSize:13,lineHeight:1.5}}>
              Temporary password for <b>{tempPw.username}</b>: <span style={{fontFamily:"monospace",fontSize:16,letterSpacing:1}}>{tempPw.tempPassword}</span><br/>
              <span style={{color:"var(--muted)",fontSize:12}}>Send it to them privately. It is only shown now. They can change it on their profile.</span>
            </div>}
            {resets.length===0&&<div style={{fontSize:13,color:"var(--muted)"}}>Nobody is waiting.</div>}
            {resets.map(r=>(
              <div key={r.id} style={{padding:"10px 0",borderTop:"1px solid var(--border)"}}>
                <div style={{display:"flex",gap:8,fontSize:13,alignItems:"baseline"}}>
                  <b>{r.username}</b>
                  <span style={{marginLeft:"auto",fontSize:11,color:"var(--muted)"}}>{r.created_at?new Date(r.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):""}</span>
                </div>
                {r.note&&<div style={{fontSize:12,color:"var(--muted)",margin:"2px 0 6px",wordBreak:"break-word"}}>{r.note}</div>}
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <Btn onClick={()=>resetPlayerPassword(r)}>Set temporary password</Btn>
                  <button style={S.dangerLink} onClick={()=>dismissReset(r.id)}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>

          {/* Feedback */}
          <div style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"16px"}}>
            <div style={S.sectionLabel}>Feedback ({feedbackList.filter(f=>f.status!=="done").length} open)</div>
            {feedbackList.length===0&&<div style={{fontSize:13,color:"var(--muted)"}}>Nothing yet.</div>}
            {feedbackList.map(f=>(
              <div key={f.id} style={{padding:"10px 0",borderTop:"1px solid var(--border)",opacity:f.status==="done"?0.5:1}}>
                <div style={{display:"flex",gap:8,fontSize:11,color:"var(--muted)",marginBottom:4}}>
                  <span style={S.tag}>{({bug:"🐞 BUG",idea:"💡 IDEA",other:"💬 OTHER"})[f.category]||f.category}</span>
                  <span>{f.username}</span>
                  <span style={{marginLeft:"auto"}}>{f.created_at?new Date(f.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):""}</span>
                </div>
                <div style={{fontSize:13,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{f.message}</div>
                <button style={S.dangerLink} onClick={()=>setFeedbackStatus(f.id,f.status==="done"?"new":"done")}>
                  {f.status==="done"?"Reopen":"Mark done"}
                </button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%"}}>
            {loading ? <Loader msg={loadMsg}/> : <>
              <Btn gold onClick={()=>doNewWeek()}>
                🔄 Refresh from Database
              </Btn>
              <button style={S.dangerLink} onClick={()=>requireAdmin("reset")}>
                ⚠️ Full reset (clears the round and ALL groups' entries)
              </button>
            </>}
          </div>

          <div style={{fontSize:12,color:"var(--muted)",textAlign:"center",lineHeight:1.7,marginTop:8}}>
            Fixtures are fetched automatically every Monday at 7am<br/>
            by the <code style={{color:"var(--gold)"}}>fetch-fixtures.js</code> script on your machine.<br/>
            Results are saved by <code style={{color:"var(--gold)"}}>update-results.js</code> once the matches finish.
          </div>
        </Screen>
      )}

      {/* ── SUBMIT ── */}
      {view==="submit"&&!round&&(
        <Screen><BackBtn onClick={()=>setView("home")}/>
          <div style={{color:"var(--muted)",fontSize:14,textAlign:"center",paddingTop:40}}>No active round yet.</div>
        </Screen>
      )}

      {view==="submit"&&round&&(round.locked||deadlineLocked)&&(
        <Screen><BackBtn onClick={()=>setView("home")}/>
          <div style={{textAlign:"center",paddingTop:40}}>
            <div style={{fontSize:40,marginBottom:12}}>🔒</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"var(--gold)",letterSpacing:2,marginBottom:8}}>Submissions Closed</div>
            <div style={{color:"var(--muted)",fontSize:14,lineHeight:1.7}}>
              {round.winnersFound?"This round has a winner!":"All matches have been played. Check the lobby for results."}
            </div>
            <div style={{maxWidth:280,margin:"24px auto 0"}}><Btn onClick={()=>setView("lobby")}>👥 Go to Lobby</Btn></div>
          </div>
        </Screen>
      )}

      {view==="submit"&&round&&!round.locked&&!deadlineLocked&&entryView==="list"&&(
        <Screen wide>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle eyebrow={`${round.league.flag} ${round.league.name} · ${roundDates(round)}`} title="My Entries" sub={`${myEntries.length} / ${MAX_ENTRIES} entries used`}/>
          {myEntries.length>0&&(
            <div style={{width:"100%",marginBottom:8}}>
              {myEntries.map((e,i)=>(
                <div key={i} style={S.entryRow}>
                  <Avatar name={e.username}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:14}}>{e.entryName}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:6}} aria-label={`${e.entryName} picks`}>
                      {round.fixtures.map((f,fi)=>{
                        const k=e.preds[String(fi)]||e.preds[fi];
                        const pick=k==="home"?`${f.home} win`:k==="away"?`${f.away} win`:k==="draw"?"Draw":"Pick needed";
                        return (
                          <div key={fi} style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12,lineHeight:1.4}}>
                            <span style={{color:"var(--muted)"}}>{f.home} v {f.away}{f.form&&((f.form.home||[]).length||(f.form.away||[]).length)?<span style={{opacity:0.9}}> · {(f.form.home||[]).join("")||"–"} / {(f.form.away||[]).join("")||"–"}</span>:null}</span>
                            <span style={{fontWeight:600,color:k?"var(--text)":"var(--red)",textAlign:"right"}}>{OUTCOMES.find(o=>o.key===k)?.icon||"⚠️"} {pick}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <button onClick={()=>{setEditing(e);setPreds({0:e.preds[0],1:e.preds[1],2:e.preds[2],3:e.preds[3],4:e.preds[4]});setError("");setSubmitDone(false);setEntryView("new");}} aria-label={`Edit ${e.entryName}`} style={{alignSelf:"flex-start",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text)",fontSize:12,fontWeight:600,padding:"6px 10px",cursor:"pointer"}}>✏️ Edit</button>
                </div>
              ))}
            </div>
          )}
          {submitDone&&myEntries.length>0&&(
            <div style={S.successBanner} className="pop">
              {submitDone==="updated"?"✅ Entry updated. You can keep editing until entries lock.":<>✅ Entry sealed! You can still edit it until entries lock.{canAddEntry?` ${MAX_ENTRIES-myEntries.length} slot${MAX_ENTRIES-myEntries.length!==1?"s":""} remaining.`:" You've used all your entries."}</>}
            </div>
          )}
          {canAddEntry
            ?<Btn gold onClick={()=>{setEditing(null);setEntryView("new");setSubmitDone(false);setPreds({});setEntryName("");}}>
                + Add Entry {myEntries.length>0?`(${MAX_ENTRIES-myEntries.length} left)`:""}
              </Btn>
            :<div style={{fontSize:13,color:"var(--muted)",textAlign:"center"}}>You've used all {MAX_ENTRIES} entries for this round.</div>
          }
        </Screen>
      )}

      {view==="submit"&&round&&!round.locked&&!deadlineLocked&&entryView==="new"&&(
        <Screen wide>
          <BackBtn onClick={()=>{setEntryView("list");setEditing(null);setPreds({});}}/>
          <SectionTitle eyebrow={editing?editing.entryName:`Entry ${myEntries.length+1} of ${MAX_ENTRIES}`} title={editing?"Edit Entry":"New Entry"} sub={editing?"Change any pick. You can edit until entries lock.":"Pick a result for all 5 fixtures. You can edit until entries lock."}/>
          <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%"}}>
            {round.fixtures.map((f,i)=>(
              <div key={i} style={S.fixtureCard}>
                <div style={S.fixtureTopRow}>
                  <span style={S.tag}>#{i+1}</span>
                  <span style={S.fixtureDate}>{f.date} · {f.time}</span>
                </div>
                <div style={S.matchup}>
                  <span style={S.teamName}>{f.home}</span>
                  <span style={S.vsChip}>VS</span>
                  <span style={{...S.teamName,textAlign:"right"}}>{f.away}</span>
                </div>
                <FormRow f={f}/>
                <div style={S.outcomeRow}>
                  {OUTCOMES.map(o=>(
                    <button key={o.key} style={{...S.outcomeBtn,...(preds[i]===o.key?S.outcomeBtnOn:{})}}
                      onClick={()=>setPreds(p=>({...p,[i]:o.key}))}>
                      <span style={{fontSize:15}}>{o.icon}</span>
                      <span style={{fontSize:10,fontWeight:600,letterSpacing:"0.05em",marginTop:2}}>{o.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{width:"100%"}}>
            <div style={S.progressTrack}><div style={{...S.progressFill,width:`${(Object.keys(preds).length/5)*100}%`}}/></div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
              <span style={{fontSize:11,color:"var(--muted)"}}>{Object.keys(preds).length}/5 picked</span>
              <span style={{fontSize:11,color:"var(--muted)"}}>{editing?"Saved when you tap save":"Editable until entries lock"}</span>
            </div>
          </div>
          {duplicateOf&&<div role="alert" style={{fontSize:13,color:"var(--gold)",textAlign:"center",lineHeight:1.5}}>⚠️ These picks are exactly the same as {duplicateOf.entryName}. Change at least one pick.</div>}
          {loading?<Loader msg={loadMsg}/>:
            <Btn gold onClick={submitEntry} disabled={!allPicked||!!duplicateOf||unchanged}>{editing?(unchanged?"No changes yet":"💾 Save changes"):"✅ Save Entry"}</Btn>}
        </Screen>
      )}

      {/* ── LOBBY ── */}
      {view==="lobby"&&round&&(
        <Screen wide>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle
            eyebrow={`${round.league.flag} ${round.league.name} · ${roundDates(round)}`}
            title={round.winnersFound?"Round Complete 🏆":"The Lobby"}
            sub={`${subs.length} entr${subs.length!==1?"ies":"y"} across ${new Set(subs.map(s=>s.username)).size} player${new Set(subs.map(s=>s.username)).size!==1?"s":""}`}
          />

          {!round.locked&&!deadlineLocked&&countdown&&(
            <div style={{width:"100%",background:"rgba(240,192,64,0.07)",border:"1px solid rgba(240,192,64,0.2)",borderRadius:10,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:12,color:"var(--muted)"}}>Submissions close in</span>
              <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"var(--gold)",letterSpacing:"0.1em"}}>{countdown}</span>
            </div>
          )}
          {(round.locked||deadlineLocked)&&!round.winnersFound&&(
            <div style={{width:"100%",background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:10,padding:"10px 16px",textAlign:"center",fontSize:13,color:"var(--danger-text)",marginBottom:4}}>
              🔒 Submissions closed
            </div>
          )}

          <div style={{width:"100%",marginBottom:20}}>
            <div style={S.sectionLabel}>This Week's Fixtures</div>
            {round.fixtures.map((f,i)=>(
              <div key={i} style={S.lobbyRow}>
                <span style={S.tag2}>#{i+1}</span>
                {f.replaced&&<span title="Replacement fixture" style={{fontSize:12,marginRight:4}}>🔁</span>}
                <span style={{flex:1,fontSize:14,fontWeight:500}}>{f.home}</span>
                <span style={{color:"var(--muted)",fontSize:12,margin:"0 6px"}}>vs</span>
                <span style={{flex:1,fontSize:14,fontWeight:500,textAlign:"right"}}>{f.away}</span>
                <span style={{color:"var(--muted)",fontSize:11,marginLeft:10,whiteSpace:"nowrap"}}>{f.date}</span>
              </div>
            ))}
          </div>

          {(()=>{
            const mine = subs.filter(s=>s.username===username);
            const need = mine.flatMap(s=>round.fixtures.map((f,i)=>({s,f,i}))
              .filter(x=>x.f.replaced && x.s.preds[String(x.i)]==null && x.s.preds[x.i]==null
                         && Date.now() < x.f.kickoffTs-60000));
            if (!need.length) return null;
            return (
              <div style={{width:"100%",marginBottom:20,background:"rgba(240,192,64,0.07)",border:"1px solid rgba(240,192,64,0.25)",borderRadius:12,padding:16}}>
                <div style={S.sectionLabel}>🔁 A match was postponed. Re-pick it</div>
                <div style={{fontSize:12,color:"var(--muted)",marginBottom:10,lineHeight:1.6}}>
                  It has been replaced. Pick the result for each of your entries before it kicks off.
                </div>
                {need.map(({s,f,i})=>(
                  <div key={s.id+"-"+i} style={{marginBottom:12}}>
                    <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>
                      {s.entryName}: #{i+1} {f.home} vs {f.away} <span style={{color:"var(--muted)",fontWeight:400}}>({f.date} {f.time})</span>
                    </div>
                    <div style={S.outcomeRow}>
                      {OUTCOMES.map(o=>(
                        <button key={o.key} style={S.outcomeBtn} onClick={()=>saveRepick(s,i,o.key)}>
                          <span style={{fontSize:15}}>{o.icon}</span>
                          <span style={{fontSize:10,fontWeight:600,letterSpacing:"0.05em",marginTop:2}}>{o.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div style={{width:"100%",marginBottom:24}}>
            <div style={S.sectionLabel}>Players In</div>
            {(()=>{
              const players=[...new Set(subs.map(s=>s.username))];
              if (!players.length) return <div style={{color:"var(--muted)",fontSize:13,textAlign:"center",padding:"16px 0"}}>No entries yet.</div>;
              return (
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {players.map(p=>{
                    const pe=subs.filter(s=>s.username===p);
                    return (
                      <div key={p} style={S.playerRow}>
                        <Avatar name={p}/>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:600,fontSize:14}}>{p}</div>
                          <div style={{fontSize:11,color:"var(--muted)"}}>{pe.length} entr{pe.length!==1?"ies":"y"}</div>
                        </div>
                        <span style={{fontSize:11,color:"var(--muted)"}}>🔒</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {error&&<ErrorBox style={{marginBottom:12}}>{error}</ErrorBox>}
          <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:360}}>
            {loading?<Loader msg={loadMsg}/>:<>
              {!round.winnersFound&&<Btn gold onClick={startReveal} disabled={subs.length===0}>🎉 Check Results &amp; Reveal</Btn>}
              {isAdmin&&round.locked&&!round.winnersFound&&<Btn onClick={()=>requireAdmin("admin")}>⚙️ Admin Panel</Btn>}
              {isAdmin&&round.winnersFound&&<Btn gold onClick={()=>requireAdmin("admin")}>🔄 Admin: Start Next Round</Btn>}
              {!round.locked&&!deadlineLocked&&<Btn onClick={()=>{setEntryView("list");setView("submit");}}>✏️ My Entries</Btn>}
            </>}
            <button style={S.adminLink} onClick={()=>requireAdmin("reset")}>🔐 Admin: Full Reset</button>
          </div>
        </Screen>
      )}

      {/* ── JOIN ANOTHER GROUP ── */}
      {view==="join"&&(
        <Screen>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle eyebrow="Groups" title="My Groups"
            sub="Join a group with an invite code, invite your friends, or start a group of your own. Each group has its own entries and winners."/>
          <Field label="Invite Code">
            <input style={S.input} value={joinCode} onChange={e=>setJoinCode(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&joinGroup()} placeholder="e.g. GAFFERMATES26" autoCapitalize="characters" autoFocus/>
          </Field>
          {joinErr&&<ErrorBox>{joinErr}</ErrorBox>}
          <Btn gold onClick={joinGroup} disabled={!joinCode.trim()}>Join Group →</Btn>
          {myGroups.length>0&&(
            <div style={{fontSize:12,color:"var(--muted)",textAlign:"center",lineHeight:1.7}}>
              You're in: {myGroups.map(gLabel).join(", ")}
            </div>
          )}
          {groupId&&myGroups.some(x=>x.id===groupId)&&(
            <div style={{...S.card,width:"100%"}}>
              <div style={S.sectionLabel}>Invite friends to {groupName}</div>
              <Btn onClick={shareGroupInvite}>📨 Share invite link</Btn>
              {shareNote&&<div style={{fontSize:12,color:"var(--green)",marginTop:8,textAlign:"center"}}>{shareNote}</div>}
            </div>
          )}
          <div style={{...S.card,width:"100%"}}>
            <div style={S.sectionLabel}>Start your own group</div>
            <input style={S.input} aria-label="New group name" value={ownGroupName} maxLength={30} placeholder="Group name" onChange={e=>setOwnGroupName(e.target.value)}/>
            <div style={{height:8}}/>
            <Btn onClick={createOwnGroup} disabled={ownGroupName.trim().length<2}>➕ Create group</Btn>
          </div>
        </Screen>
      )}

      {/* ── PROFILE ── */}
      {view==="profile"&&(
        <Screen>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle eyebrow="You" title="My Profile" sub="Pick an avatar. Everyone in your groups will see it."/>
          <AvatarBubble emoji={profAvatar} color={profColor} initial={(username||"?")[0].toUpperCase()} size={72}/>
          {myStats&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,width:"100%"}} aria-label="Your stats">
              {[["Entries",myStats.entries],["Accuracy",myStats.accuracy==null?"–":`${myStats.accuracy}%`],["Best",myStats.entries?`${myStats.best}/5`:"–"],["Per win",myStats.perWin==null?"–":myStats.perWin]].map(([l,v])=>(
                <div key={l} style={{...S.card,padding:"10px 4px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"var(--gold)",letterSpacing:1}}>{v}</div>
                  <div style={{fontSize:10,color:"var(--muted)",letterSpacing:"0.08em",textTransform:"uppercase"}}>{l}</div>
                </div>
              ))}
              <div style={{gridColumn:"1 / -1",fontSize:11,color:"var(--muted)",textAlign:"center"}}>From completed rounds across all your groups · {myStats.wins} win{myStats.wins!==1?"s":""}</div>
            </div>
          )}
          <div style={{width:"100%"}}>
            <div style={S.sectionLabel}>Avatar</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8}}>
              <button aria-label="Use my initial" onClick={()=>setProfAvatar("")}
                style={{...S.outcomeBtn,...(profAvatar===""?S.outcomeBtnOn:{}),fontSize:12}}>Aa</button>
              {AVATAR_EMOJIS.map(e=>(
                <button key={e} aria-label={`Avatar ${e}`} onClick={()=>setProfAvatar(e)}
                  style={{...S.outcomeBtn,...(profAvatar===e?S.outcomeBtnOn:{}),fontSize:20,padding:"6px 0"}}>{e}</button>
              ))}
            </div>
          </div>
          <div style={{width:"100%"}}>
            <div style={S.sectionLabel}>Colour</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {AVATAR_COLORS.map(col=>(
                <button key={col} aria-label={`Colour ${col}`} onClick={()=>setProfColor(col)}
                  style={{width:34,height:34,borderRadius:"50%",background:col,border:profColor===col?"3px solid var(--text)":"3px solid transparent"}}/>
              ))}
            </div>
          </div>
          <div style={{width:"100%"}}>
            <div style={S.sectionLabel}>Change password</div>
            <div style={{display:"flex",gap:8}}>
              <input style={S.input} type="password" autoComplete="new-password" aria-label="New password" placeholder="New password" value={newPw} onChange={e=>{setNewPw(e.target.value);setPwNote("");}}/>
              <Btn onClick={saveNewPassword} disabled={!newPw}>Change</Btn>
            </div>
            {pwNote&&<div role="status" style={{fontSize:12,color:"var(--green)",marginTop:6}}>{pwNote}</div>}
          </div>
          {error&&<ErrorBox>{error}</ErrorBox>}
          {loading?<Loader msg={loadMsg}/>:<Btn gold onClick={saveProfile}>Save profile</Btn>}
        </Screen>
      )}

      {/* ── FEEDBACK ── */}
      {view==="feedback"&&(
        <Screen>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle eyebrow="Feedback" title="Tell the Gaffer" sub="Spotted a bug or got an idea? It goes straight to the admin."/>
          <Field label="Type">
            <select style={S.input} value={fbCategory} onChange={e=>setFbCategory(e.target.value)} aria-label="Type of feedback">
              <option value="idea">💡 Idea</option>
              <option value="bug">🐞 Bug</option>
              <option value="other">💬 Other</option>
            </select>
          </Field>
          <Field label="Message">
            <textarea style={{...S.input,minHeight:130,resize:"vertical"}} maxLength={1000} value={fbText}
              onChange={e=>setFbText(e.target.value)} placeholder="What happened, or what would you like to see?" aria-label="Your message"/>
          </Field>
          <div style={{fontSize:11,color:"var(--muted)",alignSelf:"flex-end"}}>{fbText.length}/1000</div>
          {fbNote&&<div style={S.successBanner}>{fbNote}</div>}
          {error&&<ErrorBox>{error}</ErrorBox>}
          {loading?<Loader msg={loadMsg}/>:<Btn gold onClick={sendFeedback} disabled={!fbText.trim()}>Send feedback</Btn>}
        </Screen>
      )}

      {/* ── STORY SO FAR ── */}
      {view==="help"&&(
        <Screen>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle eyebrow="The Gaffer" title="How to play"/>
          <HelpContent/>
        </Screen>
      )}

      {view==="story"&&(
        <StoryView history={history} round={round} subs={subs}
          series={storySeries} setSeries={setStorySeries} onBack={()=>setView("home")}/>
      )}

      {/* ── REVEAL ── */}
      {view==="reveal"&&round&&results&&(
        <RevealView round={round} results={results} subs={subs}
          onRevealComplete={onRevealComplete}
          onHome={()=>setView("home")} onLobby={()=>setView("lobby")}
          requireAdmin={requireAdmin} isAdmin={isAdmin}/>
      )}

      {loading&&<div style={S.overlay}><Loader msg={loadMsg}/></div>}
    </div>
    </ProfilesCtx.Provider>
  );
}

// ─── The Story So Far ─────────────────────────────────────────────────────────
// The game runs round after round until somebody gets all 5 right. This shows how many
// entries each player has used in the current run, and the scores of every entry.
function StoryView({ history, round, subs, series, setSeries, onBack }) {
  const [sort, setSort] = useState({ key:"default", dir:"desc" });
  const [sortAll, setSortAll] = useState({ key:"wins", dir:"desc" });
  const current = round ? (round.series||1) : 1;
  const allSeries = [...new Set([current, ...history.map(h=>h.series)])].sort((a,b)=>b-a);
  const sel = series ?? current;

  // Past rounds from the history table
  const rows = history.filter(h=>h.series===sel).map(h=>({
    week:h.week, username:h.username, entryName:h.entry_name,
    correct:h.correct, total:h.total, perfect:!!h.perfect, pending:false,
  }));

  // The round in play. Scores only appear once a winner has been revealed.
  let weeks = [...new Set(rows.map(r=>r.week))];
  if (sel===current && round) {
    const res = round.mockResults || round.results;
    const showScores = round.winnersFound && Array.isArray(res);
    subs.forEach(s=>{
      const sc = showScores ? scoreEntry(s,res) : null;
      rows.push({ week:round.week, username:s.username, entryName:s.entryName,
        correct:sc?sc.correct:0, total:sc?sc.total:0, perfect:showScores&&isPerfect(s,res), pending:!showScores });
    });
    if (!weeks.includes(round.week)) weeks.push(round.week);
  }
  weeks = weeks.sort((a,b)=>b-a);   // newest week first

  const players = [...new Set(rows.map(r=>r.username))].map(u=>{
    const mine = rows.filter(r=>r.username===u);
    const scored = mine.filter(r=>!r.pending);
    const right = scored.reduce((n,r)=>n+r.correct,0);
    const made  = scored.reduce((n,r)=>n+(r.total||0),0);
    return { username:u, entries:mine.length, right, made,
      acc: made ? Math.round((right/made)*100) : null,
      best: scored.length ? Math.max(...scored.map(r=>r.correct)) : null,
      won: mine.some(r=>r.perfect) };
  }).sort((a,b)=>(b.won-a.won)||((b.best??-1)-(a.best??-1))||(b.entries-a.entries));
  const cell = {padding:"8px 6px",fontSize:13,borderBottom:"1px solid var(--border)"};
  // Tap a column heading to sort by it; tap again to flip. Players with no score yet always sit at the bottom.
  const SORTS = { player:p=>p.username.toLowerCase(), entries:p=>p.entries, best:p=>p.best, acc:p=>p.acc };
  if (SORTS[sort.key]) {
    const val = SORTS[sort.key], dir = sort.dir==="asc" ? 1 : -1;
    players.sort((a,b)=>{
      const x=val(a), y=val(b);
      if (x==null && y==null) return a.username.localeCompare(b.username);
      if (x==null) return 1; if (y==null) return -1;
      return (x<y?-1:x>y?1:0)*dir || a.username.localeCompare(b.username);
    });
  }
  const sortBy = key => setSort(c => c.key===key ? { key, dir:c.dir==="asc"?"desc":"asc" } : { key, dir:key==="player"?"asc":"desc" });
  const sortTh = (key,label) => (
    <th style={cell} aria-sort={sort.key===key?(sort.dir==="asc"?"ascending":"descending"):"none"}>
      <button onClick={()=>sortBy(key)} aria-label={`Sort by ${label}`} style={{background:"none",border:"none",color:"inherit",font:"inherit",textTransform:"inherit",letterSpacing:"inherit",padding:0,cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:3}}>
        {label}{sort.key===key?(sort.dir==="asc"?" ▲":" ▼"):<span aria-hidden="true" style={{opacity:0.7}}> ⇅</span>}
      </button>
    </th>);
  const winners = players.filter(p=>p.won);

  // All-time record across every run: how often each player has won, and how many entries it took them.
  const allRows = history.map(h=>({ series:h.series, week:h.week, key:`${h.series}|${h.week}`, username:h.username, perfect:!!h.perfect }));
  if (round && !history.some(h=>h.series===current && h.week===round.week)) {
    const res = round.mockResults || round.results;
    const done = round.winnersFound && Array.isArray(res);
    subs.forEach(x=>allRows.push({ series:current, week:round.week, key:`${current}|${round.week}`, username:x.username, perfect:done&&isPerfect(x,res) }));
  }
  // The pot: every entry made since the last win counts as one. It is shared equally between the players who got
  // all 5 that week (a player with two perfect entries is still one winner), so a lone winner takes the lot.
  const won = {};
  [...new Set(allRows.map(r=>r.series))].forEach(sr=>{
    const inSeries = allRows.filter(r=>r.series===sr);
    let prev = -Infinity;
    [...new Set(inSeries.filter(r=>r.perfect).map(r=>r.week))].sort((a,b)=>a-b).forEach(wk=>{
      const pot = inSeries.filter(r=>r.week>prev && r.week<=wk).length;
      const winnersNow = [...new Set(inSeries.filter(r=>r.week===wk && r.perfect).map(r=>r.username))];
      winnersNow.forEach(u=>{ won[u] = (won[u]||0) + pot/winnersNow.length; });
      prev = wk;
    });
  });
  const r1 = n => Math.round(n*10)/10;
  const record = [...new Set(allRows.map(r=>r.username))].map(u=>{
    const mine = allRows.filter(r=>r.username===u);
    const wins = new Set(mine.filter(r=>r.perfect).map(r=>r.key)).size;   // a win is a week with at least one perfect entry
    const entriesWon = r1(won[u]||0);
    return { username:u, wins, entries:mine.length, entriesWon, net: r1(entriesWon - mine.length) };
  });
  const ALL = { player:p=>p.username.toLowerCase(), wins:p=>p.wins, entries:p=>p.entries, entriesWon:p=>p.entriesWon, net:p=>p.net };
  { const val = ALL[sortAll.key], dir = sortAll.dir==="asc" ? 1 : -1;
    record.sort((a,b)=>{
      const x=val(a), y=val(b);
      if (x==null && y==null) return b.entries-a.entries || a.username.localeCompare(b.username);
      if (x==null) return 1; if (y==null) return -1;
      return (x<y?-1:x>y?1:0)*dir || b.entries-a.entries || a.username.localeCompare(b.username);
    }); }
  const sortAllBy = key => setSortAll(c => c.key===key ? { key, dir:c.dir==="asc"?"desc":"asc" } : { key, dir:key==="player"?"asc":"desc" });
  const allTh = (key,label) => (
    <th style={cell} aria-sort={sortAll.key===key?(sortAll.dir==="asc"?"ascending":"descending"):"none"}>
      <button onClick={()=>sortAllBy(key)} aria-label={`Sort record by ${label}`} style={{background:"none",border:"none",color:"inherit",font:"inherit",textTransform:"inherit",letterSpacing:"inherit",padding:0,cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:3}}>
        {label}{sortAll.key===key?(sortAll.dir==="asc"?" ▲":" ▼"):<span aria-hidden="true" style={{opacity:0.7}}> ⇅</span>}
      </button>
    </th>);

  return (
    <Screen wide>
      <BackBtn onClick={onBack}/>
      <SectionTitle eyebrow="The Gaffer" title="The Story So Far"
        sub="Entries keep adding up until somebody gets all 5 right."/>

      {allSeries.length>1&&(
        <select value={sel} onChange={e=>setSeries(Number(e.target.value))} style={{...S.input,maxWidth:260}}>
          {allSeries.map(n=><option key={n} value={n}>{n===current?`Current run (#${n})`:`Run #${n}`}</option>)}
        </select>
      )}

      {winners.length>0&&(
        <div style={{width:"100%",background:"rgba(240,192,64,0.08)",border:"1px solid rgba(240,192,64,0.3)",borderRadius:12,padding:"12px 16px",fontSize:14}}>
          🏆 {winners.map(w=>`${w.username} (${w.entries} entr${w.entries!==1?"ies":"y"})`).join(", ")} got all 5 right.
        </div>
      )}

      {players.length===0
        ? <div style={{color:"var(--muted)",fontSize:13,textAlign:"center",padding:"16px 0"}}>Nothing here yet.</div>
        : <>
          <div style={{width:"100%"}} aria-label="All-time record">
            <div style={S.sectionLabel}>All-time record <span style={{textTransform:"none",letterSpacing:0,fontWeight:400}}>(tap a heading to sort)</span></div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{textAlign:"left",color:"var(--muted)",fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                {allTh("player","Player")}{allTh("wins","Wins")}{allTh("entries","Entries")}{allTh("entriesWon","Entries won")}{allTh("net","Net")}
              </tr></thead>
              <tbody>{record.map(p=>(
                <tr key={p.username}>
                  <td style={cell}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Avatar name={p.username} size={20}/>{p.username}</span></td>
                  <td style={cell}>{p.wins}</td>
                  <td style={cell}>{p.entries}</td>
                  <td style={cell}>{p.entriesWon}</td>
                  <td style={{...cell,fontWeight:700,color:p.net>0?"var(--green)":p.net<0?"var(--danger-text)":"var(--text)"}}>{p.net>0?`+${p.net}`:p.net}</td>
                </tr>))}</tbody>
            </table>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:6}}>Across every run. A win is a week with a perfect 5. Entries won is each winner's share of the pot: every entry made since the last win, split equally between the players who got all 5. Net is entries won minus entries made (£ at £1 an entry).</div>
          </div>

          <div style={{width:"100%"}}>
            <div style={S.sectionLabel}>Entries used <span style={{textTransform:"none",letterSpacing:0,fontWeight:400}}>(tap a heading to sort)</span></div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{textAlign:"left",color:"var(--muted)",fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                {sortTh("player","Player")}{sortTh("entries","Entries")}{sortTh("best","Best")}{sortTh("acc","Accuracy")}
              </tr></thead>
              <tbody>{players.map(p=>(
                <tr key={p.username}>
                  <td style={cell}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Avatar name={p.username} size={20}/>{p.won?"🏆 ":""}{p.username}</span></td>
                  <td style={cell}>{p.entries}</td>
                  <td style={cell}>{p.best===null?"-":`${p.best}/5`}</td>
                  <td style={cell}>{p.acc===null?"-":<>{p.acc}% <span style={{color:"var(--muted)",fontSize:11}}>({p.right}/{p.made})</span></>}</td>
                </tr>))}</tbody>
            </table>
          </div>

          {weeks.map((w,wi)=>(
            <details key={`${sel}-${w}`} open={wi===0} style={{width:"100%"}}>
              <summary style={{...S.sectionLabel,cursor:"pointer",listStyle:"revert"}}>Week {w}{sel===current&&round&&w===round.week&&!round.winnersFound?" (in play)":""}</summary>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <tbody>{rows.filter(r=>r.week===w)
                  .sort((a,b)=>(b.correct-a.correct)||a.username.localeCompare(b.username))
                  .map((r,i)=>(
                  <tr key={i}>
                    <td style={cell}>{r.username} <span style={{color:"var(--muted)"}}>({r.entryName})</span></td>
                    <td style={{...cell,textAlign:"right",color:r.perfect?"var(--gold)":"var(--text)",fontWeight:r.perfect?700:400}}>
                      {r.pending?"🔒":`${r.correct}/${r.total||5}`}
                    </td>
                  </tr>))}</tbody>
              </table>
            </details>
          ))}
        </>}
    </Screen>
  );
}

// ─── Reveal View ──────────────────────────────────────────────────────────────
function RevealView({ round, results, subs, onRevealComplete, onHome, onLobby, requireAdmin, isAdmin }) {
  const [shareMsg, setShareMsg] = useState("");
  const [phase,         setPhase]         = useState("fixtures");
  const finalIdx   = results.map((r,i)=>r.result!=="upcoming"?i:-1).filter(i=>i>=0);
  const finalCount = finalIdx.length;
  const allFinal   = finalCount===round.fixtures.length;
  const [revealedCount, setRevealedCount] = useState(Math.min(1, finalCount));
  const [outcome,       setOutcome]       = useState(null);
  const firedRef   = useRef(false);
  const playedCount = finalCount;

  function next() { setRevealedCount(n=>Math.min(n+1, finalCount)); }
  function finish() {
    const winners = subs.filter(e=>isPerfect(e,results));
    const out = { winners, hasWinner:winners.length>0 };
    setOutcome(out); setPhase("outcome");
    if (!firedRef.current) { onRevealComplete(winners); firedRef.current=true; }
  }

  return (
    <Screen wide>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",marginBottom:20}}>
        <button style={S.backBtnInline} onClick={onHome}>← Home</button>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",color:"var(--gold)",letterSpacing:2,fontSize:17}}>
          {round.league.flag} {round.league.name} · {roundDates(round)}
        </div>
        <div style={{width:60}}/>
      </div>

      {phase==="fixtures"&&(
        <>
          <SectionTitle eyebrow="The Reveal" title="Match Results" sub={allFinal?`All ${playedCount} results in`:`${playedCount} of ${round.fixtures.length} results in`}/>
          <div style={{width:"100%",display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
            {round.fixtures.map((f,i)=>{
              const r=results[i]; const isFinal=r.result!=="upcoming";
              const shown=isFinal && finalIdx.indexOf(i)<revealedCount;
              return (
                <div key={i} style={{...S.revealCard,
                  animation:shown?"revealCard 0.45s ease both":"",
                  opacity:shown?1:(isFinal?0.15:1),filter:(isFinal&&!shown)?"blur(2px)":"none",
                  transition:"opacity 0.3s,filter 0.3s",
                  borderColor:shown?"rgba(240,192,64,0.3)":"var(--border)",
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={S.fixtureDate}>{f.date}</span>
                    <span style={S.tag}>#{i+1}</span>
                  </div>
                  <div style={S.matchup}>
                    <span style={{...S.teamName,color:shown&&r.result==="home"?"var(--gold)":"var(--text)",fontWeight:shown&&r.result==="home"?700:500}}>{f.home}</span>
                    <span style={S.scorePill}>{shown?(r.result==="void"?"VOID":(r.score||r.result)):"vs"}</span>
                    <span style={{...S.teamName,textAlign:"right",color:shown&&r.result==="away"?"var(--gold)":"var(--text)",fontWeight:shown&&r.result==="away"?700:500}}>{f.away}</span>
                  </div>
                  {!isFinal&&(
                    <div style={{marginTop:8,fontSize:11,color:"var(--muted)",textAlign:"center",letterSpacing:"0.06em",textTransform:"uppercase"}}>Awaiting result</div>
                  )}
                  {shown&&r.result==="void"&&(
                    <div style={{marginTop:8,fontSize:12,color:"var(--muted)",textAlign:"center"}}>Match void. Everyone gets this one.</div>
                  )}
                  {shown&&(
                    <div style={{marginTop:10,borderTop:"1px solid var(--border)",paddingTop:10}}>
                      <div style={{fontSize:10,color:"var(--muted)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Who got it right?</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {subs.map((s,si)=>{
                          const got=hit(s,r,i);
                          return (
                            <div key={si} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 10px",borderRadius:20,
                              background:got?"rgba(52,211,153,0.12)":"rgba(255,255,255,0.03)",
                              border:`1px solid ${got?"rgba(52,211,153,0.35)":"rgba(255,255,255,0.07)"}`}}>
                              <span style={{fontSize:11}}>{got?"✅":"❌"}</span>
                              <span style={{fontSize:11,color:got?"var(--green)":"var(--muted)",fontWeight:got?600:400}}>
                                {s.username} <span style={{color:"var(--muted)"}}>({s.entryName})</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {revealedCount<finalCount
            ? <Btn gold onClick={next} style={{maxWidth:320}}>Reveal next result →</Btn>
            : allFinal
              ? <Btn gold onClick={finish} style={{maxWidth:320}}>See the Outcome →</Btn>
              : (
                  <div style={{width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{fontSize:13,color:"var(--muted)",textAlign:"center",lineHeight:1.7}}>
                      {round.fixtures.length-finalCount} match{round.fixtures.length-finalCount!==1?"es":""} still to come.<br/>
                      Come back after the remaining matches. Results are picked up automatically.
                    </div>
                    <Btn onClick={onLobby}>← Lobby</Btn>
                  </div>
                )}
        </>
      )}

      {phase==="outcome"&&outcome&&(
        <div style={{width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:20}}>
          {outcome.hasWinner?(
            <>
              <div style={S.winnerCard} className="pop glow">
                <div style={{fontSize:56,marginBottom:12}}>🏆</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:"var(--gold)",letterSpacing:3,marginBottom:8}}>
                  {outcome.winners.length===1?"WE HAVE A WINNER!":"WE HAVE WINNERS!"}
                </div>
                <div style={{fontSize:14,color:"var(--muted)",marginBottom:20}}>
                  {outcome.winners.length===1?"Perfect 5/5 predictions this week":`${outcome.winners.length} players nailed all 5 this week`}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%"}}>
                  {outcome.winners.map((w,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(240,192,64,0.08)",border:"1px solid rgba(240,192,64,0.25)",borderRadius:10,padding:"12px 16px"}}>
                      <Avatar name={w.username} size={36}/>
                      <div>
                        <div style={{fontWeight:700,fontSize:16,color:"var(--text)"}}>{w.username}</div>
                        <div style={{fontSize:12,color:"var(--muted)"}}>{w.entryName}</div>
                      </div>
                      <div style={{marginLeft:"auto",fontSize:28}}>👑</div>
                    </div>
                  ))}
                </div>
              </div>
              {TIP_URL&&(
                <a href={TIP_URL} target="_blank" rel="noopener noreferrer" style={{fontSize:13,color:"var(--muted)",textAlign:"center",maxWidth:320,lineHeight:1.5}}>
                  ☕ Enjoying The Gaffer? Chuck a tip in the jar if you fancy. Totally optional.
                </a>
              )}
              <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center",width:"100%",maxWidth:360}}>
                <Btn onClick={async()=>{
                  const names=outcome.winners.map(w=>w.username).join(" & ");
                  const r=await shareOrCopy(`🏆 ${names} got all 5 right on The Gaffer! Can you beat it?`, window.location.origin+"/");
                  setShareMsg(r==="copied"?"Copied. Paste it into your chat.":r==="failed"?"Couldn't share.":"");
                }} style={{flex:1}}>📣 Share result</Btn>
                {isAdmin&&<Btn gold onClick={()=>requireAdmin("admin")} style={{flex:1}}>🔄 Start Next Round</Btn>}
                <Btn onClick={onHome} style={{flex:1}}>← Home</Btn>
              </div>
              {shareMsg&&<div style={{fontSize:12,color:"var(--green)"}}>{shareMsg}</div>}
            </>
          ):(
            <>
              <div style={S.rolloverCard} className="pop">
                <div style={{fontSize:48,marginBottom:12}}>😤</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:"var(--text)",letterSpacing:2,marginBottom:8}}>NO WINNER THIS WEEK</div>
                <div style={{fontSize:14,color:"var(--muted)",lineHeight:1.7,marginBottom:16}}>
                  Nobody got all 5 correct.<br/>The round rolls over to next week.
                </div>
                <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"12px 16px",width:"100%"}}>
                  <div style={{fontSize:11,color:"var(--muted)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Running total</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:"var(--gold)"}}>{subs.length} entr{subs.length!==1?"ies":"y"} in play</div>
                  <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>Week {round.week} → Week {round.week+1}</div>
                </div>
              </div>

              <div style={{width:"100%"}}>
                <div style={S.sectionLabel}>This Week's Scores</div>
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {[...subs]
                    .map(s=>({...s,...scoreEntry(s,results)}))
                    .sort((a,b)=>b.correct-a.correct)
                    .map((s,i,arr)=>(
                    <div key={i} style={{...S.playerRow,
                      background:i===0?"rgba(240,192,64,0.06)":"var(--surface2)",
                      borderColor:i===0?"rgba(240,192,64,0.2)":"var(--border)"}}>
                      <Avatar name={s.username}/>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,fontSize:14}}>{s.username}</div>
                        <div style={{fontSize:11,color:"var(--muted)"}}>{s.entryName}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,lineHeight:1,
                          color:s.correct===4?"var(--gold)":s.correct>=3?"var(--green)":"var(--muted)"}}>
                          {s.correct}/5
                        </div>
                        {s.correct===arr[0].correct&&s.correct>0&&(
                          <div style={{fontSize:10,color:"var(--gold)",letterSpacing:"0.06em"}}>
                            {i===0?"CLOSEST":"JOINT TOP"}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center",width:"100%",maxWidth:360}}>
                {isAdmin&&<Btn gold onClick={()=>requireAdmin("admin")} style={{flex:1}}>📅 Admin Panel</Btn>}
                <Btn onClick={onLobby} style={{flex:1}}>← Lobby</Btn>
              </div>
            </>
          )}
        </div>
      )}
    </Screen>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────
function Screen({ children, wide }) {
  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",
      padding:wide?"80px 16px 80px":"80px 20px 80px",maxWidth:wide?720:480,margin:"0 auto",gap:14}}>
      {children}
    </div>
  );
}
function BackBtn({ onClick }) { return <button onClick={onClick} style={S.backBtnInline}>← Back</button>; }
function Field({ label, children }) { return <div style={S.inputRow}><label style={S.label}>{label}</label>{children}</div>; }
function SectionTitle({ eyebrow, title, sub }) {
  return (
    <div style={{textAlign:"center",width:"100%",marginBottom:6}}>
      {eyebrow&&<div style={S.eyebrow}>{eyebrow}</div>}
      <h2 style={S.sectionH2}>{title}</h2>
      {sub&&<p style={S.sectionSub}>{sub}</p>}
    </div>
  );
}
function Btn({ children, gold, onClick, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{...S.btn,...(gold?S.btnGold:S.btnGhost),...(disabled?S.btnDisabled:{}),...style}}>
      {children}
    </button>
  );
}
function Loader({ msg }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"20px 0"}}>
      <div style={{width:32,height:32,border:"3px solid #1e2533",borderTop:"3px solid var(--gold)",borderRadius:"50%"}} className="spin"/>
      <div style={{color:"var(--muted)",fontSize:13}}>{msg}</div>
    </div>
  );
}
function ErrorBox({ children, style }) {
  return (
    <div style={{background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.3)",
      borderRadius:8,padding:"10px 14px",color:"var(--danger-text)",fontSize:13,width:"100%",textAlign:"center",...style}}>
      {children}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root:         { background:"var(--bg)",minHeight:"100vh",fontFamily:"'DM Sans',sans-serif",color:"var(--text)" },
  nav:          { position:"fixed",top:0,left:0,right:0,zIndex:50,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 10px",gap:6,background:"var(--navbg)",borderBottom:"1px solid var(--border)",backdropFilter:"blur(10px)" },
  navLogo:      { fontFamily:"'Bebas Neue',sans-serif",fontSize:15,letterSpacing:"0.06em",whiteSpace:"nowrap",color:"var(--gold)",cursor:"pointer" },
  navBtn:       { background:"none",border:"1px solid var(--border)",color:"var(--muted)",padding:"5px 10px",borderRadius:6,fontSize:12,whiteSpace:"nowrap" },
  overlay:      { position:"fixed",inset:0,background:"var(--scrim)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:80,backdropFilter:"blur(4px)" },
  backdrop:     { position:"fixed",inset:0,background:"var(--scrim)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(6px)" },
  modal:        { background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:16,padding:"28px 24px",width:"100%",maxWidth:320,display:"flex",flexDirection:"column",alignItems:"center",gap:2 },
  modalTitle:   { fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:2,color:"var(--gold)" },
  bigLogo:      { textAlign:"center",marginBottom:28 },
  bigTitle:     { fontFamily:"'Bebas Neue',sans-serif",fontSize:52,letterSpacing:"0.15em",lineHeight:1,background:"linear-gradient(135deg,var(--g1),var(--g2),var(--g3))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent" },
  bigSub:       { fontSize:12,color:"var(--muted)",letterSpacing:"0.15em",textTransform:"uppercase",marginTop:5 },
  pill:         { marginTop:4,fontSize:13,textAlign:"center",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 14px" },
  adminLink:    { background:"none",border:"none",color:"var(--muted)",fontSize:12,cursor:"pointer",marginTop:6 },
  btn:          { width:"100%",padding:"12px 20px",borderRadius:10,fontSize:14,fontWeight:600,border:"none",transition:"all 0.18s",letterSpacing:"0.02em" },
  btnGold:      { background:"var(--gold)",color:"var(--ink)" },
  btnGhost:     { background:"var(--surface2)",color:"var(--text)",border:"1px solid var(--border)" },
  btnDisabled:  { opacity:0.32,cursor:"not-allowed" },
  backBtnInline:{ background:"none",border:"none",color:"var(--muted)",fontSize:13,padding:"4px 0",cursor:"pointer",alignSelf:"flex-start" },
  eyebrow:      { fontSize:10,letterSpacing:"0.18em",textTransform:"uppercase",color:"var(--gold)",marginBottom:5 },
  sectionH2:    { fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:"0.08em",color:"var(--text)",lineHeight:1,marginBottom:5 },
  sectionSub:   { fontSize:13,color:"var(--muted)",lineHeight:1.5 },
  leagueGrid:   { display:"flex",flexDirection:"column",gap:7,width:"100%" },
  leagueCard:   { display:"flex",alignItems:"center",gap:12,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",transition:"all 0.18s",textAlign:"left" },
  leagueCardOn: { borderColor:"var(--gold)",background:"rgba(240,192,64,0.07)" },
  dangerLink:   { background:"none",border:"none",color:"var(--muted)",fontSize:12,textDecoration:"underline",cursor:"pointer",marginTop:4 },
  inputRow:     { display:"flex",flexDirection:"column",gap:5,width:"100%" },
  label:        { fontSize:11,color:"var(--muted)",letterSpacing:"0.08em",textTransform:"uppercase" },
  input:        { background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 13px",color:"var(--text)",fontSize:14,fontFamily:"inherit",outline:"none",width:"100%",transition:"border-color 0.2s" },
  entryRow:     { display:"flex",alignItems:"center",gap:10,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",marginBottom:7 },
  successBanner:{ background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.3)",borderRadius:8,padding:"10px 14px",color:"var(--green)",fontSize:13,width:"100%",textAlign:"center" },
  card:         { background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 15px" },
  fixtureCard:  { background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"13px 15px" },
  fixtureTopRow:{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9 },
  fixtureDate:  { fontSize:11,color:"var(--muted)",letterSpacing:"0.05em" },
  tag:          { fontSize:10,fontWeight:700,letterSpacing:"0.1em",color:"var(--gold)",background:"rgba(240,192,64,0.1)",padding:"2px 7px",borderRadius:20 },
  tag2:         { fontSize:10,color:"var(--muted)",background:"var(--surface)",padding:"2px 7px",borderRadius:20,marginRight:8,flexShrink:0 },
  matchup:      { display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:9 },
  teamName:     { flex:1,fontSize:13,fontWeight:500 },
  vsChip:       { background:"var(--surface)",border:"1px solid var(--border)",borderRadius:5,padding:"2px 7px",fontSize:10,color:"var(--muted)",letterSpacing:"0.1em",flexShrink:0 },
  scorePill:    { background:"var(--surface)",border:"1px solid rgba(240,192,64,0.3)",borderRadius:6,padding:"3px 9px",fontSize:13,fontWeight:700,color:"var(--gold)",flexShrink:0,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.1em" },
  outcomeRow:   { display:"flex",gap:5 },
  outcomeBtn:   { flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"8px 3px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,color:"var(--muted)",transition:"all 0.14s" },
  outcomeBtnOn: { background:"rgba(240,192,64,0.1)",borderColor:"var(--gold)",color:"var(--gold)" },
  progressTrack:{ height:3,background:"var(--surface2)",borderRadius:2,overflow:"hidden" },
  progressFill: { height:"100%",background:"var(--gold)",borderRadius:2,transition:"width 0.4s ease" },
  sectionLabel: { fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--muted)",marginBottom:9 },
  lobbyRow:     { display:"flex",alignItems:"center",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 13px",marginBottom:5 },
  playerRow:    { display:"flex",alignItems:"center",gap:10,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:"11px 13px" },
  playerAvatar: { width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,var(--gold),var(--g3))",color:"var(--ink)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0 },
  revealCard:   { background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"13px 15px" },
  winnerCard:   { textAlign:"center",padding:"28px 24px",background:"linear-gradient(135deg,rgba(240,192,64,0.1),rgba(240,192,64,0.03))",border:"1px solid rgba(240,192,64,0.4)",borderRadius:16,width:"100%" },
  rolloverCard: { textAlign:"center",padding:"28px 24px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:16,width:"100%" },
};
