// logic.js
// Pure game logic, kept out of App.jsx so it can be unit tested.

// ─── Kickoff deadline helpers ─────────────────────────────────────────────────
export function deadlineTs(fixtures) {
  const tss = (fixtures||[]).map(f=>f.kickoffTs).filter(Boolean);
  if (!tss.length) return null;
  return Math.min(...tss) - 60_000;
}
export function isDeadlinePassed(fixtures, now = Date.now()) {
  const d = deadlineTs(fixtures);
  return d !== null && now >= d;
}
export function msUntilDeadline(fixtures, now = Date.now()) {
  const d = deadlineTs(fixtures);
  if (d === null) return null;
  return Math.max(0, d - now);
}
export function fmtCountdown(ms) {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms/1000);
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60), sec = s%60;
  const hms = [h,m,sec].map(n=>String(n).padStart(2,"0")).join(":");
  return d > 0 ? `${d}d ${hms}` : hms;      // "9d 16:16:33" once there is a day or more to go
}


// ─── Scoring helpers ──────────────────────────────────────────────────────────
// A void fixture counts as correct for everyone.
export function hit(entry, r, i) {
  return r.result==="void" || entry.preds[String(i)]===r.result || entry.preds[i]===r.result;
}
export function isPerfect(entry, results) {
  if (!results||results.some(r=>r.result==="upcoming")) return false;
  return results.every((r,i)=>hit(entry,r,i));
}
export function scoreEntry(entry, results) {
  if (!results) return { correct:0, total:0 };
  let correct=0, total=0;
  results.forEach((r,i)=>{
    if (r.result==="upcoming") return;
    total++;
    if (hit(entry,r,i)) correct++;
  });
  return { correct, total };
}
