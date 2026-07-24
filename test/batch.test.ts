import { describe, expect, it } from "vitest";
import { chunk, selectBatch } from "../src/lib/batch";

interface Sub {
  name: string;
}

function subs(...names: string[]): Sub[] {
  return names.map((name) => ({ name }));
}

describe("chunk", () => {
  it("splits a list into consecutive chunks of at most `size`", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when the list fits", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("covers every element exactly once with no overlap", () => {
    const items = Array.from({ length: 125 }, (_, i) => i); // e.g. a full new+top listing
    const chunks = chunk(items, 90);
    expect(chunks.map((c) => c.length)).toEqual([90, 35]);
    expect(chunks.flat()).toEqual(items);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(90);
  });

  it("keeps a post-insert chunk within D1's parameter budget (9 params/row)", () => {
    const rows = Array.from({ length: 100 }, (_, i) => i);
    for (const c of chunk(rows, 10)) {
      expect(c.length * 9).toBeLessThan(100);
    }
  });

  it("rejects a non-positive chunk size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("selectBatch", () => {
  it("returns the first batch when the cursor is empty", () => {
    const { batch, hasMore } = selectBatch(subs("a", "b", "c", "d"), "", 2);
    expect(batch.map((s) => s.name)).toEqual(["a", "b"]);
    expect(hasMore).toBe(true);
  });

  it("advances past the cursor on subsequent calls", () => {
    const list = subs("a", "b", "c", "d", "e");
    expect(selectBatch(list, "b", 2).batch.map((s) => s.name)).toEqual(["c", "d"]);
    expect(selectBatch(list, "d", 2).batch.map((s) => s.name)).toEqual(["e"]);
  });

  it("reports hasMore=false on the final batch, including exact multiples", () => {
    expect(selectBatch(subs("a", "b", "c"), "b", 2).hasMore).toBe(false); // ["c"]
    expect(selectBatch(subs("a", "b", "c", "d"), "b", 2).hasMore).toBe(false); // exact fit ["c","d"]
    expect(selectBatch(subs("a", "b"), "b", 2).batch).toEqual([]); // nothing after cursor
  });

  it("walks the whole list in batches with no gaps or repeats", () => {
    const list = subs("a", "b", "c", "d", "e", "f", "g");
    const seen: string[] = [];
    let after = "";
    let hasMore = true;
    while (hasMore) {
      const res = selectBatch(list, after, 3);
      seen.push(...res.batch.map((s) => s.name));
      after = res.batch[res.batch.length - 1].name;
      hasMore = res.hasMore;
    }
    expect(seen).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("does not skip a still-active item when an earlier item deactivates mid-run", () => {
    // Regression: with a numeric offset into a re-queried active list, removing
    // an already-processed item shifts the window and skips a neighbor. The name
    // cursor is immune. BATCH_SIZE = 2.
    const all = subs("a", "b", "c", "d", "e");

    // Batch 1 over the full set -> [a, b]; suppose "b" then hits its failure cap.
    const first = selectBatch(all, "", 2);
    expect(first.batch.map((s) => s.name)).toEqual(["a", "b"]);
    const cursorAfterFirst = first.batch[first.batch.length - 1].name; // "b"

    // Batch 2 over the now-smaller active set (b removed). The old offset=2
    // approach would slice [d, e] and skip "c"; keyset resumes right after "b".
    const remainingActive = subs("a", "c", "d", "e");
    const second = selectBatch(remainingActive, cursorAfterFirst, 2);
    expect(second.batch.map((s) => s.name)).toEqual(["c", "d"]);
    expect(second.batch.map((s) => s.name)).toContain("c");
  });
});
