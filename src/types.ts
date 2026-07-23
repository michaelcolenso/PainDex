export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  VECTORIZE: VectorizeIndex;
  AI: Ai;

  // Public Reddit access needs no credentials. REDDIT_USERNAME is optional
  // contact info folded into the User-Agent; leave it unset and it's omitted.
  REDDIT_USERNAME?: string;
  AHREFS_API_KEY: string;
  REVIEW_TOKEN: string;
}
