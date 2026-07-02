# PainDex

PAIN INDEX

A nightly Cloudflare Worker that ingests posts from a watchlist of subreddits,
classifies them for commercial pain signals, clusters repeated questions,
enriches clusters weekly with Ahrefs keyword data, and serves a ranked
opportunity table for human review. Read-only, no posting/commenting on
Reddit, ever. See the build spec for the full design.

## Stack

Cloudflare Workers, Hono, D1, KV, Vectorize, Workers AI, Drizzle, Wrangler.

## Architecture

- **Nightly ingest** (`0 9 * * *` through `15 10 * * *`, 6 crons 15 minutes
  apart): fetch → prefilter → classify → cluster, in batches of 10
  subreddits per invocation via a KV cursor.
- **Weekly enrich** (`0 12 * * 0`, Sunday): eligible clusters → Ahrefs
  keyword batch → velocity → opportunity score.
- **`/review`**: token-protected, server-rendered HTML table with
  client-side sort/filter and inline status/label/notes editing.

## One-time setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create the Cloudflare resources and fill in the resulting IDs in
   `wrangler.toml`:

   ```sh
   npx wrangler d1 create paindex
   npx wrangler kv namespace create paindex-kv
   npx wrangler vectorize create paindex-clusters --dimensions=768 --metric=cosine
   ```

3. Apply the D1 schema + seed the watchlist:

   ```sh
   npm run db:migrate:remote
   npm run seed:remote
   ```

   (Use the `:local` variants against `wrangler dev` for local development.)

4. Create a Reddit "script" app at <https://www.reddit.com/prefs/apps> and
   set secrets:

   ```sh
   npx wrangler secret put REDDIT_CLIENT_ID
   npx wrangler secret put REDDIT_CLIENT_SECRET
   npx wrangler secret put REDDIT_USERNAME
   npx wrangler secret put AHREFS_API_KEY
   npx wrangler secret put REVIEW_TOKEN
   ```

5. Deploy:

   ```sh
   npm run deploy
   ```

6. Visit `https://<your-worker>.workers.dev/review?token=<REVIEW_TOKEN>`.

## Local development

```sh
npx wrangler d1 execute paindex --local --file=./migrations/0000_init.sql
npx wrangler d1 execute paindex --local --file=./migrations/0001_seed_watchlist.sql
npm run dev
```

Note: Workers AI and Vectorize bindings don't run locally — `wrangler dev`
proxies those calls to your real Cloudflare account, so the ingest/cluster
pipeline needs either `--remote` or a deployed environment to exercise
end-to-end. `/review` and `/api/*` work fully against local D1/KV.

## Config knobs (KV, no redeploy needed)

- `prefilter:patterns` — heuristic regexes gating which posts reach the
  classifier (target pass rate 15–50%).
- `cluster:threshold` — cosine similarity cutoff for attaching a post to an
  existing cluster (default `0.85`).
- `scoring:weights` — the five multipliers behind `opportunity_score`.

## Guardrails

- Read-only Reddit access via `client_credentials` OAuth only.
- Stores post title + 500-char excerpt only, never full selftext or
  comments.
- 1 request/second to Reddit, honors rate-limit headers, backs off on 429.
- Auto-deactivates a subreddit after 5 consecutive fetch failures.
- Hard cap of 100 Ahrefs keyword lookups per week.
- Every cron run writes a `runs` row for observability.
