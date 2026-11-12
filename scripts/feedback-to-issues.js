// feedback-to-issues.js
// Run hourly by GitHub Actions. Turns new in-app feedback into GitHub issues, so GitHub
// emails you about each one and you get a backlog. Needs GITHUB_TOKEN (provided by Actions)
// and GITHUB_REPOSITORY (owner/name, also provided by Actions). Requires Node 18+.

let cfg = {};
try { cfg = require("./config.js"); } catch (e) { /* env vars only */ }
const SB_URL = process.env.SB_URL || cfg.SB_URL;
const SB_KEY = process.env.SB_KEY || cfg.SB_KEY;
// New-style secret keys (sb_secret_...) go in apikey only; older JWT keys also need the Authorization header.
const AUTHZ = String(SB_KEY || "").startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` };
const MAX_PER_RUN = 20;

const LABELS = { bug: "bug", idea: "enhancement", other: "feedback" };
const NAMES  = { bug: "Bug", idea: "Idea", other: "Other" };

// Feedback is written by players, so make it safe to paste into GitHub: no @mentions that
// would ping real people, and nothing that can break out of the code block.
function clean(s) {
  return String(s ?? "").replace(/@/g, "@​").replace(/```/g, "`​``");
}

function formatIssue(row, groupName) {
  const category = LABELS[row.category] ? row.category : "other";
  const oneLine = clean(row.message).replace(/\s+/g, " ").trim();
  const title = `[${NAMES[category]}] ${oneLine.length > 60 ? oneLine.slice(0, 57) + "..." : oneLine}`;
  const from = `${clean(row.username)}${groupName ? ` (${clean(groupName)})` : ""}`;
  const body = [
    `**From:** ${from}`,
    `**Sent:** ${row.created_at || "unknown"}`,
    "",
    "```",
    clean(row.message),
    "```",
    "",
    "_Created automatically from in-app feedback._",
  ].join("\n");
  return { title, body, labels: [LABELS[category], "from-app"] };
}

async function sb(method, path, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: SB_KEY, ...AUTHZ, Prefer: "return=minimal" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!SB_URL || !SB_KEY || !token || !repo) throw new Error("missing SB_URL / SB_KEY / GITHUB_TOKEN / GITHUB_REPOSITORY");

  const rows = await sb("GET", `feedback?issue_url=is.null&status=eq.new&order=created_at.asc&limit=${MAX_PER_RUN}`);
  if (!rows.length) { console.log("No new feedback."); return 0; }
  const groups = await sb("GET", "groups?select=id,name");
  const nameOf = id => (groups.find(g => g.id === id) || {}).name;

  let failures = 0;
  for (const row of rows) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
        body: JSON.stringify(formatIssue(row, nameOf(row.group_id))),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
      const issue = await res.json();
      await sb("PATCH", `feedback?id=eq.${row.id}`, { status: "sent", issue_url: issue.html_url });
      console.log(`Created ${issue.html_url}`);
    } catch (e) {
      failures++;
      console.error(`Feedback ${row.id}: ${e.message}`);
    }
  }
  return failures;
}

module.exports = { formatIssue, clean, main };

if (require.main === module) {
  main().then(f => process.exit(f ? 1 : 0)).catch(e => { console.error("ERROR:", e.message); process.exit(1); });
}
