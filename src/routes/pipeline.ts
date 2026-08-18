import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { clusters, opportunities } from "../db/schema";
import type { Env } from "../types";

export const pipeline = new Hono<{ Bindings: Env }>();

pipeline.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: opportunities.id,
      clusterId: opportunities.clusterId,
      stage: opportunities.stage,
      owner: opportunities.owner,
      thesis: opportunities.thesis,
      nextAction: opportunities.nextAction,
      nextActionDueAt: opportunities.nextActionDueAt,
      updatedAt: opportunities.updatedAt,
      label: clusters.label,
      score: clusters.opportunityScore,
      postCount: clusters.postCount,
      velocity: clusters.velocity30d,
      volume: clusters.volume,
    })
    .from(opportunities)
    .innerJoin(clusters, eq(opportunities.clusterId, clusters.id))
    .orderBy(desc(clusters.opportunityScore))
    .all();

  return c.html(render(rows, c.req.query("token") ?? ""));
});

type Row = {
  id: number;
  clusterId: number;
  stage: string;
  owner: string | null;
  thesis: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  updatedAt: string;
  label: string;
  score: number | null;
  postCount: number;
  velocity: number | null;
  volume: number | null;
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] ?? ch));
}

function card(row: Row): string {
  return `<button class="card" data-id="${row.id}" data-stage="${esc(row.stage)}" type="button">
    <div class="card-top"><span class="score">${row.score === null ? "—" : Math.round(row.score)}</span><span class="velocity">${row.velocity === null ? "—" : row.velocity.toFixed(1) + "×"}</span></div>
    <strong>${esc(row.label)}</strong>
    <div class="meta">${row.postCount} posts${row.volume === null ? "" : ` · ${row.volume.toLocaleString()} searches/mo`}</div>
    <div class="next"><span>NEXT</span>${esc(row.nextAction || "Define next action")}</div>
    ${row.nextActionDueAt ? `<div class="due">Due ${esc(row.nextActionDueAt.slice(0, 10))}</div>` : ""}
  </button>`;
}

function render(rows: Row[], token: string): string {
  const data = JSON.stringify(rows).replace(/</g, "\\u003c");
  const activeStages = ["new", "watching", "validating", "pursue", "building", "launched"];
  const stageLabels: Record<string, string> = {
    new: "New", watching: "Watching", validating: "Validating", pursue: "Pursue", building: "Building", launched: "Launched",
  };
  const columns = activeStages.map((stage) => {
    const items = rows.filter((row) => row.stage === stage);
    return `<section class="column" data-column="${stage}">
      <header><span>${stageLabels[stage]}</span><b>${items.length}</b></header>
      <div class="cards">${items.map(card).join("") || `<div class="empty">No opportunities</div>`}</div>
    </section>`;
  }).join("");
  const killed = rows.filter((r) => r.stage === "killed").length;
  const archived = rows.filter((r) => r.stage === "archived").length;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>PainDex · Opportunity Pipeline</title>
<style>
:root{--bg:#090b0e;--panel:#11151a;--panel2:#171c22;--line:#282f38;--text:#f4f6f8;--muted:#8f99a5;--accent:#e7ff57;--accent2:#96a63c;--good:#6dde98;--warn:#ffd168;--bad:#ff7c7c;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:14px}.shell{padding:24px;min-height:100vh}.top{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:20px}.eyebrow{color:var(--accent);font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em}.top h1{font-size:27px;letter-spacing:-.04em;margin:7px 0 3px}.top p{margin:0;color:var(--muted)}.nav{display:flex;gap:8px}.btn{border:1px solid var(--line);background:var(--panel);color:var(--text);padding:9px 12px;border-radius:9px;text-decoration:none;cursor:pointer;font:inherit}.btn:hover{border-color:#4d5662}.btn-primary{background:var(--accent);border-color:var(--accent);color:#111600;font-weight:700}.summary{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}.chip{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:6px 9px;color:var(--muted);font-size:12px}.board{display:grid;grid-template-columns:repeat(6,minmax(245px,1fr));gap:10px;overflow-x:auto;padding-bottom:14px}.column{min-height:65vh;border:1px solid var(--line);background:#0d1014;border-radius:12px;padding:8px}.column>header{display:flex;justify-content:space-between;align-items:center;padding:6px 6px 10px;text-transform:uppercase;letter-spacing:.08em;font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.column header b{background:#20262d;padding:3px 7px;border-radius:999px;color:var(--text)}.cards{display:grid;gap:7px}.card{border:1px solid var(--line);border-radius:10px;background:var(--panel);color:inherit;text-align:left;padding:11px;cursor:pointer;width:100%}.card:hover{background:var(--panel2);border-color:#454e59}.card-top{display:flex;justify-content:space-between;margin-bottom:9px}.score{width:34px;height:34px;border:2px solid var(--accent);border-radius:50%;display:grid;place-items:center;font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace}.velocity{color:var(--muted);font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace}.card strong{display:block;font-size:13px;line-height:1.35}.meta{color:var(--muted);font-size:11px;margin-top:5px}.next{border-top:1px solid var(--line);margin-top:10px;padding-top:9px;font-size:12px;line-height:1.35}.next span{display:block;color:var(--accent);font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;margin-bottom:3px}.due{font-size:10px;color:var(--warn);margin-top:5px}.empty{border:1px dashed var(--line);border-radius:9px;padding:20px 10px;text-align:center;color:#626d79;font-size:12px}.backdrop{display:none;position:fixed;inset:0;background:#000a;z-index:20}.backdrop.open{display:block}.drawer{position:fixed;right:0;top:0;height:100vh;width:min(760px,95vw);background:#0e1115;border-left:1px solid var(--line);transform:translateX(100%);transition:.18s transform ease;z-index:21;overflow:auto}.drawer.open{transform:none}.inner{padding:24px}.drawer-head{display:flex;justify-content:space-between;gap:12px}.drawer h2{font-size:24px;letter-spacing:-.035em;margin:13px 0 5px}.muted{color:var(--muted)}.stage-row{display:flex;gap:5px;flex-wrap:wrap;margin:16px 0}.stage-btn{font-size:11px;padding:7px 9px}.stage-btn.current{border-color:var(--accent);color:var(--accent)}.section{border-top:1px solid var(--line);margin-top:18px;padding-top:17px}.section h3{font-size:12px;text-transform:uppercase;letter-spacing:.09em;margin:0 0 10px}.event,.artifact{border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:10px;margin:6px 0}.event .when,.artifact .when{font-size:10px;color:var(--muted)}.event strong,.artifact strong{display:block;margin:4px 0}.artifact pre{white-space:pre-wrap;color:#d5dbe2;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:240px;overflow:auto}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.stat{border:1px solid var(--line);border-radius:9px;padding:10px}.stat label{display:block;color:var(--muted);font-size:10px;text-transform:uppercase}.stat b{display:block;margin-top:4px}.terminal{margin-top:6px;color:var(--muted);font-size:12px}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#222831;border:1px solid #404955;border-radius:999px;padding:8px 13px;display:none;z-index:30}.toast.show{display:block}@media(max-width:800px){.shell{padding:16px 10px}.top{align-items:flex-start;flex-direction:column}.board{grid-template-columns:repeat(6,260px)}.grid{grid-template-columns:1fr 1fr}}
</style></head><body><main class="shell"><header class="top"><div><div class="eyebrow">PAIN INDEX / PIPELINE</div><h1>Opportunity pipeline</h1><p>Turn evidence-backed pain into validated products.</p></div><nav class="nav"><a class="btn" href="/review?token=${encodeURIComponent(token)}">Discovery queue</a></nav></header><div class="summary"><span class="chip">${rows.length} promoted</span><span class="chip">${killed} killed</span><span class="chip">${archived} archived</span></div><div class="board">${columns}</div><div class="terminal">Killed and archived opportunities remain available through the API/history and will get dedicated archive views in the next UI pass.</div></main>
<div id="backdrop" class="backdrop"></div><aside id="drawer" class="drawer"><div class="inner"><div class="drawer-head"><div><span id="stageBadge" class="chip"></span></div><button id="close" class="btn">Close</button></div><h2 id="title"></h2><p id="subtitle" class="muted"></p><div id="stats" class="grid"></div><div id="stageActions" class="stage-row"></div><section class="section"><h3>Activity</h3><div id="events"></div></section><section class="section"><h3>AI analyses</h3><div id="analyses"></div></section><section class="section"><h3>Product briefs</h3><div id="briefs"></div></section></div></aside><div id="toast" class="toast"></div>
<script id="data" type="application/json">${data}</script><script>(function(){var TOKEN=${JSON.stringify(token)};var rows=JSON.parse(document.getElementById('data').textContent);var current=null;var drawer=document.getElementById('drawer'),backdrop=document.getElementById('backdrop');var stages=['new','watching','validating','pursue','building','launched'];function api(path,options){options=options||{};options.headers=Object.assign({'x-review-token':TOKEN,'content-type':'application/json'},options.headers||{});return fetch(path,options)}function toast(msg){var x=document.getElementById('toast');x.textContent=msg;x.classList.add('show');setTimeout(function(){x.classList.remove('show')},1800)}function h(tag,text,cls){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}function open(id){current=rows.find(function(r){return r.id===Number(id)});if(!current)return;document.getElementById('title').textContent=current.label;document.getElementById('subtitle').textContent='Cluster '+current.clusterId+' · updated '+current.updatedAt.slice(0,10);document.getElementById('stageBadge').textContent=current.stage.toUpperCase();document.getElementById('stats').innerHTML='<div class="stat"><label>PainDex</label><b>'+(current.score===null?'—':Math.round(current.score))+'</b></div><div class="stat"><label>Posts</label><b>'+current.postCount+'</b></div><div class="stat"><label>Velocity</label><b>'+(current.velocity===null?'—':Number(current.velocity).toFixed(1)+'×')+'</b></div>';renderStages();drawer.classList.add('open');backdrop.classList.add('open');loadDetail()}function renderStages(){var box=document.getElementById('stageActions');box.innerHTML='';stages.forEach(function(stage){var b=h('button',stage,'btn stage-btn'+(stage===current.stage?' current':''));b.type='button';b.disabled=stage===current.stage;b.onclick=function(){setStage(stage)};box.appendChild(b)});['killed','archived'].forEach(function(stage){var b=h('button',stage,'btn stage-btn');b.type='button';b.onclick=function(){setStage(stage)};box.appendChild(b)});if(current.stage==='killed'||current.stage==='archived'){var restore=h('button','Restore to watching','btn btn-primary stage-btn');restore.type='button';restore.onclick=function(){setStage('watching','restore')};box.appendChild(restore)}}function setStage(stage,action){api('/api/opportunities/'+current.id+'/stage',{method:'POST',body:JSON.stringify({stage:stage,action:action||'set'})}).then(function(r){if(!r.ok)return r.json().then(function(x){throw new Error(x.reason||'Transition failed')});return r.json()}).then(function(){current.stage=stage;document.getElementById('stageBadge').textContent=stage.toUpperCase();renderStages();var card=document.querySelector('.card[data-id="'+current.id+'"]');if(card){card.remove();var target=document.querySelector('[data-column="'+stage+'"] .cards');if(target)target.prepend(card)}toast('Stage updated');loadDetail()}).catch(function(e){toast(e.message)})}function loadDetail(){api('/api/opportunities/'+current.id).then(function(r){if(!r.ok)throw new Error();return r.json()}).then(function(x){var events=document.getElementById('events');events.innerHTML='';(x.events||[]).forEach(function(ev){var d=h('div',undefined,'event');d.appendChild(h('div',ev.createdAt,'when'));d.appendChild(h('strong',ev.eventType));d.appendChild(h('div',(ev.fromStage||'—')+' → '+(ev.toStage||'—'),'muted'));events.appendChild(d)});if(!(x.events||[]).length)events.textContent='No activity yet.';var analyses=document.getElementById('analyses');analyses.innerHTML='';(x.analyses||[]).forEach(function(a){var d=h('div',undefined,'artifact');d.appendChild(h('div',a.createdAt,'when'));d.appendChild(h('strong',a.analysisType));var pre=h('pre',a.resultJson);d.appendChild(pre);analyses.appendChild(d)});if(!(x.analyses||[]).length)analyses.textContent='No persisted analyses yet.';var briefs=document.getElementById('briefs');briefs.innerHTML='';(x.productBriefs||[]).forEach(function(b){var d=h('div',undefined,'artifact');d.appendChild(h('div',b.createdAt,'when'));d.appendChild(h('strong','Brief v'+b.version));d.appendChild(h('pre',b.markdown));briefs.appendChild(d)});if(!(x.productBriefs||[]).length)briefs.textContent='No product briefs yet.'}).catch(function(){toast('Could not load opportunity detail')})}document.querySelectorAll('.card').forEach(function(card){card.addEventListener('click',function(){open(card.dataset.id)})});function close(){drawer.classList.remove('open');backdrop.classList.remove('open');current=null}document.getElementById('close').onclick=close;backdrop.onclick=close;document.addEventListener('keydown',function(e){if(e.key==='Escape')close()})})();</script></body></html>`;
}
