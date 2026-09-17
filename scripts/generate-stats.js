// Generates assets/generated/stats.svg from live GitHub data.
// In GitHub Actions: GH_TOKEN + GH_USER are set by .github/workflows/stats.yml.
// Locally without a token it falls back to the public REST API (no contribution calendar).
const fs = require("fs");
const path = require("path");

const USER = process.env.GH_USER || "fasilfaz";
const TOKEN = process.env.GH_TOKEN;
const OUT = path.join(__dirname, "..", "assets", "generated", "stats.svg");
const WEEKS = 38;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

async function fromGraphQL() {
  const query = `query($login:String!){
    user(login:$login){
      followers{totalCount}
      repositories(ownerAffiliations:OWNER,isFork:false,first:100,orderBy:{field:STARGAZERS,direction:DESC}){
        totalCount
        nodes{ stargazerCount languages(first:10,orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } }
      }
      contributionsCollection{
        contributionCalendar{ totalContributions weeks{ contributionDays{ contributionCount } } }
      }
    }}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const u = json.data.user;
  const langs = {};
  for (const repo of u.repositories.nodes) {
    for (const e of repo.languages.edges) {
      langs[e.node.name] ??= { size: 0, color: e.node.color || "#94a3b8" };
      langs[e.node.name].size += e.size;
    }
  }
  const cal = u.contributionsCollection.contributionCalendar;
  return {
    repos: u.repositories.totalCount,
    stars: u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
    followers: u.followers.totalCount,
    contributions: cal.totalContributions,
    langs,
    weeks: cal.weeks.slice(-WEEKS).map((w) => w.contributionDays.map((d) => d.contributionCount)),
  };
}

async function fromREST() {
  const get = (url) => fetch(url, { headers: { "User-Agent": "stats-script" } }).then((r) => r.json());
  const user = await get(`https://api.github.com/users/${USER}`);
  const repos = (await get(`https://api.github.com/users/${USER}/repos?per_page=100&type=owner`)).filter((r) => !r.fork);
  const palette = { JavaScript: "#f1e05a", TypeScript: "#3178c6", HTML: "#e34c26", CSS: "#663399", Python: "#3572A5", Dart: "#00B4AB", "C++": "#f34b7d", SCSS: "#c6538c", Java: "#b07219", PHP: "#4F5D95" };
  const langs = {};
  for (const r of repos) {
    if (!r.language) continue;
    langs[r.language] ??= { size: 0, color: palette[r.language] || "#94a3b8" };
    langs[r.language].size += 1;
  }
  return {
    repos: repos.length,
    stars: repos.reduce((s, r) => s + r.stargazers_count, 0),
    followers: user.followers,
    contributions: null,
    langs,
    weeks: null,
  };
}

function render(d) {
  const tiles = [
    ["Contributions (1y)", d.contributions == null ? "—" : fmt(d.contributions)],
    ["Public Repositories", fmt(d.repos)],
    ["Stars Earned", fmt(d.stars)],
    ["Followers", fmt(d.followers)],
  ];
  const tileW = 273, gap = 14;
  const tileSvg = tiles.map(([label, value], i) => {
    const x = 32 + i * (tileW + gap);
    return `<g transform="translate(${x} 66)"><g class="in" style="animation-delay:${0.1 + i * 0.12}s">
      <rect width="${tileW}" height="96" rx="16" fill="#ffffff" fill-opacity=".04" stroke="#ffffff" stroke-opacity=".1"/>
      <text x="20" y="50" font-size="34" font-weight="800" fill="url(#accent)">${esc(value)}</text>
      <text x="20" y="76" font-size="14" fill="#94a3b8">${esc(label)}</text>
    </g></g>`;
  }).join("\n");

  // Contribution heatmap
  let heat;
  if (d.weeks) {
    const max = Math.max(1, ...d.weeks.flat());
    const levels = ["#1e293b", "#155e75", "#0891b2", "#7c3aed", "#c026d3"];
    const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));
    heat = d.weeks.map((week, wi) => week.map((c, di) =>
      `<rect class="cell" style="animation-delay:${(wi * 0.03).toFixed(2)}s" x="${32 + wi * 18}" y="${222 + di * 18}" width="14" height="14" rx="3" fill="${levels[level(c)]}"/>`
    ).join("")).join("\n");
  } else {
    heat = `<text x="32" y="290" font-size="15" fill="#64748b">Contribution graph appears after the GitHub Action runs.</text>`;
  }

  // Languages
  const entries = Object.entries(d.langs).sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const total = entries.reduce((s, [, v]) => s + v.size, 0) || 1;
  const barX = 760, barW = 408;
  let cursor = barX;
  const bar = entries.map(([, v], i) => {
    const w = (v.size / total) * barW;
    const r = `<rect class="grow" style="animation-delay:${0.3 + i * 0.1}s" x="${cursor.toFixed(1)}" y="222" width="${Math.max(w, 1).toFixed(1)}" height="12" fill="${v.color}"/>`;
    cursor += w;
    return r;
  }).join("");
  const list = entries.map(([name, v], i) => {
    const x = barX + (i % 2) * 210, y = 272 + Math.floor(i / 2) * 30;
    return `<g class="in" style="animation-delay:${0.4 + i * 0.08}s"><circle cx="${x + 6}" cy="${y - 5}" r="6" fill="${v.color}"/><text x="${x + 20}" y="${y}" font-size="15" fill="#e2e8f0">${esc(name)} <tspan fill="#64748b">${((v.size / total) * 100).toFixed(1)}%</tspan></text></g>`;
  }).join("\n");

  const updated = new Date().toISOString().slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="380" viewBox="0 0 1200 380" role="img" aria-label="GitHub stats for ${esc(USER)}">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22d3ee"/><stop offset=".5" stop-color="#a855f7"/><stop offset="1" stop-color="#ec4899"/></linearGradient>
    <clipPath id="bar"><rect x="${barX}" y="222" width="${barW}" height="12" rx="6"/></clipPath>
  </defs>
  <style>
    text{font-family:'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif}
    .mono{font-family:'JetBrains Mono',Consolas,'SF Mono',Menlo,'Courier New',monospace}
    .in{opacity:0;animation:in .8s cubic-bezier(.2,.8,.2,1) forwards}
    @keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
    .cell{opacity:0;animation:pop .4s ease-out forwards}
    @keyframes pop{to{opacity:1}}
    .grow{transform-box:fill-box;transform-origin:left center;transform:scaleX(0);animation:grow .8s cubic-bezier(.2,.8,.2,1) forwards}
    @keyframes grow{to{transform:scaleX(1)}}
  </style>
  <rect width="1200" height="380" rx="24" fill="#0f172a"/>
  <rect x=".5" y=".5" width="1199" height="379" rx="24" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
  <text x="32" y="44" font-size="20" font-weight="700" fill="#f8fafc">GitHub Overview</text>
  <text class="mono" x="1168" y="44" text-anchor="end" font-size="13" fill="#64748b">@${esc(USER)} · updated ${updated}</text>
  ${tileSvg}
  <text x="32" y="206" font-size="14" fill="#94a3b8">Contributions · last ${WEEKS} weeks</text>
  ${heat}
  <text x="${barX}" y="206" font-size="14" fill="#94a3b8">Top Languages</text>
  <rect x="${barX}" y="222" width="${barW}" height="12" rx="6" fill="#1e293b"/>
  <g clip-path="url(#bar)">${bar}</g>
  ${list}
</svg>
`;
}

(async () => {
  const data = TOKEN ? await fromGraphQL() : await fromREST();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render(data));
  console.log(`Wrote ${OUT}`, { ...data, langs: Object.keys(data.langs), weeks: data.weeks ? data.weeks.length : null });
})().catch((e) => { console.error(e); process.exit(1); });
