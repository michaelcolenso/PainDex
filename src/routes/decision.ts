import { Hono } from "hono";
import type { Env } from "../types";

export const decision = new Hono<{ Bindings: Env }>();

type DecisionRow = {
  id: number;
  label: string;
  postCount: number;
  velocity30d: number | null;
  volume: number | null;
  kd: number | null;
  avgIntent: number | null;
  opportunityScore: number | null;
  status: string;
  firstSeen: string;
  lastSeen: string;
  opportunityId: number | null;
  stage: string | null;
  thesis: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  sourceCount: number;
  sources: string | null;
};

decision.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       c.id,
       c.label,
       c.post_count AS postCount,
       c.velocity_30d AS velocity30d,
       c.volume,
       c.kd,
       c.avg_intent AS avgIntent,
       c.opportunity_score AS opportunityScore,
       c.status,
       c.first_seen AS firstSeen,
       c.last_seen AS lastSeen,
       o.id AS opportunityId,
       o.stage,
       o.thesis,
       o.next_action AS nextAction,
       o.next_action_due_at AS nextActionDueAt,
       (SELECT COUNT(DISTINCT p.subreddit) FROM posts p WHERE p.cluster_id = c.id) AS sourceCount,
       (SELECT GROUP_CONCAT(DISTINCT p.subreddit) FROM posts p WHERE p.cluster_id = c.id) AS sources
     FROM clusters c
     LEFT JOIN opportunities o ON o.cluster_id = c.id
     ORDER BY COALESCE(c.opportunity_score, 0) DESC, c.last_seen DESC
     LIMIT 250`,
  ).all<DecisionRow>();

  return c.html(render(results, c.req.query("token") ?? ""));
});

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] ?? ch));
}

function confidence(row: DecisionRow): "low" | "medium" | "high" {
  if (row.postCount >= 12 && row.sourceCount >= 3) return "high";
  if (row.postCount >= 5 && row.sourceCount >= 2) return "medium";
  return "low";
}

function decisionState(row: DecisionRow): string {
  switch (row.stage ?? row.status) {
    case "watching":
    case "validating":
      return "investigating";
    case "pursue":
    case "building":
      return "bet";
    case "launched":
      return "shipped";
    case "archived":
      return "parked";
    case "killed":
      return "dead";
    default:
      return "candidate";
  }
}

function fallbackNext(row: DecisionRow): string {
  const state = decisionState(row);
  if (state === "candidate") return "Read the newest evidence and name the single biggest uncertainty.";
  if (state === "investigating") return "Run the cheapest test that could make this a clear yes or no.";
  if (state === "bet") return "Validate willingness to pay before expanding scope.";
  if (state === "shipped") return "Measure whether real usage confirms the original pain thesis.";
  return "No active validation action.";
}

function sourcesLabel(row: DecisionRow): string {
  const names = (row.sources ?? "").split(",").filter(Boolean);
  if (!names.length) return "No source diversity yet";
  return names.slice(0, 3).map((x) => `r/${x}`).join(" · ") + (names.length > 3 ? ` +${names.length - 3}` : "");
}

function card(row: DecisionRow, compact = false): string {
  const state = decisionState(row);
  const conf = confidence(row);
  const velocity = row.velocity30d == null ? "—" : `${row.velocity30d.toFixed(1)}×`;
  const score = row.opportunityScore == null ? "—" : Math.round(row.opportunityScore);
  const intent = row.avgIntent == null ? "—" : row.avgIntent.toFixed(1);
  return `<button class="candidate ${compact ? "compact" : ""}" type="button" data-id="${row.id}" data-opportunity-id="${row.opportunityId ?? ""}">
    <div class="candidate-head">
      <span class="signal"><b>${score}</b><small>signal</small></span>
      <div class="candidate-title"><strong>${esc(row.label)}</strong><span>${esc(sourcesLabel(row))}</span></div>
      <span class="state ${state}">${state}</span>
    </div>
    <div class="dimensions">
      <div><small>PAIN</small><b>${row.postCount} posts</b></div>
      <div><small>INTENT</small><b>${intent}/10</b></div>
      <div><small>MOMENTUM</small><b>${velocity}</b></div>
      <div><small>MARKET</small><b>${row.volume == null ? "—" : row.volume.toLocaleString() + "/mo"}</b></div>
      <div><small>CONFIDENCE</small><b class="confidence ${conf}">${conf}</b></div>
    </div>
    ${compact ? "" : `<div class="next"><span>NEXT QUESTION</span>${esc(row.nextAction || fallbackNext(row))}</div>`}
  </button>`;
}

function render(rows: DecisionRow[], token: string): string {
  const live = rows.filter((r) => !["killed", "archived"].includes(r.stage ?? r.status));
  const bets = live.filter((r) => ["pursue", "building", "launched"].includes(r.stage ?? r.status)).slice(0, 5);
  const top = (bets.length ? bets : live).slice(0, 5);
  const actionable = live
    .filter((r) => r.opportunityId && (r.nextAction || ["watching", "validating", "pursue", "building"].includes(r.stage ?? "")))
    .sort((a, b) => {
      const ad = a.nextActionDueAt ? Date.parse(a.nextActionDueAt) : Number.MAX_SAFE_INTEGER;
      const bd = b.nextActionDueAt ? Date.parse(b.nextActionDueAt) : Number.MAX_SAFE_INTEGER;
      return ad - bd || (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
    });
  const doNext = actionable[0] ?? top[0] ?? live[0];
  const recent = [...live].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen)).slice(0, 6);
  const serialized = JSON.stringify(rows).replace(/</g, "\\u003c");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>PainDex · Decision Room</title>
<style>
:root{--bg:#080a0d;--panel:#111419;--panel2:#171b21;--line:#29303a;--text:#f4f6f8;--muted:#8c96a3;--accent:#e8ff59;--green:#6fe09b;--amber:#f2c967;--red:#ff7878;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:14px}.shell{max-width:1440px;margin:auto;padding:28px}.top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}.eyebrow{color:var(--accent);font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.17em}.top h1{font-size:30px;letter-spacing:-.045em;margin:7px 0 4px}.top p{margin:0;color:var(--muted)}.nav{display:flex;gap:7px;flex-wrap:wrap}.btn{border:1px solid var(--line);background:var(--panel);color:var(--text);padding:9px 12px;border-radius:9px;text-decoration:none;font:inherit;cursor:pointer}.btn:hover{border-color:#4c5663}.btn.primary{background:var(--accent);border-color:var(--accent);color:#101400;font-weight:750}.hero{margin:24px 0 28px;border:1px solid #56631f;background:linear-gradient(135deg,#161b10,#101419 70%);border-radius:16px;padding:18px}.section-label{color:var(--muted);font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.13em;text-transform:uppercase}.hero-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(260px,.7fr);gap:20px;margin-top:10px}.hero h2{font-size:24px;letter-spacing:-.035em;margin:0 0 7px}.hero .why{color:#cdd4dc;line-height:1.55}.hero-next{border-left:1px solid #3a421c;padding-left:18px}.hero-next strong{display:block;color:var(--accent);font-size:15px;line-height:1.45;margin-top:7px}.hero-next small{display:block;color:var(--muted);margin-top:7px}.layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:22px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:10px;margin-bottom:9px}.section-head h2{font-size:17px;margin:3px 0 0}.section-head span{color:var(--muted);font-size:12px}.stack{display:grid;gap:8px}.candidate{width:100%;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:12px;padding:13px;text-align:left;cursor:pointer}.candidate:hover{background:var(--panel2);border-color:#46505d}.candidate-head{display:grid;grid-template-columns:48px 1fr auto;gap:12px;align-items:center}.signal{width:46px;height:46px;border:2px solid var(--accent);border-radius:50%;display:grid;place-items:center;align-content:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.signal b{font-size:14px;line-height:1}.signal small{font-size:8px;color:var(--muted);text-transform:uppercase;margin-top:3px}.candidate-title strong{display:block;font-size:14px;line-height:1.35}.candidate-title span{display:block;color:var(--muted);font-size:11px;margin-top:4px}.state{font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase;padding:5px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}.state.bet{color:var(--green);border-color:#315a42}.state.investigating{color:var(--amber);border-color:#594d2d}.state.dead{color:var(--red);border-color:#613638}.state.shipped{color:var(--accent);border-color:#586521}.dimensions{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:13px;border-top:1px solid var(--line);padding-top:10px}.dimensions small{display:block;color:var(--muted);font-size:9px;letter-spacing:.08em;margin-bottom:3px}.dimensions b{font-size:11px;font-weight:600}.confidence{text-transform:uppercase}.confidence.high{color:var(--green)}.confidence.medium{color:var(--amber)}.confidence.low{color:var(--red)}.next{margin-top:10px;background:#0d1014;border-radius:8px;padding:9px 10px;font-size:12px;line-height:1.45}.next span{display:block;color:var(--accent);font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;margin-bottom:3px}.compact .dimensions{grid-template-columns:repeat(3,1fr)}.compact .dimensions>div:nth-child(4),.compact .dimensions>div:nth-child(5){display:none}.right-section{margin-bottom:22px}.principle{border:1px solid var(--line);border-radius:12px;padding:13px;color:#cbd2da;line-height:1.5;background:#0d1014}.principle strong{color:var(--text)}.backdrop{display:none;position:fixed;inset:0;background:#000b;z-index:20}.backdrop.open{display:block}.drawer{position:fixed;right:0;top:0;height:100vh;width:min(840px,97vw);background:#0d1014;border-left:1px solid var(--line);transform:translateX(100%);transition:.18s ease;z-index:21;overflow:auto}.drawer.open{transform:none}.inner{padding:24px}.drawer-head{display:flex;justify-content:space-between;gap:10px}.drawer h2{font-size:25px;letter-spacing:-.04em;margin:14px 0 5px}.subtitle{color:var(--muted)}.decision-actions{display:flex;gap:7px;flex-wrap:wrap;margin:15px 0}.section{border-top:1px solid var(--line);margin-top:18px;padding-top:17px}.section h3{font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin:0 0 10px}.evidence{display:grid;gap:7px}.post{border:1px solid var(--line);border-radius:9px;background:var(--panel);padding:10px}.post a{color:var(--text);text-decoration:none;font-weight:650}.post p{color:#cbd2da;font-size:12px;line-height:1.5;margin:7px 0 0}.post-meta{color:var(--muted);font-size:10px;margin-bottom:5px}.belief,.unknown,.test,.rule{border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:11px;line-height:1.5}.unknown ul,.rule ul{margin:7px 0 0;padding-left:18px}.history{display:grid;gap:7px}.history-row{display:grid;grid-template-columns:100px 1fr;gap:10px;font-size:12px}.history-row time{color:var(--muted)}.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:none;background:#20262d;border:1px solid #414a56;border-radius:999px;padding:8px 13px;z-index:30}.toast.show{display:block}@media(max-width:960px){.layout,.hero-grid{grid-template-columns:1fr}.hero-next{border-left:0;border-top:1px solid #3a421c;padding:13px 0 0}.dimensions{grid-template-columns:repeat(3,1fr)}}@media(max-width:620px){.shell{padding:18px 11px}.top{align-items:flex-start;flex-direction:column}.candidate-head{grid-template-columns:44px 1fr}.state{grid-column:2}.dimensions{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="shell"><header class="top"><div><div class="eyebrow">PAIN INDEX / DECISION ROOM</div><h1>What should we validate next?</h1><p>Evidence first. One uncertainty at a time.</p></div><nav class="nav"><a class="btn" href="/signals?token=${encodeURIComponent(token)}">Raw signals</a><a class="btn" href="/pipeline?token=${encodeURIComponent(token)}">Pipeline debug</a></nav></header>
${doNext ? `<section class="hero"><div class="section-label">DO NEXT</div><div class="hero-grid"><div><h2>${esc(doNext.label)}</h2><div class="why">${doNext.thesis ? esc(doNext.thesis) : `${doNext.postCount} independent pain reports across ${doNext.sourceCount || 1} source${doNext.sourceCount === 1 ? "" : "s"}, with ${doNext.velocity30d == null ? "unknown" : doNext.velocity30d.toFixed(1) + "×"} recent momentum.`}</div></div><div class="hero-next"><div class="section-label">NEXT DECISION-CHANGING ACTION</div><strong>${esc(doNext.nextAction || fallbackNext(doNext))}</strong>${doNext.nextActionDueAt ? `<small>Due ${esc(doNext.nextActionDueAt.slice(0,10))}</small>` : ""}</div></div></section>` : ""}
<div class="layout"><section><div class="section-head"><div><div class="section-label">DECIDE</div><h2>Top bets</h2></div><span>Signal score is context, not verdict.</span></div><div class="stack">${top.map((r)=>card(r)).join("") || '<div class="principle">No live candidates yet.</div>'}</div></section><aside><section class="right-section"><div class="section-head"><div><div class="section-label">DISCOVER</div><h2>New signals</h2></div><span>Most recently active</span></div><div class="stack">${recent.map((r)=>card(r,true)).join("")}</div></section><section class="right-section"><div class="section-label">OPERATING RULE</div><div class="principle"><strong>Do not ask “is this a good idea?”</strong><br>Ask which uncertainty is most likely to flip the decision, then buy that information as cheaply as possible.</div></section></aside></div></main>
<div id="backdrop" class="backdrop"></div><aside id="drawer" class="drawer"><div class="inner"><div class="drawer-head"><span id="drawerState" class="state"></span><button id="close" class="btn">Close</button></div><h2 id="drawerTitle"></h2><div id="drawerSubtitle" class="subtitle"></div><div class="decision-actions"><button class="btn" data-status="watching">Investigate</button><button class="btn primary" data-status="pursue">Make bet</button><button class="btn" data-status="killed">Kill</button></div><section class="section"><h3>Evidence</h3><div id="evidence" class="evidence">Loading…</div></section><section class="section"><h3>What we believe</h3><div id="belief" class="belief"></div></section><section class="section"><h3>What we do not know</h3><div id="unknown" class="unknown"></div></section><section class="section"><h3>Next test</h3><div id="test" class="test"></div></section><section class="section"><h3>Decision rule</h3><div id="rule" class="rule"></div></section><section class="section"><h3>History</h3><div id="history" class="history"></div></section></div></aside><div id="toast" class="toast"></div><script id="decision-data" type="application/json">${serialized}</script>
<script>(function(){var TOKEN=${JSON.stringify(token)},data=JSON.parse(document.getElementById('decision-data').textContent),drawer=document.getElementById('drawer'),backdrop=document.getElementById('backdrop'),current=null;function api(path,opts){opts=opts||{};opts.headers=Object.assign({'x-review-token':TOKEN,'content-type':'application/json'},opts.headers||{});return fetch(path,opts)}function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},1800)}function state(r){var x=r.stage||r.status;if(x==='watching'||x==='validating')return'investigating';if(x==='pursue'||x==='building')return'bet';if(x==='launched')return'shipped';if(x==='archived')return'parked';if(x==='killed')return'dead';return'candidate'}function fallback(r){var s=state(r);if(s==='candidate')return'Read the newest evidence and name the single biggest uncertainty.';if(s==='investigating')return'Run the cheapest test that could make this a clear yes or no.';if(s==='bet')return'Validate willingness to pay before expanding scope.';if(s==='shipped')return'Measure whether real usage confirms the original pain thesis.';return'No active validation action.'}function close(){drawer.classList.remove('open');backdrop.classList.remove('open');current=null}function open(id,oppId){current=data.find(function(x){return x.id===Number(id)});if(!current)return;drawer.classList.add('open');backdrop.classList.add('open');var s=state(current),badge=document.getElementById('drawerState');badge.textContent=s;badge.className='state '+s;document.getElementById('drawerTitle').textContent=current.label;document.getElementById('drawerSubtitle').textContent=current.postCount+' reports · '+current.sourceCount+' sources · signal '+(current.opportunityScore==null?'—':Math.round(current.opportunityScore));document.getElementById('belief').textContent=current.thesis||'No thesis yet. Read the evidence before writing one.';document.getElementById('test').textContent=current.nextAction||fallback(current);document.getElementById('unknown').innerHTML='<span class="subtitle">Loading known risks and unknowns…</span>';document.getElementById('rule').innerHTML='<span class="subtitle">No explicit kill criteria captured yet.</span>';document.getElementById('history').innerHTML='<span class="subtitle">Loading decision history…</span>';loadEvidence();if(oppId)loadWorkspace(oppId);else{document.getElementById('unknown').textContent='This is still a candidate. The first job is to identify the uncertainty most likely to kill it.';document.getElementById('history').textContent='Not yet promoted into active investigation.'}}function loadEvidence(){var box=document.getElementById('evidence');box.textContent='Loading…';api('/api/clusters/'+current.id+'/posts').then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(posts){box.innerHTML='';posts.slice(0,6).forEach(function(p){var a=document.createElement('article');a.className='post';var m=document.createElement('div');m.className='post-meta';m.textContent='r/'+p.subreddit+(p.commercialIntent!=null?' · intent '+p.commercialIntent+'/10':'');var link=document.createElement('a');link.href=p.permalink;link.target='_blank';link.rel='noopener noreferrer';link.textContent=p.title;a.append(m,link);if(p.excerpt){var t=document.createElement('p');t.textContent=p.excerpt;a.appendChild(t)}box.appendChild(a)});if(!posts.length)box.textContent='No supporting evidence stored.'}).catch(function(){box.textContent='Evidence unavailable.'})}function parse(v){try{return typeof v==='string'?JSON.parse(v):v}catch(e){return null}}function loadWorkspace(id){api('/api/opportunities/'+id+'/workspace').then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(w){var unknowns=[],rules=[];if(w.analyses&&w.analyses.length){var a=parse(w.analyses[0].result_json||w.analyses[0].resultJson);if(a&&Array.isArray(a.risks))unknowns=a.risks}if(w.productBriefs&&w.productBriefs.length){var b=parse(w.productBriefs[0].brief_json||w.productBriefs[0].briefJson);if(b&&Array.isArray(b.killCriteria))rules=b.killCriteria}document.getElementById('unknown').innerHTML=unknowns.length?'<ul>'+unknowns.map(function(x){return'<li>'+escapeHtml(x)+'</li>'}).join('')+'</ul>':'No explicit unknowns captured. That is the next thing to fix.';document.getElementById('rule').innerHTML=rules.length?'<ul>'+rules.map(function(x){return'<li>'+escapeHtml(x)+'</li>'}).join('')+'</ul>':'No explicit kill criteria captured yet.';var h=document.getElementById('history');h.innerHTML='';(w.scoreSnapshots||[]).slice(0,5).forEach(function(x){var d=document.createElement('div');d.className='history-row';var time=document.createElement('time');time.textContent=(x.captured_at||x.capturedAt||'').slice(0,10);var text=document.createElement('span');text.textContent='Signal score '+Number(x.score||0).toFixed(1);d.append(time,text);h.appendChild(d)});(w.events||[]).slice(0,5).forEach(function(x){var d=document.createElement('div');d.className='history-row';var time=document.createElement('time');time.textContent=(x.created_at||x.createdAt||'').slice(0,10);var text=document.createElement('span');text.textContent=(x.event_type||x.eventType||'event').replaceAll('_',' ');d.append(time,text);h.appendChild(d)});if(!h.children.length)h.textContent='No decision history yet.'}).catch(function(){document.getElementById('unknown').textContent='Workspace details unavailable.';document.getElementById('history').textContent='History unavailable.'})}function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])})}function setStatus(status){if(!current)return;api('/api/clusters/'+current.id+'/status',{method:'POST',body:JSON.stringify({status:status})}).then(function(r){if(!r.ok)throw 0;current.status=status;toast(status==='watching'?'Investigation started':status==='pursue'?'Bet recorded':'Killed');setTimeout(function(){location.reload()},250)}).catch(function(){toast('Decision update failed')})}document.querySelectorAll('.candidate').forEach(function(el){el.addEventListener('click',function(){open(el.dataset.id,el.dataset.opportunityId)})});document.querySelectorAll('[data-status]').forEach(function(el){el.addEventListener('click',function(){setStatus(el.dataset.status)})});document.getElementById('close').addEventListener('click',close);backdrop.addEventListener('click',close);document.addEventListener('keydown',function(e){if(e.key==='Escape')close()})})();</script></body></html>`;
}
