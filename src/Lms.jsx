import { useState, useEffect, useRef } from "react";

// Last Man Standing. Everything the page knows comes from the lms_state RPC; picks, joins and starts go through
// lms_pick / lms_join / lms_start, which do all the rule checking and raise readable errors.
// The shared look (Screen, Btn, etc.) is passed in from App.jsx so this page matches the rest of the site.

const OUTCOME = {
  win:    { t: "Won",     c: "var(--green)" },
  draw:   { t: "Drew",    c: "var(--red)" },
  lose:   { t: "Lost",    c: "var(--red)" },
  missed: { t: "No pick", c: "var(--red)" },
  void:   { t: "Void",    c: "var(--muted)" },
};

// Streaks and favourites, worked out from the picks the page can already see.
export function lmsStats(entries) {
  const per = entries.map(e => {
    let run = 0, best = 0; const count = {};
    for (const p of e.picks || []) {
      if (p.team) count[p.team] = (count[p.team] || 0) + 1;
      if (p.outcome === "win") { run++; best = Math.max(best, run); }
      else if (p.outcome && p.outcome !== "void") run = 0;
    }
    return { username: e.username, best, wins: (e.picks || []).filter(p => p.outcome === "win").length, count };
  });
  const all = {}; per.forEach(x => Object.entries(x.count).forEach(([t, n]) => { all[t] = (all[t] || 0) + n; }));
  const topTeam = Object.entries(all).sort((a, b) => b[1] - a[1])[0] || null;
  const topStreak = per.slice().sort((a, b) => b.best - a.best)[0];
  return { per, topTeam, topStreak: topStreak && topStreak.best > 0 ? topStreak : null };
}

const HOW = [
  "Everyone picks one Premier League team to win each gameweek. A gameweek is one round of fixtures, including midweek rounds.",
  "If your team wins, you stay in. If it draws or loses, you're out. No pick means you're out too.",
  "You can't pick the same team twice. Once you've used every team, your list starts again.",
  "Picks lock 60 seconds before the first kick-off of the gameweek. You can change your pick as often as you like until then.",
  "Other players' picks stay hidden until the gameweek locks.",
  "If your team's game is postponed, pick again from the games that haven't kicked off yet, even after the deadline. If you don't, you're out. If there's no later game to switch to, you're safe and the team isn't used up.",
  "If a whole round is postponed, that gameweek doesn't count.",
  "If everyone still standing goes out in the same gameweek, they all come back and play on.",
  "Last player standing wins. Players can join until the first deadline of a game. Knocked-out players can keep following the board.",
];

// How a player's pick for the current gameweek is doing: 'win' | 'out' | 'pending' | 'postponed' | 'none'.
export function pickState(entry, gw) {
  if (!gw) return { state: "none", team: null };
  const p = (entry.picks || []).find(x => x.gameweek === gw.id && x.team);
  if (!p) return { state: "none", team: null };
  const f = (gw.fixtures || []).find(x => x.matchId === p.matchId);
  if (!f || !f.result) return { state: "pending", team: p.team };
  if (f.result === "postponed") return { state: "postponed", team: p.team };
  const won = (f.result === "home" && p.team === f.home) || (f.result === "away" && p.team === f.away);
  return { state: won ? "win" : "out", team: p.team };
}

export function fmtLeft(ms) {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${x}s` : `${m}m ${x}s`;
}
const errText = e => { const m = String((e && e.message) || e || ""); try { const j = JSON.parse(m); return j.message || m; } catch { return m; } };

export default function LmsView({ ui, sb, username, groups, groupId: initialGroup, onBack }) {
  const { Screen, BackBtn, Btn, Loader, ErrorBox, Ico, GroupMark, AvatarBubble, S, TIP_URL, gLabel } = ui;
  const [gid, setGid] = useState(initialGroup && groups.some(g => g.id === initialGroup) ? initialGroup : (groups[0] && groups[0].id) || null);
  const [st, setSt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState({});
  const skew = useRef(0);
  const gidRef = useRef(gid);
  gidRef.current = gid;

  async function load(quiet) {
    if (!gid) return;
    if (!quiet) setLoading(true);
    try {
      const s = await sb.rpc("lms_state", { p_group: gid });
      if (gidRef.current !== gid) return;
      skew.current = Number(s.now) - Date.now();
      setSt(s); if (!quiet) setErr("");
    } catch (e) { if (!quiet) setErr(errText(e)); }
    if (!quiet) setLoading(false);
  }
  useEffect(() => { setSt(null); setErr(""); load(false); }, [gid]);
  useEffect(() => {
    const poll = setInterval(() => load(true), 30000);
    const clock = setInterval(() => setTick(t => t + 1), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [gid]);

  const now = Date.now() + skew.current;
  const gw = st && st.gameweek, comp = st && st.competition;
  const deadline = gw ? Date.parse(gw.deadline) : 0;
  const before = !!gw && now < deadline;
  // Reload the moment the deadline passes so other players' picks appear.
  useEffect(() => { if (gw && !before && tick > 0 && now - deadline < 1500) load(true); }, [before]);

  const entries = (st && st.entries) || [];
  const mine = entries.find(e => e.username === (st && st.me));
  const myPickNow = mine && gw ? (mine.picks || []).find(p => p.gameweek === gw.id && p.team) : null;
  const used = new Set(mine ? (mine.picks || []).filter(p => p.outcome === "win" && p.gameweek >= mine.cycleFrom).map(p => p.team) : []);
  const fixtures = (gw && gw.fixtures) || [];
  const postponedMine = !!(myPickNow && fixtures.some(f => f.matchId === myPickNow.matchId && f.result === "postponed"));
  const running = comp && comp.status === "running";
  const gwOpen = !!gw && gw.status === "open";
  const alive = !!mine && mine.status === "alive";
  // Normally picking is open until the deadline; after it, only a postponed pick can be redone, and only onto games not yet started.
  const canPick = running && gwOpen && alive && (before || postponedMine);
  const pickable = f => canPick && f.result !== "postponed" && (before || f.kickoffTs > now);

  async function act(fn, args, after) {
    setBusy(true); setErr("");
    try { await sb.rpc(fn, args); if (after) after(); await load(true); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }

  const head = <>
    <BackBtn onClick={onBack}/>
    <img src="/lms-hero.png" alt="" style={{width: "100%", maxWidth: 360, borderRadius: 14, display: "block"}}/>
    <div style={{textAlign: "center", width: "100%"}}>
      <div style={S.eyebrow}>THE GAFFER</div>
      <h2 style={S.sectionH2}>Last Man Standing</h2>
      <p style={S.sectionSub}>Pick one Premier League team to win each gameweek. Win and you stay in. Draw, lose or forget and you're out. You can't reuse a team until you've used them all.</p>
    </div>
    <details style={{width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 16px"}}>
      <summary style={{cursor: "pointer", fontWeight: 700, fontSize: 14}}>How to play</summary>
      <ol style={{margin: "10px 0 4px 18px", fontSize: 14, lineHeight: 1.55, color: "var(--text)", display: "flex", flexDirection: "column", gap: 6}}>
        {HOW.map((t, i) => <li key={i}>{t}</li>)}
      </ol>
    </details>
    {groups.length > 1 && (
      <select value={gid || ""} onChange={e => setGid(e.target.value)} aria-label="Group" style={{...S.input, maxWidth: 360}}>
        {groups.map(g => <option key={g.id} value={g.id}>{gLabel(g)}</option>)}
      </select>
    )}
  </>;

  if (!groups.length) return <Screen>{head}<div style={{color: "var(--muted)", textAlign: "center"}}>Join a group first, then you can play Last Man Standing with them.</div></Screen>;
  if (loading && !st) return <Screen>{head}<Loader msg="Loading…"/></Screen>;
  if (!st) return <Screen>{head}{err && <ErrorBox>{err}</ErrorBox>}<Btn onClick={() => load(false)}>Try again</Btn></Screen>;

  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", width: "100%" };
  const winners = (comp && comp.winners) || [];
  const stats = lmsStats(entries);

  return (
    <Screen>
      {head}
      {err && <ErrorBox>{err}</ErrorBox>}

      {!comp && (
        <div style={{...card, textAlign: "center"}}>
          {st.canManage ? (
            <>
              <div style={{marginBottom: 12, color: "var(--muted)", fontSize: 14}}>Nobody has started a game in this group yet. Players can join until the first deadline.</div>
              <Btn gold disabled={busy || !gw || !before} onClick={() => act("lms_start", { p_group: gid })}>Start Last Man Standing</Btn>
              {gw && !before && <div style={{marginTop: 10, color: "var(--muted)", fontSize: 13}}>This gameweek has already started. You can start the game when the next one opens.</div>}
              {!gw && <div style={{marginTop: 10, color: "var(--muted)", fontSize: 13}}>The first gameweek hasn't been set up yet. Check back soon.</div>}
            </>
          ) : <div style={{fontWeight: 600}}>No game running yet</div>}
        </div>
      )}

      {comp && comp.status === "finished" && (
        <div style={{...card, textAlign: "center", border: "1px solid rgba(240,192,64,0.35)", background: "rgba(240,192,64,0.08)"}}>
          <img src="/lms-trophy.png" alt="" width={140} height={140} style={{display: "block", margin: "0 auto 4px", borderRadius: 12}}/>
          <div style={{fontWeight: 800, fontSize: 20, color: "var(--gold)"}}>{winners.length > 1 ? "Joint winners" : "Last man standing"}</div>
          <div style={{fontSize: 18, fontWeight: 700, margin: "6px 0"}}>{winners.join(" & ") || "Nobody"}</div>
          {st.canManage ? (
            <div style={{marginTop: 12}}>
              <Btn gold disabled={busy || !gw || !before || gw.status !== "open"} onClick={() => act("lms_start", { p_group: gid })}>Start a new game</Btn>
              {(!gw || !before || gw.status !== "open") && <div style={{marginTop: 8, color: "var(--muted)", fontSize: 13}}>You can start the next game as soon as the next gameweek opens.</div>}
            </div>
          ) : <div style={{marginTop: 10, color: "var(--muted)", fontSize: 13}}>A new game starts as soon as the organiser kicks it off. Check back soon.</div>}
          {TIP_URL && (
            <a href={TIP_URL} target="_blank" rel="noopener noreferrer" style={{fontSize: 13, color: "var(--muted)", lineHeight: 1.5, display: "block", marginTop: 10}}>
              ☕ Enjoying The Gaffer? Chuck a tip in the jar if you fancy. Totally optional.
            </a>
          )}
        </div>
      )}

      {comp && running && (
        <>
          <div style={{...card, textAlign: "center"}}>
            <div style={{fontWeight: 700}}>{comp.name || "Last Man Standing"}</div>
            <div style={{fontSize: 13, color: "var(--muted)", marginTop: 2}}>Started in matchday {comp.startMatchday}</div>
          </div>

          {!mine && comp.joinOpen && <Btn gold disabled={busy} onClick={() => act("lms_join", { p_comp: comp.id })}>Join the game</Btn>}
          {!mine && !comp.joinOpen && <div style={{...card, textAlign: "center", color: "var(--muted)", fontSize: 14}}>Entries closed when the first gameweek locked. You can watch this one.</div>}

          {mine && mine.status === "out" && <div style={{...card, textAlign: "center", color: "var(--danger-text)", fontWeight: 600}}>You're out{mine.outMatchday ? ` (matchday ${mine.outMatchday})` : ""}. You can still follow the board.</div>}

          {gw && alive && (
            <div style={card}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8}}>
                <div style={{fontWeight: 700}}>Matchday {gw.matchday}</div>
                <div style={{fontSize: 13, color: before ? "var(--gold)" : "var(--red)", fontWeight: 600}}>
                  {!gwOpen ? "Settled" : before ? `Picks lock in ${fmtLeft(deadline - now)}` : "Picks locked"}
                </div>
              </div>
              {postponedMine && canPick && (
                <ErrorBox style={{marginBottom: 10, textAlign: "left", fontWeight: 700}} >⚠ Your game's postponed. Pick again now from a game that hasn't kicked off yet, or you're out.</ErrorBox>
              )}
              {gwOpen && !canPick && !myPickNow && <div style={{color: "var(--red)", fontSize: 13, marginBottom: 8}}>You didn't pick this gameweek.</div>}
              {!gwOpen && <div style={{color: "var(--muted)", fontSize: 13, marginBottom: 8}}>Waiting for the next gameweek to open.</div>}
              {myPickNow && !postponedMine && <div style={{fontSize: 13, color: "var(--green)", marginBottom: 8}}>Your pick: <b>{myPickNow.team}</b>{canPick && before ? ". You can change it until the deadline." : ""}</div>}
              <div style={{display: "flex", flexDirection: "column", gap: 8}}>
                {fixtures.map(f => {
                  const off = f.result === "postponed";
                  return (
                    <div key={f.matchId} style={{opacity: off ? 0.5 : 1}}>
                      <div style={{display: "flex", gap: 8, alignItems: "stretch"}}>
                        {[f.home, f.away].map((team, i) => {
                          const isUsed = used.has(team), isPick = !!myPickNow && myPickNow.team === team && !postponedMine;
                          const ok = pickable(f) && !isUsed && !busy;
                          return (
                            <button key={team} disabled={!ok} aria-pressed={isPick} aria-label={`${team}${isUsed ? " (already used)" : ""}${isPick ? " (your pick)" : ""}`}
                              onClick={() => act("lms_pick", { p_comp: comp.id, p_team: team })}
                              style={{flex: 1, minHeight: 44, padding: "8px 6px", borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: "inherit",
                                cursor: ok ? "pointer" : "default", color: isUsed || (!ok && !isPick) ? "var(--muted)" : "var(--text)",
                                background: isPick ? "rgba(52,211,153,0.16)" : "var(--surface2)",
                                border: isPick ? "2px solid var(--green)" : "1px solid var(--border)",
                                textDecoration: isUsed ? "line-through" : "none"}}>
                              {team}{i === 0 ? "" : ""}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 2}}>
                        {off ? "Postponed" : `${f.date} ${f.time}`}{f.result && !off ? ` · ${f.result === "draw" ? "Draw" : f.result === "home" ? `${f.home} won` : `${f.away} won`}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              {used.size > 0 && <div style={{fontSize: 12, color: "var(--muted)", marginTop: 10}}>Struck-through teams are already used. Your list resets once you've used every team.</div>}
            </div>
          )}
        </>
      )}

      {comp && stats.topStreak && (
        <div style={card}>
          <div style={{fontWeight: 700, marginBottom: 8}}>Bragging rights</div>
          <div style={{fontSize: 14, lineHeight: 1.7}}>
            <div>Longest streak: <b>{stats.topStreak.username}</b> with {stats.topStreak.best} win{stats.topStreak.best === 1 ? "" : "s"} in a row</div>
            {stats.topTeam && <div>Most picked team: <b>{stats.topTeam[0]}</b> ({stats.topTeam[1]} time{stats.topTeam[1] === 1 ? "" : "s"})</div>}
          </div>
        </div>
      )}

      {comp && (
        <div style={card}>
          <div style={{fontWeight: 700, marginBottom: 8}}>Still standing ({entries.filter(e => e.status === "alive").length})</div>
          {entries.filter(e => e.status === "alive").map(e => <Row key={e.username} e={e} gw={gw} open={open} setOpen={setOpen} AvatarBubble={AvatarBubble} showTick={running && gwOpen && before} live={running && gwOpen && !before ? gw : null} best={(stats.per.find(x => x.username === e.username) || {}).best}/>)}
          {entries.some(e => e.status === "out") && <div style={{fontWeight: 700, margin: "14px 0 8px", color: "var(--muted)"}}>Knocked out</div>}
          {entries.filter(e => e.status === "out").map(e => <Row key={e.username} e={e} gw={gw} open={open} setOpen={setOpen} AvatarBubble={AvatarBubble} out/>)}
          {!entries.length && <div style={{color: "var(--muted)", fontSize: 14}}>Nobody has joined yet.</div>}
        </div>
      )}
    </Screen>
  );
}

const PICK_STYLE = {
  win:       { c: "var(--green)",       bg: "rgba(52,211,153,0.14)", t: "" },
  out:       { c: "var(--danger-text)", bg: "rgba(248,113,113,0.14)", t: "" },
  pending:   { c: "var(--text)",        bg: "var(--surface2)", t: "" },
  postponed: { c: "var(--muted)",       bg: "var(--surface2)", t: "postponed" },
  none:      { c: "var(--danger-text)", bg: "rgba(248,113,113,0.14)", t: "No pick" },
};

function Row({ e, gw, open, setOpen, AvatarBubble, out, showTick, live, best }) {
  const ps = live ? pickState(e, live) : null;
  const isOpen = !!open[e.username];
  const picks = e.picks || [];
  return (
    <div style={{borderTop: "1px solid var(--border)"}}>
      <button onClick={() => setOpen(o => ({ ...o, [e.username]: !o[e.username] }))} aria-expanded={isOpen}
        style={{display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 0", background: "none", border: "none", color: "var(--text)", fontFamily: "inherit", fontSize: 15, cursor: "pointer", textAlign: "left"}}>
        <AvatarBubble emoji={e.avatar} color={e.avatarColor} initial={(e.username || "?")[0].toUpperCase()} size={28}/>
        <span style={{flex: 1, fontWeight: 600, opacity: out ? 0.75 : 1}}>{e.username}</span>
        {out && <span style={{fontSize: 12, color: "var(--muted)"}}>out in matchday {e.outMatchday}</span>}
        {showTick && e.pickedThisWeek && <span aria-label="picked this week" style={{color: "var(--green)", fontWeight: 800}}>✓</span>}
        {ps && (() => { const st = PICK_STYLE[ps.state]; return (
          <span aria-label={`${e.username}'s pick: ${ps.team || "none"}, ${ps.state}`} style={{fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: st.bg, color: st.c, whiteSpace: "nowrap"}}>
            {ps.state === "win" ? "✓ " : ps.state === "out" ? "✗ " : ""}{ps.team ? ps.team : st.t}{ps.team && st.t ? ` (${st.t})` : ""}
          </span>); })()}
        <span aria-hidden style={{color: "var(--muted)", fontSize: 12}}>{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div style={{padding: "0 0 10px 38px", fontSize: 13}}>
          {best > 0 && <div style={{color: "var(--gold)", marginBottom: 4}}>Best streak: {best}</div>}
          {picks.length ? picks.map(p => {
            const o = p.outcome ? OUTCOME[p.outcome] : null;
            return (
              <div key={p.gameweek} style={{display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0"}}>
                <span style={{color: "var(--muted)"}}>MD {p.matchday}</span>
                <span style={{flex: 1, textAlign: "left", marginLeft: 10}}>{p.team || "No pick"}</span>
                <span style={{color: o ? o.c : "var(--muted)", fontWeight: 600}}>{o ? o.t : "Pending"}</span>
              </div>
            );
          }) : <div style={{color: "var(--muted)"}}>No picks to show yet.</div>}
        </div>
      )}
    </div>
  );
}
