import type { Context, Next } from "hono";
import type { Env } from "../types";

export async function reviewAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = c.req.query("token") ?? c.req.header("x-review-token");
  if (!token || token !== c.env.REVIEW_TOKEN) {
    return c.text("Unauthorized", 401);
  }
  await next();
}

// Reddit permalinks aren't persisted (schema stays lean per spec's
// "no full-text storage" ethos) -- they're derivable from the fullname we
// already store, so we build them at render time instead.
export function redditPermalink(subreddit: string, fullname: string): string {
  const id36 = fullname.replace(/^t3_/, "");
  return `https://www.reddit.com/r/${subreddit}/comments/${id36}/`;
}
