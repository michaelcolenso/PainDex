import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import { clusters } from "../db/schema";

export const review = new Hono<{ Bindings: Env }>();

interface ClusterRow {
  id: number;
  label: string;
  postCount: number;
  velocity30d: number | null;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  avgIntent: number | null;
  opportunityScore: number | null;
  status: string;
  firstSeen: string;
  lastSeen: string;
  notes: string | null;
  subs: string;
}

review.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(clusters).orderBy(desc(clusters.opportunityScore)).all();
  const { results: subsByCluster } = await c.env.DB.prepare(
    `SELECT cluster_id AS clusterId, GROUP_CONCAT(DISTINCT subreddit) AS subs
     FROM posts WHERE cluster_id IS NOT NULL GROUP BY cluster_id`,
  ).all<{ clusterId: number; subs: string }>();
  const subsMap = new Map(subsByCluster.map((r) => [r.clusterId, r.subs ?? ""]));

  const data: ClusterRow[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    postCount: r.postCount,
    velocity30d: r.velocity30d,
    volume: r.volume,
    kd: r.kd,
    cpc: r.cpc,
    avgIntent: r.avgIntent,
    opportunityScore: r.opportunityScore,
    status: r.status,
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    notes: r.notes,
    subs: subsMap.get(r.id) ?? "",
  }));

  return c.html(renderPage(data, c.req.query("token") ?? ""));
});

function esc(value: string | number | null): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] ?? ch));
}

function fmt(value: number | null, digits = 0): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function renderRow(row: ClusterRow): string {
  const score = row.opportunityScore ?? 0;
  const unpriced = (row.volume ?? 0) === 0 && row.postCount >= 8;
  const subs = row.subs.split(",").filter(Boolean).map((s) => `r/${esc(s)}`).join(" · ");
  return `<button class="opp-row" type="button"
    data-id="${row.id}" data-status="${esc(row.status)}" data-score="${score}"
    data-unpriced="${unpriced}" data-search="${esc(`${row.label} ${row.subs}`.toLowerCase())}">
    <span class="score-ring">${fmt(row.opportunityScore, 0)}</span>
    <span class="opp-main">
      <span class="opp-top"><strong>${esc(row.label)}</strong><span class="status-pill status-${esc(row.status)}">${esc(row.status)}</span></span>
      <span class="subs">${subs || "No subreddit source"}</span>
      <span class="metrics">
        <span><em>Pain</em>${row.postCount} posts</span>
        <span><em>Velocity</em>${fmt(row.velocity30d, 1)}×</span>
        <span><em>Search</em>${row.volume === null ? "—" : row.volume === 0 ? "No volume" : row.volume.toLocaleString()}</span>
        <span><em>Difficulty</em>${row.kd === null ? "—" : `KD ${row.kd}`}</span>
        <span><em>Intent</em>${fmt(row.avgIntent, 1)}/10</span>
      </span>
      <span class="score-track"><i style="width:${Math.max(0, Math.min(100, score))}%"></i></span>
    </span>
  </button>`;
}

function renderPage(data: ClusterRow[], token: string): string {
  const newCount = data.filter((r) => r.status === "new").length;
  const strongCount = data.filter((r) => (r.opportunityScore ?? 0) >= 70 && r.status !== "killed").length;
  const pursueCount = data.filter((r) => r.status === "pursue").length;
  const unpricedCount = data.filter((r) => (r.volume ?? 0) === 0 && r.postCount >= 8 && r.status !== "killed").length;
  const serialized = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<title>PainDex · Opportunity Console</title>
<style>
:root{--bg:#0b0d10;--panel:#12151a;--panel2:#171b21;--line:#282d35;--text:#f3f5f7;--muted:#929aa6;--accent:#e7ff57;--accentText:#121500;--good:#65d38e;--warn:#ffca58;--bad:#ff7272;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:14px}.shell{max-width:1480px;margin:auto;padding:26px}.eyebrow{font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;color:var(--accent)}h1{font-size:26px;letter-spacing:-.035em;margin:8px 0 4px}p{color:var(--muted);margin:0}.header{display:flex;justify-content:space-between;gap:20px;align-items:end}.header-actions{display:flex;gap:8px}.btn,.filter{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:9px;padding:9px 12px;cursor:pointer;font:inherit}.btn:hover,.filter:hover{border-color:#4b535e}.btn-primary{background:var(--accent);color:var(--accentText);border-color:var(--accent);font-weight:700}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}.kpi label{display:block;color:var(--muted);font-size:12px}.kpi strong{display:block;font-size:27px;letter-spacing:-.04em;margin:3px 0}.kpi small{color:var(--muted)}.toolbar{display:flex;gap:10px;align-items:center;margin:0 0 12px}.search{flex:1;min-width:220px;border:1px solid var(--line);background:var(--panel);color:var(--text);padding:11px 12px;border-radius:10px;font:inherit;outline:none}.search:focus{border-color:var(--accent)}.filters{display:flex;gap:6px;flex-wrap:wrap}.filter.active{background:#2a2e1c;border-color:#68712c;color:var(--accent)}.queue-head{display:flex;justify-content:space-between;margin:18px 2px 8px}.queue-head span{color:var(--muted)}.queue{display:grid;gap:7px}.opp-row{display:flex;width:100%;gap:14px;text-align:left;border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:14px;color:inherit;cursor:pointer}.opp-row:hover{background:var(--panel2);border-color:#424953}.opp-row.hidden{display:none}.score-ring{width:48px;height:48px;border:3px solid var(--accent);border-radius:50%;display:grid;place-items:center;flex:none;font:700 15px ui-monospace,SFMono-Regular,Menlo,monospace}.opp-main{min-width:0;flex:1}.opp-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.opp-top strong{font-size:15px}.subs{display:block;color:var(--muted);font-size:12px;margin-top:4px}.metrics{display:grid;grid-template-columns:repeat(5,minmax(90px,1fr));gap:16px;margin-top:13px}.metrics span{font-variant-numeric:tabular-nums}.metrics em{display:block;color:var(--muted);font-size:10px;font-style:normal;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}.score-track{height:3px;background:#252a31;border-radius:4px;display:block;margin-top:11px;overflow:hidden}.score-track i{height:100%;display:block;background:var(--accent)}.status-pill{font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;border:1px solid var(--line);padding:4px 7px;border-radius:999px;color:var(--muted)}.status-pursue{color:var(--good);border-color:#315940}.status-watching{color:var(--warn);border-color:#5f512b}.status-killed{color:var(--bad);border-color:#603535}.drawer-backdrop{position:fixed;inset:0;background:#0009;display:none;z-index:20}.drawer-backdrop.open{display:block}.drawer{position:fixed;right:0;top:0;height:100vh;width:min(720px,94vw);background:#0f1216;border-left:1px solid var(--line);transform:translateX(100%);transition:transform .18s ease;z-index:21;overflow:auto}.drawer.open{transform:none}.drawer-inner{padding:24px}.drawer-head{display:flex;gap:12px;justify-content:space-between}.drawer h2{font-size:23px;line-height:1.15;letter-spacing:-.03em;margin:12px 0 7px}.detail-meta{color:var(--muted);font-size:12px}.detail-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:18px 0}.detail-stat{border:1px solid var(--line);border-radius:10px;padding:10px}.detail-stat label{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.detail-stat strong{display:block;margin-top:5px;font-size:15px}.section{border-top:1px solid var(--line);padding-top:18px;margin-top:18px}.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.section-title h3{font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin:0}.evidence{display:grid;gap:7px}.post{border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:11px}.post a{color:var(--text);text-decoration:none;font-weight:600}.post a:hover{text-decoration:underline}.post-meta{color:var(--muted);font-size:11px;margin-bottom:5px}.post p{font-size:12px;line-height:1.5;margin-top:6px}.notes{width:100%;min-height:88px;resize:vertical;background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:10px;font:inherit}.action-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:9px}.status-actions{display:flex;gap:6px}.analysis{display:none}.analysis.visible{display:block}.analysis-summary{font-size:14px;line-height:1.55;color:#d8dde4}.idea-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:12px 0}.idea{border:1px solid var(--line);border-radius:9px;padding:10px;background:var(--panel)}.idea strong{display:block;margin-bottom:5px}.idea span{font-size:12px;color:var(--muted);line-height:1.4}.analysis-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.analysis-cols h4{font-size:12px;margin:6px 0}.analysis-cols ol,.analysis-cols ul{margin:0;padding-left:18px;color:#d3d8df;line-height:1.55}.verdict{display:inline-block;margin-top:12px;color:var(--accent);font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.empty{padding:36px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:12px}.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#20252c;border:1px solid #3b424c;border-radius:999px;padding:9px 14px;display:none;z-index:40}.toast.show{display:block}@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.toolbar{align-items:stretch;flex-direction:column}.metrics{grid-template-columns:repeat(3,1fr)}.detail-grid{grid-template-columns:repeat(3,1fr)}.idea-grid{grid-template-columns:1fr}.analysis-cols{grid-template-columns:1fr}}@media(max-width:560px){.shell{padding:18px 12px}.header{align-items:start;flex-direction:column}.header-actions{width:100%}.header-actions .btn{flex:1}.kpis{grid-template-columns:repeat(2,1fr)}.metrics{grid-template-columns:repeat(2,1fr);gap:10px}.score-ring{width:42px;height:42px}.opp-row{padding:12px;gap:10px}.detail-grid{grid-template-columns:repeat(2,1fr)}.drawer-inner{padding:18px}.action-row{align-items:stretch;flex-direction:column}.status-actions .btn{flex:1}}
</style>
</head>
<body>
<main class="shell">
  <header class="header">
    <div><div class="eyebrow">PAIN INDEX</div><h1>Opportunity queue</h1><p>Repeated problems ranked by commercial signal.</p></div>
    <div class="header-actions"><button id="focus" class="btn">Focus: off</button><button id="sort" class="btn">Score ↓</button></div>
  </header>
  <section class="kpis">
    <div class="kpi"><label>New signals</label><strong>${newCount}</strong><small>awaiting review</small></div>
    <div class="kpi"><label>Strong leads</label><strong>${strongCount}</strong><small>score ≥ 70</small></div>
    <div class="kpi"><label>Pursuing</label><strong>${pursueCount}</strong><small>active bets</small></div>
    <div class="kpi"><label>Unpriced pain</label><strong>${unpricedCount}</strong><small>8+ posts · zero volume</small></div>
  </section>
  <section class="toolbar">
    <input id="search" class="search" type="search" placeholder="Search pain, subreddit, market…" />
    <div id="filters" class="filters">
      <button class="filter active" data-filter="all">All</button><button class="filter" data-filter="new">New</button><button class="filter" data-filter="watching">Watching</button><button class="filter" data-filter="pursue">Pursue</button><button class="filter" data-filter="unpriced">Unpriced pain</button>
    </div>
  </section>
  <div class="queue-head"><strong>Ranked opportunities</strong><span id="shown">${data.length} shown</span></div>
  <section id="queue" class="queue">${data.map(renderRow).join("\n")}</section>
  <div id="empty" class="empty" style="display:none">No opportunities match this view.</div>
</main>
<div id="backdrop" class="drawer-backdrop"></div>
<aside id="drawer" class="drawer" aria-label="Opportunity detail">
  <div class="drawer-inner">
    <div class="drawer-head"><div><span id="detailScore" class="status-pill"></span><span id="detailStatus" class="status-pill"></span></div><button id="close" class="btn">Close</button></div>
    <h2 id="detailTitle"></h2><div id="detailMeta" class="detail-meta"></div>
    <div class="detail-grid"><div class="detail-stat"><label>Posts</label><strong id="sPosts"></strong></div><div class="detail-stat"><label>Velocity</label><strong id="sVelocity"></strong></div><div class="detail-stat"><label>Volume</label><strong id="sVolume"></strong></div><div class="detail-stat"><label>KD</label><strong id="sKd"></strong></div><div class="detail-stat"><label>Intent</label><strong id="sIntent"></strong></div></div>
    <section class="section"><div class="section-title"><h3>Evidence</h3><span id="postCount" class="detail-meta"></span></div><div id="posts" class="evidence">Loading…</div></section>
    <section class="section"><div class="section-title"><h3>AI opportunity analysis</h3><button id="analyze" class="btn btn-primary">Analyze opportunity</button></div><div id="analysisEmpty" class="detail-meta">On-demand analysis uses the cluster metrics and recent post evidence to propose product angles and a validation plan.</div><div id="analysis" class="analysis"><div id="why" class="analysis-summary"></div><div id="ideas" class="idea-grid"></div><div class="analysis-cols"><div><h4>Validation plan</h4><ol id="validation"></ol></div><div><h4>Risks</h4><ul id="risks"></ul></div></div><span id="verdict" class="verdict"></span></div></section>
    <section class="section"><div class="section-title"><h3>Analyst notes</h3></div><textarea id="notes" class="notes" placeholder="Product angle, caveat, next experiment…"></textarea><div class="action-row"><button id="save" class="btn">Save notes</button><div class="status-actions"><button class="btn" data-status-action="killed">Kill</button><button class="btn" data-status-action="watching">Watch</button><button class="btn btn-primary" data-status-action="pursue">Pursue</button></div></div></section>
  </div>
</aside>
<div id="toast" class="toast"></div>
<script id="cluster-data" type="application/json">${serialized}</script>
<script>
(function(){
  var TOKEN=${JSON.stringify(token)};
  var data=JSON.parse(document.getElementById('cluster-data').textContent);
  var rows=Array.prototype.slice.call(document.querySelectorAll('.opp-row'));
  var activeFilter='all', focus=false, descSort=true, current=null;
  var drawer=document.getElementById('drawer'), backdrop=document.getElementById('backdrop');
  function api(path,options){options=options||{};options.headers=Object.assign({'x-review-token':TOKEN,'content-type':'application/json'},options.headers||{});return fetch(path,options)}
  function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},1800)}
  function apply(){var q=document.getElementById('search').value.trim().toLowerCase();var shown=0;rows.forEach(function(r){var okSearch=!q||r.dataset.search.indexOf(q)>-1;var okFilter=activeFilter==='all'||r.dataset.status===activeFilter||(activeFilter==='unpriced'&&r.dataset.unpriced==='true');var okFocus=!focus||Number(r.dataset.score)>=70;var show=okSearch&&okFilter&&okFocus;r.classList.toggle('hidden',!show);if(show)shown++});document.getElementById('shown').textContent=shown+' shown';document.getElementById('empty').style.display=shown?'none':'block'}
  function sortRows(){rows.sort(function(a,b){return (Number(a.dataset.score)-Number(b.dataset.score))*(descSort?-1:1)});var q=document.getElementById('queue');rows.forEach(function(r){q.appendChild(r)})}
  function item(id){return data.find(function(x){return x.id===Number(id)})}
  function fmt(v,d){return v===null||v===undefined?'—':Number(v).toFixed(d||0)}
  function openDetail(id){current=item(id);if(!current)return;document.getElementById('detailScore').textContent='PAINDEX '+fmt(current.opportunityScore);document.getElementById('detailStatus').textContent=current.status.toUpperCase();document.getElementById('detailTitle').textContent=current.label;document.getElementById('detailMeta').textContent=(current.subs?current.subs.split(',').map(function(s){return 'r/'+s}).join(' · ')+' · ':'')+'first seen '+current.firstSeen.slice(0,10);document.getElementById('sPosts').textContent=current.postCount;document.getElementById('sVelocity').textContent=fmt(current.velocity30d,1)+'×';document.getElementById('sVolume').textContent=current.volume===null?'—':Number(current.volume).toLocaleString();document.getElementById('sKd').textContent=current.kd===null?'—':current.kd;document.getElementById('sIntent').textContent=fmt(current.avgIntent,1)+'/10';document.getElementById('notes').value=current.notes||'';document.getElementById('analysis').classList.remove('visible');document.getElementById('analysisEmpty').style.display='block';document.getElementById('posts').textContent='Loading…';drawer.classList.add('open');backdrop.classList.add('open');loadPosts(current.id)}
  function close(){drawer.classList.remove('open');backdrop.classList.remove('open');current=null}
  function loadPosts(id){api('/api/clusters/'+id+'/posts').then(function(r){if(!r.ok)throw new Error();return r.json()}).then(function(posts){document.getElementById('postCount').textContent=posts.length+' recent';var box=document.getElementById('posts');box.innerHTML='';if(!posts.length){box.textContent='No supporting posts stored.';return}posts.forEach(function(p){var el=document.createElement('article');el.className='post';var meta=document.createElement('div');meta.className='post-meta';meta.textContent='r/'+p.subreddit+(p.painCategory?' · '+p.painCategory:'')+(p.commercialIntent!==null?' · intent '+p.commercialIntent+'/10':'');var a=document.createElement('a');a.href=p.permalink;a.target='_blank';a.rel='noopener noreferrer';a.textContent=p.title;el.appendChild(meta);el.appendChild(a);if(p.excerpt){var para=document.createElement('p');para.textContent=p.excerpt;el.appendChild(para)}box.appendChild(el)})}).catch(function(){document.getElementById('posts').textContent='Could not load supporting posts.'})}
  function setStatus(status){if(!current)return;api('/api/clusters/'+current.id+'/status',{method:'POST',body:JSON.stringify({status:status})}).then(function(r){if(!r.ok)throw new Error();current.status=status;var row=rows.find(function(x){return Number(x.dataset.id)===current.id});row.dataset.status=status;var pill=row.querySelector('.status-pill');pill.textContent=status;pill.className='status-pill status-'+status;document.getElementById('detailStatus').textContent=status.toUpperCase();apply();toast('Status updated')}).catch(function(){toast('Status update failed')})}
  function saveNotes(){if(!current)return;var notes=document.getElementById('notes').value;api('/api/clusters/'+current.id,{method:'POST',body:JSON.stringify({notes:notes})}).then(function(r){if(!r.ok)throw new Error();current.notes=notes;toast('Notes saved')}).catch(function(){toast('Save failed')})}
  function analyze(){if(!current)return;var btn=document.getElementById('analyze');btn.disabled=true;btn.textContent='Analyzing…';api('/api/clusters/'+current.id+'/analyze',{method:'POST',body:'{}'}).then(function(r){if(!r.ok)throw new Error();return r.json()}).then(function(a){document.getElementById('analysisEmpty').style.display='none';document.getElementById('analysis').classList.add('visible');document.getElementById('why').textContent=a.whyItMatters;var ideas=document.getElementById('ideas');ideas.innerHTML='';a.productIdeas.forEach(function(x){var d=document.createElement('div');d.className='idea';var s=document.createElement('strong');s.textContent=x.name;var p=document.createElement('span');p.textContent=x.angle;d.appendChild(s);d.appendChild(p);ideas.appendChild(d)});var validation=document.getElementById('validation');validation.innerHTML='';a.validationPlan.forEach(function(x){var li=document.createElement('li');li.textContent=x;validation.appendChild(li)});var risks=document.getElementById('risks');risks.innerHTML='';a.risks.forEach(function(x){var li=document.createElement('li');li.textContent=x;risks.appendChild(li)});document.getElementById('verdict').textContent='Model verdict · '+a.verdict;btn.textContent='Re-analyze'}).catch(function(){toast('Analysis failed');btn.textContent='Analyze opportunity'}).finally(function(){btn.disabled=false})}
  document.getElementById('filters').addEventListener('click',function(e){var b=e.target.closest('[data-filter]');if(!b)return;document.querySelectorAll('[data-filter]').forEach(function(x){x.classList.remove('active')});b.classList.add('active');activeFilter=b.dataset.filter;apply()});
  document.getElementById('search').addEventListener('input',apply);document.getElementById('focus').addEventListener('click',function(e){focus=!focus;e.currentTarget.textContent=focus?'Focus: 70+':'Focus: off';apply()});document.getElementById('sort').addEventListener('click',function(e){descSort=!descSort;e.currentTarget.textContent=descSort?'Score ↓':'Score ↑';sortRows();apply()});rows.forEach(function(r){r.addEventListener('click',function(){openDetail(r.dataset.id)})});document.getElementById('close').addEventListener('click',close);backdrop.addEventListener('click',close);document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});document.getElementById('save').addEventListener('click',saveNotes);document.querySelectorAll('[data-status-action]').forEach(function(b){b.addEventListener('click',function(){setStatus(b.dataset.statusAction)})});document.getElementById('analyze').addEventListener('click',analyze);
})();
</script>
</body></html>`;
}
