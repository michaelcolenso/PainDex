import { Hono } from "hono";
import type { Env } from "./types";
import { reviewAuth } from "./lib/auth";
import { review } from "./routes/review";
import { api } from "./routes/api";
import { runIngestBatch } from "./cron/ingest";
import { runWeeklyEnrich } from "./cron/enrich";

// Cloudflare's cron validator rejects numeric day-of-week 0, so the Sunday
// enrich trigger uses SUN; this must match the schedule in wrangler.toml exactly
// since `scheduled` dispatches by comparing against the delivered cron string.
const ENRICH_CRON = "0 12 * * SUN";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("PainDex is running. See /review?token=... for the opportunity table."));

app.use("/review", reviewAuth);
app.use("/api/*", reviewAuth);

app.route("/review", review);
app.route("/api", api);

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
