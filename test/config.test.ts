import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLUSTER_THRESHOLD,
  DEFAULT_PREFILTER_PATTERNS,
  DEFAULT_SCORING_WEIGHTS,
  getClusterThreshold,
  getPrefilterPatterns,
  getScoringWeights,
} from "../src/lib/config";

/**
 * Minimal stand-in for the subset of KVNamespace the config getters touch:
 * `get(key)` (text) and `get(key, "json")`. Values are seeded as already-parsed
 * objects for the JSON path and as strings for the text path.
 */
function fakeKv(store: Record<string, unknown>): KVNamespace {
  return {
    get(key: string, type?: string) {
      if (!(key in store)) return Promise.resolve(null);
      const value = store[key];
      if (type === "json") return Promise.resolve(value);
      return Promise.resolve(String(value));
    },
  } as unknown as KVNamespace;
}

describe("getPrefilterPatterns", () => {
  it("falls back to defaults when the key is absent", async () => {
    await expect(getPrefilterPatterns(fakeKv({}))).resolves.toEqual(DEFAULT_PREFILTER_PATTERNS);
  });

  it("returns the stored override when present", async () => {
    const override = { titleKeywords: "foo", bodyKeywords: "bar" };
    await expect(
      getPrefilterPatterns(fakeKv({ "prefilter:patterns": override })),
    ).resolves.toEqual(override);
  });
});

describe("getScoringWeights", () => {
  it("falls back to defaults when the key is absent", async () => {
    await expect(getScoringWeights(fakeKv({}))).resolves.toEqual(DEFAULT_SCORING_WEIGHTS);
  });
});

describe("getClusterThreshold", () => {
  it("falls back to the default when the key is absent", async () => {
    await expect(getClusterThreshold(fakeKv({}))).resolves.toBe(DEFAULT_CLUSTER_THRESHOLD);
  });

  it("parses a stored numeric string", async () => {
    await expect(getClusterThreshold(fakeKv({ "cluster:threshold": "0.7" }))).resolves.toBe(0.7);
  });

  it("falls back to the default when the stored value is not a finite number", async () => {
    await expect(getClusterThreshold(fakeKv({ "cluster:threshold": "not-a-number" }))).resolves.toBe(
      DEFAULT_CLUSTER_THRESHOLD,
    );
  });
});
