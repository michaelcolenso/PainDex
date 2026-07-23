import { describe, expect, it } from "vitest";
import { passesPrefilter } from "../src/lib/prefilter";
import { DEFAULT_PREFILTER_PATTERNS } from "../src/lib/config";

const patterns = DEFAULT_PREFILTER_PATTERNS;

describe("passesPrefilter", () => {
  it("passes any title containing a question mark", () => {
    expect(passesPrefilter("What lens should I buy", "", patterns)).toBe(false);
    expect(passesPrefilter("What lens should I buy?", "", patterns)).toBe(true);
  });

  it("passes on a title keyword match, case-insensitively", () => {
    expect(passesPrefilter("HOW TO price my services", "", patterns)).toBe(true);
    expect(passesPrefilter("Best way to find a supplier", "", patterns)).toBe(true);
  });

  it("passes on a body keyword match when the title is unremarkable", () => {
    expect(passesPrefilter("My weekend project", "I need an LLC before I can invoice clients", patterns)).toBe(true);
  });

  it("rejects posts with no question mark and no keyword hits", () => {
    expect(passesPrefilter("Just sharing my photo", "Took this at sunset, hope you like it", patterns)).toBe(false);
  });

  it("only inspects the first 500 characters of the body", () => {
    const buried = "x".repeat(500) + " supplier";
    expect(passesPrefilter("Neutral title", buried, patterns)).toBe(false);
    const early = "supplier " + "x".repeat(600);
    expect(passesPrefilter("Neutral title", early, patterns)).toBe(true);
  });
});
