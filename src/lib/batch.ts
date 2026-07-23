export interface BatchSelection<T> {
  batch: T[]; // the next slice to process, up to batchSize items
  hasMore: boolean; // whether any items remain after this batch
}

/**
 * Keyset pagination over a name-ordered list. Given the currently-active items
 * sorted ascending by `name`, return the next batch strictly after the `after`
 * cursor along with whether more remain.
 *
 * Using the last-processed name as the cursor (instead of a numeric offset into
 * a list that is re-queried each invocation) keeps pagination stable when the
 * underlying set shrinks between calls: an item that disappears — e.g. a
 * subreddit deactivated after too many consecutive fetch failures — simply
 * drops out, and every other item keeps its position relative to the cursor, so
 * no still-active item is ever skipped.
 *
 * `after` of "" (the empty string) sorts before any real name, yielding the
 * first batch.
 */
export function selectBatch<T extends { name: string }>(
  activeSorted: readonly T[],
  after: string,
  batchSize: number,
): BatchSelection<T> {
  const remaining = activeSorted.filter((item) => item.name > after);
  return {
    batch: remaining.slice(0, batchSize),
    hasMore: remaining.length > batchSize,
  };
}
