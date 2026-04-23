import { useState, useEffect, useRef } from "react";

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #05080f; }
  :root {
    --gold: #f0c040; --ink: #05080f; --surface: #0c1018; --surface2: #131822;
    --border: rgba(255,255,255,0.07); --muted: #4a5568; --text: #e2e8f0;
    --green: #34d399; --red: #f87171;
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
const ADMIN_PIN         = "1234";                        // ← change this
const INVITE_CODE       = "GAFFER2025";                  // ← share with your group
const MAX_ENTRIES       = 5;
const SB_URL            = "https://oszrnwhyvmvccxxepsnm.supabase.co";
const SB_KEY            = "sb_publishable_V9itVh6Qu_ThqCfAEV5SBA_PagJsoG4";

// ─── Constants ────────────────────────────────────────────────────────────────
const LEAGUES = [
  { id:"epl",             name:"Premier League",  flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id:"la_liga",         name:"La Liga",          flag:"🇪🇸" },
  { id:"bundesliga",      name:"Bundesliga",       flag:"🇩🇪" },
  { id:"serie_a",         name:"Serie A",          flag:"🇮🇹" },
  { id:"ligue_1",         name:"Ligue 1",          flag:"🇫🇷" },
  { id:"champions_league",name:"Champions League", flag:"🏆" },
];
const OUTCOMES = [
  { key:"home", label:"Home Win", icon:"🏠" },
  { key:"draw", label:"Draw",     icon:"🤝" },
  { key:"away", label:"Away Win", icon:"✈️" },
];

// ─── Password hashing ─────────────────────────────────────────────────────────
async function hashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ─── Supabase client (vanilla fetch, no SDK needed) ───────────────────────────
const sb = {
  headers: {
    "Content-Type":  "application/json",
    "apikey":        SB_KEY,
    "Authorization": `Bearer ${SB_KEY}`,
    "Prefer":        "return=representation",
  },

  async get(table, params = "") {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, { headers: this.headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async upsert(table, body) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...this.headers, "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async insert(table, body) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async patch(table, params, body) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async del(table, params) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok) throw new Error(await res.text());
  },

  // Realtime subscription via Supabase REST polling (simple 5s interval)
  // Returns a cancel function
  poll(table, params, onChange, intervalMs = 5000) {
    let last = null;
    async function check() {
      try {
        const data = await sb.get(table, params);
        const str = JSON.stringify(data);
        if (str !== last) { last = str; onChange(data); }
      } catch {}
    }
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  },
};

// ─── DB helpers ───────────────────────────────────────────────────────────────
const db = {
  // Users
  async getUser(username) {
    const rows = await sb.get("users", `username=eq.${encodeURIComponent(username)}`);
    return rows[0] || null;
  },
  async createUser(username, passwordHash) {
    return sb.insert("users", { username, password_hash: passwordHash });
  },

  // Round (single row, id=1)
  async getRound() {
    const rows = await sb.get("round", "id=eq.1");
    if (!rows.length) return null;
    const r = rows[0];
    return {
      league:       r.league,
      fixtures:     r.fixtures,
      mockResults:  r.mock_results || null,
      week:         r.week,
      locked:       r.locked,
      winnersFound: r.winners_found,
      createdAt:    new Date(r.created_at).getTime(),
    };
  },
  async setRound(round) {
    return sb.upsert("round", {
      id:            1,
      league:        round.league,
      fixtures:      round.fixtures,
      mock_results:  round.mockResults || null,
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
  async getSubs() {
    const rows = await sb.get("submissions", "order=submitted_at.asc");
    return rows.map(r => ({
      id:          r.id,
      username:    r.username,
      entryName:   r.entry_name,
      preds:       r.preds,
      submittedAt: new Date(r.submitted_at).getTime(),
    }));
  },
  async addSub(username, entryName, preds) {
    return sb.insert("submissions", { username, entry_name: entryName, preds });
  },
  async clearSubs() {
    return sb.del("submissions", "id=gte.0");
  },
  async clearAll() {
    await db.clearSubs();
    await sb.del("round", "id=eq.1");
  },
};

// ─── Session (just username in localStorage — no sensitive data) ──────────────
const session = {
  get: ()  => localStorage.getItem("fp_session") || null,
  set: u   => localStorage.setItem("fp_session", u),
  clear: () => localStorage.removeItem("fp_session"),
};

// ─── Kickoff deadline helpers ─────────────────────────────────────────────────
function deadlineTs(fixtures) {
  const tss = (fixtures||[]).map(f=>f.kickoffTs).filter(Boolean);
  if (!tss.length) return null;
  return Math.min(...tss) - 60_000;
}
function isDeadlinePassed(fixtures) {
  const d = deadlineTs(fixtures);
  return d !== null && Date.now() >= d;
}
function msUntilDeadline(fixtures) {
  const d = deadlineTs(fixtures);
  if (d === null) return null;
  return Math.max(0, d - Date.now());
}
function fmtCountdown(ms) {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return [h,m,sec].map(n=>String(n).padStart(2,"0")).join(":");
}

// ─── Mock data seeder ─────────────────────────────────────────────────────────
async function seedMockData() {
  const base = Date.now() + 10 * 60_000;
  const fixtures = [
    { home:"Arsenal",     away:"Chelsea",    date:"Sat 26 Apr", time:"12:30", kickoffTs: base },
    { home:"Man City",    away:"Liverpool",  date:"Sat 26 Apr", time:"15:00", kickoffTs: base + 2.5*3600_000 },
    { home:"Tottenham",   away:"Man Utd",    date:"Sat 26 Apr", time:"15:00", kickoffTs: base + 2.5*3600_000 },
    { home:"Aston Villa", away:"Newcastle",  date:"Sun 27 Apr", time:"14:00", kickoffTs: base + 26*3600_000 },
    { home:"Brighton",    away:"Wolves",     date:"Sun 27 Apr", time:"16:30", kickoffTs: base + 28.5*3600_000 },
  ];
  const mockResults = [
    { result:"home", score:"2-0" },
    { result:"home", score:"3-1" },
    { result:"away", score:"1-2" },
    { result:"draw", score:"1-1" },
    { result:"home", score:"2-1" },
  ];
  const round = { league:{ id:"epl", name:"Premier League", flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿" }, fixtures, mockResults, week:1, locked:false, winnersFound:false };

  // Mock users
  const pwHash = await hashPassword("test1234");
  for (const u of ["MarkTest","SarahTest","JoshTest","PeteTest"]) {
    try { await db.createUser(u, pwHash); } catch {} // ignore if already exists
  }

  // Clear existing round/subs and write fresh
  await db.clearAll();
  await db.setRound(round);

  const mockSubs = [
    { username:"MarkTest",  entryName:"Banker",    preds:{"0":"home","1":"home","2":"away","3":"draw","4":"home"} },
    { username:"MarkTest",  entryName:"Wild Card", preds:{"0":"draw","1":"away","2":"home","3":"home","4":"away"} },
    { username:"SarahTest", entryName:"Main Pick", preds:{"0":"home","1":"home","2":"away","3":"draw","4":"home"} },
    { username:"JoshTest",  entryName:"Gut Feel",  preds:{"0":"away","1":"draw","2":"away","3":"draw","4":"away"} },
    { username:"PeteTest",  entryName:"No Idea",   preds:{"0":"draw","1":"away","2":"home","3":"away","4":"draw"} },
  ];
  for (const s of mockSubs) await db.addSub(s.username, s.entryName, s.preds);

  console.log("✅ Mock data seeded in Supabase.");
  return "Done — refresh the page.";
}
window.seedMockData = seedMockData;

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(prompt) {
  // Calls our Netlify serverless function which proxies to Anthropic server-side.
  // The API key lives in Netlify environment variables, never in the browser.
  const res = await fetch("/api/claude", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      model:"claude-sonnet-4-20250514", max_tokens:1000,
      tools:[{type:"web_search_20250305",name:"web_search"}],
      messages:[{role:"user",content:prompt}],
    }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.content.map(b=>b.type==="text"?b.text:"").join("");
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────
function isPerfect(entry, results) {
  if (!results||results.some(r=>r.result==="upcoming")) return false;
  return results.every((r,i)=>entry.preds[String(i)]===r.result||entry.preds[i]===r.result);
}
function scoreEntry(entry, results) {
  if (!results) return { correct:0, total:0 };
  let correct=0, total=0;
  results.forEach((r,i)=>{
    if (r.result==="upcoming") return;
    total++;
    if (entry.preds[String(i)]===r.result||entry.preds[i]===r.result) correct++;
  });
  return { correct, total };
}

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

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [tab,setTab]=useState("login");
  const [u,setU]=useState(""); const [pw,setPw]=useState("");
  const [cpw,setCpw]=useState(""); const [inv,setInv]=useState("");
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);

  async function login() {
    setErr(""); setLoading(true);
    try {
      const found = await db.getUser(u.trim());
      if (!found) { setErr("Username not found."); setLoading(false); return; }
      if (await hashPassword(pw) !== found.password_hash) { setErr("Incorrect password."); setLoading(false); return; }
      session.set(found.username); onLogin(found.username);
    } catch { setErr("Connection error — check your internet."); }
    setLoading(false);
  }

  async function register() {
    setErr(""); setLoading(true);
    const trimmed=u.trim();
    if (trimmed.length<2)                        { setErr("Username must be at least 2 characters."); setLoading(false); return; }
    if (trimmed.length>20)                       { setErr("Username must be 20 characters or less."); setLoading(false); return; }
    if (pw.length<4)                             { setErr("Password must be at least 4 characters."); setLoading(false); return; }
    if (pw!==cpw)                                { setErr("Passwords don't match."); setLoading(false); return; }
    if (inv.trim().toUpperCase()!==INVITE_CODE)  { setErr("Invalid invite code."); setLoading(false); return; }
    try {
      const existing = await db.getUser(trimmed);
      if (existing) { setErr("Username already taken."); setLoading(false); return; }
      await db.createUser(trimmed, await hashPassword(pw));
      session.set(trimmed); onLogin(trimmed);
    } catch { setErr("Connection error — check your internet."); }
    setLoading(false);
  }

  const go = () => tab==="login"?login():register();

  return (
    <Screen>
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
          <Field label="Confirm Password"><input style={S.input} type="password" value={cpw} onChange={e=>setCpw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="••••••••"/></Field>
          <Field label="Invite Code"><input style={S.input} value={inv} onChange={e=>setInv(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="Ask the admin" autoCapitalize="characters"/></Field>
        </>}
        {err&&<ErrorBox>{err}</ErrorBox>}
        {loading?<Loader msg={tab==="login"?"Signing in…":"Creating account…"}/>:
          <Btn gold onClick={go} style={{marginTop:4}}>{tab==="login"?"Sign In →":"Create Account →"}</Btn>}
      </div>
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

  const [isAdmin,   setIsAdmin]   = useState(false);
  const [showPin,   setShowPin]   = useState(false);
  const [pinTarget, setPinTarget] = useState(null);
  const [selLeague, setSelLeague] = useState(null);
  const [entryName, setEntryName] = useState("");
  const [preds,     setPreds]     = useState({});
  const [entryView, setEntryView] = useState("list");
  const [submitDone,setSubmitDone]= useState(false);

  // ── Initial load from Supabase ────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const [r, s] = await Promise.all([db.getRound(), db.getSubs()]);
        setRound(r); setSubs(s);
      } catch (e) {
        setError("Couldn't connect to database. Check your internet connection.");
      }
      setAppReady(true);
    }
    init();
  }, []);

  // ── Poll for live updates (round + subs every 5s) ─────────────────────────
  useEffect(() => {
    if (!appReady) return;
    const cancelRound = sb.poll("round", "", async () => {
      const r = await db.getRound();
      setRound(r);
    });
    const cancelSubs = sb.poll("submissions", "order=submitted_at.asc", async () => {
      const s = await db.getSubs();
      setSubs(s);
    });
    return () => { cancelRound(); cancelSubs(); };
  }, [appReady]);

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

  const myEntries      = username ? subs.filter(s=>s.username===username) : [];
  const deadlineLocked = round ? isDeadlinePassed(round.fixtures) : false;
  const canAddEntry    = myEntries.length < MAX_ENTRIES && !deadlineLocked;
  const allPicked      = Object.keys(preds).length === 5;

  // ── Admin gate ────────────────────────────────────────────────────────────
  function requireAdmin(target) {
    if (isAdmin) executeAdmin(target);
    else { setPinTarget(target); setShowPin(true); }
  }
  function onPinSuccess() { setIsAdmin(true); setShowPin(false); executeAdmin(pinTarget); }
  function executeAdmin(t) {
    if (t==="setup")   { setError(""); setSelLeague(null); setView("setup"); }
    if (t==="reset")   { doReset(); }
    if (t==="newweek") { doNewWeek(); }
  }

  // ── Fetch fixtures ────────────────────────────────────────────────────────
  async function fetchFixtures() {
    if (!selLeague) return;
    setLoading(true); setError(""); setLoadMsg("Fetching upcoming fixtures…");
    try {
      const text = await callClaude(`
Fetch exactly 5 upcoming (not yet played) ${selLeague.name} fixtures.
Return ONLY a valid JSON array – no markdown fences, no extra text.
Each element: { home, away, date, time, kickoffIso }
home/away: short club name ≤20 chars. date e.g. "Sat 29 Mar". time e.g. "15:00".
kickoffIso: ISO 8601 datetime string e.g. "2025-04-26T15:00:00".`);
      const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
      if (!Array.isArray(parsed)||parsed.length===0) throw new Error();
      const fixtures = parsed.slice(0,5).map(f=>({
        ...f, kickoffTs: f.kickoffIso ? new Date(f.kickoffIso).getTime() : null,
      }));
      const newRound = { league:selLeague, fixtures, week:1, locked:false, winnersFound:false, mockResults:null };
      await db.clearAll();
      await db.setRound(newRound);
      const r = await db.getRound();
      setRound(r); setSubs([]); setResults(null); setView("lobby");
    } catch { setError("Couldn't load fixtures — try a different league or try again."); }
    setLoading(false);
  }

  // ── Submit an entry ───────────────────────────────────────────────────────
  async function submitEntry() {
    if (!entryName.trim()||!allPicked||!canAddEntry||round?.locked||deadlineLocked) return;
    setLoading(true); setLoadMsg("Sealing entry…");
    try {
      await db.addSub(username, entryName.trim(), preds);
      const s = await db.getSubs();
      setSubs(s);
      setPreds({}); setEntryName(""); setEntryView("list"); setSubmitDone(true);
    } catch { setError("Couldn't save entry — try again."); }
    setLoading(false);
  }

  // ── Reveal ────────────────────────────────────────────────────────────────
  async function startReveal() {
    setLoading(true); setLoadMsg("Checking match results…"); setError("");
    try {
      let parsed;
      if (round.mockResults) {
        parsed = round.mockResults;
      } else {
        const fixtureList = round.fixtures.map((f,i)=>`${i+1}. ${f.home} vs ${f.away} (${f.date})`).join("\n");
        const text = await callClaude(`
Check the final results of these ${round.league.name} fixtures:
${fixtureList}
Return ONLY a JSON array of exactly 5 objects in order:
{ result: "home"|"draw"|"away"|"upcoming", score: "2-1" or null }
Use "upcoming" if the match has not yet been played.
No markdown, no extra text.`);
        parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
        if (!Array.isArray(parsed)||parsed.length!==5) throw new Error("Bad response");
        const stillPending = parsed.filter(r=>r.result==="upcoming").length;
        if (stillPending>0) {
          setError(`${stillPending} match${stillPending>1?"es are":" is"} still to be played.`);
          setLoading(false); return;
        }
      }
      await db.patchRound({ locked:true });
      const r = await db.getRound();
      setRound(r);
      setResults(parsed); setView("reveal");
    } catch(e) {
      if (!e.message?.startsWith("Bad")) setError("Couldn't fetch results — try again later.");
    }
    setLoading(false);
  }

  // ── Reveal complete ───────────────────────────────────────────────────────
  async function onRevealComplete(winners) {
    if (winners.length>0) {
      await db.patchRound({ locked:true, winners_found:true });
      const r = await db.getRound();
      setRound(r);
      setConfetti(true);
    }
  }

  // ── New week ──────────────────────────────────────────────────────────────
  async function doNewWeek() {
    setLoading(true); setError(""); setLoadMsg("Setting up new week's fixtures…");
    try {
      const currentWeek = round?.week || 1;
      if (round.mockResults) {
        const base = Date.now() + 10 * 60_000;
        const fixtures = [
          { home:"Liverpool", away:"Arsenal",   date:"Sat 3 May", time:"12:30", kickoffTs: base },
          { home:"Chelsea",   away:"Man City",  date:"Sat 3 May", time:"15:00", kickoffTs: base + 2.5*3600_000 },
          { home:"Man Utd",   away:"Tottenham", date:"Sat 3 May", time:"15:00", kickoffTs: base + 2.5*3600_000 },
          { home:"Newcastle", away:"Everton",   date:"Sun 4 May", time:"14:00", kickoffTs: base + 26*3600_000 },
          { home:"Wolves",    away:"Leicester", date:"Sun 4 May", time:"16:30", kickoffTs: base + 28.5*3600_000 },
        ];
        const mockResults = [
          { result:"away", score:"0-1" },
          { result:"draw", score:"2-2" },
          { result:"home", score:"3-0" },
          { result:"away", score:"1-3" },
          { result:"home", score:"1-0" },
        ];
        const newRound = { league:round.league, fixtures, mockResults, week:currentWeek+1, locked:false, winnersFound:false };
        await db.clearSubs();
        await db.setRound(newRound);
      } else {
        const text = await callClaude(`
Fetch exactly 5 upcoming (not yet played) ${round.league.name} fixtures.
Return ONLY a valid JSON array – no markdown fences, no extra text.
Each element: { home, away, date, time, kickoffIso }
home/away: short club name ≤20 chars. date e.g. "Sat 29 Mar". time e.g. "15:00".
kickoffIso: ISO 8601 datetime string e.g. "2025-04-26T15:00:00".`);
        const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
        if (!Array.isArray(parsed)||parsed.length===0) throw new Error();
        const fixtures = parsed.slice(0,5).map(f=>({
          ...f, kickoffTs: f.kickoffIso ? new Date(f.kickoffIso).getTime() : null,
        }));
        const newRound = { league:round.league, fixtures, week:currentWeek+1, locked:false, winnersFound:false, mockResults:null };
        await db.clearSubs();
        await db.setRound(newRound);
      }
      const [r, s] = await Promise.all([db.getRound(), db.getSubs()]);
      setRound(r); setSubs(s); setResults(null); setView("lobby");
    } catch { setError("Couldn't load new fixtures — try again."); }
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
    setSubmitDone(false); setSelLeague(null); setConfetti(false); setError("");
    setLoading(false);
  }

  function signOut() {
    session.clear(); setUsername(null); setIsAdmin(false); setView("home");
    setPreds({}); setEntryName(""); setEntryView("list"); setSubmitDone(false);
  }

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!username) return <AuthScreen onLogin={u=>setUsername(u)}/>;

  // ── Loading initial data ───────────────────────────────────────────────────
  if (!appReady) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#05080f"}}>
      <Loader msg="Connecting…"/>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      <Confetti active={confetti}/>
      {showPin&&<PinModal onSuccess={onPinSuccess} onCancel={()=>setShowPin(false)}/>}

      {/* Nav */}
      <div style={S.nav}>
        <div style={S.navLogo} onClick={()=>setView("home")}>⚽ THE GAFFER</div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:13,color:"var(--muted)"}}>{username}</span>
          <button style={S.navBtn} onClick={signOut}>Sign out</button>
        </div>
      </div>

      {/* ── HOME ── */}
      {view==="home"&&(
        <Screen>
          <div style={S.bigLogo}>
            <div style={{fontSize:52,marginBottom:8}}>⚽</div>
            <div style={S.bigTitle}>THE GAFFER</div>
            <div style={S.bigSub}>Weekly Football Prediction League</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:360}}>
            <Btn gold onClick={()=>{setEntryView("list");setView("submit");}} disabled={!round||round.locked||deadlineLocked}>
              ✏️ My Predictions
            </Btn>
            <Btn onClick={()=>setView("lobby")} disabled={!round}>👥 Lobby</Btn>
          </div>
          {round?(
            <div style={S.pill}>
              <span style={{color:"var(--gold)",fontWeight:600}}>{round.league.flag} {round.league.name}</span>
              <span style={{color:"var(--muted)",margin:"0 8px"}}>·</span>
              <span style={{color:"var(--muted)"}}>Week {round.week}</span>
              <span style={{color:"var(--muted)",margin:"0 8px"}}>·</span>
              <span style={{color:"var(--muted)"}}>{subs.length} entr{subs.length!==1?"ies":"y"}</span>
              {(round.locked||deadlineLocked)&&<span style={{color:"var(--red)",marginLeft:8,fontSize:11}}>🔒 Locked</span>}
              {!round.locked&&!deadlineLocked&&countdown&&<span style={{color:"var(--gold)",marginLeft:8,fontSize:11,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.1em"}}>⏱ {countdown}</span>}
            </div>
          ):(
            <div style={{color:"var(--muted)",fontSize:13,textAlign:"center"}}>No active round — waiting for the admin.</div>
          )}
          <button style={S.adminLink} onClick={()=>requireAdmin("setup")}>
            {isAdmin?"⚙️ Admin: Start New Round":"🔐 Admin"}
          </button>
        </Screen>
      )}

      {/* ── SETUP ── */}
      {view==="setup"&&(
        <Screen>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle eyebrow="Admin" title="Pick a League" sub="Fixtures lock in once fetched. Every player predicts the same games."/>
          {error&&<ErrorBox>{error}</ErrorBox>}
          <div style={S.leagueGrid}>
            {LEAGUES.map(l=>(
              <button key={l.id} style={{...S.leagueCard,...(selLeague?.id===l.id?S.leagueCardOn:{})}} onClick={()=>setSelLeague(l)}>
                <span style={{fontSize:24}}>{l.flag}</span>
                <span style={{flex:1,fontWeight:600,fontSize:14,color:"var(--text)"}}>{l.name}</span>
                {selLeague?.id===l.id&&<span style={{color:"var(--gold)"}}>✓</span>}
              </button>
            ))}
          </div>
          {loading?<Loader msg={loadMsg}/>:
            <Btn gold onClick={fetchFixtures} disabled={!selLeague} style={{marginTop:8}}>Fetch &amp; Lock Fixtures →</Btn>}
          {round&&<button style={S.dangerLink} onClick={()=>requireAdmin("reset")}>⚠️ Full reset (clears all data)</button>}
          <button style={{...S.dangerLink,color:"var(--green)",marginTop:12}} onClick={async()=>{
            setLoading(true); setLoadMsg("Seeding mock data…");
            await seedMockData();
            const [r,s]=await Promise.all([db.getRound(),db.getSubs()]);
            setRound(r); setSubs(s); setResults(null); setView("lobby"); setLoading(false);
          }}>🧪 Seed mock data (test mode)</button>
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
          <SectionTitle eyebrow={`${round.league.flag} ${round.league.name} · Week ${round.week}`} title="My Entries" sub={`${myEntries.length} / ${MAX_ENTRIES} entries used`}/>
          {myEntries.length>0&&(
            <div style={{width:"100%",marginBottom:8}}>
              {myEntries.map((e,i)=>(
                <div key={i} style={S.entryRow}>
                  <div style={S.playerAvatar}>{e.entryName[0].toUpperCase()}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:14}}>{e.entryName}</div>
                    <div style={{fontSize:11,color:"var(--muted)"}}>
                      {[0,1,2,3,4].map(i=>OUTCOMES.find(o=>o.key===(e.preds[String(i)]||e.preds[i]))?.icon||"?").join(" ")}
                    </div>
                  </div>
                  <span style={{fontSize:11,color:"var(--muted)"}}>🔒</span>
                </div>
              ))}
            </div>
          )}
          {submitDone&&myEntries.length>0&&(
            <div style={S.successBanner} className="pop">
              ✅ Entry sealed!{canAddEntry?` ${MAX_ENTRIES-myEntries.length} slot${MAX_ENTRIES-myEntries.length!==1?"s":""} remaining.`:" You've used all your entries."}
            </div>
          )}
          {canAddEntry
            ?<Btn gold onClick={()=>{setEntryView("new");setSubmitDone(false);setPreds({});setEntryName("");}}>
                + Add Entry {myEntries.length>0?`(${MAX_ENTRIES-myEntries.length} left)`:""}
              </Btn>
            :<div style={{fontSize:13,color:"var(--muted)",textAlign:"center"}}>You've used all {MAX_ENTRIES} entries for this round.</div>
          }
        </Screen>
      )}

      {view==="submit"&&round&&!round.locked&&!deadlineLocked&&entryView==="new"&&(
        <Screen wide>
          <BackBtn onClick={()=>setEntryView("list")}/>
          <SectionTitle eyebrow={`Entry ${myEntries.length+1} of ${MAX_ENTRIES}`} title="New Entry" sub="Name your entry and pick a result for all 5 fixtures."/>
          <Field label="Entry Name">
            <input style={S.input} placeholder='e.g. "Banker" or "Wild Card"' value={entryName} onChange={e=>setEntryName(e.target.value)} maxLength={30}/>
          </Field>
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
              <span style={{fontSize:11,color:"var(--muted)"}}>Sealed on submit</span>
            </div>
          </div>
          {loading?<Loader msg={loadMsg}/>:
            <Btn gold onClick={submitEntry} disabled={!allPicked||!entryName.trim()}>🔒 Seal This Entry</Btn>}
        </Screen>
      )}

      {/* ── LOBBY ── */}
      {view==="lobby"&&round&&(
        <Screen wide>
          <BackBtn onClick={()=>setView("home")}/>
          <SectionTitle
            eyebrow={`${round.league.flag} ${round.league.name} · Week ${round.week}`}
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
            <div style={{width:"100%",background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:10,padding:"10px 16px",textAlign:"center",fontSize:13,color:"#fca5a5",marginBottom:4}}>
              🔒 Submissions closed
            </div>
          )}

          <div style={{width:"100%",marginBottom:20}}>
            <div style={S.sectionLabel}>This Week's Fixtures</div>
            {round.fixtures.map((f,i)=>(
              <div key={i} style={S.lobbyRow}>
                <span style={S.tag2}>#{i+1}</span>
                <span style={{flex:1,fontSize:14,fontWeight:500}}>{f.home}</span>
                <span style={{color:"var(--muted)",fontSize:12,margin:"0 6px"}}>vs</span>
                <span style={{flex:1,fontSize:14,fontWeight:500,textAlign:"right"}}>{f.away}</span>
                <span style={{color:"var(--muted)",fontSize:11,marginLeft:10,whiteSpace:"nowrap"}}>{f.date}</span>
              </div>
            ))}
          </div>

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
                        <div style={S.playerAvatar}>{p[0].toUpperCase()}</div>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:600,fontSize:14}}>{p}</div>
                          <div style={{fontSize:11,color:"var(--muted)"}}>{pe.length} entr{pe.length!==1?"ies":"y"}: {pe.map(e=>e.entryName).join(", ")}</div>
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
              {isAdmin&&round.locked&&!round.winnersFound&&<Btn onClick={()=>requireAdmin("newweek")}>📅 Admin: New Week's Fixtures</Btn>}
              {isAdmin&&round.winnersFound&&<Btn gold onClick={()=>requireAdmin("newweek")}>🔄 Admin: Start Next Round</Btn>}
              {!round.locked&&!deadlineLocked&&<Btn onClick={()=>{setEntryView("list");setView("submit");}}>✏️ My Entries</Btn>}
            </>}
            <button style={S.adminLink} onClick={()=>requireAdmin("reset")}>🔐 Admin: Full Reset</button>
          </div>
        </Screen>
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
  );
}

// ─── Reveal View ──────────────────────────────────────────────────────────────
function RevealView({ round, results, subs, onRevealComplete, onHome, onLobby, requireAdmin, isAdmin }) {
  const [phase,         setPhase]         = useState("fixtures");
  const [shownFixtures, setShownFixtures] = useState(0);
  const [outcome,       setOutcome]       = useState(null);
  const firedRef   = useRef(false);
  const playedCount = results.filter(r=>r.result!=="upcoming").length;

  function next() {
    if (shownFixtures<round.fixtures.length-1) { setShownFixtures(s=>s+1); }
    else {
      const winners = subs.filter(e=>isPerfect(e,results));
      const out = { winners, hasWinner:winners.length>0 };
      setOutcome(out); setPhase("outcome");
      if (!firedRef.current) { onRevealComplete(winners); firedRef.current=true; }
    }
  }

  return (
    <Screen wide>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",marginBottom:20}}>
        <button style={S.backBtnInline} onClick={onHome}>← Home</button>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",color:"var(--gold)",letterSpacing:2,fontSize:17}}>
          {round.league.flag} {round.league.name} · Week {round.week}
        </div>
        <div style={{width:60}}/>
      </div>

      {phase==="fixtures"&&(
        <>
          <SectionTitle eyebrow="The Reveal" title="Match Results" sub={`All ${playedCount} results in`}/>
          <div style={{width:"100%",display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
            {round.fixtures.map((f,i)=>{
              const r=results[i]; const shown=i<=shownFixtures;
              return (
                <div key={i} style={{...S.revealCard,
                  animation:shown?"revealCard 0.45s ease both":"",
                  opacity:shown?1:0.15,filter:shown?"none":"blur(2px)",
                  transition:"opacity 0.3s,filter 0.3s",
                  borderColor:shown?"rgba(240,192,64,0.3)":"var(--border)",
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={S.fixtureDate}>{f.date}</span>
                    <span style={S.tag}>#{i+1}</span>
                  </div>
                  <div style={S.matchup}>
                    <span style={{...S.teamName,color:shown&&r.result==="home"?"var(--gold)":"var(--text)",fontWeight:shown&&r.result==="home"?700:500}}>{f.home}</span>
                    <span style={S.scorePill}>{shown?(r.score||r.result):"vs"}</span>
                    <span style={{...S.teamName,textAlign:"right",color:shown&&r.result==="away"?"var(--gold)":"var(--text)",fontWeight:shown&&r.result==="away"?700:500}}>{f.away}</span>
                  </div>
                  {shown&&(
                    <div style={{marginTop:10,borderTop:"1px solid var(--border)",paddingTop:10}}>
                      <div style={{fontSize:10,color:"var(--muted)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Who got it right?</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {subs.map((s,si)=>{
                          const got=(s.preds[String(i)]||s.preds[i])===r.result;
                          return (
                            <div key={si} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 10px",borderRadius:20,
                              background:got?"rgba(52,211,153,0.12)":"rgba(255,255,255,0.03)",
                              border:`1px solid ${got?"rgba(52,211,153,0.35)":"rgba(255,255,255,0.07)"}`}}>
                              <span style={{fontSize:11}}>{got?"✅":"❌"}</span>
                              <span style={{fontSize:11,color:got?"var(--green)":"var(--muted)",fontWeight:got?600:400}}>
                                {s.username} <span style={{opacity:0.55}}>({s.entryName})</span>
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
          <Btn gold onClick={next} style={{maxWidth:320}}>
            {shownFixtures<round.fixtures.length-1?`Reveal Match #${shownFixtures+2} →`:"See the Outcome →"}
          </Btn>
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
                      <div style={{...S.playerAvatar,width:36,height:36,fontSize:15}}>{w.username[0].toUpperCase()}</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:16,color:"var(--text)"}}>{w.username}</div>
                        <div style={{fontSize:12,color:"var(--muted)"}}>{w.entryName}</div>
                      </div>
                      <div style={{marginLeft:"auto",fontSize:28}}>👑</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center",width:"100%",maxWidth:360}}>
                {isAdmin&&<Btn gold onClick={()=>requireAdmin("newweek")} style={{flex:1}}>🔄 Start Next Round</Btn>}
                <Btn onClick={onHome} style={{flex:1}}>← Home</Btn>
              </div>
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
                      <div style={S.playerAvatar}>{s.username[0].toUpperCase()}</div>
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
                {isAdmin&&<Btn gold onClick={()=>requireAdmin("newweek")} style={{flex:1}}>📅 New Week's Fixtures</Btn>}
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
      borderRadius:8,padding:"10px 14px",color:"#fca5a5",fontSize:13,width:"100%",textAlign:"center",...style}}>
      {children}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root:         { background:"#05080f",minHeight:"100vh",fontFamily:"'DM Sans',sans-serif",color:"var(--text)" },
  nav:          { position:"fixed",top:0,left:0,right:0,zIndex:50,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",background:"rgba(5,8,15,0.92)",borderBottom:"1px solid var(--border)",backdropFilter:"blur(10px)" },
  navLogo:      { fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.15em",color:"var(--gold)",cursor:"pointer" },
  navBtn:       { background:"none",border:"1px solid var(--border)",color:"var(--muted)",padding:"5px 12px",borderRadius:6,fontSize:12 },
  overlay:      { position:"fixed",inset:0,background:"rgba(5,8,15,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:80,backdropFilter:"blur(4px)" },
  backdrop:     { position:"fixed",inset:0,background:"rgba(5,8,15,0.92)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(6px)" },
  modal:        { background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:16,padding:"28px 24px",width:"100%",maxWidth:320,display:"flex",flexDirection:"column",alignItems:"center",gap:2 },
  modalTitle:   { fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:2,color:"var(--gold)" },
  bigLogo:      { textAlign:"center",marginBottom:28 },
  bigTitle:     { fontFamily:"'Bebas Neue',sans-serif",fontSize:52,letterSpacing:"0.15em",lineHeight:1,background:"linear-gradient(135deg,#f0c040,#f5d780,#c8960c)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent" },
  bigSub:       { fontSize:12,color:"var(--muted)",letterSpacing:"0.15em",textTransform:"uppercase",marginTop:5 },
  pill:         { marginTop:4,fontSize:13,textAlign:"center",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 14px" },
  adminLink:    { background:"none",border:"none",color:"var(--muted)",fontSize:12,cursor:"pointer",marginTop:6,opacity:0.45 },
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
  playerAvatar: { width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,var(--gold),#c8960c)",color:"var(--ink)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0 },
  revealCard:   { background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:"13px 15px" },
  winnerCard:   { textAlign:"center",padding:"28px 24px",background:"linear-gradient(135deg,rgba(240,192,64,0.1),rgba(240,192,64,0.03))",border:"1px solid rgba(240,192,64,0.4)",borderRadius:16,width:"100%" },
  rolloverCard: { textAlign:"center",padding:"28px 24px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:16,width:"100%" },
};
