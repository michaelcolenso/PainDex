import { Hono } from "hono";
import type { Env } from "./types";
import { reviewAuth } from "./lib/auth";
import { seedPromotionSnapshot } from "./lib/promotionSnapshot";
import { review } from "./routes/review";
import { pipeline } from "./routes/pipeline";
import { api } from "./routes/api";
import { pipelineApi } from "./routes/pipelineApi";
import { runIngestBatch } from "./cron/ingest";
import { runWeeklyEnrich } from "./cron/enrich";

// Cloudflare's cron validator rejects numeric day-of-week 0, so the Sunday
// enrich trigger uses SUN; this must match the schedule in wrangler.toml exactly
// since `scheduled` dispatches by comparing against the delivered cron string.
const ENRICH_CRON = "0 12 * * SUN";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("PainDex is running. See /review?token=... for discovery or /pipeline?token=... for active opportunities."));

app.use("/review", reviewAuth);
app.use("/pipeline", reviewAuth);
app.use("/api/*", reviewAuth);
app.use("/api/clusters/:id/promote", seedPromotionSnapshot);
app.use("/api/clusters/:id/build", seedPromotionSnapshot);

app.route("/review", review);
app.route("/pipeline", pipeline);
app.route("/api", api);
app.route("/api", pipelineApi);

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === ENRICH_CRON) {
      ctx.waitUntil(runWeeklyEnrich(env));
    } else {
      ctx.waitUntil(runIngestBatch(env));
    }
  },
};
