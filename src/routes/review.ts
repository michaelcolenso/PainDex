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
  avgIntent: number | null;
  opportunityScore: number | null;
  status: string;
  firstSeen: string;
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
    avgIntent: r.avgIntent,
    opportunityScore: r.opportunityScore,
    status: r.status,
    firstSeen: r.firstSeen,
    notes: r.notes,
    subs: subsMap.get(r.id) ?? "",
  }));

  const token = c.req.query("token") ?? "";
  return c.html(renderPage(data, token));
});

function esc(value: string | number | null): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function fmt(value: number | null, digits = 0): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function renderRow(row: ClusterRow): string {
  const highPainNoVolume = (row.volume ?? 0) === 0 && row.postCount >= 8;
  return `
<tr class="cluster-row" data-id="${row.id}" data-status="${esc(row.status)}" data-high-pain="${highPainNoVolume}"
    data-label="${esc(row.label.toLowerCase())}" data-subs="${esc(row.subs.toLowerCase())}"
    data-post-count="${row.postCount}" data-velocity="${row.velocity30d ?? -1}"
    data-volume="${row.volume ?? -1}" data-kd="${row.kd ?? -1}" data-intent="${row.avgIntent ?? -1}"
    data-score="${row.opportunityScore ?? -1}" data-first-seen="${esc(row.firstSeen)}">
  <td class="label-cell">
    <span class="label-text">${esc(row.label)}</span>
    <input class="label-input hidden" value="${esc(row.label)}" />
  </td>
  <td class="subs-cell">${esc(row.subs)}</td>
  <td class="num">${row.postCount}</td>
  <td class="num">${fmt(row.velocity30d, 2)}</td>
  <td class="num">${row.volume ?? "—"}</td>
  <td class="num">${row.kd ?? "—"}</td>
  <td class="num">${fmt(row.avgIntent, 1)}</td>
  <td class="num score">${fmt(row.opportunityScore, 1)}</td>
  <td class="status-cell">
    <select class="status-select">
      ${["new", "watching", "pursue", "killed"]
        .map((s) => `<option value="${s}" ${s === row.status ? "selected" : ""}>${s}</option>`)
        .join("")}
    </select>
  </td>
  <td>${esc(row.firstSeen).slice(0, 10)}</td>
</tr>
<tr class="detail-row hidden" data-detail-for="${row.id}">
  <td colspan="9">
    <div class="notes-block">
      <label>Notes</label>
      <textarea class="notes-input">${esc(row.notes ?? "")}</textarea>
      <button class="save-notes">Save label &amp; notes</button>
    </div>
    <div class="posts-block">Loading recent posts…</div>
  </td>
</tr>`;
}

function renderPage(data: ClusterRow[], token: string): string {
  const rowsHtml = data.map(renderRow).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PainDex Review</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  .tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .tabs button { padding: 0.4rem 0.8rem; border: 1px solid #8884; border-radius: 6px; background: none; cursor: pointer; }
  .tabs button.active { background: #4a90d922; border-color: #4a90d9; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #8883; text-align: left; }
  th { cursor: pointer; user-select: none; white-space: nowrap; }
  th.sorted::after { content: " " attr(data-dir); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.cluster-row { cursor: pointer; }
  tr.cluster-row:hover { background: #8881; }
  .hidden { display: none !important; }
  .notes-block { margin-bottom: 0.75rem; }
  .notes-input { width: 100%; min-height: 4rem; box-sizing: border-box; }
  .posts-block a { display: block; padding: 0.15rem 0; }
  .label-input { width: 100%; box-sizing: border-box; }
  select.status-select { font-size: 0.85rem; }
</style>
</head>
<body>
<h1>PainDex Review</h1>
<div class="tabs" id="tabs">
  <button data-filter="all" class="active">All</button>
  <button data-filter="new">New</button>
  <button data-filter="watching">Watching</button>
  <button data-filter="pursue">Pursue</button>
  <button data-filter="high-pain">High pain, no volume</button>
</div>
<table id="clusters-table">
  <thead>
    <tr>
      <th data-key="label">Label</th>
      <th data-key="subs">Subreddits</th>
      <th data-key="post-count">Posts</th>
      <th data-key="velocity">Velocity 30d</th>
      <th data-key="volume">Volume</th>
      <th data-key="kd">KD</th>
      <th data-key="intent">Avg Intent</th>
      <th data-key="score">Score</th>
      <th data-key="status">Status</th>
      <th data-key="first-seen">First Seen</th>
    </tr>
  </thead>
  <tbody>
${rowsHtml}
  </tbody>
</table>
<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  function apiFetch(path, options) {
    options = options || {};
    options.headers = Object.assign({ "x-review-token": TOKEN, "content-type": "application/json" }, options.headers || {});
    return fetch(path, options);
  }

  var tbody = document.querySelector("#clusters-table tbody");

  // --- Filter tabs ---
  document.getElementById("tabs").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-filter]");
    if (!btn) return;
    document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    var filter = btn.getAttribute("data-filter");
    document.querySelectorAll("tr.cluster-row").forEach(function (row) {
      var show = true;
      if (filter === "high-pain") show = row.getAttribute("data-high-pain") === "true";
      else if (filter !== "all") show = row.getAttribute("data-status") === filter;
      row.classList.toggle("hidden", !show);
      var detail = row.nextElementSibling;
      if (!show && detail) detail.classList.add("hidden");
    });
  });

  // --- Sorting ---
  var sortState = { key: null, dir: 1 };
  document.querySelectorAll("th[data-key]").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      sortState.dir = sortState.key === key ? -sortState.dir : 1;
      sortState.key = key;
      document.querySelectorAll("th").forEach(function (h) { h.classList.remove("sorted"); h.removeAttribute("data-dir"); });
      th.classList.add("sorted");
      th.setAttribute("data-dir", sortState.dir === 1 ? "▲" : "▼");

      var rows = Array.prototype.slice.call(document.querySelectorAll("tr.cluster-row"));
      rows.sort(function (a, b) {
        var av = a.getAttribute("data-" + key);
        var bv = b.getAttribute("data-" + key);
        var an = parseFloat(av), bn = parseFloat(bv);
        var cmp;
        if (!isNaN(an) && !isNaN(bn)) cmp = an - bn;
        else cmp = av.localeCompare(bv);
        return cmp * sortState.dir;
      });
      rows.forEach(function (row) {
        var detail = row.nextElementSibling;
        tbody.appendChild(row);
        if (detail) tbody.appendChild(detail);
      });
    });
  });

  // --- Row expand / collapse, loads recent posts lazily ---
  tbody.addEventListener("click", function (e) {
    if (e.target.closest("select, input, textarea, button, a")) return;
    var row = e.target.closest("tr.cluster-row");
    if (!row) return;
    var id = row.getAttribute("data-id");
    var detail = row.nextElementSibling;
    if (!detail) return;
    var wasHidden = detail.classList.contains("hidden");
    detail.classList.toggle("hidden");
    if (wasHidden && !detail.getAttribute("data-loaded")) {
      detail.setAttribute("data-loaded", "1");
      var postsBlock = detail.querySelector(".posts-block");
      apiFetch("/api/clusters/" + id + "/posts")
        .then(function (r) { return r.json(); })
        .then(function (posts) {
          if (!posts.length) { postsBlock.textContent = "No posts on record."; return; }
          postsBlock.innerHTML = "";
          posts.forEach(function (p) {
            var a = document.createElement("a");
            a.href = p.permalink;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = "r/" + p.subreddit + " — " + p.title;
            postsBlock.appendChild(a);
          });
        })
        .catch(function () { postsBlock.textContent = "Failed to load posts."; });
    }
  });

  // --- Status mutation ---
  tbody.addEventListener("change", function (e) {
    if (!e.target.classList.contains("status-select")) return;
    var row = e.target.closest("tr.cluster-row");
    var id = row.getAttribute("data-id");
    var status = e.target.value;
    apiFetch("/api/clusters/" + id + "/status", { method: "POST", body: JSON.stringify({ status: status }) })
      .then(function (r) { if (r.ok) row.setAttribute("data-status", status); });
  });

  // --- Inline label/notes edit ---
  tbody.addEventListener("dblclick", function (e) {
    var span = e.target.closest(".label-text");
    if (!span) return;
    span.classList.add("hidden");
    span.nextElementSibling.classList.remove("hidden");
    span.nextElementSibling.focus();
  });

  tbody.addEventListener("click", function (e) {
    if (!e.target.classList.contains("save-notes")) return;
    var detail = e.target.closest("tr.detail-row");
    var id = detail.getAttribute("data-detail-for");
    var row = detail.previousElementSibling;
    var labelInput = row.querySelector(".label-input");
    var notes = detail.querySelector(".notes-input").value;
    var label = labelInput.value;
    apiFetch("/api/clusters/" + id, { method: "POST", body: JSON.stringify({ label: label, notes: notes }) })
      .then(function (r) {
        if (r.ok) {
          var span = row.querySelector(".label-text");
          span.textContent = label;
          span.classList.remove("hidden");
          labelInput.classList.add("hidden");
          row.setAttribute("data-label", label.toLowerCase());
        }
      });
  });
})();
</script>
</body>
</html>`;
}
