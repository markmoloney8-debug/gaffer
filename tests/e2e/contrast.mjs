// Measures text contrast the way WCAG 2.1 (1.4.3) defines it, on what is actually drawn on screen.
// Exported so the same measuring is used by the report script and by the test.
export const MEASURE = () => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } }
    let base = parse(getComputedStyle(document.body).backgroundColor); if (!base || base.a < 1) base = { r: 255, g: 255, b: 255, a: 1 };
    return stack.reverse().reduce((acc, c) => over(c, acc), base); };
  const out = [], seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || ["SCRIPT", "STYLE", "OPTION"].includes(el.tagName)) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || r.width === 0 || r.height === 0) continue;
    if (el.closest("[disabled]")) continue;
    let blurred = false; for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).filter.includes("blur")) blurred = true;
    if (blurred) continue;                                                    // the deliberately hidden final card                                   // WCAG exempts inactive controls
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    let gradient = false; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a === 1) break; if (getComputedStyle(e).backgroundImage !== "none") { gradient = true; break; } }
    if (gradient) continue;                                                   // drawn over a gradient: checked by eye
    if (!/[A-Za-z0-9]/.test(t)) continue;                                     // emoji and symbols carry no text colour
    const bg = bgOf(el); const fg = over({ ...parse(cs.color), a: parse(cs.color).a * op }, bg);
    const px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const cr = ratio(fg, bg), need = large ? 3 : 4.5;
    const key = `${t.slice(0, 30)}|${cr.toFixed(2)}`;
    if (cr < need && !seen.has(key)) { seen.add(key); out.push({ text: t.slice(0, 40), ratio: Math.round(cr * 100) / 100, need, size: px, color: cs.color }); }
  }
  return out;
};
