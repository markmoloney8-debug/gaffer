import React, { useState, useEffect } from "react";
import { gafferTile, lmsTile, runStats } from "./runstats.js";
import { HOW as LMS_HOW, lmsStats } from "./Lms.jsx";
import { crowdSplit, contrarians, crowdRecord, hotCold, lastWeek, matchPreviews, lmsBest, pickTypeRecord, teamRecord, ordinal } from "./formstats.js";

// New navigation screens. They take the shared UI helpers as `ui` (same pattern as Lms.jsx) to avoid circular imports.
const TONE = {
  gold:  { c: "var(--gold)",  bg: "rgba(240,192,64,0.14)" },
  green: { c: "var(--green)", bg: "rgba(74,222,128,0.13)" },
  red:   { c: "var(--red)",   bg: "rgba(248,113,113,0.13)" },
  grey:  { c: "var(--muted)", bg: "rgba(148,163,184,0.10)" },
};
const OUT = { home: "H", draw: "D", away: "A" };
const pick = (e, i) => e.preds[String(i)] || e.preds[i];

function Pill({ tone, children }) {
  const t = TONE[tone] || TONE.grey;
  return <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "var(--text)", background: t.bg, border: `1px solid ${t.c}` }}>{children}</span>;
}
function Tile({ title, icon, tile, onClick, testid }) {
  const t = TONE[tile.tone] || TONE.grey;
  return (
    <button onClick={onClick} data-testid={testid} aria-label={`${title}. ${tile.pill}. ${tile.line}`}
      style={{ width: "100%", textAlign: "left", cursor: "pointer", color: "var(--text)", background: "var(--surface)", border: `2px solid ${t.c}`, borderRadius: 16, padding: 16, minHeight: 96, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 800 }}>{icon}{title}</span>
        <Pill tone={tile.tone}>{tile.pill}</Pill>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>{tile.line}</div>
    </button>
  );
}

export function HomeView({ ui, username, groupName, curGroup, groupId, hue, round, subs, closed, countdown, st, onGaffer, onLms }) {
  const { Screen, Ico, GroupMark } = ui;
  const g = gafferTile({ round, subs, username, closed });
  const l = lmsTile(st);
  return (
    <Screen>
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 14 }}>
        {groupName && <div style={{ alignSelf: "center", padding: "6px 18px", borderRadius: 999, fontSize: 16, fontWeight: 800, border: `2px solid hsl(${hue} 65% 52%)`, background: `hsl(${hue} 65% 52% / 0.18)` }}>
          <GroupMark emoji={curGroup && curGroup.emoji} size={24}/>{curGroup ? curGroup.name : groupName}</div>}
        <Tile title="The Gaffer" icon={<Ico n="predict"/>} tile={{ ...g, line: g.line + (countdown && g.tone !== "grey" && !(round && (round.locked || closed)) ? ` Closes in ${countdown}.` : "") }} onClick={onGaffer} testid="tile-gaffer"/>
        <Tile title="Last Man Standing" icon={<Ico n="lms"/>} tile={l} onClick={onLms} testid="tile-lms"/>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, textAlign: "center" }}>
          Gold = something for you to do. Green = you're in. Red = you're out. Grey = nothing to do right now.
        </div>
      </div>
    </Screen>
  );
}

export function AvatarMenu({ ui, username, isAdmin, groupCount, theme, onTheme, go, onSignOut, onClose }) {
  const { Avatar } = ui;
  const row = { minHeight: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", borderRadius: 12, fontSize: 15, background: "none", border: "none", color: "var(--text)", width: "100%", cursor: "pointer", textAlign: "left" };
  const item = (label, fn, extra, color) => <button key={label} role="menuitem" style={{ ...row, color: color || "var(--text)" }} onClick={() => { onClose(); fn(); }}><span>{label}</span>{extra && <span style={{ fontSize: 13, color: "var(--muted)" }}>{extra}</span>}</button>;
  useEffect(() => { const k = e => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(5,8,14,0.55)" }}/>
      <div role="menu" aria-label="Account menu" style={{ position: "absolute", top: 8, right: 12, width: "min(300px, calc(100vw - 24px))", borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border)", padding: 8, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12 }}>
          <Avatar name={username} size={44}/>
          <div><div style={{ fontWeight: 700, fontSize: 16 }}>{username}</div>{isAdmin && <div style={{ fontSize: 13, color: "var(--muted)" }}>Admin</div>}</div>
        </div>
        <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }}/>
        {item("My profile", () => go("profile"))}
        {item("My groups", () => go("join"), String(groupCount))}
        {item("Send feedback", () => go("feedback"))}
        {item("How to play", () => go("help"))}
        <button role="menuitem" style={row} onClick={onTheme}><span>Theme</span><span style={{ fontSize: 13, color: "var(--muted)" }}>{theme === "dark" ? "Dark" : "Light"}</span></button>
        <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }}/>
        {item(isAdmin ? "Admin tools" : "Admin", () => go("admin"), isAdmin ? null : "PIN")}
        {item("Sign out", onSignOut, null, "var(--red)")}
      </div>
    </div>
  );
}

export function GafferHub({ ui, username, round, subs, history, closed, countdown, canReveal, error, onBack, go }) {
  const { Screen, BackBtn, Btn, Ico } = ui;
  const rs = runStats({ history, round, subs, username });
  const mine = subs.filter(s => s.username === username).length;
  const isClosed = !!round && (round.locked || closed);
  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 16 };
  const big = c => ({ fontFamily: "'Bebas Neue',sans-serif", fontSize: 34, lineHeight: 1, color: c });
  return (
    <Screen>
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
        <BackBtn onClick={onBack}/>
        <div>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 38, letterSpacing: 1.5, lineHeight: 1 }}>THE GAFFER</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
            {round ? `${round.league.name} · week ${round.week}${!isClosed && countdown ? ` · entries close in ${countdown}` : isClosed ? " · entries closed" : ""}` : "No active round"}
          </div>
        </div>
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }} aria-label="Your run so far">
          <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Your run so far{rs.winners.length ? ` (since ${rs.winners.join(" & ")} won in week ${rs.lastWin})` : " (since the start)"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><div style={big("var(--gold)")}>{rs.mine}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>entries made</div></div>
            <div style={{ flex: 1 }}><div style={big("var(--gold)")}>£{rs.mine}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>you have put in</div></div>
            <div style={{ flex: 1 }}><div style={big("var(--text)")}>£{rs.pot}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>group pot</div></div>
          </div>
          {rs.weeks.length > 0 && <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            {rs.weeks.map(w => `Week ${w.week}: ${w.mine} of yours`).join(" · ")}. One entry is £1. Counts every week since the last win.
          </div>}
        </div>
        <Btn gold onClick={() => go("submit")} disabled={!round || isClosed}><Ico n="predict"/>My predictions{round ? ` (${mine} entr${mine === 1 ? "y" : "ies"})` : ""}</Btn>
        <Btn onClick={() => go("lobby")} disabled={!round}><Ico n="lobby"/>This run</Btn>
        <Btn onClick={() => go("story")}><Ico n="story"/>Season</Btn>
        <Btn onClick={() => go("form")}><Ico n="story"/>Form guide</Btn>
        {error && <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13 }}>{error}</div>}
        {canReveal && <Btn gold onClick={() => go("reveal")}>Check Results &amp; Reveal</Btn>}
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
          Results update by themselves after each match, usually within the hour. Stats and the pot update on Tuesday morning, when the week is wrapped up and the next round starts.
        </div>
        <button onClick={() => go("help")} style={{ background: "none", border: "none", color: "var(--muted)", textAlign: "left", fontSize: 14, minHeight: 44, cursor: "pointer", padding: 0 }}>How to play The Gaffer</button>
      </div>
    </Screen>
  );
}

// Everyone against every match, once picks are out. Tinted green/red once a match is played, with a split bar under each column.
export function RunGrid({ round, subs }) {
  const [mode, setMode] = useState("grid");
  const fx = round.fixtures, res = i => { const r = round.results && round.results[i] && round.results[i].result; return r && r !== "upcoming" ? r : null; };
  const tab = k => <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "1px solid var(--border)", background: mode === k ? "var(--gold)" : "var(--surface)", color: mode === k ? "var(--ink)" : "var(--text)", fontWeight: 700, cursor: "pointer" }}>{k === "grid" ? "Grid" : "By match"}</button>;
  const split = i => { const t = { home: 0, draw: 0, away: 0 }; subs.forEach(s => { const p = pick(s, i); if (t[p] != null) t[p]++; }); return t; };
  const Bar = ({ i }) => { const t = split(i), n = subs.length || 1; return (
    <div title={`H ${t.home} · D ${t.draw} · A ${t.away}`} style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--border)" }}>
      <div style={{ width: `${t.home / n * 100}%`, background: "var(--gold)" }}/><div style={{ width: `${t.draw / n * 100}%`, background: "var(--muted)" }}/><div style={{ width: `${t.away / n * 100}%`, background: "#60a5fa" }}/></div>); };
  const tint = (p, i) => { const r = res(i); return r ? (r === "void" || r === p ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)") : "transparent"; };
  return (
    <div style={{ width: "100%", marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{["grid", "match"].map(tab)}</div>
      {mode === "grid" ? (
        <div style={{ overflowX: "auto" }} aria-label="Picks grid">
          <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
            <thead><tr><th style={{ textAlign: "left", padding: 6 }}>Entry</th>{fx.map((f, i) => <th key={i} style={{ padding: 6, fontWeight: 600 }} title={`${f.home} v ${f.away}`}>#{i + 1}</th>)}</tr></thead>
            <tbody>
              {subs.map(s => <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: 6, whiteSpace: "nowrap" }}>{s.username}<div style={{ fontSize: 11, color: "var(--muted)" }}>{s.entryName}</div></td>
                {fx.map((f, i) => { const p = pick(s, i); return <td key={i} style={{ textAlign: "center", padding: 6, background: tint(p, i), fontWeight: 700 }}>{OUT[p] || "–"}</td>; })}
              </tr>)}
              <tr style={{ borderTop: "1px solid var(--border)" }}><td style={{ padding: 6, fontSize: 11, color: "var(--muted)" }}>Split</td>{fx.map((f, i) => <td key={i} style={{ padding: "6px 4px" }}><Bar i={i}/></td>)}</tr>
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>H home · D draw · A away. Bar: gold home, grey draw, blue away. #1 to #5 follow the fixtures above.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-label="Picks by match">
          {fx.map((f, i) => { const t = split(i), n = subs.length; return (
            <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>#{i + 1} {f.home} v {f.away}{res(i) ? ` · ${res(i) === "void" ? "void" : res(i) === "draw" ? "draw" : res(i) === "home" ? `${f.home} won` : `${f.away} won`}` : ""}</div>
              <div style={{ margin: "8px 0" }}><Bar i={i}/></div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{f.home} win {t.home} · Draw {t.draw} · {f.away} win {t.away} (of {n})</div>
            </div>); })}
        </div>
      )}
    </div>
  );
}

export function HowToPlayView({ ui, gaffer, faq, onBack, start = "gaffer" }) {
  const { Screen, BackBtn } = ui; const [tab, setTab] = useState(start);
  const box = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 };
  return (
    <Screen>
      <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
        <BackBtn onClick={onBack}/>
        <div style={{ display: "flex", gap: 8 }}>
          {[["gaffer", "The Gaffer"], ["lms", "Last Man Standing"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
            style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "1px solid var(--border)", background: tab === k ? "var(--gold)" : "var(--surface)", color: tab === k ? "var(--ink)" : "var(--text)", fontWeight: 700, cursor: "pointer" }}>{l}</button>)}
        </div>
        {tab === "gaffer" ? <>
          <div style={box}><ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>{gaffer.map((t, i) => <li key={i} style={{ marginBottom: 6 }}>{t}</li>)}</ol></div>
          <div style={box}>{faq.map(([q, a]) => <details key={q} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}><summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600 }}>{q}</summary><div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginTop: 6 }}>{a}</div></details>)}</div>
        </> : <div style={box}>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>{LMS_HOW.map((t, i) => <li key={i} style={{ marginBottom: 6 }}>{t}</li>)}</ol>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>The stake is £5 each. Last player standing takes the pot.</div>
        </div>}
      </div>
    </Screen>
  );
}

// ── Form guide: collapsible cards, pin stars (cards float to the top), and a watchlist. Saved on this device only. ──
const LS = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function FormGuide({ ui, username, round, subs, history, st, teamForm = [], picksOut, startGame = "gaffer", onBack }) {
  const { Screen, BackBtn } = ui;
  const [game, setGame] = useState(startGame);
  const [pins, setPins] = useState(() => LS("gaffer.pins") || []);
  const [shut, setShut] = useState(() => LS("gaffer.shut") || []);
  const [watch, setWatch] = useState(() => LS("gaffer.watch") || []);
  const togglePin = id => { const n = pins.includes(id) ? pins.filter(x => x !== id) : [...pins, id]; setPins(n); LSset("gaffer.pins", n); };
  const toggleShut = id => { const n = shut.includes(id) ? shut.filter(x => x !== id) : [...shut, id]; setShut(n); LSset("gaffer.shut", n); };
  const toggleWatch = u => { const n = watch.includes(u) ? watch.filter(x => x !== u) : [...watch, u]; setWatch(n); LSset("gaffer.watch", n); };
  const later = <div style={{ fontSize: 13, color: "var(--muted)" }}>This builds up from now on. It needs a few finished weeks to say anything useful.</div>;
  const star = u => <button onClick={() => toggleWatch(u)} aria-pressed={watch.includes(u)} aria-label={`${watch.includes(u) ? "Stop following" : "Follow"} ${u}`} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: watch.includes(u) ? "var(--gold)" : "var(--muted)", minWidth: 36, minHeight: 36 }}>{watch.includes(u) ? "★" : "☆"}</button>;
  const row = (a, b) => <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "4px 0" }}><span>{a}</span><span style={{ color: "var(--muted)", textAlign: "right" }}>{b}</span></div>;

  const cards = [];
  const f0 = round && round.fixtures && round.fixtures[0];
  const when = f0 ? ` (first kick-off ${f0.date} ${f0.time})` : "";
  const hidden = <div style={{ fontSize: 13, color: "var(--muted)" }}>Everyone's picks stay hidden until entries close{when}. This fills in then.</div>;
  if (game === "gaffer") {
    const cs = round ? crowdSplit(round, subs) : [];
    const pv = matchPreviews(round, teamForm), dim = { fontSize: 12, color: "var(--muted)" };
    const letters = str => <span style={{ letterSpacing: 2, fontWeight: 700 }}>{str || "–"}</span>;
    cards.push({ id: "g-preview", title: "This week: form and league position", body: pv.length ? <>
      {pv.map(p => <div key={p.i} style={{ padding: "6px 0", borderTop: p.i ? "1px solid var(--border)" : "none" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{p.homeTeam}{p.home.pos ? ` (${ordinal(p.home.pos)})` : ""} v {p.awayTeam}{p.away.pos ? ` (${ordinal(p.away.pos)})` : ""}</div>
        <div style={{ fontSize: 13, display: "flex", justifyContent: "space-between", gap: 8 }}><span>{letters(p.home.last5)}</span><span style={dim}>last 5</span><span>{letters(p.away.last5)}</span></div>
        {p.home.venue && p.away.venue && <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
          <span>Home: W{p.home.venue.w} D{p.home.venue.d} L{p.home.venue.l}</span><span>Away: W{p.away.venue.w} D{p.away.venue.d} L{p.away.venue.l}</span></div>}
      </div>)}
      <div style={{ ...dim, marginTop: 6 }}>W win, D draw, L loss, newest on the right. Updated every few hours{teamForm.length ? "" : "; league position and home/away records appear after the first update"}.</div></> : <div style={dim}>No fixtures yet.</div> });
    const ptr = pickTypeRecord(history), tr = teamRecord(history);
    cards.push({ id: "g-types", title: "How our picks have landed", body: ptr ? <>
      {row("Home picks", `${ptr.home.pct == null ? "–" : ptr.home.pct + "%"} right (${ptr.home.n})`)}{row("Draw picks", `${ptr.draw.pct == null ? "–" : ptr.draw.pct + "%"} right (${ptr.draw.n})`)}{row("Away picks", `${ptr.away.pct == null ? "–" : ptr.away.pct + "%"} right (${ptr.away.n})`)}
      <div style={dim}>Across {ptr.weeks} saved week{ptr.weeks === 1 ? "" : "s"}.</div></> : <div style={dim}>Builds up from now on: from this week, each finished week saves the picks and results behind it.</div> });
    cards.push({ id: "g-teams", title: "Teams we back right (and wrong)", body: tr ? <>
      {tr.best.map(t => row(t.team, `${t.hit} of ${t.n} right`))}<div style={{ height: 6 }}/>{tr.worst.map(t => row(<span style={{ color: "var(--muted)" }}>{t.team}</span>, `${t.hit} of ${t.n} right`))}</> : <div style={dim}>Needs a few weeks of saved picks (teams backed at least 3 times).</div> });
    const hc = hotCold(history), lw = lastWeek(history);
    cards.push({ id: "g-last", title: lw ? `Last week (week ${lw.week})` : "Last week", body: lw ? lw.players.map(p => row(<span>{star(p.username)}{p.username}</span>, `${p.correct} of ${p.total} · ${p.entries} entr${p.entries === 1 ? "y" : "ies"}`)) : later });
    cards.push({ id: "g-hot", title: "Who's hot and who's not", body: hc ? <>
      {hc.map(p => row(<span>{star(p.username)}{p.username}</span>, `${p.recent}% lately · ${p.season}% season ${p.diff > 0 ? "▲" : p.diff < 0 ? "▼" : ""}`))}</> : later });
    cards.push({ id: "g-crowd", title: "How the group is picking", body: !round || !subs.length ? <div style={{ fontSize: 13, color: "var(--muted)" }}>No entries yet. Once people enter, picks stay hidden until entries close{when}.</div>
      : !picksOut ? hidden
      : cs.map(c => row(`${c.homeTeam} v ${c.awayTeam}`, `${c.topPick === "home" ? c.homeTeam : c.topPick === "away" ? c.awayTeam : "Draw"} ${c.topShare}%`)) });
    cards.push({ id: "g-home", title: "Most picked to win at home", body: !picksOut || !cs.length ? hidden
      : cs.slice().sort((a, b) => (b.n ? b.home / b.n : 0) - (a.n ? a.home / a.n : 0)).map(c => row(c.homeTeam, `${c.n ? Math.round(c.home / c.n * 100) : 0}% back them`)) });
    const co = picksOut && round ? contrarians(round, subs) : [];
    cards.push({ id: "g-contra", title: "Going against the crowd", body: co.length ? co.slice(0, 5).map(c => row(<span>{star(c.username)}{c.username}</span>, `${c.pct}% of picks off the favourite`)) : (!picksOut ? hidden : <div style={{ fontSize: 13, color: "var(--muted)" }}>Needs three or more entries to compare.</div>) });
    const rec = picksOut && round ? crowdRecord(round, subs) : null;
    cards.push({ id: "g-crowdrec", title: "Is the crowd right?", body: rec && rec.played ? <>{row("Favourite pick came in", `${rec.right} of ${rec.played} played`)}{rec.worst && row("Biggest upset", `${rec.worst.homeTeam} v ${rec.worst.awayTeam} (only ${rec.worst.share}% backed it)`)}</> : (!picksOut ? hidden : <div style={{ fontSize: 13, color: "var(--muted)" }}>Appears once matches have been played.</div>) });
    cards.push({ id: "g-form", title: "Team form (last 5)", body: round && round.fixtures.some(f => f.form) ? round.fixtures.map(f => f.form ? row(`${f.home} v ${f.away}`, `${(f.form.home || []).join("") || "–"} | ${(f.form.away || []).join("") || "–"}`) : null) : <div style={{ fontSize: 13, color: "var(--muted)" }}>No form data for this week yet.</div> });
  } else {
    const entries = (st && st.entries) || [], comp = st && st.competition;
    const alive = entries.filter(e => e.status === "alive");
    const ls = comp ? lmsStats(entries) : null;
    cards.push({ id: "l-surv", title: "Still standing", body: comp ? <>{row("Alive", `${alive.length} of ${entries.length}`)}{alive.map(e => row(<span>{star(e.username)}{e.username}</span>, `${(e.picks || []).filter(p => p.outcome === "win").length} wins`))}</> : <div style={{ fontSize: 13, color: "var(--muted)" }}>No game running in this group.</div> });
    const me = entries.find(e => e.username === (st && st.me));
    const usedNow = new Set(me ? (me.picks || []).filter(p => p.outcome === "win" && p.gameweek >= me.cycleFrom).map(p => p.team) : []);
    const best = comp && st.gameweek ? lmsBest(st.gameweek.fixtures, teamForm, usedNow).slice(0, 6) : [];
    cards.push({ id: "l-best", title: "Best teams to pick this gameweek", body: best.length ? <>
      {best.map(b => row(<span>{b.team} <span style={{ color: "var(--muted)" }}>({b.venue === "home" ? "home v" : "away at"} {b.opp})</span></span>,
        b.score == null ? "no form data yet" : <span><span style={{ letterSpacing: 2, fontWeight: 700 }}>{b.last5}</span>{b.pos ? ` · ${ordinal(b.pos)}` : ""}</span>))}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Leaves out teams you've already used. Ranked on recent form, form at that ground and how far above the opponent they are. A guide, not a promise.</div></>
      : <div style={{ fontSize: 13, color: "var(--muted)" }}>Appears when a gameweek is open and you're in the game.</div> });
    cards.push({ id: "l-team", title: "Most picked team", body: ls && ls.topTeam ? row(ls.topTeam[0], `${ls.topTeam[1]} picks`) : later });
    cards.push({ id: "l-streak", title: "Longest winning streak", body: ls && ls.topStreak ? row(<span>{star(ls.topStreak.username)}{ls.topStreak.username}</span>, `${ls.topStreak.best} in a row`) : later });
  }
  const sorted = cards.slice().sort((a, b) => (pins.includes(b.id) ? 1 : 0) - (pins.includes(a.id) ? 1 : 0));
  const watched = watch.length ? watch : [];
  return (
    <Screen>
      <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 12 }}>
        <BackBtn onClick={onBack}/>
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 34, letterSpacing: 1.5, lineHeight: 1 }}>FORM GUIDE</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Stats and trends to play with. Tap ☆ by a player to follow them. Tap Pin to keep a card at the top. Pins and follows are saved on this device only.</div>
        <div style={{ display: "flex", gap: 8 }}>{[["gaffer", "The Gaffer"], ["lms", "Last Man Standing"]].map(([k, l]) => <button key={k} onClick={() => setGame(k)} aria-pressed={game === k} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "1px solid var(--border)", background: game === k ? "var(--gold)" : "var(--surface)", color: game === k ? "var(--ink)" : "var(--text)", fontWeight: 700, cursor: "pointer" }}>{l}</button>)}</div>
        {watched.length > 0 && <div style={{ background: "var(--surface)", border: "1px solid var(--gold)", borderRadius: 14, padding: 14 }} aria-label="My watchlist">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>My watchlist</div>
          {watched.map(u => { const mine = subs.filter(s => s.username === u).length; const le = ((st && st.entries) || []).find(e => e.username === u);
            return <div key={u}>{row(<span>{star(u)}{u}</span>, game === "gaffer" ? `${mine} entr${mine === 1 ? "y" : "ies"} this week` : le ? (le.status === "alive" ? "still standing" : "out") : "not in the game")}</div>; })}
        </div>}
        {sorted.map(c => <section key={c.id} aria-label={c.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => toggleShut(c.id)} aria-expanded={!shut.includes(c.id)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", color: "var(--text)", fontWeight: 700, fontSize: 15, minHeight: 36, cursor: "pointer", padding: 0 }}>{shut.includes(c.id) ? "▸ " : "▾ "}{c.title}</button>
            <button onClick={() => togglePin(c.id)} aria-pressed={pins.includes(c.id)} aria-label={`${pins.includes(c.id) ? "Unpin" : "Pin"} ${c.title}`}
              style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, minHeight: 36, padding: "0 12px", borderRadius: 999, border: "1px solid " + (pins.includes(c.id) ? "var(--gold)" : "var(--border)"), background: pins.includes(c.id) ? "var(--gold)" : "none", color: pins.includes(c.id) ? "var(--ink)" : "var(--muted)" }}>{pins.includes(c.id) ? "Pinned" : "Pin"}</button>
          </div>
          {!shut.includes(c.id) && <div style={{ marginTop: 8 }}>{c.body}</div>}
        </section>)}
      </div>
    </Screen>
  );
}
